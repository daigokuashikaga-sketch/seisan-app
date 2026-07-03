// ローカルデータのバックアップ（スタンドアロンモード用）。
// SQLite の VACUUM INTO で整合性のあるスナップショットを作成し、
// 領収書ディレクトリを丸ごとコピーする。
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// DB を開いたまま安全に複製する。VACUUM INTO が使えない環境では
// ファイルコピー（-wal/-shm 含む）にフォールバックする。
export async function backupDatabase(srcDbPath: string, destDbPath: string): Promise<void> {
  try {
    const client = createClient({ url: `file:${srcDbPath}` });
    try {
      // VACUUM INTO は移動先が既存だと失敗するため先に消しておく
      await fs.rm(destDbPath, { force: true });
      const escaped = destDbPath.replaceAll("'", "''");
      await client.execute(`VACUUM INTO '${escaped}'`);
      return;
    } finally {
      client.close();
    }
  } catch (e) {
    console.warn("VACUUM INTO failed; falling back to file copy:", e);
  }

  await fs.copyFile(srcDbPath, destDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const extra = `${srcDbPath}${suffix}`;
    if (existsSync(extra)) {
      await fs.copyFile(extra, `${destDbPath}${suffix}`);
    }
  }
}

export interface BackupResult {
  /** バックアップ一式を書き出したディレクトリ */
  dir: string;
}

// DB + 領収書画像を destRoot/Seisan-backup-<stamp>/ にまとめて書き出す。
export async function backupAll(
  dbPath: string,
  uploadDir: string,
  destRoot: string,
): Promise<BackupResult> {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const dir = path.join(destRoot, `Seisan-backup-${stamp}`);
  await fs.mkdir(dir, { recursive: true });

  await backupDatabase(dbPath, path.join(dir, "seisan.db"));

  if (existsSync(uploadDir)) {
    await fs.cp(uploadDir, path.join(dir, "uploads"), { recursive: true });
  }

  const readme = [
    "Seisan データバックアップ",
    "",
    `作成日時: ${d.toLocaleString("ja-JP")}`,
    "",
    "【復元方法】",
    "1. Seisan を終了する",
    "2. このフォルダの seisan.db と uploads/ を、アプリのデータフォルダに上書きコピーする",
    "   （データフォルダ: %APPDATA%\\Seisan ／ Macは ~/Library/Application Support/Seisan）",
    "3. Seisan を起動する",
    "",
  ].join("\n");
  await fs.writeFile(path.join(dir, "README.txt"), readme, "utf-8");

  return { dir };
}
