import { z } from "zod"
import { writeFileSync, mkdirSync } from "fs"
import { dirname, resolve } from "path"

export const writeTool = {
  description:
    "Write a file to disk, creating parent directories as needed. Overwrites any existing content — use edit for surgical changes.",
  inputSchema: z.object({
    path: z.string().describe("Absolute path of the file to write"),
    content: z.string().describe("The full file content"),
  }),
  execute: async ({ path, content }: { path: string; content: string }) => {
    const abs = resolve(path)
    try {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content, "utf-8")
      return `Wrote ${content.length} chars to ${abs}`
    } catch (e) {
      return `Error writing ${abs}: ${e instanceof Error ? e.message : String(e)}`
    }
  },
}