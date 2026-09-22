// 5b proof: preview notices switch on result.ok (neither fetch fn throws
// across its boundary); comment-fetch visibility via commentsOk; bb driven by
// in-repo fake binary (scripts/fixtures/bb, self-PATH-wired); quest driven by
// local stub HTTP server (fetchQuestPreview takes baseUrl — no network).
import { loadQuestPreview, loadPrPreview } from "../electron/previews"
import { join } from "path"

process.env.PATH = `${join(import.meta.dir, "fixtures")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}

const main = async () => {
  const seen: any[] = []
  const sinks = { push: (e: any) => seen.push(e) };

  // quest ok: 3 quests, 1 done -> 2 active
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      req.url.endsWith("/api/quests")
        ? Response.json([
            { id: "1", title: "a", status: "open", daysSinceTouched: 1 },
            { id: "2", title: "b", status: "done", daysSinceTouched: 9 },
            { id: "3", title: "c", status: "open", daysSinceTouched: 2 },
          ])
        : new Response("nope", { status: 500 }),
  })
  const base = `http://127.0.0.1:${server.port}`
  const qr = await loadQuestPreview(sinks, base)
  if (!qr.ok || qr.quests.length !== 2) fail("quest ok: " + JSON.stringify(qr))
  const qn = seen.find((e) => e.name === "quest-preview-ok")
  if (!qn || qn.data.count !== 2) fail("quest notice: " + JSON.stringify(seen))

  // quest error: unreachable port (nothing listens; no external network)
  const qbad = await loadQuestPreview(sinks, "http://127.0.0.1:1")
  if (qbad.ok) fail("quest unreachable should fail")
  if (!seen.some((e) => e.name === "quest-preview-error" && typeof e.data.error === "string"))
    fail("quest error notice missing")
  server.stop()

  // bitbucket ok via fake bb
  const pr = await loadPrPreview(sinks)
  if (!pr.ok || pr.prs.length !== 1) fail("pr ok: " + JSON.stringify(pr))
  if (pr.prs[0].commentsOk !== true) fail("commentsOk missing: " + JSON.stringify(pr.prs[0]))
  const pn = seen.find((e) => e.name === "pr-preview-ok")
  if (!pn || pn.data.count !== 1) fail("pr notice: " + JSON.stringify(seen))
  if (JSON.stringify(pn).includes("needs work")) fail("comment text leaked into notice")

  // bitbucket failure via FAKE_BB_MODE
  process.env.FAKE_BB_MODE = "fail"
  const prf = await loadPrPreview(sinks)
  if (prf.ok) fail("pr fail should fail")
  if (!seen.some((e) => e.name === "pr-preview-error")) fail("pr error notice missing")
  console.log("previews OK")
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
