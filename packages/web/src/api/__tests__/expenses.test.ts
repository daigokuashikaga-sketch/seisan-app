import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, makeApp, createUser, createExpense, json, type TestUser } from "./helpers"

describe("expenses routes", () => {
  let member: TestUser
  let other: TestUser
  let admin: TestUser

  beforeEach(async () => {
    await resetDb()
    member = await createUser({ role: "member", name: "member" })
    other = await createUser({ role: "member", name: "other" })
    admin = await createUser({ role: "admin", name: "admin" })
  })

  it("認証なしは401", async () => {
    const app = makeApp(null)
    const res = await app.request("/api/expenses")
    expect(res.status).toBe(401)
  })

  it("不正なボディは400（金額が負・日付不正・カテゴリ外）", async () => {
    const app = makeApp(member)
    for (const body of [
      { title: "x", amount: -100, date: "2026-06-01", category: "その他" },
      { title: "x", amount: 100, date: "2026/06/01", category: "その他" },
      { title: "x", amount: 100, date: "2026-06-01", category: "未知" },
      { title: "", amount: 100, date: "2026-06-01", category: "その他" },
    ]) {
      const res = await app.request("/api/expenses", json(body))
      expect(res.status).toBe(400)
    }
  })

  it("正常な申請は201で作成される", async () => {
    const app = makeApp(member)
    const res = await app.request(
      "/api/expenses",
      json({ title: "会議費", amount: 3500, date: "2026-06-01", category: "食品・飲料" }),
    )
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.expense.status).toBe("pending")
    expect(data.expense.submitterId).toBe(member.id)
  })

  it("memberは他人の申請を取得できない（submitterId改竄も無効）", async () => {
    await createExpense(member, { title: "mine" })
    await createExpense(other, { title: "theirs" })

    const app = makeApp(member)
    const res = await app.request(`/api/expenses?submitterId=${other.id}`)
    const data = await res.json()
    expect(data.expenses).toHaveLength(1)
    expect(data.expenses[0].submitterName).toBe("member")
  })

  it("adminは全件取得できる", async () => {
    await createExpense(member)
    await createExpense(other)
    const app = makeApp(admin)
    const res = await app.request("/api/expenses")
    const data = await res.json()
    expect(data.expenses).toHaveLength(2)
  })

  it("年月・ステータスでフィルタできる", async () => {
    await createExpense(member, { date: "2026-06-10", status: "approved" })
    await createExpense(member, { date: "2026-07-10", status: "pending" })
    const app = makeApp(member)

    const june = await (await app.request("/api/expenses?year=2026&month=6")).json()
    expect(june.expenses).toHaveLength(1)
    expect(june.expenses[0].date).toBe("2026-06-10")

    const approved = await (await app.request("/api/expenses?status=approved")).json()
    expect(approved.expenses).toHaveLength(1)
    expect(approved.expenses[0].status).toBe("approved")
  })

  it("ステータス変更はadminのみ・却下理由を保存", async () => {
    const id = await createExpense(member)

    const asMember = makeApp(member)
    expect((await asMember.request(`/api/expenses/${id}/status`, { ...json({ status: "approved" }), method: "PATCH" })).status).toBe(403)

    const asAdmin = makeApp(admin)
    const bad = await asAdmin.request(`/api/expenses/${id}/status`, { ...json({ status: "bogus" }), method: "PATCH" })
    expect(bad.status).toBe(400)

    const rej = await asAdmin.request(`/api/expenses/${id}/status`, { ...json({ status: "rejected", rejectionReason: "領収書不備" }), method: "PATCH" })
    expect(rej.status).toBe(200)
    const data = await rej.json()
    expect(data.expense.status).toBe("rejected")
    expect(data.expense.rejectionReason).toBe("領収書不備")
  })

  it("存在しない申請の更新・削除は404", async () => {
    const app = makeApp(admin)
    expect((await app.request(`/api/expenses/nope/status`, { ...json({ status: "approved" }), method: "PATCH" })).status).toBe(404)
    expect((await app.request(`/api/expenses/nope`, { method: "DELETE" })).status).toBe(404)
  })

  it("領収書: アップロード→本人/管理者は閲覧可・他人は403", async () => {
    // 1) memberが領収書をアップロード
    const fd = new FormData()
    fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "r.png", { type: "image/png" }))
    const up = await makeApp(member).request("/api/expenses/receipt", { method: "POST", body: fd })
    expect(up.status).toBe(201)
    const { key } = await up.json()
    expect(key).toBeTruthy()

    // 2) そのkeyで申請作成
    const created = await makeApp(member).request(
      "/api/expenses",
      json({ title: "領収書付き", amount: 500, date: "2026-06-01", category: "その他", receiptImageKey: key }),
    )
    const id = (await created.json()).expense.id

    // 3) 本人=200, 管理者=200, 他人=403
    expect((await makeApp(member).request(`/api/expenses/${id}/receipt`)).status).toBe(200)
    expect((await makeApp(admin).request(`/api/expenses/${id}/receipt`)).status).toBe(200)
    expect((await makeApp(other).request(`/api/expenses/${id}/receipt`)).status).toBe(403)
  })

  it("領収書: 非対応形式は400", async () => {
    const fd = new FormData()
    fd.append("file", new File(["<html>"], "x.html", { type: "text/html" }))
    const up = await makeApp(member).request("/api/expenses/receipt", { method: "POST", body: fd })
    expect(up.status).toBe(400)
  })
})
