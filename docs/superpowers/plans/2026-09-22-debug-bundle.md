# Debug bundle export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One button exports an agent-ready Markdown debug bundle (no secrets) via save-dialog.

**Architecture:** Pure `assembleDebugBundle(deps): string` in `electron/debug-bundle.ts` (all inputs injected: version, platform, config, providers, mods, log tail, session messages/events) + thin IPC handler (`dialog.showSaveDialog` default `~/Downloads/forge-debug-<epoch>.md`, `shell.showItemInFolder` on success) + preload bridge + toolbar button. No new deps, no persistence changes.

**Tech Stack:** TypeScript, Electron dialog/shell, Bun proof scripts under isolated HOME.

**Spec:** This section + user brief 2026-09-22 (agent-first format, redaction mandatory, save-dialog destination).

## Global Constraints

- Redaction scope (binding): REDACTED — config object, mod settings values, provider credential fields (key-based match). VERBATIM BY DESIGN — conversation text, tool I/O, log history (key-based redaction cannot see free text; user-pasted secrets pass through). The bundle header carries a one-line disclaimer: "review before sharing — conversation text is included verbatim."
- Truncation rule: log tail = trailing 64KB byte-cap walked back to a line boundary, then last 200 lines; session messages capped at last 100 + count line; events at the 500-load default; any single blob over 2000 chars cut with marker (same conventions as notices).
- TDD with behavioral proofs; dirty tree (verify own lines per commit); docs touch: `docs/arch/07-ui.md` one-liner (button location).

## Review Focus

1. A config containing `apiKey: 'LIVE-SECRET'` must produce a bundle whose serialized text never contains the value — expect grep-absence + `<redacted>`-presence on the assembled string.
2. A bundle assembled with empty sessions/mods/providers must still render all sections with `(none)` placeholders — expect no throw, all six headers present.
3. The save flow must report cancel vs write-failure distinctly — expect `{ok:true, path}` | `{ok:false, cancelled:true}` | `{ok:false, error}` (no silent swallow).
4. Old consumers untouched: preload additions only, no bridge renames; `forge.log` read-only (never truncated/moved by export).

---

## File Structure

- Create: `electron/debug-bundle.ts` — `assembleDebugBundle(deps): string` + `DebugBundleDeps` interface. Single responsibility: deterministic Markdown assembly, zero Electron imports (headless-testable).
- Modify: `electron/main.ts` — `forge:exportDebug` handler (gather live state → assemble → save dialog → show-in-folder). `electron/preload.ts` — `exportDebug` bridge. `public/app.js` + `public/index.html` — toolbar button + wiring.
- Create: `src/transparency/notice.ts` already exports the redactor? — check first: `redactValue` is currently module-private; export it (no duplication of the regex). `src/transparency/log.ts` must export `logFile` (currently module-private) — no duplicated path join.
- Create: `scripts/debug-bundle-test.ts` — RED-first behavioral proof (Task 1 Step 1).
- Modify: `docs/arch/07-ui.md` — button location one-liner.

---

### Task 1: Assembler + proof (RED → GREEN)

**Files:** `electron/debug-bundle.ts`, `scripts/debug-bundle-test.ts`

- [ ] **Step 1: RED — proof against missing module**

Write the proof first: fabricate deps (version `9.9.9-test`, config with `apiKey: 'LIVE-SECRET'`, 1 provider, 1 failed mod, 3 log lines, empty session) → `assembleDebugBundle(deps)` → assert six `## ` headers, `<redacted>` present, `LIVE-SECRET` absent, `(none)` placeholders for empty events. Run: `bun scripts/debug-bundle-test.ts` → expect `Cannot find module`.

- [ ] **Step 2: GREEN — implement assembler**

```ts
// Deps: { version, platform, dateISO, config, providers: {id,name,status,models}[],
//         mods: ModInfo[], logTail: string[], messages: ChatMessage[], events: unknown[] }
```

Sections in order: `# Forge debug bundle`, `## Environment` (version/platform/date), `## Providers`, `## Mods`, `## Config (redacted)`, `## Session messages`, `## Session events`, `## Log tail`. Redaction via shared helper from `notice.ts` (export `redactValue` if private — check first, don't duplicate). Truncate blobs >2000 chars with the notice marker convention.

- [ ] **Step 3: Re-run proof (expect PASS) + `tsc` note** (electron/ outside tsconfig include — verify via `electron:build` instead)

- [ ] **Step 4: Commit** (`feat: debug bundle assembler with redaction proof`)

### Task 2: Handler + bridge + button + docs

**Files:** `electron/main.ts`, `electron/preload.ts`, `public/app.js`, `public/index.html`, `docs/arch/07-ui.md`

- [ ] **Step 1: Handler** — gather (`config`, harnesses list, `listMods`, byte-capped tail of exported `logFile`, last 100 `session.messages` + `loadEvents(session.id)`), assemble, `dialog.showSaveDialog({defaultPath: join(app.getPath('downloads'), `forge-debug-<epoch>.md`)})` (`~` never expands — `app.getPath` is the only correct source); on accept write + `shell.showItemInFolder`. Return the Review-Focus-3 tri-state. **Ruling (pre-made):** cancel is user intent, not an error — `{ok:false, cancelled:true}`, no log line.

- [ ] **Step 2: Bridge + button** — preload `exportDebug`; toolbar button next to events-toggle (`🐞 report`), click → `exportDebug()` → on `{ok:false}` without `cancelled`, reuse the mods-panel save-button feedback pattern (`saveBtn.textContent` swap + `setTimeout` restore, `public/app.js` mods row).

- [ ] **Step 3: Verify** — `electron:build` clean, `node --check public/app.js`, headed residual: click button, cancel (no file), accept (file opens in folder, six headers, redacted), then hand-grep the accepted file for your real `apiKey` value once (trust-but-verify the redactor on non-fabricated data). Residual ledgered (no headed harness).

- [ ] **Step 4: Docs + commit** (`07-ui.md` button one-liner; `feat: exportable agent-ready debug bundle`)

### Gate — SHIPPED

Proof green, build clean, parse clean; headed residual performed by user: cancel/accept/show-in-folder, six headers, hand-grep clean, disclaimer present.

---

## Self-Review

1. **Spec coverage:** agent-first Markdown ✓, redaction ✓ (RF1), empty-state ✓ (RF2), cancel/failure tri-state ✓ (RF3), bridge additive ✓ (RF4).
2. **No placeholders**; every step names files, code, commands, expected outputs.
3. **Type consistency:** `DebugBundleDeps` defined once in Task 1, consumed in Task 2; `ModInfo` reused from loader; notice-marker convention referenced, not redefined.
4. **Review Focus:** 1→Task 1 proof (serialized grep-absence), 2→Task 1 empty-session case, 3→Task 2 tri-state, 4→additive-only constraint + build check.
