# 08 — Integrations

Both optional and read-only. Neither blocks chat when down.

## Quest tracker (`src/integrations/quest-tracker.ts`)

Quest tracker is a separate local task app the user runs themselves. Forge shows a small summary (preview) in its header badge via `fetchQuestPreview()` → `forge:questPreview` IPC, and can embed the full tracker page (expected at `http://localhost:3060` by default) as a modal sub-pane: `openQuestTracker` creates the embed once and reuses it, positioned below a 48px modal header with 40px outer margin (`QUEST_MODAL_MARGIN/HEADER`, `electron/main.ts:38-39`), re-measured on window resize; `closeQuestTracker` detaches it.
- Failure mode (built behavior): tracker not running → the embed shows the browser's own connection error; Forge adds no timeout/retry (hardening in `09-audit.md#P1-10`).

## Bitbucket (`src/integrations/bitbucket.ts`)

Pull-request (PR) inbox: a count/list of PRs awaiting the user, shown as a header badge via `fetchPrInboxPreview()` → `forge:prInboxPreview`. Read-only preview only — Forge performs no Bitbucket writes. Authentication reuses the user's own environment/config as read in `src/integrations/bitbucket.ts` (see that file for the exact variables); preview responses are untrusted input — never log secrets to transparency (scope-expansion check in `09-audit.md#P1-8`).

## Shell-outs (`openPath`, `openExternal`)

- `forge:openPath <path>` trims whitespace, asks the OS to open the path (`shell.openPath`), and returns the error string or null on success. Single-user convenience — it can open anything you could open yourself; invocations should be logged (see audit).
- `forge:openExternal <url>` only allows strings matching `^https?://` and opens them in the system browser; anything else is ignored.
