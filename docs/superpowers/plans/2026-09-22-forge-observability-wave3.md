# Forge Observability Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every behavior-changing or debugging-relevant action lands in `forge.log` + the events panel — no more terminal-only or vanished evidence.

**Architecture:** One new `notice` transparency event (`{type:'notice', callId, source, name, data, timestamp}`) flowing through the existing sinks (`logEvent`, per-session `appendEvent`, `transparencyEvent` hook, `transcript` ring, live push). Boot diagnostics replay as notices. Renderer gains two mechanical card branches (`notice`, tools in request card) following the existing `makeCard` pattern. No new containers, no new deps, no schema migrations.

**Tech Stack:** TypeScript (`tsc --noEmit`), Electron main + vanilla renderer JS (`node --check`), Bun scripts for behavioral proofs under isolated HOME.

**Spec:** Observability audit 2026-09-22 (9 numbered gaps); `docs/arch/04-runtime.md` (transcript ring); renderer chain `public/app.js:186-268` (unknown types safely skipped — verified by inspection).

## Global Constraints

- Redaction rule (non-negotiable): never log values of fields matching `/api_?key|secret|token|password/i` — log presence (`"<redacted>"`), never content. Applies to config, mod settings, hook payloads, CLI argv, integration bodies.
- Truncation rule: any `data` blob over 2000 chars is cut with `… [truncated N chars]` marker. Counts are exact, never silent.
- TDD with behavioral proofs (isolated HOME, exit non-zero on failure). No source-grep assertions.
- Renderer diffs stay mechanical (existing `makeCard` pattern); verified by `node --check` + `tsc`; headed-visual residual ledgered per task (no headed harness exists).
- Dirty tree: verify own lines per commit; docs in same commits.

## Review Focus

1. A `/command` run must leave a trace showing command, args, ok, and (truncated) output — expect a `notice{source:'command'}` in `forge.log`.
2. A config/mod/skill/model/cwd change must record before→after with secrets redacted — expect `notice{source:'config'|'mods'|'skills'|'model'|'cwd'}` and no secret values anywhere in the log.
3. Boot with broken mods/skipped providers must be visible to a terminal-less Electron user — expect the same lines as notices in the transcript on first load.
4. A hook throw must name the event, mod, and payload keys — expect `notice{source:'hooks'}` instead of console-only.
5. `request.settings` must show the effective thinking/transport/step-budget inputs — expect `providerOptions` + `maxSteps` keys present.

---

## File Structure

- Modify: `src/transparency/types.ts` — add `notice` member. Single responsibility: event vocabulary.
- Create: `src/transparency/notice.ts` — `notice(source, name, data?, callId?)` constructor (applies truncation rule). Single responsibility: one well-formed shape.
- Modify: `src/agent/loop.ts` — `request.settings` += `providerOptions` (effective reasoning flag) + `maxSteps: MAX_STEPS`.
- Modify: `src/harness/claude-code-cli-harness.ts` — same settings keys (its `providerOptions: {}` honest as `{cli:'subprocess'}` + maxSteps n/a note? — decided: `settings: { transport: 'cli-subprocess', allowedTools: ALLOWED_TOOLS }`).
- Modify: `electron/main.ts` — command/mutation/boot notices; CLI argv+resume notice at turn start.
- Modify: `src/mods/registry.ts` — hook-throw notice (event, mod, payload keys only).
- Modify: `src/integrations/*.ts` — outcome notices (counts ok, errors full).
- Modify: `public/app.js` — `notice` card branch + tools in request card body.
- Create: `scripts/observability-*.ts` proofs.

---

### Task 1: `notice` event + constructor + settings enrichment

**Files:** `src/transparency/types.ts`, `src/transparency/notice.ts`, `src/agent/loop.ts`, `src/harness/claude-code-cli-harness.ts`

- [ ] **Step 1: RED — construct + serialize round-trip fails (module missing)**

Run: `bun -e "import('./src/transparency/notice.ts').then(m => console.log('exists'))"`
Expected: `Cannot find module` (feature missing)

- [ ] **Step 2: GREEN — types + constructor**

```ts
// types.ts — append to TransparencyEvent union:
| { type: "notice"; callId: string; source: string; name: string; data: unknown; timestamp: number }
```

```ts
// notice.ts
const SECRET = /api_?key|secret|token|password/i
const MAX = 2000
const redact = (v: unknown): unknown => {
  if (typeof v === "string") return v
  if (Array.isArray(v)) return v.map(redact)
  if (v !== null && typeof v === "object")
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SECRET.test(k) ? "<redacted>" : redact(val)]))
  return v
}
export const truncate = (s: string): string => (s.length > MAX ? s.slice(0, MAX) + `… [truncated ${s.length - MAX} chars]` : s)
export const notice = (source: string, name: string, data: unknown = {}, callId = "") => ({
  type: "notice" as const, callId, source, name, data: redact(data), timestamp: Date.now(),
})
```

- [ ] **Step 3: Behavioral proof — redaction + truncation + round-trip through `logEvent`**

Run a script asserting: `{apiKey:'x', nested:{token:'y'}, ok:true}` → values become `"<redacted>"`, keys preserved; 5000-char string → cut with exact marker math; constructed event `JSON.parse(JSON.stringify(e))` deep-equals (log-safe). Expect all PASS.

- [ ] **Step 4: Settings enrichment (both harnesses)**

loop.ts settings += `providerOptions: opts.thinking && capabilities?.reasoningEffort ? { reasoningEffort: "high" } : {}` and `maxSteps: MAX_STEPS` (export the const if not already). CLI harness settings → `{ transport: "cli-subprocess", allowedTools: ALLOWED_TOOLS }`.

- [ ] **Step 5: `bunx tsc --noEmit` (exit 0) + commit** (`feat: notice event, redacting constructor, richer request settings`)

---

### Task 2: Command executions leave a trace (audit #1)

**Files:** `electron/main.ts` (`forge:command` + `forge:chat` turn tagging for notices), docs

- [ ] **Step 1: RED — run `/cd /tmp` equivalent path and find zero trace**

Proof script: invoke the command-dispatch logic? Headless IPC unavailable — prove at the seam instead: assert `forge.log` gets no entry today by simulating the handler's current outputs (no emit call exists in `forge:command` — behavioral assert: today's handler returns `{ok,text}` without touching any sink; pin by driving a `/cd <tmpdir>` through a harness-level call? Honest approach: RED = a script that scans a fresh isolated-HOME `forge.log` after a command run is impossible headless → **rule it**: command-trace proof runs post-implementation by invoking the extracted `runCommand(text)` helper (see Step 2) directly with a stub session. Ledger the extraction as the testability seam.

- [ ] **Step 2: GREEN — extract `runCommand()` + emit notices**

Extract the `/cd` + mod-dispatch body of `forge:command` into a testable `runCommand(text): Promise<{ok, text}>` in `electron/commands.ts` (pure w.r.t. Electron — takes `{session, registry}` params, no `ipcMain`/`win`). Handler becomes emit-wrap: on result, `notice('command', name, {args, ok, output: truncate(text)})` through the turn-tagged emit path (same `appendEvent` + transcript + push as chat turns, tagged with current turn index).

- [ ] **Step 3: Behavioral proof** — isolated HOME, stub session + registry with a `ping` command: `runCommand('/ping x')` → returns ok + a `notice{source:'command', name:'ping'}` captured by a stub emit sink with truncated output; `/cd /nonexistent` → ok:false notice. Then `tsc` + commit.

---

### Task 3: Mutations logged with redaction (audit #2)

**Files:** `electron/main.ts` (handlers: `setConfig`, `setModScopedEnabled/Settings`, `setSkillLoaded`, `setModel`, `/cd` success path via Task 2 helper)

- [ ] **Step 1: RED — proof that a `setConfig` round-trip today leaves no record**

Script: isolated HOME, diff `forge.log` line count before/after a simulated old→new config write through the handler logic (extract `applyConfig(next)` helper the same way as Task 2 if needed — rule it in ledger). Expect zero new lines today.

- [ ] **Step 2: GREEN — one notice per mutation, before→after, redacted**

Each handler emits `notice(source, key, {before, after})` where both sides pass through the Task 1 redactor (config `apiKey` → `"<redacted>"`; mod settings values scanned by key name). `/cd` emits `notice('cwd', session.id, {before, after})`.

- [ ] **Step 3: Behavioral proof** — stub-sink run: set config with `apiKey: 'SECRET-ABC'` → notice captured, serialized form contains `"<redacted>"` and never `SECRET-ABC` (assert on the JSON string). Toggle a mod off/on → two notices with correct before/after. Then `tsc` + commit.

---

### Task 4: Boot replay for terminal-less users (audit #6+7)

**Files:** `electron/main.ts` (`boot()`), `src/main.tsx` (TUI prints already — no change), docs

- [ ] **Step 1: RED — boot with broken mod fixture leaves transcript empty today**

Proof: boot is not drivable headless → rule it (ledger): extract `collectBootNotices(config, modLoadResult, skipped): Notice[]` pure function; RED = it doesn't exist (import error).

- [ ] **Step 2: GREEN — pure collector + wire-in**

`collectBootNotices` returns one notice per: mods dir, each loaded batch (single `mods.loaded` notice with array — not per-mod spam), each failed mod (name + error), each skipped provider (id + reason), plus session-resilience lines from Wave 1 (`[sessions]`/`[config]` console lines stay AND gain notice twins? — decided: console lines stay for terminal users; notices are the UI path, same text). `boot()` pushes them into `transcript` (so `getTranscript` + first paint include them) and `logEvent`s each.

- [ ] **Step 3: Behavioral proof** — call `collectBootNotices` with fabricated `{loaded:['a'], failed:[{name:'b',error:'boom'}], skipped:[{id:'x',reason:'disabled'}]}` → assert 1+1+1+1 notices with exact texts; assert no secret-shaped values pass through (feed a fake apiKey in settings → redacted). Then `tsc` + commit.

---

### Task 5: Hook failures, CLI argv, integration outcomes (audit #3+4+5)

**Files:** `src/mods/registry.ts`, `src/harness/claude-code-cli-harness.ts`, `src/integrations/quest-tracker.ts`, `src/integrations/bitbucket.ts`

- [ ] **Step 1: RED — throwing hook today only hits console**

Proof: register a throwing `beforeTurn` hook on a unique mod name, `emitHook`, capture console? — behavioral seam: today no sink receives anything. Assert a stub `transparencyEvent` listener receives zero hook-failure signals. Expect the zero (pins current behavior; GREEN makes it one).

- [ ] **Step 2: GREEN**
  - registry `emitHook` catch block: `emitSink?.(notice('hooks', 'hook-failed', {event, mod: modName, payloadKeys: Object.keys(payload ?? {})}))` — keys only, never values (payloads contain full message histories).
  - CLI harness turn start: `notice('cli', 'turn-start', {model, argvFlags: args.filter(a => !a.startsWith('-') ? false : true), resumeId: resumeId ?? null})` — flags only, never `userText` (already in session) — plus rate-limit/error outputs as `notice('cli','turn-error', {message})` where stream-json already surfaces them.
  - Integrations: `fetchQuestPreview`/`fetchPrInboxPreview` return `{ok, count}`-shaped summaries; on success `notice('integrations','preview-ok',{which,count})`, on throw `notice('integrations','preview-error',{which,message})` at call sites in `electron/main.ts` handlers.

- [ ] **Step 3: Behavioral proofs per bullet (stub sinks, isolated HOME) + `tsc` + commit**

---

## Rendering contract (locked 2026-09-22, implemented in `public/app.js`)

- Turn-less notices (`turn` absent: boot, and any notice emitted outside a turn) render as **feed-end appends** in both `replayEvents` and live `onTransparency` — never anchored, never dropped.
- Turn-tagged notices (commands, mutations, hooks: `turn = session.messages.length` at emit time) anchor like other events via the existing `byTurn` grouping.
- `boot()` fetches `getTranscript()` and appends its notices feed-end (boot diagnostics visible on first paint; re-emitted every launch by design — transcript is per-process memory, `forge.log` is the durable record).
- Request card bodies (both functions) include `tools`, falling back to `"(not recorded — pre Wave-3)"` for old persisted events.
- Producer tasks MUST follow the turn-tag rule above; renderer changes stay mechanical (`makeCard` pattern), verified by `node --check` + headed-visual residual (no headed harness exists).

### Task 6: Renderer — notice cards + tools in request card (audit #9 completion)

**Files:** `public/app.js` (two mechanical branches, `makeCard` pattern)

- [ ] **Step 1: RED — `node --check` passes today (baseline), so RED is the missing-behavior probe**

Ledger it honestly: no headed harness exists; RED = a script feeding a `notice` event object through the *extracted* card-summary logic? `replayEvents` is DOM-bound — rule it (ledger): renderer diffs verified by `node --check` + exact-pattern review + headed visual residual. Do not dress parse-passing as behavior-proven.

- [ ] **Step 2: GREEN — two branches**

```js
} else if (e.type === "notice") {
  const c = makeCard("notice", `🔔 ${e.source} · ${e.name}`)
  c.body.textContent = JSON.stringify(e.data, null, 2)
  anchor.before(c.card)
}
```

Request card body: `{ settings: e.settings, system: e.system, messages: e.messages, tools: e.tools }` (tools may be absent on old persisted events — `e.tools ?? "(not recorded — pre Wave-3)"`).

- [ ] **Step 3: `node --check public/app.js` + `tsc` + commit** (`feat: render notice events and request tool schemas`)

---

### Gate

- [ ] All `scripts/observability-*.ts` + `scripts/hardening-*.ts` green (isolated HOME each)
- [ ] `bunx tsc --noEmit` exit 0; `node --check public/app.js`
- [ ] `bun scripts/mods-test.ts` (disabled/broken lines), `bun scripts/transparency-test.ts`
- [ ] `grep -Rni "apiKey.*SECRET\|SECRET-ABC" ~/.forge/logs/forge.log` equivalent on a seeded run? — decided: redaction proof in Task 3 covers it; gate re-runs Task 3's proof (no live-log grep needed)
- [ ] Commit only on fallout

---

## Self-Review

1. **Spec coverage:** audit #1→T2, #2→T3, #6+7→T4, #3+4+5→T5, #8→T1-settings, #9→T6. Nothing unmapped.
2. **No source-grep assertions**; every proof behavioral except T6 renderer (ledgered honestly with parse + pattern review + headed residual).
3. **Type consistency:** `notice()` returns the exact `notice` union member (literal `type` + full fields); `settings` stays `Record<string, unknown>` so additions compile everywhere; renderer tolerates absent `tools` on old events.
4. **Review Focus:** 1→T2 proof, 2→T3 proof (string-level secret assert), 3→T4 proof, 4→T5 proof, 5→T1 proof (assert `providerOptions` + `maxSteps` keys on a captured request event).
