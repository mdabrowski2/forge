// single source of truth for the Forge version: package.json at the repo/
// app root. Resolved relative to this file so it works both in dev
// (src/../package.json) and packaged (dist/../package.json — electron-builder
// ships package.json alongside dist/). Falls back to "dev" only when the
// file is absent (never in practice); scripts/version-test.ts pins equality.
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

export const FORGE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8")) as {
      version?: unknown
    }
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "dev"
  } catch {
    return "dev"
  }
})()
