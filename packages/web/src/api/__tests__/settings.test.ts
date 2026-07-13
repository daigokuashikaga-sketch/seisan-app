import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, makeApp, createUser, json, type TestUser } from "./helpers"

describe("settings routes", () => {
  let admin: TestUser
  let member: TestUser

  beforeEach(async () => {
    await resetDb()
    admin = await createUser({ role: "admin", name: "admin" })
    member = await createUser({ role: "member", name: "member" })
  })

  it("既定の予算を返す", async () => {
    const res = await makeApp(member).request("/api/settings/budget")
    expect(res.status).toBe(200)
    expect((await res.json()).value).toBe("150000")
  })

  it("予算更新はadminのみ", async () => {
    const asMember = await makeApp(member).request("/api/settings/budget", { ...json({ value: "200000" }), method: "PUT" })
    expect(asMember.status).toBe(403)

    const asAdmin = await makeApp(admin).request("/api/settings/budget", { ...json({ value: "200000" }), method: "PUT" })
    expect(asAdmin.status).toBe(200)

    const after = await makeApp(member).request("/api/settings/budget")
    expect((await after.json()).value).toBe("200000")
  })

  it("負の予算は400", async () => {
    const res = await makeApp(admin).request("/api/settings/budget", { ...json({ value: "-50" }), method: "PUT" })
    expect(res.status).toBe(400)
  })
})
