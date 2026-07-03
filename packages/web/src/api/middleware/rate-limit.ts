import type { MiddlewareHandler } from "hono"

// シンプルなインメモリ・レート制限。
// 単一プロセス運用（スタンドアロン / 単一コンテナ）を想定した固定ウィンドウ方式。
// 複数レプリカ構成にする場合は Redis 等の共有ストアに置き換えること。
//
// クライアント識別: リバースプロキシ配下では x-forwarded-for の先頭、
// 直接続では取得できないため "local" に集約される（スタンドアロンでは
// 全リクエストが 127.0.0.1 のため実質グローバル制限として機能する）。

interface RateLimitOptions {
  /** ウィンドウ長（ミリ秒） */
  windowMs: number
  /** ウィンドウ内の最大リクエスト数 */
  max: number
  /** 制限対象のHTTPメソッド（省略時は全メソッド） */
  methods?: string[]
  /** バケットのキー接頭辞（用途別に分離する） */
  keyPrefix?: string
}

interface Bucket {
  count: number
  resetAt: number
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>()

  return async (c, next) => {
    // テスト実行時は無効化（既存テストが認証エンドポイントを繰り返し叩くため）
    if (process.env.NODE_ENV === "test") return next()
    if (opts.methods && !opts.methods.includes(c.req.method)) return next()

    const now = Date.now()

    // タイマーを持たない遅延クリーンアップ（メモリ肥大防止）
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k)
      }
    }

    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "local"
    const key = `${opts.keyPrefix ?? ""}:${ip}`

    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
      return next()
    }

    bucket.count++
    if (bucket.count > opts.max) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))))
      return c.json(
        { message: "リクエストが多すぎます。しばらく待ってからお試しください" },
        429,
      )
    }
    return next()
  }
}
