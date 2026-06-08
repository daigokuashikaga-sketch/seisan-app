import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, makeApp, createUser, json, type TestUser } from "./helpers"

describe("invitations routes", () => {
  let admin: TestUser
  let member: TestUser

  beforeEach(async () => {
    await resetDb()
    admin = await createUser({ role: "admin", name: "admin" })
    member = await createUser({ role: "member", name: "member" })
  })

  it("招待発行はadminのみ・リンクを返す", async () => {
    expect((await makeApp(member).request("/api/invitations", json({ email: "x@example.com" }))).status).toBe(403)

    const res = await makeApp(admin).request("/api/invitations", json({ email: "new@example.com", role: "member" }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.invitation.email).toBe("new@example.com")
    expect(data.invitation.code).toBeTruthy()
    expect(data.link).toContain(data.invitation.code)
  })

  it("不正なメールは400", async () => {
    const res = await makeApp(admin).request("/api/invitations", json({ email: "not-an-email" }))
    expect(res.status).toBe(400)
  })

  it("一覧取得と取消", async () => {
    const created = await (await makeApp(admin).request("/api/invitations", json({ email: "a@example.com" }))).json()
    const list = await (await makeApp(admin).request("/api/invitations")).json()
    expect(list.invitations).toHaveLength(1)

    const del = await makeApp(admin).request(`/api/invitations/${created.invitation.id}`, { method: "DELETE" })
    expect(del.status).toBe(200)
    expect((await makeApp(admin).request(`/api/invitations/nope`, { method: "DELETE" })).status).toBe(404)
  })
})
