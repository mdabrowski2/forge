import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { Provider } from "./types"

export interface OllamaProviderConfig {
  baseURL: string
  defaultModel?: string
}

export async function createOllamaProvider(cfg: OllamaProviderConfig): Promise<Provider> {
  const client = createOpenAICompatible({
    name: "ollama",
    baseURL: cfg.baseURL,
    apiKey: "ollama", // required by the SDK, ignored by Ollama
  })

  // discover installed models from the Ollama API (root endpoint, not /v1)
  let models: string[] = []
  try {
    const res = await fetch(cfg.baseURL.replace(/\/v1\/?$/, "") + "/api/tags")
    if (res.ok) {
      const data = (await res.json()) as { models?: { name: string }[] }
      models = (data.models ?? []).map((m) => m.name).sort()
    }
  } catch {
    // Ollama not running — fall through with empty model list
  }

  const defaultModel =
    cfg.defaultModel && models.includes(cfg.defaultModel)
      ? cfg.defaultModel
      : (models[0] ?? cfg.defaultModel ?? "")

  return {
    id: "ollama",
    name: "Ollama (local)",
    models,
    defaultModel,
    getModel: (modelId: string) => client(modelId),
  }
}