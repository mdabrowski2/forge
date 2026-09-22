# 09 — Audit + hardening

Ranked backlog of proposed fixes (all status `proposed` unless noted). Severity: **P0** = data loss / crash / integrity; **P1** = security hole or frequent failure without workaround; **P2** = test/observability gap. Work in priority order; check off with PR links. New dev start: do **Quick wins** first (no design needed), then P0-2.

## P0 — correctness / data loss

- [x] 1. **TUI turn persistence asymmetry** — shipped (hardening Wave 1): `send()` persists all result messages, then mirrors the store into the render list.
- [x] 2. **Malformed config silent fallback** — shipped (hardening Wave 1): corrupt `config.json` is copied to `config.json.bak.<epochMillis>-<rand>` with a `[config]` log line before defaults load.
- [ ] 3. **Session-list crash surface** (proposed, ~0.5d, `src/sessions/store.ts:129-136`): one corrupt `.jsonl` line throws inside `JSON.parse` and can break boot-resume. Fix: per-file try/catch; move bad files to `~/.forge/sessions/quarantine/` (a holding folder for corrupt files) and continue.
- [ ] 4. **Unbounded session/event files** (proposed, ~1d): long sessions grow JSONL (one-JSON-per-line) files forever; `loadEvents` parses everything into memory. Fix: rotation (new file per N messages) or cap + lazy load.

## P1 — security

- [x] 5. **Mods are in-process RCE** — minimal slice shipped (Wave 2): boot logs the scanned `[mods] dir:` in both UIs; trust model documented in `01-context.md` + `10-mod-authoring.md`. Full allowlist/signature stays proposed.
- [ ] 6. **Tool path traversal** (proposed, ~1d): tools rely on session cwd + `~/` expansion; verify each of read/write/edit/bash/glob/grep constrains `resolve(cwd, input)` and rejects `..` escapes where intended. Fix: add `scripts/tool-path-test.ts` matrix.
- [ ] 7. **`openPath` can open anything** (proposed, ~0.5d): acceptable for a single-user app, but every invocation should be logged to the transparency log.
- [ ] 8. **Secrets handling** (proposed, ~0.5d): keys only via environment (`ANTHROPIC_API_KEY`, `MUSE_SPARK_*`); system-prompt and transparency `request` events carry full prompt+messages — verify `setConfig` never echoes keys to renderer logs and session files never capture env values. Existing coverage: `scripts/*-test.ts` do not assert this (gap).

## P1 — resilience

- [ ] 9. **Provider `unreachable` vs `unconfigured`** (proposed, ~0.5d, `src/providers/types.ts:22-29`): anthropic-kind assumes reachability (no list API); failures surface only at turn time. Fix: include provider id + setup hint in turn errors; mark status down for the session.
- [ ] 10. **Quest `:3060` assumed, no timeout** (proposed, ~0.5d): hardcoded default URL with no health check. Fix: connectivity probe + timeout + visible degraded badge.
- [ ] 11. **`MAX_STEPS=8` silent stop** (proposed, ~0.5d): loop exiting by step budget with pending tool calls looks like a normal answer. Fix: emit a `custom` warning transparency event when the budget (not the model) ends the turn.
- [ ] 12. **Hook isolation** (proposed, needs design): `emitHook` catches per-hook throws (good) but a slow synchronous hook blocks the whole turn. Fix: document hooks must be non-blocking; if async hooks are ever added, race them against a timeout (`Promise.race` — finish whichever comes first).

## P2 — test/observability gaps (existing suites: `scripts/smoke|providers-test|mods-test|mods-runtime-test|transparency-test|tool-test.ts`)

- [ ] 13. **Missing cases** (proposed): corrupt-config backup, corrupt-session quarantine, duplicate-provider-id, disabled-mod tool/call exclusion, `/cd` invalid dir, `openExternal` non-http rejection, transcript-ring overflow, multi-scope mod merge matrix.
- [ ] 14. **Structured turn IDs** (proposed): events correlate by per-call `callId` today; cross-turn forensics need a `turnId` stamped on every event in the turn.

## Quick wins (no design needed, good first tasks)

- [ ] Log `skipped` providers with reasons at Electron boot (TUI already does).
- [ ] Verify mod `failed` errors surface in the renderer mods panel (today only via `modsForScope` error string).
- [ ] Document that `getTranscript` (2000-event per-process memory ring) is not durable — the `<id>.events.jsonl` file is the source of truth (now stated in `04-runtime.md`).
