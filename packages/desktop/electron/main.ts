import { app, BrowserWindow, ipcMain, dialog, Notification, Menu, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, cpSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { startServer, type RunningServer } from "./server/start-server";
import { backupAll } from "./server/backup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged;
const APP_NAME = "Seisan";
const PREFERRED_PORT = 47823;

let win: BrowserWindow | null = null;
let server: RunningServer | null = null;
// 現在ウィンドウに読み込むべきアプリのオリジン（ナビゲーションガードで使用）
let allowedOrigin: string | null = null;
// 起動シーケンス中は did-fail-load のフォールバック表示を抑止する
// （リトライループとの二重ページ遷移を防ぐ）
let booting = false;

// ── 動作モード設定 ──
// standalone: サーバー同梱・このPC内で完結（オフライン）
// server:     社内などにデプロイした共有サーバーに接続（オンライン・複数PCでデータ共有）
type AppMode = "standalone" | "server";
interface AppConfig {
  mode: AppMode | null;
  serverUrl: string | null;
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): AppConfig {
  // 企業配布向け: 環境変数でサーバーURLを固定できる（設定画面をスキップ）
  const envUrl = process.env.SEISAN_SERVER_URL;
  if (envUrl) {
    const url = normalizeUrl(envUrl);
    if (url) return { mode: "server", serverUrl: url };
  }
  try {
    const p = configPath();
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      const mode: AppMode | null =
        raw.mode === "standalone" || raw.mode === "server"
          ? raw.mode
          : typeof raw.serverUrl === "string" && raw.serverUrl
            ? "server" // 旧シンクライアント版の設定を引き継ぐ
            : null;
      return {
        mode,
        serverUrl: typeof raw.serverUrl === "string" && raw.serverUrl ? raw.serverUrl : null,
      };
    }
  } catch {
    /* 壊れた設定は初期化扱い */
  }
  return { mode: null, serverUrl: null };
}

function saveConfig(cfg: AppConfig) {
  try {
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error("Failed to save config:", e);
  }
}

function normalizeUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// 接続先が本アプリのサーバーとして応答するかを確認する
async function checkServerHealth(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: `サーバーがエラーを返しました（HTTP ${res.status}）` };
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    if (!body || body.status !== "ok") {
      return { ok: false, error: "このURLは精算アプリのサーバーではないようです" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "サーバーに接続できません。URLとネットワーク接続をご確認ください" };
  }
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

// 旧バージョン(〜v0.1.1)は package.json の name 由来で userData が
// <appData>/@template/desktop になっていた。productName 導入で <appData>/Seisan に
// 変わるため、初回起動時に旧データ（DB/領収書/秘密鍵/設定）を引き継ぐ。
function migrateLegacyUserData() {
  try {
    const current = app.getPath("userData");
    const legacy = path.join(app.getPath("appData"), "@template", "desktop");
    if (legacy === current || !existsSync(legacy)) return;
    if (existsSync(path.join(current, "seisan.db"))) return; // 新データが既にある

    mkdirSync(current, { recursive: true });
    for (const f of ["seisan.db", "seisan.db-wal", "seisan.db-shm", "auth-secret", "config.json"]) {
      const src = path.join(legacy, f);
      if (existsSync(src)) copyFileSync(src, path.join(current, f));
    }
    const legacyUploads = path.join(legacy, "uploads");
    if (existsSync(legacyUploads)) {
      cpSync(legacyUploads, path.join(current, "uploads"), { recursive: true });
    }
    console.log(`Migrated legacy user data: ${legacy} -> ${current}`);
  } catch (e) {
    console.error("Legacy data migration failed:", e);
  }
}

// ── パス解決 ──
function appRoot() {
  return app.getAppPath();
}
function webDistDir() {
  return isDev ? path.resolve(appRoot(), "../web/dist") : path.join(appRoot(), "web-dist");
}
function migrationsDir() {
  return isDev ? path.resolve(appRoot(), "../web/drizzle") : path.join(appRoot(), "drizzle");
}
function dbPath() {
  return path.join(app.getPath("userData"), "seisan.db");
}
function uploadsDir() {
  return path.join(app.getPath("userData"), "uploads");
}

// ── 自己完結ページ（data URL） ──

const PAGE_STYLE = `
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;
    background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}
`;

function statusPageUrl(title: string, message: string, spinner = false): string {
  const spin = spinner
    ? `<div class="spinner"></div>`
    : `<div style="font-size:40px">⚠️</div>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${APP_NAME}</title>
<style>${PAGE_STYLE}
  .card{text-align:center;padding:32px}
  h1{font-size:18px;margin:14px 0 6px}
  p{font-size:13px;opacity:.85;margin:0;max-width:400px;line-height:1.7}
  .spinner{width:42px;height:42px;margin:0 auto;border:4px solid rgba(255,255,255,.3);
    border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
  <div class="card">${spin}<h1>${title}</h1><p>${message}</p></div>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// 初回起動／モード変更時に表示するモード選択画面
function setupPageUrl(message = ""): string {
  const cfg = readConfig();
  const currentUrl = cfg.serverUrl ?? "";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${APP_NAME} セットアップ</title>
<style>${PAGE_STYLE}
  .wrap{width:min(760px,92vw);padding:24px}
  h1{font-size:22px;margin:0 0 4px;text-align:center}
  .sub{font-size:13px;opacity:.8;text-align:center;margin:0 0 22px}
  .cards{display:flex;gap:16px;flex-wrap:wrap}
  .card{flex:1;min-width:300px;background:#fff;border-radius:16px;padding:24px 22px;color:#1E293B;
    box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column}
  .card h2{font-size:16px;margin:0 0 6px;display:flex;align-items:center;gap:8px}
  .card p{font-size:12.5px;color:#64748B;margin:0 0 14px;line-height:1.7;flex:1}
  .badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 10px;border-radius:99px}
  .badge.off{background:#ECFDF5;color:#059669}
  .badge.on{background:#EEF2FF;color:#4F46E5}
  input{width:100%;padding:11px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:13px;
    color:#111827;margin-bottom:10px}
  button{width:100%;padding:12px;border:none;border-radius:10px;cursor:pointer;
    background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:14px;font-weight:700}
  button:disabled{opacity:.6;cursor:default}
  .hint{font-size:11px;color:#94A3B8;margin:8px 0 0;line-height:1.6}
  .err{color:#DC2626;font-size:12px;min-height:18px;margin-top:10px;text-align:center}
  .ver{font-size:11px;opacity:.6;text-align:center;margin-top:16px}
</style></head><body>
  <div class="wrap">
    <h1>${APP_NAME} — 経費精算</h1>
    <p class="sub">利用方法を選択してください（あとからメニューで変更できます）</p>
    <div class="cards">
      <div class="card">
        <h2>💻 この PC だけで使う <span class="badge off">オフライン</span></h2>
        <p>データはこの PC の中にだけ保存されます。サーバーやネット接続は不要で、
        今すぐ使い始められます。個人利用・1台での運用向け。</p>
        <button id="btn-standalone">オフラインで始める</button>
      </div>
      <div class="card">
        <h2>🌐 共有サーバーに接続 <span class="badge on">オンライン</span></h2>
        <p>会社にデプロイした共有サーバーへ接続し、複数の PC・メンバーでデータを共有します。
        サーバーURLは管理者から共有されます。</p>
        <input id="url" placeholder="https://seisan.example.com" value="${currentUrl.replace(/"/g, "&quot;")}">
        <button id="btn-server">サーバーに接続</button>
        <p class="hint">🔒 社外からアクセスする場合は https:// のURLを使用してください。</p>
      </div>
    </div>
    <div class="err" id="err">${message}</div>
    <div class="ver">${APP_NAME} v${app.getVersion()}</div>
  </div>
  <script>
    const err = document.getElementById('err');
    const btnS = document.getElementById('btn-standalone');
    const btnC = document.getElementById('btn-server');
    const lock = (on, label) => {
      btnS.disabled = on; btnC.disabled = on;
      if (label) btnC.textContent = label;
    };
    btnS.addEventListener('click', async () => {
      err.textContent = ''; lock(true);
      const r = await window.electronAPI.setMode('standalone');
      if (!r.ok) { err.textContent = r.error || '設定に失敗しました'; lock(false, 'サーバーに接続'); }
    });
    const connect = async () => {
      err.textContent = ''; lock(true, '接続を確認中…');
      const r = await window.electronAPI.setMode('server', document.getElementById('url').value);
      if (!r.ok) { err.textContent = r.error || '接続に失敗しました'; lock(false, 'サーバーに接続'); }
    };
    btnC.addEventListener('click', connect);
    document.getElementById('url').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  </script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showSetupPage(message = "") {
  win?.loadURL(setupPageUrl(message));
}

// 読み込み中URLが現在のアプリのオリジンと厳密一致するか（ナビゲーションガード用）
function isAppOrigin(url: string): boolean {
  if (!allowedOrigin) return false;
  try {
    return new URL(url).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
}

// ── ウィンドウ ──

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
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // ナビゲーションガード: アプリのオリジン（厳密一致）以外への遷移をすべて禁止する。
  // 前方一致だと http://127.0.0.1:47823.evil.com 等でバイパスされるため origin で比較。
  // レンダラー起点の data: 遷移も拒否（正規の data: 画面は main が loadURL で読み込む）。
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppOrigin(url)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  // サーバー側 3xx リダイレクトによるガード迂回を防ぐ
  win.webContents.on("will-redirect", (e, url) => {
    if (isAppOrigin(url)) return;
    e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // オンラインモードでサーバーに到達できなくなった場合のフォールバック表示
  win.webContents.on("did-fail-load", (_e, code, _desc, url) => {
    if (booting) return; // 起動リトライ中は boot 側がハンドリングする
    if (code === -3 /* ABORTED: 画面遷移等の正常中断 */) return;
    if (isAppOrigin(url)) {
      win?.loadURL(
        statusPageUrl(
          "サーバーに接続できません",
          "ネットワーク接続をご確認のうえ、メニューの「再読み込み」をお試しください。<br>接続先を変える場合は「動作モードを変更…」を選択してください。",
        ),
      );
    }
  });

  win.loadURL(statusPageUrl("起動しています…", "しばらくお待ちください。", true));
}

// ── モード起動 ──

async function bootStandalone(): Promise<void> {
  booting = true;
  try {
    if (!server) {
      win?.loadURL(statusPageUrl("起動しています…", "ローカルサーバーを準備中です。", true));
      server = await startServer({
        webDist: webDistDir(),
        migrationsFolder: migrationsDir(),
        dbPath: dbPath(),
        uploadDir: uploadsDir(),
        authSecret: resolveAuthSecret(),
        preferredPort: PREFERRED_PORT,
      });
    }
    allowedOrigin = server.url;
    await loadAppWithRetry(server.url);
  } catch (e) {
    console.error("Standalone server failed to start:", e);
    const msg = e instanceof Error ? e.message : String(e);
    win?.loadURL(
      statusPageUrl(
        "起動に失敗しました",
        `アプリの初期化中に問題が発生しました。アプリを再起動してください。<br><br>${msg}`,
      ),
    );
  } finally {
    booting = false;
  }
}

async function bootServerMode(serverUrl: string): Promise<void> {
  allowedOrigin = serverUrl;
  booting = true;
  try {
    await loadAppWithRetry(serverUrl, 3);
  } catch {
    showSetupPage("サーバーに接続できませんでした。URLを確認して再度お試しください");
  } finally {
    booting = false;
  }
}

async function bootFromConfig(): Promise<void> {
  const cfg = readConfig();
  if (cfg.mode === "standalone") return bootStandalone();
  if (cfg.mode === "server" && cfg.serverUrl) return bootServerMode(cfg.serverUrl);
  showSetupPage();
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

// ── バックアップ（スタンドアロンのみ） ──

// 戻り値: 実際にバックアップが完了したら true（キャンセル・失敗・非対応モードは false）。
async function runBackupInteractive(): Promise<boolean> {
  const cfg = readConfig();
  if (cfg.mode !== "standalone" || !server) {
    dialog.showMessageBox(win!, {
      type: "info",
      title: "バックアップ",
      message: "バックアップはオフラインモードでのみ利用できます",
      detail: "オンラインモードのデータは接続先サーバーで管理されています。サーバー管理者にお問い合わせください。",
    });
    return false;
  }
  const res = await dialog.showOpenDialog(win!, {
    title: "バックアップの保存先フォルダを選択",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths[0]) return false;
  try {
    const { dir } = await backupAll(dbPath(), uploadsDir(), res.filePaths[0]);
    new Notification({
      title: "バックアップが完了しました",
      body: dir,
    }).show();
    shell.showItemInFolder(path.join(dir, "seisan.db"));
    return true;
  } catch (e) {
    console.error("Backup failed:", e);
    dialog.showErrorBox(
      "バックアップに失敗しました",
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

// ── データの初期化（リセット・スタンドアロンのみ） ──
//
// 使用中の SQLite ファイルは（特に Windows で）ロックされて削除できないため、
// 「初期化予約マーカーを書く → アプリを再起動 → 新プロセス起動時に削除」する。
// 実際の削除は performPendingResetIfAny() が行う。
function resetMarkerPath() {
  return path.join(app.getPath("userData"), "reset-pending");
}

// 起動直後（DB を開く前）に呼ぶ。予約があれば DB と領収書を削除して初期状態に戻す。
function performPendingResetIfAny() {
  try {
    if (!existsSync(resetMarkerPath())) return;
    for (const f of ["seisan.db", "seisan.db-wal", "seisan.db-shm"]) {
      rmSync(path.join(app.getPath("userData"), f), { force: true });
    }
    rmSync(uploadsDir(), { recursive: true, force: true });
    rmSync(resetMarkerPath(), { force: true });
    console.log("Pending reset performed: cleared database and uploads.");
  } catch (e) {
    console.error("Pending reset failed:", e);
  }
}

async function runResetInteractive(): Promise<void> {
  const cfg = readConfig();
  if (cfg.mode !== "standalone") {
    dialog.showMessageBox(win!, {
      type: "info",
      title: "データの初期化",
      message: "初期化はオフラインモードでのみ利用できます",
      detail:
        "オンラインモードのデータは接続先サーバーで管理されています。サーバー管理者にお問い合わせください。",
    });
    return;
  }

  const { response } = await dialog.showMessageBox(win!, {
    type: "warning",
    title: "データを初期化（リセット）",
    message: "すべてのデータを削除して初期状態に戻しますか？",
    detail:
      "登録済みのアカウント・経費申請・領収書画像がすべて削除されます。\n" +
      "初期化後は、最初に登録した人がふたたび管理者になります。\n\n" +
      "この操作は取り消せません。必要であれば先にバックアップしてください。",
    buttons: ["キャンセル", "バックアップしてから初期化", "初期化する"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response === 0) return;
  if (response === 1) {
    const backedUp = await runBackupInteractive();
    if (!backedUp) return; // バックアップをやめたら初期化も中止
  }

  const confirm = await dialog.showMessageBox(win!, {
    type: "warning",
    title: "最終確認",
    message: "本当に初期化しますか？",
    detail: "アプリを再起動し、すべてのデータを削除します。",
    buttons: ["キャンセル", "初期化して再起動"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (confirm.response !== 1) return;

  try {
    writeFileSync(resetMarkerPath(), new Date().toISOString());
  } catch (e) {
    dialog.showErrorBox("初期化に失敗しました", e instanceof Error ? e.message : String(e));
    return;
  }
  // 開いている DB 接続を解放するため、サーバーを止めてから再起動する。
  if (server) {
    await server.close().catch(() => {});
    server = null;
  }
  app.relaunch();
  app.exit(0);
}

// --- IPC Handlers ---

// モード設定（セットアップ画面から呼ばれる）
ipcMain.handle("config:get", () => {
  const cfg = readConfig();
  return { ...cfg, version: app.getVersion() };
});

ipcMain.handle(
  "config:set-mode",
  async (_e, mode: unknown, rawUrl?: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (mode === "standalone") {
      const prev = readConfig();
      saveConfig({ mode: "standalone", serverUrl: prev.serverUrl });
      await bootStandalone();
      return { ok: true };
    }
    if (mode === "server") {
      const url = normalizeUrl(String(rawUrl ?? ""));
      if (!url) return { ok: false, error: "URLの形式が正しくありません（例: https://seisan.example.com）" };
      const health = await checkServerHealth(url);
      if (!health.ok) return { ok: false, error: health.error };
      saveConfig({ mode: "server", serverUrl: url });
      // ローカルサーバーは不要になるため停止（データは消えない）
      if (server) {
        await server.close().catch(() => {});
        server = null;
      }
      await bootServerMode(url);
      return { ok: true };
    }
    return { ok: false, error: "不明なモードです" };
  },
);

ipcMain.handle("backup:create", () => runBackupInteractive());

// Dialog / fs / notification / window（フロントの preload API に対応）
ipcMain.handle("dialog:open", async (_, opts) => {
  const result = await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:save", async (_, opts) => {
  const result = await dialog.showSaveDialog(opts);
  return result.canceled ? null : result.filePath;
});

// 注: 任意パスへの読み書きを行う fs:read / fs:write IPC は撤去した。
// オンラインモードではリモートページに露出し、端末の全ファイルを読み書きされる
// 恐れがあったため（フロントエンドでも未使用）。

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
        {
          label: "再読み込み",
          click: () => {
            if (allowedOrigin) win?.loadURL(allowedOrigin);
            else bootFromConfig();
          },
        },
        { label: "動作モードを変更…", click: () => showSetupPage() },
        { type: "separator" },
        { label: "データをバックアップ…", click: () => runBackupInteractive() },
        { label: "データを初期化（リセット）…", click: () => runResetInteractive() },
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
    migrateLegacyUserData();
    performPendingResetIfAny();
    buildMenu();
    createWindow();
    bootFromConfig();
  });
}
