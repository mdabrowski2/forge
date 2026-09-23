import { app, BrowserWindow, dialog, ipcMain, shell, WebContentsView } from "electron"
import { fileURLToPath } from "url"
import path from "path"
import { writeFileSync } from "fs"
import { runCommand } from "./commands"
import { assembleDebugBundle, readTailLines } from "./debug-bundle"
import { FORGE_VERSION } from "../src/version"
import { collectBootNotices } from "./boot-notices"
import { logEvent, logFile } from "../src/transparency/log"
import { publishNotice, truncateNotice } from "../src/transparency/notice"
import { traceMutation } from "./mutations"
import { defaultConfig, loadConfig, saveConfig } from "../src/config"
import type { ForgeConfig, ModConfig } from "../src/config"
import { findRepoRoot, loadRepoConfig, saveRepoConfig } from "../src/repo-config"
import { listMods, loadMods, modsDir } from "../src/mods/loader"
import type { ModLoadResult } from "../src/mods/loader"
import { loadQuestPreview, loadPrPreview } from "./previews"
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
let modLoadResult: ModLoadResult = { loaded: [], failed: [], dir: modsDir }
const transcript: TransparencyEvent[] = []

// every renderer send funnels here: a non-null win can still be destroyed
// (window closed, app alive on macOS) and send() then throws inside the
// handler — observed as "Object has been destroyed" from prInboxPreview.
const sendToUI = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

// shared live sink for mutation/notice events (chat turns have their own;
// this keeps one ring-cap + send path for everything else). Turn-tagged so
// live routing matches replay routing exactly (see rendering contract).
const pushToUI = (e: TransparencyEvent) => {
  const tagged = { ...e, turn: session.messages.length }
  transcript.push(tagged)
  if (transcript.length > 2000) transcript.shift()
  sendToUI("forge:transparency", tagged)
}

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
    title: `forge ${FORGE_VERSION}`,
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
  console.log(`[mods] dir: ${modLoadResult.dir}`)
  for (const f of modLoadResult.failed) console.error(`[mods] ${f.name}: ${f.error}`)
  if (modLoadResult.loaded.length) console.log(`[mods] loaded: ${modLoadResult.loaded.join(", ")}`)

  harnesses = []
  const { providers, skipped } = await resolveProviders(config.providers)
  for (const s of skipped) console.error(`[providers] skipping "${s.id}": ${s.reason}`)
  // notice twins for terminal-less users: same content as the console lines
  // above, delivered to transcript + forge.log (re-emitted every launch by
  // design; renderer fetches getTranscript at boot and appends them feed-end)
  for (const n of collectBootNotices({
    modsDir: modLoadResult.dir,
    loaded: modLoadResult.loaded,
    failed: modLoadResult.failed,
    skipped,
  })) {
    logEvent(n)
    transcript.push(n)
    if (transcript.length > 2000) transcript.shift()
  }
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

ipcMain.handle("forge:version", () => FORGE_VERSION)

ipcMain.handle("forge:models", () =>
  harnesses.map((h) => ({
    id: h.id,
    name: h.name,
    models: h.models,
    defaultModel: h.defaultModel,
  }))
)

ipcMain.handle("forge:setModel", (_e, modelId: string) => {
  const before = currentModel
  const owner = harnesses.find((h) => h.models.includes(modelId))
  if (owner) currentHarness = owner
  currentModel = modelId
  traceMutation("model", "currentModel", before, currentModel, { session, push: pushToUI })
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
    sendToUI("forge:error", "No model selected")
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
      onDelta: (d) => sendToUI("forge:delta", d),
      onTransparency: (e) => {
        appendEvent(session, { ...e, turn })
        transcript.push(e)
        if (transcript.length > 2000) transcript.shift()
        sendToUI("forge:transparency", { ...e, turn })
      },
      signal: abortController.signal,
    })
    for (const m of full.messages) appendMessage(session, m)
    sendToUI("forge:done", full.text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendMessage(session, { role: "assistant", content: `⚠ ${msg}`, timestamp: Date.now() })
    sendToUI("forge:error", msg)
  }
})

ipcMain.handle("forge:stop", () => {
  abortController?.abort()
  return true
})

ipcMain.handle("forge:getSystemPrompt", () => getSystemPrompt())

// mod commands — /name args in the chat input routes here instead of the model
ipcMain.handle("forge:command", async (_e, text: string) => {
  const r = await runCommand(text, { session, registry })
  // both paths emit: failed commands are the highest-value debugging case
  publishNotice(
    "command",
    r.name || "(not-a-command)",
    { args: r.args, ok: r.ok, output: truncateNotice(r.ok ? (r.text ?? "") : (r.error ?? "")) },
    {
      session,
      // turn-tagged like the chat path so live routing matches replay
      turn: session.messages.length,
      push: (e) => {
        transcript.push(e)
        if (transcript.length > 2000) transcript.shift()
        sendToUI("forge:transparency", e)
      },
    }
  )
  return r.ok ? { ok: true, text: r.text } : { ok: false, error: r.error }
})

ipcMain.handle("forge:getTranscript", () => transcript)

ipcMain.handle("forge:skills", () => {
  const loaded = new Set(loadSessionMeta(session.id).loadedSkills ?? [])
  return registry.getAllSkills().map((s) => ({ ...s, loaded: loaded.has(s.name) }))
})

ipcMain.handle("forge:setSkillLoaded", (_e, name: string, loaded: boolean) => {
  const current = new Set(loadSessionMeta(session.id).loadedSkills ?? [])
  const before = current.has(name)
  if (loaded) current.add(name)
  else current.delete(name)
  saveSessionMeta(session.id, { loadedSkills: [...current] })
  traceMutation("skills", name, before, loaded, { session, push: pushToUI })
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
  const before = getScopedMods(scope)[dirName]?.enabled
  saveScopedMod(scope, dirName, { enabled })
  traceMutation("mods", `${dirName}(${scope}).enabled`, before, enabled, { session, push: pushToUI })
  return true
})

ipcMain.handle("forge:setModScopedSettings", (_e, scope: ModScope, dirName: string, settingsJson: string) => {
  let settings: Record<string, unknown>
  try {
    settings = JSON.parse(settingsJson)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" }
  }
  const before = getScopedMods(scope)[dirName]?.settings ?? {}
  saveScopedMod(scope, dirName, { settings })
  traceMutation("mods", `${dirName}(${scope}).settings`, before, settings, { session, push: pushToUI })
  return { ok: true }
})

ipcMain.handle("forge:relaunch", () => {
  app.relaunch()
  app.exit()
})

ipcMain.handle("forge:getConfig", () => config)

ipcMain.handle("forge:setConfig", (_e, next: ForgeConfig) => {
  const before = config
  config = next
  saveConfig(config)
  traceMutation("config", "providers", before, config, { session, push: pushToUI })
  return { ok: true }
})

ipcMain.handle("forge:questPreview", () => loadQuestPreview({ session, push: pushToUI }))

ipcMain.handle("forge:prInboxPreview", () => loadPrPreview({ session, push: pushToUI }))

ipcMain.handle("forge:openQuestTracker", () => openQuestTrackerView())

ipcMain.handle("forge:closeQuestTracker", () => closeQuestTrackerView())

ipcMain.handle("forge:openPath", async (_e, p: unknown) => {
  if (typeof p !== "string" || !p.trim()) return null
  const err = await shell.openPath(p.trim())
  return err || null
})

ipcMain.handle("forge:exportDebug", async () => {
  const bundle = assembleDebugBundle({
    version: FORGE_VERSION,
    platform: process.platform,
    dateISO: new Date().toISOString(),
    config,
    providers: harnesses.map((h) => ({ id: h.id, name: h.name, status: "listed", models: h.models })),
    mods: listMods(config, modLoadResult),
    logTail: readTailLines(logFile),
    messages: session.messages.slice(-100),
    events: loadEvents(session.id),
  })
  const picked = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath("downloads"), `forge-debug-${Date.now()}.md`),
  })
  // cancel is user intent, not an error — silent by design
  if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }
  try {
    writeFileSync(picked.filePath, bundle)
    await shell.showItemInFolder(picked.filePath)
    return { ok: true, path: picked.filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("forge:openExternal", async (_e, url: unknown) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})