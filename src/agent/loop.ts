import { streamText } from "ai"
import type { ForgeConfig } from "../config"
import type { Provider } from "../providers/types"
import type { ChatMessage } from "../sessions/store"
import { getSystemPrompt } from "./prompt"
import { logEvent } from "../transparency/log"
import type { TransparencyEvent } from "../transparency/types"
import { registry, type ToolRuntime } from "../mods/registry"
import { createTools } from "./tools"
import { describeTools } from "./tools/describe"

export type { TransparencyEvent } from "../transparency/types"

export interface ChatTurnOptions {
  provider: Provider
  model: string
  messages: ChatMessage[]
  cwd: string
  /** enable model reasoning (thinking); only applied to Ollama models */
  thinking?: boolean
  /** config at boot time — handed to mod tools via their context */
  config: ForgeConfig
  /** session id — handed to mod tools via their context */
  sessionId?: string
  onDelta: (text: string) => void
  onTransparency?: (event: TransparencyEvent) => void
  signal?: AbortSignal
}

export interface ChatTurnResult {
  text: string
  /** assistant + tool messages to persist, in order */
  messages: ChatMessage[]
}

export const MAX_STEPS = 8

/**
 * Budget-exit detector (pure, unit-pinned): the tool loop stopped because it
 * ran out of steps with tool calls still pending — NOT a clean finish and
 * NOT an abort. Aborts must never be misattributed as model behavior.
 */
export const isBudgetExhausted = (stepsTaken: number, lastHadToolCalls: boolean, aborted: boolean): boolean =>
  !aborted && stepsTaken >= MAX_STEPS && lastHadToolCalls

export async function runChatTurn(opts: ChatTurnOptions): Promise<ChatTurnResult> {
  const started = Date.now()

  const emit = (event: TransparencyEvent) => {
    logEvent(event)
    opts.onTransparency?.(event)
    registry.emitHook("transparencyEvent", event)
  }
  registry.setEmitSink(emit)
  // must run before getSystemPrompt() — it reads the active session to know
  // which skills are loaded for this turn
  if (opts.sessionId) registry.setActiveSession({ id: opts.sessionId, cwd: opts.cwd })
  const system = getSystemPrompt()

  const runtime: ToolRuntime = {
    cwd: opts.cwd,
    config: opts.config,
    session: { id: opts.sessionId ?? "", messages: opts.messages },
    emit,
  }
  const tools = createTools(runtime)

  registry.emitHook("beforeTurn", { model: opts.model, cwd: opts.cwd, messages: opts.messages })

  // convert persisted session messages to AI SDK model messages
  const modelMessages = opts.messages.map((m) => {
    if (m.role === "user") return { role: "user" as const, content: m.content }
    if (m.role === "tool")
      return {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: m.toolCallId ?? "",
            toolName: m.toolName ?? "unknown",
            output: { type: "text" as const, value: m.content },
          },
        ],
      }
    if (m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: m.content },
          ...m.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.args,
          })),
        ],
      }
    }
    return { role: "assistant" as const, content: m.content }
  })

  let full = ""
  const allToolCalls: { id: string; name: string; args: unknown }[] = []
  const persistMessages: ChatMessage[] = []
  let stepsTaken = 0
  let lastHadToolCalls = false

  for (let step = 0; step < MAX_STEPS; step++) {
    stepsTaken++
    const stepStarted = Date.now()
    // single source for the reasoning flag: the call below AND the
    // transparency record must never disagree about what was requested
    const reasoningOn = Boolean(opts.thinking && opts.provider.capabilities?.reasoningEffort)
    const result = streamText({
      model: opts.provider.getModelForSession?.(opts.model, opts.sessionId ?? "") ?? opts.provider.getModel(opts.model),
      system,
      messages: modelMessages,
      tools,
      abortSignal: opts.signal,
      // Reasoning effort is a provider *capability*, not an identity check:
      // any OpenAI-compatible endpoint that honors `reasoning_effort`
      // (local Ollama, remote vLLM, …) opts in via capabilities.reasoningEffort.
      ...(reasoningOn ? { providerOptions: { ollama: { reasoningEffort: "high" } } } : {}),
      onLanguageModelCallStart: (e) => {
        const standardized = e as unknown as { system?: string; messages?: unknown[] }
        emit({
          type: "request",
          callId: e.callId,
          provider: opts.provider.name,
          model: opts.model,
          system: standardized.system ?? system,
          messages: standardized.messages ?? opts.messages,
          tools: describeTools(tools),
          settings: {
            temperature: e.temperature,
            topP: e.topP,
            maxOutputTokens: e.maxOutputTokens,
            providerOptions: reasoningOn ? { reasoningEffort: "high" } : {},
            maxSteps: MAX_STEPS,
          },
          timestamp: Date.now(),
        })
      },
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") {
          emit({ type: "chunk", callId: chunk.id, text: chunk.text, timestamp: Date.now() })
        } else if (chunk.type === "reasoning-delta") {
          emit({ type: "reasoning", callId: chunk.id, delta: chunk.text, timestamp: Date.now() })
        }
      },
      onFinish: (e) => {
        emit({
          type: "finish",
          callId: e.callId,
          usage: {
            inputTokens: e.usage.inputTokens ?? 0,
            outputTokens: e.usage.outputTokens ?? 0,
            totalTokens: e.usage.totalTokens ?? 0,
          },
          finishReason: e.finishReason,
          latencyMs: Date.now() - stepStarted,
          timestamp: Date.now(),
        })
      },
      onError: (e) => {
        const message = e.error instanceof Error ? e.error.message : String(e.error)
        emit({ type: "error", callId: "", message: `[${opts.provider.id}] ${message}`, timestamp: Date.now() })
      },
    })

    // model-call failures surface through the SDK wrapper (original cause
    // swallowed) — enrich once here so both UIs name the provider; the
    // onError event above already fired, so this path emits nothing.
    let steps
    try {
      for await (const delta of result.textStream) {
        full += delta
        opts.onDelta(full)
      }

      steps = await result.steps
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new Error(`[${opts.provider.id}] ${message} — check baseURL/apiKey in config`)
    }
    const lastStep = steps[steps.length - 1]
    const toolCalls = lastStep.toolCalls
    lastHadToolCalls = toolCalls.length > 0
    if (!toolCalls.length) break
    // assistant message with the tool calls it made
    modelMessages.push({
      role: "assistant",
      content: [
        { type: "text", text: lastStep.text },
        ...toolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        })),
      ],
    })

    for (const tc of toolCalls) {
      const tool = tools[tc.toolName]
      const t0 = Date.now()
      emit({ type: "tool-call", callId: tc.toolCallId, tool: tc.toolName, args: tc.input, timestamp: t0 })

      let outStr: string
      let ok = true
      if (!tool) {
        outStr = `Unknown tool: ${tc.toolName}`
        ok = false
      } else {
        registry.emitHook("beforeToolCall", { tool: tc.toolName, args: tc.input })
        try {
          const output = await tool.execute(tc.input, {
            toolCallId: tc.toolCallId,
            abortSignal: opts.signal,
          })
          outStr = typeof output === "string" ? output : JSON.stringify(output)
        } catch (e) {
          outStr = e instanceof Error ? e.message : String(e)
          ok = false
        }
      }
      registry.emitHook("afterToolCall", {
        tool: tc.toolName,
        args: tc.input,
        ok,
        result: outStr,
        durationMs: Date.now() - t0,
      })

      emit({
        type: "tool-result",
        callId: tc.toolCallId,
        tool: tc.toolName,
        ok,
        result: outStr,
        durationMs: Date.now() - t0,
        timestamp: Date.now(),
      })

      modelMessages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: "text", value: outStr },
          },
        ],
      })

      allToolCalls.push({ id: tc.toolCallId, name: tc.toolName, args: tc.input })
      persistMessages.push({
        role: "tool",
        content: outStr,
        timestamp: Date.now(),
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
      })
    }
  }

  // budget exit (not a clean finish, not an abort): the final answer below
  // would otherwise read as normal while tool calls went unexecuted
  if (isBudgetExhausted(stepsTaken, lastHadToolCalls, opts.signal?.aborted ?? false)) {
    emit({ type: "notice", callId: "", source: "loop", name: "step-budget-exhausted", data: { model: opts.model, steps: MAX_STEPS }, timestamp: Date.now() })
  }

  // one assistant message with the full text + all tool calls, then the tool results
  persistMessages.unshift({
    role: "assistant",
    content: full,
    timestamp: Date.now(),
    toolCalls: allToolCalls.length ? allToolCalls : undefined,
  })

  registry.emitHook("afterTurn", { model: opts.model, text: full, messages: persistMessages })

  return { text: full, messages: persistMessages }
}