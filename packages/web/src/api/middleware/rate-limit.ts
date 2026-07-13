import type { MiddlewareHandler } from "hono"

// シンプルなインメモリ・レート制限（固定ウィンドウ方式）。
// 単一プロセス運用（スタンドアロン / 単一コンテナ）を想定。複数レプリカ構成では
// Redis 等の共有ストアに置き換えること。
//
// クライアント識別の方針（重要 / セキュリティ）:
//   X-Forwarded-For はクライアントが自由に詐称できるため、既定では信頼しない。
//   信頼できるリバースプロキシ配下で運用する場合のみ、環境変数 TRUST_PROXY=1 を
//   設定すると XFF の先頭IPでクライアントを識別する（proxy が正しく設定する前提）。
//   TRUST_PROXY 未設定時は識別子を持てないため単一バケットに集約する
//   （＝グローバル制限。スタンドアロンでは全リクエストが同一ユーザーなので適切。
//     直接公開する多人数サーバーでは必ず proxy + TRUST_PROXY を設定すること）。

const TRUST_PROXY = () =>
  process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true"

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

function clientKey(c: Parameters<MiddlewareHandler>[0]): string {
  if (TRUST_PROXY()) {
    const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    if (xff) return xff
    const real = c.req.header("x-real-ip")
    if (real) return real
  }
  // 信頼できる送信元情報が無い場合は詐称可能なヘッダに頼らずグローバル集約する
  return "global"
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>()

  return async (c, next) => {
    // テスト実行時は無効化（既存テストが認証エンドポイントを繰り返し叩くため）
    if (process.env.NODE_ENV === "test") return next()
    if (opts.methods && !opts.methods.includes(c.req.method)) return next()

    const now = Date.now()

    // 期限切れバケットを掃除（メモリ肥大防止。O(n)だが上限到達時のみ）
    if (buckets.size > 2000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k)
      }
    }

    const key = `${opts.keyPrefix ?? ""}:${clientKey(c)}`

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
