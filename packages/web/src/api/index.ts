import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth, handleSignup } from "./auth"
import { authMiddleware } from "./middleware/auth"
import { isOriginAllowed } from "./lib/origins"
import { expenses } from "./routes/expenses"
import { settings } from "./routes/settings"
import { users } from "./routes/users"
import { invitations } from "./routes/invitations"

const app = new Hono()
  .use(cors({ origin: (origin) => (isOriginAllowed(origin) ? origin : null), credentials: true }))
  // 招待制サインアップのゲート（catch-all より先に登録）
  .on("POST", "/api/auth/sign-up/email", (c) => handleSignup(c.req.raw))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  .basePath("api")
  .use("*", authMiddleware)
  .get("/ping", (c) => c.json({ message: `Pong! ${Date.now()}` }, 200))
  .get("/health", (c) => c.json({ status: "ok" }, 200))
  .route("/expenses", expenses)
  .route("/settings", settings)
  .route("/users", users)
  .route("/invitations", invitations)

// 未処理エラーをサーバクラッシュではなく 500 JSON として返す
app.onError((err, c) => {
  console.error("API error:", err)
  return c.json({ message: "サーバーエラーが発生しました" }, 500)
})

export type AppType = typeof app
export default app
