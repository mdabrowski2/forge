// native sidebar preview widget — independent of the quest-tracker mod
// (src/mods, or rather ~/.forge/mods/quest-tracker), which is a separate
// consumer of the same local API from a different runtime context.

export interface QuestPreviewItem {
  id: string
  title: string
  status: string
  daysSinceTouched: number
}

export type QuestPreviewResult = { ok: true; quests: QuestPreviewItem[] } | { ok: false; error: string }

const PREVIEW_LIMIT = 5
const INACTIVE_STATUSES = new Set(["done", "abandoned"])

export async function fetchQuestPreview(
  baseUrl = "http://localhost:3060",
  timeoutMs = 5000
): Promise<QuestPreviewResult> {
  try {
    const res = await fetch(`${baseUrl}/api/quests`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ok: false, error: `quest-tracker returned ${res.status}` }
    const quests = (await res.json()) as QuestPreviewItem[]
    const active = quests
      .filter((q) => !INACTIVE_STATUSES.has(q.status))
      .sort((a, b) => a.daysSinceTouched - b.daysSinceTouched)
      .slice(0, PREVIEW_LIMIT)
      .map((q) => ({ id: q.id, title: q.title, status: q.status, daysSinceTouched: q.daysSinceTouched }))
    return { ok: true, quests: active }
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError")
      return { ok: false, error: `quest-tracker timed out after ${timeoutMs}ms` }
    return { ok: false, error: e instanceof Error ? e.message : "quest-tracker not reachable" }
  }
}
