import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAdmin } from "../middleware/auth"
import { sendPasswordResetEmail } from "../lib/mailer"

// Better Auth互換のscryptハッシュ
async function hashPasswordBetterAuth(password: string): Promise<string> {
  const { scryptAsync } = await import("@noble/hashes/scrypt")
  const { hex } = await import("@noble/hashes/utils")
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, "0")).join("")
  const key = await scryptAsync(password.normalize("NFKC"), salt, {
    N: 16384, r: 16, p: 1, dkLen: 64, maxmem: 128 * 16384 * 16 * 2
  })
  return `${salt}:${Array.from(key).map(b => b.toString(16).padStart(2, "0")).join("")}`
}

export const password = new Hono()

  // 管理者がユーザーのパスワードを直接変更
  .patch("/admin-reset/:userId", requireAdmin, async (c) => {
    const { userId } = c.req.param()
    const { newPassword } = await c.req.json()

    if (!newPassword || newPassword.length < 8) {
      return c.json({ error: "パスワードは8文字以上必要です" }, 400)
    }

    try {
      const hashed = await hashPasswordBetterAuth(newPassword)
      await db.update(schema.accounts)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(schema.accounts.userId, userId))
      return c.json({ ok: true }, 200)
    } catch (err) {
      console.error(err)
      return c.json({ error: "パスワード変更に失敗しました" }, 500)
    }
  })

  // メールでリセットリンクを送信
  .post("/send-reset-email", async (c) => {
    const { email } = await c.req.json()
    if (!email) return c.json({ error: "メールアドレスが必要です" }, 400)

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      return c.json({ error: "メール送信が設定されていません。管理者にお問い合わせください。" }, 503)
    }

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))

    if (user) {
      const token = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      // 既存トークンを削除してから新規作成
      await db.delete(schema.verifications)
        .where(eq(schema.verifications.identifier, `password-reset:${email}`))
      await db.insert(schema.verifications).values({
        id: crypto.randomUUID(),
        identifier: `password-reset:${email}`,
        value: token,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const baseUrl = process.env.WEBSITE_URL ?? "http://localhost:4200"
      const resetUrl = `${baseUrl}/?reset_token=${token}&email=${encodeURIComponent(email)}`

      try {
        await sendPasswordResetEmail(email, user.name, resetUrl)
      } catch (err) {
        console.error("メール送信失敗:", err)
        return c.json({ error: "メール送信に失敗しました" }, 500)
      }
    }

    return c.json({ ok: true, message: "リセットメールを送信しました（登録済みの場合）" }, 200)
  })

  // トークンでパスワードをリセット
  .post("/reset-with-token", async (c) => {
    const { email, token, newPassword } = await c.req.json()

    if (!newPassword || newPassword.length < 8) {
      return c.json({ error: "パスワードは8文字以上必要です" }, 400)
    }

    const [verification] = await db.select().from(schema.verifications)
      .where(eq(schema.verifications.identifier, `password-reset:${email}`))

    if (!verification || verification.value !== token) {
      return c.json({ error: "無効または期限切れのリセットリンクです" }, 400)
    }
    if (new Date() > verification.expiresAt) {
      await db.delete(schema.verifications).where(eq(schema.verifications.id, verification.id))
      return c.json({ error: "リセットリンクの有効期限が切れています" }, 400)
    }

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    if (!user) return c.json({ error: "ユーザーが見つかりません" }, 404)

    try {
      const hashed = await hashPasswordBetterAuth(newPassword)
      await db.update(schema.accounts)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(schema.accounts.userId, user.id))
      await db.delete(schema.verifications).where(eq(schema.verifications.id, verification.id))
      return c.json({ ok: true }, 200)
    } catch (err) {
      console.error(err)
      return c.json({ error: "パスワードリセットに失敗しました" }, 500)
    }
  })
