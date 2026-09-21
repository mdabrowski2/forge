// Headless smoke test for forge core (no TUI): config, providers, sessions, chat loop.
import { loadConfig } from "../src/config"
import { createOllamaProvider } from "../src/providers/ollama"
import { runChatTurn } from "../src/agent/loop"
import { newSession, appendMessage, loadSession } from "../src/sessions/store"

const main = async () => {
  const config = loadConfig()
  console.log("config providers:", config.providers.map((p) => p.id).join(", "))

  const ollama = await createOllamaProvider({ baseURL: "http://127.0.0.1:11434/v1" })
  console.log("ollama models:", ollama.models.join(", "))
  console.log("default model:", ollama.defaultModel)

  const s = newSession(ollama.defaultModel)
  appendMessage(s, { role: "user", content: "hello", timestamp: Date.now() })
  appendMessage(s, { role: "assistant", content: "hi", timestamp: Date.now() })
  const loaded = loadSession(s.id)
  console.log("session round-trip:", loaded?.messages.length === 2 ? "OK" : "FAIL")

  let streamed = ""
  const full = await runChatTurn({
    provider: ollama,
    model: ollama.defaultModel,
    messages: [{ role: "user", content: "Reply with exactly: forge works", timestamp: Date.now() }],
    onDelta: (d) => (streamed = d),
  })
  console.log("streamed chars:", streamed.length)
  console.log("reply:", full.slice(0, 120))
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e)
  process.exit(1)
})