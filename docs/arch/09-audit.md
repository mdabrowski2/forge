# 09 — Audit + hardening

Ranked backlog of proposed fixes (all status `proposed` unless noted). Severity: **P0** = data loss / crash / integrity; **P1** = security hole or frequent failure without workaround; **P2** = test/observability gap. Work in priority order; check off with PR links. New dev start: do **Quick wins** first (no design needed), then P0-2.

## P0 — correctness / data loss

- [x] 1. **TUI turn persistence asymmetry** — shipped (hardening Wave 1): `send()` persists all result messages, then mirrors the store into the render list.
- [x] 2. **Malformed config silent fallback** — shipped (hardening Wave 1): corrupt `config.json` is copied to `config.json.bak.<epochMillis>-<rand>` with a `[config]` log line before defaults load.
- [x] 3. **Session-list crash surface** — shipped (hardening Wave 1): corrupt lines are skipped with a drop count; fully-unreadable session files move with all sidecars to `sessions/quarantine/` plus a manifest line, and the list continues.
- [x] 4. **Unbounded session/event files** — read-slice shipped (hardening Wave 1): `loadEvents` returns the latest 500 by default (memory bound; parse cost unchanged). Full rotation still proposed.

## P1 — security

- [x] 5. **Mod trust visibility** — shipped (Waves 2+4): boot logs scanned dir; per-mod `trusted` flag (ADR-006, default untrusted) with first-boot warning notice + panel badge; enforcement deliberately out of scope.
- [x] 6. **Tool path traversal** — shipped (Wave 4): shared `resolveInCwd()` guard (platform-aware, best-effort realpath, fail-closed on leading `..`) on read/write/edit + glob/grep base dirs; patterns/regexes exempt by input-kind; bash explicitly exempt (a shell with a cwd is not a sandbox). Refusals return `Refused:` strings on the existing file-error path.
- [x] 7. **`openPath` logging** — shipped (Wave 4): every open attempt emits a `shell/openPath` notice (validated first, null-inputs silent).
- [x] 8. **Secrets handling** — audited (Wave 4): dummy-key seeded run proves request events + session files carry no key material; mutation notices redact via constructor suite. `config.json` itself holding user keys is by design, not a leak.

## P1 — resilience

- [x] 9. **Provider failure identity** — shipped (Wave 4): turn errors and thrown failures carry `[provider-id]` + setup hint at the single loop boundary (SDK swallows causes, so enrichment happens there); rendered via existing error paths. No session degraded flag — deliberately dropped: unwritten-by-any-reader state rots; the error text is the surface.
- [ ] 10. **Quest `:3060` assumed, no timeout** (proposed, ~0.5d): hardcoded default URL with no health check. Fix: connectivity probe + timeout + visible degraded badge.
- [x] 11. **Step-budget stop** — shipped (Wave 4): `notice(loop/step-budget-exhausted)` on budget exits only (abort-aware predicate, no misattribution).
- [ ] 12. **Hook isolation** (proposed, needs design): `emitHook` catches per-hook throws (good) but a slow synchronous hook blocks the whole turn. Fix: document hooks must be non-blocking; if async hooks are ever added, race them against a timeout (`Promise.race` — finish whichever comes first).

## P2 — test/observability gaps (existing suites: `scripts/smoke|providers-test|mods-test|mods-runtime-test|transparency-test|tool-test.ts`)

- [ ] 13. **Missing cases** (proposed): corrupt-config backup, corrupt-session quarantine, duplicate-provider-id, disabled-mod tool/call exclusion, `/cd` invalid dir, `openExternal` non-http rejection, transcript-ring overflow, multi-scope mod merge matrix.
- [x] 14. **Structured turn IDs** — collapsed by design (Wave 4): the existing `turn` index already correlates every event of a turn on persisted and live paths; no second key minted.

## Quick wins (no design needed, good first tasks)

- [x] Log `skipped` providers with reasons at Electron boot — verified present in both boots.
- [x] Mod `failed` errors surface in the renderer mods panel — verified (`mod-error` row + untrusted badge).
- [x] Transcript-ring durability documented in `04-runtime.md` — events file is the source of truth.
