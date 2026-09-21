// public API surface for forge mods — the types a mod author writes against.
// mods live in ~/.forge/mods/<name>/index.js and receive a ForgeApi in setup().
import type { JSONSchema7 } from "ai"
import type { ForgeConfig } from "../config"
import type { ChatMessage } from "../sessions/store"
import type { TransparencyEvent } from "../transparency/types"

export type { JSONSchema7 }

/** a tool contributed by a mod — input schema is plain JSON Schema (no zod, no deps) */
export interface ModTool {
  name: string
  description: string
  inputSchema: JSONSchema7
  execute: (input: any, ctx: ModToolContext) => unknown | Promise<unknown>
}

/** what a mod tool gets at execution time */
export interface ModToolContext {
  cwd: string
  config: ForgeConfig
  session: { id: string; messages: ChatMessage[] } | null
  /** emit a transparency event (persists + replays in the UI) */
  emit: (event: TransparencyEvent) => void
  toolCallId: string
  abortSignal?: AbortSignal
}

export interface ModCommand {
  name: string
  description: string
  /** returns the text to show the user */
  run: (args: string) => string | Promise<string>
}

export type HookEvent = "beforeTurn" | "afterTurn" | "beforeToolCall" | "afterToolCall"

export interface HookPayloads {
  beforeTurn: { model: string; cwd: string; messages: ChatMessage[] }
  afterTurn: { model: string; text: string; messages: ChatMessage[] }
  beforeToolCall: { tool: string; args: unknown }
  afterToolCall: { tool: string; args: unknown; ok: boolean; result: string; durationMs: number }
}

export type HookCallback<E extends HookEvent> = (payload: HookPayloads[E]) => void

/** what a mod emits as a custom transparency event — mod + timestamp are filled in by forge */
export type CustomEventInput = { type: "custom"; callId: string; name: string; data: unknown }

export interface ForgeApi {
  /** read-only view of the config at boot time */
  config: ForgeConfig
  tools: { register: (tool: ModTool) => void }
  hooks: { on: <E extends HookEvent>(event: E, cb: HookCallback<E>) => void }
  commands: { register: (cmd: ModCommand) => void }
  prompt: { add: (section: string) => void }
  events: { emit: (event: CustomEventInput) => void }
}

export interface ForgeMod {
  name: string
  version: string
  setup: (api: ForgeApi) => void
}