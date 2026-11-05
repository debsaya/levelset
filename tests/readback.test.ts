// Misread protection by process: photo-sourced winners need a human look, and the vendor gets a read-back of what we read.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromPhoto, runScenario, scenarios } from "../lib/award";
import { normalize } from "../lib/normalize";
import { readBackIssue } from "../lib/readback";
import { A, PRIOR, RFX, extraction, line, override, vendorMsg } from "./helpers";
import type { Extraction, CellOverride } from "../lib/types";

const BASE = 3.4;
function market(by: Record<string, { ex: Extraction; format?: string }>, overrides: Record<string, CellOverride> = {}) {
  const responses = Object.entries(by).map(([id, x]) => ({ vendor: { ...vendorMsg(id), format: x.format || "Excel" }, status: "done" as const, extraction: x.ex }));
  return normalize(RFX, responses, A, overrides, {}, PRIOR);
}
const photoLine = (id: string, p: number) => line(id, p, { source: { file: "demo/V4/IMG_2026.jpg", location: "row 3", quote: `${p}` } });

describe("Photos and scans: held to a higher confidence bar, but a clear photo is trusted", () => {
  const photo = (id: string, p: number, conf: number) => line(id, p, { read_confidence: conf, match_confidence: conf, source: { file: "demo/V4/IMG_2026.jpg", location: "row 3", quote: `${p}` } });
  const cell = (n: ReturnType<typeof market>) => n.cellMap["V1|L01"];

  it("a clear photo read (confidence above the photo bar) is trusted like any other file", () => {
    const n = market({ V1: { ex: extraction([photo("L01", 3.0, 0.95)]), format: "Photo of rate card" }, V2: { ex: extraction([line("L01", 3.4)]) } });
    assert.equal(cell(n).status, "ok");
    const r = runScenario(RFX, n, { eligibility: "all" });
    assert.equal(r.rows[0].vendor_id, "V1");
    assert.equal(r.prices_read_from_photos, 1, "still reported as photo-sourced, for information");
    assert.equal(r.unverified_prices_in_award, 0, "but not held back");
  });

  it("a photo read between the normal bar (80%) and the photo bar (90%) goes to review; the same confidence on an Excel does not", () => {
    const n = market({ V1: { ex: extraction([photo("L01", 3.0, 0.85)]), format: "Photo" }, V2: { ex: extraction([line("L01", 3.4, { read_confidence: 0.85, match_confidence: 0.85 })]) } });
    assert.equal(cell(n).status, "review");
    assert.ok(cell(n).flags.some((f) => f.code === "PHOTO_CONFIDENCE"));
    assert.equal(n.cellMap["V2|L01"].status, "ok");
    assert.equal(runScenario(RFX, n, { eligibility: "all" }).unverified_prices_in_award, 1);
  });

  it("a poor photo read (below the normal bar) is flagged once, as ordinary low confidence", () => {
    const n = market({ V1: { ex: extraction([photo("L01", 3.0, 0.6)]), format: "Photo" } });
    const codesOf = cell(n).flags.map((f) => f.code);
    assert.ok(codesOf.includes("LOW_CONFIDENCE"));
    assert.ok(!codesOf.includes("PHOTO_CONFIDENCE"));
  });

  it("the photo bar is the buyer's to change", () => {
    const ex = () => ({ V1: { ex: extraction([photo("L01", 3.0, 0.95)]), format: "Photo" } });
    const strict = normalize(RFX, Object.entries(ex()).map(([id, x]) => ({ vendor: { ...vendorMsg(id), format: x.format }, status: "done" as const, extraction: x.ex })), { ...A, photo_review_threshold: 0.99 }, {}, {}, PRIOR);
    assert.equal(strict.cellMap["V1|L01"].status, "review");
    const old = normalize(RFX, Object.entries(ex()).map(([id, x]) => ({ vendor: { ...vendorMsg(id), format: x.format }, status: "done" as const, extraction: x.ex })), { ...A, photo_review_threshold: undefined }, {}, {}, PRIOR);
    assert.equal(old.cellMap["V1|L01"].status, "ok", "older saved state without the setting still works (default 90%)");
  });

  it("photo sources are recognised from the file type or from the reply format", () => {
    assert.ok(fromPhoto(market({ V1: { ex: extraction([photo("L01", BASE, 0.95)]) } }).cellMap["V1|L01"]));
    assert.ok(fromPhoto(market({ V1: { ex: extraction([line("L01", BASE)]), format: "Scanned letter" } }).cellMap["V1|L01"]));
    assert.ok(!fromPhoto(market({ V1: { ex: extraction([line("L01", BASE)]) } }).cellMap["V1|L01"]));
  });

  it("the buyer's accept or correction clears a flagged photo price", () => {
    for (const ov of [override("accept"), override("override", 3.1)]) {
      const n = market({ V1: { ex: extraction([photo("L01", BASE, 0.85)]), format: "Photo" } }, { "V1|L01": ov });
      assert.equal(runScenario(RFX, n, { eligibility: "all" }).unverified_prices_in_award, 0);
    }
  });

  it("the Overview's scenarios count flagged photo winners too", () => {
    const n = market({ V1: { ex: extraction([photo("L01", BASE, 0.85)]), format: "Photo" } });
    assert.equal(scenarios(RFX, n)[0].unverified, 1);
  });
});

describe("Read-back: the vendor confirms what we read before we finalise", () => {
  const two = () => market({ V1: { ex: extraction([line("L01", 340, { basis_qty: 100, source: { file: "q.xlsx", location: "B2", quote: "Rs 340 per 100 nos" } }), line("L02", 5.8)]) }, V2: { ex: extraction([line("L02", 5.5), line("L01", 4.0)]) } });

  it("lists only the items this vendor would win, with what they wrote and what we read", () => {
    const rb = readBackIssue("V1", two(), RFX)!;
    assert.match(rb, /^READ-BACK/);
    assert.ok(rb.includes("L01"));
    assert.ok(rb.includes("Rs 340 per 100 nos"), "their own words");
    assert.ok(rb.includes("₹3.40 per piece"), "our exact reading");
    assert.ok(!rb.includes("L02"), "an item another vendor wins is not listed");
  });

  it("is built by code, so every figure equals the comparison's own number", () => {
    const n = two();
    const rb = readBackIssue("V2", n, RFX)!;
    assert.ok(rb.includes(`₹${n.cellMap["V2|L02"].unit_inr!.toFixed(2)} per piece`));
  });

  it("does not reveal another vendor's name or prices", () => {
    const rb = readBackIssue("V1", two(), RFX)!;
    assert.ok(!rb.includes("Vendor V2") && !rb.includes("5.50") && !rb.includes("4.00"));
  });

  it("is absent for a vendor with nothing to win (no pointless email)", () => {
    const n = market({ V1: { ex: extraction([line("L01", 5.0)]) }, V2: { ex: extraction([line("L01", 3.4)]) } });
    assert.equal(readBackIssue("V1", n, RFX), null);
  });

  it("an unconverted price is stated once; a converted one shows what they wrote beside what we read", () => {
    const n = market({ V1: { ex: extraction([line("L01", 340, { basis_qty: 100, source: { file: "q.xlsx", location: "B2", quote: "Rs 340 per 100 nos" } }), line("L02", 5.5)]) } });
    const rb = readBackIssue("V1", n, RFX)!;
    assert.match(rb, /L02 [^;]*: ₹5\.50 per piece(;|\.)/, "plain price: no 'you wrote … we read' repetition");
    assert.match(rb, /L01 [^;]*you wrote .*Rs 340 per 100 nos.*we read it as ₹3\.40 per piece/);
  });

  it("lists everything up to 40 items; a longer list is capped and says how many were left out", () => {
    const big = structuredClone(RFX);
    const extra = RFX.lines.slice(0, 15).map((l) => ({ ...l, id: "X" + l.id.slice(1) }));
    big.lines = [...RFX.lines, ...extra]; // 45 lines
    const lines = big.lines.map((l) => line(l.id, Math.round(41 * l.est_weight_kg * 100) / 100));
    const responses = [{ vendor: vendorMsg("V1"), status: "done" as const, extraction: extraction(lines) }];
    const n = normalize(big, responses, A, {}, {}, PRIOR);
    const rb = readBackIssue("V1", n, big)!;
    assert.match(rb, /plus 5 smaller items/);
    assert.equal((rb.match(/₹[\d.]+ per piece/g) || []).length, 40);
    const rb30 = readBackIssue("V1", market({ V1: { ex: extraction(RFX.lines.map((l) => line(l.id, Math.round(41 * l.est_weight_kg * 100) / 100))) } }), RFX)!;
    assert.ok(!rb30.includes("plus"), "30 items are all listed");
  });
});
