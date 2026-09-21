import { createAnthropic } from "@ai-sdk/anthropic"
import type { Provider } from "./types"

// editable in ~/.forge/config.json if newer models ship
const ANTHROPIC_MODELS = [
  "claude-opus-4-1",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]

export interface AnthropicProviderConfig {
  apiKey?: string
  defaultModel?: string
}

export function createAnthropicProvider(cfg: AnthropicProviderConfig): Provider {
  const apiKey = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY
  const client = apiKey ? createAnthropic({ apiKey }) : null

  return {
    id: "anthropic",
    name: "Anthropic",
    models: ANTHROPIC_MODELS,
    defaultModel: cfg.defaultModel ?? ANTHROPIC_MODELS[1] ?? "",
    getModel: (modelId: string) => {
      if (!client) {
        throw new Error(
          "Anthropic: no API key. Set ANTHROPIC_API_KEY or add apiKey to ~/.forge/config.json"
        )
      }
      return client(modelId)
    },
  }
}