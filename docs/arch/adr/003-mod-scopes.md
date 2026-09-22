# ADR-003: Three-scope mod config (session > repo > global)

- Status: accepted (retrospective record of the v0.1 build)
- Date recorded: 2026-09-22
- Context: users want a mod (user-written plugin) on everywhere, except one repo (project folder), except one chat session.
- Decision: resolve per-session overrides > per-repo file (`~/.forge/repos/<b64>.json`, where `<b64>` is the filename-safe encoding of the repo path) > global `config.mods`; `enabled` most-specific-wins, `settings` merge per-key (`src/mods/registry.ts:64-75`); enforcement central in registry.
- Alternatives: global-only (+env vars) — rejected, too coarse.
- Consequences: mods must read `modConfig.get()` live, never snapshot `config.mods[name]`.
