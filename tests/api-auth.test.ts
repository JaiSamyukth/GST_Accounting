import { beforeAll, describe, expect, it } from "vitest";
import * as setup from "@/app/api/auth/setup/route";
import * as status from "@/app/api/auth/status/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/auth/me/route";
import * as reset from "@/app/api/auth/reset/route";
import * as changePw from "@/app/api/auth/change-password/route";
import * as businessApi from "@/app/api/business/route";
import * as usersApi from "@/app/api/users/route";
import * as userApi from "@/app/api/users/[id]/route";
import { Client, freshDb, OWNER } from "./helpers";

describe("auth and roles", () => {
  const owner = new Client();
  beforeAll(async () => { await freshDb(); });

  it("first visit creates the owner once", async () => {
    expect((await owner.call(status.GET)).data).toMatchObject({ hasUsers: false, user: null });
    const r = await owner.call(setup.POST, { body: { ...OWNER, businessName: "Dev Caters", stateCode: "33" } });
    expect(r.status).toBe(201);
    expect(owner.cookie).toMatch(/^gst_session=/);
    const again = await new Client().call(setup.POST, { body: { ...OWNER, email: "x@example.com" } });
    expect(again.status).toBe(409);
    expect((await owner.call(me.GET)).data.user.role).toBe("owner");
  });

  it("rejects weak passwords", async () => {
    const r = await owner.call(changePw.POST, { body: { current: OWNER.password, next: "short1" } });
    expect(r.status).toBe(422);
  });

  it("requires the CSRF header on mutations", async () => {
    const r = await owner.call(logout.POST, { method: "POST", csrf: false });
    expect(r.status).toBe(403);
  });

  it("logs in, logs out, and throttles after 8 failures", async () => {
    const c = new Client();
    expect((await c.call(login.POST, { body: { email: OWNER.email, password: "wrong password 1" } })).status).toBe(401);
    expect((await c.call(login.POST, { body: { email: OWNER.email, password: OWNER.password } })).status).toBe(200);
    expect((await c.call(me.GET)).status).toBe(200);
    await c.call(logout.POST, { method: "POST" });
    c.cookie = "";
    expect((await c.call(me.GET)).status).toBe(401);
    for (let i = 0; i < 7; i++) await c.call(login.POST, { body: { email: OWNER.email, password: "wrong password 1" } });
    const blocked = await c.call(login.POST, { body: { email: OWNER.email, password: OWNER.password } });
    expect(blocked.status).toBe(429);
  });

  it("accountant cannot change business settings; reset link is single use", async () => {
    const created = await owner.call(usersApi.POST, { body: { name: "Acc", email: "acc@example.com", role: "accountant" } });
    expect(created.status).toBe(201);
    const token = new URL(created.data.link.url).searchParams.get("token")!;
    const acc = new Client();
    expect((await acc.call(reset.POST, { body: { token, password: "accountant pass 9" } })).status).toBe(200);
    expect((await acc.call(reset.POST, { body: { token, password: "accountant pass 8" } })).status).toBe(422);
    expect((await acc.call(login.POST, { body: { email: "acc@example.com", password: "accountant pass 9" } })).status).toBe(200);
    const put = await acc.call(businessApi.PUT, { method: "PUT", body: { legalName: "X", stateCode: "33", filingFrequency: "monthly", fyStartYear: 2026 } });
    expect(put.status).toBe(403);
    expect((await acc.call(usersApi.GET)).status).toBe(403);
  });

  it("keeps at least one active owner", async () => {
    const r = await owner.call(userApi.PATCH, { method: "PATCH", params: { id: "1" }, body: { role: "accountant" } });
    expect(r.status).toBe(409);
  });
});

describe("tutorial flag", () => {
  it("starts false for a new user and can be set and cleared", async () => {
    const { freshDb: fresh, Client: C, OWNER: O } = await import("./helpers");
    const tut = await import("@/app/api/auth/tutorial/route");
    await fresh();
    const c = new C();
    await c.call(setup.POST, { body: { ...O, businessName: "Dev Caters" } });
    expect((await c.call(me.GET)).data.user.tutorialDone).toBe(false);
    expect((await c.call(tut.POST, { body: { done: true } })).data.tutorialDone).toBe(true);
    expect((await c.call(me.GET)).data.user.tutorialDone).toBe(true);
    await c.call(tut.POST, { body: { done: false } });
    expect((await c.call(status.GET)).data.user.tutorialDone).toBe(false);
  });
});
