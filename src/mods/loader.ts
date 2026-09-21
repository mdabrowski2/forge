// mod loader — scans ~/.forge/mods/<name>/ for an entry file, imports it,
// validates the shape, and calls setup(api). A broken mod is logged and skipped,
// never crashes boot.
import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { pathToFileURL } from "url"
import { dataDir, type ForgeConfig } from "../config"
import type { ForgeMod } from "./api"
import { createApi } from "./registry"

export const modsDir = join(dataDir, "mods")

export interface ModLoadResult {
  loaded: string[]
  failed: { name: string; error: string }[]
}

const ENTRY_CANDIDATES = ["index.js", "index.mjs"]

export async function loadMods(config: ForgeConfig, dir: string = modsDir): Promise<ModLoadResult> {
  const result: ModLoadResult = { loaded: [], failed: [] }
  if (!existsSync(dir)) return result

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dirName = entry.name
    // config.mods[<dir name>].enabled === false → skip
    if (config.mods[dirName]?.enabled === false) continue

    const entryFile = ENTRY_CANDIDATES.map((f) => join(dir, dirName, f)).find((f) => existsSync(f))
    if (!entryFile) continue

    try {
      const mod = (await import(pathToFileURL(entryFile).href)) as { default?: unknown }
      const def = mod.default as ForgeMod | undefined
      if (!def || typeof def.name !== "string" || typeof def.setup !== "function") {
        result.failed.push({
          name: dirName,
          error: "default export must be { name, version, setup(api) }",
        })
        continue
      }
      const api = createApi(config, def.name)
      def.setup(api)
      result.loaded.push(def.name)
    } catch (e) {
      result.failed.push({ name: dirName, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}