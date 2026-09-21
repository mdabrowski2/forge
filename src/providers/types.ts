import type { LanguageModel } from "ai"

export interface Provider {
  id: string
  name: string
  models: string[]
  defaultModel: string
  getModel(modelId: string): LanguageModel
}