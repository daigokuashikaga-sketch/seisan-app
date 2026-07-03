import { ipcRenderer, contextBridge } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  // 動作モード（オフライン=standalone / オンライン=server）
  getAppConfig: (): Promise<{ mode: string | null; serverUrl: string | null; version: string }> =>
    ipcRenderer.invoke("config:get"),
  setMode: (mode: "standalone" | "server", serverUrl?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("config:set-mode", mode, serverUrl),

  // データバックアップ（スタンドアロンのみ）
  createBackup: (): Promise<void> => ipcRenderer.invoke("backup:create"),

  // Dialog
  showOpenDialog: (opts: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("dialog:open", opts),
  showSaveDialog: (opts: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke("dialog:save", opts),

  // File system
  readFile: (path: string) => ipcRenderer.invoke("fs:read", path),
  writeFile: (path: string, data: string) =>
    ipcRenderer.invoke("fs:write", path, data),

  // Notifications
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke("notification:show", title, body),

  // Window controls
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),

  // Events from main → renderer
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.on("deep-link", (_, url) => cb(url));
    return () => ipcRenderer.removeAllListeners("deep-link");
  },
});
