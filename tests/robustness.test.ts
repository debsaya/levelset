// Third batch: hostile and sloppy inputs. The reader (an AI) will sometimes write dates, currencies and
// numbers in odd ways, and buyers make typos. None of that may turn into a wrong number or a crash.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScenario, scenarios } from "../lib/award";
import { checkGrounding } from "../lib/grounding";
import { currencyCode, isoDate } from "../lib/normalize";
import { A, RFX, cellOf, codes, extraction, line, override, run, vendorOf } from "./helpers";

const near = (a: number | null, b: number, tol = 1e-6) => assert.ok(a !== null && Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);
const BASE = 3.4;
const SRC = { file: "q", location: "", quote: "" };
const adj = (kind: any, pct: number | null, conditional = false) => ({ kind, pct, amount: null, conditional, condition: null, description: kind, source: SRC });

describe("Dates written however the reader wrote them", () => {
  it("reads ISO and day-first dates; refuses to guess the rest", () => {
    assert.equal(isoDate("2027-06-30"), "2027-06-30");
    assert.equal(isoDate("2027-06-30T00:00:00Z"), "2027-06-30");
    assert.equal(isoDate("30/06/2027"), "2027-06-30");
    assert.equal(isoDate("5-3-2025"), "2025-03-05"); // India: day first
    assert.equal(isoDate("31/13/2027"), null);
    assert.equal(isoDate("June 2027"), null);
    assert.equal(isoDate("valid for 3 years"), null);
    assert.equal(isoDate(null), null);
  });

  it("a day-first expired certificate is still caught (string comparison alone would call '15/03/2025' valid or not by luck)", () => {
    for (const [d, expect] of [["15/03/2025", "fail"], ["30/06/2028", "pass"]] as const) {
      const ex = extraction([line("L01", BASE)], { documents: [{ file: "i.pdf", kind: "ISO 9001 certificate", summary: "", valid_until: d }] });
      assert.equal(run({ V1: ex }).q.find((x) => x.question_id === "Q1")!.assessment, expect, d);
    }
  });

  it("a certificate date that can't be read is 'needs proof', never silently approved", () => {
    const ex = extraction([line("L01", BASE)], { documents: [{ file: "i.pdf", kind: "ISO 9001 certificate", summary: "", valid_until: "valid till next year" }] });
    const n = run({ V1: ex });
    assert.equal(vendorOf(n, "V1").qualification, "conditional");
    assert.match(n.q.find((x) => x.question_id === "Q1")!.auto_note || "", /could not be read/);
  });

  it("a quote dated '10/11/2026' (day-first) is read correctly for the validity check", () => {
    assert.ok(vendorOf(run({ V1: extraction([line("L01", BASE)], { quote_date: "10/09/2026", validity_days: 30 }) }), "V1").flags.some((f) => f.code === "QUOTE_EXPIRED"));
  });
});

describe("Currency written however the vendor wrote it", () => {
  it("maps the usual spellings; anything else stays unknown", () => {
    for (const c of ["INR", "inr", "Rs", "Rs.", "₹", "Rupees", null, ""]) assert.equal(currencyCode(c as any), "INR", String(c));
    for (const c of ["USD", "usd", "$", "US$"]) assert.equal(currencyCode(c), "USD", c);
    assert.equal(currencyCode("EUR"), "EUR");
  });

  it("a price in 'Rs.' is not blocked as an unknown currency", () => {
    const c = cellOf(run({ V1: extraction([line("L01", BASE, { currency: "Rs." })]) }), "V1", "L01");
    near(c.unit_inr, BASE);
    assert.ok(!codes(c).includes("FX_UNKNOWN"));
  });
});

describe("Buyer typos cannot corrupt the numbers", () => {
  it("an override with a blank/NaN/zero/negative price is ignored, so the cell stays in review instead of becoming ₹0 or NaN", () => {
    for (const bad of [NaN, 0, -5, undefined, null as any]) {
      const n = run({ V1: extraction([line("L01", BASE, { read_confidence: 0.5 })]) }, { overrides: { "V1|L01": { ...override("override"), unit_inr: bad } } });
      const c = cellOf(n, "V1", "L01");
      near(c.unit_inr, BASE);
      assert.equal(c.status, "review", String(bad));
      assert.ok(Number.isFinite(vendorOf(n, "V1").total_inr));
    }
  });
});

describe("Discounts that are too good to be true", () => {
  it("a 100% (or more) discount cannot produce a ₹0 price that wins", () => {
    for (const pct of [100, 150]) {
      const n = run({ V1: extraction([line("L01", BASE)], { adjustments: [adj("discount", pct)] }), V2: extraction([line("L01", BASE)]) });
      assert.equal(cellOf(n, "V1", "L01").status, "missing", String(pct));
      assert.equal(runScenario(RFX, n, { eligibility: "all" }).rows[0].vendor_id, "V2");
    }
  });

  it("a negative or zero pack size never produces a negative price", () => {
    const n = run({ V1: extraction([line("L01", BASE, { basis_qty: -100 })]) });
    assert.notEqual(cellOf(n, "V1", "L01").status, "ok");
    assert.ok((cellOf(n, "V1", "L01").unit_inr ?? 1) > 0);
    near(cellOf(run({ V1: extraction([line("L01", BASE, { basis_qty: 0 })]) }), "V1", "L01").unit_inr, BASE); // 0 means "not stated", i.e. per piece
  });
});

describe("The vendor's own total", () => {
  const total = (amount: number, currency = "INR") => ({ amount, currency, note: "", source: SRC });
  const sum = BASE * RFX.lines[0].annual_qty;

  it("a total that is exactly the lines plus GST is recognised as including tax, not as an error in the lines", () => {
    const v = vendorOf(run({ V1: extraction([line("L01", BASE)], { stated_total: total(sum * 1.18) }) }), "V1");
    const f = v.flags.find((x) => x.code === "TOTAL_MISMATCH")!;
    assert.match(f.msg, /about 18% GST/);
  });

  it("a total in a different currency is not compared (and says so) instead of a false mismatch", () => {
    const v = vendorOf(run({ V1: extraction([line("L01", BASE)], { stated_total: total(10000, "USD") }) }), "V1");
    assert.ok(v.flags.some((x) => x.code === "TOTAL_CURRENCY"));
    assert.ok(!v.flags.some((x) => x.code === "TOTAL_MISMATCH"));
  });
});

describe("Unknown words are not mistaken for ISO", () => {
  it("a question about 'precision' or 'isolation' does not trigger the ISO certificate check", () => {
    const rfx = structuredClone(RFX);
    rfx.questionnaire = [{ id: "Q1", text: "Do you hold a certification for moisture isolation and precision die-cutting?", kind: "yes_no", must_have: true }];
    const ex = extraction([line("L01", BASE)], { documents: [{ file: "x.pdf", kind: "ISO 9001 certificate", summary: "", valid_until: "2020-01-01" }] });
    const n = run({ V1: ex }, { rfx });
    assert.equal(n.q[0].assessment, "pass");
    assert.equal(n.q[0].auto_note, undefined);
  });
});

describe("Size matching under unit confusion", () => {
  it("numbers written in mm but labelled inches fit no line and are left out visibly rather than matched wrongly", () => {
    const n = run({ V1: extraction([line("L01", BASE, { vendor_size: { L: 200, W: 150, H: 100, unit: "inch" }, vendor_ply: 3 })]) });
    assert.equal(cellOf(n, "V1", "L01").status, "missing");
    assert.ok(vendorOf(n, "V1").flags.some((f) => f.code === "UNMATCHED_ITEMS"));
  });

  it("a ply that no RFx line asks for is left out visibly rather than forced onto a 3-ply line", () => {
    const n = run({ V1: extraction([line("L01", BASE, { vendor_size: { L: 200, W: 150, H: 100, unit: "mm" }, vendor_ply: 9 })]) });
    assert.equal(cellOf(n, "V1", "L01").status, "missing");
  });

  it("a vendor who writes only length and width (flat items) still matches", () => {
    const n = run({ V1: extraction([line("L25", 12.0, { vendor_size: { L: 1200, W: 1000, H: null, unit: "mm" }, vendor_ply: 3 })]) });
    near(cellOf(n, "V1", "L25").unit_inr, 12.0);
  });

  it("length and width written the other way round still match", () => {
    const n = run({ V1: extraction([line("L02", 5.5, { vendor_size: { L: 200, W: 250, H: 150, unit: "mm" }, vendor_ply: 3 })]) });
    near(cellOf(n, "V1", "L02").unit_inr, 5.5);
    assert.ok(!codes(cellOf(n, "V1", "L02")).includes("REMATCHED"));
  });
});

describe("Sloppy extractions: the reader omitted whole sections", () => {
  it("missing tax, freight, adjustments, documents, questionnaire and totals neither crash nor qualify the vendor", () => {
    const bare: any = { vendor_name: "V", currency: "INR", lines: [line("L01", BASE)] };
    const n = run({ V1: bare });
    const c = cellOf(n, "V1", "L01");
    near(c.unit_inr, BASE);
    assert.ok(codes(c).includes("FREIGHT_UNCLEAR"));
    assert.equal(vendorOf(n, "V1").qualification, "not_qualified"); // no evidence, no approval
  });

  it("missing confidence scores fail safe: the number goes to review, not into trusted totals", () => {
    const l: any = line("L01", BASE);
    delete l.match_confidence;
    delete l.read_confidence;
    assert.equal(cellOf(run({ V1: extraction([l]) }), "V1", "L01").status, "review");
  });

  it("vendors still being read, or failed, are not part of the comparison", () => {
    const n = run({ V1: extraction([line("L01", BASE)]) });
    assert.equal(n.vendors.length, 1);
  });
});

describe("Awards with nothing to award", () => {
  it("no approved vendors: scenarios and the calculator return empty, not errors", () => {
    const ex = extraction([line("L01", BASE)]);
    ex.questionnaire = ex.questionnaire.map((q) => ({ ...q, assessment: "fail" as const }));
    const n = run({ V1: ex });
    assert.deepEqual(scenarios(RFX, n), []);
    const r = runScenario(RFX, n, { eligibility: "qualified", strategy: "single_vendor" });
    assert.equal(r.total_annual_value_inr, 0);
    assert.equal(r.lines_awarded, 0);
    assert.equal(r.vendors_excluded.length, 1);
  });

  it("naming a vendor id that doesn't exist gives an empty award, not a crash", () => {
    const r = runScenario(RFX, run({ V1: extraction([line("L01", BASE)]) }), { vendor_ids: ["V9"] });
    assert.equal(r.lines_awarded, 0);
  });

  it("a tie goes to the same vendor every time", () => {
    const mk = () => runScenario(RFX, run({ V1: extraction([line("L01", BASE)]), V2: extraction([line("L01", BASE)]) }), { eligibility: "all" }).rows[0].vendor_id;
    assert.equal(mk(), mk());
  });

  it("an explicit vendor list overrides approval, and says who was left out", () => {
    const r = runScenario(RFX, run({ V1: extraction([line("L01", 3.5)]), V2: extraction([line("L01", 3.3)]) }), { vendor_ids: ["V1"] });
    assert.equal(r.rows[0].vendor_id, "V1");
    assert.equal(r.vendors_excluded[0].vendor, "Vendor V2");
  });
});

describe("Answer checker, harder cases", () => {
  it("percentages match whether the data holds 6.3 or 0.063", () => {
    assert.deepEqual(checkGrounding("That is 6.3% higher.", [6.3]).ungrounded, []);
    assert.deepEqual(checkGrounding("That is 6.3% higher.", [0.063]).ungrounded, []);
    assert.deepEqual(checkGrounding("That is 7.3% higher.", [0.063]).ungrounded, ["7.3%"]);
  });

  it("rounding in lakh/crore is accepted, a different magnitude is not", () => {
    assert.deepEqual(checkGrounding("About ₹4.51 Cr.", [45123456]).ungrounded, []);
    assert.deepEqual(checkGrounding("About ₹45.1 Cr.", [45123456]).ungrounded, ["₹45.1 Cr"]);
  });

  it("prose with no numbers is fine, and small counts are not policed", () => {
    assert.deepEqual(checkGrounding("Two vendors are out and 1 is conditional.", []), { checked: 0, ungrounded: [] });
  });

  it("a made-up unit price is caught even when it looks plausible", () => {
    assert.deepEqual(checkGrounding("Kaveri quoted ₹3.41 per piece.", [3.4, 3.45]).ungrounded, ["₹3.41"]);
  });

  it("negative figures match their absolute value in the data (a saving written as positive)", () => {
    assert.deepEqual(checkGrounding("A saving of ₹2,50,000.", [-250000]).ungrounded, []);
  });
});

describe("Defaults", () => {
  it("a default run has no hidden dependence on the assumption object being shared", () => {
    const before = JSON.stringify(A);
    run({ V1: extraction([line("L01", BASE)]) }, { assumptions: { fx_usd_inr: 1 } });
    assert.equal(JSON.stringify(A), before);
  });
});
