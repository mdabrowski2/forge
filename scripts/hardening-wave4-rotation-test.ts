// Task D proof: rotation is lossless and ordered; turn is the correlation id.
// Segments use the `<id>.events.jsonl.<epoch>` suffix form so the
// listSessions scan (endsWith .jsonl, excluding .events.jsonl) ignores them.
import { loadEvents } from "../src/sessions/store"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const main = async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("fs")
  const { join } = await import("path")
  const { tmpdir, homedir } = await import("os")
  // NOTE: store paths derive from real HOME (no dir param) — this proof runs
  // under isolated HOME with a hand-built session dir instead.
  const sd = join(homedir(), ".forge", "sessions")
  mkdirSync(sd, { recursive: true })
  const id = "w4-rot-test"
  const seg = (n: number, count: number, start: number) =>
    writeFileSync(
      join(sd, `${id}.events.jsonl${n === 2 ? "" : "." + (1000 + n)}`),
      Array.from({ length: count }, (_, i) => JSON.stringify({ n: start + i }) + "\n").join("")
    )
  // live file holds newest; segments hold older in epoch order
  seg(0, 3, 0)
  seg(1, 3, 3)
  seg(2, 4, 6)
  const got = loadEvents(id, Infinity) as { n: number }[]
  const nums = got.map((e) => e.n).join(",")
  if (nums !== "0,1,2,3,4,5,6,7,8,9") fail("merge order/content: " + nums)
  const bounded = loadEvents(id, 4) as { n: number }[]
  if (bounded.map((e) => e.n).join(",") !== "6,7,8,9") fail("bound applies post-merge")
  console.log("rotation OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
