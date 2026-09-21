// Headless transparency test: run a chat turn and print every event emitted.
import { createOllamaProvider } from "../src/providers/ollama"
import { runChatTurn } from "../src/agent/loop"
import type { TransparencyEvent } from "../src/agent/loop"

const main = async () => {
  const ollama = await createOllamaProvider({ baseURL: "http://127.0.0.1:11434/v1" })
  const events: TransparencyEvent[] = []
  let full = ""
  await runChatTurn({
    provider: ollama,
    model: ollama.defaultModel,
    messages: [{ role: "user", content: "Reply with exactly: transparent", timestamp: Date.now() }],
    onDelta: (d) => (full = d),
    onTransparency: (e) => events.push(e),
  })

  const types = events.map((e) => e.type).join(", ")
  console.log("event types:", types)

  const req = events.find((e) => e.type === "request")
  if (req && req.type === "request") {
    console.log("provider:", req.provider)
    console.log("model:", req.model)
    console.log("system prompt present:", req.system.length > 50)
    console.log("messages sent:", req.messages.length)
    console.log("settings:", JSON.stringify(req.settings))
  }

  const fin = events.find((e) => e.type === "finish")
  if (fin && fin.type === "finish") {
    console.log(
      `finish: ${fin.finishReason} · ${fin.usage.inputTokens} in / ${fin.usage.outputTokens} out · ${fin.latencyMs}ms`
    )
  }

  const chunkCount = events.filter((e) => e.type === "chunk").length
  console.log("chunks:", chunkCount, "| reply:", full.slice(0, 40))
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})