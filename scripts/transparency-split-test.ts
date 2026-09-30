// transparency split verification — run from the forge project root:
// bun scripts/transparency-split-test.ts (throws on first failure)
import { strict as assert } from "node:assert"
import { isSystemEvent } from "../src/transparency/scope"

// turn events and sourceless events resolve session (fail-safe)
assert.strictEqual(isSystemEvent({ type: "chunk", callId: "c", text: "t", timestamp: 1 }), false)
assert.strictEqual(isSystemEvent({ type: "request", callId: "c" } as never), false)
// unknown future pairs resolve session — never hide by default
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "future", name: "whatever", timestamp: 1 }), false)
// known system pairs resolve system
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "integrations", name: "pr-preview-error", timestamp: 1 }), true)
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "boot", name: "mods.loaded", timestamp: 1 }), true)
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "boot", name: "mods.failed", timestamp: 1 }), true)
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "boot", name: "providers.skipped", timestamp: 1 }), true)
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "skills", name: "turn-skills", timestamp: 1 }), true)
console.log("section 1 green")

// section 2: the system path still reaches forge.log (audit trail preserved)
import { publishNotice } from "../src/transparency/notice"
import { readFileSync, statSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
const logPath = join(homedir(), ".forge", "logs", "forge.log")
const before = (() => { try { return statSync(logPath).size } catch { return 0 } })()
publishNotice("skills", "turn-skills", { skills: [{ name: "probe", bytes: 10, estTokens: 3 }] })
const after = (() => { try { return statSync(logPath).size } catch { return 0 } })()
assert.ok(after > before, "system-path notice must still append to forge.log")
const tail = readFileSync(logPath, "utf8").slice(-400)
assert.ok(tail.includes("turn-skills"), "log tail contains the system event")
console.log("section 2 green")

// section 3 (soak): system-sink-less notices never reach the session file.
// this pins the sink-withholding contract; the handler-filter half is pinned
// by section 1's unit tests plus typecheck — both halves stated explicitly.
import { appendEvent, loadEvents, newSession } from "../src/sessions/store"
const soak = newSession("m", "/tmp")
for (let i = 0; i < 5; i++) {
  publishNotice("integrations", "pr-preview-error", { error: "boom" })
  publishNotice("boot", "mods.loaded", { loaded: [] })
}
appendEvent(soak, { type: "chunk", callId: "c", text: "t", timestamp: 1, turn: 0 } as never)
const evts = loadEvents(soak.id)
assert.ok(evts.length >= 1, "control turn event persisted")
assert.ok(
  !evts.some((e) => {
    const s = (e as { source?: string }).source
    return s === "integrations" || s === "boot"
  }),
  "no system sources in session file"
)
const soakFile = join(homedir(), ".forge", "sessions", `${soak.id}.events.jsonl`)
if (existsSync(soakFile)) rmSync(soakFile)
console.log("section 3 green")
