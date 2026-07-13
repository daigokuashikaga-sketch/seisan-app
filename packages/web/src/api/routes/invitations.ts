import { Hono } from "hono"
import { eq, desc } from "drizzle-orm"
import { db } from "../database"
import * as schema from "../database/schema"
import { requireAdmin } from "../middleware/auth"
import { parseBody } from "../validation/parse"
import { createInvitationSchema } from "../validation/schemas"
import { INVITATION_TTL_MS } from "../../shared/constants"
import { nanoid } from "nanoid"

export const invitations = new Hono()
  // 招待一覧（管理者のみ）
  .get("/", requireAdmin, async (c) => {
    const rows = await db.select().from(schema.invitations).orderBy(desc(schema.invitations.createdAt))
    return c.json({ invitations: rows }, 200)
  })
  // 招待発行（管理者のみ）
  .post("/", requireAdmin, async (c) => {
    const me = c.get("user")!
    const parsed = await parseBody(c, createInvitationSchema)
    if (!parsed.ok) return parsed.res
    const { email, role } = parsed.data

    const code = nanoid(24)
    const [invitation] = await db.insert(schema.invitations).values({
      id: nanoid(),
      email: email.toLowerCase(),
      code,
      role,
      invitedBy: me.id,
      used: false,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    }).returning()

    const base = process.env.WEBSITE_URL ?? ""
    const link = `${base}/?invite=${code}`
    return c.json({ invitation, link }, 201)
  })
  // 招待取消（管理者のみ）
  .delete("/:id", requireAdmin, async (c) => {
    const { id } = c.req.param()
    const [deleted] = await db.delete(schema.invitations)
      .where(eq(schema.invitations.id, id))
      .returning()
    if (!deleted) return c.json({ message: "招待が見つかりません" }, 404)
    return c.json({ ok: true }, 200)
  })
