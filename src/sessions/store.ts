import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
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
// after a reload — each event carries the turn index it belongs to
export function appendEvent(session: Session, event: unknown): void {
  mkdirSync(sessionsDir, { recursive: true })
  appendFileSync(join(sessionsDir, `${session.id}.events.jsonl`), JSON.stringify(event) + "\n")
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

export function loadEvents(id: string): unknown[] {
  const file = join(sessionsDir, `${id}.events.jsonl`)
  if (!existsSync(file)) return []
  return safeParseLines<unknown>(readFileSync(file, "utf-8"), file)
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
    .map((f) => loadSession(f.replace(/\.jsonl$/, "")))
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}