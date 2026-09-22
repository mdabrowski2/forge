// mod loader — scans ~/.forge/mods/<name>/ for an entry file, imports it,
// validates the shape, and calls setup(api). A broken mod is logged and skipped,
// never crashes boot.
import { existsSync, readdirSync, cpSync, rmSync, mkdirSync } from "fs"
import { randomUUID } from "crypto"
import { tmpdir } from "os"
import { join } from "path"
import { pathToFileURL } from "url"
import { dataDir, type ForgeConfig } from "../config"
import type { ForgeMod } from "./api"
import { createApi } from "./registry"

export const modsDir = join(dataDir, "mods")

export interface ModLoadResult {
  loaded: string[]
  failed: { name: string; error: string }[]
  /** the directory that was scanned */
  dir: string
}

const ENTRY_CANDIDATES = ["index.js", "index.mjs"]

export async function loadMods(
  config: ForgeConfig,
  dir: string = modsDir,
  opts: { fresh?: boolean } = {}
): Promise<ModLoadResult> {
  const result: ModLoadResult = { loaded: [], failed: [], dir }
  if (!existsSync(dir)) return result

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dirName = entry.name
    // config.mods[<dir name>].enabled === false → skip
    if (config.mods[dirName]?.enabled === false) continue

    const entryFile = ENTRY_CANDIDATES.map((f) => join(dir, dirName, f)).find((f) => existsSync(f))
    if (!entryFile) continue

    try {
      // fresh (reload path): stage the whole mod dir into a new temp dir and
      // import from there. Bun caches ESM by path (query strings ignored) AND
      // caches directory entries (a 2nd new file per dir won't resolve), so
      // neither re-import nor same-dir temp copies load current disk state —
      // both proven empirically. A brand-new stage dir imports cleanly every
      // time, and sibling files keep relative imports resolving during setup.
      // The stage is removed after import: only post-setup lazy relative
      // imports would break (mods are single-file by convention; boot path
      // never stages, so its trace paths stay stable).
      let importURL = pathToFileURL(entryFile).href
      let stage: string | null = null
      if (opts.fresh) {
        stage = join(tmpdir(), `forge-reload-${Date.now()}-${randomUUID().slice(0, 8)}`)
        mkdirSync(stage, { recursive: true })
        cpSync(join(dir, dirName), join(stage, dirName), { recursive: true })
        const stagedEntry = ENTRY_CANDIDATES.map((f) => join(stage as string, dirName, f)).find((f) =>
          existsSync(f)
        )
        if (!stagedEntry) throw new Error(`staging failed for "${dirName}"`)
        importURL = pathToFileURL(stagedEntry).href
      }
      try {
        const mod = (await import(importURL)) as { default?: unknown }
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
      } finally {
        if (stage) {
          try {
            rmSync(stage, { recursive: true, force: true })
          } catch {
            /* best-effort; OS cleans tmp */
          }
        }
      }
    } catch (e) {
      result.failed.push({ name: dirName, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

export interface ModInfo {
  dirName: string
  enabled: boolean
  settings: Record<string, unknown>
  status: "loaded" | "failed" | "disabled"
  error?: string
}

// side-effect-free: never imports/executes mod code, just cross-references
// disk + config + the boot-time load result computed by loadMods above
export function listMods(config: ForgeConfig, lastResult: ModLoadResult, dir: string = modsDir): ModInfo[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dirName = e.name
      const enabled = config.mods[dirName]?.enabled !== false
      const settings = config.mods[dirName]?.settings ?? {}
      const failedEntry = lastResult.failed.find((f) => f.name === dirName)
      const status: ModInfo["status"] = !enabled ? "disabled" : failedEntry ? "failed" : "loaded"
      return { dirName, enabled, settings, status, error: failedEntry?.error }
    })
}