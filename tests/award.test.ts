// Award scenarios and the answer checker: the other two places where code, not the model, protects the buyer.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScenario, scenarios } from "../lib/award";
import { checkGrounding } from "../lib/grounding";
import { RFX, extraction, line, run } from "./helpers";

const L01 = RFX.lines.find((l) => l.id === "L01")!;
const L02 = RFX.lines.find((l) => l.id === "L02")!;

// V1: approved, mid price. V2: approved, cheaper on L01 only. V3: cheapest everywhere but NOT approved (must-have unanswered).
function market() {
  const v1 = extraction([line("L01", 3.5), line("L02", 5.5)]);
  const v2 = extraction([line("L01", 3.3)]);
  const v3 = extraction([line("L01", 3.0), line("L02", 5.0)]);
  v3.questionnaire = v3.questionnaire.map((q) => (q.question_id === "Q2" ? { ...q, assessment: "unanswered" as const, answer: "" } : q));
  return run({ V1: v1, V2: v2, V3: v3 });
}

describe("Award scenarios", () => {
  it("only approved vendors can win by default, and the excluded vendor is named with the reason", () => {
    const r = runScenario(RFX, market(), { eligibility: "qualified" });
    assert.ok(r.rows.every((x) => x.vendor_id !== "V3"));
    assert.equal(r.vendors_excluded.length, 1);
    assert.match(r.vendors_excluded[0].why, /Q2/);
  });

  it("the cheapest approved vendor wins each line separately", () => {
    const r = runScenario(RFX, market(), { eligibility: "qualified", strategy: "cheapest_per_line" });
    assert.equal(r.rows.find((x) => x.line_id === "L01")!.vendor_id, "V2");
    assert.equal(r.rows.find((x) => x.line_id === "L02")!.vendor_id, "V1");
    assert.equal(r.total_annual_value_inr, Math.round(3.3 * L01.annual_qty) + Math.round(5.5 * L02.annual_qty));
  });

  it("asking to include everyone shows the price of ignoring the must-haves", () => {
    const strict = runScenario(RFX, market(), { eligibility: "qualified" });
    const loose = runScenario(RFX, market(), { eligibility: "all" });
    assert.ok(loose.total_annual_value_inr < strict.total_annual_value_inr);
    assert.ok(loose.rows.every((x) => x.vendor_id === "V3"));
  });

  it("single-vendor awards pick the vendor covering the most lines, and report what is left uncovered", () => {
    const r = runScenario(RFX, market(), { eligibility: "qualified", strategy: "single_vendor" });
    assert.deepEqual(r.by_vendor.map((v) => v.vendor), ["Vendor V1"]);
    assert.ok(r.lines_without_eligible_price.includes("L03")); // nobody quoted it: a gap, not a zero
  });

  it("lines nobody eligible quoted are reported as gaps, never costed at zero", () => {
    const r = runScenario(RFX, market(), {});
    assert.equal(r.lines_awarded, 2);
    assert.equal(r.lines_without_eligible_price.length, RFX.lines.length - 2);
  });

  it("deviating and excluded prices cannot win", () => {
    const dev = extraction([line("L01", 1.0, { spec_deviation: "2-ply instead of 3-ply" })]);
    const ok = extraction([line("L01", 3.4)]);
    const r = runScenario(RFX, run({ V1: dev, V2: ok }), {});
    assert.equal(r.rows[0].vendor_id, "V2");
  });

  it("scenario prices that rest on unverified (amber) cells are counted, so the buyer knows", () => {
    const shaky = extraction([line("L01", 3.0, { read_confidence: 0.4 })]);
    const r = runScenario(RFX, run({ V1: shaky, V2: extraction([line("L01", 3.4)]) }), {});
    assert.equal(r.unverified_prices_in_award, 1);
  });

  it("conditional rebates only count when asked", () => {
    const reb = extraction([line("L01", 3.4)], { adjustments: [{ kind: "rebate", pct: 5, amount: null, conditional: true, condition: "volume", description: "", source: { file: "", location: "", quote: "" } }] });
    const n = run({ V1: reb });
    const without = runScenario(RFX, n, {});
    const withR = runScenario(RFX, n, { count_conditional_rebates: true });
    assert.ok(withR.total_annual_value_inr < without.total_annual_value_inr);
  });

  it("the Overview's preset scenarios never use a vendor that is not approved", () => {
    const s = scenarios(RFX, market());
    for (const sc of s.filter((x) => x.key !== "split_qc")) assert.ok(sc.vendorsUsed.every((v) => v.vendor_id !== "V3"));
  });

  it("every scenario says who wins each priced item, and only from its own pool", () => {
    for (const sc of scenarios(RFX, market())) {
      assert.deepEqual(Object.keys(sc.winners).sort(), Object.keys(sc.byLine).sort());
      assert.ok(Object.values(sc.winners).every((id) => sc.pool.includes(id)));
    }
  });
});

describe("Answer checker: every figure in the AI's prose must trace to a query result from the same turn", () => {
  it("a figure that came from a result passes (any Indian number format)", () => {
    const r = checkGrounding("The best split costs ₹4.51 Cr, or ₹4,51,00,000 exactly, a saving of 6.3%.", [45100000, 6.3]);
    assert.deepEqual(r.ungrounded, []);
    assert.ok(r.checked >= 2);
  });

  it("an invented figure is caught", () => {
    const r = checkGrounding("Award everything to Kaveri for ₹3.20 Cr.", [45100000]);
    assert.deepEqual(r.ungrounded, ["₹3.20 Cr"]);
  });

  it("ISO standard numbers, years, FY labels and line ids are not mistaken for figures", () => {
    const r = checkGrounding("Q1 asks for ISO 9001:2015 on L12 for FY27 in 2026.", []);
    assert.equal(r.checked, 0);
    assert.deepEqual(r.ungrounded, []);
  });

  it("a difference between two displayed totals passes once that difference is in the allowed pool", () => {
    assert.deepEqual(checkGrounding("Splitting saves ₹20.00 L.", [43000000, 45000000, 2000000]).ungrounded, []);
    assert.deepEqual(checkGrounding("Splitting saves ₹25.00 L.", [43000000, 45000000, 2000000]).ungrounded, ["₹25.00 L"]);
  });

  // The question a VP asks: "split it, cheapest per line, only among approved vendors: what does that save?"
  // Comparing totals directly is wrong when the single vendor skipped a line the split can cover.
  it("a split is compared with the best single vendor only on lines both cover, and the extra lines are reported apart", () => {
    const n = run({ V1: extraction([line("L01", 5.0), line("L02", 5.5)]), V2: extraction([line("L01", 3.3), line("L03", 4.0), line("L02", 6.0)]) });
    const r = runScenario(RFX, n, { eligibility: "all" });
    const c = r.comparison_vs_single_vendor!;
    assert.ok(c, "a split result carries the comparison");
    assert.equal(c.single_vendor, "Vendor V2"); // quoted the most lines
    assert.deepEqual(c.lines_only_the_split_covers, []); // V2 covers everything the split does
    assert.equal(c.saving_on_shared_lines_inr, Math.round(6.0 * L02.annual_qty) - Math.round(5.5 * L02.annual_qty));
    assert.ok(c.saving_on_shared_lines_inr >= 0);
  });

  it("lines only the split can cover never make the split look dearer", () => {
    const n = run({ V1: extraction([line("L01", 5.0), line("L02", 5.5)]), V2: extraction([line("L01", 3.3), line("L03", 4.0)]) });
    const r = runScenario(RFX, n, { eligibility: "all" });
    const c = r.comparison_vs_single_vendor!;
    // each single vendor covers 2 of the 3 lines the split covers, so exactly one line is extra scope
    assert.equal(c.lines_only_the_split_covers.length, 1);
    assert.equal(c.lines_compared, 2);
    // the like-for-like saving is never negative: cheapest-per-line is at most any one vendor's price on a shared line
    assert.ok(c.saving_on_shared_lines_inr >= 0);
    // and it differs from the naive difference of totals, which is exactly the trap this guards against
    assert.notEqual(r.total_annual_value_inr - c.single_vendor_total_inr, -c.saving_on_shared_lines_inr);
  });

  it("a single-vendor result carries no comparison with itself", () => {
    const r = runScenario(RFX, market(), { eligibility: "qualified", strategy: "single_vendor" });
    assert.equal(r.comparison_vs_single_vendor, null);
  });
});
