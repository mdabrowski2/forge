# 03 — Components (C3)

All built. Each subsection names the file to change.

## Agent loop (`src/agent/loop.ts:37-254`)

`runChatTurn()` runs one user message through the model, possibly over several tool-calling rounds. Parameters: which provider/model, the chat history, the session's working directory, whether thinking traces are on, the app config, the session id, and two callbacks — `onDelta` (live text for the UI) and `onTransparency` (status events for the UI/log).
- First it points the mod registry at this turn's event callback (the "emit sink" — where mod-generated events get sent) and records the active session id, **before** building the system prompt — because the prompt includes per-session skill text that depends on knowing the session.
- It builds a `ToolRuntime` (the context handed to every tool: cwd + config + session + emit callback) and creates the tool set: 6 built-ins plus mod tools merged last so a mod can never replace a built-in (`src/agent/tools/index.ts:21-29`).
- Stored chat messages are translated into the AI SDK's message format (plain user text; assistant messages carrying tool calls; tool messages carrying results).
- Tool loop, bounded at `MAX_STEPS = 8` (a fixed infinite-loop guard — the model gets at most 8 model→tools→results rounds per turn): each round calls `streamText()` (the SDK's streaming chat call) with an opt-in thinking flag only when the provider advertises it. Each round emits status events (`request/chunk/reasoning/finish/error`), runs each requested tool while firing `beforeToolCall`/`afterToolCall` mod hooks plus `tool-call`/`tool-result` events, appends results, and repeats until the model makes zero tool calls.
- Finally it stores one assistant message (full reply text + the list of tool calls made) followed by the tool-result messages, and fires the `afterTurn` mod hook.

## Providers (`src/providers/`, `src/config.ts`, `src/providers/registry.ts`)

- `ProviderKind` (the 5 supported endpoint types): `ollama | anthropic | openai-compatible | muse-spark | opencode-cli`.
- `Provider` object: `{id, name, models, defaultModel, status, capabilities?, getModel, getModelForSession?}` (`src/providers/types.ts:17-39`). `status` is boot-time health: `ok` (usable), `unconfigured` (missing URL/key — stays listed, errors only if used), `unreachable` (configured but the discovery probe failed — stays listed and flagged, may recover). `getModelForSession` is an optional variant that pins one remote conversation per local session for prompt caching (reusing server-side context instead of resending everything).
- Factory map (a lookup table from kind string to constructor function) in `src/providers/registry.ts:16-35` is the only place kinds are wired — adding a provider kind means one map entry plus the `ProviderKind` type; the UIs and loop stay untouched.
- `resolveProviders()` never throws at boot: it skips `disabled` entries, keeps the first of any duplicate id, and turns constructor failures into `{id, reason}` skip records shown as warnings (`src/providers/registry.ts:62-85`).

## Harness (`src/harness/`)

A harness is a uniform `{id, name, models, defaultModel, runTurn}` wrapper (`src/harness/types.ts:24-30`) so Electron treats both execution backends identically.
- `createForgeHarness(provider, getConfig)` (`src/harness/forge-harness.ts:11-34`): wraps one AI-SDK provider; `getConfig` is a live getter (a thinking-toggle change applies on the next turn, no restart); saves the used model into session metadata; delegates to `runChatTurn`.
- `createClaudeCodeCliHarness()`: forwards turns to the `claude-code` CLI as a subprocess; keeps the CLI's own session id in session metadata for `--resume` continuity.

## Mods (detail in `06-mods.md`)

Mod loader scans entry files (`src/mods/loader.ts:18-51`); the registry stores each mod's tools/hooks/commands/skills tagged with the owning mod name (`src/mods/registry.ts:38-48`); per-mod config resolves session-overrides > repo > global (`src/mods/registry.ts:64-75`); the author-facing API is `config/modConfig/tools/hooks/commands/skills/events` (`src/mods/api.ts:62-74`); lifecycle hooks are `beforeTurn|afterTurn|beforeToolCall|afterToolCall|transparencyEvent` (`src/mods/api.ts:44-55`).

## Sessions + transparency (detail in `05-data.md`)

- `Session {id, title, createdAt, updatedAt, model, cwd, messages[]}`; `ChatMessage {role, content, timestamp, toolCalls?, toolCallId?, toolName?}` (`src/sessions/store.ts:25-49`).
- Storage is append-only JSONL (JSON Lines — one JSON object per line, so crashes can't corrupt earlier lines): `<id>.jsonl` messages, `<id>.events.jsonl` turn-numbered transparency events, `<id>.meta.json` sidecar (a small bookkeeping file: last model, CLI session id, cwd, per-session mod overrides, loaded skill names) (`src/sessions/store.ts:51-127`). Session list sorts by most-recently-updated first.
- `TransparencyEvent` types: `request|chunk|reasoning|finish|error|tool-call|tool-result|custom(mod,name,data)` (`src/transparency/types.ts:3-36`). Each event is persisted to the events file, streamed to the UI callback, and broadcast to mod `transparencyEvent` hooks.

## Prompt & tools

- `getSystemPrompt()` (`src/agent/prompt.ts:4-37`): current date + OS label + any user-loaded skill texts; instructs the model to prefer surgical edit over full rewrite, read-before-edit, and verify with tools instead of inventing file contents.
- Built-ins: read/write/edit/bash/glob/grep, all scoped to the session cwd with `~/` home expansion.

Read next: `04-runtime.md` (turn sequence + IPC map), `05-data.md` (file layouts).
