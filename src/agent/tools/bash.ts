import { z } from "zod"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

export const bashTool = (cwd: string) => ({
  description:
    "Run a shell command on the user's machine via PowerShell. Captures stdout and stderr. Use for git, bun, npm, file operations, and anything else that needs the shell.",
  inputSchema: z.object({
    command: z.string().describe("The PowerShell command to run"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(120000)
      .optional()
      .default(30000)
      .describe("Timeout in milliseconds (max 120000)"),
  }),
  execute: async ({ command, timeoutMs }: { command: string; timeoutMs?: number }) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { cwd, timeout: timeoutMs ?? 30000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      )
      const out = stdout.trim()
      const err = stderr.trim()
      if (out && err) return `${out}\n\n[stderr]\n${err}`
      return out || err || "(no output)"
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      const parts = [`Error: ${err.message ?? String(e)}`]
      if (err.stdout?.trim()) parts.push(err.stdout.trim())
      if (err.stderr?.trim()) parts.push(err.stderr.trim())
      return parts.join("\n")
    }
  },
})