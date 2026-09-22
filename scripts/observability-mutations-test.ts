// Task 3 proof: mutation traces carry before→after with secrets redacted,
// through the real loader fns under isolated HOME.
// (Isolate it: HOME=$(mktemp -d)/h bun scripts/observability-mutations-test.ts.
// Handler call sites are review-verified; this pins every input they switch on.)
import { traceMutation } from "../electron/mutations"
import { loadRepoConfig, saveRepoConfig, findRepoRoot } from "../src/repo-config"
import { loadSessionMeta, saveSessionMeta } from "../src/sessions/store"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}
const seen: any[] = []
const push = (e: any) => seen.push(e)

const main = async () => {
  // 1. config with secret on the BEFORE side must not leak
  traceMutation(
    "config",
    "providers",
    { providers: [{ id: "a", apiKey: "SECRET-BEFORE" }] },
    { providers: [{ id: "a", apiKey: "SECRET-AFTER" }] },
    { push }
  )
  // 2. scoped mod toggle pair, before read via the real repo-config fns
  const repo = findRepoRoot("/tmp")
  saveRepoConfig(repo, { mods: { "w3mod": { enabled: true } } })
  const before = loadRepoConfig(repo).mods["w3mod"]?.enabled
  saveRepoConfig(repo, { mods: { "w3mod": { enabled: false } } })
  const after = loadRepoConfig(repo).mods["w3mod"]?.enabled
  if (before !== true || after !== false) fail("scoped readback broken")
  traceMutation("mods", "w3mod(repo).enabled", before, after, { push })
  // 3. session-scoped override read via the real session-meta fns
  saveSessionMeta("w3-sess", { modOverrides: { w3mod: { enabled: false } } })
  const sover = loadSessionMeta("w3-sess").modOverrides?.["w3mod"]?.enabled
  if (sover !== false) fail("session-meta readback broken")
  traceMutation("mods", "w3mod(session).enabled", undefined, sover, { push })

  if (seen.length !== 3) fail("expected 3 notices, got " + seen.length)
  const blob = JSON.stringify(seen)
  if (blob.includes("SECRET-BEFORE") || blob.includes("SECRET-AFTER")) fail("secret leaked into notice")
  if (!blob.includes("<redacted>")) fail("redaction marker missing")
  const toggle = seen[1]
  if (toggle.source !== "mods" || toggle.data.before !== true || toggle.data.after !== false)
    fail("toggle shape wrong: " + JSON.stringify(toggle.data))
  console.log("mutations OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
