# ADR-002: Harness abstraction over providers

- Status: accepted (retrospective record of the v0.1 build)
- Date recorded: 2026-09-22
- Context: the built-in AI-SDK tool loop (stateless — resends full history each turn) vs the Claude Code CLI subprocess (server-pinned — the remote keeps conversation state for caching) need one call shape.
- Decision: `Harness.runTurn()` (`src/harness/types.ts:24-30`); `createForgeHarness` wraps any `Provider`, `createClaudeCodeCliHarness` wraps the CLI subprocess; `getModelForSession` enables pinning/caching.
- Alternatives: provider-only (CLI special-cased in loop — rejected, would tangle transports).
- Consequences: Electron lists harnesses, not providers; new execution backend = new harness, no loop change.
