// 埋め込みサーバー（スタンドアロン）。
// Electron の main プロセス（Node ランタイム）内で Hono アプリを起動し、
// 127.0.0.1 で API + 静的ファイルを配信する。データはすべてローカル。
//
// 重要: 環境変数（WEBSITE_URL / DATABASE_URL / BETTER_AUTH_SECRET 等）は
// `@template/web` の auth.ts / database/index.ts が「import 時点」で参照する。
// そのため env をセットしてから動的 import する（評価順を保証）。

import { serve } from "@hono/node-server";
import { createServer as createNetServer } from "node:net";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";
import path from "node:path";

export interface ServerOptions {
  /** ビルド済み Web フロント（index.html + assets）のディレクトリ */
  webDist: string;
  /** drizzle マイグレーション（*.sql + meta/）のディレクトリ */
  migrationsFolder: string;
  /** SQLite ファイルの絶対パス */
  dbPath: string;
  /** 領収書画像の保存先ディレクトリ */
  uploadDir: string;
  /** Better Auth 用の秘密鍵（端末ごとに永続化したもの） */
  authSecret: string;
  /** 希望ポート（使用中なら空きポートにフォールバック） */
  preferredPort: number;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json",
  ico: "image/x-icon",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
};

function mimeFor(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** OS にポートの空きを問い合わせる。preferred が空いていればそれを返す。 */
function resolvePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const tryListen = (port: number, allowFallback: boolean) => {
      const srv = createNetServer();
      srv.once("error", () => {
        srv.close();
        if (allowFallback) tryListen(0, false);
        else resolve(preferred);
      });
      srv.listen({ port, host: "127.0.0.1" }, () => {
        const assigned = (srv.address() as { port: number }).port;
        srv.close(() => resolve(assigned));
      });
    };
    tryListen(preferred, true);
  });
}

/** webDist 配下の静的ファイルを返す（SPA フォールバックで index.html）。 */
async function serveStatic(webDist: string, pathname: string): Promise<Response> {
  const indexPath = path.join(webDist, "index.html");

  const clean = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replaceAll("..", "");
  const candidate = clean ? path.join(webDist, clean) : indexPath;

  try {
    const data = await fs.readFile(candidate);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": mimeFor(candidate) },
    });
  } catch {
    // 見つからなければ SPA のエントリへフォールバック
    try {
      const html = await fs.readFile(indexPath);
      return new Response(new Uint8Array(html), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("Web build output not found.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const port = await resolvePort(opts.preferredPort);
  const url = `http://127.0.0.1:${port}`;

  // ── 1) 環境変数を確定（@template/web を import する前に必ず実施） ──
  process.env.NODE_ENV = "production";
  process.env.PORT = String(port);
  process.env.WEBSITE_URL = url;
  process.env.ALLOWED_ORIGINS = `${url},http://localhost:${port}`;
  process.env.DATABASE_URL = `file:${opts.dbPath}`;
  process.env.UPLOAD_DIR = opts.uploadDir;
  process.env.BETTER_AUTH_SECRET = opts.authSecret;

  await fs.mkdir(opts.uploadDir, { recursive: true });

  // ── 2) マイグレーション（テーブル作成。初回起動で実行、以降は冪等） ──
  const migClient = createClient({ url: process.env.DATABASE_URL });
  try {
    await migrate(drizzle(migClient), {
      migrationsFolder: opts.migrationsFolder,
    });
  } finally {
    migClient.close();
  }

  // ── 3) Hono アプリを読み込み（env 確定後の動的 import が必須） ──
  const { default: app } = await import("@template/web");

  // ── 4) API は Hono、その他は静的ファイルとして配信 ──
  const server = serve({
    port,
    hostname: "127.0.0.1",
    fetch: (request: Request) => {
      const u = new URL(request.url);
      if (u.pathname.startsWith("/api")) {
        return app.fetch(request);
      }
      return serveStatic(opts.webDist, u.pathname);
    },
  });

  return {
    port,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
