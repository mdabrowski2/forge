# Forge System Design — Living Docs

> **Mission:** fully customizable, transparent AI client with mod support — so everyone can easily make it their own. Every architecture decision below serves that mission: transparency makes behavior inspectable, mods make behavior changeable, and both must stay easy enough for non-experts.

Forge is a single-user AI assistant that runs on your own machine (v0.1.0 as of 2026-09). It ships as two deployables sharing one core: a terminal UI (TUI — a text interface you run in your terminal) and an Electron desktop app. The shared core holds the agent loop (the model-plus-tools conversation engine, built on the Vercel AI SDK), a provider factory registry (the one place that maps a config `kind` to a model-endpoint constructor), a harness abstraction (a common `runTurn()` interface with two backends: the built-in AI-SDK loop and a Claude Code CLI subprocess), a JavaScript mod system (user-written plugins adding tools, `/commands`, and prompt skills), file-based sessions (chat history as files under `~/.forge/sessions/`), and a transparency event log (a per-turn record of requests, text deltas, tool calls/results, and errors the UI can replay).

Start with `01-context.md`, then `02-containers.md`. To run: TUI `bun src/main.tsx`, desktop `bun run electron:start` (needs one provider: local Ollama or `ANTHROPIC_API_KEY`).

## Map (all built)

| File | Contents |
|------|----------|
| `01-context.md` | C1 — users, externals, trust boundary |
| `02-containers.md` | C2 — TUI runtime vs Electron (main/preload/renderer) + shared core |
| `03-components.md` | C3 — loop, tools, providers, harness, mods, sessions, transparency |
| `04-runtime.md` | Dynamic — chat-turn + IPC sequences (Mermaid) |
| `05-data.md` | Data — config, sessions, events, repo scope |
| `06-mods.md` | Mod subsystem (loader/registry/scopes) |
| `07-ui.md` | UI duality (terminal OpenTUI Solid vs Electron) |
| `08-integrations.md` | Quest tracker + Bitbucket previews (both optional) |
| `09-audit.md` | Audit + hardening backlog (failure, security, tests) |
| `10-mod-authoring.md` | Mod authoring guide (scaffold → check → reload → debug) |
| `adr/001–005` | 001 dual-UI, 002 harness, 003 mod-scopes, 004 file-sessions, 005 factory-registry |

## Maintenance rule

- This tree is the source of truth for *intent*; code wins on conflict — then update the doc in the same PR.
- Update the touched file in the same PR that changes behavior.
- Diagrams are Mermaid in-markdown (GitHub/Confluence render natively).
- Evidence convention: `path:line` references (e.g. `src/agent/loop.ts:37`). If code moves, update the ref.
- Add a new ADR for any structural choice (new container, new scope, new trust decision). Copy `adr/000-template.md`.
