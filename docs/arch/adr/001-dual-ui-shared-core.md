# ADR-001: Dual UI (terminal + Electron desktop) over shared core

- Status: accepted (retrospective record of the v0.1 build)
- Date recorded: 2026-09-22
- Context: need a fast terminal loop (TUI — text interface in the terminal) and a rich desktop app (transparency event panel, skills/mods panels, Quest tracker embed) without forking logic.
- Decision: `src/` (agent loop, providers, harness, mods, sessions, transparency) is UI-agnostic; `src/main.tsx` + `src/tui/` and `electron/` + `public/` are thin shells.
- Alternatives: Electron-only (loses terminal speed); TUI-only (loses panels/embed).
- Consequences: every turn-affecting feature goes in harness/loop; UIs must not diverge (see `07-ui.md` risks).
