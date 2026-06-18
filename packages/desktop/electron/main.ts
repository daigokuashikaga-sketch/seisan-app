import { app, BrowserWindow, ipcMain, dialog, Notification, Menu } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { startServer, type RunningServer } from "./server/start-server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged;
const APP_NAME = "Seisan";
const PREFERRED_PORT = 47823;

let win: BrowserWindow | null = null;
let server: RunningServer | null = null;

// ── パス解決 ──
// パッケージ済み: web-dist / drizzle は app.asar 内に同梱（electron-builder files）。
// 開発時: packages/web のビルド出力を直接参照する。
function appRoot() {
  return app.getAppPath();
}
function webDistDir() {
  return isDev
    ? path.resolve(appRoot(), "../web/dist")
    : path.join(appRoot(), "web-dist");
}
function migrationsDir() {
  return isDev
    ? path.resolve(appRoot(), "../web/drizzle")
    : path.join(appRoot(), "drizzle");
}

// Better Auth 用の秘密鍵を端末ごとに生成・永続化する。
function resolveAuthSecret(): string {
  const p = path.join(app.getPath("userData"), "auth-secret");
  try {
    if (existsSync(p)) {
      const s = readFileSync(p, "utf-8").trim();
      if (s) return s;
    }
  } catch {
    /* 壊れていれば作り直す */
  }
  const secret = randomBytes(32).toString("hex");
  try {
    writeFileSync(p, secret, { mode: 0o600 });
  } catch (e) {
    console.error("Failed to persist auth secret:", e);
  }
  return secret;
}

// 起動中／エラー時に表示する自己完結ページ（data URL）。
function statusPageUrl(title: string, message: string, spinner = false): string {
  const spin = spinner
    ? `<div class="spinner"></div>`
    : `<div style="font-size:40px">⚠️</div>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${APP_NAME}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;
    background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}
  .card{text-align:center;padding:32px}
  h1{font-size:18px;margin:14px 0 6px}
  p{font-size:13px;opacity:.85;margin:0;max-width:360px;line-height:1.6}
  .spinner{width:42px;height:42px;margin:0 auto;border:4px solid rgba(255,255,255,.3);
    border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
  <div class="card">${spin}<h1>${title}</h1><p>${message}</p></div>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#764ba2",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.loadURL(statusPageUrl("起動しています…", "ローカルサーバーを準備中です。", true));
}

// サーバーを起動して画面を読み込む。失敗時はエラーページを表示。
async function boot() {
  try {
    server = await startServer({
      webDist: webDistDir(),
      migrationsFolder: migrationsDir(),
      dbPath: path.join(app.getPath("userData"), "seisan.db"),
      uploadDir: path.join(app.getPath("userData"), "uploads"),
      authSecret: resolveAuthSecret(),
      preferredPort: PREFERRED_PORT,
    });
    await loadAppWithRetry(server.url);
  } catch (e) {
    console.error("Server failed to start:", e);
    const msg = e instanceof Error ? e.message : String(e);
    win?.loadURL(
      statusPageUrl(
        "起動に失敗しました",
        `アプリの初期化中に問題が発生しました。アプリを再起動してください。<br><br>${msg}`,
      ),
    );
  }
}

// サーバー起動直後はまれに接続が安定しないため数回リトライする。
async function loadAppWithRetry(url: string, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      await win?.loadURL(url);
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

// --- IPC Handlers（フロントの preload API に対応） ---

ipcMain.handle("dialog:open", async (_, opts) => {
  const result = await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:save", async (_, opts) => {
  const result = await dialog.showSaveDialog(opts);
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("fs:read", async (_, filePath: string) => {
  return fs.readFile(filePath, "utf-8");
});

ipcMain.handle("fs:write", async (_, filePath: string, data: string) => {
  await fs.writeFile(filePath, data, "utf-8");
});

ipcMain.handle("notification:show", (_, title: string, body: string) => {
  new Notification({ title, body }).show();
});

ipcMain.handle("window:minimize", () => win?.minimize());
ipcMain.handle("window:maximize", () => {
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.handle("window:close", () => win?.close());

// --- メニュー ---
function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { label: `${APP_NAME} について`, role: "about" },
        { type: "separator" },
        { label: "再読み込み", click: () => server && win?.loadURL(server.url) },
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

// 単一インスタンスに限定（DB を複数プロセスで開かない）。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", () => {
    server?.close().catch(() => {});
  });

  app.whenReady().then(() => {
    app.setName(APP_NAME);
    buildMenu();
    createWindow();
    boot();
  });
}
