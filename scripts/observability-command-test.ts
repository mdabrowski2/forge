// Task 2 proof: runCommand outcomes for ok / ok-false / throw / unknown.
// Headless IPC is unavailable, so this pins the extracted helper directly
// (isolated HOME); the one-line publishNotice wiring in the handler is
// review-verified. Failing-command and unknown-command paths MUST emit
// notices too — the proof asserts the result shapes the handler switches on.
import { runCommand } from "../electron/commands"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const session: any = { id: "w3-cmd-test", cwd: "/tmp" }
const registry: any = {
  setActiveSession: () => {},
  getCommands: () => [
    { name: "ping", description: "pong", run: (args: string) => "pong:" + args },
    {
      name: "boom",
      description: "throws",
      run: () => {
        throw new Error("kablam")
      },
    },
  ],
}

const main = async () => {
  const ok = await runCommand("/ping x", { session, registry })
  if (!ok.ok || ok.text !== "pong:x" || ok.name !== "ping" || ok.args !== "x") fail("ping: " + JSON.stringify(ok))
  const badDir = await runCommand("/cd /nonexistent-dir-xyz", { session, registry })
  if (badDir.ok || !badDir.error || badDir.name !== "cd") fail("cd-fail: " + JSON.stringify(badDir))
  const threw = await runCommand("/boom", { session, registry })
  if (threw.ok || threw.error !== "kablam" || threw.name !== "boom") fail("throw: " + JSON.stringify(threw))
  const unknown = await runCommand("/nope", { session, registry })
  if (unknown.ok || !unknown.error?.includes("unknown command")) fail("unknown: " + JSON.stringify(unknown))
  const notCmd = await runCommand("just chatting", { session, registry })
  if (notCmd.ok || notCmd.error !== "not a command") fail("non-command: " + JSON.stringify(notCmd))
  console.log("command-trace OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
