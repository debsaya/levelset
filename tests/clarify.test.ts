// The vendor email: plain words, built from the points the buyer ticks, never losing a number.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../lib/normalize";
import { buildEmail, buildRequestEmail, replyBy, vendorPoints } from "../lib/clarify";
import { A, PRIOR, RFX, extraction, line, vendorMsg } from "./helpers";

const BUYER = { name: "Ananya Rao", role: "Category Buyer, Packaging", company: "Saffronleaf Foods Pvt Ltd" };
const JARGON = /\b(flag|flagged|normalis|system|AI\b|RFx|extraction|confidence|derived|ex-GST|BCT|deviation|read-back|questionnaire)/i;

function market() {
  const lines = [line("L01", 3.4), line("L02", 3.9, { spec_deviation: "3-ply 150 GSM instead of 180 GSM" }), line("L03", 5.0, { read_confidence: 0.5, match_confidence: 0.5 })];
  const ex = extraction(lines, { stated_total: { amount: 1000, currency: "INR", note: "", source: { file: "q.xlsx", location: "r", quote: "Total 1000" } }, freight: { included: false, note: "", source: null } as any });
  const n = normalize(RFX, [{ vendor: vendorMsg("V1"), status: "done" as const, extraction: ex }, { vendor: vendorMsg("V2"), status: "done" as const, extraction: extraction([line("L01", 3.6)]) }], A, {}, {}, PRIOR);
  return { n, v: n.vendors.find((x) => x.vendor_id === "V1")! };
}

describe("vendor email points", () => {
  const { n, v } = market();
  const pts = vendorPoints(v, n, RFX);
  it("turns each problem into a plain question the vendor can answer", () => {
    assert.ok(pts.length >= 3);
    for (const p of pts) {
      assert.ok(p.text.endsWith("?") || p.text.endsWith("."), p.text);
      assert.doesNotMatch(p.text, JARGON, p.text);
      assert.doesNotMatch(p.text, /\bAsk (them|whether|for)\b/, "no instructions to the buyer");
    }
  });
  it("covers a different spec and a total that does not match", () => {
    assert.ok(pts.some((p) => p.id === "dev-L02" && /you offered a different spec \(3-ply 150 GSM instead of 180 GSM\)/.test(p.text)));
    assert.ok(pts.some((p) => p.id === "total"));
  });
  it("lists unsure prices once, as a list, not one question each", () => {
    assert.equal(pts.filter((p) => p.id === "unsure").length <= 1, true);
  });
});

describe("buildEmail", () => {
  const points = [{ id: "a", text: "Could you confirm the price?", items: ["L01 3-ply: ₹3.40 per piece"] }, { id: "b", text: "Can you deliver to our plant?" }];
  const e = buildEmail({ points, vendorName: "Kaveri Packwell", contact: "Suresh Natarajan", buyer: BUYER, rfxTitle: "FY27 Annual Rate Contract — Corrugated Packaging", today: new Date("2026-11-06T10:00:00") });
  it("greets by first name, numbers the questions, lists items, signs off with the buyer", () => {
    assert.match(e.body, /^Hi Suresh,/);
    assert.match(e.body, /1\. Could you confirm the price\?\n {3}• L01 3-ply: ₹3\.40 per piece/);
    assert.match(e.body, /2\. Can you deliver/);
    assert.match(e.body, /Ananya Rao\nCategory Buyer, Packaging, Saffronleaf Foods Pvt Ltd$/);
    assert.match(e.subject, /FY27 Annual Rate Contract, Corrugated Packaging/);
  });
  it("falls back to the company name when the contact is not a name", () => {
    assert.match(buildEmail({ points, vendorName: "Kaveri Packwell Pvt Ltd", contact: "x", buyer: BUYER, rfxTitle: "T" }).body, /^Hi Kaveri Packwell team,/);
    assert.match(buildEmail({ points, vendorName: "Kaveri Packwell", contact: "a@b.com", buyer: BUYER, rfxTitle: "T" }).body, /team,/);
  });
  it("asks for a reply in two working days, skipping the weekend", () => {
    assert.equal(replyBy(new Date("2026-11-06T10:00:00")), "Tuesday, 10 November"); // Fri -> Mon, Tue
    assert.match(e.body, /Tuesday, 10 November/);
  });
  it("reads like a person wrote it", () => {
    assert.doesNotMatch(e.body, JARGON);
  });
});

describe("buildRequestEmail", () => {
  const e = buildRequestEmail({ rfx: RFX, vendorName: "Kaveri Packwell Pvt Ltd", contact: "Suresh Natarajan" });
  it("is laid out in short parts, one idea per line", () => {
    assert.match(e.body, /^Hi Suresh,\n\n/);
    assert.ok(e.body.split("\n").length >= 14, "many short lines, not one block");
    assert.match(e.body, /\nWhat we need:\n• Prices for 30 items/);
    assert.match(e.body, /\n• Your quote by 18 November 2026\./);
    assert.match(e.body, /Thanks,\nAnanya Rao\nCategory Buyer, Packaging, Saffronleaf Foods Pvt Ltd$/);
  });
  it("keeps the event id in the subject so replies are routed", () => {
    assert.equal(e.subject, "[RFX-2026-PKG-014] Request for quotation: FY27 Annual Rate Contract — Corrugated Packaging");
  });
  it("lists terms cleanly with no stray punctuation and skips empty ones", () => {
    assert.match(e.body, /• Tax: quote prices exclusive of GST; state GST rate separately\n/);
    assert.doesNotMatch(e.body, /;\s*;|\.\./);
    const bare = buildRequestEmail({ rfx: { ...RFX, terms: {} }, vendorName: "X", contact: "x" });
    assert.doesNotMatch(bare.body, /How we'd like it/);
  });
  it("sounds like a person, not a system", () => {
    assert.doesNotMatch(e.body.replace(RFX.id, ""), JARGON);
  });
});
