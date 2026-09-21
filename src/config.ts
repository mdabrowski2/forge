import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

export type ProviderKind = "ollama" | "anthropic"

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  baseURL?: string
  apiKey?: string
  models?: string[]
  defaultModel?: string
}

export interface ModConfig {
  enabled?: boolean
  settings?: Record<string, unknown>
}

export interface ForgeConfig {
  providers: ProviderConfig[]
  theme: "dark" | "light"
  /** working directory for tools (bash/glob/grep) */
  cwd: string
  /** enable model reasoning (thinking) — the trace streams into a card */
  thinking: boolean
  /** mods keyed by directory name in ~/.forge/mods/; absent = enabled */
  mods: Record<string, ModConfig>
}

export const dataDir = join(homedir(), ".forge")
export const configPath = join(dataDir, "config.json")

export const defaultConfig = (): ForgeConfig => ({
  providers: [
    {
      id: "ollama",
      name: "Ollama (local)",
      kind: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
      defaultModel: "qwen3.6:35b-a3b-coding",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      kind: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultModel: "claude-sonnet-4-5",
    },
  ],
  theme: "dark",
  cwd: homedir(),
  thinking: true,
  mods: {},
})

export function loadConfig(): ForgeConfig {
  mkdirSync(dataDir, { recursive: true })
  if (!existsSync(configPath)) {
    const cfg = defaultConfig()
    writeFileSync(configPath, JSON.stringify(cfg, null, 2))
    return cfg
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<ForgeConfig>
    const def = defaultConfig()
    return {
      providers: parsed.providers ?? def.providers,
      theme: parsed.theme ?? def.theme,
      cwd: parsed.cwd ?? def.cwd,
      thinking: parsed.thinking ?? def.thinking,
      mods: parsed.mods ?? def.mods,
    }
  } catch {
    return defaultConfig()
  }
}