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

describe("Prices read from photos or scans are never silently trusted in an award", () => {
  it("a photo winner counts as needing a check even when every automatic check passed", () => {
    const n = market({ V1: { ex: extraction([photoLine("L01", 3.0)]), format: "Photo of rate card" }, V2: { ex: extraction([line("L01", 3.4)]) } });
    assert.equal(n.cells.find((c) => c.vendor_id === "V1" && c.line_id === "L01")!.status, "ok");
    const r = runScenario(RFX, n, { eligibility: "all" });
    assert.equal(r.rows[0].vendor_id, "V1");
    assert.equal(r.prices_read_from_photos, 1);
    assert.equal(r.unverified_prices_in_award, 1);
  });

  it("it is recognised from the file type or from the vendor's reply format", () => {
    const byFile = market({ V1: { ex: extraction([photoLine("L01", BASE)]) } });
    assert.ok(fromPhoto(byFile.cellMap["V1|L01"], byFile));
    const byFormat = market({ V1: { ex: extraction([line("L01", BASE)]), format: "Scanned letter" } });
    assert.ok(fromPhoto(byFormat.cellMap["V1|L01"], byFormat));
    const excel = market({ V1: { ex: extraction([line("L01", BASE)]) } });
    assert.ok(!fromPhoto(excel.cellMap["V1|L01"], excel));
  });

  it("an Excel, Word or text-PDF winner is not held back", () => {
    const n = market({ V1: { ex: extraction([line("L01", BASE)]) } });
    assert.equal(runScenario(RFX, n, { eligibility: "all" }).unverified_prices_in_award, 0);
  });

  it("once the buyer accepts or corrects the price against the original, it no longer counts", () => {
    for (const ov of [override("accept"), override("override", 3.1)]) {
      const n = market({ V1: { ex: extraction([photoLine("L01", BASE)]), format: "Photo" } }, { "V1|L01": ov });
      assert.equal(runScenario(RFX, n, { eligibility: "all" }).unverified_prices_in_award, 0);
    }
  });

  it("the Overview's scenarios count them too, so the on-screen 'prices still need your check' is honest", () => {
    const n = market({ V1: { ex: extraction([photoLine("L01", BASE)]), format: "Photo" } });
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

  it("caps a long list and says how many were left out", () => {
    const n = market({ V1: { ex: extraction(RFX.lines.map((l) => line(l.id, Math.round(41 * l.est_weight_kg * 100) / 100))) } });
    const rb = readBackIssue("V1", n, RFX)!;
    assert.match(rb, /plus 15 smaller items/);
    assert.equal((rb.match(/you wrote/g) || []).length, 15);
  });
});
