// runtime mod test: a real mod tool executed by the local model in a real turn
import { mkdtempSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadConfig } from "../src/config"
import { loadMods } from "../src/mods/loader"
import { createOllamaProvider } from "../src/providers/ollama"
import { runChatTurn } from "../src/agent/loop"
import type { TransparencyEvent } from "../src/agent/loop"

const main = async () => {
  const config = loadConfig()

  // temp mod: one tool + one command
  const dir = mkdtempSync(join(tmpdir(), "forge-mods-runtime-"))
  mkdirSync(join(dir, "hello-mod"))
  writeFileSync(
    join(dir, "hello-mod", "index.js"),
    `export default {
  name: "hello-mod",
  version: "1.0.0",
  setup(api) {
    api.tools.register({
      name: "say_hello",
      description: "Greets a person by name. Input: { name: string }.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      execute: (input, ctx) => "Hello, " + input.name + "! (cwd: " + ctx.cwd + ")",
    })
    api.commands.register({ name: "ping", description: "pong", run: () => "pong" })
  },
}`
  )
  const mods = await loadMods(config, dir)
  console.log("mods loaded:", mods.loaded.join(", "), "| failed:", mods.failed.length)

  const ollama = config.providers.find((p) => p.kind === "ollama")
  if (!ollama) throw new Error("no ollama provider in config")
  const provider = await createOllamaProvider({ baseURL: ollama.baseURL, defaultModel: "qwen3:8b" })

  const events: TransparencyEvent[] = []
  const result = await runChatTurn({
    provider,
    model: "qwen3:8b",
    messages: [
      {
        role: "user",
        content:
          "Use the say_hello tool with name \"forge\" and tell me exactly what it returned.",
        timestamp: Date.now(),
      },
    ],
    cwd: "C:\\Users\\mateu\\Projects\\forge",
    config,
    sessionId: "runtime-test",
    thinking: true,
    onDelta: () => {},
    onTransparency: (e) => events.push(e),
  })

  const calls = events.filter((e) => e.type === "tool-call")
  const results = events.filter((e) => e.type === "tool-result")
  console.log("tool-call events:", calls.length)
  console.log("tool-result events:", results.length)
  for (const e of calls) {
    const c = e as Extract<TransparencyEvent, { type: "tool-call" }>
    console.log("  call:", c.tool, JSON.stringify(c.args))
  }
  for (const e of results) {
    const r = e as Extract<TransparencyEvent, { type: "tool-result" }>
    console.log(`  result ok=${r.ok} ${r.durationMs}ms:`, r.result.slice(0, 140))
  }
  console.log("--- final text ---")
  console.log(result.text.slice(0, 400))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})