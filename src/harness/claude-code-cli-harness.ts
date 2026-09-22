import { spawn } from "child_process"
import { createInterface } from "readline"
import { loadSessionMeta, saveSessionMeta } from "../sessions/store"
import type { ChatMessage, ToolCallRecord } from "../sessions/store"
import type { TransparencyEvent } from "../transparency/types"
import { logEvent } from "../transparency/log"
import { registry } from "../mods/registry"
import type { Harness, TurnOptions, TurnResult } from "./types"

// Fully self-contained harness: shells out to the real, unmodified `claude`
// CLI (spawn, no shell) and translates its stream-json events into forge's
// own TransparencyEvent vocabulary. The credential never leaves Claude
// Code's own process — this harness never reads or touches the OAuth token,
// unlike the earlier (removed) approach of relaying it into a raw HTTP call.
// See ~/.claude/plans/i-created-my-personal-iridescent-giraffe.md for why.

// mirrors forge's own tool vocabulary (src/agent/tools) — excludes the
// platform/harness tools (Task, CronCreate, PushNotification, ...) that show
// up in `claude -p`'s tool list but have no business running from a personal
// chat subprocess
const ALLOWED_TOOLS = "Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch"

function runClaudeCodeProcess(opts: TurnOptions, resumeId: string | undefined): Promise<TurnResult & { resumeId: string }> {
  const started = Date.now()
  const userText = opts.messages[opts.messages.length - 1]?.content ?? ""

  const emit = (event: TransparencyEvent) => {
    logEvent(event)
    opts.onTransparency?.(event)
    registry.emitHook("transparencyEvent", event)
  }
  // so a mod's api.events.emit(...) actually flows through during this turn —
  // runChatTurn does the same for its own turns; the sink is a shared singleton
  registry.setEmitSink(emit)
  if (opts.sessionId) registry.setActiveSession({ id: opts.sessionId, cwd: opts.cwd })

  emit({
    type: "request",
    callId: "",
    provider: "Claude Code CLI",
    model: opts.model,
    system: "",
    messages: opts.messages,
    // CLI-side tools: allowed list is fixed in ALLOWED_TOOLS; schemas live
    // in the subprocess and are not visible to Forge — recorded as names.
    tools: ALLOWED_TOOLS.split(",").map((name) => ({
      name,
      description: "CLI-backend tool (schema held server-side)",
      inputSchema: { kind: "cli-managed" },
    })),
    settings: { transport: "cli-subprocess", allowedTools: ALLOWED_TOOLS },
    timestamp: Date.now(),
  })

  const args = [
    "-p",
    userText,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--permission-mode",
    "bypassPermissions",
    "--permission-prompts",
    "none",
    "--safe-mode",
    "--verbose",
    "--allowedTools",
    ALLOWED_TOOLS,
    "--model",
    opts.model,
  ]
  if (resumeId) args.push("--resume", resumeId)

  // static invocation context only: argv is fixed except userText (already in
  // the session), model (in request) and resumeId — no argv dump, no leak
  // surface. Credential stays in the subprocess (see header comment).
  emit({
    type: "notice",
    callId: "",
    source: "cli",
    name: "turn-start",
    data: { model: opts.model, resumed: resumeId !== undefined, allowedTools: ALLOWED_TOOLS },
    timestamp: Date.now(),
  })

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] })

    let full = ""
    // stderr was piped and never read — on failure the process's own
    // explanation was discarded and only the exit code logged. Bounded drain.
    let stderrTail = ""
    child.stderr?.on("data", (d) => {
      stderrTail = (stderrTail + String(d)).slice(-2000)
    })
    const withStderr = (message: string) => (stderrTail.trim() ? `${message}: ${stderrTail.trim()}` : message)
    let sessionId = resumeId ?? ""
    let settled = false
    const allToolCalls: ToolCallRecord[] = []
    const persistMessages: ChatMessage[] = []
    // tool_use id -> tool name, so a later tool_result can be labeled
    const pendingToolNames = new Map<string, string>()

    const onAbort = () => child.kill()
    opts.signal?.addEventListener("abort", onAbort)
    const cleanup = () => opts.signal?.removeEventListener("abort", onAbort)

    const rl = createInterface({ input: child.stdout })
    rl.on("line", (line) => {
      if (!line.trim()) return
      let event: any
      try {
        event = JSON.parse(line)
      } catch {
        return // stray non-JSON output — ignore
      }

      if (event.type === "system" && event.subtype === "init") {
        sessionId = event.session_id ?? sessionId
        return
      }

      if (event.type === "rate_limit_event") {
        emit({
          type: "custom",
          callId: "",
          mod: "claude-code-cli",
          name: "rate-limit",
          data: event.rate_limit_info,
          timestamp: Date.now(),
        })
        return
      }

      if (event.type === "stream_event") {
        const inner = event.event
        if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta") {
          full += inner.delta.text
          opts.onDelta(full)
          emit({ type: "chunk", callId: event.session_id ?? "", text: inner.delta.text, timestamp: Date.now() })
        }
        return
      }

      if (event.type === "assistant") {
        const content = event.message?.content ?? []
        for (const block of content) {
          if (block.type === "tool_use") {
            pendingToolNames.set(block.id, block.name)
            allToolCalls.push({ id: block.id, name: block.name, args: block.input })
            emit({ type: "tool-call", callId: block.id, tool: block.name, args: block.input, timestamp: Date.now() })
          }
        }
        return
      }

      // Inferred, not empirically confirmed against a real tool call — Claude
      // Code's transcript convention mirrors the Messages API's tool_result
      // shape on a "user" role message. Adjust if real output differs.
      if (event.type === "user") {
        const content = event.message?.content ?? []
        for (const block of content) {
          if (block.type === "tool_result") {
            const toolName = pendingToolNames.get(block.tool_use_id) ?? "unknown"
            const ok = !block.is_error
            const resultStr = typeof block.content === "string" ? block.content : JSON.stringify(block.content)
            emit({
              type: "tool-result",
              callId: block.tool_use_id,
              tool: toolName,
              ok,
              result: resultStr,
              durationMs: 0,
              timestamp: Date.now(),
            })
            persistMessages.push({
              role: "tool",
              content: resultStr,
              timestamp: Date.now(),
              toolCallId: block.tool_use_id,
              toolName,
            })
          }
        }
        return
      }

      if (event.type === "result") {
        settled = true
        sessionId = event.session_id ?? sessionId
        if (event.is_error) {
          const message = typeof event.result === "string" ? event.result : "claude -p returned an error"
          emit({ type: "error", callId: "", message, timestamp: Date.now() })
          cleanup()
          reject(new Error(message))
          return
        }
        const finalText = typeof event.result === "string" ? event.result : full
        emit({
          type: "finish",
          callId: "",
          usage: {
            inputTokens: event.usage?.input_tokens ?? 0,
            outputTokens: event.usage?.output_tokens ?? 0,
            totalTokens: (event.usage?.input_tokens ?? 0) + (event.usage?.output_tokens ?? 0),
          },
          finishReason: event.stop_reason ?? event.subtype ?? "end_turn",
          latencyMs: event.duration_ms ?? Date.now() - started,
          timestamp: Date.now(),
        })
        persistMessages.unshift({
          role: "assistant",
          content: finalText,
          timestamp: Date.now(),
          toolCalls: allToolCalls.length ? allToolCalls : undefined,
        })
        cleanup()
        resolve({ text: finalText, messages: persistMessages, resumeId: sessionId })
      }
    })

    child.on("error", (err) => {
      cleanup()
      const message = withStderr(err.message)
      emit({ type: "error", callId: "", message, timestamp: Date.now() })
      reject(new Error(message))
    })

    child.on("close", (code) => {
      cleanup()
      if (!settled && code !== 0) {
        const message = withStderr(`claude -p exited with code ${code}`)
        emit({ type: "error", callId: "", message, timestamp: Date.now() })
        reject(new Error(message))
      }
    })
  })
}

export function createClaudeCodeCliHarness(): Harness {
  return {
    id: "claude-code-cli",
    name: "Claude Code CLI (full agent, subscription)",
    models: ["sonnet", "opus", "haiku", "fable"],
    defaultModel: "sonnet",
    runTurn: async (opts: TurnOptions): Promise<TurnResult> => {
      const resumeId = opts.sessionId ? loadSessionMeta(opts.sessionId).claudeCodeSessionId : undefined
      const result = await runClaudeCodeProcess(opts, resumeId)
      if (opts.sessionId) saveSessionMeta(opts.sessionId, { claudeCodeSessionId: result.resumeId, model: opts.model })
      return { text: result.text, messages: result.messages }
    },
  }
}
