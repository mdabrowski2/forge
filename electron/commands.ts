// slash-command dispatch, extracted from the `forge:command` IPC handler so
// it runs headless (pure w.r.t. Electron — no ipcMain/window). Session cwd
// mutation + meta persistence are fs side effects (isolated-HOME testable).
// The handler wraps results with publishNotice; both ok AND error paths
// return shapes the handler switches on to emit — failed commands are the
// highest-value debugging case and must never stay dark.
import { existsSync, statSync } from "fs"
import { homedir } from "os"
import path from "path"
import { saveSessionMeta, type Session } from "../src/sessions/store"
import type { ModCommand } from "../src/mods/api"

export interface CommandContext {
  session: Session
  registry: {
    setActiveSession: (s: { id: string; cwd: string }) => void
    getCommands: () => ModCommand[]
  }
}

export interface CommandResult {
  ok: boolean
  text?: string
  error?: string
  name: string
  args: string
}

/** validate a shell-open target: trimmed non-empty string or null (no action). */
export function resolveOpenTarget(p: unknown): string | null {
  if (typeof p !== "string" || !p.trim()) return null
  return p.trim()
}

/** external URLs must be http(s); anything else is ignored, never opened. */
export function isSafeExternalUrl(url: unknown): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url)
}

/** ring-cap helper for the in-memory transcript (durable record is the events file). */
export const TRANSCRIPT_CAP = 2000
export function capTranscript<T>(arr: T[]): T[] {
  if (arr.length > TRANSCRIPT_CAP) arr.splice(0, arr.length - TRANSCRIPT_CAP)
  return arr
}

export async function runCommand(text: string, ctx: CommandContext): Promise<CommandResult> {
  const { session, registry } = ctx
  const m = typeof text === "string" ? text.trim().match(/^\/(\S+)\s*([\s\S]*)$/) : null
  if (!m) return { ok: false, error: "not a command", name: "", args: "" }
  const [, name, args] = m
  // a slash command can be the very first thing typed in a session, before
  // any chat turn has run setActiveSession — mod commands need it too, so a
  // repo/session-scoped mod config resolves correctly even then
  registry.setActiveSession({ id: session.id, cwd: session.cwd })

  // core command, not mod-provided — checked first so a mod can never shadow it
  if (name === "cd") {
    const target = args.trim()
    if (!target) return { ok: true, text: `cwd: ${session.cwd}`, name, args }
    const resolved = path.resolve(session.cwd, target.replace(/^~(?=$|\/)/, homedir()))
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      return { ok: false, error: `not a directory: ${resolved}`, name, args }
    }
    session.cwd = resolved
    saveSessionMeta(session.id, { cwd: resolved })
    return { ok: true, text: `cwd: ${resolved}`, name, args }
  }

  const cmd = registry.getCommands().find((c) => c.name === name)
  if (!cmd) return { ok: false, error: `unknown command: /${name}`, name, args }
  try {
    return { ok: true, text: await cmd.run(args), name, args }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), name, args }
  }
}
