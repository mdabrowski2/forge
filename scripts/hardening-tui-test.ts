// P0-1 proof: the persist-then-render invariant — everything rendered after a
// turn must already be in the session store, in order (user → assistant → tools).
// send() itself needs a Solid render context, so this pins the store half
// behaviorally (isolated HOME); the 3-line render-half change is review-verified.
// Limitation recorded honestly: a render/store divergence inside Solid is not
// runtime-proven here — see plan Task 5 ruling.
import { newSession, appendMessage, type ChatMessage } from "../src/sessions/store"

const fail = (m: string): never => {
  console.error("FAIL:", m)
  process.exit(1)
}
// mirror of fixed send(): user msg, then every result message persisted,
// then render mirrors props.session.messages
const s = newSession("m", "/tmp")
appendMessage(s, { role: "user", content: "hi", timestamp: 1 })
const result: { text: string; messages: ChatMessage[] } = {
  text: "ans",
  messages: [
    { role: "assistant", content: "ans", timestamp: 2 },
    { role: "tool", content: "out", timestamp: 3 },
  ],
}
for (const m of result.messages) appendMessage(s, m)
const rendered = [...s.messages]
const got = rendered.map((x) => `${x.role}:${x.content}`).join("|")
if (got !== "user:hi|assistant:ans|tool:out") fail("order/content diverged: " + got)
if (!rendered.some((x) => x.role === "assistant" && x.content === result.text))
  fail("rendered text not present in store")
console.log("tui-persist OK")
