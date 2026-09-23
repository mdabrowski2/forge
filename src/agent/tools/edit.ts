import { z } from "zod"
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"
import { resolveInCwd } from "./paths"

export const editTool = (cwd: string) => ({
  description:
    "Replace an exact string in a file with a new string. Fails if the old string is not found or matches multiple times — include more surrounding context to disambiguate.",
  inputSchema: z.object({
    path: z.string().describe("Absolute path, or relative to the session's cwd, of the file to edit"),
    oldString: z.string().describe("The exact text to replace (must appear exactly once)"),
    newString: z.string().describe("The replacement text"),
  }),
  execute: async ({
    path,
    oldString,
    newString,
  }: {
    path: string
    oldString: string
    newString: string
  }) => {
    const abs = resolveInCwd(cwd, path)
    if (!abs) return `Refused: ${path} escapes the session working directory`
    let content: string
    try {
      content = readFileSync(abs, "utf-8")
    } catch (e) {
      return `Error reading ${abs}: ${e instanceof Error ? e.message : String(e)}`
    }
    const count = content.split(oldString).length - 1
    if (count === 0) return `Error: oldString not found in ${abs}`
    if (count > 1)
      return `Error: oldString matches ${count} times in ${abs} — include more surrounding context`
    writeFileSync(abs, content.replace(oldString, newString), "utf-8")
    return `Edited ${abs}: replaced 1 occurrence`
  },
})