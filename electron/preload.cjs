const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("atlas", {
  read: () => ipcRenderer.invoke("workspace:read"),
  backup: () => ipcRenderer.invoke("workspace:backup"),
  save: (data) => ipcRenderer.invoke("workspace:save", data),
  snapshot: () => ipcRenderer.invoke("workspace:snapshot"),
  commit: (data, revision) => ipcRenderer.invoke("workspace:commit", data, revision),
  ready: () => ipcRenderer.invoke("workspace:ready"),
  onChanged: (callback) => {
    const listener = (_, snapshot) => callback(snapshot);
    ipcRenderer.on("workspace:changed", listener);
    return () => ipcRenderer.removeListener("workspace:changed", listener);
  },
  onFlush: (callback) => {
    const listener = async (_, id) => {
      try { await callback(); ipcRenderer.send("workspace:flushed", id, null); }
      catch (error) { ipcRenderer.send("workspace:flushed", id, String(error.message || error)); }
    };
    ipcRenderer.on("workspace:flush", listener);
    return () => ipcRenderer.removeListener("workspace:flush", listener);
  },
});
