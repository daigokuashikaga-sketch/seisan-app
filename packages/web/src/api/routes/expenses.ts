import { Hono } from "hono"
import { eq, and, gte, lte, desc } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAuth, requireAdmin } from "../middleware/auth"
import { nanoid } from "nanoid"

export const expenses = new Hono()
  // 一覧取得（月/年フィルター対応）
  .get("/", requireAuth, async (c) => {
    const user = c.get("user") as any
    const { month, year, status, submitterId } = c.req.query()

    let query = db.select().from(schema.expenses)

    const rows = await db.select().from(schema.expenses).orderBy(desc(schema.expenses.createdAt))

    const filtered = rows.filter(e => {
      if (status && e.status !== status) return false
      if (submitterId && e.submitterId !== submitterId) return false
      if (year && !e.date.startsWith(year)) return false
      if (month && year && e.date.slice(0, 7) !== `${year}-${month.padStart(2, "0")}`) return false
      // memberは自分の申請のみ
      if (user.role !== "admin" && e.submitterId !== user.id) return false
      return true
    })

    return c.json({ expenses: filtered }, 200)
  })

  // 申請作成
  .post("/", requireAuth, async (c) => {
    const user = c.get("user") as any
    const body = await c.req.json()

    // AI警告: 同タイトル・同額の申請が直近にあるか
    const existing = await db.select().from(schema.expenses)
      .where(eq(schema.expenses.submitterId, user.id))
    const duplicate = existing.find(e =>
      e.title === body.title && e.amount === body.amount && e.status !== "rejected"
    )

    const [expense] = await db.insert(schema.expenses).values({
      id: nanoid(),
      title: body.title,
      amount: Number(body.amount),
      date: body.date,
      category: body.category,
      submitterId: user.id,
      submitterName: user.name,
      status: "pending",
      note: body.note ?? null,
      receiptImageKey: body.receiptImageKey ?? null,
      aiWarning: duplicate ? `同名・同額に近い申請が既にあります（${duplicate.date}）。二重申請の可能性があります。` : null,
    }).returning()

    return c.json({ expense }, 201)
  })

  // ステータス変更（管理者のみ）
  .patch("/:id/status", requireAdmin, async (c) => {
    const { id } = c.req.param()
    const { status } = await c.req.json()

    const [expense] = await db.update(schema.expenses)
      .set({ status })
      .where(eq(schema.expenses.id, id))
      .returning()

    return c.json({ expense }, 200)
  })

  // 削除（管理者のみ）
  .delete("/:id", requireAdmin, async (c) => {
    const { id } = c.req.param()
    await db.delete(schema.expenses).where(eq(schema.expenses.id, id))
    return c.json({ ok: true }, 200)
  })

  // 集計（月別・年別）
  .get("/summary", requireAuth, async (c) => {
    const user = c.get("user") as any
    const rows = await db.select().from(schema.expenses)

    const relevant = user.role === "admin" ? rows : rows.filter(e => e.submitterId === user.id)

    // 月別集計
    const byMonth: Record<string, { total: number; approved: number; pending: number; count: number }> = {}
    for (const e of relevant) {
      const key = e.date.slice(0, 7) // YYYY-MM
      if (!byMonth[key]) byMonth[key] = { total: 0, approved: 0, pending: 0, count: 0 }
      byMonth[key].total += e.amount
      byMonth[key].count++
      if (e.status === "approved") byMonth[key].approved += e.amount
      if (e.status === "pending") byMonth[key].pending += e.amount
    }

    // 年別集計
    const byYear: Record<string, { total: number; approved: number; count: number }> = {}
    for (const e of relevant) {
      const key = e.date.slice(0, 4) // YYYY
      if (!byYear[key]) byYear[key] = { total: 0, approved: 0, count: 0 }
      byYear[key].total += e.amount
      byYear[key].count++
      if (e.status === "approved") byYear[key].approved += e.amount
    }

    return c.json({ byMonth, byYear }, 200)
  })
