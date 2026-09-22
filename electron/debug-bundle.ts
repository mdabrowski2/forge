// agent-ready debug bundle assembly — pure function over injected deps
// (zero Electron imports, headless-testable). Redaction reuses the shared
// constructor; truncation follows the notice marker convention.
import { redactValue, truncateNotice } from "../src/transparency/notice"
import type { ModInfo } from "../src/mods/loader"
import type { ChatMessage } from "../src/sessions/store"

export interface DebugBundleDeps {
  version: string
  platform: string
  dateISO: string
  config: unknown
  providers: { id: string; name: string; status: string; models: string[] }[]
  mods: ModInfo[]
  logTail: string[]
  messages: ChatMessage[]
  events: unknown[]
}

const DISCLAIMER = "> Review before sharing — conversation text is included verbatim; only config/provider credentials are redacted.";

const section = (title: string, body: string): string => `## ${title}\n\n${body || "(none)"}\n`

const asJson = (v: unknown): string => {
  const s = JSON.stringify(v, null, 2) ?? "(unserializable)"
  return s.length > 2000 ? truncateNotice(s) : s
}

export function assembleDebugBundle(d: DebugBundleDeps): string {
  const providers =
    d.providers.map((p) => `- ${p.id} (${p.name}): ${p.status}, models: ${p.models.join(", ") || "(none)"}`).join("\n") ||
    "(none)"
  const mods =
    d.mods
      .map((m) => `- ${m.dirName}: ${m.status}${m.error ? ` — ${m.error}` : ""}`)
      .join("\n") || "(none)"
  const messages =
    d.messages.map((m) => `- [${m.role}] ${(m.content ?? "").slice(0, 500)}`).join("\n") || "(none)"
  return [
    "# Forge debug bundle",
    "",
    DISCLAIMER,
    "",
    section("Environment", `- version: ${d.version}\n- platform: ${d.platform}\n- date: ${d.dateISO}`),
    section("Providers", providers),
    section("Mods", mods),
    section("Config (redacted)", asJson(redactValue(d.config))),
    section("Session messages", messages),
    section("Session events", asJson(d.events)),
    section("Log tail", d.logTail.join("\n") || "(none)"),
  ].join("\n")
}
