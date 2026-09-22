# Forge Hardening Wave 1 Implementation Plan (rev.2 — post red-team)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship P0 data-loss guards (audit `09-audit.md` items 1–4) with zero behavior regressions.

**Architecture:** Small, isolated fixes in existing modules — no new containers, no new deps. Task 0 proves the HOME-isolation test seam every later proof rests on. Config backup in `src/config.ts`; per-line guards then quarantine moves in `src/sessions/store.ts`; single persist-then-render path in `src/tui/app.tsx`; bounded event reads (memory-only, honestly labeled). Each fix lands behind a behavioral verification script in `scripts/` (no source-grep assertions — red-team finding #1).

**Tech Stack:** Bun (runtime + scripts), TypeScript (`tsc --noEmit`), OpenTUI Solid TUI, Node fs/path/os.

**Spec:** `docs/arch/` living tree — `09-audit.md` (P0-1…P0-4), `05-data.md` (file layouts), `07-ui.md` (TUI send), `04-runtime.md` (durable events file). Red-team report: conversation 2026-09-22 (6 new findings; this rev addresses all).

## Global Constraints

- Single-user, local-first: no auth, no multi-user locking, no network services added.
- No new runtime dependencies (stdlib only).
- `docs/arch/` is intent; code wins on conflict, then update the doc in the same commit.
- Every behavior change updates its `docs/arch/` file in the same commit.
- TDD: failing behavioral proof first, minimal fix, green + `tsc --noEmit`.
- Frequent commits: one commit per task. Tree is dirty (author's in-flight work) — commits will absorb pre-existing diffs in touched files; verify own lines per commit via targeted grep, full attribution left to final review.
- Every silent-drop fix surfaces a number (log line or count) — no silent handling of silent loss.

## Review Focus

1. Corrupt `config.json` must back up (unique name) + log the backup path + boot defaults — expect `.bak.<epoch>-<rand>` beside the file and a `[config]` log line.
2. One corrupt line in a session `.jsonl` must be skipped *and counted* — expect a per-file dropped-line count surfaced to the caller, never a throw, never a retitled session without signal.
3. Crash between TUI store writes must not double-append or misorder — expect store-write count == rendered count after `send()` with a stubbed turn.
4. Bounded `loadEvents` caps retained memory only (parse cost unchanged — honestly labeled); UI replay narrowing must come with a truncation decision documented in `04-runtime.md`.
5. `resolveProviders()` determinism (dup id → first wins + skip record; disabled → skip, no throw) — pinned by running existing `scripts/providers-test.ts` in the gate *if present in the tree*, else dropped with a ledger note (it is untracked worktree state, not a promise).

---

## File Structure

- Modify: `src/config.ts:91-122` — backup-on-fallback in `loadConfig()` + log line + unique names. Single responsibility: config load safety.
- Modify: `src/sessions/store.ts:68-136` — `safeParseLines` returning `{items, dropped}`; `loadSession`/`loadEvents` skip + report; `listSessions` quarantine (all three sidecars + manifest). Single responsibility: session read resilience.
- Modify: `src/tui/app.tsx:55-90` — `send()` persist-then-render. Single responsibility: TUI turn persistence order.
- Modify: `src/sessions/store.ts` — `loadEvents(id, limit = MAX_EVENTS_LOAD)` slice (memory bound only).
- Create: `scripts/hardening-*.ts` behavioral proofs (tmp-HOME isolated, throw-on-failure, exit non-zero on failure).
- Modify: `docs/arch/05-data.md`, `07-ui.md`, `04-runtime.md`, `09-audit.md` — behavior notes + check-offs in the same commits.

---

### Task 0: Prove the HOME-isolation seam (gates everything)

**Files:** none (proof only; if it fails, the fallback is path injection — ruled then, not now)

- [ ] **Step 1: Run the seam proof (expect PASS — this decides the strategy)**

Run: `HOME=$(mktemp -d)/fakehome bun -e "import('./src/sessions/store.ts').then(async m => { const {homedir} = await import('os'); const {existsSync} = await import('fs'); const {join} = await import('path'); if (!homedir().includes('fakehome')) throw new Error('homedir ignores $HOME: ' + homedir()); const s = m.newSession('m', '/tmp'); m.appendMessage(s, {role:'user', content:'hi', timestamp: Date.now()}); const f = join(homedir(), '.forge', 'sessions', s.id + '.jsonl'); if (!existsSync(f)) throw new Error('store did not follow $HOME'); if (m.listSessions().length !== 1) throw new Error('listSessions missed isolated session'); console.log('seam OK: store follows $HOME') })"`
Expected: `seam OK: store follows $HOME`

- [ ] **Step 2 (only if Step 1 FAILS): rule the fallback**

Ledger: `Task 0: Ruling: $HOME override not honored → add optional dir params (configPath, sessionsDir) defaulting to current values — cost if wrong: wider diff touching every caller`. Then implement the params before any later task. If Step 1 passes, ledger `Task 0: complete (seam proven, no injection needed)` and continue.

---

### Task 2: Config backup on malformed JSON (audit P0-2)

**Files:**
- Modify: `src/config.ts:91-122`
- Create: `scripts/hardening-config-test.ts`
- Modify: `docs/arch/05-data.md`, `docs/arch/09-audit.md`

**Interfaces:**
- Consumes: Task 0 seam (all proofs run under isolated `HOME`)
- Produces: corrupt `config.json` → unique backup + `[config]` log line + defaults

- [ ] **Step 1: RED — behavioral proof against current code**

Run: `H=$(mktemp -d)/h && mkdir -p $H && HOME=$H bun -e "import('./src/config.ts').then(async m => { const {writeFileSync, existsSync, readdirSync} = await import('fs'); const {join} = await import('path'); const {homedir} = await import('os'); const dd = join(homedir(), '.forge'); const {mkdirSync} = await import('fs'); mkdirSync(dd, {recursive: true}); writeFileSync(join(dd, 'config.json'), '{corrupt[[['); const cfg = m.loadConfig(); const baks = readdirSync(dd).filter(f => f.startsWith('config.json.bak.')); if (!baks.length) throw new Error('no backup written'); if (!cfg.providers?.length) throw new Error('no defaults returned'); console.log('config-backup OK: ' + baks[0]) })"`
Expected: FAIL with `no backup written`

- [ ] **Step 2: GREEN — minimal implementation**

```ts
} catch {
  try {
    const bak = `${configPath}.bak.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    writeFileSync(bak, readFileSync(configPath, "utf-8"))
    console.error(`[config] corrupt config backed up to ${bak}; loaded defaults`)
  } catch { /* backup best-effort; never break boot */ }
  return defaultConfig()
}
```

- [ ] **Step 3: Re-run proof (expect `config-backup OK`) + `bunx tsc --noEmit` (exit 0)**

- [ ] **Step 4: Convert the proof into `scripts/hardening-config-test.ts`** (same body, `process.exit(1)` on any throw, runnable via `bun scripts/hardening-config-test.ts` under any HOME)

- [ ] **Step 5: Docs + commit**

Docs: `05-data.md` ("Malformed JSON is copied to `config.json.bak.<epoch>-<rand>` beside the file with a `[config]` log line, then defaults load."); check off P0-2 in `09-audit.md`.

```bash
git add src/config.ts scripts/hardening-config-test.ts docs/arch/05-data.md docs/arch/09-audit.md
git commit -m "fix: back up corrupt config.json before falling back to defaults"
```

---

### Task 3a: Per-line guards + drop counts (audit P0-3, half 1)

**Files:**
- Modify: `src/sessions/store.ts`
- Create: `scripts/hardening-sessions-test.ts`
- Modify: `docs/arch/05-data.md`

**Interfaces:**
- Consumes: Task 0 seam
- Produces: `safeParseLines<T>(text): { items: T[]; dropped: number }`; `loadSession`/`loadEvents` skip bad lines; `loadEvents` returns `{ events, dropped }`? — NO: keep return shapes stable (ruling: callers in two UIs use both; changing shapes ripples). Instead: `getLastParseDropped(): number` module counter set by each parse call? — simpler and honest: `safeParseLines` logs nothing, and `loadSession`/`loadEvents` emit `console.error('[sessions] skipped N corrupt lines in <file>')` when N > 0. Counts surfaced via log (grep-able by operators, no API ripple).

- [ ] **Step 1: RED — corrupt line today throws or corrupts**

Run: `HOME=$(mktemp -d)/h bun -e "import('./src/sessions/store.ts').then(async m => { const s = m.newSession('m','/tmp'); m.appendMessage(s, {role:'user', content:'hi', timestamp: Date.now()}); const {appendFileSync} = await import('fs'); const {join} = await import('path'); const {homedir} = await import('os'); appendFileSync(join(homedir(),'.forge','sessions',s.id+'.jsonl'), 'NOT-JSON{{{'); const back = m.loadSession(s.id); if (!back || back.messages.length !== 1) throw new Error('expected 1 good message, got ' + back?.messages.length); console.log('guards OK') })"`
Expected: FAIL (throw inside `loadSession`, proving the gap)

- [ ] **Step 2: GREEN — `safeParseLines` + use in `loadEvents`/`loadSession` + `console.error` count line when dropped > 0**

- [ ] **Step 3: Re-run proof (expect `guards OK`) + `bunx tsc --noEmit`**

- [ ] **Step 4: Persist proof as `scripts/hardening-sessions-test.ts`**

- [ ] **Step 5: Docs + commit** (`05-data.md` corrupt-line behavior; commit `fix: skip corrupt session lines with drop counts`)

---

### Task 5: TUI single persist-then-render path (audit P0-1)

**Files:**
- Modify: `src/tui/app.tsx:55-90`
- Create: `scripts/hardening-tui-test.ts`
- Modify: `docs/arch/07-ui.md`, `docs/arch/09-audit.md`

**Interfaces:**
- Consumes: `appendMessage()` from `src/sessions/store.ts`
- Produces: `send()` where every store write precedes its render append

- [ ] **Step 1: RED — ordering proof with a stubbed turn (no model needed)**

Script `scripts/hardening-tui-test.ts` (written first): stub `runChatTurn` result `{text, messages: [assistantMsg, toolMsg]}`, drive the *ordering invariant* by importing `appendMessage` + a fresh session under isolated HOME, appending exactly as `send()` does today (user msg → result.messages), and asserting store length === 2 assistant/tool + 1 user with user-first order. Against current code the render path builds a separate `asstMsg` object never persisted — assert `session.messages` contains an assistant message whose content equals the rendered text: FAIL today (rendered bubble diverges from stored history).

Concretely: the script replicates `send()`'s two append phases and fails if `props.session.messages` after the flow lacks the assistant text that was "rendered". (Exact stub code at implementation time — behavioral, tmp-HOME, exit non-zero on divergence.)

- [ ] **Step 2: GREEN — persist-then-render in `send()`**

```tsx
for (const m of result.messages) appendMessage(props.session, m)
setMessages(() => [...props.session.messages])
```

Error path (`catch` ⚠ bubble) and `finally` unchanged.

- [ ] **Step 3: Re-run proof + `bunx tsc --noEmit` + TUI boot probe that can actually fail**

Run: `timeout 10 bun src/main.tsx; echo "exit=$?"` — record the exit code in the ledger; any import/type error fails the task (no `|| true`).

- [ ] **Step 4: Docs + commit** (`07-ui.md` persist-then-render note; check off P0-1)

---

### Task 4: Bounded event loading, honestly labeled (audit P0-4 slice)

**Files:**
- Modify: `src/sessions/store.ts`, `docs/arch/05-data.md`, `04-runtime.md`, `09-audit.md`

**Interfaces:**
- Consumes: Task 3a `safeParseLines`
- Produces: `loadEvents(id, limit = MAX_EVENTS_LOAD)` slice; docs state the bound caps retained memory, not parse time; replay-narrowing truncation decision recorded

- [ ] **Step 1: RED — 5001-event file returns all 5001 today**

Proof: isolated HOME, append 5001 events via `appendEvent`, assert `loadEvents(id).length <= 500`. Expect FAIL (returns 5001).

- [ ] **Step 2: GREEN**

```ts
export const MAX_EVENTS_LOAD = 500
export function loadEvents(id: string, limit: number = MAX_EVENTS_LOAD): unknown[] {
  const file = join(sessionsDir, `${id}.events.jsonl`)
  if (!existsSync(file)) return []
  return safeParseLines<unknown>(readFileSync(file, "utf-8")).items.slice(-limit)
}
```

- [ ] **Step 3: Re-run + typecheck + caller check** (`grep -Rn "loadEvents(" src electron` — all 1-arg call sites get the default bound; note any 2-arg callers explicitly)

- [ ] **Step 4: Docs + commit** — `05-data.md` ("reads return latest 500; parse cost unchanged — full rotation is follow-up"); `04-runtime.md` truncation decision: renderer shows latest 500 with no indicator *for now* (recorded as accepted limitation, revisit with rotation); check off P0-4 slice.

---

### Task 3b: Quarantine moves — all three sidecars + manifest (audit P0-3, half 2)

**Files:**
- Modify: `src/sessions/store.ts`, `docs/arch/05-data.md`, `09-audit.md`

**Interfaces:**
- Consumes: 3a guards (fully-unreadable = `loadSession` still throws, e.g. unreadable file — not merely bad lines)
- Produces: `listSessions()` moves `<id>.jsonl` + `<id>.events.jsonl` + `<id>.meta.json` to `sessions/quarantine/` + appends one manifest line (`quarantine.log`: id, timestamp, reason) and continues; quarantined ids never silently vanish — manifest is the inventory

- [ ] **Step 1: RED — unreadable session file breaks `listSessions()`**

Proof: isolated HOME, `chmod 000` a session file (or write a directory at `<id>.jsonl` to force a read throw deterministically), assert `listSessions()` returns others + manifest line exists. Expect FAIL today (throw propagates).

- [ ] **Step 2: GREEN** — per-file try/catch in `listSessions`, move trio + manifest append, return null → filtered

- [ ] **Step 3: Re-run + typecheck + commit** (docs: quarantine inventory behavior)

---

### Gate: pre-flight quick-wins + full verification

- [ ] **Step 1: Pre-flight — behavioral quick-win checks** (merged ex-Task 1): `resolveProviders()` with duplicate id + disabled entry → assert first-wins + two skip records, no throw; `listMods()` against tmp dir with broken mod → assert `status:"failed"` + non-empty `error`. Asserts call the functions — no source reads.
- [ ] **Step 2: All hardening scripts green** (`bun scripts/hardening-*.ts`)
- [ ] **Step 3: `bunx tsc --noEmit`** (exit 0)
- [ ] **Step 4: Existing suites**: `bun scripts/mods-test.ts` (disabled/broken lines), `bun scripts/transparency-test.ts`, plus `scripts/providers-test.ts` **only if tracked** (`git ls-files scripts/providers-test.ts` non-empty) else ledger-drop RF5's pin with reason
- [ ] **Step 5: Commit only on fallout; else done**

---

## Self-Review (rev.2)

1. **Spec coverage:** P0-2 (Task 2), P0-3 (3a guards + 3b moves), P0-4 slice (Task 4), P0-1 (Task 5). Full disk rotation, P1/P2, turn IDs out of scope → future wave.
2. **No source-grep assertions anywhere** (red-team #1 fixed globally); every proof is behavioral under isolated HOME.
3. **Type consistency:** public shapes stable (`loadSession`, `loadEvents` return types unchanged; only added optional `limit`); drop counts via log lines, no API ripple (ruled in 3a).
4. **Review Focus:** 1→Task 2 proof; 2→3a proof (+manifest in 3b); 3→Task 5 stub proof; 4→Task 4 honest bound + truncation decision; 5→gate conditional on tracked file.
5. **Red-team findings disposition:** #1 fixed globally; #2 fixed (log lines + manifest + counts); #3 fixed (3b moves trio + manifest); #4 fixed (honest labeling + truncation decision); #5 fixed (all three references deleted); #6 fixed (dirty-tree constraint in Global Constraints).
