// Task 4 proof: collectBootNotices field structure (counts, ids, errors).
// Asserts fields, never sentences. No secret assert here by design: the
// narrowed inputs (names/ids/errors/reasons) carry no secret-bearing values;
// redaction is pinned by the Task 1 constructor suite instead.
import { collectBootNotices } from "../electron/boot-notices"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const notices = collectBootNotices({
  modsDir: "/tmp/w3-mods",
  loaded: ["a"],
  failed: [{ name: "b", error: "boom" }],
  skipped: [{ id: "x", reason: "disabled" }],
  untrusted: ["a"],
})
if (notices.length !== 5) fail("expected 5 notices, got " + notices.length)
const byName = Object.fromEntries(notices.map((n) => [n.name, n]))
if (byName["mods.dir"]?.data?.dir !== "/tmp/w3-mods") fail("dir notice: " + JSON.stringify(byName["mods.dir"]))
if (JSON.stringify(byName["mods.loaded"]?.data) !== JSON.stringify({ loaded: ["a"] }))
  fail("loaded batch: " + JSON.stringify(byName["mods.loaded"]))
if (byName["mods.failed"]?.data?.failed?.[0]?.name !== "b" || byName["mods.failed"]?.data?.failed?.[0]?.error !== "boom")
  fail("failed list: " + JSON.stringify(byName["mods.failed"]))
if (byName["providers.skipped"]?.data?.skipped?.[0]?.id !== "x") fail("skipped: " + JSON.stringify(byName["providers.skipped"]))
if (JSON.stringify(byName["mods.untrusted"]?.data) !== JSON.stringify({ mods: ["a"] }))
  fail("untrusted: " + JSON.stringify(byName["mods.untrusted"]))
for (const n of notices) {
  if (n.type !== "notice" || typeof n.timestamp !== "number" || "turn" in n) fail("shape: " + JSON.stringify(n))
  if (n.source !== "boot") fail("source: " + n.source)
}
const empty = collectBootNotices({ modsDir: "/tmp/w3-mods", loaded: [], failed: [], skipped: [] })
if (empty.length !== 1 || empty[0].name !== "mods.dir") fail("empty boot should yield dir notice only")
console.log("boot-notices OK")
