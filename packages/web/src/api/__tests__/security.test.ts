import { describe, it, expect, afterEach } from "vitest"
import { Hono } from "hono"
import { rateLimit } from "../middleware/rate-limit"

// rateLimit は NODE_ENV=test で無効化されるため、テスト内で一時的に切り替える
const ORIGINAL_ENV = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV
})

function makeLimitedApp(opts: Parameters<typeof rateLimit>[0]) {
  const app = new Hono()
  app.use("/auth/*", rateLimit(opts))
  app.post("/auth/sign-in", (c) => c.json({ ok: true }, 200))
  app.get("/auth/session", (c) => c.json({ ok: true }, 200))
  return app
}

describe("rateLimit middleware", () => {
  it("上限以内のリクエストは通す", async () => {
    process.env.NODE_ENV = "development"
    const app = makeLimitedApp({ windowMs: 60_000, max: 3, methods: ["POST"] })
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/auth/sign-in", { method: "POST" })
      expect(res.status).toBe(200)
    }
  })

  it("上限を超えると429とRetry-Afterを返す", async () => {
    process.env.NODE_ENV = "development"
    const app = makeLimitedApp({ windowMs: 60_000, max: 3, methods: ["POST"] })
    for (let i = 0; i < 3; i++) {
      await app.request("/auth/sign-in", { method: "POST" })
    }
    const res = await app.request("/auth/sign-in", { method: "POST" })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
    const body = await res.json()
    expect(body.message).toContain("リクエストが多すぎます")
  })

  it("対象外メソッド(GET)は制限しない", async () => {
    process.env.NODE_ENV = "development"
    const app = makeLimitedApp({ windowMs: 60_000, max: 1, methods: ["POST"] })
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/auth/session")
      expect(res.status).toBe(200)
    }
  })

  it("既定では x-forwarded-for を信頼せずグローバル集約する（詐称でのバイパス不可）", async () => {
    process.env.NODE_ENV = "development"
    delete process.env.TRUST_PROXY
    const app = makeLimitedApp({ windowMs: 60_000, max: 1, methods: ["POST"] })
    const a1 = await app.request("/auth/sign-in", { method: "POST", headers: { "x-forwarded-for": "10.0.0.1" } })
    // XFFを変えても同一バケット → 2回目はブロック（詐称による回避を防ぐ）
    const a2 = await app.request("/auth/sign-in", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" } })
    expect(a1.status).toBe(200)
    expect(a2.status).toBe(429)
  })

  it("TRUST_PROXY=1 のときのみ x-forwarded-for でクライアントを分離する", async () => {
    process.env.NODE_ENV = "development"
    process.env.TRUST_PROXY = "1"
    const app = makeLimitedApp({ windowMs: 60_000, max: 1, methods: ["POST"] })
    const a1 = await app.request("/auth/sign-in", { method: "POST", headers: { "x-forwarded-for": "10.0.0.1" } })
    const a2 = await app.request("/auth/sign-in", { method: "POST", headers: { "x-forwarded-for": "10.0.0.1" } })
    const b1 = await app.request("/auth/sign-in", { method: "POST", headers: { "x-forwarded-for": "10.0.0.2" } })
    expect(a1.status).toBe(200)
    expect(a2.status).toBe(429)
    expect(b1.status).toBe(200)
    delete process.env.TRUST_PROXY
  })

  it("ウィンドウが過ぎるとカウントがリセットされる", async () => {
    process.env.NODE_ENV = "development"
    const app = makeLimitedApp({ windowMs: 50, max: 1, methods: ["POST"] })
    const r1 = await app.request("/auth/sign-in", { method: "POST" })
    const r2 = await app.request("/auth/sign-in", { method: "POST" })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(429)
    await new Promise((r) => setTimeout(r, 80))
    const r3 = await app.request("/auth/sign-in", { method: "POST" })
    expect(r3.status).toBe(200)
  })

  it("NODE_ENV=test では無効化される", async () => {
    process.env.NODE_ENV = "test"
    const app = makeLimitedApp({ windowMs: 60_000, max: 1, methods: ["POST"] })
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/auth/sign-in", { method: "POST" })
      expect(res.status).toBe(200)
    }
  })
})

describe("メインアプリのセキュリティヘッダ", () => {
  it("APIレスポンスに secure headers が付与される", async () => {
    const { default: app } = await import("../index")
    const res = await app.request("/api/health")
    expect(res.status).toBe(200)
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN")
  })
})
