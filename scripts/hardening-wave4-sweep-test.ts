// Task F1 proof: P2 close-out matrix. Characterization + regression net:
// duplicate ids, external-URL gate, ring cap, multi-scope mod merge — all
// through real functions under isolated HOME.
import { resolveProviders } from "../src/providers/registry"
import { isSafeExternalUrl, capTranscript } from "../electron/commands"
import { registry } from "../src/mods/registry"
import { saveRepoConfig, findRepoRoot } from "../src/repo-config"
import { saveSessionMeta } from "../src/sessions/store"
import { defaultConfig } from "../src/config"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const main = async () => {
  // duplicate provider id: first wins + skip record, no throw
  const r = await resolveProviders([
    { id: "a", name: "A1", kind: "ollama" },
    { id: "a", name: "A2", kind: "ollama" },
  ] as any)
  if (r.providers.length !== 1 || r.providers[0].name !== "A1" || r.skipped.length !== 1)
    fail("dup-id: " + JSON.stringify({ p: r.providers.length, s: r.skipped }))

  // external URL gate
  if (!isSafeExternalUrl("https://example.com/x")) fail("https rejected")
  if (!isSafeExternalUrl("HTTP://example.com")) fail("case-insensitive")
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "", "ftp://x", 42, null]) {
    if (isSafeExternalUrl(bad)) fail("unsafe accepted: " + String(bad))
  }

  // ring cap: 2005 pushes -> 2000 retained, oldest dropped
  const ring: number[] = []
  for (let i = 0; i < 2005; i++) {
    ring.push(i)
    capTranscript(ring)
  }
  if (ring.length !== 2000 || ring[0] !== 5 || ring[1999] !== 2004) fail("ring cap broken")

  // multi-scope merge: global < repo < session via the real fns
  const cfg: any = { ...defaultConfig(), mods: { w4m: { enabled: true, settings: { a: 1, b: 1 } } } }
  registry.setGlobalConfig(cfg)
  const repo = findRepoRoot("/tmp")
  saveRepoConfig(repo, { mods: { w4m: { settings: { b: 2 } } } })
  registry.setActiveSession({ id: "w4-sess", cwd: "/tmp" })
  saveSessionMeta("w4-sess", { modOverrides: { w4m: { enabled: false } } })
  const resolved = registry.getResolvedModConfig("w4m")
  if (resolved.enabled !== false) fail("session override lost")
  if ((resolved.settings as any).a !== 1 || (resolved.settings as any).b !== 2)
    fail("settings merge: " + JSON.stringify(resolved.settings))
  registry.setActiveSession({ id: "w4-none", cwd: "/tmp" })
  const repoOnly = registry.getResolvedModConfig("w4m")
  if (repoOnly.enabled !== true || (repoOnly.settings as any).b !== 2) fail("repo scope: " + JSON.stringify(repoOnly))
  console.log("sweep OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
