import { homedir } from "os"
import { resolve, relative, isAbsolute } from "path"
import { realpathSync } from "fs"

// models write shell-style ~/foo paths reflexively, but node's path module
// never expands that itself — every tool that resolves a model-supplied path
// needs this before calling resolve()
export const expandHome = (path: string): string => path.replace(/^~(?=$|[/\\])/, homedir())

const outside = (base: string, target: string): boolean => {
  const rel = relative(base, target)
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel))
}

/**
 * Resolve a model-supplied path against the session cwd, returning null when
 * it escapes. Platform-aware via node path (win32 drives/backslashes
 * handled). Symlinks checked best-effort with realpath where the target
 * exists (write/glob may target missing paths — lexical check then stands;
 * TOCTOU races out of scope for a single-user local client).
 * Applies to file paths and tool base dirs — never to glob patterns,
 * regexes, or shell commands (different input kinds, see audit #6).
 */
export const resolveInCwd = (cwd: string, input: string): string | null => {
  const abs = resolve(cwd, expandHome(input))
  if (outside(cwd, abs)) return null
  try {
    if (outside(realpathSync(cwd), realpathSync(abs))) return null
  } catch {
    // target need not exist — lexical check stands
  }
  return abs
}
