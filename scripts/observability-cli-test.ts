// 5a-CLI proof: turn-start notice (static fields, no argv dump) + stderr in
// failure notices. Drives the real harness with a fake `claude` on PATH
// (scripts/fixtures/fake-claude, wired below; the real binary must never
// enter a test).
import { createClaudeCodeCliHarness } from "../src/harness/claude-code-cli-harness"
import { join } from "path"

process.env.PATH = `${join(import.meta.dir, "fixtures")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const main = async () => {
  const h = createClaudeCodeCliHarness()
  const seen: any[] = []
  const base = {
    model: "sonnet",
    messages: [{ role: "user", content: "hi", timestamp: 1 }],
    cwd: "/tmp",
    onDelta: () => {},
    onTransparency: (e: any) => seen.push(e),
  } as any

  const ok = await h.runTurn(base)
  if (ok.text !== "fine") fail("turn text: " + ok.text)
  const start = seen.find((e) => e.type === "notice" && e.source === "cli" && e.name === "turn-start")
  if (!start) fail("no cli turn-start notice: " + JSON.stringify(seen.map((e) => e.type)))
  if (start.data.model !== "sonnet" || start.data.resumed !== false || !start.data.allowedTools?.includes("Bash"))
    fail("turn-start fields: " + JSON.stringify(start.data))
  if (JSON.stringify(start).includes("hi")) fail("userText leaked into turn-start")

  process.env.FAKE_MODE = "nonzero"
  try {
    await h.runTurn({ ...base, onTransparency: (e: any) => seen.push(e) })
    fail("nonzero run should reject")
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("disk on fire"))
      fail("stderr missing from failure: " + (e instanceof Error ? e.message : String(e)))
  }
  console.log("cli-notice OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
