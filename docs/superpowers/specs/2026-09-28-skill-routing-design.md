# Skill routing & context minimalism (Track A) — design spec

- **Date:** 2026-09-28
- **Status:** drafted from red-teamed Section 1; awaiting review
- **Scope:** Forge repo (`src/agent/`, `src/mods/`, `src/sessions/`, transparency events) + Claude-side portable subset (plugin-forge PORT-12 + scaffold guidance in md-marketplace). No `plugin-dev` changes.
- **Intent:** cheapest possible context per turn, maximum precision, no agent-do-everything. Forge must beat Claude Code's skill mechanics, not mirror them.

## Background

Two grievances against Claude, checked against documented mechanics and measured:

1. **Startup index tax — myth in letter, confirmed in spirit.** Full skill bodies do not load at startup; descriptions do. Measured on this machine: 155 live skills (enabled plugins) × descriptions ≈ 47k chars ≈ **11.8k tokens per session** before anything is invoked, plus agent descriptions on top.
2. **Re-invocation duplication — backwards, with a real trap underneath.** Identical re-invocation does not duplicate (short "already loaded" note). Duplication happens **only when rendered content differs** (changed args, fresh `!`-command output) — so dynamic-context skills re-append in full on every call. Compaction additionally re-attaches recent skills (first 5k tokens each, 25k combined budget).

Forge today: mod skills are user-pinned per session via panel (`loadedSkills` in session meta), assembled into every turn (`prompt.ts:8-10`); registry already carries name+description (`registry.ts:156`); loop re-resolves per turn (`loop.ts:57`). No auto-routing, no lazy loading, no cost visibility. Forge skill count is a handful — it does **not** have Claude's 155-skill disease.

## Part 1 — Accounting requirements (build now)

1. **Price tags.** Per-skill size (bytes + ~tokens) computed at registration, shown in the skills panel. Near-zero cost (`du`-equivalent); doubles as the instrument every threshold below depends on.
2. **Load/unload transparency events.** Skill sections entering a turn's prompt emit an event on the existing transparency bus (load; unload where applicable). One emit at the prompt-assembly point.
3. **Inject-once dedupe.** Content-hash dedupe at prompt assembly: identical skill content is referenced, never re-appended, within a session. Dynamic (`!`-style, once Forge has it) sections refresh granularly — re-render the changed block only.
4. **Index guardrail.** Routing index (names + triggers + shortlisted descriptions) carries a hard budget ceiling; 11.8k is the cautionary tale (Claude-side figure), not a Forge measurement. Proposed ceiling: indexed metadata must stay under ~4k tokens by construction; enforced by keeping triggers one-line and descriptions shortlisted, not by counting at runtime (counting is the panel's job).

## Part 2 — Routing rule (deferred behind a numeric trigger)

A skill auto-loads for a turn when ALL hold: (1) triggerable (declares keyword triggers or description-matches the turn), (2) small enough that a wrong guess is cheap, where cheap is defined numerically against the panel price tag (proposed: under ~2k tokens — adjustable at plan time), (3) safe without confirmation. Panel pins override routing; everything else is automatic. Omission decisions (considered and rejected) are explicitly accepted as invisible for now — rejection logging was considered and rejected on log-spam cost; revisit if misfires are ever observed.

**Build trigger (red-team demand — deferral must not be vibes):** build Part 2 when live skill count exceeds 20 OR indexed descriptions exceed 4k tokens, first observed via Part 1 instrumentation. Proposed numbers; adjustable at plan time, but a number must exist before Part 2 starts.

**Considered alternative — isolated-context execution.** Run heavy skills in a separate context, return only the result (Claude's `context: fork` pattern). Beats both preload and lazy-load for large skills. Verdict: not built now (no heavy skills exist); re-evaluate alongside the Part 2 trigger. Recorded so the decision exists.

**Precedent tension (stated, not hidden):** auto-routing trades precision for convenience, in tension with the program goal. That tension is what justifies deferral — convenience machinery must prove it doesn't cost precision before it ships.

**Compliance obligation on the future plan:** "never front-load bodies" needs a turn-level assertion in prompt assembly tests (body absence pinned), or the rule is unenforced prose.

## Part 3 — Claude-side portable subset (proceeds independently)

Same wave-1 treatment in plugin-forge (md-marketplace): decision rule (preload only when hot + small + first-action-dependent), PORT-12 heuristic (`skills:` present + preloaded skill over ~16 KB → Note, never Blocker), scaffold/transform guidance prose. Proceeds regardless of Parts 1–2 because the 155-skill disease exists on Claude's side today.

## Out of scope

- `skills:` preload mechanics in Forge (Forge has no preload concept; its equivalent is session pinning, covered above).
- Rejection logging (rejected: log-spam cost).
- Description-tax track (Track B, separate spec).
- Upstream `plugin-dev`/`agent-creator` changes.

## Open items for plan time

- Exact trigger numbers (20 skills / 4k tokens / 2k-token "cheap") — proposed, confirm or adjust.
- Token counting method for price tags (chars÷4 used throughout this spec; consistent but crude — keep labeled as estimates).
