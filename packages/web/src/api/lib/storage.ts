import { nanoid } from "nanoid"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mkdir, writeFile, readFile, access } from "node:fs/promises"

// 領収書画像のローカルファイル保存・読み出し（Node/Bun どちらでも動作）。
// 保存先は UPLOAD_DIR（未設定時はリポジトリ直下の uploads/）。

const here = path.dirname(fileURLToPath(import.meta.url)) // .../packages/web/src/api/lib
const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? path.resolve(here, "../../../../../uploads")

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024 // 5MB

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
}

export function isAllowedReceiptType(contentType: string): boolean {
  return contentType in MIME_EXT
}

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? ""
  return EXT_MIME[ext] ?? "application/octet-stream"
}

// 画像バイト列を保存し、参照キー（ファイル名）を返す。
export async function saveReceipt(
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const ext = MIME_EXT[contentType]
  if (!ext) throw new Error(`未対応のContent-Type: ${contentType}`)
  await mkdir(UPLOAD_DIR, { recursive: true })
  const key = `${nanoid()}.${ext}`
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  await writeFile(path.join(UPLOAD_DIR, key), data)
  return key
}

// 参照キーから画像を読み出す。存在しなければ null。
export async function readReceipt(
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  // パストラバーサル防止: キーはファイル名のみを許可
  if (key.includes("/") || key.includes("..") || key.includes("\\")) return null
  const filePath = path.join(UPLOAD_DIR, key)
  try {
    await access(filePath)
  } catch {
    return null
  }
  const buf = await readFile(filePath)
  return { bytes: new Uint8Array(buf), contentType: contentTypeForKey(key) }
}
