# 05 — Data

All built. Root on disk: `~/.forge` (`dataDir`, `src/config.ts:49`).

## `config.json` (`src/config.ts:38-122`)

Shape: `{providers[], theme, cwd, thinking, mods}`. First boot writes factory defaults (4 providers: ollama/anthropic/muse-spark/opencode-cli). Loads merge **by id** (matching on the provider's `id` string): your entries win untouched; any missing *built-in* provider is appended so upgrades reach existing configs. Malformed JSON is copied to `config.json.bak.<epochMillis>-<rand>` beside the file with a `[config]` log line naming the backup, then defaults load (hardening Wave 1). **Disable, don't delete**: deleting a built-in id makes it reappear on next boot; set `disabled:true` to keep it skipped.

## Sessions (`src/sessions/store.ts`, dir `~/.forge/sessions/`)

Session ids look like `<epochMillis>-<random6>` (e.g. `1727456400000-a1b2c3`), created in `newSession()`. Three files per session (example id `abc123`):
- `~/.forge/sessions/abc123.jsonl` — one chat message (JSON object) per line, append-only; the list title is the first user message truncated to 60 characters.
- `~/.forge/sessions/abc123.events.jsonl` — transparency events, each stamped with its turn number, so the UI can replay them after reload.
- `~/.forge/sessions/abc123.meta.json` — small bookkeeping sidecar: last-used `{model, claudeCodeSessionId, cwd, modOverrides, loadedSkills}`; writes merge into existing keys rather than replacing the file.
- `listSessions()` reads every message file (skipping `*.events.jsonl`), newest-first by last-update time; boot reopens index `[0]` (the most recent).
- Each session has its own working directory (`cwd`, not global): `/cd <dir>` validates then saves it; every tool runs against that session's cwd.

## Repo scope (`src/repo-config.ts`)

`findRepoRoot(cwd)` walks parent directories for a `.git` folder and falls back to the cwd itself for scratch dirs. Per-repo mod settings live at `~/.forge/repos/<base64url(repoRoot)>.json` (base64url = filename-safe encoding of the repo path, so `/Users/a/proj` becomes one file) with shape `{mods}`. Missing file and corrupt file both read as `{mods:{}}` today (quarantine proposed in `09-audit.md#P0-3`).

## Mod resolution order

For each mod: session overrides > repo settings > global config (`src/mods/registry.ts:64-75`). The `enabled` flag uses most-specific-wins (a session `false` beats a global `true`); `settings` objects merge shallowly (per-key, session keys win). Worked example in `06-mods.md`.
