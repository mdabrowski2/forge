// login-shell environment inheritance for GUI-launched processes.
//
// A Finder/dock-launched Electron app is a launchd child with a minimal
// environment (PATH=/usr/bin:/bin:/usr/sbin:/sbin, no shell profile vars),
// so child processes (the `bb` CLI behind the Bitbucket preview, the `bash`
// tool, mod CLIs) can't resolve user-installed binaries or credentials.
// Terminal launches inherit everything, which is why the same code works
// there. This module reconstructs the login-shell environment once at boot:
// `$SHELL -ilc 'env -0'`, parsed NUL-delimited (no quoting pitfalls), merged
// as fill-missing-only so it can never override what the process already has.
//
// Trust note: this executes the user's own shell rc files — the same code
// that runs on every terminal launch. No new trust introduced.
// Platform note: macOS-first (zsh fallback); on Windows without SHELL the
// spawn fails and the caller gets {} (fail-open, existing behavior).
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

/** keys that must never cross from the login shell (stale process state) */
const VOLATILE = new Set(["_", "PWD", "OLDPWD", "SHLVL"])

/** parse NUL-delimited `env -0` output; entries without `=` are ignored */
export function parseEnvZero(output: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of output.split("\0")) {
    if (!entry) continue
    const eq = entry.indexOf("=")
    if (eq < 0) continue
    out[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return out
}

/** PATH union: a thin-but-present PATH (GUI launch) must still gain the login
 * shell's entries. Absent login entries prepend in login order (login-shell
 * precedence wins, reconstructing terminal order exactly when current is a
 * subset); present entries never move, so a rich terminal PATH is untouched */
export function mergePath(current: string | undefined, login: string | undefined): string | undefined {
  if (!login) return current
  if (!current) return login
  const seen = new Set(current.split(":"))
  const missing = login.split(":").filter((p) => p && !seen.has(p))
  return [...missing, ...current.split(":")].join(":")
}

/** fill-missing-only merge: inherit, never override; drop volatile keys.
 * PATH is handled separately by mergePath (a present-but-thin PATH must
 * still be enriched, which fill-missing would skip) */
export function missingOnly(
  current: NodeJS.ProcessEnv,
  parsed: Record<string, string>
): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (VOLATILE.has(k)) continue
    if (current[k] === undefined) patch[k] = v
  }
  return patch
}

/** run the login shell once and return the inheritable patch; {} on any failure */
export async function inheritShellEnv(opts?: {
  shell?: string
  timeoutMs?: number
}): Promise<Record<string, string>> {
  const shell = opts?.shell ?? process.env.SHELL ?? "/bin/zsh"
  try {
    const { stdout } = await execFileAsync(shell, ["-ilc", "env -0"], {
      timeout: opts?.timeoutMs ?? 10000,
      maxBuffer: 10 * 1024 * 1024,
    })
    const parsed = parseEnvZero(stdout)
    const patch = missingOnly(process.env, parsed)
    const mergedPath = mergePath(process.env.PATH, parsed.PATH)
    if (mergedPath !== undefined && mergedPath !== process.env.PATH) patch.PATH = mergedPath
    return patch
  } catch {
    return {}
  }
}
