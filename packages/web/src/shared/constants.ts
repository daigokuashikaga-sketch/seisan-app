// ──────────────────────────────────────────────
// フロント・バック共有の定数 / enum（ドリフト防止の単一ソース）
// ──────────────────────────────────────────────

export const CATEGORIES = [
  "食品・飲料",
  "装飾・備品",
  "印刷・コピー",
  "交通費",
  "通信費",
  "その他",
] as const
export type Category = (typeof CATEGORIES)[number]

export const EXPENSE_STATUSES = ["pending", "approved", "rejected"] as const
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]

export const USER_ROLES = ["member", "admin"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const DEFAULT_BUDGET = "150000"

// 招待リンクの既定有効期限（7日）
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
