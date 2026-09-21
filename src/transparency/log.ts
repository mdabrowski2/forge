// persistent transparency log — every request/chunk/finish/error is appended
// to ~/.forge/logs/forge.log as JSONL so nothing is ever hidden
import { appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import { dataDir } from "../config"

const logDir = join(dataDir, "logs")
const logFile = join(logDir, "forge.log")

export function logEvent(event: unknown): void {
  try {
    mkdirSync(logDir, { recursive: true })
    appendFileSync(logFile, JSON.stringify(event) + "\n")
  } catch {
    // logging must never break the app
  }
}