// core notice constructor + fan-out. Notices are turn-less unless a producer
// tags one (turn = session.messages.length at emit time — the rendering
// contract in the Wave 3 plan).
//
// Redaction is token-based, not substring-based: keys are split on case and
// separator boundaries and matched against SENSITIVE, so `monkey` and
// `keyboard` survive while `apiKey`, `client_secret`, `accessToken` don't.
// Limitation (documented, not silent): a bare-string payload has no key
// context and passes through — never put a raw secret in `data`; use an
// object like { apiKey: value } so redaction can see it.
// Truncation IS centralized: bare strings over MAX are cut with an exact
// marker. Object payloads pass through — callers truncate known-large
// fields before calling (e.g. command output).
import { logEvent } from "./log"
import { registry } from "../mods/registry"
import { appendEvent, type Session } from "../sessions/store"
import type { TransparencyEvent } from "./types"

export const MAX_NOTICE_LEN = 2000

const SENSITIVE = new Set(["api", "key", "apikey", "secret", "token", "password", "passwd", "pwd", "bearer", "auth", "credential", "private"])

const isSensitiveKey = (key: string): boolean =>
  key
    .split(/(?=[A-Z])|[_-]+/)
    .some((tok) => SENSITIVE.has(tok.toLowerCase()))

const redactValue = (v: unknown): unknown => {
  if (typeof v === "string") return v
  if (Array.isArray(v)) return v.map(redactValue)
  if (v !== null && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, isSensitiveKey(k) ? "<redacted>" : redactValue(val)])
    )
  return v
}

export const truncateNotice = (s: string): string =>
  s.length > MAX_NOTICE_LEN ? s.slice(0, MAX_NOTICE_LEN) + `… [truncated ${s.length - MAX_NOTICE_LEN} chars]` : s

export type NoticeEvent = Extract<TransparencyEvent, { type: "notice" }>

export const notice = (source: string, name: string, data: unknown = {}, callId = ""): NoticeEvent => ({
  type: "notice",
  callId,
  source,
  name,
  data: typeof data === "string" ? truncateNotice(data) : redactValue(data),
  timestamp: Date.now(),
});

export interface NoticeSinks {
  /** tag + persist to the session's events file (turn defaults to messages.length) */
  session?: Session
  turn?: number
  /** live push (renderer socket, transcript ring — owned by the caller) */
  push?: (event: TransparencyEvent) => void
}

/** single fan-out every producer uses: log + mod hooks always; session + push when given. */
export const publishNotice = (
  source: string,
  name: string,
  data: unknown,
  sinks: NoticeSinks = {},
  callId = ""
): NoticeEvent => {
  const event = notice(source, name, data, callId)
  logEvent(event)
  registry.emitHook("transparencyEvent", event)
  if (sinks.session) appendEvent(sinks.session, { ...event, turn: sinks.turn ?? sinks.session.messages.length })
  sinks.push?.(event)
  return event
}
