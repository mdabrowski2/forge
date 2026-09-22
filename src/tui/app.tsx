import { createSignal } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ForgeConfig } from "../config"
import type { Provider } from "../providers/types"
import type { ChatMessage, Session } from "../sessions/store"
import { appendMessage } from "../sessions/store"
import { runChatTurn } from "../agent/loop"
import { ChatView } from "./chat"
import { PromptInput } from "./input"
import { goldenHour } from "./theme"
import { FORGE_VERSION } from "../version"

export const App = (props: {
  providers: Provider[]
  session: Session
  cwd: string
  config: ForgeConfig
}) => {
  const t = goldenHour
  const dim = useTerminalDimensions()

  const [messages, setMessages] = createSignal<ChatMessage[]>(props.session.messages)
  const [busy, setBusy] = createSignal(false)
  const [streaming, setStreaming] = createSignal("")
  const [input, setInput] = createSignal("")
  const [providerId, setProviderId] = createSignal(props.providers[0]?.id ?? "")
  const [model, setModel] = createSignal(props.providers[0]?.defaultModel ?? "")

  const provider = () => props.providers.find((p) => p.id === providerId()) ?? props.providers[0]

  const cycleProvider = () => {
    if (props.providers.length < 2) return
    const i = props.providers.findIndex((p) => p.id === providerId())
    const next = props.providers[(i + 1) % props.providers.length]!
    setProviderId(next.id)
    setModel(next.defaultModel)
  }

  const cycleModel = () => {
    const p = provider()
    if (!p || p.models.length < 2) return
    const i = p.models.indexOf(model())
    setModel(p.models[(i + 1) % p.models.length]!)
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      process.exit(0)
    } else if (key.ctrl && key.name === "p") {
      cycleProvider()
    } else if (key.ctrl && key.name === "m") {
      cycleModel()
    }
  })

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy()) return
    const userMsg: ChatMessage = { role: "user", content: trimmed, timestamp: Date.now() }
    const next = [...messages(), userMsg]
    setMessages(next)
    appendMessage(props.session, userMsg)
    setInput("")
    setBusy(true)
    setStreaming("")
    try {
      const result = await runChatTurn({
        provider: provider(),
        model: model(),
        messages: props.session.messages,
        cwd: props.cwd,
        config: props.config,
        sessionId: props.session.id,
        onDelta: (d) => setStreaming(d),
      })
      for (const m of result.messages) appendMessage(props.session, m)
      setMessages(() => [...props.session.messages])
    } catch (e) {
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `⚠ ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }
      setMessages((m) => [...m, errMsg])
      appendMessage(props.session, errMsg)
    } finally {
      setBusy(false)
      setStreaming("")
    }
  }

  return (
    <box width={dim().width} height={dim().height} backgroundColor={t.bg} flexDirection="column">
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <text fg={t.gold}>
          <b>forge {FORGE_VERSION}</b>
        </text>
        <text fg={t.muted}>
          {provider()?.name ?? "no provider"} · {model() || "no model"}
          {provider() && provider()!.status !== "ok" ? ` (${provider()!.status})` : ""}
        </text>
      </box>

      <ChatView messages={messages} streaming={streaming} busy={busy} />

      <PromptInput value={input} setValue={setInput} onSubmit={send} />
    </box>
  )
}