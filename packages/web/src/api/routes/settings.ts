import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAuth, requireAdmin } from "../middleware/auth"
import { parseBody } from "../validation/parse"
import { settingsValueSchema, settingsPatchSchema, budgetSchema } from "../validation/schemas"
import { DEFAULT_BUDGET } from "../../shared/constants"

const DEFAULT_SETTINGS: Record<string, string> = { budget: DEFAULT_BUDGET }

// budget は非負整数を強制
function validateSetting(key: string, value: string): string | null {
  if (key === "budget") {
    const parsed = budgetSchema.safeParse(Number(value))
    if (!parsed.success) return "予算は0以上の整数で指定してください"
  }
  return null
}

async function upsertSetting(key: string, value: string) {
  await db.insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
}

export const settings = new Hono()
  .get("/", requireAuth, async (c) => {
    const rows = await db.select().from(schema.settings)
    const result: Record<string, string> = { ...DEFAULT_SETTINGS }
    for (const r of rows) result[r.key] = r.value
    return c.json({ settings: result }, 200)
  })
  .patch("/", requireAdmin, async (c) => {
    const parsed = await parseBody(c, settingsPatchSchema)
    if (!parsed.ok) return parsed.res
    for (const [key, raw] of Object.entries(parsed.data)) {
      const value = String(raw)
      const err = validateSetting(key, value)
      if (err) return c.json({ message: err }, 400)
      await upsertSetting(key, value)
    }
    return c.json({ ok: true }, 200)
  })
  // GET /settings/:key — 単一設定取得
  .get("/:key", requireAuth, async (c) => {
    const { key } = c.req.param()
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key))
    const value = row?.value ?? DEFAULT_SETTINGS[key] ?? null
    return c.json({ key, value }, 200)
  })
  // PUT /settings/:key — 単一設定更新（管理者のみ）
  .put("/:key", requireAdmin, async (c) => {
    const { key } = c.req.param()
    const parsed = await parseBody(c, settingsValueSchema)
    if (!parsed.ok) return parsed.res
    const value = parsed.data.value
    const err = validateSetting(key, value)
    if (err) return c.json({ message: err }, 400)
    await upsertSetting(key, value)
    return c.json({ key, value }, 200)
  })
