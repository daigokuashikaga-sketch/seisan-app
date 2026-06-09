import { app, BrowserWindow, ipcMain, dialog, Notification, Menu } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";
const APP_NAME = "Seisan";

let win: BrowserWindow | null;

// ── サーバーURLの解決・永続化（シンクライアント） ──
// 優先順: 環境変数 SEISAN_SERVER_URL > userData/config.json > dev既定
function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readServerUrl(): string | null {
  if (process.env.SEISAN_SERVER_URL) return process.env.SEISAN_SERVER_URL;
  try {
    const p = configPath();
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, "utf-8"));
      if (typeof cfg.serverUrl === "string" && cfg.serverUrl) return cfg.serverUrl;
    }
  } catch {
    /* 壊れた設定は無視 */
  }
  if (isDev) return "http://localhost:4200";
  return null;
}

function saveServerUrl(url: string) {
  try {
    writeFileSync(configPath(), JSON.stringify({ serverUrl: url }, null, 2));
  } catch (e) {
    console.error("Failed to save server URL:", e);
  }
}

function normalizeUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

// 初回起動など、サーバー未設定時に表示するセットアップ画面（data URLで自己完結）
function setupPageUrl(message = ""): string {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${APP_NAME} セットアップ</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,'Segoe UI',sans-serif;background:linear-gradient(135deg,#667eea,#764ba2)}
  .card{background:#fff;border-radius:16px;padding:32px 28px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
  h1{font-size:18px;margin:0 0 6px;color:#1E293B}
  p{font-size:13px;color:#64748B;margin:0 0 18px}
  input{width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;color:#111827}
  button{margin-top:14px;width:100%;padding:12px;border:none;border-radius:10px;cursor:pointer;
    background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:15px;font-weight:700}
  .err{color:#DC2626;font-size:12px;margin-top:8px;min-height:16px}
</style></head><body>
  <div class="card">
    <h1>サーバーに接続</h1>
    <p>精算管理システムのサーバーURLを入力してください（管理者から共有されます）。</p>
    <input id="u" placeholder="https://seisan.example.com" autofocus>
    <div class="err" id="e">${message}</div>
    <button id="b">接続</button>
  </div>
  <script>
    const go = async () => {
      const v = document.getElementById('u').value;
      const ok = await window.electronAPI.setServerUrl(v);
      if (!ok) document.getElementById('e').textContent = 'URLの形式が正しくありません';
    };
    document.getElementById('b').addEventListener('click', go);
    document.getElementById('u').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  </script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function loadApp() {
  if (!win) return;
  const serverUrl = readServerUrl();
  if (serverUrl) {
    win.loadURL(serverUrl);
  } else {
    win.loadURL(setupPageUrl());
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadApp();
}

// --- IPC Handlers ---

// サーバーURL設定（シンクライアント）
ipcMain.handle("config:get-server-url", () => readServerUrl());
ipcMain.handle("config:set-server-url", (_, raw: string) => {
  const url = normalizeUrl(raw);
  if (!url) return false;
  saveServerUrl(url);
  loadApp();
  return true;
});

// Dialog
ipcMain.handle("dialog:open", async (_, opts) => {
  const result = await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:save", async (_, opts) => {
  const result = await dialog.showSaveDialog(opts);
  return result.canceled ? null : result.filePath;
});

// File system
ipcMain.handle("fs:read", async (_, filePath: string) => {
  return fs.readFile(filePath, "utf-8");
});

ipcMain.handle("fs:write", async (_, filePath: string, data: string) => {
  await fs.writeFile(filePath, data, "utf-8");
});

// Notifications
ipcMain.handle("notification:show", (_, title: string, body: string) => {
  new Notification({ title, body }).show();
});

// Window controls
ipcMain.handle("window:minimize", () => win?.minimize());
ipcMain.handle("window:maximize", () => {
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
ipcMain.handle("window:close", () => win?.close());

// --- メニュー（サーバー再設定 / 再読み込み） ---
function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        {
          label: "サーバーを再設定…",
          click: () => win?.loadURL(setupPageUrl()),
        },
        { label: "再読み込み", click: () => loadApp() },
        { type: "separator" },
        { role: "quit", label: "終了" },
      ],
    },
    {
      label: "編集",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// --- App lifecycle ---

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  app.setName(APP_NAME);
  buildMenu();
  createWindow();
});
