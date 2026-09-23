import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { dataDir } from "../config"

export type Role = "user" | "assistant" | "system" | "tool"

export interface ToolCallRecord {
  id: string
  name: string
  args: unknown
}

export interface ChatMessage {
  role: Role
  content: string
  timestamp: number
  /** assistant messages that made tool calls */
  toolCalls?: ToolCallRecord[]
  /** tool result messages: the call id they answer */
  toolCallId?: string
  toolName?: string
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  model: string
  /** working directory for tools (bash/glob/grep) in this session — per-session, not global */
  cwd: string
  messages: ChatMessage[]
}

const sessionsDir = join(dataDir, "sessions")

export function newSession(model: string, cwd: string): Session {
  const now = Date.now()
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New session",
    createdAt: now,
    updatedAt: now,
    model,
    cwd,
    messages: [],
  }
}

export function appendMessage(session: Session, msg: ChatMessage): void {
  session.messages.push(msg)
  session.updatedAt = Date.now()
  if (session.title === "New session" && msg.role === "user") {
    session.title = msg.content.slice(0, 60)
  }
  mkdirSync(sessionsDir, { recursive: true })
  appendFileSync(join(sessionsDir, `${session.id}.jsonl`), JSON.stringify(msg) + "\n")
}

// transparency events are persisted per-session so the UI can replay them
// after a reload — each event carries the turn index it belongs to.
// Rotation: when the live file exceeds EVENTS_ROTATE_BYTES it becomes
// `<id>.events.jsonl.<epoch>` (suffix form, so the listSessions scan —
// endsWith .jsonl excluding .events.jsonl — ignores segments) and a fresh
// live file continues. Nothing is ever deleted.
export const EVENTS_ROTATE_BYTES = 1024 * 1024 // pinned: sessions are KB-scale; 1MB ≈ thousands of turns

export function appendEvent(session: Session, event: unknown): void {
  mkdirSync(sessionsDir, { recursive: true })
  const file = join(sessionsDir, `${session.id}.events.jsonl`)
  try {
    if (existsSync(file) && statSync(file).size > EVENTS_ROTATE_BYTES)
      renameSync(file, `${file}.${Date.now()}`)
  } catch {
    // rotation best-effort; the append below must never fail because of it
  }
  appendFileSync(file, JSON.stringify(event) + "\n")
}

// parse one-JSON-per-line text, skipping corrupt lines but counting them.
// The count is logged by callers (never thrown): boot-resume must survive
// a bad line, and operators need a number, not silence.
const safeParseLines = <T>(text: string, file: string): T[] => {
  const out: T[] = []
  let dropped = 0
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {
      dropped++
    }
  }
  if (dropped > 0) console.error(`[sessions] skipped ${dropped} corrupt line(s) in ${file}`)
  return out
}

export const MAX_EVENTS_LOAD = 500

// Bounded read, honestly labeled: caps retained memory, NOT parse cost —
// the whole file is still parsed. Callers showing history must treat the
// result as the latest-N window.
export function loadEvents(id: string, limit: number = MAX_EVENTS_LOAD): unknown[] {
  const live = join(sessionsDir, `${id}.events.jsonl`)
  let segments: string[] = []
  try {
    segments = readdirSync(sessionsDir)
      .filter((f) => f.startsWith(`${id}.events.jsonl.`))
      .sort()
      .map((f) => join(sessionsDir, f))
  } catch {
    // unreadable dir — live file below still attempted
  }
  const all: unknown[] = []
  for (const file of [...segments, live]) {
    if (!existsSync(file)) continue
    all.push(...safeParseLines<unknown>(readFileSync(file, "utf-8"), file))
  }
  return all.slice(-limit)
}

export function loadSession(id: string): Session | null {
  const file = join(sessionsDir, `${id}.jsonl`)
  if (!existsSync(file)) return null
  const messages = safeParseLines<ChatMessage>(readFileSync(file, "utf-8"), file)
  const firstUser = messages.find((m) => m.role === "user")
  const meta = loadSessionMeta(id)
  return {
    id,
    title: firstUser?.content.slice(0, 60) ?? "Session",
    createdAt: messages[0]?.timestamp ?? Date.now(),
    updatedAt: messages[messages.length - 1]?.timestamp ?? Date.now(),
    model: meta.model ?? "",
    cwd: meta.cwd ?? homedir(),
    messages,
  }
}

// sidecar file for bookkeeping that doesn't belong in the message/event
// streams: which model was last active for this session (so a relaunch
// restores it instead of always defaulting to the first harness), the
// Claude Code CLI's own session id (needed for --resume continuity), the
// session's own working directory, and per-session mod config overrides
export interface SessionMeta {
  model?: string
  claudeCodeSessionId?: string
  cwd?: string
  modOverrides?: Record<string, { enabled?: boolean; settings?: Record<string, unknown> }>
  /** names of skills currently loaded into this session's system prompt */
  loadedSkills?: string[]
}

export function loadSessionMeta(id: string): SessionMeta {
  const file = join(sessionsDir, `${id}.meta.json`)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as SessionMeta
  } catch {
    return {}
  }
}

// merges into any existing meta rather than overwriting it — model and
// claudeCodeSessionId are written independently at different points in a turn
export function saveSessionMeta(id: string, patch: SessionMeta): void {
  mkdirSync(sessionsDir, { recursive: true })
  const merged = { ...loadSessionMeta(id), ...patch }
  writeFileSync(join(sessionsDir, `${id}.meta.json`), JSON.stringify(merged))
}

export function listSessions(): Session[] {
  mkdirSync(sessionsDir, { recursive: true })
  return readdirSync(sessionsDir)
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl"))
    .map((f) => {
      const id = f.replace(/\.jsonl$/, "")
      try {
        return loadSession(id)
      } catch (e) {
        quarantineSession(id, e)
        return null
      }
    })
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// A session that cannot be read at all (not merely bad lines — those are
// skipped by safeParseLines) is moved aside with all three sidecars plus a
// manifest line, so it never silently vanishes from the list.
const quarantineSession = (id: string, cause: unknown): void => {
  const qdir = join(sessionsDir, "quarantine")
  mkdirSync(qdir, { recursive: true })
  for (const suffix of [".jsonl", ".events.jsonl", ".meta.json"]) {
    const src = join(sessionsDir, `${id}${suffix}`)
    if (existsSync(src)) {
      try {
        renameSync(src, join(qdir, `${id}${suffix}`))
      } catch {
        /* best-effort per file */
      }
    }
  }
  const reason = cause instanceof Error ? cause.message : String(cause)
  try {
    appendFileSync(join(qdir, "quarantine.log"), JSON.stringify({ id, timestamp: Date.now(), reason }) + "\n")
  } catch {
    /* best-effort */
  }
  console.error(`[sessions] quarantined session ${id}: ${reason}`)
}