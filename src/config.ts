import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

export type ProviderKind = "ollama" | "anthropic" | "openai-compatible" | "muse-spark" | "opencode-cli"

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  /**
   * Disable without deleting. Prefer this over removing an entry: loadConfig
   * merges missing *default* providers back in by id, so a deleted default
   * reappears on next boot while a disabled one stays skipped.
   */
  disabled?: boolean
  baseURL?: string
  apiKey?: string
  /** extra HTTP headers for OpenAI-compatible endpoints */
  headers?: Record<string, string>
  models?: string[]
  defaultModel?: string
  /** opt-in: endpoint honors OpenAI-style `reasoning_effort` (thinking trace) */
  reasoningEffort?: boolean
  /**
   * Transport for OpenAI-family endpoints. `responses` (default for muse-spark)
   * targets {baseURL}/responses via @ai-sdk/openai; `chat` targets
   * {baseURL}/chat/completions via @ai-sdk/openai-compatible.
   */
  transport?: "responses" | "chat"
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
    {
      id: "muse-spark",
      name: "Muse Spark (remote)",
      kind: "muse-spark",
      baseURL: process.env.MUSE_SPARK_BASE_URL,
      apiKey: process.env.MUSE_SPARK_API_KEY,
      models: ["muse-spark-1.3-contributor-free"],
      defaultModel: "muse-spark-1.3-contributor-free",
    },
    {
      id: "opencode-cli",
      name: "Opencode CLI proxy",
      kind: "opencode-cli",
      models: ["opencode/muse-spark-1.3-contributor-free"],
      defaultModel: "opencode/muse-spark-1.3-contributor-free",
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
    // Merge by id: user entries win untouched; missing *default* providers
    // are appended so new built-in kinds reach existing configs on upgrade.
    const merged = [...(parsed.providers ?? [])]
    for (const d of def.providers) {
      if (!merged.some((p) => p.id === d.id)) merged.push(d)
    }
    return {
      providers: parsed.providers ? merged : def.providers,
      theme: parsed.theme ?? def.theme,
      cwd: parsed.cwd ?? def.cwd,
      thinking: parsed.thinking ?? def.thinking,
      mods: parsed.mods ?? def.mods,
    }
  } catch {
    try {
      const bak = `${configPath}.bak.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      writeFileSync(bak, readFileSync(configPath, "utf-8"))
      console.error(`[config] corrupt config backed up to ${bak}; loaded defaults`)
    } catch {
      /* backup best-effort; never break boot */
    }
    return defaultConfig()
  }
}

export function saveConfig(config: ForgeConfig): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}