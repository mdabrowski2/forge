# Notice-repeat throttle Implementation Plan

> Status: proposed. Intent: "badge polling must not bury real traces."

## Context

Headed run 2026-09-23: Quest/PR badge polls emit an identical notice per
refresh (~10 stacked cards in one screenshot). Mechanism (publishNotice) has
no dedup; every poll lands in feed + transcript + `forge.log`.

## Decision (locked in this plan — red-team the shape, not the existence)

Producer-side dedup in `publishNotice`, keyed `(source, name)` on canonical
(sorted-keys) `data`-only comparison — never the envelope (timestamps would
make equality impossible):
- First emit per key passes through.
- Repeat is **swallowed, counted**.
- The next *changed* emit injects namespaced `_suppressedRepeats: N`
  (reserved `_` prefix; plain objects only) — honest count, never silent.
- Bypass (failures must flood): explicit opt-out `dedup: false` in sinks;
  `-error` names and `{ok:false}` data are backstops.
- State lives in module memory (two Maps); restart resets (one repeat card
  per launch max — accepted, stated).

Rejected alternative: renderer-side collapse (log + transcript keep
flooding; fixes the screenshot, not the record).

## Change (one file + proof)

- Modify: `src/transparency/notice.ts` — dedup map + bypass rule + count
  injection in `publishNotice`. No signature change (all producers untouched).
- Create: `scripts/observability-throttle-test.ts` — RED-first behavioral
  proof driving real `publishNotice`: same ×3 → one delivery; changed fourth
  carries `_suppressedRepeats: 2`; error-name and `dedup:false` repeats always
  delivered; distinct keys independent. Isolated HOME (logEvent writes real path).
- Docs: `docs/arch/04-runtime.md` one-liner (dedup rule + restart reset).

## Gate

- Proof green, `tsc` clean, existing observability proofs re-run (fan-out
  behavior change — all must stay green), commit
  (`feat: throttle repeat integration notices with suppressed counts`).
- Headed residual: watch badge polls produce one card + suppressed count on
  next change (user, 2 min).

## Explicit non-goals

No per-source tuning knobs, no time-window expiry (change-driven only),
no transcript/log backfill of already-flooded history.
