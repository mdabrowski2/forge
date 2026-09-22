// the transparency event union — every event forge emits about a turn.
// moved out of loop.ts so mods (src/mods/api.ts) can reference it without cycles.
export type TransparencyEvent =
  | {
      type: "request"
      callId: string
      provider: string
      model: string
      system: string
      messages: unknown[]
      /** serializable tool definitions sent as the call's `tools` block */
      tools: { name: string; description: string; inputSchema: unknown }[]
      settings: Record<string, unknown>
      timestamp: number
    }
  | { type: "chunk"; callId: string; text: string; timestamp: number }
  | { type: "reasoning"; callId: string; delta: string; timestamp: number }
  | {
      type: "finish"
      callId: string
      usage: { inputTokens: number; outputTokens: number; totalTokens: number }
      finishReason: string
      latencyMs: number
      timestamp: number
    }
  | { type: "error"; callId: string; message: string; timestamp: number }
  | { type: "tool-call"; callId: string; tool: string; args: unknown; timestamp: number }
  | {
      type: "tool-result"
      callId: string
      tool: string
      ok: boolean
      result: string
      durationMs: number
      timestamp: number
    }
  // escape hatch for mods — rides the same transparency channel (persists + replays)
  | { type: "custom"; callId: string; mod: string; name: string; data: unknown; timestamp: number }
  // core notices (commands, mutations, boot, hooks, CLI, integrations) —
  // same channel, no owning mod; turn-less unless a producer tags one
  | { type: "notice"; callId: string; source: string; name: string; data: unknown; timestamp: number }