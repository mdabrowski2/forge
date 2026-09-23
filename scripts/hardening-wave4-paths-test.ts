// Task A proof: per-tool traversal matrix. Records observed allow/reject for
// escape attempts; file tools + base dirs must reject, patterns/regex/bash
// are exempt by input-kind (documented, not tested here).
import { resolveInCwd } from "../src/agent/tools/paths"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const cwd = "/tmp/w4-root/sub"
const ok = (input: string, expect: string | null) => {
  const got = resolveInCwd(cwd, input)
  if (got !== expect) fail(`resolveInCwd(${input}) = ${got}, want ${expect}`)
}
ok("a/b.txt", "/tmp/w4-root/sub/a/b.txt")
ok("/tmp/w4-root/sub/x", "/tmp/w4-root/sub/x")
ok("../evil", null)
ok("../../evil", null)
ok("/etc/hosts", null)
ok("~/../evil", null)
// leading .. is an escape attempt on sight (fail-closed, all platforms;
// on POSIX a backslash is technically a valid filename char, but a model
// typing backslash almost certainly meant a Windows escape)
ok("..\\evil", null)
ok("sub/../ok.txt", "/tmp/w4-root/sub/ok.txt")
console.log("paths-matrix OK")

// tool level: refusals return strings (existing file-error convention),
// writes must not side-effect outside cwd, patterns keep working
const tools = async () => {
  const { readTool } = await import("../src/agent/tools/read")
  const { writeTool } = await import("../src/agent/tools/write")
  const { editTool } = await import("../src/agent/tools/edit")
  const { globTool } = await import("../src/agent/tools/glob")
  const { grepTool } = await import("../src/agent/tools/grep")
  const { mkdtempSync, existsSync, writeFileSync, mkdirSync } = await import("fs")
  const { join } = await import("path")
  const { tmpdir } = await import("os")
  const root = mkdtempSync(join(tmpdir(), "w4t-"))
  const sub = join(root, "sub")
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, "ok.txt"), "hello")
  const tfail = (m: string): never => {
    console.error("FAIL(tool):", m)
    process.exit(1)
  }
  const r = await readTool(sub).execute({ path: "../evil" }, { toolCallId: "t" })
  if (typeof r !== "string" || !r.startsWith("Refused:")) tfail("read escape: " + r)
  const w = await writeTool(sub).execute({ path: "../evil.txt", content: "x" }, { toolCallId: "t" })
  if (typeof w !== "string" || !w.startsWith("Refused:")) tfail("write escape: " + w)
  if (existsSync(join(root, "evil.txt"))) tfail("write side-effect escaped cwd")
  const e = await editTool(sub).execute({ path: "../evil", oldString: "a", newString: "b" }, { toolCallId: "t" })
  if (typeof e !== "string" || !e.startsWith("Refused:")) tfail("edit escape: " + e)
  const g = await globTool(sub).execute({ pattern: "*.txt", cwd: sub }, { toolCallId: "t" })
  if (typeof g !== "string" || !g.includes("ok.txt")) tfail("glob pattern broken: " + g)
  const gg = await globTool(sub).execute({ pattern: "*.txt", cwd: "/etc" }, { toolCallId: "t" })
  if (typeof gg !== "string" || !gg.startsWith("Refused:")) tfail("glob base escape: " + gg)
  const gr = await grepTool(sub).execute({ pattern: "hello", path: sub }, { toolCallId: "t" })
  if (typeof gr !== "string" || !gr.includes("ok.txt")) tfail("grep broken: " + gr)
  // bash explicitly exempt (a shell with a cwd is not a sandbox) — untouched
  console.log("tools-matrix OK")
}
await tools()
