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
