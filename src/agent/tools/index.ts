import type { z } from "zod"
import { readTool } from "./read"
import { writeTool } from "./write"
import { editTool } from "./edit"
import { bashTool } from "./bash"
import { globTool } from "./glob"
import { grepTool } from "./grep"
import { registry, type ModWrappedTool, type ToolRuntime } from "../../mods/registry"

export interface ForgeTool {
  description: string
  inputSchema: z.ZodType
  execute: (
    input: any,
    options: { toolCallId: string; abortSignal?: AbortSignal }
  ) => unknown | Promise<unknown>
}

export type AnyTool = ForgeTool | ModWrappedTool

export const createTools = (runtime: ToolRuntime): Record<string, AnyTool> => ({
  read: readTool,
  write: writeTool,
  edit: editTool,
  bash: bashTool(runtime.cwd),
  glob: globTool(runtime.cwd),
  grep: grepTool(runtime.cwd),
  // mod tools are merged last so a mod can't shadow built-ins
  ...registry.getTools(runtime),
})