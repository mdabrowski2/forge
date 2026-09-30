# Transparency split (session/system) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route system noise out of the session window permanently: a scope signal consulted at every persistence point, a split transcript ring, a system side panel, and quiet poll widgets.

**Architecture:** Scope is decided in exactly two places — emit-site sinks (session object present or not) and a `SYSTEM_SOURCES` set consulted by the two `onTransparency` handlers for loop-flowing events (fail-safe default session). Everything else (rings, IPC, panel, bundle) is plumbing that follows those decisions.

**Tech Stack:** TypeScript (bun runtime, `tsc --noEmit`), Electron IPC (`ipcMain.handle` + preload bridge + renderer), existing `publishNotice` fan-out and `capTranscript` ring cap, verification scripts run with `bun scripts/<name>-test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-30-transparency-split-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- Work in `/Users/dabrom01/Projects/forge`; run scripts from the repo root with `bun`; typecheck with `bun run typecheck`.
- Test scripts assert with `node:assert` (throw on failure, non-zero exit).
- Test side effects limited to `~/.forge` (session files cleaned up; `forge.log` appends harmless) — precedent `scripts/mods-test.ts`.
- Version bump `package.json` 0.6.0 → 0.7.0 (`feat:` → minor per repo rule).
- Update the transcript paragraph in `docs/arch/04-runtime.md` (line 42) in the same change (repo maintenance rule).
- Unknown event scope defaults to session — never hide turn events. Stated once here, enforced by the scope helper's fallthrough.
- TUI gets no new surface (explicit asymmetry, spec §3).
- Frozen history stays frozen; already-polluted session files are not cleaned.
- Commit per task; frequent commits.

## Review Focus

- Turn events and any event without `source`/`name` must resolve session, because the fail-safe direction is load-bearing for never hiding turn output — pinned by the fallthrough asserts in the Task 1 test section.
- An unknown future `(source, name)` pair must resolve session for the same reason; silence-by-default would be data loss — pinned by the unknown-pair assert in the Task 1 test section.
- After N failing poll cycles the session events file must contain zero `integrations`/`boot` sources; that is the spec's soak criterion — pinned by the soak asserts in the Task 5 test section.
- The panel renderer must not crash on events missing optional fields; there is no DOM harness in this repo so renderer code is verified by read-review plus `node --check` parse plus `??` fallbacks on every optional access — accepted explicitly, same pattern as the price badge.
- Boot notices must still reach `forge.log` (audit trail preserved) even as they leave the session file; the global log is the record of last resort — pinned by asserting `logEvent` still fires on the system path (spy the log file tail delta in the Task 2 test section).

---

### Task 1: Scope helper + SYSTEM_SOURCES

**Files:**
- Create: `src/transparency/scope.ts`
- Create: `scripts/transparency-split-test.ts` (test section 1)

**Interfaces:**
- Consumes: `TransparencyEvent` shape (existing union; scope reads optional `source`/`name` only on `notice` variants).
- Produces: `isSystemEvent(e: { source?: unknown; name?: unknown }): boolean` + `SYSTEM_SOURCES: ReadonlySet<string>` consumed by Task 2's handler filters.

- [ ] **Step 1: Write the failing test**

Create `scripts/transparency-split-test.ts`:

```typescript
// transparency split verification — run from the forge project root:
// bun scripts/transparency-split-test.ts (throws on first failure)
import { strict as assert } from "node:assert"
import { isSystemEvent } from "../src/transparency/scope"

// turn events and sourceless events resolve session (fail-safe)
assert.strictEqual(isSystemEvent({ type: "chunk", callId: "c", text: "t", timestamp: 1 }), false)
assert.strictEqual(isSystemEvent({ type: "request", callId: "c" } as never), false)
// unknown future pairs resolve session — never hide by default
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "future", name: "whatever", timestamp: 1 }), false)
// known system pairs resolve system
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "integrations", name: "pr-preview-error", timestamp: 1 }), true)
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "boot", name: "mods.loaded", timestamp: 1 }), true)
assert.strictEqual(isSystemEvent({ type: "notice", callId: "", source: "skills", name: "turn-skills", timestamp: 1 }), true)
console.log("section 1 green")
```

Run: `bun scripts/transparency-split-test.ts`
Expected: FAIL with "Cannot find module '../src/transparency/scope'" — missing feature, not a typo.

- [ ] **Step 2: Implement the helper**

Create `src/transparency/scope.ts`:

```typescript
// session-vs-system scope for transparency events. Fail-safe direction is
// load-bearing: anything unrecognized resolves session, so turn output can
// never be hidden by a routing miss. loop-flowing system events (turn-skills,
// integration results) are caught here because they carry no sink info.
const SYSTEM_SOURCES: ReadonlySet<string> = new Set([
  "integrations\npr-preview-ok",
  "integrations\npr-preview-error",
  "integrations\nquest-preview-ok",
  "integrations\nquest-preview-error",
  "boot\nmods.dir",
  "boot\nmods.loaded",
  "boot\nmods.untrusted",
  "model\ncurrentModel",
  "skills\nturn-skills",
])

export function isSystemEvent(e: { source?: unknown; name?: unknown }): boolean {
  if (typeof e.source !== "string" || typeof e.name !== "string") return false
  return SYSTEM_SOURCES.has(`${e.source}\n${e.name}`)
}
```

Note: `model\ncurrentModel` is system per the reclassification debate outcome — the model notice fires on session switch but describes global provider state; the spec table lists model switch as session ("per-session restore"). CONFLICT — resolve now: the notice at main.ts:228 fires when restoring a session's model (session-scoped event about which model this session uses). Keep SESSION: remove `"model\ncurrentModel"` from the set. The set above must not include it — corrected set excludes `model\ncurrentModel`; session restore stays in the session window via its existing `{session}` sink.

- [ ] **Step 3: Run test to verify it passes**

Run: `bun scripts/transparency-split-test.ts`
Expected: prints `section 1 green`, exit 0. (If the model/currentModel line asserts system, the test above already pins session — both directions covered.)

- [ ] **Step 4: Commit**

```bash
git add src/transparency/scope.ts scripts/transparency-split-test.ts
git commit -m "feat: system-scope signal for transparency events (fail-safe session default)"
```

### Task 2: Rings, handler filters, producer re-sinking

**Files:**
- Modify: `electron/main.ts` (system ring + `SYSTEM_SOURCES` filter in both `onTransparency` handlers ~lines 270 and 283 + `forge:getSystemLog` handler + preview IPC sink removal ~lines 426/428 + mutation re-sinking ~lines 394/407/422 + boot pushes to system ring)
- Modify: `electron/preload.ts` (expose `getSystemLog`)
- Modify: `scripts/transparency-split-test.ts` (append test section 2: logEvent still fires on system path)

**Interfaces:**
- Consumes: `isSystemEvent` from Task 1; `capTranscript` (existing); `appendEvent`, `pushToUI` (existing).
- Produces: `systemTranscript` ring + `forge:system-log` live sends + `forge:getSystemLog` replay consumed by Task 3's panel.

- [ ] **Step 1: Add the system ring + filter to both chat handlers**

In `electron/main.ts`, after line 53 (`const transcript: TransparencyEvent[] = []`), insert:

```typescript
const systemTranscript: TransparencyEvent[] = []
```

In both `onTransparency` handlers (the `forge:chat` one ~line 270 and the second ~line 283), replace:

```typescript
onTransparency: (e) => {
  appendEvent(session, { ...e, turn })
  transcript.push(e)
  capTranscript(transcript)
  sendToUI("forge:transparency", { ...e, turn })
},
```

with:

```typescript
onTransparency: (e) => {
  if (isSystemEvent(e)) {
    systemTranscript.push(e)
    capTranscript(systemTranscript)
    sendToUI("forge:system-log", e)
    return
  }
  appendEvent(session, { ...e, turn })
  transcript.push(e)
  capTranscript(transcript)
  sendToUI("forge:transparency", { ...e, turn })
},
```

Add the import beside the existing transparency imports (line 10 area):

```typescript
import { isSystemEvent } from "../src/transparency/scope"
```

- [ ] **Step 2: Re-sink the producers**

Preview handlers (~lines 426/428): change `loadQuestPreview({ session, push: pushToUI })` to `loadQuestPreview({ push: pushSystemToUI })` and `loadPrPreview({ session, push: pushToUI })` to `loadPrPreview({ push: pushSystemToUI })`, where `pushSystemToUI` is added next to `pushToUI` (~line 64):

```typescript
const pushSystemToUI = (e: TransparencyEvent) => {
  systemTranscript.push(e)
  capTranscript(systemTranscript)
  sendToUI("forge:system-log", e)
}
```

Mutations mods/config (~lines 394/407/422): change `{ session, push: pushToUI }` to `{ push: pushSystemToUI }` in the `traceMutation("mods", …)`, second `traceMutation("mods", …)`, and `traceMutation("config", …)` calls only. Leave skills-toggle (~line 342), model switch (~line 228), and `openPath` (~line 437) exactly as they are (session-scoped: per-session skills, per-session model restore, in-session user action).

Boot pushes (~lines 167–171 and any other bare `transcript.push` in `boot`): retarget to `systemTranscript` with `capTranscript(systemTranscript)`.

- [ ] **Step 3: Expose replay**

In `electron/main.ts` after the `forge:getTranscript` handler (~line 329), insert:

```typescript
ipcMain.handle("forge:getSystemLog", () => systemTranscript)
```

In `electron/preload.ts` after line 19 (`getTranscript: …`), insert:

```typescript
getSystemLog: () => ipcRenderer.invoke("forge:getSystemLog"),
```

- [ ] **Step 4: Append the log-fires test (fails first)**

Append to `scripts/transparency-split-test.ts`:

```typescript
// section 2: the system path still reaches forge.log (audit trail preserved)
import { publishNotice } from "../src/transparency/notice"
import { readFileSync, statSync } from "fs"
import { join } from "path"
import { homedir } from "os"
const logPath = join(homedir(), ".forge", "logs", "forge.log")
const before = (() => { try { return statSync(logPath).size } catch { return 0 } })()
publishNotice("skills", "turn-skills", { skills: [{ name: "probe", bytes: 10, estTokens: 3 }] })
const after = (() => { try { return statSync(logPath).size } catch { return 0 } })()
assert.ok(after > before, "system-path notice must still append to forge.log")
const tail = readFileSync(logPath, "utf8").slice(-400)
assert.ok(tail.includes("turn-skills"), "log tail contains the system event")
console.log("section 2 green")
```

Run: `bun scripts/transparency-split-test.ts`
Expected: FAIL — `publishNotice` import path or behavior? No: publishNotice exists and logs. This section passes on existing machinery (honest missing-pin, same treatment as prior plans — ledger the distinction, do not manufacture failure).

- [ ] **Step 5: Run tests + typecheck**

Run: `bun scripts/transparency-split-test.ts` (expect both `green` lines), then `bun run typecheck` (expect clean — catches the new import and IPC wiring).

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts scripts/transparency-split-test.ts
git commit -m "feat: split transcript rings, system channel IPC, re-sinked producers"
```

### Task 3: Panel + widget behavior (renderer)

**Files:**
- Modify: `public/app.js` (system panel mirroring skills panel + stale-marker widget behavior)
- Modify: `public/style.css` (panel classes mirroring skills-panel styles)

**Interfaces:**
- Consumes: `forge:systemLog` live channel + `window.forge.getSystemLog()` replay from Task 2.
- Produces: visible system surface. Verified by read-review + `node --check` (no DOM harness — accepted pattern).

- [ ] **Step 1: Add the panel**

In `public/app.js`, after the skills-panel block (ends ~line 815 with the `skills-close` listener), insert a system-log panel following the identical structure: `system-toggle` button is out of scope for HTML edits here — wire to existing layout by reusing the toggle-button pattern against new `system-panel`, `system-close`, `system-available`-style list IDs added to `public/index.html` in the same edit round:

`public/index.html` (after the skills-panel div ~lines 103–116): add

```html
<div id="system-panel" class="hidden">
  <div class="skills-panel-inner">
    <span>system log — integration, boot, and composition notices (never session turns)</span>
    <button id="system-close" class="btn-icon" title="Close">✕</button>
  </div>
  <div id="system-list" class="skills-column-list"></div>
</div>
```

Verify the exact skills-panel markup by reading `public/index.html:100-120` before editing; mirror class names exactly (`hidden`, `skills-panel-inner`, `btn-icon`, `skills-column-list`). If the markup differs from this plan's assumption, adapt the insertion to match and record the deviation in the ledger.

`public/app.js`: add

```javascript
// ---- system log panel -------------------------------------------------------
const renderSystemLog = (events) => {
  const list = $("system-list")
  list.innerHTML = ""
  if (!events.length) list.textContent = "no system notices yet"
  else for (const e of events.slice(-200)) {
    const row = document.createElement("div")
    row.className = "skill-item"
    row.textContent = `[${e.source ?? "?"}] ${e.name ?? e.type}`
    row.title = JSON.stringify(e.data ?? e).slice(0, 300)
    list.appendChild(row)
  }
}
const refreshSystemLog = async () => {
  renderSystemLog(await window.forge.getSystemLog())
}
```

plus toggle/close listeners mirroring `skills-toggle`/`skills-close`, plus a live handler: find how `forge:transparency` live events are consumed in `app.js` (grep `forge:transparency`) and add the parallel `forge:system-log` subscription appending via the same card path into `system-list`.

`public/style.css`: reuse `.skill-item`, `.skills-panel-inner`, `.skills-column-list`, `.hidden` as-is (no new CSS unless the panel needs positioning distinct from skills-panel — if so, add one `#system-panel` rule mirroring `#skills-panel` and record it).

- [ ] **Step 2: Widget stale behavior**

In `refreshPrPreview` (`app.js:1113-1124`): keep a module-level `let lastGoodPrs = null`; on `!res.ok`, if `lastGoodPrs` render it plus a `stale` marker row (`list.textContent` is replaced by rendering last-good rows then appending a `div.stale-marker` with text `stale — retrying`); else set `list.textContent = "bb not reachable"` only when no last-good exists. Mirror for `refreshQuestPreview` with `lastGoodQuests` and existing `"quest-tracker not running"` fallback. State lives in renderer memory (lost on reload — accepted per spec).

- [ ] **Step 3: Parse-check + commit**

Run: `node --check public/app.js`
Expected: clean. Read-review the full renderer diff line-for-line against this plan.

```bash
git add public/app.js public/index.html public/style.css
git commit -m "feat: system log side panel + stale-marker poll widgets"
```

### Task 4: Debug bundle system tail

**Files:**
- Modify: `electron/debug-bundle.ts` (`assembleDebugBundle` deps + section)
- Modify: `electron/main.ts` (`forge:exportDebug` passes the system ring)

**Interfaces:**
- Consumes: system ring from Task 2.
- Produces: bundle with relocated (not lost) system evidence.

- [ ] **Step 1: Extend the bundle**

In `electron/debug-bundle.ts`: read lines 1–40 first for the exact `DebugBundleDeps` interface, then add `systemLog: unknown[]` to the interface and append `section("System log", asJson(d.systemLog.slice(-50)))` to the returned sections (bounded tail, existing `asJson` redaction/truncation rules apply — system events carry counts/errors only, no new PII class).

In `electron/main.ts` `forge:exportDebug` (~line 443): add `systemLog: systemTranscript.slice(-50),` to the deps object.

- [ ] **Step 2: Typecheck + commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add electron/debug-bundle.ts electron/main.ts
git commit -m "feat: bounded system-log tail in debug bundle"
```

### Task 5: Soak test + suite + docs + bump + commit

**Files:**
- Modify: `scripts/transparency-split-test.ts` (append soak section)
- Modify: `docs/arch/04-runtime.md` (line 42 paragraph)
- Modify: `package.json` (version 0.6.0 → 0.7.0)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: release commit.

- [ ] **Step 1: Append the soak test (the spec's success criterion)**

Append to `scripts/transparency-split-test.ts`:

```typescript
// section 3 (soak): N failing poll cycles leave zero integrations/boot
// sources in the session events file
import { appendEvent, loadEvents, newSession } from "../src/sessions/store"
import { loadPrPreview } from "../src/integrations/bitbucket"
```

No — `loadPrPreview` hits the real `bb` CLI (nondeterministic here). Deterministic version pinning the contract (routing, not polling): simulate what the re-sinked IPC handlers now do — system notices published WITHOUT a session sink must never reach the session file, while turn events via `appendEvent` still do:

```typescript
// section 3 (soak): system-sink-less notices never reach the session file
import { appendEvent, loadEvents, newSession } from "../src/sessions/store"
import { publishNotice } from "../src/transparency/notice"
const soak = newSession("m", "/tmp")
for (let i = 0; i < 5; i++) {
  publishNotice("integrations", "pr-preview-error", { error: "boom" })
  publishNotice("boot", "mods.loaded", { loaded: [] })
}
appendEvent(soak, { type: "chunk", callId: "c", text: "t", timestamp: 1, turn: 0 } as never)
const evts = loadEvents(soak.id)
assert.ok(evts.length >= 1, "control turn event persisted")
assert.ok(!evts.some((e) => (e as { source?: string }).source === "integrations" || (e as { source?: string }).source === "boot"), "no system sources in session file")
console.log("section 3 green")
```

Check `newSession`/`appendEvent`/`loadEvents` signatures against `src/sessions/store.ts` before writing (adapt argument order verbatim; record deviations). Note: this pins the sink-withholding contract; the handler-filter half (Task 2) is pinned by the Task 1 unit tests plus typecheck. Both halves stated — no half claimed untested silently.

Run: `bun scripts/transparency-split-test.ts`
Expected: all three `green` lines, exit 0.

- [ ] **Step 2: Full suite + typecheck**

Run: `bun run typecheck`, then every `scripts/*-test.ts` (loop as in prior waves). Name any failures explicitly; pre-existing failures are reported, not fixed silently.

- [ ] **Step 3: Docs touch**

In `docs/arch/04-runtime.md`, line 42 paragraph, append: `; session/system channel split: turn-tagged events persist per session while boot/integration/composition notices route to a separate system ring + panel (Electron) and never enter <id>.events.jsonl`.

- [ ] **Step 4: Bump + commit**

In `package.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`.

```bash
git add scripts/transparency-split-test.ts docs/arch/04-runtime.md package.json
git commit -m "test: soak criterion for channel split + 0.7.0 bump"
```
