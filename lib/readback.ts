// "Read-back" before an award: the same check a careful buyer does by phone ("I have you at 3.40 for the 200x150x100 box, correct?").
// Built by code from the vendor's own quote, so the numbers in the email are exact and never retyped by a model.
import type { Normalized } from "./normalize";
import { runScenario } from "./award";
import type { Rfx } from "./types";

export const READBACK_MAX = 40;

/** One issue line for the clarification email, or null if this vendor has no lines in the current best award. */
export function readBackIssue(vendorId: string, n: Normalized, rfx: Rfx): string | null {
  const won = runScenario(rfx, n, {}).rows.filter((r) => r.vendor_id === vendorId);
  if (!won.length) return null;
  const top = [...won].sort((a, b) => b.annual_value_inr - a.annual_value_inr).slice(0, READBACK_MAX);
  const items = top.map((r) => {
    const c = n.cellMap[`${vendorId}|${r.line_id}`];
    const desc = rfx.lines.find((l) => l.id === r.line_id)?.description || r.line_id;
    const raw = c?.raw;
    // when the price needed no conversion, say it once; when it did (per 100, USD, GST...), show what they wrote beside what we read
    const plain = !!raw && raw.derived_from === "explicit" && raw.basis_unit === "piece" && (raw.basis_qty || 1) === 1 && raw.price !== null && c.unit_inr !== null && Math.abs(raw.price - c.unit_inr) < 0.005;
    if (plain) return `${r.line_id} ${desc}: ₹${r.unit_price_inr.toFixed(2)} per piece`;
    const quote = c?.source?.quote && c.source.quote.length <= 70 ? ` ("${c.source.quote}")` : "";
    return `${r.line_id} ${desc}: you wrote ${c?.quoted_as || "a price"}${quote}; we read it as ₹${r.unit_price_inr.toFixed(2)} per piece`;
  });
  const more = won.length > top.length ? ` (plus ${won.length - top.length} smaller items)` : "";
  return `READ-BACK before we finalise: please confirm the prices we have for you on ${won.length} items, answering "correct" or giving the right price for each. Where you quoted in another unit, we show what you wrote and what we read. ${items.join("; ")}${more}.`;
}
