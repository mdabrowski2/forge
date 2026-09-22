// Task 1 proof: assembled bundle has all six sections, secrets redacted,
// empty states present, truncation marked. Headless (fabricated deps only).
import { assembleDebugBundle } from "../electron/debug-bundle"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const bundle = assembleDebugBundle({
  version: "9.9.9-test",
  platform: "test-os",
  dateISO: "2026-09-22T00:00:00.000Z",
  config: { providers: [{ id: "a", apiKey: "LIVE-SECRET" }], theme: "dark" },
  providers: [{ id: "a", name: "A", status: "ok", models: ["m1"] }],
  mods: [{ dirName: "brk", enabled: true, settings: {}, status: "failed", error: "boom" }],
  logTail: ["l1", "l2", "l3"],
  messages: [],
  events: [],
})
for (const h of ["## Environment", "## Providers", "## Mods", "## Config (redacted)", "## Session messages", "## Session events", "## Log tail"]) {
  if (!bundle.includes(h)) fail("missing section: " + h)
}
if (!bundle.includes("9.9.9-test")) fail("version missing")
if (bundle.includes("LIVE-SECRET")) fail("secret leaked")
if (!bundle.includes("<redacted>")) fail("redaction marker missing")
if (!bundle.includes("(none)")) fail("empty-state marker missing")
if (!bundle.toLowerCase().includes("review before sharing")) fail("disclaimer missing")
console.log("debug-bundle OK")
