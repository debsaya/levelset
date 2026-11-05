// Each test is one buyer-facing rule from docs/DECISIONS.md.
// The model only reads; these checks prove the code is what decides trust, price and status.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { A, PRIOR, RFX, cellOf, codes, extraction, line, override, run, vendorOf } from "./helpers";

const near = (a: number | null, b: number, tol = 1e-6) => assert.ok(a !== null && Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);
const L01 = RFX.lines.find((l) => l.id === "L01")!; // 3-ply RSC 200×150×100, 0.083 kg
const BASE = 3.4; // a sensible L01 price per piece (≈ ₹41/kg)

describe("1. Units: every price is brought to ₹ per piece, landed at the plant, ex-GST", () => {
  it("per-100 price is divided by 100", () => {
    const n = run({ V1: extraction([line("L01", 340, { basis_qty: 100 })]) });
    near(cellOf(n, "V1", "L01").unit_inr, 3.4);
    assert.equal(cellOf(n, "V1", "L01").status, "ok");
  });

  it("per-kg price is multiplied by the box weight computed from the RFx spec", () => {
    const n = run({ V1: extraction([line("L01", 41, { basis_unit: "kg" })]) });
    near(cellOf(n, "V1", "L01").unit_inr, 41 * L01.est_weight_kg);
    assert.ok(codes(cellOf(n, "V1", "L01")).includes("PER_KG"));
  });

  it("USD is converted at the BUYER's rate, and changes when the buyer changes it", () => {
    const ex = () => extraction([line("L01", 0.04, { currency: "USD" })], { currency: "USD", fx_rate_stated: 83 });
    near(cellOf(run({ V1: ex() }), "V1", "L01").unit_inr, 0.04 * 88.2);
    near(cellOf(run({ V1: ex() }, { assumptions: { fx_usd_inr: 90 } }), "V1", "L01").unit_inr, 0.04 * 90);
  });

  it("an unknown currency is blocked, not guessed", () => {
    const n = run({ V1: extraction([line("L01", 0.04, { currency: "AED" })]) });
    assert.ok(codes(cellOf(n, "V1", "L01")).includes("FX_UNKNOWN"));
    assert.equal(cellOf(n, "V1", "L01").status, "review");
  });

  it("a price that implies a silly ₹/kg is flagged as a likely unit error (₹340 per piece that was per 100)", () => {
    const n = run({ V1: extraction([line("L01", 340)]) });
    const c = cellOf(n, "V1", "L01");
    assert.ok(codes(c).includes("UNIT_SUSPECT"));
    assert.equal(c.status, "review");
  });
});

describe("2. Tax and freight: compare like with like", () => {
  it("GST-inclusive prices have the stated GST removed", () => {
    const n = run({ V1: extraction([line("L01", 3.57, { tax_included: true })], { tax: { basis: "inclusive", gst_rate_pct: 5, note: "", source: null } }) });
    near(cellOf(n, "V1", "L01").unit_inr, 3.4);
    assert.equal(cellOf(n, "V1", "L01").status, "ok");
  });

  it("GST-inclusive with NO stated rate assumes 5% but sends the cell to review", () => {
    const n = run({ V1: extraction([line("L01", 3.57, { tax_included: true })], { tax: { basis: "inclusive", gst_rate_pct: null, note: "", source: null } }) });
    const c = cellOf(n, "V1", "L01");
    near(c.unit_inr, 3.4);
    assert.ok(codes(c).includes("GST_INCLUDED"));
    assert.equal(c.status, "review");
  });

  it("ex-works quotes get the buyer's freight assumption added (vendor-specific rate wins over the default)", () => {
    const ex = () => extraction([line("L01", BASE)], { freight: { included: false, note: "ex-works", source: null } });
    near(cellOf(run({ V2: ex() }), "V2", "L01").unit_inr, BASE + 2.2 * L01.est_weight_kg); // V2 has its own rate
    near(cellOf(run({ V9: ex() }), "V9", "L01").unit_inr, BASE + 1.0 * L01.est_weight_kg); // default rate
  });

  it("unstated freight is treated as delivered but flagged, never silently", () => {
    const n = run({ V1: extraction([line("L01", BASE)], { freight: { included: null, note: "", source: null } }) });
    const c = cellOf(n, "V1", "L01");
    near(c.unit_inr, BASE);
    assert.ok(codes(c).includes("FREIGHT_UNCLEAR"));
    assert.equal(c.status, "review");
  });
});

describe("3. Discounts: unconditional counts, conditional does not (unless the buyer says so)", () => {
  const rebate = (conditional: boolean, pct: number) => ({ kind: "rebate" as const, pct, amount: null, conditional, condition: conditional ? "if volume > 1 Cr" : null, description: "rebate", source: { file: "q", location: "", quote: "" } });

  it("an unconditional discount is applied", () => {
    const n = run({ V1: extraction([line("L01", BASE)], { adjustments: [rebate(false, 2)] }) });
    near(cellOf(n, "V1", "L01").unit_inr, BASE * 0.98);
  });

  it("a conditional rebate is NOT in the price, but the 'if earned' price is kept alongside", () => {
    const n = run({ V1: extraction([line("L01", BASE)], { adjustments: [rebate(true, 3)] }) });
    const c = cellOf(n, "V1", "L01");
    near(c.unit_inr, BASE);
    near(c.unit_inr_if_rebate, BASE * 0.97);
  });

  it("ticking 'count rebates that need a condition' counts it", () => {
    const n = run({ V1: extraction([line("L01", BASE)], { adjustments: [rebate(true, 3)] }) }, { assumptions: { apply_conditional_rebates: true } });
    near(cellOf(n, "V1", "L01").unit_inr, BASE * 0.97);
  });
});

describe("4. Prior-contract references: 'same as last year' is resolved from the record, never invented", () => {
  const sameAsLastYear = (id: string) => line(id, null, { derived_from: "prior_contract", source: { file: "mail", location: "", quote: "rates same as last year" } });

  it("pulls the FY26 contract price and says where it came from", () => {
    const n = run({ V5: extraction([sameAsLastYear("L01")]) });
    const c = cellOf(n, "V5", "L01");
    near(c.unit_inr, PRIOR.V5.prices.L01);
    assert.ok(codes(c).includes("PRIOR_CONTRACT"));
    assert.ok(c.flags.find((f) => f.code === "PRIOR_CONTRACT")!.msg.includes(PRIOR.V5.contract_ref));
  });

  it("a line with no prior price (new this year) stays EMPTY with a warning, rather than inventing a price", () => {
    const newLine = RFX.lines.find((l) => PRIOR.V5.prices[l.id] === undefined);
    assert.ok(newLine, "demo data should have at least one line without a prior price");
    const n = run({ V5: extraction([sameAsLastYear(newLine!.id)]) });
    const c = cellOf(n, "V5", newLine!.id);
    assert.equal(c.status, "missing");
    assert.equal(c.unit_inr, null);
    assert.ok(codes(c).includes("NO_PRIOR_PRICE"));
  });

  it("a vendor with no prior contract at all cannot use 'same as last year'", () => {
    const n = run({ V1: extraction([sameAsLastYear("L01")]) });
    assert.equal(cellOf(n, "V1", "L01").status, "missing");
  });

  it("a group rule ('all RSC at ₹X') applied to a non-RSC line is flagged against last year's price", () => {
    const nonRsc = RFX.lines.find((l) => l.type !== "RSC" && PRIOR.V5.prices[l.id] !== undefined)!;
    assert.ok(nonRsc);
    const n = run({ V5: extraction([line(nonRsc.id, 3.9, { derived_from: "rule", source: { file: "mail", location: "", quote: "all boxes at 3.90" } })]) });
    const c = cellOf(n, "V5", nonRsc.id);
    assert.ok(codes(c).includes("RULE_VS_PRIOR"));
    assert.equal(c.flags.find((f) => f.code === "RULE_VS_PRIOR")!.sev, "warn");
    assert.equal(c.status, "review");
  });

  it("the same rule on an RSC line is only informational (that is what the rule plainly covers)", () => {
    const n = run({ V5: extraction([line("L01", 3.9, { derived_from: "rule" })]) });
    assert.equal(cellOf(n, "V5", "L01").flags.find((f) => f.code === "RULE_VS_PRIOR")!.sev, "info");
  });
});

describe("5. Spec deviations: a different SPEC is excluded; the same spec in other UNITS is not", () => {
  it("'size given in inches' is a unit, not a different spec", () => {
    for (const t of ["Size given in inches", "Dimensions in inches (7.9 x 5.9 x 3.9)", "Vendor listed size in cm"]) {
      const n = run({ V1: extraction([line("L01", BASE, { spec_deviation: t })]) });
      assert.notEqual(cellOf(n, "V1", "L01").status, "deviation", t);
      assert.ok(!codes(cellOf(n, "V1", "L01")).includes("SPEC_DEVIATION"), t);
    }
  });

  it("a real change (different ply, flute, board, print) is a deviation and stays out of price comparisons", () => {
    for (const t of ["5-ply offered instead of 3-ply", "C-flute offered, B-flute asked", "Lower GSM board", "Size in inches but 5-ply board instead"]) {
      const n = run({ V1: extraction([line("L01", BASE, { spec_deviation: t })]) });
      assert.equal(cellOf(n, "V1", "L01").status, "deviation", t);
      assert.equal(vendorOf(n, "V1").total_inr, 0, "deviating lines never count toward totals");
    }
  });
});

describe("6. Size check: code re-verifies which line a price belongs to (photos, messy item names)", () => {
  it("moves a price to the line whose size it actually matches, and says so", () => {
    // 7.9 x 5.9 x 3.9 inch ≈ 200 x 150 x 100 mm = L01, but the model guessed L02
    const n = run({ V1: extraction([line("L02", BASE, { vendor_size: { L: 7.9, W: 5.9, H: 3.9, unit: "inch" }, vendor_ply: 3 })]) });
    const c = cellOf(n, "V1", "L01");
    near(c.unit_inr, BASE);
    assert.ok(codes(c).includes("REMATCHED"));
    assert.equal(c.status, "review");
    assert.equal(cellOf(n, "V1", "L02").status, "missing");
  });

  it("drops a price whose written size fits NO line, rather than trusting the model's guess", () => {
    const n = run({ V1: extraction([line("L01", BASE, { vendor_size: { L: 1000, W: 1000, H: 1000, unit: "mm" }, vendor_ply: 3 })]) });
    assert.equal(cellOf(n, "V1", "L01").status, "missing");
    assert.ok(vendorOf(n, "V1").flags.some((f) => f.code === "UNMATCHED_ITEMS"));
  });

  it("a size that agrees with the model's match is left alone (no false REMATCHED)", () => {
    const n = run({ V1: extraction([line("L01", BASE, { vendor_size: { L: 200, W: 150, H: 100, unit: "mm" }, vendor_ply: 3 })]) });
    assert.ok(!codes(cellOf(n, "V1", "L01")).includes("REMATCHED"));
    assert.equal(cellOf(n, "V1", "L01").status, "ok");
  });

  it("two vendor items on one line: keeps the better size match and warns about the duplicate", () => {
    const n = run({
      V1: extraction([
        line("L01", 9.9, { vendor_item_text: "approx", vendor_size: { L: 205, W: 155, H: 105, unit: "mm" }, vendor_ply: 3 }),
        line("L01", BASE, { vendor_item_text: "exact", vendor_size: { L: 200, W: 150, H: 100, unit: "mm" }, vendor_ply: 3 }),
      ]),
    });
    const c = cellOf(n, "V1", "L01");
    near(c.unit_inr, BASE);
    assert.ok(codes(c).includes("DUPLICATE"));
  });
});

describe("7. Review queue: what makes a number 'amber' (needs the buyer) versus trusted", () => {
  it("a clean, confident, explicit price is trusted without review", () => {
    assert.equal(cellOf(run({ V1: extraction([line("L01", BASE)]) }), "V1", "L01").status, "ok");
  });

  it("low read or match confidence goes to review", () => {
    for (const over of [{ read_confidence: 0.5 }, { match_confidence: 0.6 }]) {
      const c = cellOf(run({ V1: extraction([line("L01", BASE, over)]) }), "V1", "L01");
      assert.ok(codes(c).includes("LOW_CONFIDENCE"));
      assert.equal(c.status, "review");
    }
  });

  it("the threshold is the buyer's to change", () => {
    const c = cellOf(run({ V1: extraction([line("L01", BASE, { read_confidence: 0.85 })]) }, { assumptions: { review_threshold: 0.9 } }), "V1", "L01");
    assert.equal(c.status, "review");
  });

  it("an unreadable price is empty and flagged, never zero", () => {
    const c = cellOf(run({ V1: extraction([line("L01", null)]) }), "V1", "L01");
    assert.equal(c.status, "missing");
    assert.equal(c.unit_inr, null);
    assert.ok(codes(c).includes("UNREADABLE"));
  });

  it("a price far from what other vendors quoted is flagged (needs 3+ vendors to have a peer view)", () => {
    const n = run({
      V1: extraction([line("L01", 3.4)]),
      V2: extraction([line("L01", 3.45)], { freight: { included: true, note: "", source: null } }),
      V3: extraction([line("L01", 7.0)]),
    });
    assert.ok(codes(cellOf(n, "V3", "L01")).includes("OUTLIER"));
    assert.equal(cellOf(n, "V3", "L01").status, "review");
    assert.ok(!codes(cellOf(n, "V1", "L01")).includes("OUTLIER"));
  });

  it("two vendors are not enough for an outlier call (no false alarms on thin data)", () => {
    const n = run({ V1: extraction([line("L01", 3.4)]), V3: extraction([line("L01", 7.0)]) });
    assert.ok(!codes(cellOf(n, "V3", "L01")).includes("OUTLIER"));
  });

  it("the vendor's own total is cross-checked against their line prices × our quantities", () => {
    const total = BASE * L01.annual_qty;
    const src = { file: "q", location: "", quote: "Total" };
    const ok = run({ V1: extraction([line("L01", BASE)], { stated_total: { amount: total, currency: "INR", note: "", source: src } }) });
    assert.ok(vendorOf(ok, "V1").flags.some((f) => f.code === "TOTAL_OK"));
    const bad = run({ V1: extraction([line("L01", BASE)], { stated_total: { amount: total * 1.1, currency: "INR", note: "", source: src } }) });
    assert.ok(vendorOf(bad, "V1").flags.some((f) => f.code === "TOTAL_MISMATCH"));
  });
});

describe("8. The buyer decides: accept, override or exclude, and the numbers follow", () => {
  const lowConf = () => extraction([line("L01", BASE, { read_confidence: 0.5 })]);

  it("accept clears the amber flag but keeps the price", () => {
    const c = cellOf(run({ V1: lowConf() }, { overrides: { "V1|L01": override("accept") } }), "V1", "L01");
    assert.equal(c.status, "ok");
    near(c.unit_inr, BASE);
  });

  it("override replaces the price and flows into annual value", () => {
    const c = cellOf(run({ V1: lowConf() }, { overrides: { "V1|L01": override("override", 3.1) } }), "V1", "L01");
    near(c.unit_inr, 3.1);
    near(c.annual_inr, 3.1 * L01.annual_qty);
    assert.equal(c.status, "ok");
  });

  it("exclude removes the price from every total", () => {
    const n = run({ V1: lowConf() }, { overrides: { "V1|L01": override("exclude") } });
    assert.equal(cellOf(n, "V1", "L01").status, "excluded");
    assert.equal(vendorOf(n, "V1").total_inr, 0);
  });
});

describe("9. Qualification: must-haves decide who may win; proof is checked by code, not taken on trust", () => {
  const Q = (id: string, assessment: "pass" | "fail" | "partial" | "unanswered") => ({ question_id: id, answer: assessment, assessment, reasoning: "", source: null });
  const withQ = (over: Record<string, "pass" | "fail" | "partial" | "unanswered">, docs?: any) => {
    const ex = extraction([line("L01", BASE)]);
    ex.questionnaire = ex.questionnaire.map((x) => (over[x.question_id] ? Q(x.question_id, over[x.question_id]) : x));
    if (docs !== undefined) ex.documents = docs;
    return ex;
  };

  it("all must-haves passed with a valid certificate → approved", () => {
    assert.equal(vendorOf(run({ V1: withQ({}) }), "V1").qualification, "qualified");
  });

  it("an EXPIRED ISO certificate fails the must-have even though the vendor (and the model) said 'yes'", () => {
    const expired = [{ file: "iso.pdf", kind: "ISO 9001 certificate", summary: "ISO 9001:2015", valid_until: "2026-03-31" }];
    const n = run({ V1: withQ({ Q1: "pass" }, expired) });
    const v = vendorOf(n, "V1");
    assert.equal(v.qualification, "not_qualified");
    const q1 = n.q.find((x) => x.vendor_id === "V1" && x.question_id === "Q1")!;
    assert.equal(q1.assessment, "fail");
    assert.match(q1.auto_note || "", /expired on 2026-03-31/);
    assert.ok(v.qual_reasons.some((r) => r.startsWith("Q1")));
  });

  it("a certificate valid on the RFx due date still counts; it is judged against the event date, not today", () => {
    const edge = [{ file: "iso.pdf", kind: "ISO 9001 certificate", summary: "ISO 9001", valid_until: RFX.due_date }];
    assert.equal(vendorOf(run({ V1: withQ({}, edge) }), "V1").qualification, "qualified");
  });

  it("claiming ISO without attaching a certificate downgrades to 'needs proof', not approved", () => {
    const n = run({ V1: withQ({ Q1: "pass" }, []) });
    assert.equal(vendorOf(n, "V1").qualification, "conditional");
    assert.match(n.q.find((x) => x.vendor_id === "V1" && x.question_id === "Q1")!.auto_note || "", /no certificate/i);
  });

  it("a must-have left unanswered is NOT approved (no evidence = not qualified)", () => {
    assert.equal(vendorOf(run({ V1: withQ({ Q2: "unanswered" }) }), "V1").qualification, "not_qualified");
  });

  it("a must-have that is only partly met → 'needs proof' for the buyer to judge", () => {
    assert.equal(vendorOf(run({ V1: withQ({ Q3: "partial" }) }), "V1").qualification, "conditional");
  });

  it("a failed nice-to-have (not a must-have) does not disqualify", () => {
    assert.equal(vendorOf(run({ V1: withQ({ Q7: "fail", Q9: "fail" }) }), "V1").qualification, "qualified");
  });

  it("the buyer can override an assessment (e.g. after seeing proof) and the status follows", () => {
    const n = run({ V1: withQ({ Q3: "partial" }) }, { qOverrides: { "V1|Q3": "pass" } });
    assert.equal(vendorOf(n, "V1").qualification, "qualified");
    assert.equal(n.q.find((x) => x.question_id === "Q3")!.overridden, true);
  });
});

describe("10. The like-for-like index does not require every vendor to quote every line", () => {
  it("spend-weighted % over the cheapest, on the lines each vendor actually quoted", () => {
    const n = run({ V1: extraction([line("L01", 3.0)]), V2: extraction([line("L01", 3.3)], { freight: { included: true, note: "", source: null } }) });
    near(vendorOf(n, "V1").avg_over_best_pct, 0);
    near(vendorOf(n, "V2").avg_over_best_pct, 10, 1e-6);
  });

  it("a deviating price is never used as the 'best' price", () => {
    const n = run({ V1: extraction([line("L01", 2.0, { spec_deviation: "2-ply instead of 3-ply" })]), V2: extraction([line("L01", 3.3)]) });
    near(vendorOf(n, "V2").avg_over_best_pct, 0);
  });
});

// A fixed review-threshold default so a change to the demo defaults is noticed
describe("defaults the buyer sees", () => {
  it("review threshold and ₹/kg band are the documented ones", () => {
    assert.equal(A.review_threshold, 0.8);
    assert.deepEqual(A.per_kg_band, [25, 90]);
  });
});
