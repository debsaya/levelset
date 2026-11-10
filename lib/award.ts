// Deterministic award scenarios over the normalised comparison. No model involved.
import type { Cell, Normalized } from "./normalize";
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
  byLine: Record<string, number>;
  /** line id → vendor that wins it under this rule */
  winners: Record<string, string>;
  /** vendors allowed to win under this rule */
  pool: string[];
};

/** Saving of scenario b over scenario a, counted only on lines both cover. */
export function savingOnCommon(a: Scenario, b: Scenario) {
  let s = 0;
  for (const [l, v] of Object.entries(a.byLine)) if (b.byLine[l] !== undefined) s += v - b.byLine[l];
  return s;
}

/** A price read from a photo or scan (informational; whether it needs a check is decided by the confidence rule in normalize). */
export function fromPhoto(c: Cell): boolean {
  return !!c.from_photo;
}
/** A winning price needs the buyer's eye when it is in the review queue (this includes photo reads below the photo confidence bar). */
export function needsCheck(c: Cell): boolean {
  return c.status === "review";
}

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
    const byLine: Record<string, number> = {};
    const winners: Record<string, string> = {};
    for (const l of rfx.lines) {
      const cs = n.cells.filter((c) => c.line_id === l.id && allowed.includes(c.vendor_id) && usable(c));
      if (!cs.length) {
        missing.push(l.id);
        continue;
      }
      const best = cs.sort((a, b) => a.unit_inr! - b.unit_inr!)[0];
      total += best.annual_inr || 0;
      byLine[l.id] = best.annual_inr || 0;
      winners[l.id] = best.vendor_id;
      if (needsCheck(best)) unverified++;
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
      byLine,
      winners,
      pool: allowed,
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
  if (singles[0]) split("single", `All to ${name[singles[0].vid]}`, "One approved vendor supplies everything: the one who quoted the most items, cheapest if tied", [singles[0].vid]);
  if (q.length) split("split_q", "Split: cheapest approved vendor per item", "Each item goes to whichever approved vendor quoted it lowest", q);
  // drop the split if it lands on exactly the single-vendor answer
  if (out.length === 2 && out[0].vendorsUsed.length === 1 && out[1].vendorsUsed.length === 1 && Math.abs(out[0].total - out[1].total) < 1) {
    out[0].detail = `This vendor already has the lowest approved price on every item they quoted, so splitting saves nothing`;
    out.pop();
  }
  if (qc.length > q.length) split("split_qc", "Split, also using vendors who still need to send proof", "Same rule, but also lets in vendors who still owe proof of a requirement. Only worth it if you accept that risk.", qc);
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

export type ScenarioArgs = {
  eligibility?: "qualified" | "qualified_or_conditional" | "all";
  strategy?: "cheapest_per_line" | "single_vendor";
  vendor_ids?: string[];
  count_conditional_rebates?: boolean;
};

/** General award calculator the analyst can call. Deterministic; returns line-level winners. */
export function runScenario(rfx: Rfx, n: Normalized, a: ScenarioArgs) {
  const elig = a.eligibility || "qualified";
  const pool = n.vendors.filter((v) => (a.vendor_ids?.length ? a.vendor_ids.includes(v.vendor_id) : elig === "all" ? true : elig === "qualified" ? v.qualification === "qualified" : v.qualification !== "not_qualified"));
  const excluded = n.vendors.filter((v) => !pool.includes(v)).map((v) => ({ vendor: v.name, qualification: v.qualification, why: v.qual_reasons.join("; ") || "not selected" }));
  const price = (c: any) => (a.count_conditional_rebates ? c.unit_inr_if_rebate ?? c.unit_inr : c.unit_inr);
  const rows: { line_id: string; vendor_id: string; vendor_name: string; unit_price_inr: number; annual_value_inr: number; status: string; from_photo: boolean; needs_check: boolean }[] = [];
  const missing: string[] = [];
  const pick = (ids: string[]) => {
    rows.length = 0;
    missing.length = 0;
    for (const l of rfx.lines) {
      const cs = n.cells.filter((c) => c.line_id === l.id && ids.includes(c.vendor_id) && usable(c)).sort((x, y) => price(x) - price(y));
      if (!cs.length) {
        missing.push(l.id);
        continue;
      }
      const c = cs[0];
      rows.push({ line_id: l.id, vendor_id: c.vendor_id, vendor_name: n.vendors.find((v) => v.vendor_id === c.vendor_id)!.name, unit_price_inr: Math.round(price(c) * 100) / 100, annual_value_inr: Math.round(price(c) * l.annual_qty), status: c.status, from_photo: fromPhoto(c), needs_check: needsCheck(c) });
    }
  };
  let chosen = pool.map((v) => v.vendor_id);
  if ((a.strategy || "cheapest_per_line") === "single_vendor") {
    const options = pool
      .map((v) => {
        pick([v.vendor_id]);
        return { vid: v.vendor_id, covered: rows.length, total: rows.reduce((s, r) => s + r.annual_value_inr, 0) };
      })
      .sort((x, y) => y.covered - x.covered || x.total - y.total);
    chosen = options[0] ? [options[0].vid] : [];
  }
  pick(chosen);
  // Winner's-curse check: the cheapest price is exactly where a misread number hides (3.40 read as 3.04 wins the line).
  // Flag winners far below the next-best price from a different eligible vendor, whatever their own status says.
  const winnersFarBelowNext = rows
    .map((r) => {
      const others = n.cells.filter((c) => c.line_id === r.line_id && c.vendor_id !== r.vendor_id && chosen.includes(c.vendor_id) && usable(c)).map((c) => price(c) as number);
      if (!others.length) return null;
      const next = Math.min(...others);
      const gap = (next - r.unit_price_inr) / next;
      return gap > 0.15 ? { line_id: r.line_id, winner: r.vendor_name, winning_price_inr: r.unit_price_inr, next_best_price_inr: Math.round(next * 100) / 100, below_next_best_pct: Math.round(gap * 1000) / 10 } : null;
    })
    .filter(Boolean) as { line_id: string; winner: string; winning_price_inr: number; next_best_price_inr: number; below_next_best_pct: number }[];
  const total = rows.reduce((s, r) => s + r.annual_value_inr, 0);
  const byVendor = Object.values(
    rows.reduce((m: Record<string, { vendor: string; lines: number; annual_value_inr: number }>, r) => {
      m[r.vendor_id] ||= { vendor: r.vendor_name, lines: 0, annual_value_inr: 0 };
      m[r.vendor_id].lines++;
      m[r.vendor_id].annual_value_inr += r.annual_value_inr;
      return m;
    }, {})
  ).sort((x, y) => y.annual_value_inr - x.annual_value_inr);
  return { total_annual_value_inr: total, lines_awarded: rows.length, lines_without_eligible_price: missing, unverified_prices_in_award: rows.filter((r) => r.needs_check).length, prices_read_from_photos: rows.filter((r) => r.from_photo).length, winning_prices_far_below_next_best: winnersFarBelowNext, by_vendor: byVendor, vendors_in_pool: pool.map((v) => `${v.name} (${v.qualification})`), vendors_excluded: excluded, rows };
}
