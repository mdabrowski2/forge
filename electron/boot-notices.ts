// boot diagnostics as notices — pure collector, no Electron imports.
// Inputs are narrowed to names/ids/errors/reasons (no config object, so no
// secret-bearing values enter; redaction is pinned by the Task 1 suite).
// Rejected alternative: appending to every session's events file — global
// noise would pollute all sessions and fight the turn model. These notices
// are turn-less (feed-end per the rendering contract) and re-emitted every
// launch; forge.log is the durable record. Failed mods list fully: each is
// actionable, and failure counts stay small in practice.
import { notice, type NoticeEvent } from "../src/transparency/notice"

export interface BootDiagnostics {
  modsDir: string
  loaded: string[]
  failed: { name: string; error: string }[]
  skipped: { id: string; reason: string }[]
}

export function collectBootNotices(d: BootDiagnostics): NoticeEvent[] {
  const out = [notice("boot", "mods.dir", { dir: d.modsDir })]
  if (d.loaded.length) out.push(notice("boot", "mods.loaded", { loaded: d.loaded }))
  if (d.failed.length) out.push(notice("boot", "mods.failed", { failed: d.failed }))
  if (d.skipped.length) out.push(notice("boot", "providers.skipped", { skipped: d.skipped }))
  return out
}
