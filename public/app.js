// forge renderer — talks to the main process through the preload bridge (window.forge)
const $ = (id) => document.getElementById(id)

const chat = $("chat")
const input = $("input")
const sendBtn = $("send")
const modelSelect = $("model-select")
const sessionList = $("session-list")

let busy = false
let streamingBubble = null // current phase loader ("thinking…" / "using X…") or thought label
let replyBubble = null // the actual reply message, appended when its text arrives
let phaseStart = null // when the current phase started (for "Thought for Xs")
let currentSessionId = null

// transparency state — current request's stream card accumulator
let currentRequest = null // { card, streamCard, chunkCount, chars }

// ---- rendering helpers ---------------------------------------------------

const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return "just now"
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const addMessage = (role, content, opts = {}) => {
  const el = document.createElement("div")
  el.className = `msg ${role}`
  const who = document.createElement("div")
  who.className = "who"
  who.textContent = role === "user" ? "you" : "forge"
  const bubble = document.createElement("div")
  bubble.className = `bubble${opts.error ? " error" : ""}`
  if (opts.error) bubble.textContent = content
  else bubble.innerHTML = renderMarkdown(content)
  el.appendChild(who)
  el.appendChild(bubble)
  chat.appendChild(el)
  chat.scrollTop = chat.scrollHeight
  return bubble
}

const formatThought = (ms) => {
  const s = ms / 1000
  if (s < 60) return `Thought for ${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `Thought for ${m}m ${rs}s`
}

// ---- markdown -------------------------------------------------------------

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// file paths: C:\…, C:/…, .\…, ./…, ..\…, ~\…, ~/…, /a/b (unix, ≥2 segments)
const PATH_RE =
  /(?:[A-Za-z]:[\\/][^\s<>"'\u0000]+|\.[\\/][^\s<>"'\u0000]+|~[\\/][^\s<>"'\u0000]+|\/[^\s<>"'\u0000]*\/[^\s<>"'\u0000]*)/g

const trimTail = (m) => {
  const clean = m.replace(/[.,;:!?)\]}]+$/, "")
  return [clean, m.slice(clean.length)]
}

const renderInline = (text) => {
  let s = escapeHtml(text)
  // protect inline code from the other transforms
  const codes = []
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>")
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  s = s.replace(/https?:\/\/[^\s<>"'\u0000]+/g, (m) => {
    const [clean, tail] = trimTail(m)
    return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>${tail}`
  })
  s = s.replace(PATH_RE, (m) => {
    const [clean, tail] = trimTail(m)
    return `<a href="#" class="path" data-path="${clean}">${clean}</a>${tail}`
  })
  s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${escapeHtml(codes[+n])}</code>`)
  return s
}

const renderMarkdown = (src) => {
  const lines = src.split("\n")
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^```(\w*)/)
    if (fence) {
      const buf = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i])
        i++
      }
      i++ // skip closing fence
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`)
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)/)
    if (h) {
      out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`)
      i++
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(line)) {
      out.push("<hr>")
      i++
      continue
    }
    if (line.startsWith(">")) {
      const buf = []
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""))
        i++
      }
      out.push(`<blockquote>${renderInline(buf.join("\n"))}</blockquote>`)
      continue
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items = []
      while (
        i < lines.length &&
        (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))
      ) {
        items.push(renderInline(lines[i].replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+[.)]\s+/, "")))
        i++
      }
      out.push(
        ordered
          ? `<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`
          : `<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`
      )
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim()) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${renderInline(buf.join("\n"))}</p>`)
  }
  return out.join("")
}

const renderMessages = (messages) => {
  chat.innerHTML = ""
  for (const m of messages) {
    if (m.role === "tool") continue // tool I/O is shown as cards, not chat bubbles
    addMessage(m.role, m.content)
  }
}

// rebuild transparency cards from persisted events, inserted after the
// assistant message of the turn they belong to (matches live order)
const replayEvents = (events) => {
  if (!events || !events.length) return
  const byTurn = new Map()
  for (const e of events) {
    const t = e.turn ?? 0
    if (!byTurn.has(t)) byTurn.set(t, [])
    byTurn.get(t).push(e)
  }
  const assistantEls = chat.querySelectorAll(".msg.assistant")
  for (const [turn, evts] of byTurn) {
    const anchor = assistantEls[turn]
    if (!anchor) continue
    let req = null
    for (const e of evts) {
      if (e.type === "request") {
        const c = makeCard("request", `request · ${e.provider} · ${e.model}`)
        c.body.textContent = JSON.stringify(
          { settings: e.settings, system: e.system, messages: e.messages },
          null,
          2
        )
        anchor.before(c.card)
        req = { card: c.card, streamCard: null, reasonCard: null, chunkCount: 0, chars: 0, reasonChars: 0 }
      } else if (e.type === "reasoning") {
        if (!req) continue
        if (!req.reasonCard) {
          const c = makeCard("reasoning", "reasoning")
          req.card.after(c.card)
          req.reasonCard = c
          c.body.classList.remove("hidden")
          c.arrow.textContent = "▾"
        }
        req.reasonChars += e.delta.length
        req.reasonCard.summary.textContent = `reasoning · ${req.reasonChars} chars`
        req.reasonCard.body.textContent += e.delta
      } else if (e.type === "chunk") {
        if (!req) continue
        if (!req.streamCard) {
          const c = makeCard("stream", "stream")
          req.card.after(c.card)
          req.streamCard = c
        }
        req.chunkCount++
        req.chars += e.text.length
        req.streamCard.summary.textContent =
          `stream · ${req.chunkCount} chunks · ${req.chars} chars`
        req.streamCard.body.textContent += e.text
      } else if (e.type === "tool-call") {
        const c = makeCard("tool-call", `🔧 ${e.tool}`)
        c.body.textContent = JSON.stringify(e.args, null, 2)
        anchor.before(c.card)
      } else if (e.type === "tool-result") {
        const c = makeCard(
          "tool-result",
          e.ok ? `✅ ${e.tool} · ${e.durationMs}ms` : `❌ ${e.tool} · failed`
        )
        if (!e.ok) c.card.classList.add("error")
        c.body.textContent = e.result
        anchor.before(c.card)
      } else if (e.type === "custom") {
        const c = makeCard("custom", `${e.mod} · ${e.name}`)
        c.body.textContent = JSON.stringify(e.data, null, 2)
        anchor.before(c.card)
      } else if (e.type === "finish") {
        const c = makeCard(
          "finish",
          `finish · ${e.finishReason} · ${e.latencyMs}ms · ${e.usage.inputTokens}/${e.usage.outputTokens} tokens`
        )
        c.body.textContent = JSON.stringify(e, null, 2)
        anchor.before(c.card)
        req = null
      } else if (e.type === "error") {
        const c = makeCard("error", `error · ${e.message}`)
        c.body.textContent = JSON.stringify(e, null, 2)
        anchor.before(c.card)
        req = null
      }
    }
  }
}

const renderSessions = (sessions) => {
  sessionList.innerHTML = ""
  for (const s of sessions) {
    const el = document.createElement("div")
    el.className = `session-item${s.id === currentSessionId ? " active" : ""}`
    const title = document.createElement("div")
    title.className = "s-title"
    title.textContent = s.title || "Session"
    const meta = document.createElement("div")
    meta.className = "s-meta"
    meta.textContent = `${s.count} msgs · ${timeAgo(s.updatedAt)}`
    el.appendChild(title)
    el.appendChild(meta)
    el.addEventListener("click", () => loadSession(s.id))
    sessionList.appendChild(el)
  }
}

const renderModels = (providers) => {
  modelSelect.innerHTML = ""
  for (const p of providers) {
    const group = document.createElement("optgroup")
    group.label = p.name
    for (const m of p.models) {
      const opt = document.createElement("option")
      opt.value = m
      opt.textContent = m
      group.appendChild(opt)
    }
    modelSelect.appendChild(group)
  }
}

// ---- transparency cards --------------------------------------------------

const makeCard = (type, summaryText) => {
  const card = document.createElement("div")
  card.className = `t-card ${type}`
  const header = document.createElement("div")
  header.className = "t-header"
  const arrow = document.createElement("span")
  arrow.className = "t-arrow"
  arrow.textContent = "▸"
  const summary = document.createElement("span")
  summary.className = "t-summary"
  summary.textContent = summaryText
  const body = document.createElement("pre")
  body.className = "t-body hidden"
  header.appendChild(arrow)
  header.appendChild(summary)
  card.appendChild(header)
  card.appendChild(body)
  header.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden")
    arrow.textContent = hidden ? "▸" : "▾"
  })
  return { card, body, summary, arrow }
}

// append a card to the feed — everything appears in arrival order
const appendCard = (card) => {
  chat.appendChild(card)
  chat.scrollTop = chat.scrollHeight
}

// ---- phase loaders --------------------------------------------------------
// each phase gets its own element: a thinking phase becomes a permanent
// "Thought for Xs" label when done; tool phases are transient loaders

const startThinking = () => {
  streamingBubble = addMessage("assistant", "")
  streamingBubble.classList.add("thinking")
  streamingBubble.innerHTML = '<span class="spinner"></span>thinking…'
  phaseStart = Date.now()
}

const startTool = (tool) => {
  streamingBubble = addMessage("assistant", "")
  streamingBubble.classList.add("thinking")
  streamingBubble.innerHTML = `<span class="spinner"></span>using ${tool}…`
  phaseStart = Date.now()
}

// thinking phase done → the loader becomes a permanent "Thought for Xs" label
const finishThinkingPhase = () => {
  if (!streamingBubble || !phaseStart) return
  streamingBubble.classList.remove("thinking")
  streamingBubble.classList.add("thought-done")
  streamingBubble.innerHTML = formatThought(Date.now() - phaseStart)
  streamingBubble = null
  phaseStart = null
}

// tool phase done → the loader is removed entirely
const removeLoader = () => {
  if (streamingBubble) {
    streamingBubble.closest(".msg").remove()
    streamingBubble = null
  }
  phaseStart = null
}

const onTransparency = (event) => {
  if (event.type === "request") {
    const c = makeCard("request", `request · ${event.provider} · ${event.model}`)
    c.body.textContent = JSON.stringify(
      { settings: event.settings, system: event.system, messages: event.messages },
      null,
      2
    )
    appendCard(c.card)
    currentRequest = { card: c.card, streamCard: null, reasonCard: null, chunkCount: 0, chars: 0, reasonChars: 0 }
    // transient loader — appears when the model call starts
    if (!streamingBubble && !replyBubble) {
      startThinking()
    }
  } else if (event.type === "reasoning") {
    if (!currentRequest) return
    if (!currentRequest.reasonCard) {
      const c = makeCard("reasoning", "reasoning")
      currentRequest.card.after(c.card)
      currentRequest.reasonCard = c
      // the trace is the whole point — show it expanded by default
      c.body.classList.remove("hidden")
      c.arrow.textContent = "▾"
    }
    currentRequest.reasonChars += event.delta.length
    currentRequest.reasonCard.summary.textContent = `reasoning · ${currentRequest.reasonChars} chars`
    currentRequest.reasonCard.body.textContent += event.delta
    chat.scrollTop = chat.scrollHeight
  } else if (event.type === "chunk") {
    if (!currentRequest) return
    if (!currentRequest.streamCard) {
      const c = makeCard("stream", "stream")
      currentRequest.card.after(c.card)
      currentRequest.streamCard = c
    }
    currentRequest.chunkCount++
    currentRequest.chars += event.text.length
    currentRequest.streamCard.summary.textContent =
      `stream · ${currentRequest.chunkCount} chunks · ${currentRequest.chars} chars`
    currentRequest.streamCard.body.textContent += event.text
    chat.scrollTop = chat.scrollHeight
  } else if (event.type === "tool-call") {
    const c = makeCard("tool-call", `🔧 ${event.tool}`)
    c.body.textContent = JSON.stringify(event.args, null, 2)
    appendCard(c.card)
    finishThinkingPhase() // thinking done → "Thought for Xs"
    startTool(event.tool)
  } else if (event.type === "tool-result") {
    const c = makeCard(
      "tool-result",
      event.ok ? `✅ ${event.tool} · ${event.durationMs}ms` : `❌ ${event.tool} · failed`
    )
    if (!event.ok) c.card.classList.add("error")
    c.body.textContent = event.result
    appendCard(c.card)
    removeLoader() // tool phase done
    startThinking() // model is processing the result
  } else if (event.type === "custom") {
    const c = makeCard("custom", `${event.mod} · ${event.name}`)
    c.body.textContent = JSON.stringify(event.data, null, 2)
    appendCard(c.card)
  } else if (event.type === "finish") {
    const c = makeCard(
      "finish",
      `finish · ${event.finishReason} · ${event.latencyMs}ms · ${event.usage.inputTokens}/${event.usage.outputTokens} tokens`
    )
    c.body.textContent = JSON.stringify(event, null, 2)
    appendCard(c.card)
    currentRequest = null
  } else if (event.type === "error") {
    const c = makeCard("error", `error · ${event.message}`)
    c.body.textContent = JSON.stringify(event, null, 2)
    appendCard(c.card)
    currentRequest = null
  }
}

// ---- actions -------------------------------------------------------------

const send = async () => {
  const text = input.value.trim()
  if (!text || busy) return
  input.value = ""
  input.style.height = "auto"
  addMessage("user", text)
  // /name args → mod command, not the model
  if (text.startsWith("/")) {
    const res = await window.forge.command(text)
    if (res.ok) addMessage("assistant", res.text)
    else addMessage("assistant", `⚠ ${res.error}`, { error: true })
    return
  }
  busy = true
  sendBtn.disabled = true
  await window.forge.chat(text)
}

const loadSession = async (id) => {
  const s = await window.forge.loadSession(id)
  if (!s) return
  currentSessionId = s.id
  currentRequest = null
  renderMessages(s.messages)
  replayEvents(s.events)
  renderSessions(await window.forge.listSessions())
}

const newSession = async () => {
  const s = await window.forge.newSession()
  currentSessionId = s.id
  currentRequest = null
  renderMessages([])
  renderSessions(await window.forge.listSessions())
}

// ---- wiring --------------------------------------------------------------

sendBtn.addEventListener("click", send)

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    send()
  }
})

input.addEventListener("input", () => {
  input.style.height = "auto"
  input.style.height = Math.min(input.scrollHeight, 160) + "px"
})

modelSelect.addEventListener("change", () => {
  window.forge.setModel(modelSelect.value)
})

$("new-session").addEventListener("click", newSession)

$("events-toggle").addEventListener("click", () => {
  document.body.classList.toggle("hide-events")
  $("events-toggle").classList.toggle("active", !document.body.classList.contains("hide-events"))
})

// clickable file paths + links inside messages
chat.addEventListener("click", (e) => {
  const a = e.target.closest("a")
  if (!a) return
  e.preventDefault()
  if (a.classList.contains("path")) {
    window.forge.openPath(a.dataset.path)
  } else if (a.href) {
    window.forge.openExternal(a.href)
  }
})

window.forge.onDelta((text) => {
  if (!replyBubble) {
    // the reply text is arriving — the final thinking phase is done,
    // then the real reply message is appended at the end of the feed
    finishThinkingPhase()
    replyBubble = addMessage("assistant", "")
  }
  replyBubble.innerHTML = renderMarkdown(text)
  chat.scrollTop = chat.scrollHeight
})

window.forge.onDone((text) => {
  if (replyBubble) {
    replyBubble.innerHTML = renderMarkdown(text || "(empty response)")
  } else {
    finishThinkingPhase()
    addMessage("assistant", text || "(empty response)")
  }
  replyBubble = null
  streamingBubble = null
  phaseStart = null
  busy = false
  sendBtn.disabled = false
  input.focus()
  refreshSessions()
})

window.forge.onError((msg) => {
  if (replyBubble) {
    replyBubble.classList.add("error")
    replyBubble.textContent = `⚠ ${msg}`
  } else {
    removeLoader()
    addMessage("assistant", `⚠ ${msg}`, { error: true })
  }
  replyBubble = null
  streamingBubble = null
  phaseStart = null
  busy = false
  sendBtn.disabled = false
  input.focus()
})

const refreshSessions = async () => {
  renderSessions(await window.forge.listSessions())
}

// ---- boot ----------------------------------------------------------------

const boot = async () => {
  const providers = await window.forge.getModels()
  renderModels(providers)
  if (providers.length && providers[0].models.length) {
    modelSelect.value = providers[0].defaultModel || providers[0].models[0]
  }
  const session = await window.forge.getSession()
  currentSessionId = session.id
  currentRequest = null
  renderMessages(session.messages)
  replayEvents(session.events)
  renderSessions(await window.forge.listSessions())

  // live transparency events only (history lives in ~/.forge/logs/forge.log)
  window.forge.onTransparency(onTransparency)

  input.focus()
}

boot()