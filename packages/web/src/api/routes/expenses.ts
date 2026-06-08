import { Hono } from "hono"
import { eq, and, gte, lte, desc, type SQL } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAuth, requireAdmin } from "../middleware/auth"
import { nanoid } from "nanoid"
import { parseBody, parseQuery } from "../validation/parse"
import { createExpenseSchema, updateStatusSchema, expenseQuerySchema } from "../validation/schemas"
import { saveReceipt, readReceipt, isAllowedReceiptType, MAX_RECEIPT_BYTES } from "../lib/storage"

export const expenses = new Hono()
  // 一覧取得（月/年フィルター対応・SQLでフィルタ）
  .get("/", requireAuth, async (c) => {
    const user = c.get("user")!
    const parsed = parseQuery(c, expenseQuerySchema)
    if (!parsed.ok) return parsed.res
    const { month, year, status, submitterId } = parsed.data

    const conditions: SQL[] = []
    // memberは自分の申請のみ（クエリ改竄不可・SQLで強制）
    if (user.role !== "admin") {
      conditions.push(eq(schema.expenses.submitterId, user.id))
    } else if (submitterId) {
      conditions.push(eq(schema.expenses.submitterId, submitterId))
    }
    if (status) conditions.push(eq(schema.expenses.status, status))
    if (year) {
      if (month) {
        const mm = month.padStart(2, "0")
        conditions.push(gte(schema.expenses.date, `${year}-${mm}-01`))
        conditions.push(lte(schema.expenses.date, `${year}-${mm}-31`))
      } else {
        conditions.push(gte(schema.expenses.date, `${year}-01-01`))
        conditions.push(lte(schema.expenses.date, `${year}-12-31`))
      }
    }

    const filtered = await db
      .select()
      .from(schema.expenses)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.expenses.createdAt))

    return c.json({ expenses: filtered }, 200)
  })

  // 申請作成
  .post("/", requireAuth, async (c) => {
    const user = c.get("user")!
    const parsed = await parseBody(c, createExpenseSchema)
    if (!parsed.ok) return parsed.res
    const body = parsed.data

    // AI警告: 同タイトル・同額の申請が直近にあるか
    const existing = await db.select().from(schema.expenses)
      .where(eq(schema.expenses.submitterId, user.id))
    const duplicate = existing.find(e =>
      e.title === body.title && e.amount === body.amount && e.status !== "rejected"
    )

    const [expense] = await db.insert(schema.expenses).values({
      id: nanoid(),
      title: body.title,
      amount: body.amount,
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

  // 領収書画像アップロード（申請作成前に呼び、返却keyをreceiptImageKeyとして送る）
  .post("/receipt", requireAuth, async (c) => {
    const form = await c.req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return c.json({ message: "ファイルが指定されていません" }, 400)
    }
    if (!isAllowedReceiptType(file.type)) {
      return c.json({ message: "対応形式は JPEG / PNG / PDF です" }, 400)
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      return c.json({ message: "ファイルサイズは5MBまでです" }, 400)
    }
    const key = await saveReceipt(await file.arrayBuffer(), file.type)
    return c.json({ key }, 201)
  })

  // ステータス変更（管理者のみ）
  .patch("/:id/status", requireAdmin, async (c) => {
    const { id } = c.req.param()
    const parsed = await parseBody(c, updateStatusSchema)
    if (!parsed.ok) return parsed.res
    const { status, rejectionReason } = parsed.data

    const [expense] = await db.update(schema.expenses)
      .set({ status, rejectionReason: status === "rejected" ? (rejectionReason ?? null) : null })
      .where(eq(schema.expenses.id, id))
      .returning()

    if (!expense) return c.json({ message: "申請が見つかりません" }, 404)
    return c.json({ expense }, 200)
  })

  // 削除（管理者のみ）
  .delete("/:id", requireAdmin, async (c) => {
    const { id } = c.req.param()
    const [deleted] = await db.delete(schema.expenses)
      .where(eq(schema.expenses.id, id))
      .returning()
    if (!deleted) return c.json({ message: "申請が見つかりません" }, 404)
    return c.json({ ok: true }, 200)
  })

  // 領収書画像の取得（管理者 or 申請者本人のみ）
  .get("/:id/receipt", requireAuth, async (c) => {
    const user = c.get("user")!
    const { id } = c.req.param()
    const [expense] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id))
    if (!expense || !expense.receiptImageKey) {
      return c.json({ message: "領収書が見つかりません" }, 404)
    }
    if (user.role !== "admin" && expense.submitterId !== user.id) {
      return c.json({ message: "権限がありません" }, 403)
    }
    const receipt = await readReceipt(expense.receiptImageKey)
    if (!receipt) return c.json({ message: "領収書が見つかりません" }, 404)
    const ab = receipt.bytes.buffer.slice(
      receipt.bytes.byteOffset,
      receipt.bytes.byteOffset + receipt.bytes.byteLength,
    ) as ArrayBuffer
    return c.body(ab, 200, {
      "Content-Type": receipt.contentType,
      "Cache-Control": "private, max-age=3600",
    })
  })

  // 集計（月別・年別）
  .get("/summary", requireAuth, async (c) => {
    const user = c.get("user")!
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
