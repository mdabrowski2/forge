import { app, BrowserWindow, ipcMain, shell } from "electron"
import { fileURLToPath } from "url"
import path from "path"
import { loadConfig } from "../src/config"
import { loadMods } from "../src/mods/loader"
import { createOllamaProvider } from "../src/providers/ollama"
import { createAnthropicProvider } from "../src/providers/anthropic"
import type { Provider } from "../src/providers/types"
import { appendEvent, appendMessage, listSessions, loadEvents, loadSession, newSession } from "../src/sessions/store"
import type { Session } from "../src/sessions/store"
import { runChatTurn } from "../src/agent/loop"
import type { TransparencyEvent } from "../src/agent/loop"
import { getSystemPrompt } from "../src/agent/prompt"
import { registry } from "../src/mods/registry"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win: BrowserWindow | null = null
let providers: Provider[] = []
let currentProvider: Provider | null = null
let currentModel = ""
let session: Session = newSession("")
let abortController: AbortController | null = null
let toolCwd = ""
const transcript: TransparencyEvent[] = []

const createWindow = () => {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#221B14",
    title: "forge",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile(path.join(__dirname, "..", "public", "index.html"))

  // smoke test: --smoke quits right after the window finishes loading
  if (process.argv.includes("--smoke")) {
    win.webContents.once("did-finish-load", () => {
      console.log("SMOKE: window loaded OK")
      app.quit()
    })
  }
}

const boot = async () => {
  const config = loadConfig()

  const mods = await loadMods(config)
  for (const f of mods.failed) console.error(`[mods] ${f.name}: ${f.error}`)
  if (mods.loaded.length) console.log(`[mods] loaded: ${mods.loaded.join(", ")}`)

  toolCwd = config.cwd
  providers = []
  for (const pc of config.providers) {
    if (pc.kind === "ollama") {
      providers.push(
        await createOllamaProvider({
          baseURL: pc.baseURL ?? "http://127.0.0.1:11434/v1",
          defaultModel: pc.defaultModel,
        })
      )
    } else if (pc.kind === "anthropic") {
      providers.push(createAnthropicProvider({ apiKey: pc.apiKey, defaultModel: pc.defaultModel }))
    }
  }
  currentProvider = providers[0] ?? null
  currentModel = currentProvider?.defaultModel ?? ""

  const sessions = listSessions()
  session = sessions[0]
    ? (loadSession(sessions[0].id) ?? newSession(currentModel))
    : newSession(currentModel)

  createWindow()
}

app.whenReady().then(boot)

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// ---- IPC ----------------------------------------------------------------

ipcMain.handle("forge:models", () =>
  providers.map((p) => ({
    id: p.id,
    name: p.name,
    models: p.models,
    defaultModel: p.defaultModel,
  }))
)

ipcMain.handle("forge:setModel", (_e, modelId: string) => {
  currentModel = modelId
  return true
})

ipcMain.handle("forge:getSession", () => ({
  id: session.id,
  title: session.title,
  model: currentModel,
  messages: session.messages,
  events: loadEvents(session.id),
}))

ipcMain.handle("forge:sessions", () =>
  listSessions().map((s) => ({
    id: s.id,
    title: s.title,
    updatedAt: s.updatedAt,
    count: s.messages.length,
  }))
)

ipcMain.handle("forge:loadSession", (_e, id: string) => {
  const s = loadSession(id)
  if (s) session = s
  return s ? { ...s, events: loadEvents(id) } : s
})

ipcMain.handle("forge:newSession", () => {
  session = newSession(currentModel)
  return { ...session, events: [] }
})

ipcMain.handle("forge:chat", async (_e, text: string) => {
  if (!currentProvider || !currentModel) {
    win?.webContents.send("forge:error", "No model selected")
    return
  }
  const trimmed = text.trim()
  if (!trimmed) return

  const userMsg = { role: "user" as const, content: trimmed, timestamp: Date.now() }
  appendMessage(session, userMsg)
  const turn = session.messages.length - 1

  abortController = new AbortController()
  try {
    const full = await runChatTurn({
      provider: currentProvider,
      model: currentModel,
      messages: session.messages,
      cwd: toolCwd,
      thinking: config.thinking,
      config,
      sessionId: session.id,
      onDelta: (d) => win?.webContents.send("forge:delta", d),
      onTransparency: (e) => {
        appendEvent(session, { ...e, turn })
        transcript.push(e)
        if (transcript.length > 2000) transcript.shift()
        win?.webContents.send("forge:transparency", e)
      },
      signal: abortController.signal,
    })
    for (const m of full.messages) appendMessage(session, m)
    win?.webContents.send("forge:done", full.text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendMessage(session, { role: "assistant", content: `⚠ ${msg}`, timestamp: Date.now() })
    win?.webContents.send("forge:error", msg)
  }
})

ipcMain.handle("forge:stop", () => {
  abortController?.abort()
  return true
})

ipcMain.handle("forge:getSystemPrompt", () => getSystemPrompt())

// mod commands — /name args in the chat input routes here instead of the model
ipcMain.handle("forge:command", async (_e, text: string) => {
  const m = typeof text === "string" ? text.trim().match(/^\/(\S+)\s*([\s\S]*)$/) : null
  if (!m) return { ok: false, error: "not a command" }
  const [, name, args] = m
  const cmd = registry.getCommands().find((c) => c.name === name)
  if (!cmd) return { ok: false, error: `unknown command: /${name}` }
  try {
    return { ok: true, text: await cmd.run(args) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("forge:getTranscript", () => transcript)

ipcMain.handle("forge:openPath", async (_e, p: unknown) => {
  if (typeof p !== "string" || !p.trim()) return null
  const err = await shell.openPath(p.trim())
  return err || null
})

ipcMain.handle("forge:openExternal", async (_e, url: unknown) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})