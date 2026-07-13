import { Hono } from "hono"
import { cors } from "hono/cors"
import { secureHeaders } from "hono/secure-headers"
import { bodyLimit } from "hono/body-limit"
import { auth, handleSignup } from "./auth"
import { authMiddleware } from "./middleware/auth"
import { rateLimit } from "./middleware/rate-limit"
import { isOriginAllowed } from "./lib/origins"
import { expenses } from "./routes/expenses"
import { settings } from "./routes/settings"
import { users } from "./routes/users"
import { invitations } from "./routes/invitations"
import { password } from "./routes/password"

// 認証エンドポイントのブルートフォース対策（1分あたり20回まで/クライアント）
const authRateLimit = rateLimit({ windowMs: 60_000, max: 20, methods: ["POST"], keyPrefix: "auth" })

const app = new Hono()
  .use(secureHeaders())
  .use(cors({ origin: (origin) => (isOriginAllowed(origin) ? origin : null), credentials: true }))
  // 領収書(最大5MB)+multipartのオーバーヘッドを見込んだ全体上限
  .use(bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json({ message: "リクエストサイズが大きすぎます" }, 413),
  }))
  .use("/api/auth/*", authRateLimit)
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
  .route("/password", password)

// 未処理エラーをサーバクラッシュではなく 500 JSON として返す
app.onError((err, c) => {
  console.error("API error:", err)
  return c.json({ message: "サーバーエラーが発生しました" }, 500)
})

export type AppType = typeof app
export default app
