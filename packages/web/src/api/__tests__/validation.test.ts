import { describe, it, expect } from "vitest"
import {
  createExpenseSchema,
  updateStatusSchema,
  updateRoleSchema,
  createInvitationSchema,
} from "../validation/schemas"

describe("validation schemas", () => {
  it("createExpenseSchema は正常値を通す", () => {
    const r = createExpenseSchema.safeParse({
      title: "会議費", amount: 1000, date: "2026-06-01", category: "食品・飲料",
    })
    expect(r.success).toBe(true)
  })

  it("createExpenseSchema は不正値を弾く", () => {
    expect(createExpenseSchema.safeParse({ title: "x", amount: 0, date: "2026-06-01", category: "その他" }).success).toBe(false)
    expect(createExpenseSchema.safeParse({ title: "x", amount: 1.5, date: "2026-06-01", category: "その他" }).success).toBe(false)
    expect(createExpenseSchema.safeParse({ title: "x", amount: 10, date: "bad", category: "その他" }).success).toBe(false)
  })

  it("updateStatusSchema は enum のみ許可", () => {
    expect(updateStatusSchema.safeParse({ status: "approved" }).success).toBe(true)
    expect(updateStatusSchema.safeParse({ status: "done" }).success).toBe(false)
  })

  it("updateRoleSchema は member/admin のみ", () => {
    expect(updateRoleSchema.safeParse({ role: "admin" }).success).toBe(true)
    expect(updateRoleSchema.safeParse({ role: "root" }).success).toBe(false)
  })

  it("createInvitationSchema はメール必須・role既定member", () => {
    const r = createInvitationSchema.safeParse({ email: "a@example.com" })
    expect(r.success).toBe(true)
    expect(r.success && r.data.role).toBe("member")
    expect(createInvitationSchema.safeParse({ email: "nope" }).success).toBe(false)
  })
})
