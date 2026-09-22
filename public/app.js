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
  // protect each generated <a> immediately — otherwise a later regex (e.g.
  // PATH_RE matching slashes inside an already-built href="...") can inject
  // a second nested anchor into the first one's attribute value
  const links = []
  const protectLink = (html) => {
    links.push(html)
    return `\u0001${links.length - 1}\u0001`
  }
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
    protectLink(`<a href="${href}" target="_blank" rel="noopener">${label}</a>`)
  )
  s = s.replace(/https?:\/\/[^\s<>"'\u0000\u0001]+/g, (m) => {
    const [clean, tail] = trimTail(m)
    return protectLink(`<a href="${clean}" target="_blank" rel="noopener">${clean}</a>`) + tail
  })
  s = s.replace(PATH_RE, (m) => {
    const [clean, tail] = trimTail(m)
    return protectLink(`<a href="#" class="path" data-path="${clean}">${clean}</a>`) + tail
  })
  s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => links[+n])
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
  // event.turn is the raw session.messages index at append time (mixes
  // user/assistant/tool entries, so it jumps 0, 2, 5, 7, 9…), not a
  // sequential turn counter — map each distinct turn, in the chronological
  // order it first appears, to its positional assistant bubble instead of
  // indexing assistantEls by the raw value directly
  let position = 0
  for (const [, evts] of byTurn) {
    const anchor = assistantEls[position++]
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
    // a turn can end right after a tool result with no further text delta
    // (nothing left for onDelta to clean up) — clear any stray loader here too
    removeLoader()
  } else if (event.type === "error") {
    const c = makeCard("error", `error · ${event.message}`)
    c.body.textContent = JSON.stringify(event, null, 2)
    appendCard(c.card)
    currentRequest = null
    removeLoader()
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

// ---- mods panel -----------------------------------------------------------

const modsList = $("mods-list")
let modsScope = "global" // global | repo | session — most specific wins at resolve time

// enabled is undefined | true | false at a given scope: undefined means "not
// set here, inherits from a less specific scope" — the 3-state <select>
// makes that a first-class, distinct choice from explicitly true/false
const ENABLED_OPTIONS = [
  { value: "", label: "inherit" },
  { value: "true", label: "enabled" },
  { value: "false", label: "disabled" },
]

const renderMods = (mods) => {
  modsList.innerHTML = ""
  if (!mods.length) {
    modsList.textContent = "No mods installed yet — drop one in ~/.forge/mods/<name>/index.js"
    return
  }
  for (const mod of mods) {
    const row = document.createElement("div")
    row.className = "mod-row"

    const top = document.createElement("div")
    top.className = "mod-row-top"
    const name = document.createElement("span")
    name.className = "mod-name"
    name.textContent = mod.dirName
    const status = document.createElement("span")
    status.className = `mod-status ${mod.status}`
    status.textContent = mod.status
    top.appendChild(name)
    top.appendChild(status)
    row.appendChild(top)

    if (mod.error) {
      const err = document.createElement("div")
      err.className = "mod-error"
      err.textContent = mod.error
      row.appendChild(err)
    }

    const form = document.createElement("div")
    form.className = "mod-settings-form"

    const addSettingRow = (key, value, type, isNew) => {
      const settingRow = document.createElement("div")
      settingRow.className = "mod-setting-row"
      settingRow.dataset.type = type

      let keyEl
      if (isNew) {
        keyEl = document.createElement("input")
        keyEl.type = "text"
        keyEl.className = "mod-setting-key-input"
        keyEl.placeholder = "key"
      } else {
        keyEl = document.createElement("span")
        keyEl.className = "mod-setting-key"
        keyEl.textContent = key
        settingRow.dataset.key = key
      }
      settingRow.appendChild(keyEl)

      let valueEl
      if (type === "boolean") {
        valueEl = document.createElement("input")
        valueEl.type = "checkbox"
        valueEl.checked = !!value
      } else {
        valueEl = document.createElement("input")
        valueEl.type = type === "number" ? "number" : "text"
        valueEl.value = value ?? ""
      }
      valueEl.className = "mod-setting-value"
      settingRow.appendChild(valueEl)

      const remove = UI.action("×", {
        color: "rose",
        size: "xs",
        title: "Remove this setting",
        onClick: () => settingRow.remove(),
      })
      settingRow.appendChild(remove)

      form.appendChild(settingRow)
    }

    for (const [key, value] of Object.entries(mod.settings ?? {})) {
      addSettingRow(key, value, typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string", false)
    }

    row.appendChild(form)

    const addSettingBtn = UI.action("+ add setting", {
      color: "sky",
      size: "sm",
      onClick: () => addSettingRow("", "", "string", true),
    })
    row.appendChild(addSettingBtn)

    const actions = document.createElement("div")
    actions.className = "mod-row-actions"

    const select = document.createElement("select")
    select.className = "mod-enabled-select"
    for (const opt of ENABLED_OPTIONS) {
      const o = document.createElement("option")
      o.value = opt.value
      o.textContent = opt.label
      select.appendChild(o)
    }
    select.value = mod.enabled === undefined ? "" : String(mod.enabled)
    actions.appendChild(select)

    const saveBtn = UI.action("save", {
      color: "amber",
      onClick: async () => {
        const enabled = select.value === "" ? undefined : select.value === "true"
        await window.forge.setModScopedEnabled(modsScope, mod.dirName, enabled)

        const settingsObj = {}
        for (const settingRow of form.querySelectorAll(".mod-setting-row")) {
          const keyInput = settingRow.querySelector(".mod-setting-key-input")
          const key = keyInput ? keyInput.value.trim() : settingRow.dataset.key
          if (!key) continue
          const valueEl = settingRow.querySelector(".mod-setting-value")
          settingsObj[key] =
            settingRow.dataset.type === "boolean"
              ? valueEl.checked
              : settingRow.dataset.type === "number"
                ? Number(valueEl.value)
                : valueEl.value
        }

        const res = await window.forge.setModScopedSettings(modsScope, mod.dirName, JSON.stringify(settingsObj))
        saveBtn.textContent = res.ok ? "saved" : "save failed"
        setTimeout(() => {
          saveBtn.textContent = "save"
        }, 1500)
      },
    })
    actions.appendChild(saveBtn)

    row.appendChild(actions)
    modsList.appendChild(row)
  }
}

const refreshMods = async () => {
  renderMods(await window.forge.modsForScope(modsScope))
}

for (const tab of document.querySelectorAll(".mods-scope-tab")) {
  tab.addEventListener("click", async () => {
    modsScope = tab.dataset.scope
    for (const t of document.querySelectorAll(".mods-scope-tab")) t.classList.toggle("active", t === tab)
    await refreshMods()
  })
}

$("mods-reload").addEventListener("click", async (e) => {
  const btn = e.currentTarget
  btn.textContent = "reloading…"
  try {
    await window.forge.reloadMods()
    await refreshMods()
    btn.textContent = "reloaded"
  } catch {
    btn.textContent = "reload failed"
  }
  setTimeout(() => {
    btn.textContent = "reload mods"
  }, 1500)
})

// ---- skills panel -----------------------------------------------------------

const skillsAvailable = $("skills-available")
const skillsPicked = $("skills-picked")

const makeSkillItem = (skill) => {
  const row = document.createElement("div")
  row.className = "skill-item"

  const top = document.createElement("div")
  top.className = "mod-row-top"
  const name = document.createElement("span")
  name.className = "mod-name"
  name.textContent = skill.name
  const modBadge = document.createElement("span")
  modBadge.className = "skill-mod-badge"
  modBadge.textContent = skill.modName
  top.appendChild(name)
  top.appendChild(modBadge)
  row.appendChild(top)

  const desc = document.createElement("div")
  desc.className = "skill-description"
  desc.textContent = skill.description
  row.appendChild(desc)

  // clicking either side toggles it and moves it to the other column
  row.addEventListener("click", async () => {
    await window.forge.setSkillLoaded(skill.name, !skill.loaded)
    await refreshSkills()
  })

  return row
}

const renderSkills = (skills) => {
  skillsAvailable.innerHTML = ""
  skillsPicked.innerHTML = ""

  const available = skills.filter((s) => !s.loaded)
  const picked = skills.filter((s) => s.loaded)

  if (!available.length) skillsAvailable.textContent = skills.length ? "none" : "No skills registered yet"
  else for (const s of available) skillsAvailable.appendChild(makeSkillItem(s))

  if (!picked.length) skillsPicked.textContent = "none picked yet"
  else for (const s of picked) skillsPicked.appendChild(makeSkillItem(s))
}

const refreshSkills = async () => {
  renderSkills(await window.forge.listSkills())
}

$("skills-toggle").addEventListener("click", async () => {
  $("skills-panel").classList.remove("hidden")
  $("skills-toggle").classList.add("active")
  await refreshSkills()
})

$("skills-close").addEventListener("click", () => {
  $("skills-panel").classList.add("hidden")
  $("skills-toggle").classList.remove("active")
})

// ---- settings panel ---------------------------------------------------------

let draftConfig = null

const PROVIDER_KINDS = ["ollama", "anthropic"]

const renderProviderCard = (provider, index) => {
  const card = document.createElement("div")
  card.className = "provider-card"

  const top = document.createElement("div")
  top.className = "provider-card-top"
  const label = document.createElement("span")
  label.className = "mod-name"
  label.textContent = provider.name || provider.id || `provider ${index + 1}`
  const remove = UI.action("remove", {
    color: "rose",
    size: "sm",
    onClick: () => {
      draftConfig.providers.splice(index, 1)
      renderSettings()
    },
  })
  top.appendChild(label)
  top.appendChild(remove)
  card.appendChild(top)

  const field = (labelText, value, onInput, type = "text") => {
    const row = document.createElement("div")
    row.className = "settings-field"
    const l = document.createElement("label")
    l.textContent = labelText
    const i = document.createElement("input")
    i.type = type
    i.value = value ?? ""
    i.addEventListener("input", () => onInput(i.value))
    row.appendChild(l)
    row.appendChild(i)
    card.appendChild(row)
  }

  field("id", provider.id, (v) => (provider.id = v))
  field("name", provider.name, (v) => (provider.name = v))

  const kindRow = document.createElement("div")
  kindRow.className = "settings-field"
  const kindLabel = document.createElement("label")
  kindLabel.textContent = "kind"
  const kindSelect = document.createElement("select")
  for (const k of PROVIDER_KINDS) {
    const opt = document.createElement("option")
    opt.value = k
    opt.textContent = k
    if (k === provider.kind) opt.selected = true
    kindSelect.appendChild(opt)
  }
  kindSelect.addEventListener("change", () => (provider.kind = kindSelect.value))
  kindRow.appendChild(kindLabel)
  kindRow.appendChild(kindSelect)
  card.appendChild(kindRow)

  field("base URL", provider.baseURL, (v) => (provider.baseURL = v))
  field("API key", provider.apiKey, (v) => (provider.apiKey = v), "password")
  field("default model", provider.defaultModel, (v) => (provider.defaultModel = v))

  return card
}

const renderSettings = () => {
  const body = $("settings-body")
  body.innerHTML = ""

  const providersLabel = document.createElement("div")
  providersLabel.className = "settings-section-label"
  providersLabel.textContent = "providers — changes need a restart to take effect"
  body.appendChild(providersLabel)

  draftConfig.providers.forEach((provider, index) => {
    body.appendChild(renderProviderCard(provider, index))
  })

  const addBtn = UI.action("+ add provider", {
    color: "sky",
    onClick: () => {
      draftConfig.providers.push({ id: "", name: "", kind: "anthropic", baseURL: "", apiKey: "", defaultModel: "" })
      renderSettings()
    },
  })
  body.appendChild(addBtn)

  const appearanceLabel = document.createElement("div")
  appearanceLabel.className = "settings-section-label"
  appearanceLabel.textContent = "appearance"
  body.appendChild(appearanceLabel)

  const themeRow = document.createElement("div")
  themeRow.className = "settings-field"
  const themeLabelEl = document.createElement("label")
  themeLabelEl.textContent = "theme"
  const themeSelect = document.createElement("select")
  for (const t of ["dark", "light"]) {
    const opt = document.createElement("option")
    opt.value = t
    opt.textContent = t
    if (t === draftConfig.theme) opt.selected = true
    themeSelect.appendChild(opt)
  }
  themeSelect.addEventListener("change", () => (draftConfig.theme = themeSelect.value))
  themeRow.appendChild(themeLabelEl)
  themeRow.appendChild(themeSelect)
  body.appendChild(themeRow)

  const agentLabel = document.createElement("div")
  agentLabel.className = "settings-section-label"
  agentLabel.textContent = "agent"
  body.appendChild(agentLabel)

  const thinkingRow = document.createElement("div")
  thinkingRow.className = "settings-field"
  const thinkingLabelEl = document.createElement("label")
  thinkingLabelEl.textContent = "enable thinking"
  const thinkingCheckbox = document.createElement("input")
  thinkingCheckbox.type = "checkbox"
  thinkingCheckbox.checked = !!draftConfig.thinking
  thinkingCheckbox.addEventListener("change", () => (draftConfig.thinking = thinkingCheckbox.checked))
  thinkingRow.appendChild(thinkingLabelEl)
  thinkingRow.appendChild(thinkingCheckbox)
  body.appendChild(thinkingRow)

  const cwdRow = document.createElement("div")
  cwdRow.className = "settings-field"
  const cwdLabelEl = document.createElement("label")
  cwdLabelEl.textContent = "default working directory"
  const cwdInput = document.createElement("input")
  cwdInput.type = "text"
  cwdInput.value = draftConfig.cwd ?? ""
  cwdInput.addEventListener("input", () => (draftConfig.cwd = cwdInput.value))
  cwdRow.appendChild(cwdLabelEl)
  cwdRow.appendChild(cwdInput)
  body.appendChild(cwdRow)
}

$("settings-toggle").addEventListener("click", async () => {
  draftConfig = await window.forge.getConfig()
  renderSettings()
  await refreshMods()
  $("settings-panel").classList.remove("hidden")
  $("settings-toggle").classList.add("active")
})

$("settings-close").addEventListener("click", () => {
  $("settings-panel").classList.add("hidden")
  $("settings-toggle").classList.remove("active")
})

$("settings-save").addEventListener("click", async () => {
  await window.forge.setConfig(draftConfig)
  $("settings-panel").classList.add("hidden")
  $("settings-toggle").classList.remove("active")
})

$("settings-restart").addEventListener("click", () => {
  window.forge.relaunch()
})

for (const tab of document.querySelectorAll(".settings-tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".settings-tab")) t.classList.toggle("active", t === tab)
    $("settings-tab-general").classList.toggle("hidden", tab.dataset.tab !== "general")
    $("settings-tab-mods").classList.toggle("hidden", tab.dataset.tab !== "mods")
  })
}

// ---- PR inbox preview widget ------------------------------------------------

// builds a fully-contextualized prompt so the agent never has to re-fetch
// what's already known — dropped into the composer, not auto-sent
const buildPrActPrompt = (pr, comment) => {
  const header = `PR: ${pr.project}/${pr.repository} #${pr.id} — "${pr.title}"\nURL: ${pr.url}`

  if (comment) {
    const loc = comment.path ? `\nFile: ${comment.path}${comment.line ? `:${comment.line}` : ""}` : ""
    return (
      `Address this Bitbucket PR review comment.\n\n${header}${loc}\n` +
      `Comment (by ${comment.author}): "${comment.text}"\n\n` +
      `Fetch the PR diff first if you need more context, make the fix, then reply with ` +
      `/pr-comment ${pr.repository} ${pr.id} <summary of what you changed>.`
    )
  }

  const parts = []
  if (pr.comments.length) {
    parts.push(
      "Unresolved comments:\n" +
        pr.comments.map((c, i) => `${i + 1}. (${c.author}) "${c.text}"`).join("\n"),
    )
  }
  if (pr.actionableReasons.length) {
    parts.push("Other open issues:\n" + pr.actionableReasons.map((r) => `- ${r}`).join("\n"))
  }

  return (
    `Address the open issues on this Bitbucket PR.\n\n${header}\n\n${parts.join("\n\n")}\n\n` +
    `Fetch the PR diff first if you need more context, make the fixes, then reply with ` +
    `/pr-comment ${pr.repository} ${pr.id} <summary of what you changed>.`
  )
}

const fillComposerWithPrompt = (text) => {
  const input = $("input")
  input.value = text
  input.focus()
}

// ---- PR detail modal (opened by clicking a sidebar row) -------------------

const openPrModal = (pr) => {
  $("pr-modal-title").textContent = `${pr.project}/${pr.repository} #${pr.id}`
  const body = $("pr-modal-body")
  body.innerHTML = ""

  if (pr.url) {
    const link = document.createElement("span")
    link.className = "pr-modal-link clickable"
    link.textContent = `${pr.title} ↗`
    link.addEventListener("click", () => window.forge.openExternal(pr.url))
    body.appendChild(link)
  } else {
    const title = document.createElement("div")
    title.textContent = pr.title
    body.appendChild(title)
  }

  if (pr.comments.length || pr.actionableReasons.length) {
    const actAll = UI.action("Act on whole PR", {
      color: "sky",
      size: "xs",
      onClick: () => {
        fillComposerWithPrompt(buildPrActPrompt(pr))
        closePrModal()
      },
    })
    body.appendChild(document.createElement("br"))
    body.appendChild(actAll)
  }

  if (pr.actionableReasons.length) {
    const label = document.createElement("div")
    label.className = "pr-modal-section-label"
    label.textContent = "open issues"
    body.appendChild(label)
    const reasons = document.createElement("div")
    reasons.className = "pr-modal-reasons"
    reasons.textContent = pr.actionableReasons.join(" · ")
    body.appendChild(reasons)
  }

  if (pr.comments.length) {
    const label = document.createElement("div")
    label.className = "pr-modal-section-label"
    label.textContent = "unresolved comments"
    body.appendChild(label)
    for (const comment of pr.comments) {
      const cRow = document.createElement("div")
      cRow.className = "pr-modal-comment"
      const text = document.createElement("span")
      text.className = "pr-modal-comment-text"
      text.textContent = `${comment.author}: ${comment.text}`
      cRow.appendChild(text)
      const act = UI.action("Act", {
        color: "sky",
        size: "xs",
        title: "Fill the composer with this exact comment and its context",
        onClick: () => {
          fillComposerWithPrompt(buildPrActPrompt(pr, comment))
          closePrModal()
        },
      })
      cRow.appendChild(act)
      body.appendChild(cRow)
    }
  }

  $("pr-modal").classList.remove("hidden")
}

const closePrModal = () => $("pr-modal").classList.add("hidden")

$("pr-modal-close").addEventListener("click", closePrModal)

const refreshPrPreview = async () => {
  const list = $("pr-preview-list")
  const res = await window.forge.getPrInboxPreview()
  list.innerHTML = ""
  if (!res.ok) {
    list.textContent = "bb not reachable"
    return
  }
  if (!res.prs.length) {
    list.textContent = "nothing needs attention"
    return
  }
  for (const pr of res.prs) {
    const row = document.createElement("div")
    row.className = "pr-preview-item clickable"

    const role = document.createElement("span")
    role.className = "pr-preview-role"
    role.textContent = pr.role
    const repo = document.createElement("span")
    repo.className = "pr-preview-repo"
    repo.textContent = ` ${pr.project}/${pr.repository} #${pr.id} `
    const title = document.createElement("span")
    title.className = "pr-preview-title"
    title.textContent = pr.title

    row.appendChild(role)
    row.appendChild(repo)
    row.appendChild(title)
    row.addEventListener("click", () => openPrModal(pr))

    list.appendChild(row)
  }
}

refreshPrPreview()
setInterval(refreshPrPreview, 30000)

// ---- quest preview widget --------------------------------------------------

const refreshQuestPreview = async () => {
  const list = $("quest-preview-list")
  const res = await window.forge.getQuestPreview()
  list.innerHTML = ""
  if (!res.ok) {
    list.textContent = "quest-tracker not running"
    return
  }
  if (!res.quests.length) {
    list.textContent = "no active quests"
    return
  }
  for (const q of res.quests) {
    const row = document.createElement("div")
    row.className = "quest-preview-item"
    const dot = document.createElement("span")
    dot.className = `quest-dot ${q.status}`
    dot.title = q.status
    const title = document.createElement("span")
    title.className = "quest-preview-title"
    title.textContent = q.title
    row.appendChild(dot)
    row.appendChild(title)
    list.appendChild(row)
  }
}

const closeQuestModal = () => {
  $("quest-modal-header").classList.add("hidden")
  window.forge.closeQuestTracker()
}

$("quest-open-full").addEventListener("click", () => {
  $("quest-modal-header").classList.remove("hidden")
  window.forge.openQuestTracker()
})

$("quest-modal-close").addEventListener("click", closeQuestModal)

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("quest-modal-header").classList.contains("hidden")) {
    closeQuestModal()
  }
})

refreshQuestPreview()
setInterval(refreshQuestPreview, 30000)

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
  const firstWithModels = providers.find((p) => p.models.length)
  if (firstWithModels) {
    modelSelect.value = firstWithModels.defaultModel || firstWithModels.models[0]
  }
  // sync the main process with whatever ended up selected (explicit default or the
  // <select>'s own fallback to its first <option>) so currentProvider never drifts
  // from what the dropdown shows
  if (modelSelect.value) window.forge.setModel(modelSelect.value)
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