import { app, BrowserWindow, ipcMain, shell, WebContentsView } from "electron"
import { fileURLToPath } from "url"
import path from "path"
import { existsSync, statSync } from "fs"
import { homedir } from "os"
import { defaultConfig, loadConfig, saveConfig } from "../src/config"
import type { ForgeConfig, ModConfig } from "../src/config"
import { findRepoRoot, loadRepoConfig, saveRepoConfig } from "../src/repo-config"
import { listMods, loadMods, modsDir } from "../src/mods/loader"
import type { ModLoadResult } from "../src/mods/loader"
import { fetchQuestPreview } from "../src/integrations/quest-tracker"
import { fetchPrInboxPreview } from "../src/integrations/bitbucket"
import { createForgeHarness } from "../src/harness/forge-harness"
import { resolveProviders } from "../src/providers/registry"
import { createClaudeCodeCliHarness } from "../src/harness/claude-code-cli-harness"
import type { Harness } from "../src/harness/types"
import {
  appendEvent,
  appendMessage,
  listSessions,
  loadEvents,
  loadSession,
  loadSessionMeta,
  newSession,
  saveSessionMeta,
} from "../src/sessions/store"
import type { Session } from "../src/sessions/store"
import type { TransparencyEvent } from "../src/agent/loop"
import { getSystemPrompt } from "../src/agent/prompt"
import { registry } from "../src/mods/registry"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win: BrowserWindow | null = null
let questView: WebContentsView | null = null
let questViewOpen = false
// must stay in sync with #quest-modal-header's CSS position/size in style.css
const QUEST_MODAL_MARGIN = 40
const QUEST_MODAL_HEADER = 48
let harnesses: Harness[] = []
let currentHarness: Harness | null = null
let currentModel = ""
let session: Session = newSession("", defaultConfig().cwd)
let abortController: AbortController | null = null
let config: ForgeConfig = defaultConfig()
let modLoadResult: ModLoadResult = { loaded: [], failed: [] }
const transcript: TransparencyEvent[] = []

// restores whichever model/harness a session last used, so switching
// sessions (or relaunching into one) doesn't silently fall back to
// harnesses[0]. Leaves currentHarness/currentModel untouched if the session
// has no recorded model or no harness currently owns it.
const restoreModelForSession = (id: string) => {
  const lastModel = loadSessionMeta(id).model
  const lastHarness = lastModel ? harnesses.find((h) => h.models.includes(lastModel)) : undefined
  if (lastHarness && lastModel) {
    currentHarness = lastHarness
    currentModel = lastModel
  }
}

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

  win.on("resize", () => {
    if (questViewOpen) applyQuestViewBounds()
  })

  // smoke test: --smoke quits right after the window finishes loading
  if (process.argv.includes("--smoke")) {
    win.webContents.once("did-finish-load", () => {
      console.log("SMOKE: window loaded OK")
      app.quit()
    })
  }
}

const applyQuestViewBounds = () => {
  if (!win || !questView) return
  const { width, height } = win.getContentBounds()
  questView.setBounds({
    x: QUEST_MODAL_MARGIN,
    y: QUEST_MODAL_MARGIN + QUEST_MODAL_HEADER,
    width: Math.max(0, width - QUEST_MODAL_MARGIN * 2),
    height: Math.max(0, height - QUEST_MODAL_MARGIN * 2 - QUEST_MODAL_HEADER),
  })
}

const openQuestTrackerView = () => {
  if (!win) return
  if (!questView) {
    questView = new WebContentsView({ webPreferences: { contextIsolation: true } })
    questView.webContents.loadURL("http://localhost:3060")
  }
  win.contentView.addChildView(questView)
  questViewOpen = true
  applyQuestViewBounds()
}

const closeQuestTrackerView = () => {
  if (!win || !questView) return
  win.contentView.removeChildView(questView)
  questViewOpen = false
}

const boot = async () => {
  config = loadConfig()

  modLoadResult = await loadMods(config)
  for (const f of modLoadResult.failed) console.error(`[mods] ${f.name}: ${f.error}`)
  if (modLoadResult.loaded.length) console.log(`[mods] loaded: ${modLoadResult.loaded.join(", ")}`)

  harnesses = []
  const { providers, skipped } = await resolveProviders(config.providers)
  for (const s of skipped) console.error(`[providers] skipping "${s.id}": ${s.reason}`)
  for (const p of providers) harnesses.push(createForgeHarness(p, () => config))
  harnesses.push(createClaudeCodeCliHarness())

  currentHarness = harnesses[0] ?? null
  currentModel = currentHarness?.defaultModel ?? ""

  const sessions = listSessions()
  session = sessions[0]
    ? (loadSession(sessions[0].id) ?? newSession(currentModel, config.cwd))
    : newSession(currentModel, config.cwd)
  restoreModelForSession(session.id)

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
  harnesses.map((h) => ({
    id: h.id,
    name: h.name,
    models: h.models,
    defaultModel: h.defaultModel,
  }))
)

ipcMain.handle("forge:setModel", (_e, modelId: string) => {
  const owner = harnesses.find((h) => h.models.includes(modelId))
  if (owner) currentHarness = owner
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
  if (s) {
    session = s
    restoreModelForSession(id)
  }
  return s ? { ...s, events: loadEvents(id) } : s
})

ipcMain.handle("forge:newSession", () => {
  session = newSession(currentModel, config.cwd)
  return { ...session, events: [] }
})

ipcMain.handle("forge:chat", async (_e, text: string) => {
  if (!currentHarness || !currentModel) {
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
    const full = await currentHarness.runTurn({
      model: currentModel,
      messages: session.messages,
      cwd: session.cwd,
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
  // a slash command can be the very first thing typed in a session, before
  // any chat turn has run setActiveSession — mod commands need it too, so a
  // repo/session-scoped mod config resolves correctly even then
  registry.setActiveSession({ id: session.id, cwd: session.cwd })

  // core command, not mod-provided — checked first so a mod can never shadow it
  if (name === "cd") {
    const target = args.trim()
    if (!target) return { ok: true, text: `cwd: ${session.cwd}` }
    const resolved = path.resolve(session.cwd, target.replace(/^~(?=$|\/)/, homedir()))
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      return { ok: false, error: `not a directory: ${resolved}` }
    }
    session.cwd = resolved
    saveSessionMeta(session.id, { cwd: resolved })
    return { ok: true, text: `cwd: ${resolved}` }
  }

  const cmd = registry.getCommands().find((c) => c.name === name)
  if (!cmd) return { ok: false, error: `unknown command: /${name}` }
  try {
    return { ok: true, text: await cmd.run(args) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("forge:getTranscript", () => transcript)

ipcMain.handle("forge:skills", () => {
  const loaded = new Set(loadSessionMeta(session.id).loadedSkills ?? [])
  return registry.getAllSkills().map((s) => ({ ...s, loaded: loaded.has(s.name) }))
})

ipcMain.handle("forge:setSkillLoaded", (_e, name: string, loaded: boolean) => {
  const current = new Set(loadSessionMeta(session.id).loadedSkills ?? [])
  if (loaded) current.add(name)
  else current.delete(name)
  saveSessionMeta(session.id, { loadedSkills: [...current] })
  return true
})

ipcMain.handle("forge:mods", () => listMods(config, modLoadResult))

ipcMain.handle("forge:reloadMods", async () => {
  registry.reset()
  modLoadResult = await loadMods(config, modsDir, { fresh: true })
  for (const f of modLoadResult.failed) console.error(`[mods] ${f.name}: ${f.error}`)
  return modLoadResult
})

type ModScope = "global" | "repo" | "session"

const getScopedMods = (scope: ModScope): Record<string, ModConfig> => {
  if (scope === "global") return config.mods
  if (scope === "repo") return loadRepoConfig(findRepoRoot(session.cwd)).mods
  return loadSessionMeta(session.id).modOverrides ?? {}
}

const saveScopedMod = (scope: ModScope, dirName: string, patch: ModConfig) => {
  if (scope === "global") {
    config.mods[dirName] = { ...config.mods[dirName], ...patch }
    saveConfig(config)
  } else if (scope === "repo") {
    const repoRoot = findRepoRoot(session.cwd)
    const current = loadRepoConfig(repoRoot).mods
    saveRepoConfig(repoRoot, { mods: { ...current, [dirName]: { ...current[dirName], ...patch } } })
  } else {
    const current = loadSessionMeta(session.id).modOverrides ?? {}
    saveSessionMeta(session.id, { modOverrides: { ...current, [dirName]: { ...current[dirName], ...patch } } })
  }
}

// raw, unresolved config at one scope — undefined enabled/empty settings mean
// "not set here, inherits from a less specific scope" (session > repo > global)
ipcMain.handle("forge:modsForScope", (_e, scope: ModScope) => {
  const scoped = getScopedMods(scope)
  return listMods(config, modLoadResult).map((m) => ({
    dirName: m.dirName,
    status: m.status,
    error: m.error,
    enabled: scoped[m.dirName]?.enabled,
    settings: scoped[m.dirName]?.settings ?? {},
  }))
})

ipcMain.handle("forge:setModScopedEnabled", (_e, scope: ModScope, dirName: string, enabled: boolean | undefined) => {
  saveScopedMod(scope, dirName, { enabled })
  return true
})

ipcMain.handle("forge:setModScopedSettings", (_e, scope: ModScope, dirName: string, settingsJson: string) => {
  let settings: Record<string, unknown>
  try {
    settings = JSON.parse(settingsJson)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" }
  }
  saveScopedMod(scope, dirName, { settings })
  return { ok: true }
})

ipcMain.handle("forge:relaunch", () => {
  app.relaunch()
  app.exit()
})

ipcMain.handle("forge:getConfig", () => config)

ipcMain.handle("forge:setConfig", (_e, next: ForgeConfig) => {
  config = next
  saveConfig(config)
  return { ok: true }
})

ipcMain.handle("forge:questPreview", () => fetchQuestPreview())

ipcMain.handle("forge:prInboxPreview", () => fetchPrInboxPreview())

ipcMain.handle("forge:openQuestTracker", () => openQuestTrackerView())

ipcMain.handle("forge:closeQuestTracker", () => closeQuestTrackerView())

ipcMain.handle("forge:openPath", async (_e, p: unknown) => {
  if (typeof p !== "string" || !p.trim()) return null
  const err = await shell.openPath(p.trim())
  return err || null
})

ipcMain.handle("forge:openExternal", async (_e, url: unknown) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})