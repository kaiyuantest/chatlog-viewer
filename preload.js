const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatlogApi", {
  loadIndex: () => ipcRenderer.invoke("index:load"),
  loadConversation: (payload) => ipcRenderer.invoke("conversation:load", payload),
  getConfig: () => ipcRenderer.invoke("config:get"),
  chooseSessionsDir: () => ipcRenderer.invoke("config:chooseSessionsDir"),
  setPathOrder: (payload) => ipcRenderer.invoke("config:setPathOrder", payload),
  openCmd: (payload) => ipcRenderer.invoke("shell:openCmd", payload),
  openPathInExplorer: (payload) => ipcRenderer.invoke("shell:openPathInExplorer", payload),
  openCmdTabs: (payload) => ipcRenderer.invoke("shell:openCmdTabs", payload),
  exportPathHistoryFiles: (payload) => ipcRenderer.invoke("export:pathHistoryFiles", payload)
});
