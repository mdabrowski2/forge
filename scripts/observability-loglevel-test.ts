// Gate log-level proof: secrets must not reach forge.log through the real
// logEvent path. Drives traceMutation (the exact helper handlers call) under
// isolated HOME, then greps the seeded forge.log.
// (Isolate it: HOME=$(mktemp -d)/h bun scripts/observability-loglevel-test.ts)
import { traceMutation } from "../electron/mutations"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

traceMutation(
  "config",
  "providers",
  { providers: [{ id: "a", apiKey: "SEED-SECRET-BEFORE" }] },
  { providers: [{ id: "a", apiKey: "SEED-SECRET-AFTER" }] },
  {}
)
const log = join(homedir(), ".forge", "logs", "forge.log")
if (!existsSync(log)) fail("no forge.log written")
const body = readFileSync(log, "utf-8")
if (body.includes("SEED-SECRET-BEFORE") || body.includes("SEED-SECRET-AFTER")) fail("secret reached forge.log")
if (!body.includes("<redacted>")) fail("redaction marker missing from forge.log")
console.log("loglevel OK")
