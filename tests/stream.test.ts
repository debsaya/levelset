import test from "node:test";
import assert from "node:assert/strict";
import { readSse } from "../lib/gemini";
import { ndjsonStream } from "../lib/stream";

const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    })
  );
const ev = (parts: any[], finishReason?: string) => `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`;

test("readSse joins streamed text, keeps the signature and reports each piece", async () => {
  const seen: string[] = [];
  const raw = await readSse(sse([ev([{ text: "The cheap" }]), ev([{ text: "est is Kaveri." }]), ev([{ text: "", thoughtSignature: "sig" }], "STOP")]), (d) => seen.push(d));
  const parts = raw.candidates[0].content.parts;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, "The cheapest is Kaveri.");
  assert.equal(parts[0].thoughtSignature, "sig");
  assert.deepEqual(seen, ["The cheap", "est is Kaveri."]);
  assert.equal(raw.candidates[0].finishReason, "STOP");
});

test("readSse copes with an event split across network chunks and keeps function calls intact", async () => {
  const e = ev([{ functionCall: { name: "run_sql", args: { sql: "select 1" } }, thoughtSignature: "abc" }]);
  const cut = Math.floor(e.length / 2);
  const raw = await readSse(sse([e.slice(0, cut), e.slice(cut)]), () => assert.fail("no text expected"));
  const parts = raw.candidates[0].content.parts;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].functionCall.name, "run_sql");
  assert.equal(parts[0].thoughtSignature, "abc");
});

test("readSse does not show thought text", async () => {
  const seen: string[] = [];
  await readSse(sse([ev([{ text: "thinking…", thought: true }, { text: "Answer" }])]), (d) => seen.push(d));
  assert.deepEqual(seen, ["Answer"]);
});

test("ndjsonStream sends pieces, then the result, one JSON object per line", async () => {
  const res = ndjsonStream(async (emit) => {
    emit({ t: "d", x: "Hi" });
    return { content: { role: "model", parts: [] }, model: "m" };
  });
  const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].t, "hb");
  assert.deepEqual(lines[1], { t: "d", x: "Hi" });
  assert.equal(lines[2].t, "done");
  assert.equal(lines[2].model, "m");
});

test("ndjsonStream turns a failure into an err line", async () => {
  const res = ndjsonStream(async () => {
    throw new Error("boom");
  });
  const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).t, "err");
});
