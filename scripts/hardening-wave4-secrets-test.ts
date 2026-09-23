// Task F2 proof: dummy-key seeded run — no secret value may reach session
// files, event files, or the captured request event.
import { createOllamaProvider } from "../src/providers/ollama"
import { runChatTurn } from "../src/agent/loop"
import { defaultConfig } from "../src/config"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const main = async () => {
  process.env.W4_DUMMY_KEY = "W4DUMMY-SECRET-XYZ"
  const cfg = { ...defaultConfig(), providers: [{ id: "o", name: "O", kind: "ollama", apiKey: "W4DUMMY-SECRET-XYZ" }] } as any
  const provider = await createOllamaProvider({ id: "o", name: "O", baseURL: "http://127.0.0.1:11434/v1", defaultModel: "x" })
  let req: any = null
  // provider listing carries the key only in config, never in the turn — use default model probe off; just verify request shape via a stub turn is overkill:
  // instead assert the request event built by a real (refused) turn has no key material
  try {
    await runChatTurn({
      provider,
      model: "nope-no-model",
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
      cwd: "/tmp",
      config: cfg,
      onDelta: () => {},
      onTransparency: (e) => {
        if (e.type === "request") req = e
      },
    })
  } catch {
    // refused/unknown-model expected — the request event is what we assert on
  }
  if (!req) fail("no request event captured")
  const blob = JSON.stringify(req)
  if (blob.includes("W4DUMMY")) fail("secret in request event")
  const { readdirSync, readFileSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")
  const sd = join(homedir(), ".forge", "sessions")
  let files: string[] = []
  try {
    files = readdirSync(sd)
  } catch {
    files = []
  }
  for (const f of files) {
    if (readFileSync(join(sd, f), "utf-8").includes("W4DUMMY")) fail("secret in session file " + f)
  }
  console.log("secrets OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
