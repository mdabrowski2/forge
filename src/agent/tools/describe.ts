// serializable tool definitions for the transparency `request` event —
// what the model actually receives as the `tools` block of the API call.
// Built-ins carry zod schemas (converted via zod's native toJSONSchema);
// mod tools already carry plain JSON Schema (passed through verbatim).
// Anything unrecognized is labeled, never silently dropped.
import type { AnyTool } from "./index"

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: unknown
}

const toJsonSchema = (schema: unknown): unknown => {
  if (schema !== null && typeof schema === "object") {
    if ("jsonSchema" in schema) return (schema as { jsonSchema: unknown }).jsonSchema
    const maybeZod = schema as { toJSONSchema?: () => unknown }
    if (typeof maybeZod.toJSONSchema === "function") return maybeZod.toJSONSchema()
  }
  return { kind: "unserializable", note: "see tool source for input shape" }
}

export function describeTools(tools: Record<string, AnyTool>): ToolDefinition[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: toJsonSchema(tool.inputSchema),
  }))
}
