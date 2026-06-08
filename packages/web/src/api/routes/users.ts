import { Hono } from "hono"
import { eq, and, ne, count } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAuth, requireAdmin } from "../middleware/auth"
import { parseBody } from "../validation/parse"
import { updateRoleSchema } from "../validation/schemas"

// 自分以外の管理者が存在するか（最後の管理者ロックアウト防止）
async function hasOtherAdmin(excludeId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), ne(schema.users.id, excludeId)))
  return (row?.n ?? 0) > 0
}

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
    const me = c.get("user")!
    const { id } = c.req.param()
    const parsed = await parseBody(c, updateRoleSchema)
    if (!parsed.ok) return parsed.res
    const { role } = parsed.data

    // 降格時のガード: 自分自身の降格・最後の管理者の降格を防ぐ
    if (role === "member") {
      if (id === me.id) {
        return c.json({ message: "自分自身を降格することはできません" }, 409)
      }
      if (!(await hasOtherAdmin(id))) {
        return c.json({ message: "最後の管理者を降格することはできません" }, 409)
      }
    }

    const [user] = await db.update(schema.users)
      .set({ role })
      .where(eq(schema.users.id, id))
      .returning()
    if (!user) return c.json({ message: "ユーザーが見つかりません" }, 404)
    return c.json({ user }, 200)
  })
  // メンバー削除（管理者のみ）
  .delete("/:id", requireAdmin, async (c) => {
    const me = c.get("user")!
    const { id } = c.req.param()

    if (id === me.id) {
      return c.json({ message: "自分自身を削除することはできません" }, 409)
    }
    // 対象が管理者で、他に管理者がいない場合は削除不可
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id))
    if (!target) return c.json({ message: "ユーザーが見つかりません" }, 404)
    if (target.role === "admin" && !(await hasOtherAdmin(id))) {
      return c.json({ message: "最後の管理者を削除することはできません" }, 409)
    }

    await db.delete(schema.users).where(eq(schema.users.id, id))
    return c.json({ ok: true }, 200)
  })
  // 自分のプロフィール
  .get("/me", requireAuth, async (c) => {
    const user = c.get("user")!
    return c.json({ user }, 200)
  })
