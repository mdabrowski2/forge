// Task B proof: openPath validation seam, quest timeout, budget detector.
// All hermetic (stub server, no real shell opens, no model).
import { resolveOpenTarget } from "../electron/commands"
import { isBudgetExhausted } from "../src/agent/loop"
import { fetchQuestPreview } from "../src/integrations/quest-tracker"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const main = async () => {
  if (resolveOpenTarget("") !== null || resolveOpenTarget("   ") !== null || resolveOpenTarget(42) !== null)
    fail("open validation")
  if (resolveOpenTarget("  /tmp  ") !== "/tmp") fail("open trim")

  if (!isBudgetExhausted(8, true, false)) fail("budget exit undetected")
  if (isBudgetExhausted(8, true, true)) fail("abort misattributed as budget exit")
  if (isBudgetExhausted(3, false, false)) fail("clean exit flagged")
  if (isBudgetExhausted(8, false, false)) fail("no-toolcalls flagged")

  const slow = Bun.serve({ port: 0, fetch: async () => {
    await new Promise((r) => setTimeout(r, 300))
    return Response.json([])
  } })
  const r = await fetchQuestPreview(`http://127.0.0.1:${slow.port}`, 50)
  slow.stop()
  if (r.ok || !/timed out|abort/i.test(r.error)) fail("quest timeout: " + JSON.stringify(r))
  console.log("traces OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
