// session-vs-system scope for transparency events. Fail-safe direction is
// load-bearing: anything unrecognized resolves session, so turn output can
// never be hidden by a routing miss. loop-flowing system events (turn-skills,
// integration results) are caught here because they carry no sink info.
const SYSTEM_SOURCES: ReadonlySet<string> = new Set([
  "integrations\npr-preview-ok",
  "integrations\npr-preview-error",
  "integrations\nquest-preview-ok",
  "integrations\nquest-preview-error",
  "boot\nmods.dir",
  "boot\nmods.loaded",
  "boot\nmods.failed",
  "boot\nproviders.skipped",
  "boot\nmods.untrusted",
  "skills\nturn-skills",
])

export function isSystemEvent(e: { source?: unknown; name?: unknown }): boolean {
  if (typeof e.source !== "string" || typeof e.name !== "string") return false
  return SYSTEM_SOURCES.has(`${e.source}\n${e.name}`)
}
