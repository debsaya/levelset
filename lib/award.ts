// Deterministic award scenarios over the normalised comparison. No model involved.
import type { Normalized } from "./normalize";
import type { PriorContracts, Rfx } from "./types";

export type Scenario = {
  key: string;
  label: string;
  detail: string;
  total: number;
  linesCovered: number;
  linesMissing: string[];
  vendorsUsed: { vendor_id: string; name: string; lines: number; value: number }[];
  unverified: number;
};

function usable(c: { unit_inr: number | null; status: string }) {
  return c.unit_inr !== null && c.status !== "deviation" && c.status !== "excluded" && c.status !== "missing";
}

export function scenarios(rfx: Rfx, n: Normalized): Scenario[] {
  const out: Scenario[] = [];
  const name = Object.fromEntries(n.vendors.map((v) => [v.vendor_id, v.name]));
  const split = (key: string, label: string, detail: string, allowed: string[]) => {
    let total = 0,
      unverified = 0;
    const missing: string[] = [];
    const used: Record<string, { lines: number; value: number }> = {};
    for (const l of rfx.lines) {
      const cs = n.cells.filter((c) => c.line_id === l.id && allowed.includes(c.vendor_id) && usable(c));
      if (!cs.length) {
        missing.push(l.id);
        continue;
      }
      const best = cs.sort((a, b) => a.unit_inr! - b.unit_inr!)[0];
      total += best.annual_inr || 0;
      if (best.status === "review") unverified++;
      used[best.vendor_id] ||= { lines: 0, value: 0 };
      used[best.vendor_id].lines++;
      used[best.vendor_id].value += best.annual_inr || 0;
    }
    out.push({
      key,
      label,
      detail,
      total,
      linesCovered: rfx.lines.length - missing.length,
      linesMissing: missing,
      vendorsUsed: Object.entries(used)
        .map(([vendor_id, x]) => ({ vendor_id, name: name[vendor_id], ...x }))
        .sort((a, b) => b.value - a.value),
      unverified,
    });
  };
  const q = n.vendors.filter((v) => v.qualification === "qualified").map((v) => v.vendor_id);
  const qc = n.vendors.filter((v) => v.qualification !== "not_qualified").map((v) => v.vendor_id);
  // best single qualified vendor (most lines, then lowest total)
  const singles = q
    .map((vid) => {
      const cs = n.cells.filter((c) => c.vendor_id === vid && usable(c));
      return { vid, lines: cs.length, total: cs.reduce((s, c) => s + (c.annual_inr || 0), 0) };
    })
    .sort((a, b) => b.lines - a.lines || a.total - b.total);
  if (singles[0]) split("single", `All to ${name[singles[0].vid]}`, "Cheapest qualified vendor that quoted the most lines", [singles[0].vid]);
  if (q.length) split("split_q", "Split: cheapest qualified per line", "Each line to the lowest landed price among qualified vendors", q);
  // drop the split if it lands on exactly the single-vendor answer
  if (out.length === 2 && out[0].vendorsUsed.length === 1 && out[1].vendorsUsed.length === 1 && Math.abs(out[0].total - out[1].total) < 1) {
    out[0].detail = `Lowest qualified price on every item it quoted, so splitting saves nothing`;
    out.pop();
  }
  if (qc.length > q.length) split("split_qc", "Split incl. conditional vendors", "Adds vendors with a partly-met must-have (buyer's call)", qc);
  return out;
}

/** Last year's cost of the lines that have a FY26 contract price, at FY26 rates (vendor-quoted basis). */
export function lastYear(rfx: Rfx, prior: PriorContracts, s: Scenario | undefined, n: Normalized) {
  const pc = Object.values(prior)[0];
  if (!pc || !s) return null;
  const lines = rfx.lines.filter((l) => pc.prices[l.id] !== undefined && !s.linesMissing.includes(l.id));
  if (!lines.length) return null;
  const allowed = s.vendorsUsed.map((v) => v.vendor_id);
  let fy26 = 0,
    now = 0;
  for (const l of lines) {
    fy26 += pc.prices[l.id] * l.annual_qty;
    const cs = n.cells.filter((c) => c.line_id === l.id && allowed.includes(c.vendor_id) && usable(c)).sort((a, b) => a.unit_inr! - b.unit_inr!);
    now += cs[0]?.annual_inr || 0;
  }
  return { lines: lines.length, fy26, now, delta: now - fy26, ref: pc.contract_ref };
}
