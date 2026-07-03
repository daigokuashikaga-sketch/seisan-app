import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { eq, sql } from "drizzle-orm"
import { db } from "./database"
import * as schema from "./database/schema"
import { getAllowedOrigins } from "./lib/origins"

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: process.env.WEBSITE_URL,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: getAllowedOrigins(),
  user: {
    additionalFields: {
      // role はクライアントから設定不可（権限昇格防止）。サーバ側で付与する。
      role: { type: "string", defaultValue: "member", input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // 最初のユーザーを管理者に昇格
          const result = await db.select({ count: sql<number>`count(*)` }).from(schema.users)
          const count = result[0]?.count ?? 0
          if (Number(count) === 1) {
            await db.update(schema.users)
              .set({ role: "admin" })
              .where(eq(schema.users.id, user.id))
          }
        },
      },
    },
  },
})

// メール/パスワードのサインアップを招待制にゲートする。
// - ユーザーが0人なら誰でも登録可（初期管理者になる）。
// - それ以降は、有効な招待（未使用・未期限切れ・メール一致）が必須。
//   登録成功後に招待のロールを付与し、招待を used にする。
export async function handleSignup(raw: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await raw.clone().json()
  } catch {
    /* 不正ボディは better-auth 側のバリデーションに委ねる */
  }
  const email = String(body.email ?? "").toLowerCase()

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
  const userCount = Number(n ?? 0)

  if (userCount === 0) {
    return auth.handler(raw)
  }

  const code = String(body.inviteCode ?? "")
  const [invitation] = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.code, code))

  if (
    !invitation ||
    invitation.used ||
    invitation.expiresAt.getTime() < Date.now() ||
    invitation.email.toLowerCase() !== email
  ) {
    return Response.json(
      { message: "登録には有効な招待が必要です。管理者にお問い合わせください。" },
      { status: 403 },
    )
  }

  const res = await auth.handler(raw)
  if (res.ok) {
    const [created] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
    if (created) {
      await db
        .update(schema.users)
        .set({ role: invitation.role })
        .where(eq(schema.users.id, created.id))
      await db
        .update(schema.invitations)
        .set({ used: true })
        .where(eq(schema.invitations.id, invitation.id))
    }
  }
  return res
}
