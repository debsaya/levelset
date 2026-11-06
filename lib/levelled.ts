// Bid levelling: put every vendor on the same full scope so partial quotes can be compared fairly.
// Items a vendor did not quote (or quoted on a different spec) are filled at the median of the other approved vendors' prices.
// These fills are estimates for comparison only. The award itself still uses real quotes.
import type { Normalized } from "./normalize";
import type { Rfx } from "./types";

export type Levelled = {
  vendor_id: string;
  /** Items with a real, same-spec price from this vendor. */
  quoted: number;
  /** Items filled with an estimate. */
  filled: number;
  /** Items that could not be filled because nobody else quoted them. */
  unfilled: number;
  filledIds: string[];
  quotedValue: number;
  filledValue: number;
  /** Yearly cost of the full scope, or null when some item could not be priced at all. */
  total: number | null;
  /** % above the cheapest approved vendor on the same full scope (negative if below). Null when not comparable. */
  vsLowestApproved: number | null;
};

type Cell = Normalized["cells"][number];
const usable = (c: Cell) => c.unit_inr !== null && c.unit_inr > 0 && c.status !== "deviation" && c.status !== "excluded" && c.status !== "missing";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function levelled(n: Normalized, rfx: Rfx): Record<string, Levelled> {
  const approved = new Set(n.vendors.filter((v) => v.qualification === "qualified").map((v) => v.vendor_id));
  const out: Record<string, Levelled> = {};
  for (const v of n.vendors) {
    const r: Levelled = { vendor_id: v.vendor_id, quoted: 0, filled: 0, unfilled: 0, filledIds: [], quotedValue: 0, filledValue: 0, total: null, vsLowestApproved: null };
    for (const l of rfx.lines) {
      const mine = n.cells.find((c) => c.vendor_id === v.vendor_id && c.line_id === l.id && usable(c));
      if (mine) {
        r.quoted++;
        r.quotedValue += mine.unit_inr! * l.annual_qty;
        continue;
      }
      const others = n.cells.filter((c) => c.line_id === l.id && c.vendor_id !== v.vendor_id && usable(c));
      const base = others.filter((c) => approved.has(c.vendor_id));
      const pool = base.length ? base : others;
      if (!pool.length) {
        r.unfilled++;
        continue;
      }
      r.filled++;
      r.filledIds.push(l.id);
      r.filledValue += median(pool.map((c) => c.unit_inr!)) * l.annual_qty;
    }
    if (r.unfilled === 0) r.total = r.quotedValue + r.filledValue;
    out[v.vendor_id] = r;
  }
  const totals = n.vendors.filter((v) => approved.has(v.vendor_id)).map((v) => out[v.vendor_id].total).filter((t): t is number => t !== null);
  const lowest = totals.length ? Math.min(...totals) : null;
  if (lowest) for (const r of Object.values(out)) if (r.total !== null) r.vsLowestApproved = (r.total / lowest - 1) * 100;
  return out;
}

/** What the payment terms are worth on a yearly spend: paying `days` later at `ratePct` a year. */
export function creditValue(total: number, days: number | null | undefined, ratePct: number): number {
  if (!days || days <= 0 || ratePct <= 0) return 0;
  return (total * ratePct * days) / (100 * 365);
}
