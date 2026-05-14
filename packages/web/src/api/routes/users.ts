import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAuth, requireAdmin } from "../middleware/auth"

export const users = new Hono()
  // メンバー一覧（管理者のみ）
  .get("/", requireAdmin, async (c) => {
    const rows = await db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    }).from(schema.users)
    return c.json({ users: rows }, 200)
  })
  // ロール変更（管理者のみ）
  .patch("/:id/role", requireAdmin, async (c) => {
    const { id } = c.req.param()
    const { role } = await c.req.json()
    const [user] = await db.update(schema.users)
      .set({ role })
      .where(eq(schema.users.id, id))
      .returning()
    return c.json({ user }, 200)
  })
  // メンバー削除（管理者のみ）
  .delete("/:id", requireAdmin, async (c) => {
    const { id } = c.req.param()
    await db.delete(schema.users).where(eq(schema.users.id, id))
    return c.json({ ok: true }, 200)
  })
  // 自分のプロフィール
  .get("/me", requireAuth, async (c) => {
    const user = c.get("user") as any
    return c.json({ user }, 200)
  })
