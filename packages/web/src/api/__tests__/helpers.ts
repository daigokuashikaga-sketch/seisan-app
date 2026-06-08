import { Hono } from "hono"
import { sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../database"
import * as schema from "../database/schema"
import { expenses } from "../routes/expenses"
import { users } from "../routes/users"
import { settings } from "../routes/settings"
import { invitations } from "../routes/invitations"

// インメモリDBにスキーマ相当のテーブルを作成（route テスト用の最小セット）
export async function resetDb() {
  await db.run(sql.raw(`DROP TABLE IF EXISTS expenses`))
  await db.run(sql.raw(`DROP TABLE IF EXISTS invitations`))
  await db.run(sql.raw(`DROP TABLE IF EXISTS settings`))
  await db.run(sql.raw(`DROP TABLE IF EXISTS users`))
  await db.run(sql.raw(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`))
  await db.run(sql.raw(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      amount INTEGER NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      submitter_id TEXT NOT NULL,
      submitter_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      ai_warning TEXT,
      rejection_reason TEXT,
      receipt_image_key TEXT,
      created_at INTEGER NOT NULL
    )`))
  await db.run(sql.raw(`CREATE TABLE settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL )`))
  await db.run(sql.raw(`
    CREATE TABLE invitations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by TEXT,
      used INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`))
}

export type TestUser = { id: string; name: string; email: string; role: "member" | "admin" }

// 認証済みユーザーを context に注入する形でルートをマウントした Hono アプリ
export function makeApp(user: TestUser | null) {
  const app = new Hono().basePath("api")
  app.use("*", async (c, next) => {
    c.set("user", (user as unknown as never) ?? null)
    c.set("session", null as unknown as never)
    await next()
  })
  app.route("/expenses", expenses)
  app.route("/users", users)
  app.route("/settings", settings)
  app.route("/invitations", invitations)
  return app
}

export async function createUser(
  data: Partial<TestUser> & { role?: "member" | "admin" } = {},
): Promise<TestUser> {
  const user = {
    id: data.id ?? nanoid(),
    name: data.name ?? "テスト太郎",
    email: data.email ?? `${nanoid(6)}@example.com`,
    role: data.role ?? ("member" as const),
  }
  await db.insert(schema.users).values({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  })
  return user
}

export async function createExpense(
  submitter: TestUser,
  data: Partial<{ title: string; amount: number; date: string; category: string; status: "pending" | "approved" | "rejected" }> = {},
) {
  const id = nanoid()
  await db.insert(schema.expenses).values({
    id,
    title: data.title ?? "テスト経費",
    amount: data.amount ?? 1000,
    date: data.date ?? "2026-06-01",
    category: data.category ?? "その他",
    submitterId: submitter.id,
    submitterName: submitter.name,
    status: data.status ?? "pending",
  })
  return id
}

export function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}
