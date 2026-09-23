# Agent context minimalism in plugin-forge — design spec

- **Date:** 2026-09-23
- **Status:** approved (all 5 sections) + red-teamed; amendments folded; ready for implementation plan
- **Scope:** `md-marketplace` repo, `plugin-forge` plugin via `forge-src/` typed source. No `plugin-dev` changes. No hand-edits to generated files.
- **Intent (carried from sponsor):** agents must cost as little context as possible and be as precise as possible — no agent-do-everything.

## Background

Sponsor hypothesis: a domain agent should be the sole entry point for its domain, the main session should hold no domain execution capability, and the agent itself should load only the context its task needs. A spike probe (2026-09-23) against the existing `bamboo-specialist` / `bitbucket-specialist` agents confirmed the shape and found the leak: `tools:` allowlists block capability, but **context still arrives through other doors** — CLAUDE.md + git-status autoload (default-on, removable via `omitClaudeMd`), hook-injected `additionalContext`, and the permanent description tax in the main session.

**Measured, not asserted (red-team finding 1, closed):** per-spawn injected payload for an auditor-class agent in md-marketplace is ~17.8 KB ≈ 4.4k tokens (user CLAUDE.md 5,383 B + project CLAUDE.md 12,406 B + git snapshot; clean tree — dirty trees cost more). The auditor's own definition is ~5 KB: autoload injects ~3.5× the agent's own prompt in context it never reads. Caveat: varies by project; criterion 3 below is what makes the waste pure regardless of size.

`omitClaudeMd` requires Claude Code **2.1.271+** and is silently ignored below that — safe to emit unconditionally (forward-compatible no-op). Author's machine at design time: 2.1.267.

## Section 1: The decision rule (approved)

`omitClaudeMd: true` when **ALL** hold:

1. **Bounded capability** — restricted `tools` allowlist, not full/default access.
2. **No host-convention dependence** — the task does not depend on the host project's conventions. File access governed by the agent's own embedded criteria (e.g. auditing *other* plugins against a bundled checklist) still qualifies; following repo standards does not.
3. **Self-contained prompt** — binary paths, workflows, output format inline; nothing resolves via project context.

Keep CLAUDE.md when **ANY** hold: agent reads/writes repo files needing conventions; full/default tool access; prompt defers to project context.

**Decidability (red-teamed):** author-applied trial, n=4 (`bamboo-specialist`, `bitbucket-specialist`, both portability auditors → omit; hypothetical repo-editing `code-reviewer` → keep). The real measurement is the PORT-11 pilot run over md-marketplace's existing agents with recorded agreement rate. The middle (read-only log-triager vs. architecture researcher) stays human judgement — hence Note severity, never Blocker.

**Deliberate (red-team):** the single counterfactual — *"would this agent's output change if CLAUDE.md were empty?"* — was considered and dismissed: it measures the thing directly but needs a test run per agent, while the rule is static and author-time-checkable.

## Section 2: Piece 1 — lib support + both auditors (approved)

Edits, all in `forge-src/`:

1. `lib/types.ts` — add `omitClaudeMd?: boolean;` to `AgentDef` (after `tools?`).
2. `lib/build.ts` — add `["omitClaudeMd", agent.omitClaudeMd]` to `renderAgent`'s frontmatter list.
3. `plugin-forge/agents/portabilityAuditor.ts`, `desktopPortabilityAuditor.ts` — add `omitClaudeMd: true` (both classify "omit").
4. `plugin-forge/plugin.ts` — version bump (build throws on content-change-without-bump).

**Verified, not asserted (red-team finding 2, closed):** `renderFrontmatter` skips `undefined` (`lib/build.ts:29`), renders booleans natively (lines 32–33), and `FrontmatterValue` already includes `boolean | undefined` (line 24). The lib change is type + one field entry; existing defs render byte-identical output.

Blast radius: shared lib with `stepstone-genie`; purely additive-optional. Rebuild diff must show zero changes under `plugins/stepstone-genie/`.

## Section 3: Piece 2 — scaffold guidance (approved)

Prose instruction in `pluginForgeSkill.body.md` (plugin-forge never generates agents; `agent-creator` via `plugin-dev` does — no cross-repo change):

1. **Scaffold-from-scratch (§3):** after `agent-creator` writes agent files, apply the Section 1 rule to each; add `omitClaudeMd: true` where it classifies "omit."
2. **Transform mode (frontmatter rewrite):** preserve source's `omitClaudeMd` if present (currently unexercisable — the field exists nowhere yet); if absent and the narrowed variant classifies "omit," add `true` (narrowing toward a specialist is what moves an agent across the threshold).

Both insertions embed the Section 1 rule (short form) + the 2.1.271+ floor note.

**Dependency (red-team):** if PORT-11 (§4) is ever dropped, this piece becomes unenforced prose. The skill-body instruction has no mechanical check of its own; the audit loop is what closes it.

**Deliberate (red-team):** putting the rule in `plugin-dev`/`agent-creator` instead was considered and rejected: cross-repo dependency, slower, outside our control. Revisit if upstream ever accepts it (would cover non-forge users too).

## Section 4: Piece 3 — PORT checklist item (approved)

Append **PORT-11** to `portability-checks.source.md` in the existing Flags/Why/Detect/Fix/Fixable format:

- **Flags:** `agents/*.md` with restricted `tools:` allowlist, no `omitClaudeMd`, no host-convention dependence — an omit-candidate still paying CLAUDE.md + git-snapshot tax per spawn.
- **Detect:** `tools:` present + `Write`/`Edit` absent + `omitClaudeMd` absent → candidate list for human judgement.
- **Fix:** apply Section 1 rule; add the flag where it classifies "omit."
- **Severity: Note. Fixable: no** (report-only agent). Escalation to Warning/Blocker explicitly rejected: fail-closed on a judgement call is wrong.

Collateral: `desktopPortabilityAuditor.body.md` cites "checks PORT-01..10" — update the range (grep for other hardcoded ranges at implementation). No re-sweep needed for a checklist-doc-only diff per `forge-src/CLAUDE.md`.

## Section 5: Build, verify, commit (approved)

- Single version bump covering all three pieces.
- Verify: `npx tsc --noEmit` + `npx eslint .` (from `forge-src/`); `npx tsx forge-src/build.ts plugin-forge` (repo root); `git diff plugins/plugin-forge/` shows exactly the two frontmatters, skill-body prose, PORT-11, manifest version.
- `/plugin-forge:portability-sweep plugin-forge` before commit (the skill-body prose edit triggers the repo's own sweep rule).
- **Rollback (red-team):** `git revert` + rebuild + reinstall. Required explicitly because the version bump makes a bad build sticky in install caches — revert without reinstall leaves the bad version live.
- Reinstall via marketplace update + install; commit only on explicit confirmation.

## Out of scope

- `omitClaudeMd` on `~/.claude` `bamboo-specialist` / `bitbucket-specialist` (separate bounded task, on hold).
- Any `plugin-dev` / `agent-creator` change.
- Transform archetypes beyond Agent (v1 limitation stands).
- **Deliberate (red-team):** no drift handling for `omitClaudeMd` being renamed/deprecated upstream. Accepted gap, recorded here.
- Follow-ups for separate specs (red-team findings 3–4, recorded so not lost): `skills:` preload discipline (same leak class as autoload); main-session description tax vs. the 15k-token startup warning.
