# ADR-004: File-based sessions (JSONL + sidecars)

- Status: accepted (retrospective record of the v0.1 build)
- Date recorded: 2026-09-22
- Context: need crash-safe, inspectable, replayable history without a database dependency.
- Decision: append-only `<id>.jsonl` (messages, one JSON object per line) + `<id>.events.jsonl` (transparency events, turn-numbered) + `<id>.meta.json` sidecar (small bookkeeping file: model, cwd, skill/mod overrides); `listSessions` sorts by most-recently-updated.
- Alternatives: SQLite — rejected for v0.1 (opaque, extra dep); single JSON per session — rejected (rewrite cost, one corruption kills the session).
- Consequences: needs rotation/quarantine (see `09-audit.md` P0-3/P0-4); trivial to back up (`~/.forge/sessions/`).
