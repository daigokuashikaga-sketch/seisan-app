import type { Context } from "hono"
import type { ZodType } from "zod"

type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; res: Response }

// JSONボディを zod スキーマで検証。失敗時は 400 + issues を返す。
export async function parseBody<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<ParseResult<T>> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    return { ok: false, res: c.json({ message: "JSONボディが不正です" }, 400) }
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    return {
      ok: false,
      res: c.json(
        { message: "入力値が不正です", issues: result.error.issues },
        400,
      ),
    }
  }
  return { ok: true, data: result.data }
}

// クエリパラメータを zod スキーマで検証。
export function parseQuery<T>(c: Context, schema: ZodType<T>): ParseResult<T> {
  const result = schema.safeParse(c.req.query())
  if (!result.success) {
    return {
      ok: false,
      res: c.json(
        { message: "クエリが不正です", issues: result.error.issues },
        400,
      ),
    }
  }
  return { ok: true, data: result.data }
}
