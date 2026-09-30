# Transparency split: session vs. system channels — design spec

- **Date:** 2026-09-30
- **Status:** drafted (Sections 1–3 approved); awaiting review
- **Scope:** Forge repo (Electron main, renderer panel, transparency pipeline, debug bundle). No provider/harness changes.
- **Intent:** system and modification noise leaves the session window permanently; session-scoped issues stay. No repetitive user-facing flooding, ever again.

## Background

Evidence (debug bundle 2026-09-30, session events + log tail): ~190 identical `pr-preview-error` notices persisted into ONE session file over ~15h from an unconditional 30s renderer poll with no backoff and no failure quieting. The two alternating `bb` commands (inbox vs. triage, first-rejection race) defeated `publishNotice` exact-match dedup, so nothing collapsed. Boot notices (mods.*, currentModel) re-emit every launch by design into the same feed. Sidebar PR polling was verified fixed (shell inheritance, `pr-preview-ok` count 10); the flood is a routing/persistence design defect, not a fetch defect. Single Forge process confirmed (PID 893) — no multi-writer confusion.

## Section 1: Scope rule + routing (approved, red-team amended)

No new taxonomy tables, no per-event scope flags. Rule: **no session sink = system channel**. Turn stream, tool calls, and session-sunk modifications stay; boot notices, integration poll results/errors, model notices, and turn-skills composition route system automatically. Mechanism: split the global `transcript` ring into session + system rings; add `forge:system-log` IPC channel and `forge:getSystemLog` replay endpoint beside `forge:getTranscript`. Poll errors leave the session file with zero special-casing; dedup keeps counting repeats in the system feed.

**Structural exception (red-team): the central handler needs a scope signal.** `main.ts` `onTransparency` appends everything it receives to the session file, so loop-flowing system events (turn-skills) would still land there. Fix: a `SYSTEM_SOURCES` set in `main.ts` (matched on event source/name, default session when unmatched — fail-safe direction, never hide turn events) consulted by the handler before appending. Tables live in one place, events stay clean.

**Mutation reclassification (red-team):** the five `traceMutation` sites do not blanket-stay. Session: skills-toggle (per-session `loadedSkills`), model switch (per-session restore). System: mods enable/settings, provider config (global changes wearing session sinks). `shell openPath`: system pending verification at plan time.

## Section 2: Persistence (approved)

- Session file (`<id>.events.jsonl`): session-channel only, format unchanged. Split enforced by withholding the session sink at system producers (PR/quest preview IPC handlers stop passing `{session}`).
- Global `forge.log`: unchanged audit trail (already receives everything).
- Rings: session + system, existing `capTranscript` reused for both. Boot code's `transcript.push` calls move to the system ring — a real edit at the boot site, same call pattern, different ring.
- Debug bundle: session-events section becomes session-scoped structurally; add a bounded system-log tail so evidence relocates instead of vanishing.
- Log growth (red-team): the alternating inbox/triage flap defeats dedup in `forge.log` too, not just the session file. Disposition: cite wave-4 rotation caps as the bound — plan time must confirm they cover this rate; if not, normalize the flap instead.
- Migration audit (plan Task 1): enumerate every `appendEvent` / `pushToUI` / `publishNotice`-with-sinks call site (`appendEvent` ×2 sites, `pushToUI` ×7 uses, `traceMutation` ×5 — counted 2026-09-30), classify session vs. system per the table above. No silent re-routing.

## Section 3: Panel surface + widget behavior (approved)

- Electron side panel mirroring the skills-panel pattern (toggle + list + replay on open). No new window lifecycle.
- Poll widgets: transient "unavailable — retrying" + last-good data with stale marker on failure; errors never persist, never enter the session feed. Last-good + stale flag live in renderer memory (lost on reload — accepted; reload re-fetches fresh).
- Boot notices render in the system panel via replay; no special boot path beyond the ring-target edit above.
- TUI unchanged (no new surface) — explicit asymmetry, not an accident.
- Debug bundle gains the bounded system tail under existing redaction rules.

## Out of scope

- TUI system surface (future track if needed).
- Cleaning already-polluted session history (stays as-is; the split prevents recurrence).
- Changing `publishNotice` dedup semantics (exact-match stays; the flood is fixed by routing, not by smarter collapsing).
- Polling cadence changes beyond failure quieting (30s interval untouched).
- Rejected alternative, recorded: bounded fix (quiet background failures + backoff, no new channel) — loses on explicit direction toward a separate window, not on merit. If the split ever stalls, this is the fallback.

## Acceptance (red-team)

Soak test, written at plan time: after N failing poll cycles, the session events file contains zero `integrations`/`boot` sources. That test is this spec's success criterion.

## Open items for plan time

- System-tail bound N for the bundle; ring caps for the new system ring (mirror existing or separate value).
- Exact panel element IDs/classes following the skills-panel convention in `public/`.
