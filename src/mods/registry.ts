// singleton mod registry — mods register tools/hooks/commands/prompt sections here
// at boot; the agent loop and UI read from it.
import { jsonSchema } from "ai"
import type { ForgeConfig } from "../config"
import type { ChatMessage } from "../sessions/store"
import type { TransparencyEvent } from "../transparency/types"
import type {
  CustomEventInput,
  ForgeApi,
  HookCallback,
  HookEvent,
  HookPayloads,
  ModCommand,
  ModTool,
} from "./api"

/** runtime context the loop hands to mod tools */
export interface ToolRuntime {
  cwd: string
  config: ForgeConfig
  session: { id: string; messages: ChatMessage[] } | null
  emit: (event: TransparencyEvent) => void
}

/** a mod tool wrapped into an AI SDK tool (JSON schema → Schema) */
export interface ModWrappedTool {
  description: string
  inputSchema: ReturnType<typeof jsonSchema>
  execute: (
    input: any,
    options: { toolCallId: string; abortSignal?: AbortSignal }
  ) => unknown | Promise<unknown>
}

class ModRegistry {
  private tools = new Map<string, ModTool>()
  private hooks = new Map<HookEvent, HookCallback<HookEvent>[]>()
  private commands = new Map<string, ModCommand>()
  private promptSections: string[] = []
  private emitSink: ((event: TransparencyEvent) => void) | null = null

  /** the loop points this at its per-turn emit so mod custom events flow through */
  setEmitSink(fn: (event: TransparencyEvent) => void): void {
    this.emitSink = fn
  }

  registerTool(tool: ModTool): void {
    if (this.tools.has(tool.name)) throw new Error(`mod tool "${tool.name}" already registered`)
    this.tools.set(tool.name, tool)
  }

  getTools(runtime: ToolRuntime): Record<string, ModWrappedTool> {
    const out: Record<string, ModWrappedTool> = {}
    for (const [name, t] of this.tools) {
      out[name] = {
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema),
        execute: (input, opts) =>
          t.execute(input, {
            cwd: runtime.cwd,
            config: runtime.config,
            session: runtime.session,
            emit: runtime.emit,
            toolCallId: opts.toolCallId,
            abortSignal: opts.abortSignal,
          }),
      }
    }
    return out
  }

  on<E extends HookEvent>(event: E, cb: HookCallback<E>): void {
    const list = this.hooks.get(event) ?? []
    list.push(cb as HookCallback<HookEvent>)
    this.hooks.set(event, list)
  }

  emitHook<E extends HookEvent>(event: E, payload: HookPayloads[E]): void {
    for (const cb of this.hooks.get(event) ?? []) {
      try {
        ;(cb as HookCallback<E>)(payload)
      } catch (e) {
        console.error(`[mods] hook "${event}" failed:`, e)
      }
    }
  }

  registerCommand(cmd: ModCommand): void {
    if (this.commands.has(cmd.name)) throw new Error(`mod command "${cmd.name}" already registered`)
    this.commands.set(cmd.name, cmd)
  }

  getCommands(): ModCommand[] {
    return [...this.commands.values()]
  }

  addPromptSection(section: string): void {
    this.promptSections.push(section)
  }

  getPromptSections(): string[] {
    return [...this.promptSections]
  }

  emitCustom(mod: string, event: CustomEventInput): void {
    if (!this.emitSink) return
    this.emitSink({ ...event, mod, timestamp: Date.now() })
  }
}

export const registry = new ModRegistry()

/** build the api object handed to a mod's setup() */
export const createApi = (config: ForgeConfig, modName: string): ForgeApi => ({
  config,
  tools: { register: (t) => registry.registerTool(t) },
  hooks: { on: (event, cb) => registry.on(event, cb) },
  commands: { register: (c) => registry.registerCommand(c) },
  prompt: { add: (s) => registry.addPromptSection(s) },
  events: { emit: (e) => registry.emitCustom(modName, e) },
})