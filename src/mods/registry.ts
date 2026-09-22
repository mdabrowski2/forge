// singleton mod registry — mods register tools/hooks/commands/prompt sections here
// at boot; the agent loop and UI read from it.
import { jsonSchema } from "ai"
import type { ForgeConfig, ModConfig } from "../config"
import type { ChatMessage } from "../sessions/store"
import { loadSessionMeta } from "../sessions/store"
import { findRepoRoot, loadRepoConfig } from "../repo-config"
import type { TransparencyEvent } from "../transparency/types"
import type {
  CustomEventInput,
  ForgeApi,
  HookCallback,
  HookEvent,
  HookPayloads,
  ModCommand,
  ModSkill,
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
  // every registration tracks the owning mod's name so enabled=false at any
  // scope can be enforced centrally, without each mod having to remember to
  // check it itself
  private tools = new Map<string, { modName: string; tool: ModTool }>()
  private hooks = new Map<HookEvent, { modName: string; cb: HookCallback<HookEvent> }[]>()
  private commands = new Map<string, { modName: string; cmd: ModCommand }>()
  private skills = new Map<string, { modName: string; skill: ModSkill }>()
  private emitSink: ((event: TransparencyEvent) => void) | null = null
  private activeSession: { id: string; cwd: string } | null = null
  private globalConfig: ForgeConfig | null = null

  /** the loop points this at its per-turn emit so mod custom events flow through */
  setEmitSink(fn: (event: TransparencyEvent) => void): void {
    this.emitSink = fn
  }

  /** called once per turn so getResolvedModConfig knows which session/repo to resolve against */
  setActiveSession(session: { id: string; cwd: string }): void {
    this.activeSession = session
  }

  setGlobalConfig(config: ForgeConfig): void {
    this.globalConfig = config
  }

  /** session > repo > global — most specific wins for enabled, settings shallow-merge */
  getResolvedModConfig(modName: string): ModConfig {
    const g = this.globalConfig?.mods[modName] ?? {}
    if (!this.activeSession) return g
    const repoRoot = findRepoRoot(this.activeSession.cwd)
    const r = loadRepoConfig(repoRoot).mods[modName] ?? {}
    const s = loadSessionMeta(this.activeSession.id).modOverrides?.[modName] ?? {}
    return {
      enabled: s.enabled ?? r.enabled ?? g.enabled,
      settings: { ...g.settings, ...r.settings, ...s.settings },
    }
  }

  isModEnabled(modName: string): boolean {
    return this.getResolvedModConfig(modName).enabled !== false
  }

  registerTool(modName: string, tool: ModTool): void {
    if (this.tools.has(tool.name)) throw new Error(`mod tool "${tool.name}" already registered`)
    this.tools.set(tool.name, { modName, tool })
  }

  getTools(runtime: ToolRuntime): Record<string, ModWrappedTool> {
    const out: Record<string, ModWrappedTool> = {}
    for (const [name, { modName, tool: t }] of this.tools) {
      out[name] = {
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema),
        execute: (input, opts) => {
          if (!this.isModEnabled(modName)) throw new Error(`"${modName}" is disabled for this repo/session`)
          return t.execute(input, {
            cwd: runtime.cwd,
            config: runtime.config,
            session: runtime.session,
            emit: runtime.emit,
            toolCallId: opts.toolCallId,
            abortSignal: opts.abortSignal,
          })
        },
      }
    }
    return out
  }

  on<E extends HookEvent>(modName: string, event: E, cb: HookCallback<E>): void {
    const list = this.hooks.get(event) ?? []
    list.push({ modName, cb: cb as HookCallback<HookEvent> })
    this.hooks.set(event, list)
  }

  emitHook<E extends HookEvent>(event: E, payload: HookPayloads[E]): void {
    for (const { modName, cb } of this.hooks.get(event) ?? []) {
      if (!this.isModEnabled(modName)) continue
      try {
        ;(cb as HookCallback<E>)(payload)
      } catch (e) {
        console.error(`[mods] hook "${event}" (${modName}) failed:`, e)
        // Notice via the in-scope sink ONLY — never publishNotice (it imports
        // this registry: a cycle). Skipped for transparencyEvent itself: the
        // sink fans out through emitHook("transparencyEvent", …), so a notice
        // here would recurse until stack overflow. Payload keys only — values
        // can carry full message histories.
        if (event === "transparencyEvent" || !this.emitSink) continue
        this.emitSink({
          type: "notice",
          callId: "",
          source: "hooks",
          name: "hook-failed",
          data: { event, mod: modName, payloadKeys: Object.keys(payload ?? {}) },
          timestamp: Date.now(),
        })
      }
    }
  }

  registerCommand(modName: string, cmd: ModCommand): void {
    if (this.commands.has(cmd.name)) throw new Error(`mod command "${cmd.name}" already registered`)
    this.commands.set(cmd.name, { modName, cmd })
  }

  /** excludes commands belonging to a currently-disabled mod entirely — they
   * don't exist as far as /command dispatch is concerned, not just error out */
  getCommands(): ModCommand[] {
    return [...this.commands.values()].filter(({ modName }) => this.isModEnabled(modName)).map(({ cmd }) => cmd)
  }

  registerSkill(modName: string, skill: ModSkill): void {
    if (this.skills.has(skill.name)) throw new Error(`mod skill "${skill.name}" already registered`)
    this.skills.set(skill.name, { modName, skill })
  }

  /** for the skills selector panel — excludes skills from a disabled mod */
  getAllSkills(): { name: string; description: string; modName: string }[] {
    return [...this.skills.values()]
      .filter(({ modName }) => this.isModEnabled(modName))
      .map(({ modName, skill }) => ({ name: skill.name, description: skill.description, modName }))
  }

  /** the content of every skill loaded for the active session — off by
   * default, session-scoped via loadSessionMeta().loadedSkills */
  getLoadedSkillSections(): string[] {
    if (!this.activeSession) return []
    const loaded = new Set(loadSessionMeta(this.activeSession.id).loadedSkills ?? [])
    if (!loaded.size) return []
    return [...this.skills.values()]
      .filter(({ modName, skill }) => loaded.has(skill.name) && this.isModEnabled(modName))
      .map(({ skill }) => skill.content)
  }

  emitCustom(mod: string, event: CustomEventInput): void {
    if (!this.emitSink || !this.isModEnabled(mod)) return
    this.emitSink({ ...event, mod, timestamp: Date.now() })
  }

  /** drop all registrations (tools/hooks/commands/skills) for a clean reload.
   * Per-turn wiring (emitSink/activeSession/globalConfig) is preserved. */
  reset(): void {
    this.tools.clear()
    this.hooks.clear()
    this.commands.clear()
    this.skills.clear()
  }
}

export const registry = new ModRegistry()

/** build the api object handed to a mod's setup() */
export const createApi = (config: ForgeConfig, modName: string): ForgeApi => {
  registry.setGlobalConfig(config)
  return {
    config,
    modConfig: { get: () => registry.getResolvedModConfig(modName) },
    tools: { register: (t) => registry.registerTool(modName, t) },
    hooks: { on: (event, cb) => registry.on(modName, event, cb) },
    commands: { register: (c) => registry.registerCommand(modName, c) },
    skills: { register: (s) => registry.registerSkill(modName, s) },
    events: { emit: (e) => registry.emitCustom(modName, e) },
  }
}