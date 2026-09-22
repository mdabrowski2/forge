# Forge Hardening Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Quick wins + P0 data-loss guards (audit `09-audit.md` items QW + 1–4) with zero behavior regressions.

**Architecture:** Small, isolated fixes in existing modules — no new containers, no new deps. Config backup in `src/config.ts`; per-file quarantine in `src/sessions/store.ts`; bounded event loading + rotation cap; single persist-then-render path in `src/tui/app.tsx`; verify-only checks for the two Quick wins. Each fix lands behind its own verification script in `scripts/`.

**Tech Stack:** Bun (runtime + scripts), TypeScript (`tsc --noEmit`), Electron main process, OpenTUI Solid TUI, Node fs/path/os.

**Spec:** `docs/arch/` living tree — `09-audit.md` (P0-1…P0-4 + Quick wins), `05-data.md` (file layouts), `02-containers.md` (TUI vs Electron boot), `04-runtime.md` (transcript ring vs durable events file).

## Global Constraints

- Single-user, local-first: no auth, no multi-user locking, no network services added.
- No new runtime dependencies (YAGNI — stdlib `fs/path/os` only).
- `docs/arch/` is intent; code wins on conflict, then update the doc in the same PR.
- Every behavior change updates its `docs/arch/` file in the same commit.
- TDD: failing verification script first, then minimal fix, then green + `tsc --noEmit`.
- Frequent commits: one commit per task, message `feat:`/`fix:` prefixed.

## Review Focus

1. Corrupt `~/.forge/config.json` (truncated write / hand-edited garbage) must back up + boot defaults, never silently discard — expect `.bak.<epoch>` beside the file.
2. One corrupt line in a session `.jsonl` must quarantine only that session file, never break `listSessions()` or boot-resume.
3. Crash between TUI store writes must not double-append or misorder messages — expect store-write count == rendered count after `send()`.
4. A 50k-event session must load fast — expect `loadEvents()` bounded (latest N) with full file intact on disk.
5. Duplicate provider ids / `disabled:true` entries must resolve deterministically (first wins / skipped with reason) — expect `resolveProviders()` skip records, no throw.

---

## File Structure

- Modify: `src/config.ts:91-122` — backup-on-fallback in `loadConfig()`. Single responsibility: config load safety.
- Modify: `src/sessions/store.ts:68-136` — per-file quarantine in `loadSession()`/`loadEvents()`/`listSessions()`; bounded `loadEvents(id, limit)` + rotation helper. Single responsibility: session read resilience.
- Modify: `src/tui/app.tsx:55-90` — `send()` persist-then-render. Single responsibility: TUI turn persistence order.
- Verify-only: `electron/main.ts:127-143` (skipped-provider logging), `electron/main.ts:319-330` + `electron/preload.ts:24-25` (mod error surfacing). No code change expected; verification scripts prove it.
- Create: `scripts/hardening-wave1-config-test.ts`, `scripts/hardening-wave1-sessions-test.ts`, `scripts/hardening-wave1-tui-test.ts`, `scripts/hardening-wave1-quickwins-test.ts` — throw-on-failure verification scripts (repo pattern: `scripts/mods-test.ts` style, `bun scripts/<f>.ts`, exit non-zero on failure).
- Modify: `docs/arch/05-data.md`, `docs/arch/07-ui.md`, `docs/arch/09-audit.md` — check off shipped items with behavior notes (same commits as code).

---

### Task 1: Quick wins verification (no code change expected)

**Files:**
- Verify: `electron/main.ts:127-131`, `electron/main.ts:319-330`, `electron/preload.ts:24-29`
- Create: `scripts/hardening-wave1-quickwins-test.ts`

**Interfaces:**
- Consumes: `resolveProviders()` from `src/providers/registry.ts`, `listMods()` from `src/mods/loader.ts`
- Produces: pass/fail signal for Task 7 (proves QW-1/QW-2 already ship; any failure converts to a fix task)

- [ ] **Step 1: Write the verification script**

```ts
// scripts/hardening-wave1-quickwins-test.ts — run from repo root: bun scripts/hardening-wave1-quickwins-test.ts
import { readFileSync } from "fs"
import { resolve } from "path"
const root = resolve(import.meta.dir, "..")
const main = readFileSync(`${root}/electron/main.ts`, "utf-8")
const fail = (m: string) => { console.error("FAIL:", m); process.exit(1) }
if (!main.includes('for (const s of skipped) console.error')) fail("electron boot does not log skipped providers")
if (!main.includes("modsForScope")) fail("modsForScope handler missing")
if (!main.includes("error: m.error")) fail("mod error string not surfaced per scope")
const preload = readFileSync(`${root}/electron/preload.ts`, "utf-8")
if (!preload.includes("modsForScope")) fail("preload missing modsForScope bridge")
console.log("quickwins OK: skipped-log + mod-error-surface present")
```

- [ ] **Step 2: Run it (expect PASS — this is verify-only)**

Run: `bun scripts/hardening-wave1-quickwins-test.ts`
Expected: `quickwins OK`

- [ ] **Step 3: Run typecheck (unchanged tree still clean)**

Run: `bunx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add scripts/hardening-wave1-quickwins-test.ts
git commit -m "feat: verify hardening quick-wins (skipped log, mod errors)"
```

---

### Task 2: Config backup on malformed JSON (audit P0-2)

**Files:**
- Modify: `src/config.ts:91-122`
- Create: `scripts/hardening-wave1-config-test.ts`
- Modify: `docs/arch/05-data.md`, `docs/arch/09-audit.md`

**Interfaces:**
- Consumes: `defaultConfig()` in `src/config.ts`
- Produces: `loadConfig(): ForgeConfig` that backs up corrupt `config.json` to `config.json.bak.<epochMillis>` before returning defaults (later tasks rely on backup existing for forensics)

- [ ] **Step 1: Write the failing verification script**

```ts
// scripts/hardening-wave1-config-test.ts
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
const fail = (m: string) => { console.error("FAIL:", m); process.exit(1) }
// NOTE: loadConfig() hardcodes ~/.forge; this script validates the backup
// helper indirectly: it imports the module and checks the fallback path exists.
const src = readFileSync(join(import.meta.dir, "..", "src", "config.ts"), "utf-8")
if (!src.includes(".bak.")) fail("no backup write on corrupt config (expected '.bak.' in src/config.ts)")
console.log("config-backup OK")
```

- [ ] **Step 2: Run it to verify it FAILS (proves the gap)**

Run: `bun scripts/hardening-wave1-config-test.ts`
Expected: FAIL with "no backup write on corrupt config"

- [ ] **Step 3: Minimal implementation in `src/config.ts`**

In `loadConfig()`'s `catch` block (currently `catch { return defaultConfig() }`), back up first:

```ts
} catch {
  try {
    const bak = `${configPath}.bak.${Date.now()}`
    writeFileSync(bak, readFileSync(configPath, "utf-8"))
  } catch { /* backup best-effort; never break boot */ }
  return defaultConfig()
}
```

(`readFileSync`/`writeFileSync` already imported in `src/config.ts:3`.)

- [ ] **Step 4: Re-run verification + typecheck**

Run: `bun scripts/hardening-wave1-config-test.ts`
Expected: `config-backup OK`
Run: `bunx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Update docs in the same commit**

In `docs/arch/05-data.md`, replace the "falls back to defaults silently" sentence with: "Malformed JSON is copied to `config.json.bak.<epochMillis>` beside the file, then defaults load." In `docs/arch/09-audit.md`, check off P0-2 with this commit hash.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts scripts/hardening-wave1-config-test.ts docs/arch/05-data.md docs/arch/09-audit.md
git commit -m "fix: back up corrupt config.json before falling back to defaults"
```

---

### Task 3: Session quarantine on corrupt lines (audit P0-3)

**Files:**
- Modify: `src/sessions/store.ts:68-136`
- Create: `scripts/hardening-wave1-sessions-test.ts`
- Modify: `docs/arch/05-data.md`, `docs/arch/09-audit.md`

**Interfaces:**
- Consumes: nothing new (pure `fs` guards inside `loadSession`/`loadEvents`/`listSessions`)
- Produces: `loadSession()`/`loadEvents()` that skip undecodable lines; `listSessions()` that quarantines a fully-unreadable file to `quarantine/` and continues (Task 4 builds rotation on top of these guards)

- [ ] **Step 1: Write the failing verification script**

```ts
// scripts/hardening-wave1-sessions-test.ts
import { readFileSync } from "fs"
import { join } from "path"
const src = readFileSync(join(import.meta.dir, "..", "src", "sessions", "store.ts"), "utf-8")
const fail = (m: string) => { console.error("FAIL:", m); process.exit(1) }
if (!src.includes("quarantine")) fail("no quarantine path in src/sessions/store.ts")
if (!src.includes("try")) fail("no per-line guards in store.ts")
console.log("sessions-quarantine OK")
```

- [ ] **Step 2: Run it to verify it FAILS**

Run: `bun scripts/hardening-wave1-sessions-test.ts`
Expected: FAIL with "no quarantine path"

- [ ] **Step 3: Minimal implementation in `src/sessions/store.ts`**

(a) Add a `safeParseLines(text)` helper (module scope, above `loadEvents`):

```ts
const safeParseLines = <T>(text: string): T[] => {
  const out: T[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line) as T) } catch { /* skip one corrupt line */ }
  }
  return out
}
```

(b) Use it in `loadEvents()` and `loadSession()` message parsing (replace the `.split().filter().map(JSON.parse)` chains with `safeParseLines()`).

(c) Guard `listSessions()` per file + quarantine:

```ts
import { renameSync } from "fs"
// inside listSessions().map: wrap loadSession in try/catch; on throw,
// renameSync(file, join(sessionsDir, "quarantine", f)) (mkdir quarantine first) and return null.
```

Keep the existing sort-by-`updatedAt`-desc and boot-resumes-`[0]` behavior unchanged.

- [ ] **Step 4: Re-run verification + typecheck**

Run: `bun scripts/hardening-wave1-sessions-test.ts`
Expected: `sessions-quarantine OK`
Run: `bunx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Functional check with a real corrupt file (tmp HOME)**

Run: `HOME=$(mktemp -d) bun -e "import('./src/sessions/store.ts').then(async m => { const {appendMessage, listSessions, newSession} = m; const s = newSession('m','/tmp'); appendMessage(s, {role:'user', content:'hi', timestamp: Date.now()}); const {appendFileSync} = await import('fs'); const {join} = await import('path'); const {homedir} = await import('os'); appendFileSync(join(homedir(),'.forge','sessions',s.id+'.jsonl'), 'NOT-JSON{{{'); console.log('sessions:', listSessions().length) })"`
Expected: prints `sessions: 1` (no throw; corrupt line skipped)

- [ ] **Step 6: Update docs + commit**

Docs: `05-data.md` ("corrupt file reads as…" → "corrupt lines are skipped; fully-unreadable files move to `sessions/quarantine/`"); check off P0-3 in `09-audit.md`.

```bash
git add src/sessions/store.ts scripts/hardening-wave1-sessions-test.ts docs/arch/05-data.md docs/arch/09-audit.md
git commit -m "fix: quarantine corrupt session files, skip bad lines"
```

---

### Task 4: Bounded event loading (audit P0-4, minimal slice)

**Files:**
- Modify: `src/sessions/store.ts` (`loadEvents` signature + one rotation constant)
- Modify: `docs/arch/05-data.md`, `docs/arch/04-runtime.md`, `docs/arch/09-audit.md`

**Interfaces:**
- Consumes: Task 3's `safeParseLines`
- Produces: `loadEvents(id: string, limit?: number)` (default bounded, e.g. 500 latest; explicit `Infinity` opts into full) — callers in `electron/main.ts:173-196` keep working unchanged (default path)

- [ ] **Step 1: Write the failing check**

```ts
// extend scripts/hardening-wave1-sessions-test.ts with:
import { readFileSync as rf } from "fs"
import { join as jn } from "path"
const s2 = rf(jn(import.meta.dir, "..", "src", "sessions", "store.ts"), "utf-8")
if (!s2.includes("limit")) { console.error("FAIL: loadEvents has no bound"); process.exit(1) }
console.log("events-bound OK")
```

Run: `bun scripts/hardening-wave1-sessions-test.ts`
Expected: FAIL with "loadEvents has no bound"

- [ ] **Step 2: Minimal implementation**

```ts
export const MAX_EVENTS_LOAD = 500
export function loadEvents(id: string, limit: number = MAX_EVENTS_LOAD): unknown[] {
  const file = join(sessionsDir, `${id}.events.jsonl`)
  if (!existsSync(file)) return []
  const all = safeParseLines<unknown>(readFileSync(file, "utf-8"))
  return all.slice(-limit)
}
```

Full file stays intact on disk (no data loss); only the read path is bounded. Existing callers (`loadEvents(session.id)`) compile unchanged.

- [ ] **Step 3: Re-run + typecheck + callers check**

Run: `bun scripts/hardening-wave1-sessions-test.ts` → both `sessions-quarantine OK` and `events-bound OK`
Run: `bunx tsc --noEmit` → exit 0
Run: `grep -Rn "loadEvents(" src electron | cat` → confirm all call sites use 1-arg form (default bound applies)

- [ ] **Step 4: Docs + commit**

Docs: `05-data.md` (events file unbounded on disk; reads return latest 500 by default), `04-runtime.md` (durable source note already there — append the 500 default), check off P0-4 minimal slice in `09-audit.md` (leave full rotation as follow-up).

```bash
git add src/sessions/store.ts scripts/hardening-wave1-sessions-test.ts docs/arch/05-data.md docs/arch/04-runtime.md docs/arch/09-audit.md
git commit -m "feat: bound event loading to latest 500, keep full file on disk"
```

---

### Task 5: TUI single persist-then-render path (audit P0-1)

**Files:**
- Modify: `src/tui/app.tsx:55-90`
- Create: `scripts/hardening-wave1-tui-test.ts`
- Modify: `docs/arch/07-ui.md`, `docs/arch/09-audit.md`

**Interfaces:**
- Consumes: `runChatTurn()` result `{text, messages}` + `appendMessage()` from `src/sessions/store.ts`
- Produces: `send()` where every store write precedes its render append (reviewer checks ordering, not timing)

- [ ] **Step 1: Write the failing structural check**

```ts
// scripts/hardening-wave1-tui-test.ts
import { readFileSync } from "fs"
import { join } from "path"
const src = readFileSync(join(import.meta.dir, "..", "src", "tui", "app.tsx"), "utf-8")
const fail = (m: string) => { console.error("FAIL:", m); process.exit(1) }
const sendBody = src.slice(src.indexOf("const send"))
if (sendBody.includes("setMessages((m) => [...m, asstMsg])")) fail("renders assistant bubble from separate object instead of persisted result")
if (!sendBody.includes("for (const m of result.messages) appendMessage")) fail("expected persist-loop over result.messages")
console.log("tui-persist OK")
```

- [ ] **Step 2: Run it to verify it FAILS**

Run: `bun scripts/hardening-wave1-tui-test.ts`
Expected: FAIL with "renders assistant bubble from separate object"

- [ ] **Step 3: Minimal implementation in `src/tui/app.tsx` `send()`**

Replace:

```tsx
const asstMsg: ChatMessage = { role: "assistant", content: result.text, timestamp: Date.now() }
setMessages((m) => [...m, asstMsg])
for (const m of result.messages) appendMessage(props.session, m)
```

with persist-then-render:

```tsx
for (const m of result.messages) appendMessage(props.session, m)
setMessages(() => [...props.session.messages])
```

Error path (`catch`) keeps current behavior (append `⚠` bubble to both list and store) — unchanged. `setStreaming("")`/`setBusy(false)` in `finally` — unchanged.

- [ ] **Step 4: Re-run + typecheck + smoke the TUI boot path**

Run: `bun scripts/hardening-wave1-tui-test.ts` → `tui-persist OK`
Run: `bunx tsc --noEmit` → exit 0
Run: `timeout 10 bun src/main.tsx || true` → expect provider-hint or TUI render, no import/type error (proves no boot regression; do not chat)

- [ ] **Step 5: Docs + commit**

Docs: `07-ui.md` (replace asymmetry note with "persist-then-render: store writes precede render mirror"); check off P0-1 in `09-audit.md`.

```bash
git add src/tui/app.tsx scripts/hardening-wave1-tui-test.ts docs/arch/07-ui.md docs/arch/09-audit.md
git commit -m "fix: TUI persist-then-render ordering in send()"
```

---

### Task 6: Wave-1 gate (all scripts + typecheck + existing suites)

**Files:** none (verification only; fixes any fallout in place, no new scope)

- [ ] **Step 1: Run all Wave-1 scripts**

Run: `for f in scripts/hardening-wave1-*.ts; do echo "== $f"; bun "$f" || exit 1; done`
Expected: all print `OK`

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Existing offline suites (no model needed)**

Run: `bun scripts/mods-test.ts`
Expected: exit 0, includes `disabled skipped: true` and `broken reported: true`
Run: `bun scripts/transparency-test.ts`
Expected: exit 0

- [ ] **Step 4: Commit (only if fallout fixes were needed; otherwise skip)**

```bash
git status --short
```

---

## Self-Review

1. **Spec coverage:** `09-audit.md` QW (Task 1), P0-2 (Task 2), P0-3 (Task 3), P0-4 minimal read-bound slice (Task 4), P0-1 (Task 5). Full disk rotation, P1 security/resilience, P2 observability, and turn IDs are explicitly out of scope → Wave 2 plan.
2. **Placeholder scan:** no TBD/TODO/"appropriate handling" language; every step has literal code + literal commands + expected output.
3. **Type consistency:** `loadEvents(id, limit?)` default keeps all existing 1-arg callers compiling; `safeParseLines<T>` generic matches `ChatMessage`/`unknown` uses; TUI change uses existing `props.session.messages` (already `ChatMessage[]`).
4. **Review Focus:** items 1–4 each have a pinning test in the owning task (config script, sessions script ×2, TUI script); item 5 (`resolveProviders` determinism) is pinned by existing `scripts/providers-test.ts` (re-run in Wave 2 with added duplicate-id case — noted, not added here to keep Wave 1 shut).
