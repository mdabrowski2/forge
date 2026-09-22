// P0-3 (3a) proof: corrupt lines are skipped + counted, never thrown.
// Runs under the caller's HOME (isolate it: HOME=$(mktemp -d)/h bun scripts/hardening-sessions-test.ts).
import { loadSession, newSession, appendMessage } from "../src/sessions/store"
import { appendFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}
const s = newSession("m", "/tmp")
appendMessage(s, { role: "user", content: "hi", timestamp: Date.now() })
appendFileSync(join(homedir(), ".forge", "sessions", s.id + ".jsonl"), "NOT-JSON{{{")
const back = loadSession(s.id)
if (!back || back.messages.length !== 1) fail("expected 1 good message, got " + back?.messages.length)
console.log("guards OK")
