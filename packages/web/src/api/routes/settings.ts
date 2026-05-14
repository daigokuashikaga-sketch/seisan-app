import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAuth, requireAdmin } from "../middleware/auth"

const DEFAULT_SETTINGS = { budget: "150000" }

export const settings = new Hono()
  .get("/", requireAuth, async (c) => {
    const rows = await db.select().from(schema.settings)
    const result: Record<string, string> = { ...DEFAULT_SETTINGS }
    for (const r of rows) result[r.key] = r.value
    return c.json({ settings: result }, 200)
  })
  .patch("/", requireAdmin, async (c) => {
    const body = await c.req.json() as Record<string, string>
    for (const [key, value] of Object.entries(body)) {
      await db.insert(schema.settings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(value) } })
    }
    return c.json({ ok: true }, 200)
  })
  // GET /settings/:key — 単一設定取得
  .get("/:key", requireAuth, async (c) => {
    const { key } = c.req.param()
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key))
    const value = row?.value ?? DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS] ?? null
    return c.json({ key, value }, 200)
  })
  // PUT /settings/:key — 単一設定更新（管理者のみ）
  .put("/:key", requireAdmin, async (c) => {
    const { key } = c.req.param()
    const { value } = await c.req.json()
    await db.insert(schema.settings)
      .values({ key, value: String(value) })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(value) } })
    return c.json({ key, value: String(value) }, 200)
  })
