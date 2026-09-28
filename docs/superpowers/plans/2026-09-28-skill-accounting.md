# Skill accounting (Forge-native, Track A Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skill context costs visible and non-duplicating in Forge: panel price tags, per-turn skill-set transparency events, inject-once prompt assembly.

**Architecture:** Additive-only changes at existing seams — registry metadata, one `publishNotice` call reusing its built-in repeat-dedup, prompt-assembly assertions, Electron panel badge. No new containers, no routing engine (Part 2, gated).

**Tech Stack:** TypeScript (bun runtime), existing `publishNotice` fan-out (`src/transparency/notice.ts`), Electron IPC `forge:skills` (passthrough spread), verification scripts run with `bun scripts/<name>-test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-28-skill-routing-design.md` (Part 1 only; Part 2 explicitly deferred, Part 3 lives in the sibling PORT-12 plan).

## Global Constraints

- Work in `/Users/dabrom01/Projects/forge`; run scripts from the repo root with `bun`; typecheck with `bun run typecheck` (`tsc --noEmit`).
- Test scripts assert with `node:assert` (throw on failure, non-zero exit) — stronger than the `console.log`-boolean convention in `scripts/mods-test.ts`, stated deliberately.
- Test side effects are limited to `~/.forge` (session meta files, cleaned up like `mods-test.ts` does; `forge.log` appends are harmless and not cleaned).
- `estTokens = Math.ceil(bytes / 4)`, always labeled an estimate everywhere it surfaces (`~{n}t`, byte-exact title).
- Version bump `package.json` 0.5.1 → 0.6.0 (`feat:` → minor per repo rule).
- Update the `getSystemPrompt()` bullet in `docs/arch/03-components.md` (line 39) in the same change (repo maintenance rule).
- No ADR: not structural (no new container, scope, or trust decision).
- TUI has no skills panel — Electron panel only.
- Commit per task; frequent commits.

## Review Focus

- A disabled mod's skill must never appear in `getAllSkills`, `getLoadedSkillMeta`, or the prompt; a reasonable person toggling a mod off expects its context gone too — pinned by the disabled-skill asserts in the Task 1 and 2 test sections.
- A fresh process with no active session must yield empty skill meta and no skill block, not a crash on missing session — pinned by the first asserts in the Task 1 test section (order matters: run before any `setActiveSession`).
- The turn-skills event must carry names and sizes only, never skill content; content in the event log would duplicate the prompt payload into persisted history — pinned by the data-keys assert in the Task 1 test section.
- The panel badge must read as an estimate and never crash on a missing field; there is no DOM harness in this repo so `app.js`/`style.css` are verified by read-review plus an optional manual Electron smoke, with the `?? "?"` fallback as the crash guard — accepted explicitly, not silently.
- Skill names that look sensitive must survive event redaction; `notice.ts` redacts keys token-wise but passes string values through, so a skill named `token-vault` must round-trip intact — pinned by the redaction asserts in the Task 3 test section.

---

### Task 1: Registry skill metadata

**Files:**
- Modify: `src/mods/registry.ts:156-160` (`getAllSkills` return shape)
- Modify: `src/mods/registry.ts` (new `getLoadedSkillMeta` after `getLoadedSkillSections`, ~line 171)
- Create: `scripts/skills-accounting-test.ts` (test section 1)

**Interfaces:**
- Consumes: `ModSkill.content` (existing), `loadSessionMeta().loadedSkills` (existing).
- Produces: `getAllSkills(): { name, description, modName, bytes, estTokens }[]` consumed by Task 4 (Electron IPC spreads it untouched at `electron/main.ts:320`); `getLoadedSkillMeta(): { name, bytes, estTokens }[]` consumed by Task 3.

- [ ] **Step 1: Extend `getAllSkills`**

Replace lines 156–160 of `src/mods/registry.ts`:

```typescript
getAllSkills(): { name: string; description: string; modName: string; bytes: number; estTokens: number }[] {
  return [...this.skills.values()]
    .filter(({ modName }) => this.isModEnabled(modName))
    .map(({ modName, skill }) => ({
      name: skill.name,
      description: skill.description,
      modName,
      bytes: skill.content.length,
      estTokens: Math.ceil(skill.content.length / 4),
    }))
}
```

- [ ] **Step 2: Add `getLoadedSkillMeta`**

After `getLoadedSkillSections` (ends line 171), insert:

```typescript
/** names + sizes of skills loaded for the active session — feeds the
 * turn-skills transparency event and any future routing decisions */
getLoadedSkillMeta(): { name: string; bytes: number; estTokens: number }[] {
  if (!this.activeSession) return []
  const loaded = new Set(loadSessionMeta(this.activeSession.id).loadedSkills ?? [])
  if (!loaded.size) return []
  return [...this.skills.values()]
    .filter(({ modName, skill }) => loaded.has(skill.name) && this.isModEnabled(modName))
    .map(({ skill }) => ({ name: skill.name, bytes: skill.content.length, estTokens: Math.ceil(skill.content.length / 4) }))
}
```

- [ ] **Step 3: Write test section 1 (fails first)**

Create `scripts/skills-accounting-test.ts`:

```typescript
// skill accounting verification — run from the forge project root:
// bun scripts/skills-accounting-test.ts (throws on first failure)
import { strict as assert } from "node:assert"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir, homedir } from "os"
import { registry } from "../src/mods/registry"
import { saveSessionMeta } from "../src/sessions/store"
import { defaultConfig } from "../src/config"

// fresh process: no active session -> empty meta, no crash
assert.deepStrictEqual(registry.getLoadedSkillMeta(), [])

registry.reset()
registry.registerSkill("m", { name: "s1", description: "d1", content: "x".repeat(100) })
registry.registerSkill("m", { name: "s2", description: "d2", content: "y".repeat(7) })
registry.registerSkill("off-mod", { name: "s3", description: "d3", content: "z".repeat(50) })
registry.setGlobalConfig({ ...defaultConfig(), mods: { "off-mod": { enabled: false } } })
// disabled mod: excluded everywhere, even when pinned in loadedSkills
assert.ok(!registry.getAllSkills().some((s) => s.name === "s3"))
const all = registry.getAllSkills()
assert.strictEqual(all.find((s) => s.name === "s1")?.bytes, 100)
assert.strictEqual(all.find((s) => s.name === "s1")?.estTokens, 25)
assert.strictEqual(all.find((s) => s.name === "s2")?.estTokens, 2) // ceil(7/4)

// event data shape: names + sizes only, never content
const sid = "skills-accounting-test"
registry.setActiveSession({ id: sid, cwd: "/tmp" })
saveSessionMeta(sid, { loadedSkills: ["s1", "s3"] })
const meta = registry.getLoadedSkillMeta()
assert.deepStrictEqual(meta, [{ name: "s1", bytes: 100, estTokens: 25 }])
for (const m of meta) assert.deepStrictEqual(Object.keys(m).sort(), ["bytes", "estTokens", "name"])
// index guardrail: registered descriptions stay under budget by construction
const all2 = registry.getAllSkills()
const indexChars = all2.reduce((n, s) => n + s.name.length + s.description.length, 0)
assert.ok(indexChars < 16384, `skill index budget exceeded: ${indexChars} chars`)
for (const s of all2) assert.strictEqual(typeof s.estTokens, "number")
const metaFile = join(homedir(), ".forge", "sessions", `${sid}.meta.json`)
if (existsSync(metaFile)) rmSync(metaFile)
registry.reset()
console.log("section 1 green")
```

Run: `bun scripts/skills-accounting-test.ts`
Expected: FAIL on `getAllSkills` shape (no `bytes` yet) — red must come from the new fields, not a typo (error names `bytes`/`estTokens`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun scripts/skills-accounting-test.ts`
Expected: prints `section 1 green`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/mods/registry.ts scripts/skills-accounting-test.ts
git commit -m "feat: skill size metadata in registry (price-tag data)"
```

### Task 2: Prompt assembly assertions (inject-once net)

**Files:**
- Modify: `scripts/skills-accounting-test.ts` (append test section 2; no production change — assembly is already unique-by-Map, this task pins it)

**Interfaces:**
- Consumes: `getSystemPrompt()` (existing), `getLoadedSkillSections()` (existing).
- Produces: regression net consumed by Task 5's suite run.

- [ ] **Step 1: Append test section 2 (fails first)**

Append to `scripts/skills-accounting-test.ts` (before the final `console.log`, restructure: sections run in order; section 2 re-registers its own skills after a `reset()`):

```typescript
// section 2: inject-once — each loaded skill exactly once, unloaded absent
registry.reset()
registry.registerSkill("m", { name: "a", description: "da", content: "ALPHA-CONTENT" })
registry.registerSkill("m", { name: "b", description: "db", content: "BETA-CONTENT" })
import { getSystemPrompt } from "../src/agent/prompt"
const sid2 = "skills-injectonce-test"
registry.setActiveSession({ id: sid2, cwd: "/tmp" })
saveSessionMeta(sid2, { loadedSkills: ["a"] })
const prompt = getSystemPrompt()
const count = (s: string, sub: string) => s.split(sub).length - 1
assert.strictEqual(count(prompt, "ALPHA-CONTENT"), 1)
assert.strictEqual(count(prompt, "BETA-CONTENT"), 0)
const metaFile2 = join(homedir(), ".forge", "sessions", `${sid2}.meta.json`)
if (existsSync(metaFile2)) rmSync(metaFile2)
registry.reset()
console.log("section 2 green")
```

Run: `bun scripts/skills-accounting-test.ts`
Expected: FAIL — `getSystemPrompt` is imported mid-file after use in section 1? No: imports hoist in ESM/bun, so no failure there. The honest RED: this section passes already (assembly is correct today) — record that: RED step is the *absence* of the pin (no test existed); GREEN is the pin holding. Ledger the distinction explicitly (no fake failure manufactured).

- [ ] **Step 2: Run test to verify it passes**

Run: `bun scripts/skills-accounting-test.ts`
Expected: prints `section 1 green` then `section 2 green`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/skills-accounting-test.ts
git commit -m "test: pin inject-once skill assembly (loaded once, unloaded absent)"
```

### Task 3: Turn-skills transparency event

**Files:**
- Modify: `src/agent/loop.ts` (import `publishNotice`; emit after line 58)
- Modify: `scripts/skills-accounting-test.ts` (append test section 3)

**Interfaces:**
- Consumes: `getLoadedSkillMeta()` from Task 1; `publishNotice` (existing, with repeat-dedup).
- Produces: per-turn skill-set events on the transparency channel.

- [ ] **Step 1: Write test section 3 (fails first)**

Append suppression-behavior test using a unique source so module-global dedup state can't collide:

```typescript
// section 3: repeat-dedup on the event channel itself
import { publishNotice } from "../src/transparency/notice"
const e1 = publishNotice("skills-selftest", "t", { v: 1 })
const e2 = publishNotice("skills-selftest", "t", { v: 1 })
assert.ok(!("data" in e2 && e2.data !== null && typeof e2.data === "object" && "_suppressedRepeats" in (e2.data as Record<string, unknown>)))
const e3 = publishNotice("skills-selftest", "t", { v: 2 })
assert.strictEqual((e3.data as Record<string, unknown>)._suppressedRepeats, 1)
// redaction survival: skill names are values, never redacted (notice.ts redacts keys only)
registry.reset()
registry.registerSkill("m", { name: "token-vault", description: "d", content: "c" })
const sid3 = "skills-redaction-test"
registry.setActiveSession({ id: sid3, cwd: "/tmp" })
saveSessionMeta(sid3, { loadedSkills: ["token-vault"] })
const ev4 = publishNotice("skills-selftest-2", "t", { skills: registry.getLoadedSkillMeta() })
assert.strictEqual((ev4.data as { skills: { name: string }[] }).skills[0].name, "token-vault")
const metaFile3 = join(homedir(), ".forge", "sessions", `${sid3}.meta.json`)
if (existsSync(metaFile3)) rmSync(metaFile3)
registry.reset()
console.log("section 3 green")
```

Run: `bun scripts/skills-accounting-test.ts`
Expected: FAIL — `publishNotice` imported but the loop never emits skill events yet? No: this section tests existing machinery and passes already. Same honest-RED treatment as Task 2: the RED is the missing pin; the behavioral assertion that will fail-meaningfully is the loop wiring, verified by reading the emit in the next step plus the shape test from Task 1. Ledger the distinction.

- [ ] **Step 2: Wire the emit into the turn**

In `src/agent/loop.ts`, add the import after line 7 (`import type { TransparencyEvent } from "../transparency/types"`):

```typescript
import { publishNotice } from "../transparency/notice"
```

After line 58 (`const system = getSystemPrompt()`), insert:

```typescript
const turnSkills = registry.getLoadedSkillMeta()
if (turnSkills.length) publishNotice("skills", "turn-skills", { skills: turnSkills }, { push: opts.onTransparency })
```

(`push` mirrors the loop's existing live-delivery path; dedup swallows identical consecutive turn sets and counts them; cross-session count conflation is cosmetic-only, accepted in Review Focus.)

- [ ] **Step 3: Run test to verify it passes**

Run: `bun scripts/skills-accounting-test.ts`
Expected: prints all three `green` lines, exit 0. (Appends three lines to `~/.forge/logs/forge.log` via `logEvent` — same class as the script's session-meta writes; harmless, not cleaned.)

- [ ] **Step 4: Commit**

```bash
git add src/agent/loop.ts scripts/skills-accounting-test.ts
git commit -m "feat: per-turn skill-set transparency events (deduped)"
```

### Task 4: Panel price badge (Electron)

**Files:**
- Modify: `public/app.js` (`makeSkillItem`, after line 772)
- Modify: `public/style.css` (after the `.skill-mod-badge` block, lines 831–834)

**Interfaces:**
- Consumes: `estTokens`/`bytes` from `getAllSkills` (Task 1; flows through the existing spread at `electron/main.ts:320`, no main change).
- Produces: visible per-skill cost. Verified by read-review + optional manual Electron smoke (no DOM harness in repo — stated, accepted).

- [ ] **Step 1: Add the badge element**

In `public/app.js`, after line 772 (`top.appendChild(modBadge)`), insert:

```javascript
const sizeBadge = document.createElement("span")
sizeBadge.className = "skill-size-badge"
sizeBadge.textContent = `~${skill.estTokens ?? "?"}t`
sizeBadge.title = `${skill.bytes ?? "?"} bytes`
top.appendChild(sizeBadge)
```

- [ ] **Step 2: Add the badge style**

In `public/style.css`, after lines 831–834 (`.skill-mod-badge { color: var(--sky); font-size: 10px; }`), insert:

```css
.skill-size-badge {
  color: var(--muted);
  font-size: 10px;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: per-skill cost badge in skills panel"
```

### Task 5: Typecheck, docs, version, commit

**Files:**
- Modify: `docs/arch/03-components.md` (line 39 bullet)
- Modify: `package.json` (version 0.5.1 → 0.6.0)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: green suite + release commit.

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck` (from repo root)
Expected: clean, no output. (Catches import cycles from the new `notice` import in `loop.ts` and the widened `getAllSkills` return against the Electron spread.)

- [ ] **Step 2: Full verification scripts**

Run: `bun scripts/skills-accounting-test.ts` and `bun scripts/mods-test.ts`
Expected: all green lines, exit 0. (Also run any other `scripts/*-test.ts` present; name failures explicitly if any pre-date this change.)

- [ ] **Step 3: Docs touch**

In `docs/arch/03-components.md`, line 39, append to the `getSystemPrompt()` bullet: `; skill sizes ride getAllSkills() for panel price tags; per-turn skill sets emit skills/turn-skills notices`.

- [ ] **Step 4: Bump version**

In `package.json`, change `"version": "0.5.1"` to `"version": "0.6.0"`.

- [ ] **Step 5: Commit**

```bash
git add docs/arch/03-components.md package.json
git commit -m "docs: skill accounting notes + 0.6.0 bump"
```
