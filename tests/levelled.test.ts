import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { levelled } from "../lib/levelled";

const rfx: any = { lines: [{ id: "L1", annual_qty: 100 }, { id: "L2", annual_qty: 100 }, { id: "L3", annual_qty: 100 }] };
const cell = (vendor_id: string, line_id: string, unit_inr: number | null, status = "ok") => ({ vendor_id, line_id, unit_inr, status });
const vend = (vendor_id: string, qualification: string) => ({ vendor_id, qualification });

describe("levelled", () => {
  it("fills a vendor's missing item at the median of the other approved vendors, and flags it as an estimate", () => {
    const n: any = {
      vendors: [vend("A", "qualified"), vend("B", "qualified"), vend("C", "qualified")],
      cells: [cell("A", "L1", 10), cell("A", "L2", 10), cell("A", "L3", 10), cell("B", "L1", 9), cell("B", "L2", 9), cell("C", "L1", 11), cell("C", "L2", 11), cell("C", "L3", 30), cell("B", "L3", null, "missing")],
    };
    const r = levelled(n, rfx);
    assert.equal(r.A.quoted, 3);
    assert.equal(r.B.filled, 1);
    assert.deepEqual(r.B.filledIds, ["L3"]);
    // B quoted L1 and L2 at 9; L3 is filled at the median of A (10) and C (30) = 20
    assert.equal(r.B.total, 9 * 100 * 2 + 20 * 100);
  });

  it("treats a different spec as not quoted", () => {
    const n: any = { vendors: [vend("A", "qualified"), vend("B", "qualified")], cells: [cell("A", "L1", 10), cell("A", "L2", 10), cell("A", "L3", 10), cell("B", "L1", 5), cell("B", "L2", 5), cell("B", "L3", 1, "deviation")] };
    const r = levelled(n, rfx);
    assert.equal(r.B.quoted, 2);
    assert.equal(r.B.filled, 1);
    assert.equal(r.B.total, 5 * 200 + 10 * 100);
  });

  it("measures everyone against the cheapest approved vendor and ignores vendors who are not approved as the baseline", () => {
    const n: any = {
      vendors: [vend("A", "qualified"), vend("B", "qualified"), vend("X", "not_qualified")],
      cells: [...["L1", "L2", "L3"].flatMap((l) => [cell("A", l, 10), cell("B", l, 11), cell("X", l, 5)])],
    };
    const r = levelled(n, rfx);
    assert.equal(r.A.vsLowestApproved, 0);
    assert.ok(Math.abs(r.B.vsLowestApproved! - 10) < 1e-9);
    assert.ok(r.X.vsLowestApproved! < 0);
  });

  it("does not use a not-approved vendor's prices to fill someone else's gap when approved vendors quoted it", () => {
    const n: any = { vendors: [vend("A", "qualified"), vend("B", "qualified"), vend("X", "not_qualified")], cells: [cell("A", "L1", 10), cell("A", "L2", 10), cell("A", "L3", 10), cell("B", "L1", 10), cell("B", "L2", 10), cell("X", "L3", 1)] };
    const r = levelled(n, rfx);
    assert.equal(r.B.total, 3000);
  });

  it("leaves the total empty when an item cannot be priced at all", () => {
    const n: any = { vendors: [vend("A", "qualified")], cells: [cell("A", "L1", 10), cell("A", "L2", 10)] };
    const r = levelled(n, rfx);
    assert.equal(r.A.unfilled, 1);
    assert.equal(r.A.total, null);
  });
});
