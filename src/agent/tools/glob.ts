import { z } from "zod"
import { readdirSync } from "fs"
import { join, resolve } from "path"
import { resolveInCwd } from "./paths"

// convert a glob pattern to a regex: ** (any depth), * (within a segment), ? (single char)
export const globToRegExp = (pattern: string): RegExp => {
  let re = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // **/ matches zero or more directories
        if (pattern[i + 2] === "/" || pattern[i + 2] === "\\") {
          re += "(?:.*[/\\\\])?"
          i += 2
        } else {
          re += ".*"
          i++
        }
      } else {
        re += "[^/\\\\]*"
      }
    } else if (c === "?") {
      re += "[^/\\\\]"
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${re}$`)
}

const SKIP = new Set(["node_modules", ".git", "dist", "release", ".cache", "target"])

export const globTool = (cwd: string) => ({
  description:
    "Find files by glob pattern (e.g. **/*.ts, src/**/*.tsx, *.json). Walks the directory tree, skipping node_modules/.git/dist. Returns up to 200 matches.",
  inputSchema: z.object({
    pattern: z.string().describe("Glob pattern relative to the search directory"),
    cwd: z
      .string()
      .optional()
      .describe("Directory to search from (defaults to the workspace root)"),
  }),
  execute: async ({ pattern, cwd: searchCwd }: { pattern: string; cwd?: string }) => {
    // patterns stay untouched (different input kind); only the base dir is confined
    const base = resolveInCwd(cwd, searchCwd ?? ".")
    if (!base) return `Refused: ${searchCwd} escapes the session working directory`
    const re = globToRegExp(pattern.replace(/\\/g, "/"))
    const results: string[] = []
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
        const rel = full.slice(base.length + 1).replace(/\\/g, "/")
        if (e.isDirectory()) walk(full, depth + 1)
        else if (re.test(rel)) results.push(full)
      }
    }
    walk(base, 0)
    if (!results.length) return `No files matched "${pattern}" under ${base}`
    return `${results.length} match(es):\n${results.join("\n")}`
  },
})