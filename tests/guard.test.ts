import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { friendly, guard, need, rateLimited, sameSite } from "../lib/guard";

const post = (body: string, headers: Record<string, string> = {}) => new Request("https://levelset.test/api/x", { method: "POST", body, headers: { host: "levelset.test", ...headers } });
const ok = (b: Record<string, any>) => (b.a ? null : "Missing a.");

describe("API guard", () => {
  it("rejects malformed JSON with a clean 400", async () => {
    const r = await guard(post("{bad"), "t1", ok);
    assert.ok(r instanceof Response);
    assert.equal((r as Response).status, 400);
    assert.match((await (r as Response).json()).error, /valid JSON/);
  });
  it("rejects non-objects", async () => {
    for (const b of ["[]", "null", "42", '"x"']) assert.equal(((await guard(post(b), "t2", ok)) as Response).status, 400);
  });
  it("rejects a body that fails the route's check", async () => {
    const r = (await guard(post("{}"), "t3", ok)) as Response;
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "Missing a.");
  });
  it("returns the body when it is fine", async () => {
    const r = await guard(post('{"a":1}'), "t4", ok);
    assert.deepEqual(r, { a: 1 });
  });
  it("blocks other sites but allows the page itself and plain clients", () => {
    assert.equal(sameSite(post("{}", { "sec-fetch-site": "cross-site" })), false);
    assert.equal(sameSite(post("{}", { origin: "https://evil.example" })), false);
    assert.equal(sameSite(post("{}", { origin: "https://levelset.test", "sec-fetch-site": "same-origin" })), true);
    assert.equal(sameSite(post("{}")), true);
  });
  it("rate limit trips after the cap and recovers after the window", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(rateLimited("1.1.1.1", "rl", 3, 60_000, t + i), false);
    assert.equal(rateLimited("1.1.1.1", "rl", 3, 60_000, t + 10), true);
    assert.equal(rateLimited("2.2.2.2", "rl", 3, 60_000, t + 10), false);
    assert.equal(rateLimited("1.1.1.1", "rl", 3, 60_000, t + 61_000), false);
  });
  it("rfx shape check", () => {
    assert.ok(need.rfx({}));
    assert.ok(need.rfx({ rfx: null }));
    assert.equal(need.rfx({ rfx: { lines: [], questionnaire: [], terms: {} } }), null);
  });
  it("hides internals but keeps quota messages", () => {
    assert.match(friendly("Cannot read properties of undefined (reading 'title')"), /could not process/);
    assert.match(friendly('gemini-3.5-flash-lite: 400 {"error": {"code": 400}}'), /could not process/);
    assert.match(friendly("gemini-3.8-flash: 429 RESOURCE_EXHAUSTED quota"), /429/);
  });
});
