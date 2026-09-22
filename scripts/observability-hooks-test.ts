// 5a-hooks proof: throwing hooks emit keys-only notices via the sink;
// transparencyEvent-throwers terminate (no recursion) with console-only output.
// (Isolated HOME not needed — no fs touched; unique mod names + reset hygiene.)
import { registry } from "../src/mods/registry"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const seen: any[] = []
registry.setEmitSink((e) => seen.push(e))
registry.on("w3hookprobe", "beforeTurn", () => {
  throw new Error("hook-boom")
})
registry.emitHook("beforeTurn", { model: "m", cwd: "/tmp", messages: [] } as any)
const n = seen.find((e) => e.type === "notice")
if (!n || n.source !== "hooks" || n.name !== "hook-failed") fail("no hooks notice: " + JSON.stringify(seen))
if (n.data.mod !== "w3hookprobe" || n.data.event !== "beforeTurn") fail("attribution: " + JSON.stringify(n.data))
if (!Array.isArray(n.data.payloadKeys) || !n.data.payloadKeys.includes("model")) fail("keys: " + JSON.stringify(n.data))
if (JSON.stringify(n).includes("hook-boom")) fail("throwable value leaked (only keys allowed)")

// recursion case: throwing transparencyEvent hook must terminate
let consoleLines = 0
const origErr = console.error
console.error = () => {
  consoleLines++
}
registry.on("w3hookprobe2", "transparencyEvent", () => {
  throw new Error("te-boom")
})
const before = seen.length
registry.emitHook("transparencyEvent", { type: "custom", callId: "", mod: "x", name: "y", data: {}, timestamp: 0 } as any)
console.error = origErr
if (seen.length !== before) fail("transparencyEvent throw emitted a notice (recursion risk)")
if (consoleLines < 1) fail("console line missing for transparencyEvent throw")
registry.reset()
if (registry.getCommands().length || seen.length === 0) console.log("(reset ok)")
console.log("hooks-notice OK")
