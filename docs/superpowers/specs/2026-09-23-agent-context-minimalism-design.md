# Agent context minimalism in plugin-forge — design spec

- **Date:** 2026-09-23
- **Status:** approved (all 5 sections), awaiting implementation plan
- **Scope:** `md-marketplace` repo, `plugin-forge` plugin via `forge-src/` typed source. No `plugin-dev` changes. No hand-edits to generated files.
- **Intent (carried from sponsor):** agents must cost as little context as possible and be as precise as possible — no agent-do-everything.

## Background

Sponsor hypothesis: a domain agent should be the sole entry point for its domain, the main session should hold no domain execution capability, and the agent itself should load only the context its task needs. A spike probe (2026-09-23) against the existing `bamboo-specialist` / `bitbucket-specialist` agents confirmed the shape and found the leak: `tools:` allowlists block capability, but **context still arrives through other doors** — CLAUDE.md + git-status autoload (default-on, removable via `omitClaudeMd`), hook-injected `additionalContext`, and the permanent description tax in the main session.

`omitClaudeMd` requires Claude Code **2.1.271+** and is silently ignored below that — safe to emit unconditionally (forward-compatible no-op). Author's machine at design time: 2.1.267.

## Section 1: The decision rule (approved)

`omitClaudeMd: true` when **ALL** hold:

1. **Bounded capability** — restricted `tools` allowlist, not full/default access.
2. **External target** — task hits an outside system or bounded operation; no reading/writing repo code in a convention-following way, no "follow project standards."
3. **Self-contained prompt** — binary paths, workflows, output format inline; nothing resolves via project context.

Keep CLAUDE.md when **ANY** hold: agent reads/writes repo files needing conventions; full/default tool access; prompt defers to project context.

Decidability check (run at design time): `bamboo-specialist`, `bitbucket-specialist`, `plugin-portability-auditor`, `desktop-portability-auditor` → omit; hypothetical repo-editing `code-reviewer` → keep. The middle (e.g. read-only log-triager vs. architecture researcher) is resolved by the rationale behind criterion 2 — *does it need conventions to do its job?* — and stays human judgement. Hence checklist severity Note, never Blocker.

## Section 2: Piece 1 — lib support + both auditors (approved)

Edits, all in `forge-src/`:

1. `lib/types.ts` — add `omitClaudeMd?: boolean;` to `AgentDef` (after `tools?`).
2. `lib/build.ts` — add `["omitClaudeMd", agent.omitClaudeMd]` to `renderAgent`'s frontmatter list. `undefined` is already skipped (as with optional `tools`/`model`), so existing defs render byte-identical output.
3. `plugin-forge/agents/portabilityAuditor.ts`, `desktopPortabilityAuditor.ts` — add `omitClaudeMd: true` (both classify "omit").
4. `plugin-forge/plugin.ts` — version bump (build throws on content-change-without-bump).

Blast radius: shared lib with `stepstone-genie`; purely additive-optional. Rebuild diff must show zero changes under `plugins/stepstone-genie/`.

## Section 3: Piece 2 — scaffold guidance (approved)

Prose instruction in `pluginForgeSkill.body.md` (plugin-forge never generates agents; `agent-creator` via `plugin-dev` does — no cross-repo change):

1. **Scaffold-from-scratch (§3):** after `agent-creator` writes agent files, apply the Section 1 rule to each; add `omitClaudeMd: true` where it classifies "omit."
2. **Transform mode (frontmatter rewrite):** preserve source's `omitClaudeMd` if present; if absent and the narrowed variant classifies "omit," add `true` (narrowing toward a specialist is what moves an agent across the threshold).

Both insertions embed the Section 1 rule (short form) + the 2.1.271+ floor note.

## Section 4: Piece 3 — PORT checklist item (approved)

Append **PORT-11** to `portability-checks.source.md` in the existing Flags/Why/Detect/Fix/Fixable format:

- **Flags:** `agents/*.md` with restricted `tools:` allowlist, no `omitClaudeMd`, no project-convention dependence — an omit-candidate still paying CLAUDE.md + git-snapshot tax per spawn.
- **Detect:** `tools:` present + `Write`/`Edit` absent + `omitClaudeMd` absent → candidate list for human judgement.
- **Fix:** apply Section 1 rule; add the flag where it classifies "omit."
- **Severity: Note. Fixable: no** (report-only agent).

Collateral: `desktopPortabilityAuditor.body.md` cites "checks PORT-01..10" — update the range (grep for other hardcoded ranges at implementation). No re-sweep needed for a checklist-doc-only diff per `forge-src/CLAUDE.md`.

## Section 5: Build, verify, commit (approved)

- Single version bump covering all three pieces.
- Verify: `npx tsc --noEmit` + `npx eslint .` (from `forge-src/`); `npx tsx forge-src/build.ts plugin-forge` (repo root); `git diff plugins/plugin-forge/` shows exactly the two frontmatters, skill-body prose, PORT-11, manifest version.
- `/plugin-forge:portability-sweep plugin-forge` before commit (the skill-body prose edit triggers the repo's own sweep rule).
- Reinstall via marketplace update + install; commit only on explicit confirmation.

## Out of scope

- `omitClaudeMd` on `~/.claude` `bamboo-specialist` / `bitbucket-specialist` (separate bounded task, on hold).
- Any `plugin-dev` / `agent-creator` change.
- Transform archetypes beyond Agent (v1 limitation stands).
- Changing the Note severity to Warning/Blocker (explicitly rejected: fail-closed on a judgement call is wrong).
