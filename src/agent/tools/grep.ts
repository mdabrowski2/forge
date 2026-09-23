import { z } from "zod"
import { readdirSync, readFileSync, statSync } from "fs"
import { join, resolve } from "path"
import { globToRegExp } from "./glob"
import { resolveInCwd } from "./paths"

const SKIP = new Set(["node_modules", ".git", "dist", "release", ".cache", "target"])

export const grepTool = (cwd: string) => ({
  description:
    "Search file contents with a regular expression. Returns matching file paths, line numbers, and the matching line (truncated to 200 chars). Up to 200 matches.",
  inputSchema: z.object({
    pattern: z.string().describe("Regular expression to search for"),
    path: z
      .string()
      .optional()
      .describe("Directory or file to search (defaults to the workspace root)"),
    include: z
      .string()
      .optional()
      .describe("Only search files whose name matches this glob (e.g. *.ts, *.{ts,tsx})"),
  }),
  execute: async ({
    pattern,
    path: searchPath,
    include,
  }: {
    pattern: string
    path?: string
    include?: string
  }) => {
    let re: RegExp
    try {
      re = new RegExp(pattern)
    } catch (e) {
      return `Invalid regex: ${e instanceof Error ? e.message : String(e)}`
    }
    const incRe = include ? globToRegExp(include) : null
    const base = resolveInCwd(cwd, searchPath ?? ".")
    if (!base) return `Refused: ${searchPath} escapes the session working directory`
    const results: string[] = []

    const searchFile = (file: string) => {
      if (incRe && !incRe.test(file.split(/[\\/]/).pop() ?? "")) return
      try {
        const content = readFileSync(file, "utf-8")
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            results.push(`${file}:${i + 1}: ${lines[i].slice(0, 200)}`)
            if (results.length >= 200) return
          }
        }
      } catch {
        // binary or unreadable — skip
      }
    }

    const walk = (dir: string, depth: number) => {
      if (results.length >= 200 || depth > 12) return
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (SKIP.has(e.name)) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full, depth + 1)
        else searchFile(full)
      }
    }

    try {
      const st = statSync(base)
      if (st.isFile()) searchFile(base)
      else walk(base, 0)
    } catch {
      return `Error: ${base} does not exist`
    }

    if (!results.length) return `No matches for /${pattern}/ under ${base}`
    return `${results.length} match(es):\n${results.join("\n")}`
  },
})