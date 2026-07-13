import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, makeApp, createUser, json, type TestUser } from "./helpers"

describe("users routes", () => {
  let admin: TestUser
  let member: TestUser

  beforeEach(async () => {
    await resetDb()
    admin = await createUser({ role: "admin", name: "admin" })
    member = await createUser({ role: "member", name: "member" })
  })

  it("一覧はadminのみ", async () => {
    expect((await makeApp(member).request("/api/users")).status).toBe(403)
    const res = await makeApp(admin).request("/api/users")
    expect(res.status).toBe(200)
    expect((await res.json()).users.length).toBe(2)
  })

  it("ロール変更・削除はadminのみ（memberは403）", async () => {
    expect((await makeApp(member).request(`/api/users/${member.id}/role`, { ...json({ role: "admin" }), method: "PATCH" })).status).toBe(403)
    expect((await makeApp(member).request(`/api/users/${admin.id}`, { method: "DELETE" })).status).toBe(403)
  })

  it("不正なロールは400", async () => {
    const res = await makeApp(admin).request(`/api/users/${member.id}/role`, { ...json({ role: "superuser" }), method: "PATCH" })
    expect(res.status).toBe(400)
  })

  it("自分自身の降格は409", async () => {
    const res = await makeApp(admin).request(`/api/users/${admin.id}/role`, { ...json({ role: "member" }), method: "PATCH" })
    expect(res.status).toBe(409)
  })

  it("他に管理者がいれば別の管理者を降格できる", async () => {
    const admin2 = await createUser({ role: "admin", name: "admin2" })
    const res = await makeApp(admin).request(`/api/users/${admin2.id}/role`, { ...json({ role: "member" }), method: "PATCH" })
    expect(res.status).toBe(200)
    expect((await res.json()).user.role).toBe("member")
  })

  it("メンバーを管理者に昇格できる", async () => {
    const res = await makeApp(admin).request(`/api/users/${member.id}/role`, { ...json({ role: "admin" }), method: "PATCH" })
    expect(res.status).toBe(200)
    expect((await res.json()).user.role).toBe("admin")
  })

  it("自分自身の削除は409", async () => {
    const res = await makeApp(admin).request(`/api/users/${admin.id}`, { method: "DELETE" })
    expect(res.status).toBe(409)
  })

  it("メンバーは削除できる、存在しないユーザーは404", async () => {
    expect((await makeApp(admin).request(`/api/users/${member.id}`, { method: "DELETE" })).status).toBe(200)
    expect((await makeApp(admin).request(`/api/users/nope`, { method: "DELETE" })).status).toBe(404)
  })
})
