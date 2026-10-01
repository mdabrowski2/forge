# PORT-12 preload discipline (Track A Part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag wasteful subagent skill preloads in plugin-forge: a PORT-12 checklist item, updated range references, and scaffold/transform guidance — the wave-1 mirror for the `skills:` field.

**Architecture:** Source-only prose change in `forge-src/` (checklist append, three range fixes, two guidance insertions) plus the mandatory version bump, rebuilt through the existing `build.ts` pipeline with its enforcement and sweep gate. No lib change: no generated agent preloads today, and the check audits `skills:` usage in others' agents.

**Tech Stack:** TypeScript forge-src build (`npx tsx forge-src/build.ts plugin-forge`), `tsc`, `eslint`, `/plugin-forge:portability-sweep` (or the manual Detect-grep equivalent where the slash command is unavailable — precedent set in wave 1).

**Spec:** `docs/superpowers/specs/2026-09-28-skill-routing-design.md` (Part 3 only; Parts 1–2 live in the sibling skill-accounting plan or behind the numeric trigger).

## Global Constraints

- All edits in `forge-src/` under `<md-marketplace-root>/` — never hand-edit generated files under `plugins/`.
- Version bump in `forge-src/plugin-forge/plugin.ts` 0.5.1 → 0.5.2 is mandatory (build throws otherwise).
- `npx tsc --noEmit` and `npx eslint .` (from `forge-src/`) clean before trusting any build. (`npx eslint` may not resolve the hoisted root binary — use `../node_modules/.bin/eslint .`, same tool, established in wave 1.)
- Commit generated output only on explicit user confirmation.
- Frozen `evals/results/*` artifacts are history: never touch them, exclude them from range greps.

## Review Focus

- Stale `PORT-01..11` ranges hiding in evals/results history must stay untouched; a reasonable person expects history frozen — the range greps below exclude `evals/results` explicitly, and any hit there is a non-finding by rule.
- `plugins/stepstone-genie/` output must be byte-identical (shared lib untouched this time — not even additive changes); any diff there is a defect — pinned by the empty-diff assert in the rebuild task.
- PORT-12's Detect grep is anchored (`^skills:`) unlike PORT-11's loose match; a frontmatter-anchored grep must not miss indented variants — YAML top-level fields are never indented, so the anchor is safe — pinned by the plan's own grep shape, no separate test needed beyond it.
- Every component whose `version` defaults to the manifest must show 0.5.2 (`plugin.json`, `SKILL.md`, both command files); a missed propagation means the build didn't run clean — pinned by the version-grep assert in the rebuild task.
- The sweep-equivalent limitation (slash command unavailable outside Claude Code) must not silently become "no gate": the manual Detect-grep pass plus a standing recommendation to run the real sweep in Claude Code — stated in the rebuild task, not skipped.

---

### Task 1: PORT-12 checklist item + range fixes

**Files:**
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/portability-checks.source.md` (append after PORT-11 block)
- Modify: `.../agents/desktopPortabilityAuditor.body.md` (`PORT-01..11` → `PORT-01..12`)
- Modify: `.../commands/portabilitySweep.body.md` (same range fix)
- Modify: `.../skills/pluginForgeSkill.body.md` (same range fix)

**Interfaces:**
- Consumes: nothing (prose task; rendered via existing `checklist.ts` passthrough).
- Produces: PORT-12 source + corrected ranges consumed by the rebuild task.

- [ ] **Step 1: Confirm RED**

Run: `grep -c 'PORT-12' forge-src/plugin-forge/portability-checks.source.md`
Expected: `0`. Run: `grep -rEn 'PORT-01\.\.11' forge-src/plugin-forge/ --include='*.md' --include='*.ts'`
Expected: exactly the three live files above (plus generated mirrors, untouched).

- [ ] **Step 2: Append PORT-12**

Append to `forge-src/plugin-forge/portability-checks.source.md` (blank-line separated, same Flags/Why/Detect/Fix/Fixable format):

```markdown
## PORT-12: Subagent preloads a skill it doesn't need hot

- **Flags:** An `agents/*.md` file with a `skills:` preload list naming a skill whose full content is large relative to how often the agent needs it — paying the whole body on every spawn instead of routing via descriptions and loading on demand.
- **Why:** Preloaded skills inject their FULL content at subagent startup (descriptions-only is the lazy default). Measured: `atlassian-toolkit` ≈ 148 KB (~37k tokens), `knowledge-keeper` ≈ 76 KB (~19k tokens) per spawn. Lazy invocation costs descriptions only (~1.5k chars capped in the listing), full content solely on invoking spawns, and persists across turns once loaded.
- **Detect:** List agents with a `skills:` field; for each named skill, size its skill directory. Flag preloads over ~16 KB (~4k tokens — set near the CLAUDE.md autoload payload wave 1 eliminated): `grep -l '^skills:' agents/*.md`, then `du` each named skill. Each hit is a candidate for human judgement under the rule below, not an automatic violation.
- **Fix:** Apply the decision rule — preload only when ALL hold: (1) needed on nearly every spawn, (2) small, (3) first-action dependence (task can't start correctly without it) or unreliable invocation routing. Otherwise grant the Skill tool and load on demand. Report as Note severity — a judgement call, never a Blocker.
- **Fixable:** no
```

- [ ] **Step 3: Fix the three range references**

Replace `PORT-01..11` with `PORT-01..12` in: `agents/desktopPortabilityAuditor.body.md`, `commands/portabilitySweep.body.md`, `skills/pluginForgeSkill.body.md` (one occurrence each; the edit tool must match uniquely — if any file has more than one, fix each and record it).

- [ ] **Step 4: Confirm GREEN and commit**

Run: `grep -c 'PORT-12' forge-src/plugin-forge/portability-checks.source.md`
Expected: `1`. Run: `grep -rEn 'PORT-01\.\.11' forge-src/plugin-forge/ --include='*.md' --include='*.ts'`
Expected: no output.

```bash
git add forge-src/plugin-forge/portability-checks.source.md forge-src/plugin-forge/agents/desktopPortabilityAuditor.body.md forge-src/plugin-forge/commands/portabilitySweep.body.md forge-src/plugin-forge/skills/pluginForgeSkill.body.md
git commit -m "feat: PORT-12 check for wasteful skill preloads in agents"
```

### Task 2: Scaffold/transform guidance prose

**Files:**
- Modify: `.../skills/pluginForgeSkill.body.md` (two insertions)

**Interfaces:**
- Consumes: the preload decision rule (restated inline).
- Produces: scaffold-time instructions consumed by the rebuild task.

- [ ] **Step 1: Insert the scaffold post-pass**

After the context-minimalism paragraph added in wave 1 (the `omitClaudeMd` post-pass after the `agent-creator` line), insert a new paragraph:

```markdown
Apply the same review to skill preloading: if `agent-creator` (or you, in transform mode) sets a `skills:` preload list, keep an entry only where ALL hold — (1) needed on nearly every spawn, (2) small, (3) first-action dependence or unreliable invocation routing. Otherwise leave the agent to invoke via the Skill tool on demand. Never preload a large reference skill: measured preloads (`atlassian-toolkit` ≈ 148 KB, `knowledge-keeper` ≈ 76 KB) cost their full content on every spawn.
```

- [ ] **Step 2: Insert the transform carry rule**

After the `omitClaudeMd` transform bullet added in wave 1 (the "Preserve the source's `omitClaudeMd` value..." bullet), insert:

```markdown
    - Preserve the source's `skills:` preload list if present; if the narrowed variant no longer needs a preloaded skill on nearly every spawn, drop that entry (narrowing toward a specialist is what moves an agent across the preload threshold — the Skill tool still covers occasional need).
```

- [ ] **Step 3: Commit**

```bash
git add forge-src/plugin-forge/skills/pluginForgeSkill.body.md
git commit -m "feat: preload-discipline guidance for scaffolded and transformed agents"
```

### Task 3: Bump, rebuild, verify, sweep, commit

**Files:**
- Modify: `.../plugin-forge/plugin.ts` (version 0.5.1 → 0.5.2)
- Generated (verify only): `plugins/plugin-forge/checklists/plugin-portability-CHECKS.md`, `skills/plugin-forge/SKILL.md`, both command files, `.claude-plugin/plugin.json` (+ forge-manifest hash if tracked)

**Interfaces:**
- Consumes: Tasks 1–2 source edits + bumped manifest.
- Produces: verified generated plugin + commit, consumed by Task 4's reinstall.

- [ ] **Step 1: Bump and rebuild**

In `forge-src/plugin-forge/plugin.ts`, change `version: "0.5.1"` to `version: "0.5.2"`. Then run: `npx tsx forge-src/build.ts plugin-forge` (from repo root)
Expected: success, all files written, no version-drift throw.

- [ ] **Step 2: Verify the exact diff**

Run: `git diff --stat -- plugins/plugin-forge/`
Expected set: `checklists/plugin-portability-CHECKS.md`, `skills/plugin-forge/SKILL.md`, `commands/portability-sweep.md`, `commands/package-for-desktop.md` (version-only), `.claude-plugin/plugin.json`, forge-manifest hash if tracked. Assert `git diff --stat -- plugins/plugin-forge/agents/` is EMPTY (no agent source changed this time) and `git diff --stat -- plugins/stepstone-genie/` is EMPTY.

Run: `grep -rEn 'PORT-01\.\.11' plugins/plugin-forge/ --include='*.md' --include='*.json' | grep -v 'evals/results'`
Expected: no output. Run: `grep -c 'PORT-12' plugins/plugin-forge/checklists/plugin-portability-CHECKS.md`
Expected: `1`. Run: `grep -rEno '[0-9]+\.[0-9]+\.[0-9]+' plugins/plugin-forge --include='*.json' | grep -v 'evals/results'`
Expected: every remaining hit reads `0.5.2` (plus forge-manifest internals if tracked — inspect, don't assume).

- [ ] **Step 3: Sweep gate**

In a Claude Code session run `/plugin-forge:portability-sweep plugin-forge`; outside one, execute every PORT Detect step manually against `plugins/plugin-forge` (wave-1 precedent) and recommend the real sweep in Claude Code. Fail-closed: any Blocker halts here.

- [ ] **Step 4: Obtain commit confirmation, then commit**

Ask the user for explicit confirmation, then:

```bash
git add plugins/plugin-forge/
git commit -m "feat: plugin-forge 0.5.2 — preload discipline (PORT-12)"
```

Rollback if wrong: `git revert` + rebuild + reinstall (bumps make bad builds sticky — wave-1 §5).

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

Expected: install succeeds; if scope:user loads in place (wave-1 precedent), run `claude plugin update plugin-forge@md-marketplace` to re-record 0.5.1 → 0.5.2 instead, and smoke-test the repo files.

- [ ] **Step 2: Smoke check**

Run: `grep -c 'PORT-12' <installed-or-repo-path>/checklists/plugin-portability-CHECKS.md`
Expected: `1`.
