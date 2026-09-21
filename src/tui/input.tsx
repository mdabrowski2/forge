import { goldenHour } from "./theme"

export const PromptInput = (props: {
  value: () => string
  setValue: (v: string) => void
  onSubmit: (v: string) => void
}) => {
  const t = goldenHour
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" gap={1}>
        <text fg={t.gold}>❯</text>
        <input
          value={props.value()}
          placeholder="Ask forge…"
          focused
          onInput={(v) => props.setValue(v)}
          onSubmit={(v) => {
            if (typeof v === "string") props.onSubmit(v)
          }}
        />
      </box>
      <text fg={t.muted}>ctrl+c quit · enter send</text>
    </box>
  )
}