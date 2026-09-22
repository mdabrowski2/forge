# Forge Mod-Maker Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-time mod author can scaffold, validate, reload, and debug a mod without restarting the app or reading core source.

**Architecture:** Three small core additions (scaffold writer, registry reset, loader result `dir`), two throwaway-process CLI scripts (create, check), one IPC channel + preload bridge + renderer button (reload), one authoring guide. No new dependencies, no registry redesign, no TUI command dispatch (TUI keeps boot-load only — documented).

**Tech Stack:** Bun + TypeScript (`tsc --noEmit`), Node fs/path/os + `pathToFileURL`, Electron IPC, vanilla renderer JS (`public/app.js`).

**Spec:** `docs/arch/` living tree — mission in `README.md`/`01-context.md`; mechanism in `06-mods.md`; panels in `07-ui.md`; error surface in `08-integrations.md` (n/a) + `public/app.js:530-668`; audit P1-5 minimal slice (boot mod-path warning) from `09-audit.md`.

## Global Constraints

- Mission test for every task: does this make it easier for a non-expert to make Forge their own? If not, cut it.
- No new runtime dependencies (stdlib only).
- Behavioral verification only — no source-grep assertions (Wave 1 red-team finding #1). Every test exercises runtime behavior with tmp-dir fixtures.
- Singleton discipline: `registry` is process-global. Tests use unique fixture names (`w2-<ts>-<kind>`) and `reset()` in `finally` so the implementer's process is left clean.
- TDD: failing script first, minimal fix, green + `tsc --noEmit`, one commit per task.
- Docs in the same commit: `06-mods.md` + new `10-mod-authoring.md` + `09-audit.md` updates travel with code.

## Review Focus

1. Scaffold name `../../evil` / empty / spaces must be rejected — expect `scripts/mod-create.ts` to exit non-zero with "invalid mod name", writing nothing.
2. `mod-check` on a folder with no entry file must report "no entry file", not a stack trace — expect exit 2 + one-line message.
3. Double reload must be idempotent — expect two consecutive `forge:reloadMods` calls to return identical `loaded` lists with no duplicate-registration throw.
4. Reload with a newly-broken mod unregisters its previous contributions (reset-then-load semantic) — expect `failed[]` to name it and the guide to document re-fix + reload; no silent resurrection of the old version.
5. Scaffold into an existing non-empty dir must refuse — expect non-zero exit + "already exists", never overwrite.

---

## File Structure

- Create: `src/mods/scaffold.ts` — `scaffoldMod(dirName, modsDir)` writes `<modsDir>/<dirName>/index.js` from an exported `MOD_TEMPLATE`; throws `Error("invalid mod name …")` / `Error("already exists …")`. Single responsibility: mod file creation.
- Create: `scripts/mod-create.ts` — CLI `bun scripts/mod-create.ts <dirName> [--dir <modsDir>]` (default real `modsDir` from `src/mods/loader.ts`). Single responsibility: author-facing creation.
- Create: `scripts/mod-check.ts` — CLI `bun scripts/mod-check.ts <modDir>` in a throwaway process: entry exists → dynamic import → shape check → `setup(createApi(...))` → report counts → exit 0/1/2. Single responsibility: pre-flight validation.
- Modify: `src/mods/registry.ts` — add `reset()` clearing tools/hooks/commands/skills (keeps emitSink/activeSession/globalConfig). Single responsibility: reload enabler.
- Modify: `src/mods/loader.ts` — add `dir` to `ModLoadResult` (the scanned directory). Additive only; `listMods` untouched. Single responsibility: provenance for the boot warning.
- Modify: `electron/main.ts` — `console.log(`[mods] dir: …`)` at boot + `forge:reloadMods` handler (reset → loadMods(config) → reassign `modLoadResult` → return `{loaded, failed}`). Single responsibility: reload orchestration.
- Modify: `electron/preload.ts` — `reloadMods` bridge. Modify: `public/app.js` — Reload button next to the mods panel calling it + `refreshMods()`.
- Modify: `src/main.tsx` — same one-line `[mods] dir` log for TUI parity.
- Create: `docs/arch/10-mod-authoring.md` — the guide. Modify: `docs/arch/06-mods.md` (reload/scaffold/check sections), `README.md` map, `09-audit.md` (P1-5 minimal slice done).

---

### Task 1: Scaffold core + `mod-create` CLI

**Files:**
- Create: `src/mods/scaffold.ts`
- Create: `scripts/mod-create.ts`

**Interfaces:**
- Consumes: `modsDir` from `src/mods/loader.ts` (default target only)
- Produces: `scaffoldMod(dirName: string, modsDir: string): string` (returns written entry path) + `MOD_TEMPLATE: string` (the exact file text below; Task 5's guide embeds this same text)

- [ ] **Step 1: Write `src/mods/scaffold.ts`**

```ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs"
import { join } from "path"

export const MOD_TEMPLATE = `export default {
  name: "__MOD_NAME__",
  version: "0.1.0",
  setup(api) {
    api.commands.register({
      name: "hello",
      description: "says hello (rename me)",
      run: (args) => "hello " + (args || "world"),
    })
  },
}
`

const VALID = /^[a-z0-9][a-z0-9-_]*$/

export function scaffoldMod(dirName: string, modsDir: string): string {
  if (!VALID.test(dirName)) throw new Error(`invalid mod name "${dirName}" (use lowercase letters, digits, - _)`)
  const dir = join(modsDir, dirName)
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`already exists and is not empty: ${dir}`)
  mkdirSync(dir, { recursive: true })
  const entry = join(dir, "index.js")
  writeFileSync(entry, MOD_TEMPLATE.replaceAll("__MOD_NAME__", dirName))
  return entry
}
```

- [ ] **Step 2: Write `scripts/mod-create.ts`**

```ts
// usage: bun scripts/mod-create.ts <dirName> [--dir <modsDir>]
import { modsDir as defaultModsDir } from "../src/mods/loader"
import { scaffoldMod } from "../src/mods/scaffold"
const fail = (m: string): never => { console.error(m); process.exit(1) }
const name = process.argv[2] ?? fail("usage: bun scripts/mod-create.ts <dirName> [--dir <modsDir>]")
const flag = process.argv.indexOf("--dir")
const dir = flag === -1 ? defaultModsDir : (process.argv[flag + 1] ?? fail("missing value for --dir"))
try {
  console.log("created: " + scaffoldMod(name, dir))
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}
```

- [ ] **Step 3: Behavioral proof (tmp dir, real import, real shape)**

Run: `bun -e "import('./src/mods/scaffold.ts').then(async m => { const {mkdtempSync} = await import('fs'); const {tmpdir} = await import('os'); const {join} = await import('path'); const d = mkdtempSync(join(tmpdir(),'w2-')); const e = m.scaffoldMod('w2-hello',''+d); const mod = (await import(e)).default; if (mod.name !== 'w2-hello' || typeof mod.setup !== 'function') throw new Error('bad shape'); let ran = false; mod.setup({ commands: { register: () => { ran = true } } }); if (!ran) throw new Error('setup did not register'); console.log('scaffold OK') })"`
Expected: `scaffold OK`

- [ ] **Step 4: Rejection proofs (Review Focus 1 + 5)**

Run: `bun scripts/mod-create.ts '../../evil' --dir $(mktemp -d); echo "exit=$?"`
Expected: `invalid mod name` + `exit=1`, nothing written outside the tmp dir.
Run: `D=$(mktemp -d) && bun scripts/mod-create.ts w2-x --dir $D && bun scripts/mod-create.ts w2-x --dir $D; echo "exit=$?"`
Expected: second run `already exists and is not empty` + non-zero exit; first `index.js` untouched.

- [ ] **Step 5: Typecheck + commit**

Run: `bunx tsc --noEmit`
Expected: exit 0

```bash
git add src/mods/scaffold.ts scripts/mod-create.ts
git commit -m "feat: scaffold new mods with mod-create CLI"
```

---

### Task 2: `mod-check` pre-flight CLI (throwaway process)

**Files:**
- Create: `scripts/mod-check.ts`

**Interfaces:**
- Consumes: `loadMods`-compatible entry convention (`index.js|index.mjs`), `createApi` from `src/mods/registry.ts`, `defaultConfig` from `src/config.ts`
- Produces: exit 0 (valid, prints registered counts) / 1 (import/shape/setup failure, prints reason) / 2 (no entry file). Safe to re-run: fresh process per run, no singleton carryover.

- [ ] **Step 1: Write `scripts/mod-check.ts`**

```ts
// usage: bun scripts/mod-check.ts <modDir> — validates one mod folder in this throwaway process
import { existsSync } from "fs"
import { join } from "path"
import { pathToFileURL } from "url"
import { defaultConfig } from "../src/config"
import { createApi, registry } from "../src/mods/registry"

const dir = process.argv[2]
if (!dir) { console.error("usage: bun scripts/mod-check.ts <modDir>"); process.exit(2) }
const entry = ["index.js", "index.mjs"].map((f) => join(dir, f)).find((f) => existsSync(f))
if (!entry) { console.error(`no entry file: ${dir}/index.{js,mjs} missing`); process.exit(2) }
try {
  const mod = (await import(pathToFileURL(entry).href)) as { default?: { name?: unknown; setup?: unknown } }
  const def = mod.default
  if (!def || typeof def.name !== "string" || typeof (def as { setup?: unknown }).setup !== "function") {
    console.error("default export must be { name, version, setup(api) }"); process.exit(1)
  }
  ;(def as { setup: (api: unknown) => void }).setup(createApi(defaultConfig(), def.name))
  const cmds = registry.getCommands().map((c) => c.name).join(",") || "(none)"
  console.log(`valid: name=${def.name} commands=[${cmds}]`)
} catch (e) {
  console.error(`invalid: ${e instanceof Error ? e.message : String(e)}`); process.exit(1)
}
```

- [ ] **Step 2: Prove the three exits behaviorally**

Run: `D=$(mktemp -d) && bun scripts/mod-create.ts w2-ok --dir $D >/dev/null && bun scripts/mod-check.ts $D/w2-ok; echo "exit=$?"`
Expected: `valid: name=w2-ok commands=[hello]` + `exit=0`
Run: `D=$(mktemp -d) && mkdir -p $D/empty && bun scripts/mod-check.ts $D/empty; echo "exit=$?"`
Expected: `no entry file` + `exit=2`
Run: `D=$(mktemp -d) && mkdir -p $D/boom && echo 'export default { name: "x", setup() { throw new Error("kablam") } }' > $D/boom/index.js && bun scripts/mod-check.ts $D/boom; echo "exit=$?"`
Expected: `invalid: kablam` + `exit=1`
Run: `bun scripts/mod-check.ts $D/boom; echo "exit=$?"` again
Expected: identical output (re-runnable — fresh process, no duplicate-registration carryover)

- [ ] **Step 3: Typecheck + commit**

Run: `bunx tsc --noEmit`
Expected: exit 0

```bash
git add scripts/mod-check.ts
git commit -m "feat: mod-check pre-flight validation CLI"
```

---

### Task 3: Hot-reload (`registry.reset` + `forge:reloadMods` + renderer button)

**Files:**
- Modify: `src/mods/registry.ts` (append method), `electron/main.ts`, `electron/preload.ts`, `public/app.js`

**Interfaces:**
- Consumes: `loadMods(config)` from `src/mods/loader.ts`, `registry` singleton
- Produces: `GET forge:reloadMods → {loaded: string[], failed: {name, error}[]}`; renderer Reload button; reload-twice idempotence (Review Focus 3); broken-mod semantic documented (Review Focus 4)

- [ ] **Step 1: Add `reset()` to `ModRegistry` (before `export const registry`)**

```ts
/** drop all registrations (tools/hooks/commands/skills) for a clean reload.
 * Per-turn wiring (emitSink/activeSession/globalConfig) is preserved. */
reset(): void {
  this.tools.clear()
  this.hooks.clear()
  this.commands.clear()
  this.skills.clear()
}
```

- [ ] **Step 2: Add the IPC handler in `electron/main.ts` (after the `forge:mods` handler)**

```ts
ipcMain.handle("forge:reloadMods", async () => {
  registry.reset()
  modLoadResult = await loadMods(config)
  for (const f of modLoadResult.failed) console.error(`[mods] ${f.name}: ${f.error}`)
  return modLoadResult
})
```

(`registry` already imported at `electron/main.ts:30`; `modLoadResult` is `let` at line 46 — reassignable, no other change needed.)

- [ ] **Step 3: Bridge + renderer button**

`electron/preload.ts`, inside the exposed object:

```ts
reloadMods: () => ipcRenderer.invoke("forge:reloadMods"),
```

`public/app.js`, after `refreshMods` (line ~666): add a Reload action to the mods panel header that calls `await window.forge.reloadMods()` then `refreshMods()`. Reuse the existing `UI.action` helper and `mods-scope` refresh path — no new panel, no new styles.

- [ ] **Step 4: Behavioral proof (idempotent double reload, no dup-throw)**

Run: `bun -e "import('./src/mods/registry.ts').then(async m => { const {mkdtempSync, mkdirSync, writeFileSync} = await import('fs'); const {tmpdir} = await import('os'); const {join} = await import('path'); const {loadMods} = await import('./src/mods/loader.ts'); const {defaultConfig} = await import('./src/config.ts'); const d = mkdtempSync(join(tmpdir(),'w2r-')); mkdirSync(join(d,'w2rel')); writeFileSync(join(d,'w2rel','index.js'), 'export default { name: \\\"w2rel\\\", version: \\\"0.1\\\", setup(api) { api.commands.register({ name: \\\"w2rel-cmd\\\", description: \\\"x\\\", run: () => \\\"ok\\\" }) } }'); const cfg = defaultConfig(); m.registry.reset(); const r1 = await loadMods(cfg, d); m.registry.reset(); const r2 = await loadMods(cfg, d); const cmds = m.registry.getCommands().map(c => c.name); if (r1.loaded.join() !== r2.loaded.join() || !cmds.includes('w2rel-cmd')) throw new Error('reload not idempotent'); m.registry.reset(); if (m.registry.getCommands().length) throw new Error('reset leaked'); console.log('reload OK') })"`
Expected: `reload OK`

- [ ] **Step 5: Broken-mod semantic proof (Review Focus 4)**

Run: same harness with second phase — overwrite the fixture `index.js` with a throwing `setup`, `reset()` + `loadMods`, assert `failed` names it and `getCommands()` no longer contains `w2rel-cmd` (old version gone, documented — not resurrected).
Expected: explicit pass/fail print, exit 0 on correct semantic.

- [ ] **Step 6: Typecheck + commit**

Run: `bunx tsc --noEmit`
Expected: exit 0

```bash
git add src/mods/registry.ts electron/main.ts electron/preload.ts public/app.js
git commit -m "feat: hot-reload mods without app restart"
```

---

### Task 4: Boot mod-path warning (audit P1-5 minimal slice)

**Files:**
- Modify: `src/mods/loader.ts` (`ModLoadResult` gains `dir`), `electron/main.ts`, `src/main.tsx`

**Interfaces:**
- Consumes: `modsDir` default + `dir` param of `loadMods`
- Produces: `ModLoadResult.dir: string` (scanned directory); both boots log `[mods] dir: <path>` so a user can always answer "where did these mods come from"

- [ ] **Step 1: Add `dir` to the result**

In `src/mods/loader.ts`: extend the interface with `dir: string` and initialize `{ loaded: [], failed: [], dir }` in `loadMods`. Update the one other construction site if any (search `ModLoadResult` — `electron/main.ts:46` initializes `{ loaded: [], failed: [] }`; update it to include `dir: modsDir`).

- [ ] **Step 2: Log it at both boots**

After the existing `[mods] loaded:` log line in `src/main.tsx` and `electron/main.ts` `boot()`, add:

```ts
console.log(`[mods] dir: ${modLoadResult.dir ?? modsDir}`)
```

importing `modsDir` from `../src/mods/loader` (`electron/main.ts`) — `src/main.tsx` imports from `./mods/loader`.

- [ ] **Step 3: Behavioral proof**

Run: `bun -e "import('./src/mods/loader.ts').then(async m => { const {mkdtempSync} = await import('fs'); const {tmpdir} = await import('os'); const {join} = await import('path'); const {defaultConfig} = await import('./src/config.ts'); const d = mkdtempSync(join(tmpdir(),'w2d-')); const r = await m.loadMods(defaultConfig(), d); if (r.dir !== d) throw new Error('dir not reported'); console.log('dir OK: ' + r.dir) })"`
Expected: `dir OK: /tmp/…`

- [ ] **Step 4: Typecheck + commit**

Run: `bunx tsc --noEmit`
Expected: exit 0

```bash
git add src/mods/loader.ts electron/main.ts src/main.tsx
git commit -m "feat: log scanned mods dir at boot"
```

---

### Task 5: Authoring guide + doc updates

**Files:**
- Create: `docs/arch/10-mod-authoring.md`
- Modify: `docs/arch/06-mods.md`, `docs/arch/README.md`, `docs/arch/09-audit.md`

- [ ] **Step 1: Write `docs/arch/10-mod-authoring.md`** with exactly these sections (no new concepts beyond Tasks 1–4):
  1. Quickstart (5 commands: create → check → open in editor → reload in app → enable per scope), each a literal command block using `scripts/mod-create.ts`, `scripts/mod-check.ts`, and the Reload button.
  2. Recipes with copy-paste skeletons: command (reuse `MOD_TEMPLATE` verbatim from `src/mods/scaffold.ts`), tool (JSON-schema input + `ctx.cwd`/`ctx.emit` usage), skill (name/description/content + loading via skills panel), hook (`beforeToolCall` logger, non-blocking rule), custom event (`events.emit` + where it appears).
  3. Scopes worked example (reuse the `{a:1,b:2}` + disabled example from `06-mods.md`).
  4. Debugging: `mod-check` exits (0/1/2), mods panel `failed` + `mod-error` row (`public/app.js:552-557`), boot logs (`[mods] dir/loaded/<name>: <error>`), reload semantic (broken reload unregisters until fixed).
  5. Trust note: mods run in-process with full Node power (RCE) — only install mods you trust; link `01-context.md` trust boundary.

- [ ] **Step 2: Consistency check (template == guide)**

Run: `bun -e "import('./src/mods/scaffold.ts').then(async m => { const {readFileSync} = await import('fs'); const g = readFileSync('docs/arch/10-mod-authoring.md','utf-8'); for (const line of ['api.commands.register', 'name: \"hello\"']) if (!g.includes(line)) throw new Error('guide diverged from MOD_TEMPLATE: missing ' + line); if (!m.MOD_TEMPLATE.includes('api.commands.register')) throw new Error('template changed'); console.log('guide-template OK') })"`
Expected: `guide-template OK`

- [ ] **Step 3: Update `06-mods.md` (reload + scaffold + check subsections), `README.md` map (add `10-mod-authoring.md` row), `09-audit.md` (P1-5 minimal slice checked with commit hash; full allowlist/signature stays proposed).**

- [ ] **Step 4: Commit**

```bash
git add docs/arch/10-mod-authoring.md docs/arch/06-mods.md docs/arch/README.md docs/arch/09-audit.md
git commit -m "docs: mod authoring guide and Wave 2 doc updates"
```

---

### Task 6: Wave-2 gate

**Files:** none (verification only)

- [ ] **Step 1: All Wave-2 scripts**

Run: `D=$(mktemp -d) && bun scripts/mod-create.ts gate-mod --dir $D && bun scripts/mod-check.ts $D/gate-mod`
Expected: `created: …` + `valid: name=gate-mod commands=[hello]`

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Existing offline suites (model/Electron suites excluded: `tool-test` needs Ollama, `smoke` needs a window)**

Run: `bun scripts/mods-test.ts`
Expected: exit 0 with `disabled skipped: true`, `broken reported: true`
Run: `bun scripts/mods-runtime-test.ts`
Expected: exit 0
Run: `bun scripts/transparency-test.ts`
Expected: exit 0

- [ ] **Step 4: Commit only on fallout fixes; otherwise `git status --short` clean apart from the plan file, then commit the plan**

```bash
git add docs/superpowers/plans/2026-09-22-forge-mod-maker-wave2.md
git commit -m "docs: Wave 2 mod-maker implementation plan" || true
```

---

## Self-Review

1. **Spec coverage:** mission ease-of-making (Tasks 1–3, 5), broken-mod surfaces (existing renderer row verified + reload semantic + boot `dir` log), P1-5 minimal slice (Task 4). Full allowlist/signature, mod gallery/discovery, TUI slash dispatch, and disk rotation stay out — named, not forgotten.
2. **Placeholder scan:** every step has literal code/commands/expected output; no TBD/TODO/appropriate-handling language. The one deliberate non-code step (Task 5 guide prose) is bounded by an exact section list + a template-consistency check.
3. **Type consistency:** `scaffoldMod(dirName, modsDir): string`, `MOD_TEMPLATE` placeholder `__MOD_NAME__` + `replaceAll`; `ModLoadResult` gains additive `dir` (initializers updated in loader + `electron/main.ts:46`); `registry.reset()` clears only the four registration maps; `forge:reloadMods` returns the full `ModLoadResult` shape the renderer already consumes via `modsForScope`-style `{dirName, status, error}` rows after `refreshMods()`.
4. **Review Focus:** all five lines pinned — 1+5 in Task 1 Step 4, 2 in Task 2 Step 2, 3 in Task 3 Step 4, 4 in Task 3 Step 5.
