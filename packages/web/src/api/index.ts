import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth } from "./auth"
import { authMiddleware } from "./middleware/auth"
import { expenses } from "./routes/expenses"
import { settings } from "./routes/settings"
import { users } from "./routes/users"
import { password } from "./routes/password"

const app = new Hono()
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true }))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  .basePath("api")
  .use("*", authMiddleware)
  .get("/ping", (c) => c.json({ message: `Pong! ${Date.now()}` }, 200))
  .get("/health", (c) => c.json({ status: "ok" }, 200))
  .route("/expenses", expenses)
  .route("/settings", settings)
  .route("/users", users)
  .route("/password", password)

export type AppType = typeof app
export default app
