// usage: bun scripts/mod-check.ts <modDir> — validates one mod folder in this throwaway process
import { existsSync } from "fs"
import { join } from "path"
import { pathToFileURL } from "url"
import { defaultConfig } from "../src/config"
import { createApi, registry } from "../src/mods/registry"

const dir = process.argv[2]
if (!dir) {
  console.error("usage: bun scripts/mod-check.ts <modDir>")
  process.exit(2)
}
const entry = ["index.js", "index.mjs"].map((f) => join(dir, f)).find((f) => existsSync(f))
if (!entry) {
  console.error(`no entry file: ${dir}/index.{js,mjs} missing`)
  process.exit(2)
}
try {
  const mod = (await import(pathToFileURL(entry).href)) as { default?: { name?: unknown; setup?: unknown } }
  const def = mod.default
  if (!def || typeof def.name !== "string" || typeof (def as { setup?: unknown }).setup !== "function") {
    console.error("default export must be { name, version, setup(api) }")
    process.exit(1)
  }
  ;(def as { setup: (api: unknown) => void }).setup(createApi(defaultConfig(), def.name))
  const cmds = registry.getCommands().map((c) => c.name).join(",") || "(none)"
  console.log(`valid: name=${def.name} commands=[${cmds}]`)
} catch (e) {
  console.error(`invalid: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
