import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
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
  messages: ChatMessage[]
}

const sessionsDir = join(dataDir, "sessions")

export function newSession(model: string): Session {
  const now = Date.now()
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New session",
    createdAt: now,
    updatedAt: now,
    model,
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

export function loadEvents(id: string): unknown[] {
  const file = join(sessionsDir, `${id}.events.jsonl`)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown)
}

export function loadSession(id: string): Session | null {
  const file = join(sessionsDir, `${id}.jsonl`)
  if (!existsSync(file)) return null
  const messages = readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ChatMessage)
  const firstUser = messages.find((m) => m.role === "user")
  return {
    id,
    title: firstUser?.content.slice(0, 60) ?? "Session",
    createdAt: messages[0]?.timestamp ?? Date.now(),
    updatedAt: messages[messages.length - 1]?.timestamp ?? Date.now(),
    model: "",
    messages,
  }
}

export function listSessions(): Session[] {
  mkdirSync(sessionsDir, { recursive: true })
  return readdirSync(sessionsDir)
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl"))
    .map((f) => loadSession(f.replace(/\.jsonl$/, "")))
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}