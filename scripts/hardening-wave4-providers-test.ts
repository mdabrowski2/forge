// Task C proof: refused-connection turn names the provider + setup hint.
// Hermetic (unroutable port, no external network, no inference).
import { createOllamaProvider } from "../src/providers/ollama"
import { runChatTurn } from "../src/agent/loop"
import { defaultConfig } from "../src/config"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const main = async () => {
  const provider = await createOllamaProvider({
    id: "ollama",
    name: "Ollama (local)",
    baseURL: "http://127.0.0.1:9/v1",
    defaultModel: "nope",
  })
  try {
    await runChatTurn({
      provider,
      model: "nope",
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
      cwd: "/tmp",
      config: defaultConfig(),
      onDelta: () => {},
    })
    fail("expected refused connection")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes("[ollama]")) fail("missing provider id: " + msg.slice(0, 200))
    if (!msg.includes("baseURL")) fail("missing setup hint: " + msg.slice(0, 200))
    console.log("provider-identity OK")
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
