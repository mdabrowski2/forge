import type { ChatMessage } from "../sessions/store"
import { goldenHour } from "./theme"

const MessageBubble = (props: { msg: ChatMessage }) => {
  const t = goldenHour
  const isUser = props.msg.role === "user"
  return (
    <box flexDirection="column" {...(isUser ? { alignItems: "flex-end" } : {})}>
      <text fg={isUser ? t.gold : t.amber}>
        <b>{isUser ? "you" : "forge"}</b>
      </text>
      <box
        border
        borderColor={isUser ? t.borderActive : t.border}
        backgroundColor={isUser ? t.element : t.panel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <text fg={t.text}>{props.msg.content}</text>
      </box>
    </box>
  )
}

export const ChatView = (props: {
  messages: () => ChatMessage[]
  streaming: () => string
  busy: () => boolean
}) => {
  const t = goldenHour
  return (
    <scrollbox flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="column" gap={1}>
        {props.messages().map((m) => (
          <MessageBubble msg={m} />
        ))}
        {props.busy() && props.streaming() ? (
          <box flexDirection="column">
            <text fg={t.amber}>
              <b>forge</b>
            </text>
            <text fg={t.text}>{props.streaming()}</text>
          </box>
        ) : null}
        {props.busy() && !props.streaming() ? <text fg={t.muted}>thinking…</text> : null}
      </box>
    </scrollbox>
  )
}