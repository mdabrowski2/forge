// Throttle proof: repeat notices collapse (count reported on change),
// error paths always pass, keys independent. Drives real publishNotice.
import { publishNotice } from "../src/transparency/notice"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const seen: any[] = []
const sinks = { push: (e: any) => seen.push(e) }
const data = () => ({ count: 2 });

{
  publishNotice("integ", "q-ok", data(), sinks)
  publishNotice("integ", "q-ok", data(), sinks)
  publishNotice("integ", "q-ok", data(), sinks)
  const got = seen.filter((e) => e.name === "q-ok")
  if (got.length !== 1) fail("repeats not collapsed: " + got.length)
}
{
  publishNotice("integ", "q-ok", { count: 3 }, sinks)
  const changed = seen.filter((e) => e.name === "q-ok").pop()
  if (changed.data._suppressedRepeats !== 2) fail("count missing: " + JSON.stringify(changed.data))
  if (changed.data.count !== 3) fail("changed data lost")
}
{
  // error paths bypass even when repeated identically
  const n0 = seen.length
  publishNotice("integ", "q-error", { error: "x" }, sinks)
  publishNotice("integ", "q-error", { error: "x" }, sinks)
  if (seen.length - n0 !== 2) fail("error bypass broken")
}
{
  // explicit opt-out bypasses regardless of name
  const n0 = seen.length
  publishNotice("integ", "q-ok2", { count: 1 }, { ...sinks, dedup: false } as any)
  publishNotice("integ", "q-ok2", { count: 1 }, { ...sinks, dedup: false } as any)
  if (seen.length - n0 !== 2) fail("opt-out bypass broken")
}
{
  // distinct keys independent
  const n0 = seen.length
  publishNotice("integ", "k1", { v: 1 }, sinks)
  publishNotice("other", "k1", { v: 1 }, sinks)
  if (seen.length - n0 !== 2) fail("key independence broken")
}
{
  // key order must not matter (canonical comparison)
  const n0 = seen.length
  publishNotice("integ", "ord", { a: 1, b: 2 }, sinks)
  publishNotice("integ", "ord", { b: 2, a: 1 }, sinks)
  if (seen.length - n0 !== 1) fail("key-order broke equality")
}
console.log("throttle OK")
