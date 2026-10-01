# PORT-13 description hygiene (Track B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag description-payload bloat in plugin-forge: a PORT-13 checklist item, updated range references, and scaffold/transform guidance — the wave-1/PORT-12 mirror for routing-index cost.

**Architecture:** Source-only prose change in `forge-src/` (checklist append, three range fixes, two guidance insertions) plus the mandatory version bump, rebuilt through the existing `build.ts` pipeline with its enforcement and sweep gate. No lib change: nothing new is rendered, only prose.

**Tech Stack:** TypeScript forge-src build (`npx tsx forge-src/build.ts plugin-forge`), `tsc`, `eslint`, `/plugin-forge:portability-sweep` (or the manual Detect-grep equivalent where the slash command is unavailable — precedent set in waves 0–1).

**Spec:** `docs/superpowers/specs/2026-09-28-description-hygiene-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- All edits in `forge-src/` under `<md-marketplace-root>/` — never hand-edit generated files under `plugins/`.
- Version bump in `forge-src/plugin-forge/plugin.ts` 0.5.2 → 0.5.3 is mandatory (build throws otherwise).
- `npx tsc --noEmit` and `npx eslint .` (from `forge-src/`) clean before trusting any build. (`npx eslint` may not resolve the hoisted root binary — use `../node_modules/.bin/eslint .`, same tool, established in wave 0.)
- Commit generated output only on explicit user confirmation.
- Frozen `evals/results/*` artifacts are history: never touch them, exclude them from range greps.

## Review Focus

- Stale `PORT-01..12` ranges hiding in evals/results history must stay untouched; a reasonable person expects history frozen — the range greps below exclude `evals/results` explicitly, and any hit there is a non-finding by rule.
- `plugins/stepstone-genie/` output must be byte-identical (no lib change at all this time); any diff there is a defect — pinned by the empty-diff assert in the rebuild task.
- The Detect counting commands must match the checklist text exactly; an executor running a different count than the check describes would enforce a different rule — pinned by running the plan's own greps verbatim, not paraphrases.
- Every component whose `version` defaults to the manifest must show 0.5.3 (`plugin.json`, `SKILL.md`, both command files); a missed propagation means the build didn't run clean — pinned by the version-grep assert in the rebuild task.
- The sweep-equivalent limitation (slash command unavailable outside Claude Code) must not silently become "no gate": the manual Detect-grep pass plus a standing recommendation to run the real sweep in Claude Code — stated in the rebuild task, not skipped.

---

### Task 1: PORT-13 checklist item + range fixes

**Files:**
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/portability-checks.source.md` (append after PORT-12 block)
- Modify: `.../agents/desktopPortabilityAuditor.body.md` (`PORT-01..12` → `PORT-01..13`)
- Modify: `.../commands/portabilitySweep.body.md` (same range fix)
- Modify: `.../skills/pluginForgeSkill.body.md` (same range fix)

**Interfaces:**
- Consumes: nothing (prose task; rendered via existing `checklist.ts` passthrough).
- Produces: PORT-13 source + corrected ranges consumed by the rebuild task.

- [ ] **Step 1: Confirm RED**

Run: `grep -c 'PORT-13' forge-src/plugin-forge/portability-checks.source.md`
Expected: `0`. Run: `grep -rEn 'PORT-01\.\.12' forge-src/plugin-forge/ --include='*.md' --include='*.ts'`
Expected: exactly three hits (auditor body, sweep body, skill body).

- [ ] **Step 2: Append PORT-13**

Append to `forge-src/plugin-forge/portability-checks.source.md` (blank-line separated, same Flags/Why/Detect/Fix/Fixable format):

```markdown
## PORT-13: Plugin description payload bloat

- **Flags:** A plugin whose skill/agent/command description-bearing files exceed ~40 files or ~8 KB (~2k tokens) total frontmatter description text — a routing index so large it taxes every session before anything is invoked.
- **Why:** Measured: this marketplace carries ~53k description chars ≈ 13k tokens; the top offender averages ~121 chars across 165 files. Session-start cost is count × payload, and trimming prose is low-yield once descriptions are already terse — the fix is consolidation or gating growth, decided by the owner.
- **Detect:** Per plugin, count description-bearing files and sum frontmatter description lengths across `skills/*/SKILL.md`, `agents/*.md`, and `commands/*.md`. Flag over ~40 files or ~8 KB total. Each hit is a candidate for human judgement under the rule below, not an automatic violation.
- **Fix:** Apply the hygiene rule — trigger essence first, filler never; consolidate overlapping skills rather than multiplying them; keep new plugins under the budgets above. Report as Note severity — a judgement call, never a Blocker.
- **Fixable:** no
```

- [ ] **Step 3: Fix the three range references**

Replace `PORT-01..12` with `PORT-01..13` in: `agents/desktopPortabilityAuditor.body.md`, `commands/portabilitySweep.body.md`, `skills/pluginForgeSkill.body.md` (one occurrence each; if any file has more than one, fix each and record it).

- [ ] **Step 4: Confirm GREEN and commit**

Run: `grep -c 'PORT-13' forge-src/plugin-forge/portability-checks.source.md`
Expected: `1`. Run: `grep -rEn 'PORT-01\.\.12' forge-src/plugin-forge/ --include='*.md' --include='*.ts'`
Expected: no output.

```bash
git add forge-src/plugin-forge/portability-checks.source.md forge-src/plugin-forge/agents/desktopPortabilityAuditor.body.md forge-src/plugin-forge/commands/portabilitySweep.body.md forge-src/plugin-forge/skills/pluginForgeSkill.body.md
git commit -m "feat: PORT-13 check for description payload bloat"
```

### Task 2: Scaffold/transform guidance prose

**Files:**
- Modify: `.../skills/pluginForgeSkill.body.md` (two insertions)

**Interfaces:**
- Consumes: the hygiene rule (restated inline).
- Produces: scaffold-time instructions consumed by the rebuild task.

- [ ] **Step 1: Insert the scaffold post-pass**

After the preload post-pass paragraph (ending `cost their full content on every spawn.`), insert a new paragraph:

```markdown
Apply the same review to description payload: count the new plugin's description-bearing files and sum their frontmatter descriptions — flag over ~40 files or ~8 KB total, and consolidate overlapping skills before multiplying them. Today's top offender averages ~121 chars across 165 files: length isn't the disease, count × payload is.
```

- [ ] **Step 2: Insert the transform carry rule**

After the preload carry bullet (ending `the Skill tool still covers occasional need).`), insert:

```markdown
    - Carry the description budget check: if the narrowed variant keeps the source's full skill surface, the payload travels with it — note the file count + total in the new plugin's README so growth stays visible.
```

- [ ] **Step 3: Commit**

```bash
git add forge-src/plugin-forge/skills/pluginForgeSkill.body.md
git commit -m "feat: description-budget guidance for scaffolded and transformed agents"
```

### Task 3: Bump, rebuild, verify, sweep, commit

**Files:**
- Modify: `.../plugin-forge/plugin.ts` (version 0.5.2 → 0.5.3)
- Generated (verify only): `plugins/plugin-forge/checklists/plugin-portability-CHECKS.md`, `skills/plugin-forge/SKILL.md`, both command files, `.claude-plugin/plugin.json` (+ forge-manifest hash if tracked)

**Interfaces:**
- Consumes: Tasks 1–2 source edits + bumped manifest.
- Produces: verified generated plugin + commit, consumed by Task 4's reinstall.

- [ ] **Step 1: Bump and rebuild**

In `forge-src/plugin-forge/plugin.ts`, change `version: "0.5.2"` to `version: "0.5.3"`. Then run: `npx tsx forge-src/build.ts plugin-forge` (from repo root)
Expected: success, all files written, no version-drift throw.

- [ ] **Step 2: Verify the exact diff**

Run: `git diff --stat -- plugins/plugin-forge/`
Expected set: `checklists/plugin-portability-CHECKS.md`, `skills/plugin-forge/SKILL.md`, `commands/portability-sweep.md`, `commands/package-for-desktop.md` (version-only), one auditor body (range line only — frontmatter untouched), `.claude-plugin/plugin.json`, forge-manifest hash if tracked. Assert `git diff --stat -- plugins/stepstone-genie/` is EMPTY.

Run: `grep -rEn 'PORT-01\.\.12' plugins/plugin-forge/ --include='*.md' --include='*.json' | grep -v 'evals/results'`
Expected: no output. Run: `grep -c 'PORT-13' plugins/plugin-forge/checklists/plugin-portability-CHECKS.md`
Expected: `1`. Run: `grep -rEno '[0-9]+\.[0-9]+\.[0-9]+' plugins/plugin-forge --include='*.json' | grep -v 'evals/results'`
Expected: every remaining hit reads `0.5.3` (plus forge-manifest internals if tracked — inspect, don't assume).

Self-application: run PORT-13's own Detect against `plugins/plugin-forge` (count description-bearing files, sum descriptions) and record the numbers — the plugin must pass its own new check.

- [ ] **Step 3: Sweep gate**

In a Claude Code session run `/plugin-forge:portability-sweep plugin-forge`; outside one, execute every PORT Detect step manually against `plugins/plugin-forge` (wave precedent) and recommend the real sweep in Claude Code. Fail-closed: any Blocker halts here.

- [ ] **Step 4: Obtain commit confirmation, then commit**

Ask the user for explicit confirmation, then:

```bash
git add plugins/plugin-forge/
git commit -m "feat: plugin-forge 0.5.3 — description hygiene (PORT-13)"
```

Rollback if wrong: `git revert` + rebuild + reinstall (bumps make bad builds sticky — wave-1 §5). Standing warning from waves 0–1: the auto-sync bot may sweep verified output first — accept its commit if content-verified, never duplicate.

### Task 4: Reinstall + smoke check

**Files:** none (environment operation).

**Interfaces:**
- Consumes: Task 3's committed, version-bumped plugin.
- Produces: refreshed install.

- [ ] **Step 1: Refresh the install**

Run:

```bash
claude plugin marketplace update md-marketplace
claude plugin install plugin-forge@md-marketplace
```

Expected: install succeeds; if scope:user loads in place (waves 0–1 precedent), run `claude plugin update plugin-forge@md-marketplace` to re-record 0.5.2 → 0.5.3 instead, and smoke-test the repo files.

- [ ] **Step 2: Smoke check**

Run: `grep -c 'PORT-13' <installed-or-repo-path>/checklists/plugin-portability-CHECKS.md`
Expected: `1`.
