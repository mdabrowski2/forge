// mutation tracing — one shape for every behavior-changing handler:
// {before, after} through the redacting constructor, fanned out via
// publishNotice. Handlers read `before` with the real loader fns, mutate,
// then call traceMutation. Redaction is key-based: secrets under innocent
// keys (e.g. embedded in URLs) are out of scope — see notice.ts limitation.
import { publishNotice, type NoticeEvent, type NoticeSinks } from "../src/transparency/notice"

export function traceMutation(
  source: string,
  name: string,
  before: unknown,
  after: unknown,
  sinks: NoticeSinks = {}
): NoticeEvent {
  return publishNotice(source, name, { before, after }, sinks)
}
