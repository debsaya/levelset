import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postJson, postStream, stopAllAi, STOPPED } from "../lib/api";

const never = (_u: any, o: any) =>
  new Promise((_ok, no) => o.signal.addEventListener("abort", () => no(Object.assign(new Error("aborted"), { name: "AbortError" }))));

describe("Stopping the AI", () => {
  it("stopAllAi cancels a call in flight and reports it as stopped", async () => {
    (globalThis as any).fetch = never;
    const p = postJson("/api/x", {}, 3);
    setTimeout(stopAllAi, 20);
    assert.equal((await p).error, STOPPED);
  });
  it("a stopped stream is not retried", async () => {
    let calls = 0;
    (globalThis as any).fetch = (u: any, o: any) => (calls++, never(u, o));
    const own = new AbortController();
    const p = postStream("/api/x", {}, () => {}, () => {}, 3, own.signal);
    setTimeout(() => own.abort(), 20);
    assert.equal((await p).error, STOPPED);
    assert.equal(calls, 1);
  });
  it("the next call after a stop works normally", async () => {
    (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    const r: any = await postJson("/api/x", {}, 1);
    assert.equal(r.ok, 1);
  });
});
