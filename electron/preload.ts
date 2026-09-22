import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("forge", {
  chat: (text: string) => ipcRenderer.invoke("forge:chat", text),
  stop: () => ipcRenderer.invoke("forge:stop"),
  getModels: () => ipcRenderer.invoke("forge:models"),
  setModel: (modelId: string) => ipcRenderer.invoke("forge:setModel", modelId),
  getSession: () => ipcRenderer.invoke("forge:getSession"),
  listSessions: () => ipcRenderer.invoke("forge:sessions"),
  loadSession: (id: string) => ipcRenderer.invoke("forge:loadSession", id),
  newSession: () => ipcRenderer.invoke("forge:newSession"),
  onDelta: (cb: (text: string) => void) => ipcRenderer.on("forge:delta", (_e, text) => cb(text)),
  onDone: (cb: (text: string) => void) => ipcRenderer.on("forge:done", (_e, text) => cb(text)),
  onError: (cb: (msg: string) => void) => ipcRenderer.on("forge:error", (_e, msg) => cb(msg)),
  getSystemPrompt: () => ipcRenderer.invoke("forge:getSystemPrompt"),
  command: (text: string) => ipcRenderer.invoke("forge:command", text),
  getTranscript: () => ipcRenderer.invoke("forge:getTranscript"),
  openPath: (p: string) => ipcRenderer.invoke("forge:openPath", p),
  openExternal: (url: string) => ipcRenderer.invoke("forge:openExternal", url),
  onTransparency: (cb: (event: unknown) => void) =>
    ipcRenderer.on("forge:transparency", (_e, event) => cb(event)),
  listSkills: () => ipcRenderer.invoke("forge:skills"),
  setSkillLoaded: (name: string, loaded: boolean) => ipcRenderer.invoke("forge:setSkillLoaded", name, loaded),
  listMods: () => ipcRenderer.invoke("forge:mods"),
  reloadMods: () => ipcRenderer.invoke("forge:reloadMods"),
  modsForScope: (scope: string) => ipcRenderer.invoke("forge:modsForScope", scope),
  setModScopedEnabled: (scope: string, dirName: string, enabled: boolean | undefined) =>
    ipcRenderer.invoke("forge:setModScopedEnabled", scope, dirName, enabled),
  setModScopedSettings: (scope: string, dirName: string, settingsJson: string) =>
    ipcRenderer.invoke("forge:setModScopedSettings", scope, dirName, settingsJson),
  relaunch: () => ipcRenderer.invoke("forge:relaunch"),
  getQuestPreview: () => ipcRenderer.invoke("forge:questPreview"),
  getPrInboxPreview: () => ipcRenderer.invoke("forge:prInboxPreview"),
  openQuestTracker: () => ipcRenderer.invoke("forge:openQuestTracker"),
  closeQuestTracker: () => ipcRenderer.invoke("forge:closeQuestTracker"),
  getConfig: () => ipcRenderer.invoke("forge:getConfig"),
  setConfig: (config: unknown) => ipcRenderer.invoke("forge:setConfig", config),
})