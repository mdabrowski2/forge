// integration preview loading with trace notices — thin wrappers over the
// fetch fns. Neither fetch fn throws across its boundary (both return
// {ok} unions), so notices switch on result.ok, not try/catch.
// Returns are untouched (renderer contract preserved). Notice data carries
// counts/ids/errors only — never comment texts or PR titles (user content).
// bb stderr verbatim in preview-error is a decided tradeoff: local-only log,
// needed verbatim for debugging auth failures.
import { fetchQuestPreview, type QuestPreviewResult } from "../src/integrations/quest-tracker"
import { fetchPrInboxPreview, type PrPreviewResult } from "../src/integrations/bitbucket"
import { publishNotice, type NoticeSinks } from "../src/transparency/notice"

export async function loadQuestPreview(sinks: NoticeSinks = {}, baseUrl?: string): Promise<QuestPreviewResult> {
  const r = await fetchQuestPreview(baseUrl)
  if (r.ok) publishNotice("integrations", "quest-preview-ok", { count: r.quests.length }, sinks)
  else publishNotice("integrations", "quest-preview-error", { error: r.error }, sinks)
  return r
}

export async function loadPrPreview(sinks: NoticeSinks = {}): Promise<PrPreviewResult> {
  const r = await fetchPrInboxPreview()
  if (r.ok)
    publishNotice(
      "integrations",
      "pr-preview-ok",
      { count: r.prs.length, commentsOk: r.prs.map((p) => p.commentsOk) },
      sinks
    )
  else publishNotice("integrations", "pr-preview-error", { error: r.error }, sinks)
  return r
}
