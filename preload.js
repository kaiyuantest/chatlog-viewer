const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatlogApi", {
  loadIndex: () => ipcRenderer.invoke("index:load"),
  loadConversation: (payload) => ipcRenderer.invoke("conversation:load", payload),
  getConfig: () => ipcRenderer.invoke("config:get"),
  chooseSessionsDir: () => ipcRenderer.invoke("config:chooseSessionsDir")
});
