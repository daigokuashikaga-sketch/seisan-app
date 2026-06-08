import { z } from "zod"
import {
  CATEGORIES,
  EXPENSE_STATUSES,
  USER_ROLES,
} from "../../shared/constants"

// ──────────────────────────────────────────────
// リクエストボディ / クエリのバリデーションスキーマ
// ──────────────────────────────────────────────

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で指定してください")

export const createExpenseSchema = z.object({
  title: z.string().trim().min(1, "件名は必須です").max(200),
  amount: z.number().int().positive("金額は正の整数で指定してください"),
  date: dateString,
  category: z.enum(CATEGORIES),
  note: z.string().max(1000).nullish(),
  receiptImageKey: z.string().max(200).nullish(),
})
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>

export const updateStatusSchema = z.object({
  status: z.enum(EXPENSE_STATUSES),
  rejectionReason: z.string().trim().max(500).nullish(),
})

export const updateRoleSchema = z.object({
  role: z.enum(USER_ROLES),
})

export const createInvitationSchema = z.object({
  email: z.string().trim().email("有効なメールアドレスを指定してください"),
  role: z.enum(USER_ROLES).default("member"),
})

export const settingsValueSchema = z.object({
  value: z.union([z.string(), z.number()]).transform((v) => String(v)),
})

export const settingsPatchSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))

export const budgetSchema = z
  .number()
  .int()
  .min(0, "予算は0以上の整数で指定してください")

export const expenseQuerySchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  month: z
    .string()
    .regex(/^\d{1,2}$/)
    .optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  submitterId: z.string().optional(),
})
