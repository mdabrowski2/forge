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
})