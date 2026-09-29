// login-shell env inheritance verification — run from the forge project root:
// bun scripts/shell-env-test.ts (throws on first failure)
import { strict as assert } from "node:assert"
import { parseEnvZero, missingOnly, mergePath, inheritShellEnv } from "../src/integrations/shell-env"

// NUL-separated KEY=VALUE: values may contain "=", trailing NUL tolerated,
// entries without "=" are ignored
const parsed = parseEnvZero("A=1\x00B=x=y\x00NOEQUALS\x00C=\x00")
assert.deepStrictEqual(parsed, { A: "1", B: "x=y", C: "" })

// inherit semantics: fill missing only, never overwrite, drop volatile keys
const patch = missingOnly(
  { PATH: "/usr/bin", KEEP: "old" } as NodeJS.ProcessEnv,
  { PATH: "/new/bin", KEEP: "new", FRESH: "v", _: "/bin/zsh", PWD: "/x", OLDPWD: "/y", SHLVL: "9" }
)
assert.deepStrictEqual(patch, { FRESH: "v" })
// PATH needs union semantics, not fill-missing: a thin-but-present GUI PATH
// (/usr/bin:/bin) must still gain the login shell's entries, in login order
assert.strictEqual(
  mergePath("/usr/bin:/bin", "/Users/x/.volta/bin:/usr/bin:/bin"),
  "/Users/x/.volta/bin:/usr/bin:/bin"
)
// already-complete PATH is untouched (no reordering, no dupes)
assert.strictEqual(mergePath("/a:/b", "/a:/b"), "/a:/b")
// missing/empty sides fall through
assert.strictEqual(mergePath(undefined, "/a"), "/a")
assert.strictEqual(mergePath("/a", undefined), "/a")
assert.strictEqual(mergePath("", "/a"), "/a")
console.log("section 1 green")

// real mechanism, no mocks: with PATH removed (simulating GUI launch), the
// login shell restores it; a bad shell fails open
const savedPath = process.env.PATH
delete process.env.PATH
try {
  const got = await inheritShellEnv({ shell: "/bin/sh" })
  assert.ok(typeof got.PATH === "string" && got.PATH.length > 0, "sh inheritance yields PATH")
} finally {
  if (savedPath !== undefined) process.env.PATH = savedPath
}
const empty = await inheritShellEnv({ shell: "/nonexistent-shell-xyz", timeoutMs: 2000 })
assert.deepStrictEqual(empty, {})
console.log("section 2 green")
