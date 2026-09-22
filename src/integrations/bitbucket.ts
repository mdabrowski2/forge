// native sidebar preview widget — mirrors src/integrations/quest-tracker.ts.
// Independent of the bitbucket mod (~/.forge/mods/bitbucket), which is a
// separate consumer of the same `bb` CLI from a different runtime context.

import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

export interface PrPreviewComment {
  id: number
  author: string
  text: string
  path?: string
  line?: number
}

export interface PrPreviewItem {
  id: number
  title: string
  project: string
  repository: string
  daysOpen: number
  url: string
  role: "reviewer" | "author"
  actionableReasons: string[]
  comments: PrPreviewComment[]
  /** false when the comment fetch failed (comments silently [] otherwise) */
  commentsOk: boolean
}

export type PrPreviewResult = { ok: true; prs: PrPreviewItem[] } | { ok: false; error: string }

const PREVIEW_LIMIT = 5

async function runBb(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync("bb", args, { maxBuffer: 10 * 1024 * 1024 })
  return JSON.parse(stdout)
}

async function fetchUnresolvedComments(
  project: string,
  repository: string,
  pullRequestId: number
): Promise<{ comments: PrPreviewComment[]; ok: boolean }> {
  try {
    const res = await runBb([
      "list_pr_comments",
      "--project",
      project,
      "--repository",
      repository,
      "--pull_request_id",
      String(pullRequestId),
      "--include_resolved",
      "false",
      "--limit",
      "5",
    ])
    return {
      ok: true,
      comments: (res.comments ?? [])
        .filter((c: any) => c.state !== "RESOLVED")
        .map((c: any) => ({
          id: c.id,
          author: c.author ?? "",
          text: c.text ?? "",
          path: c.anchor?.path,
          line: c.anchor?.line,
        })),
    }
  } catch {
    return { comments: [], ok: false }
  }
}

export async function fetchPrInboxPreview(): Promise<PrPreviewResult> {
  try {
    const [inboxRes, triageRes] = await Promise.all([
      runBb(["get_inbox_pull_requests", "--role", "reviewer", "--limit", String(PREVIEW_LIMIT)]),
      runBb(["triage_my_pull_requests"]),
    ])

    const reviewerPrs = (inboxRes.pullRequests ?? []).map((pr: any) => ({
      id: pr.id,
      title: pr.title,
      project: pr.project,
      repository: pr.repository,
      daysOpen: pr.daysOpen,
      url: pr.url ?? "",
      role: "reviewer" as const,
      actionableReasons: [] as string[],
    }))

    const authoredPrs = (triageRes.pullRequests ?? [])
      .filter((pr: any) => pr.category === "NEEDS_ATTENTION")
      .sort((a: any, b: any) => (b.actionableReasons?.length ?? 0) - (a.actionableReasons?.length ?? 0))
      .slice(0, PREVIEW_LIMIT)
      .map((pr: any) => ({
        id: pr.id,
        title: pr.title,
        project: pr.project,
        repository: pr.repository,
        daysOpen: pr.daysSinceUpdate,
        url: pr.url ?? "",
        role: "author" as const,
        actionableReasons: pr.actionableReasons ?? [],
      }))

    const combined = [...reviewerPrs, ...authoredPrs]
    const withComments = await Promise.all(
      combined.map(async (pr) => {
        const fetched = await fetchUnresolvedComments(pr.project, pr.repository, pr.id)
        return { ...pr, comments: fetched.comments, commentsOk: fetched.ok }
      })
    )

    return { ok: true, prs: withComments }
  } catch (e) {
    const stderr = e && (e as { stderr?: string }).stderr ? String((e as { stderr?: string }).stderr).trim() : ""
    return { ok: false, error: stderr || (e instanceof Error ? e.message : "bb not reachable") }
  }
}
