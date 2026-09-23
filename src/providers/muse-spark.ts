import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import type { ProviderConfig } from "../config"
import type { Provider } from "./types"

/**
 * First-class Muse Spark provider.
 *
 * Verified serving path (Zen docs + endpoint probes, 2026-09-21): OpenCode
 * Zen serves `muse-spark-1.3-contributor-free` on the Responses API
 * ({base}/responses, @ai-sdk/openai) — NOT /chat/completions (which answers
 * 404/500 for this model). Third-party OpenAI-compatible mirrors (nano-gpt,
 * …) use the chat transport instead; `transport` selects explicitly and
 * defaults by endpoint (opencode.ai/zen → responses, anything else → chat).
 *
 * Auth resolution order: explicit config apiKey/baseURL win, then
 * MUSE_SPARK_API_KEY / MUSE_SPARK_BASE_URL, then OPENCODE_API_KEY
 * (your `opencode auth login` credential) for the Zen default.
 */
const ZEN_BASE_URL = "https://opencode.ai/zen/v1"
const DEFAULT_MODEL = "muse-spark-1.3-contributor-free"

export async function createMuseSparkProvider(pc: ProviderConfig): Promise<Provider> {
  const baseURL = pc.baseURL ?? process.env.MUSE_SPARK_BASE_URL ?? ZEN_BASE_URL
  const apiKey = pc.apiKey ?? process.env.MUSE_SPARK_API_KEY ?? process.env.OPENCODE_API_KEY
  const transport = pc.transport ?? (baseURL.includes("opencode.ai/zen") ? "responses" : "chat")

  const openai = createOpenAI({ baseURL, apiKey })
  const compat = createOpenAICompatible({ name: pc.id, baseURL, apiKey })
  const getModel = (modelId: string): LanguageModel =>
    transport === "responses" ? openai(modelId) : compat(modelId)

  // model list via the public list-models API (transport-independent);
  // falls back to the configured pin when discovery fails
  let models: string[] = []
  let discoveryFailed = false
  try {
    const res = await fetch(baseURL.replace(/\/+$/, "") + "/models", {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    if (res.ok) {
      const data = (await res.json()) as { data?: { id: string }[] }
      models = (data.data ?? []).map((m) => m.id).sort()
      console.log(`[providers] muse-spark discovery: ${models.length} models`)
    } else {
      discoveryFailed = true
      console.error(`[providers] muse-spark discovery failed: HTTP ${res.status} — using configured pin`)
    }
  } catch (e) {
    discoveryFailed = true
    console.error(`[providers] muse-spark discovery failed: ${e instanceof Error ? e.message : String(e)} — using configured pin`)
  }
  if (!models.length) models = pc.models?.length ? [...pc.models] : []
  if (pc.defaultModel && !models.includes(pc.defaultModel)) models.unshift(pc.defaultModel)
  if (!models.includes(DEFAULT_MODEL)) models.unshift(DEFAULT_MODEL)

  return {
    id: pc.id,
    name: pc.name,
    models,
    defaultModel: pc.defaultModel ?? DEFAULT_MODEL,
    status: discoveryFailed ? "unreachable" : "ok",
    getModel,
  }
}
