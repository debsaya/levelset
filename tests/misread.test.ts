// Fourth batch: "what if the AI reads it wrong?" Each test simulates a plausible misreading of a correct quote
// and asserts it cannot slip into the totals as a trusted number.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScenario } from "../lib/award";
import { A, RFX, cellOf, codes, extraction, line, run, vendorOf } from "./helpers";

const SRC = { file: "q", location: "", quote: "" };
const price = (id: string) => Math.round(41 * RFX.lines.find((l) => l.id === id)!.est_weight_kg * 100) / 100; // ₹41/kg: mid-band, realistic
const w = (id: string) => RFX.lines.find((l) => l.id === id)!.est_weight_kg;

describe("Misreads can never enter the totals as trusted numbers (every one of the 30 lines)", () => {
  const ids = RFX.lines.map((l) => l.id);
  type Bad = { p: number; basis_unit?: "kg" | "piece"; basis_qty?: number; currency?: string };
  // The vendor quotes per piece (true price ₹41/kg × box weight); one line is misread:
  const perPiece: [string, (id: string) => Bad][] = [
    ["decimal point shifted right (×10)", (id) => ({ p: price(id) * 10 })],
    ["decimal point shifted left (÷10)", (id) => ({ p: price(id) / 10 })],
    ["two digits too many (×100)", (id) => ({ p: price(id) * 100 })],
    ["two digits too few (÷100)", (id) => ({ p: price(id) / 100 })],
    ["per-piece price read as 'per 100'", (id) => ({ p: price(id), basis_qty: 100 })],
    ["per-piece price read as per kg", (id) => ({ p: price(id), basis_unit: "kg" })],
    ["INR price read as USD", (id) => ({ p: price(id), currency: "USD" })],
    ["USD price read as INR", (id) => ({ p: price(id) / A.fx_usd_inr })],
  ];
  // The vendor quotes per kg (₹41/kg); one line is misread:
  const perKg: [string, (id: string) => Bad][] = [
    ["decimal point shifted right (×10)", () => ({ p: 410, basis_unit: "kg" })],
    ["decimal point shifted left (÷10)", () => ({ p: 4.1, basis_unit: "kg" })],
    ["per-kg price read as per piece", () => ({ p: 41, basis_unit: "piece" })],
    ["per-kg price read as per 100", () => ({ p: 41, basis_unit: "kg", basis_qty: 100 })],
  ];

  it("the clean baselines are trusted on every line (so the checks below are meaningful)", () => {
    for (const mk of [(id: string) => line(id, price(id)), (id: string) => line(id, 41, { basis_unit: "kg" as const })]) {
      const n = run({ V1: extraction(ids.map(mk)) });
      for (const id of ids) assert.equal(cellOf(n, "V1", id).status, "ok", id);
    }
  });

  for (const [ctx, list, clean] of [
    ["quotes per piece", perPiece, (id: string) => line(id, price(id))],
    ["quotes per kg", perKg, (id: string) => line(id, 41, { basis_unit: "kg" as const })],
  ] as const) {
    for (const [name, f] of list) {
      it(`${name}: vendor ${ctx}`, () => {
        for (const id of ids) {
          const { p, ...rest } = f(id);
          const others = ids.filter((x) => x !== id).slice(0, 6).map(clean); // the rest of the quote is read correctly
          const c = cellOf(run({ V1: extraction([...others, line(id, p, rest)]) }), "V1", id);
          assert.notEqual(c.status, "ok", `${id} slipped through as trusted at ₹${c.unit_inr}`);
        }
      });
    }
  }
});

describe("A misread low price is the dangerous one, because the award picks the cheapest", () => {
  const market = (winner: number) => run({ V1: extraction([line("L01", winner)]), V2: extraction([line("L01", 3.5)]), V3: extraction([line("L01", 3.55)]) });

  it("a winner more than 15% below the next-best offer is reported for checking", () => {
    const r = runScenario(RFX, market(2.8), { eligibility: "all" });
    assert.equal(r.winning_prices_far_below_next_best.length, 1);
    assert.equal(r.winning_prices_far_below_next_best[0].line_id, "L01");
    assert.ok(r.winning_prices_far_below_next_best[0].below_next_best_pct > 15);
  });

  it("an ordinary lead (a few %) is not reported", () => {
    assert.equal(runScenario(RFX, market(3.3), { eligibility: "all" }).winning_prices_far_below_next_best.length, 0);
  });

  it("a very low price is also caught by the peer check before it gets that far (needs 3 vendors)", () => {
    const c = cellOf(market(1.8), "V1", "L01");
    assert.ok(codes(c).includes("OUTLIER"));
    assert.equal(c.status, "review");
  });

  it("a line with only one eligible offer has no 'next best' and raises nothing", () => {
    const r = runScenario(RFX, run({ V1: extraction([line("L01", 3.4)]) }), { eligibility: "all" });
    assert.equal(r.winning_prices_far_below_next_best.length, 0);
  });
});

describe("Freight read the opposite way to what the vendor wrote", () => {
  const fr = (included: boolean | null, note: string) => extraction([line("L01", 3.4), line("L02", 5.6)], { freight: { included, note, source: null } });

  it("'freight extra' read as delivered is flagged on the vendor and on every price", () => {
    const n = run({ V1: fr(true, "Rates ex-works, freight extra at actuals") });
    assert.ok(vendorOf(n, "V1").flags.some((f) => f.code === "FREIGHT_CONFLICT"));
    for (const id of ["L01", "L02"]) assert.equal(cellOf(n, "V1", id).status, "review");
  });

  it("'delivered to plant' read as ex-works is flagged too", () => {
    const n = run({ V1: fr(false, "Prices are delivered to your Bidadi plant") });
    assert.ok(vendorOf(n, "V1").flags.some((f) => f.code === "FREIGHT_CONFLICT"));
  });

  it("consistent wording raises nothing, including 'no extra charges' phrasing", () => {
    for (const [inc, note] of [[true, "Delivered, no extra charges for freight"], [false, "Ex-works Peenya, freight extra"], [true, ""], [true, "FOR destination"]] as const) {
      assert.ok(!vendorOf(run({ V1: fr(inc, note) }), "V1").flags.some((f) => f.code === "FREIGHT_CONFLICT"), note);
    }
  });
});

describe("GST not stated at all", () => {
  it("is surfaced on the vendor: a 5–18% error could hide in it", () => {
    const n = run({ V1: extraction([line("L01", 3.4)], { tax: { basis: "unclear", gst_rate_pct: null, note: "", source: null } }) });
    assert.ok(vendorOf(n, "V1").flags.some((f) => f.code === "TAX_UNCLEAR"));
  });

  it("stays quiet when tax is stated, or when any line is marked inclusive", () => {
    assert.ok(!vendorOf(run({ V1: extraction([line("L01", 3.4)]) }), "V1").flags.some((f) => f.code === "TAX_UNCLEAR"));
    const mixed = extraction([line("L01", 3.57, { tax_included: true })], { tax: { basis: "unclear", gst_rate_pct: 5, note: "", source: null } });
    assert.ok(!vendorOf(run({ V1: mixed }), "V1").flags.some((f) => f.code === "TAX_UNCLEAR"));
  });
});

describe("Discounts read as unconditional that aren't", () => {
  const d = (description: string, pct: number, conditional = false) => ({ kind: "rebate" as const, pct, amount: null, conditional, condition: null, description, source: SRC });

  it("a rebate whose own wording sets a condition is NOT counted, even if the reader called it unconditional", () => {
    const n = run({ V1: extraction([line("L01", 3.4)], { adjustments: [d("5% on annual offtake above ₹1 Cr, settled by credit note", 5)] }) });
    assert.ok(Math.abs(cellOf(n, "V1", "L01").unit_inr! - 3.4) < 1e-9);
    assert.ok(vendorOf(n, "V1").flags.some((f) => f.code === "ADJ_CONDITION"));
    assert.ok(Math.abs(cellOf(n, "V1", "L01").unit_inr_if_rebate! - 3.4 * 0.95) < 1e-9, "the 'if earned' price is still shown");
  });

  it("a plain unconditional discount is still counted", () => {
    const n = run({ V1: extraction([line("L01", 3.4)], { adjustments: [d("2% cash discount on all items", 2)] }) });
    assert.ok(Math.abs(cellOf(n, "V1", "L01").unit_inr! - 3.4 * 0.98) < 1e-9);
    assert.ok(!vendorOf(n, "V1").flags.some((f) => f.code === "ADJ_CONDITION"));
  });

  it("a percentage that looks like a fraction (0.05) or is implausibly large (40) is flagged", () => {
    for (const pct of [0.05, 40]) assert.ok(vendorOf(run({ V1: extraction([line("L01", 3.4)], { adjustments: [d("discount", pct)] }) }), "V1").flags.some((f) => f.code === "ADJ_SCALE"), String(pct));
  });

  it("a surcharge is never hidden by condition wording (counting it is the cautious direction)", () => {
    const sur = { kind: "surcharge" as const, pct: 3, amount: null, conditional: false, condition: null, description: "3% fuel surcharge if diesel exceeds ₹100", source: SRC };
    assert.ok(Math.abs(cellOf(run({ V1: extraction([line("L01", 3.4)], { adjustments: [sur] }) }), "V1", "L01").unit_inr! - 3.4 * 1.03) < 1e-9);
  });
});

describe("A price that could belong to two similar items", () => {
  // L09 RSC 400×300×300 and L14 RSC 420×320×280 are close enough that a rounded size fits both
  it("is flagged for the buyer, naming both lines", () => {
    const n = run({ V1: extraction([line("L09", 9.0, { vendor_size: { L: 410, W: 310, H: 290, unit: "mm" }, vendor_ply: 5 })]) });
    const f = n.cells.flatMap((c) => c.flags).find((x) => x.code === "AMBIGUOUS_MATCH");
    assert.ok(f && f.msg.includes("L09") && f.msg.includes("L14"));
  });

  it("an unambiguous size raises nothing", () => {
    const n = run({ V1: extraction([line("L14", 9.0, { vendor_size: { L: 420, W: 320, H: 280, unit: "mm" }, vendor_ply: 5 })]) });
    assert.ok(!n.cells.flatMap((c) => c.flags).some((x) => x.code === "AMBIGUOUS_MATCH"));
  });
});
