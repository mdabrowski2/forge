# ADR-005: Provider factory registry + non-fatal skips

- Status: accepted (retrospective record of the v0.1 build)
- Date recorded: 2026-09-22
- Context: 5 provider kinds (endpoint types) with different credentials/transports; one bad entry must not kill boot.
- Decision: `factories: Record<ProviderKind, Factory>` lookup table is the only kind→constructor map (`src/providers/registry.ts:16-35`); `resolveProviders` skips disabled/duplicates/constructor-throws as `{id, reason}` records shown as warnings.
- Alternatives: throw-on-first-error — rejected (single missing key bricks the app).
- Consequences: boot always renders skip warnings; `status` (`ok|unconfigured|unreachable`) drives UI badges, not boot success.
