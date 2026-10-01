# Agent context minimalism in plugin-forge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit `omitClaudeMd: true` on plugin-forge's two auditor agents, guide scaffolded agents through the same decision rule, and audit for it via a new PORT checklist item.

**Architecture:** Additive-only change to `forge-src/` typed source (one optional interface field, one render line, two flag assignments, prose appends), rebuilt through the existing `build.ts` pipeline with its version-bump enforcement and portability-sweep gate.

**Tech Stack:** TypeScript (`tsx`, `tsc`), eslint, `forge-src` build (`npx tsx forge-src/build.ts plugin-forge`), Claude Code `/plugin-forge:portability-sweep`.

**Spec:** `docs/superpowers/specs/2026-09-23-agent-context-minimalism-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- All edits in `forge-src/` under `<md-marketplace-root>/` — never hand-edit generated files under `plugins/`.
- Version bump in `forge-src/plugin-forge/plugin.ts` is mandatory with any content change (build throws otherwise).
- `npx tsc --noEmit` and `npx eslint .` (from `forge-src/`) must be clean before trusting any build.
- `omitClaudeMd` requires Claude Code 2.1.271+ and is silently ignored below that — emit unconditionally.
- Commit only on explicit user confirmation (plugin-forge's own step-9 convention applies to itself).
- Work from repo root `<md-marketplace-root>/` unless a step says otherwise.

## Review Focus

- An older Claude Code (<2.1.271) reading a generated agent with `omitClaudeMd: true` must behave exactly as before: field ignored, no error, no effect.
- `plugins/stepstone-genie/` output must be byte-identical after the shared-lib change; any diff there is a defect in this plan's blast-radius claim.
- The emitted frontmatter line must be bare `omitClaudeMd: true` (unquoted boolean), parseable as YAML boolean by Claude Code's loader.
- Every hardcoded `PORT-01..10`-style range string must be found and updated; a stale range silently shrinks the desktop auditor's cited checklist.
- A forgotten version bump must surface as the build's explicit throw, not a silent no-op install.

---

### Task 1: lib support — `AgentDef.omitClaudeMd` + render line

**Files:**
- Modify: `<md-marketplace-root>/forge-src/lib/types.ts` (add one field after line 16)
- Modify: `<md-marketplace-root>/forge-src/lib/build.ts` (add one entry in `renderAgent`, lines 43–49)

**Interfaces:**
- Consumes: nothing (foundation task; `renderFrontmatter` already skips `undefined` and renders booleans — verified at `build.ts:29`, `build.ts:32-33`).
- Produces: `AgentDef.omitClaudeMd?: boolean` consumed by Task 2.

- [ ] **Step 1: Add the field to `AgentDef`**

In `forge-src/lib/types.ts`, after line 16 (`tools?: string[];`), insert:

```typescript
  omitClaudeMd?: boolean;
```

- [ ] **Step 2: Render it in `renderAgent`**

In `forge-src/lib/build.ts`, inside the `renderFrontmatter([...])` call of `renderAgent` (after line 48, `["tools", agent.tools],`), insert:

```typescript
    ["omitClaudeMd", agent.omitClaudeMd],
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (from `forge-src/`)
Expected: clean, no output.

- [ ] **Step 4: Lint**

Run: `npx eslint .` (from `forge-src/`)
Expected: clean, no output.

- [ ] **Step 5: Commit**

```bash
git add forge-src/lib/types.ts forge-src/lib/build.ts
git commit -m "feat: support omitClaudeMd in agent frontmatter rendering"
```

(No version bump needed: no `AgentDef` sets the field yet, so rendered output is byte-identical and the content hash is unchanged.)

### Task 2: Auditor flags + version bump

**Files:**
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/agents/portabilityAuditor.ts` (line 13)
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/agents/desktopPortabilityAuditor.ts` (line 13)
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/plugin.ts` (line 5)

**Interfaces:**
- Consumes: `AgentDef.omitClaudeMd` from Task 1.
- Produces: two flagged agent defs + bumped manifest consumed by Task 5's rebuild.

- [ ] **Step 1: Flag the portability auditor**

In `forge-src/plugin-forge/agents/portabilityAuditor.ts`, after line 13 (`tools: ["Read", "Grep", "Glob", "Bash"],`), insert:

```typescript
  omitClaudeMd: true,
```

- [ ] **Step 2: Flag the desktop auditor**

In `forge-src/plugin-forge/agents/desktopPortabilityAuditor.ts`, after line 13 (`tools: ["Read", "Grep", "Glob", "Bash"],`), insert:

```typescript
  omitClaudeMd: true,
```

(Both classify "omit" under the spec's decision rule: restricted tools, external target, self-contained prompt.)

- [ ] **Step 3: Bump the version**

In `forge-src/plugin-forge/plugin.ts`, line 5, change:

```typescript
  version: "0.5.0",
```

to:

```typescript
  version: "0.5.1",
```

- [ ] **Step 4: Commit**

```bash
git add forge-src/plugin-forge/agents/portabilityAuditor.ts forge-src/plugin-forge/agents/desktopPortabilityAuditor.ts forge-src/plugin-forge/plugin.ts
git commit -m "feat: omitClaudeMd on portability auditors, bump to 0.5.1"
```

### Task 3: PORT-11 checklist item + range-string fix

**Files:**
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/portability-checks.source.md` (append after line 83)
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/agents/desktopPortabilityAuditor.body.md` (line 13)

**Interfaces:**
- Consumes: nothing new (prose task; rendered via existing `checklist.ts` passthrough).
- Produces: PORT-11 source + corrected range reference consumed by Task 5's rebuild.

- [ ] **Step 1: Append PORT-11 to the source checklist**

At the end of `forge-src/plugin-forge/portability-checks.source.md` (after line 83, `- **Fixable:** no`, with one blank line separator), append exactly:

```markdown
## PORT-11: Agent loads CLAUDE.md it doesn't need

- **Flags:** An `agents/*.md` file with a restricted `tools:` allowlist, no `omitClaudeMd: true` flag, and no dependence on the host project's conventions — an omit-candidate still paying the CLAUDE.md + git-status snapshot tax on every spawn.
- **Why:** Subagents load the user, project, and local CLAUDE.md files plus a git status snapshot by default. For a narrow specialist (restricted tools, external target, self-contained prompt) that payload — measured at ~17.8 KB / ~4.4k tokens per spawn for an auditor-class agent — is context it never reads. `omitClaudeMd: true` (requires Claude Code 2.1.271+, silently ignored below) removes it.
- **Detect:** List agents where `tools:` is present, `Write`/`Edit` are absent, and `omitClaudeMd` is absent: `grep -L 'omitClaudeMd' agents/*.md` intersected with files containing a `tools:` allowlist without Write/Edit. Each hit is a candidate for human judgement under the rule below, not an automatic violation.
- **Fix:** Apply the decision rule — omit when ALL hold: (1) restricted `tools` allowlist, (2) no dependence on the host project's conventions (file access governed by the agent's own embedded criteria still qualifies), (3) self-contained prompt. Otherwise keep CLAUDE.md. Add the flag where the agent classifies "omit." Report as Note severity — a judgement call, never a Blocker.
- **Fixable:** no
```

- [ ] **Step 2: Fix the stale range reference**

In `forge-src/plugin-forge/agents/desktopPortabilityAuditor.body.md`, line 13, change `checks PORT-01..10` to `checks PORT-01..11`.

- [ ] **Step 3: Hunt for other hardcoded ranges**

Run: `grep -rEn 'PORT-01\.\.10' forge-src/plugin-forge/`
Expected: no output (every stale range found and fixed in Step 2).

- [ ] **Step 4: Commit**

```bash
git add forge-src/plugin-forge/portability-checks.source.md forge-src/plugin-forge/agents/desktopPortabilityAuditor.body.md
git commit -m "feat: PORT-11 check for unneeded CLAUDE.md autoload in agents"
```

### Task 4: Scaffold-guidance prose in the skill body

**Files:**
- Modify: `<md-marketplace-root>/forge-src/plugin-forge/skills/pluginForgeSkill.body.md` (insert after line 82; insert after line 106)

**Interfaces:**
- Consumes: the decision rule (spec Section 1, restated inline — no import; prose file).
- Produces: scaffold-time instructions consumed by Task 5's rebuild.

- [ ] **Step 1: Insert the scaffold-from-scratch post-pass**

In `forge-src/plugin-forge/skills/pluginForgeSkill.body.md`, after line 82 (`` `agent-creator` for any new agent files. ``), insert a new paragraph:

```markdown
After `agent-creator` writes the agent files, apply the context-minimalism rule to each new agent: set `omitClaudeMd: true` where ALL hold — (1) a restricted `tools` allowlist, (2) no dependence on the host project's conventions, (3) a self-contained prompt. Keep CLAUDE.md where the agent reads/writes repo files needing conventions, has full/default tool access, or defers to project context. The field requires Claude Code 2.1.271+ and is silently ignored below that, so emit it unconditionally.
```

- [ ] **Step 2: Insert the transform-mode carry rule**

In the same file, after line 106 (`access). Omitting it on a strip archetype would silently do nothing.`), insert a new bullet:

```markdown
    - Preserve the source's `omitClaudeMd` value if present; if absent and the narrowed variant meets the context-minimalism rule above, add `omitClaudeMd: true`. Narrowing toward a specialist is what moves an agent across the rule's threshold.
```

- [ ] **Step 3: Commit**

```bash
git add forge-src/plugin-forge/skills/pluginForgeSkill.body.md
git commit -m "feat: context-minimalism guidance for scaffolded and transformed agents"
```

### Task 5: Rebuild, verify diff, sweep, commit generated output

**Files:**
- Generated (do not hand-edit, verify only): `plugins/plugin-forge/agents/plugin-portability-auditor.md`, `plugins/plugin-forge/agents/desktop-portability-auditor.md`, `plugins/plugin-forge/skills/plugin-forge/SKILL.md`, `plugins/plugin-forge/checklists/plugin-portability-CHECKS.md`, `plugins/plugin-forge/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: Tasks 1–4 source edits + bumped manifest.
- Produces: verified generated plugin + commit, consumed by Task 6's reinstall.

- [ ] **Step 1: Rebuild**

Run: `npx tsx forge-src/build.ts plugin-forge` (from repo root `<md-marketplace-root>/`)
Expected: success, no version-drift throw.

- [ ] **Step 2: Verify the exact diff**

Run: `git diff --stat plugins/plugin-forge/`
Expected file set (and nothing else): the two auditor `.md` files, `skills/plugin-forge/SKILL.md`, `checklists/plugin-portability-CHECKS.md`, `.claude-plugin/plugin.json` (plus the forge-manifest hash file if tracked).

Run: `git diff plugins/stepstone-genie/`
Expected: empty output (shared-lib change is output-neutral).

Run: `grep -c '^omitClaudeMd: true$' plugins/plugin-forge/agents/plugin-portability-auditor.md plugins/plugin-forge/agents/desktop-portability-auditor.md`
Expected: each file prints `1` (exactly one frontmatter line per file). This grep doubles as the pin for Review Focus lines 1 and 3: bare-boolean emission is the precondition for the documented ignore-on-old-versions behavior.

Run: `grep -rEn 'PORT-01\.\.10' plugins/plugin-forge/`
Expected: no output (pins Review Focus line 4).

- [ ] **Step 3: Run the portability sweep**

In a Claude Code session, run: `/plugin-forge:portability-sweep plugin-forge`
Expected: no Blocker-severity findings (the skill-body prose edit triggers the repo's own sweep rule; WARN findings are surfaced to the user with a proceed-or-fix choice).

- [ ] **Step 4: Obtain commit confirmation, then commit**

Ask the user for explicit confirmation (commit-on-confirmation convention). Then:

```bash
git add plugins/plugin-forge/
git commit -m "feat: plugin-forge 0.5.1 — agent context minimalism (omitClaudeMd, PORT-11)"
```

Rollback if the diff is wrong: `git revert` the source commits, rebuild, reinstall (the bump makes bad builds sticky in caches — Section 5 of the spec).

### Task 6: Reinstall + smoke check

**Files:** none (environment operation).

**Interfaces:**
- Consumes: Task 5's committed, version-bumped plugin.
- Produces: refreshed install (nothing further depends on it).

- [ ] **Step 1: Refresh the install**

Run:

```bash
claude plugin marketplace update md-marketplace
claude plugin install plugin-forge@md-marketplace
```

Expected: install succeeds (version change guarantees the cache refreshes rather than silently no-ops).

- [ ] **Step 2: Smoke check**

Run: `grep -n '^omitClaudeMd: true$' ~/.claude/plugins/cache/md-marketplace/plugin-forge/*/agents/plugin-portability-auditor.md`
Expected: exactly one hit (adjust the glob to the installed version directory if the cache layout differs; if the path doesn't resolve, locate the installed copy via `installed_plugins.json` and grep there instead).

