// headless tool-loop test: asks the local model to use the glob tool
import { loadConfig } from "../src/config"
import { createOllamaProvider } from "../src/providers/ollama"
import { runChatTurn } from "../src/agent/loop"
import type { TransparencyEvent } from "../src/agent/loop"

const main = async () => {
  const config = loadConfig()
  const ollama = config.providers.find((p) => p.kind === "ollama")
  if (!ollama) throw new Error("no ollama provider in config")
  const provider = await createOllamaProvider({
    baseURL: ollama.baseURL,
    defaultModel: ollama.defaultModel,
  })

  const events: TransparencyEvent[] = []
  const result = await runChatTurn({
    provider,
    model: provider.defaultModel,
    messages: [
      {
        role: "user",
        content:
          "Use the glob tool to find all .ts files under C:\\Users\\mateu\\Projects\\forge\\src. Then tell me how many you found and name three of them.",
        timestamp: Date.now(),
      },
    ],
    cwd: "C:\\Users\\mateu\\Projects\\forge",
    thinking: true,
    onDelta: () => {},
    onTransparency: (e) => events.push(e),
  })

  const reasoning = events.filter((e) => e.type === "reasoning")
  const reasoningText = reasoning
    .map((e) => (e as Extract<TransparencyEvent, { type: "reasoning" }>).delta)
    .join("")
  console.log("reasoning events:", reasoning.length, `(${reasoningText.length} chars)`)
  if (reasoningText) console.log("reasoning:", reasoningText.slice(0, 300))

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