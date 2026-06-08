import { describe, it, expect } from "vitest"
import {
  saveReceipt,
  readReceipt,
  isAllowedReceiptType,
  contentTypeForKey,
} from "../lib/storage"

describe("storage", () => {
  it("対応MIMEを判定する", () => {
    expect(isAllowedReceiptType("image/jpeg")).toBe(true)
    expect(isAllowedReceiptType("image/png")).toBe(true)
    expect(isAllowedReceiptType("application/pdf")).toBe(true)
    expect(isAllowedReceiptType("text/html")).toBe(false)
  })

  it("保存→読み出しのラウンドトリップ", async () => {
    const bytes = new TextEncoder().encode("fake-image-bytes")
    const key = await saveReceipt(bytes, "image/png")
    expect(key.endsWith(".png")).toBe(true)

    const read = await readReceipt(key)
    expect(read).not.toBeNull()
    expect(read!.contentType).toBe("image/png")
    expect(new Uint8Array(read!.bytes)).toEqual(bytes)
  })

  it("存在しないキーはnull", async () => {
    expect(await readReceipt("does-not-exist.png")).toBeNull()
  })

  it("パストラバーサルはnull", async () => {
    expect(await readReceipt("../../etc/passwd")).toBeNull()
    expect(await readReceipt("sub/dir.png")).toBeNull()
  })

  it("キーからContent-Typeを推定", () => {
    expect(contentTypeForKey("a.jpg")).toBe("image/jpeg")
    expect(contentTypeForKey("a.pdf")).toBe("application/pdf")
    expect(contentTypeForKey("a.bin")).toBe("application/octet-stream")
  })
})
