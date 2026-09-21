import { z } from "zod"
import { readFileSync, statSync } from "fs"
import { resolve } from "path"

export const readTool = {
  description:
    "Read a text file from disk. Use offset/limit to read specific line ranges of large files. Long lines are truncated at 2000 chars.",
  inputSchema: z.object({
    path: z.string().describe("Absolute path to the file to read"),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("1-based line number to start from"),
    limit: z.number().int().positive().optional().describe("Maximum number of lines to read"),
  }),
  execute: async ({ path, offset, limit }: { path: string; offset?: number; limit?: number }) => {
    const abs = resolve(path)
    let content: string
    try {
      const st = statSync(abs)
      if (!st.isFile()) return `Not a file: ${abs}`
      content = readFileSync(abs, "utf-8")
    } catch (e) {
      return `Error reading ${abs}: ${e instanceof Error ? e.message : String(e)}`
    }
    const lines = content.split("\n")
    const start = offset ? Math.max(0, offset - 1) : 0
    const end = limit ? Math.min(lines.length, start + limit) : lines.length
    const slice = lines.slice(start, end).map((l) =>
      l.length > 2000 ? l.slice(0, 2000) + "… [line truncated]" : l
    )
    return `File: ${abs}\nLines: ${lines.length} total, showing ${start + 1}–${end}\n\n${slice.join("\n")}`
  },
}