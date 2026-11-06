// Second batch: real-world oddities found by asking "what would a careful buyer worry about?".
// Several of these exposed genuine gaps in the first version; they are fixed and pinned here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScenario } from "../lib/award";
import { normalize } from "../lib/normalize";
import { A, PRIOR, RFX, cellOf, codes, extraction, line, override, run, vendorOf } from "./helpers";

const near = (a: number | null, b: number, tol = 1e-6) => assert.ok(a !== null && Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);
const L01 = RFX.lines.find((l) => l.id === "L01")!;
const BASE = 3.4;
const SRC = { file: "q", location: "", quote: "" };
const adj = (kind: "discount" | "rebate" | "surcharge" | "one_time_charge", pct: number | null, conditional = false, amount: number | null = null) => ({ kind, pct, amount, conditional, condition: conditional ? "if…" : null, description: kind, source: SRC });

describe("Prices that can never be real must not win by looking cheap", () => {
  it("a zero or negative price is not a price (it would otherwise be 'the cheapest' and win the award)", () => {
    for (const p of [0, -3.4]) {
      const n = run({ V1: extraction([line("L01", p)]), V2: extraction([line("L01", BASE)]) });
      const c = cellOf(n, "V1", "L01");
      assert.equal(c.status, "missing");
      assert.equal(c.unit_inr, null);
      assert.ok(codes(c).includes("INVALID_PRICE"));
      assert.equal(runScenario(RFX, n, { eligibility: "all" }).rows[0].vendor_id, "V2");
    }
  });

  it("a per-kg price on a line with no weight is unusable rather than ₹0", () => {
    const rfx = structuredClone(RFX);
    rfx.lines[0].est_weight_kg = 0;
    const n = run({ V1: extraction([line("L01", 41, { basis_unit: "kg" })]) }, { rfx });
    assert.equal(cellOf(n, "V1", "L01").status, "missing");
    assert.equal(cellOf(n, "V1", "L01").unit_inr, null);
  });

  it("the buyer can still supply a price by phone for such a cell", () => {
    const n = run({ V1: extraction([line("L01", 0)]) }, { overrides: { "V1|L01": override("override", 3.3) } });
    near(cellOf(n, "V1", "L01").unit_inr, 3.3);
    assert.equal(cellOf(n, "V1", "L01").status, "ok");
  });
});

describe("Weight-based quotes in bigger units", () => {
  it("₹42,000 per tonne and ₹4,200 per 100 kg both equal ₹42 per kg", () => {
    const w = L01.est_weight_kg;
    near(cellOf(run({ V1: extraction([line("L01", 42000, { basis_unit: "kg", basis_qty: 1000 })]) }), "V1", "L01").unit_inr, 42 * w);
    near(cellOf(run({ V1: extraction([line("L01", 4200, { basis_unit: "kg", basis_qty: 100 })]) }), "V1", "L01").unit_inr, 42 * w);
  });
  it("the vendor's own total uses the same conversion, so it still reconciles", () => {
    const total = (42 * L01.est_weight_kg) * L01.annual_qty;
    const ex = extraction([line("L01", 42000, { basis_unit: "kg", basis_qty: 1000 })], { stated_total: { amount: total, currency: "INR", note: "", source: SRC } });
    assert.ok(vendorOf(run({ V1: ex }), "V1").flags.some((f) => f.code === "TOTAL_OK"));
  });
});

describe("Adders that make a vendor look cheaper than they are", () => {
  it("an unconditional percentage surcharge (fuel, handling) is added to the price", () => {
    near(cellOf(run({ V1: extraction([line("L01", BASE)], { adjustments: [adj("surcharge", 3)] }) }), "V1", "L01").unit_inr, BASE * 1.03);
  });

  it("a conditional surcharge and a fixed one-time charge do NOT change the unit price (shown to the buyer separately)", () => {
    const n = run({ V1: extraction([line("L01", BASE)], { adjustments: [adj("surcharge", 3, true), adj("one_time_charge", null, false, 4500)] }) });
    near(cellOf(n, "V1", "L01").unit_inr, BASE);
    assert.equal(vendorOf(n, "V1").adjustments.length, 2);
  });

  it("several unconditional discounts add up (stated rule: additive, the conservative reading is compounding, differences are under 0.1%)", () => {
    near(cellOf(run({ V1: extraction([line("L01", BASE)], { adjustments: [adj("discount", 5), adj("rebate", 2)] }) }), "V1", "L01").unit_inr, BASE * 0.93);
  });
});

describe("Tax variety", () => {
  it("any GST rate is removed correctly (18%, not just 5%)", () => {
    const n = run({ V1: extraction([line("L01", 4.012, { tax_included: true })], { tax: { basis: "inclusive", gst_rate_pct: 18, note: "", source: null } }) });
    near(cellOf(n, "V1", "L01").unit_inr, 3.4, 1e-9);
  });

  it("a quote that mixes GST-inclusive and exclusive lines lands every line on the same ex-GST basis", () => {
    const n = run({ V1: extraction([line("L01", 3.57, { tax_included: true }), line("L02", 5.0, { tax_included: false })], { tax: { basis: "mixed", gst_rate_pct: 5, note: "", source: null } }) });
    near(cellOf(n, "V1", "L01").unit_inr, 3.4);
    near(cellOf(n, "V1", "L02").unit_inr, 5.0);
  });

  it("currency codes are read case-insensitively", () => {
    near(cellOf(run({ V1: extraction([line("L01", 0.04, { currency: "usd" })]) }), "V1", "L01").unit_inr, 0.04 * A.fx_usd_inr);
  });
});

describe("Duplicates, price breaks and noise from the reader", () => {
  it("the same item priced twice (e.g. quantity slabs) is flagged and never averaged; the more confident reading is kept", () => {
    const n = run({ V1: extraction([line("L01", 3.6, { vendor_item_text: "up to 50k", read_confidence: 0.9 }), line("L01", 3.4, { vendor_item_text: "above 50k", read_confidence: 0.95 })]) });
    const c = cellOf(n, "V1", "L01");
    near(c.unit_inr, 3.4);
    const f = c.flags.find((x) => x.code === "DUPLICATE")!;
    assert.ok(f && f.msg.includes("up to 50k") && f.msg.includes("above 50k"), "both candidates are shown to the buyer");
    assert.equal(c.status, "review");
  });

  it("a line id the model invented is ignored instead of crashing or polluting totals", () => {
    const n = run({ V1: extraction([line("L01", BASE), line("L99", 1.0)]) });
    assert.equal(n.cells.length, RFX.lines.length);
    assert.equal(vendorOf(n, "V1").quoted, 1);
  });

  it("an answer to a question that isn't in the RFx is ignored", () => {
    const ex = extraction([line("L01", BASE)]);
    ex.questionnaire.push({ question_id: "Q99", answer: "?", assessment: "fail", reasoning: "", source: null });
    assert.equal(vendorOf(run({ V1: ex }), "V1").qualification, "qualified");
  });
});

describe("Coverage", () => {
  it("a regret ('can't make this') keeps its reason and is never costed", () => {
    const ex = extraction([line("L01", BASE)], { not_quoted: [{ rfx_line_id: "L26", reason: "not in our tooling capability" }] });
    const c = cellOf(run({ V1: ex }), "V1", "L26");
    assert.equal(c.status, "missing");
    assert.match(c.missing_reason || "", /tooling/);
  });

  it("no replies, or a reply with no prices, does not crash and yields an empty comparison", () => {
    assert.equal(run({}).cells.length, 0);
    const n = run({ V1: extraction([]) });
    assert.equal(vendorOf(n, "V1").quoted, 0);
    assert.equal(n.basket.length, 0);
  });

  it("a partition quoted per piece when the RFx asks per set shows up as a unit problem", () => {
    const n = run({ V1: extraction([line("L23", 2.0)]) }); // L23 is a 9-cell partition SET of 0.176 kg
    assert.ok(codes(cellOf(n, "V1", "L23")).includes("UNIT_SUSPECT"));
  });
});

describe("Certificates and quote validity", () => {
  const doc = (kind: string, valid_until: string | null) => ({ file: "f.pdf", kind, summary: kind, valid_until });
  const q1 = (docs: any[]) => {
    const n = run({ V1: extraction([line("L01", BASE)], { documents: docs }) });
    return n.q.find((x) => x.question_id === "Q1")!;
  };

  it("an expired FSC certificate does not fail the ISO question", () => {
    assert.equal(q1([doc("FSC certificate", "2025-01-01"), doc("ISO 9001:2015 certificate", "2027-06-30")]).assessment, "pass");
  });

  it("an expired non-ISO certificate on its own is not read as an ISO certificate", () => {
    const r = q1([doc("FSC certificate", "2025-01-01")]);
    assert.notEqual(r.assessment, "fail");
  });

  it("an old expired ISO certificate next to a renewed one passes (the newest counts)", () => {
    assert.equal(q1([doc("ISO 9001 certificate (old)", "2025-03-01"), doc("ISO 9001 certificate (renewed)", "2028-03-01")]).assessment, "pass");
  });

  it("quote prices that expired before the RFx due date are flagged", () => {
    const ex = extraction([line("L01", BASE)], { quote_date: "2026-10-01", validity_days: 15 });
    assert.ok(vendorOf(run({ V1: ex }), "V1").flags.some((f) => f.code === "QUOTE_EXPIRED"));
  });

  it("normal validity, missing validity or an unreadable date raises nothing", () => {
    for (const over of [{ quote_date: "2026-11-10", validity_days: 30 }, { quote_date: "2026-11-10", validity_days: null }, { quote_date: "next week", validity_days: 10 }, { quote_date: null, validity_days: 10 }]) {
      assert.ok(!vendorOf(run({ V1: extraction([line("L01", BASE)], over) }), "V1").flags.some((f) => f.code === "QUOTE_EXPIRED"), JSON.stringify(over));
    }
  });
});

describe("Safety net: shape of the output", () => {
  it("every RFx line gets exactly one cell per vendor, in a stable order", () => {
    const n = run({ V1: extraction([line("L01", BASE)]), V2: extraction([line("L02", 5.5)]) });
    assert.equal(n.cells.length, RFX.lines.length * 2);
    assert.deepEqual(n.cells.filter((c) => c.vendor_id === "V1").map((c) => c.line_id), RFX.lines.map((l) => l.id));
  });

  it("normalising twice gives identical results (no hidden state)", () => {
    const ex = () => ({ V1: extraction([line("L01", 340, { basis_qty: 100 })]) });
    assert.deepEqual(run(ex()).cells, run(ex()).cells);
  });

  it("the original RFx and extractions are never mutated by normalising", () => {
    const rfx = structuredClone(RFX);
    const ex = extraction([line("L01", BASE)]);
    const snapshot = JSON.stringify([rfx, ex]);
    normalize(rfx, [{ vendor: { id: "V1", name: "V", city: "", contact: "", email: "", format: "", subject: "", received_at: "", body: "", attachments: [] }, status: "done", extraction: ex }], A, {}, {}, PRIOR);
    assert.equal(JSON.stringify([rfx, ex]), snapshot);
  });
});

import { runQuery } from "../lib/db";
describe("Ask AI only runs read-only queries", () => {
  const db = { exec: () => [] };
  const blocked = ["SELECT 1; DROP TABLE prices", "WITH a AS (SELECT 1) DELETE FROM prices", "SeLeCt 1 ; UPDATE prices SET unit_price_inr=0", "PRAGMA table_info(prices)", "ATTACH DATABASE 'x' AS y", "VACUUM", "select readfile('/etc/passwd')", "SELECT load_extension('x')"];
  for (const q of blocked) it(`blocks ${q}`, () => assert.ok(runQuery(db, q).error));
  for (const q of ["SELECT 'a;b' AS x", "SELECT * FROM prices WHERE note LIKE '%drop%'", "select created_at, updated_at from t", "  select 1 ;;;  "]) it(`allows ${q}`, () => assert.equal(runQuery(db, q).error, undefined));
});
