# Description hygiene (Track B) — design spec

- **Date:** 2026-09-28
- **Status:** drafted from Track B spike; awaiting review
- **Scope:** plugin-forge checklist + authoring guidance (md-marketplace). No trim task, no consolidation crusade, no Forge behavior change.
- **Intent:** catch the next `stepstone-mastery` at authoring time instead of measuring it afterward.

## Background

Track B spike measured md-marketplace at ~53k description chars ≈ 13k tokens across 339 skill/agent/command files — matching the live-session figure (~12k). Shape: concentrated (top 3 plugins ≈ 63%) but thin (top offender averages ~121 chars × 165 files). Conclusion, recorded: per-item trimming is low-yield; consolidation is the owners' design call, not ours. This spec builds only the forward-looking guardrail. Forge side stays dormant (empty registry; index-budget test already shipped in the accounting plan).

## Section 1: The rule (approved shape, thresholds proposed)

Flag a plugin when EITHER holds:

1. **Count:** more than ~40 skill/agent/command description-bearing files, OR
2. **Payload:** total description chars over ~8 KB (~2k tokens).

Rationale: `stepstone-mastery` (165 files / ~20k chars) trips both; `engineering-ops` (55 / ~8k) trips both at the boundary — which is correct, it is the second-largest contributor; typical plugins (≤10 files, ≤2k chars) pass with wide margin. Thresholds proposed, adjustable at plan time — but a number must exist (red-team lesson from Track A: numeric tripwires, not vibes).

Severity: Note, never Blocker — count and payload are proxies for routability judgment, and a 41-file plugin of crisp triggers is fine. Human confirms.

Authoring guidance (same rule, prescriptive form): trigger essence first, filler never; aggregate budgets above are the backstop, not per-description limits (no per-description hard cap — ungrounded by the data, which shows length isn't the problem).

## Section 2: Where it lands

1. **PORT-13** in `portability-checks.source.md` (Flags/Why/Detect/Fix/Fixable, same format): Detect counts description-bearing files and sums frontmatter description lengths per plugin (`grep` + `awk`-level, no new tooling); Fix points at the guidance and consolidation as the owner's call.
2. **Scaffold guidance** in `pluginForgeSkill.body.md`: one paragraph — the budgets plus "consolidate before you multiply" for new plugins with large surfaces.
3. Range references `PORT-01..12` → `..13` wherever hardcoded (same hunt procedure as waves 0–1).
4. Version bump per the sticky-build rule; rebuild; exact-diff verify; sweep gate; commit on confirmation; reinstall + smoke. Standard wave mechanics, no changes.

## Out of scope

- Trimming existing descriptions (spike verdict: low yield).
- Consolidating `stepstone-mastery` or any other plugin (owners' design call).
- Forge behavior (dormant guardrail already shipped).
- Per-description hard caps (would punish the wrong thing — length isn't the disease, count × payload is).
- `plugin-dev` / `agent-creator` changes.

## Open items for plan time

- Exact thresholds (40 files / 8 KB proposed — confirm or adjust against false-positive tolerance).
