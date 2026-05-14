import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { eq, sql } from "drizzle-orm"
import { db } from "./database"
import * as schema from "./database/schema"

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
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ["*"],
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: true },
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
