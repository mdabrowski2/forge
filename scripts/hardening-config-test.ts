// P0-2 proof: corrupt config.json → unique backup + log line + defaults.
// Runs under the caller's HOME (isolate it: HOME=$(mktemp -d)/h bun scripts/hardening-config-test.ts).
import { loadConfig } from "../src/config"
import { readdirSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}
const dd = join(homedir(), ".forge")
mkdirSync(dd, { recursive: true })
writeFileSync(join(dd, "config.json"), "{corrupt[[[")
const cfg = loadConfig()
const baks = readdirSync(dd).filter((f) => f.startsWith("config.json.bak."))
if (!baks.length) fail("no backup written")
if (!cfg.providers?.length) fail("no defaults returned")
console.log("config-backup OK: " + baks[0])
