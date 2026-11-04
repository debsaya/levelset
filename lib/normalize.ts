// Deterministic normalisation: the model reads, this code calculates.
// Every conversion is recorded as a step so the buyer can audit any number on screen.
import type { Assumptions, CellOverride, ExtractedLine, PriorContracts, Rfx, SourceRef, VendorResponse, Adjustment } from "./types";

export type Sev = "info" | "warn" | "block";
export type Flag = { code: string; sev: Sev; msg: string };
export type Step = { label: string; value: string };
export type CellStatus = "ok" | "review" | "missing" | "deviation" | "excluded";

export type Cell = {
  vendor_id: string;
  line_id: string;
  status: CellStatus;
  quoted_as: string;
  unit_inr: number | null;
  unit_inr_if_rebate: number | null;
  annual_inr: number | null;
  per_kg: number | null;
  confidence: number | null;
  flags: Flag[];
  steps: Step[];
  source: SourceRef | null;
  derived_from: string | null;
  override?: CellOverride;
  raw?: ExtractedLine;
  missing_reason?: string;
};

export type QCell = {
  vendor_id: string;
  question_id: string;
  answer: string;
  assessment: "pass" | "fail" | "partial" | "unanswered";
  reasoning: string;
  auto_note?: string;
  overridden?: boolean;
  source: SourceRef | null;
};

export type VendorSummary = {
  vendor_id: string;
  name: string;
  format: string;
  qualification: "qualified" | "conditional" | "not_qualified";
  qual_reasons: string[];
  quoted: number;
  missing: number;
  review: number;
  deviation: number;
  total_inr: number;
  total_if_rebate_inr: number;
  basket_total_inr: number;
  flags: Flag[];
  terms: { currency: string; payment: number | null; lead: number | null; validity: number | null; freight: string; tax: string };
  adjustments: Adjustment[];
};

export type Normalized = {
  cells: Cell[];
  q: QCell[];
  vendors: VendorSummary[];
  basket: string[];
  cellMap: Record<string, Cell>;
};

export const key = (v: string, l: string) => `${v}|${l}`;

export function inr(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "–";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function crore(n: number) {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inr(n, 0);
}
const num = (n: number, d = 4) => n.toLocaleString("en-IN", { maximumFractionDigits: d });

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function normalize(
  rfx: Rfx,
  responses: VendorResponse[],
  a: Assumptions,
  overrides: Record<string, CellOverride>,
  qOverrides: Record<string, "pass" | "fail" | "partial" | "unanswered">,
  prior: PriorContracts
): Normalized {
  const done = responses.filter((r) => r.status === "done" && r.extraction);
  const cells: Cell[] = [];
  const q: QCell[] = [];
  const vendors: VendorSummary[] = [];
  const lineById = Object.fromEntries(rfx.lines.map((l) => [l.id, l]));

  for (const r of done) {
    const ex = r.extraction!;
    const vid = r.vendor.id;
    const vflags: Flag[] = [];
    const gst = ex.tax?.gst_rate_pct ?? null;
    const freightIncluded = ex.freight?.included;
    const freightRate = a.freight_inr_per_kg[vid] ?? a.default_freight_inr_per_kg;
    const uncondPct = (ex.adjustments || [])
      .filter((d) => (d.kind === "discount" || d.kind === "rebate") && !d.conditional && d.pct)
      .reduce((s, d) => s + (d.pct || 0), 0);
    const condPct = (ex.adjustments || [])
      .filter((d) => (d.kind === "discount" || d.kind === "rebate") && d.conditional && d.pct)
      .reduce((s, d) => s + (d.pct || 0), 0);

    // pick one extracted line per RFx line (highest confidence), note duplicates
    const byLine: Record<string, ExtractedLine[]> = {};
    for (const el of ex.lines || []) {
      if (!el.rfx_line_id || !lineById[el.rfx_line_id]) continue;
      (byLine[el.rfx_line_id] ||= []).push(el);
    }

    for (const line of rfx.lines) {
      const k = key(vid, line.id);
      const ov = overrides[k];
      const cands = byLine[line.id] || [];
      const el = [...cands].sort((x, y) => Math.min(y.match_confidence, y.read_confidence) - Math.min(x.match_confidence, x.read_confidence))[0];
      const flags: Flag[] = [];
      const steps: Step[] = [];
      if (cands.length > 1) flags.push({ code: "DUPLICATE", sev: "warn", msg: `${cands.length} vendor items mapped to this line: ${cands.map((c) => `"${c.vendor_item_text}"`).join(", ")}. Kept the most confident.` });

      if (!el) {
        const nq = (ex.not_quoted || []).find((n) => n.rfx_line_id === line.id);
        cells.push({ vendor_id: vid, line_id: line.id, status: ov?.action === "override" ? "ok" : "missing", quoted_as: "Not quoted", unit_inr: ov?.action === "override" ? ov.unit_inr ?? null : null, unit_inr_if_rebate: null, annual_inr: ov?.action === "override" && ov.unit_inr ? ov.unit_inr * line.annual_qty : null, per_kg: null, confidence: null, flags, steps, source: null, derived_from: null, override: ov, missing_reason: nq?.reason || "Not mentioned in the response" });
        continue;
      }

      let price = el.price;
      let currency = (el.currency || ex.currency || "INR").toUpperCase();
      let basisUnit = el.basis_unit;
      let basisQty = el.basis_qty || 1;
      let quotedAs = "";
      const conf = Math.min(el.match_confidence ?? 0, el.read_confidence ?? 0);

      if (el.derived_from === "prior_contract") {
        const pc = prior[vid];
        const pp = pc?.prices?.[line.id];
        if (pp === undefined) {
          cells.push({ vendor_id: vid, line_id: line.id, status: ov?.action === "override" ? "ok" : "missing", quoted_as: `"${el.source?.quote}"`, unit_inr: ov?.unit_inr ?? null, unit_inr_if_rebate: null, annual_inr: ov?.unit_inr ? ov.unit_inr * line.annual_qty : null, per_kg: null, confidence: conf, flags: [{ code: "NO_PRIOR_PRICE", sev: "warn", msg: `Vendor referred to last year's price, but ${line.id} ${line.is_new ? "is a new line this year" : "is not in the prior contract"}. Ask the vendor for a price.` }], steps, source: el.source, derived_from: el.derived_from, override: ov, raw: el, missing_reason: "Referred to last year's price, but there is none for this line" });
          continue;
        }
        price = pp;
        currency = "INR";
        basisUnit = "piece";
        basisQty = 1;
        quotedAs = `${inr(pp)} /pc (FY26 contract)`;
        steps.push({ label: "Vendor said", value: `"${el.source?.quote}"` });
        steps.push({ label: `Prior contract ${pc.contract_ref}`, value: `${inr(pp)} per piece` });
        flags.push({ code: "PRIOR_CONTRACT", sev: "info", msg: `Price pulled from ${pc.contract_ref} (${pc.period}) because the vendor wrote "${el.source?.quote}". Not re-quoted.` });
      } else {
        const unitLabel = basisUnit === "kg" ? "kg" : basisQty === 1 ? "pc" : `${basisQty} pcs`;
        quotedAs = `${currency === "INR" ? "₹" : currency + " "}${num(price ?? 0)} / ${unitLabel}`;
        steps.push({ label: "Quoted", value: `${quotedAs}${el.derived_from === "rule" ? " (group rule)" : ""}` });
      }

      if (price === null || price === undefined || isNaN(price)) {
        cells.push({ vendor_id: vid, line_id: line.id, status: "missing", quoted_as: "Unreadable", unit_inr: null, unit_inr_if_rebate: null, annual_inr: null, per_kg: null, confidence: conf, flags: [{ code: "UNREADABLE", sev: "warn", msg: "A price was referenced but could not be read." }], steps, source: el.source, derived_from: el.derived_from, override: ov, raw: el, missing_reason: "Unreadable" });
        continue;
      }

      // 1. to per piece
      let v = price;
      if (basisUnit === "kg") {
        v = price * line.est_weight_kg;
        steps.push({ label: "Per kg → per piece", value: `× ${line.est_weight_kg} kg/pc (weight computed from RFx spec) = ${num(v)}` });
        flags.push({ code: "PER_KG", sev: "info", msg: `Quoted per kg; converted using the RFx's computed box weight (${line.est_weight_kg} kg). Actual box weight may differ by a few %.` });
      } else if (basisQty !== 1) {
        v = price / basisQty;
        steps.push({ label: `Per ${basisQty} → per piece`, value: `÷ ${basisQty} = ${num(v)}` });
      }
      // 2. currency
      if (currency !== "INR") {
        if (currency === "USD") {
          v = v * a.fx_usd_inr;
          steps.push({ label: "USD → INR", value: `× ${a.fx_usd_inr} (buyer's rate${ex.fx_rate_stated ? `; vendor's reference ${ex.fx_rate_stated}` : ""}) = ${num(v)}` });
          flags.push({ code: "FX", sev: "info", msg: `Converted from USD at ₹${a.fx_usd_inr}. Vendor invoices in INR at the RBI rate on invoice date, so the INR price will move with the currency.` });
        } else {
          flags.push({ code: "FX_UNKNOWN", sev: "block", msg: `Currency ${currency} has no conversion rate configured.` });
        }
      }
      // 3. tax
      if (el.tax_included) {
        const rate = gst ?? 5;
        v = v / (1 + rate / 100);
        steps.push({ label: "Remove GST", value: `÷ ${1 + rate / 100} (${rate}% GST was included) = ${num(v)}` });
        flags.push({ code: "GST_INCLUDED", sev: gst === null ? "warn" : "info", msg: `Vendor's price included GST${gst === null ? "; rate not stated, assumed 5%" : ` at ${rate}%`}; removed for like-for-like comparison.` });
      }
      // 4. unconditional discounts
      if (uncondPct) {
        v = v * (1 - uncondPct / 100);
        steps.push({ label: "Discount", value: `× ${1 - uncondPct / 100} (${uncondPct}% unconditional) = ${num(v)}` });
      }
      const preFreight = v;
      // 5. freight
      let freightAdd = 0;
      if (freightIncluded === false) {
        freightAdd = freightRate * line.est_weight_kg;
        v = v + freightAdd;
        steps.push({ label: "Add freight", value: `+ ₹${freightRate}/kg × ${line.est_weight_kg} kg = +${num(freightAdd)} (buyer's freight assumption)` });
        flags.push({ code: "FREIGHT_ADDED", sev: "info", msg: `Ex-works quote; added estimated freight of ₹${freightRate}/kg to the plant.` });
      } else if (freightIncluded === null || freightIncluded === undefined) {
        flags.push({ code: "FREIGHT_UNCLEAR", sev: "warn", msg: "Freight terms not stated; treated as delivered. Confirm with the vendor." });
      }
      const ifRebate = condPct ? preFreight * (1 - condPct / 100) + freightAdd : v;
      if (condPct && a.apply_conditional_rebates) {
        v = ifRebate;
        steps.push({ label: "Conditional rebate", value: `${condPct}% applied (buyer chose to count it) = ${num(v)}` });
        flags.push({ code: "CONDITIONAL_REBATE", sev: "info", msg: `Includes a ${condPct}% rebate that only applies if its condition is met.` });
      } else if (condPct) flags.push({ code: "CONDITIONAL_REBATE", sev: "info", msg: `A ${condPct}% conditional rebate is not counted in this price (would be ${inr(ifRebate)}).` });

      // 6. checks
      const perKg = v / line.est_weight_kg;
      if (perKg < a.per_kg_band[0] || perKg > a.per_kg_band[1]) flags.push({ code: "UNIT_SUSPECT", sev: "warn", msg: `Implies ₹${perKg.toFixed(1)}/kg, outside the ₹${a.per_kg_band[0]}–${a.per_kg_band[1]}/kg band for corrugated. Likely a unit or reading error (per piece vs per 100?).` });
      if (conf < a.review_threshold) flags.push({ code: "LOW_CONFIDENCE", sev: "warn", msg: `Model confidence ${Math.round(conf * 100)}% (match ${Math.round((el.match_confidence ?? 0) * 100)}%, read ${Math.round((el.read_confidence ?? 0) * 100)}%).${el.note ? " " + el.note : ""}` });
      else if (el.note) flags.push({ code: "NOTE", sev: "info", msg: el.note });
      if (el.derived_from === "rule") flags.push({ code: "RULE", sev: "info", msg: `Derived from a group statement: "${el.source?.quote}".` });

      steps.push({ label: "Landed, ex-GST", value: `${inr(v)} per ${line.uom}` });

      let status: CellStatus = el.spec_deviation ? "deviation" : flags.some((f) => f.sev !== "info") ? "review" : "ok";
      if (el.spec_deviation) flags.unshift({ code: "SPEC_DEVIATION", sev: "warn", msg: `Different spec offered: ${el.spec_deviation}` });
      let unit: number | null = v;
      if (ov?.action === "exclude") {
        status = "excluded";
        unit = null;
      } else if (ov?.action === "override" && ov.unit_inr !== undefined) {
        status = "ok";
        steps.push({ label: "Buyer override", value: `${inr(ov.unit_inr)} — ${ov.note || "no note"}` });
        unit = ov.unit_inr;
      } else if (ov?.action === "accept") status = "ok";

      cells.push({
        vendor_id: vid,
        line_id: line.id,
        status,
        quoted_as: quotedAs,
        unit_inr: unit,
        unit_inr_if_rebate: unit === null ? null : ov?.action === "override" ? unit : ifRebate,
        annual_inr: unit === null ? null : unit * line.annual_qty,
        per_kg: unit === null ? null : unit / line.est_weight_kg,
        confidence: conf,
        flags,
        steps,
        source: el.source,
        derived_from: el.derived_from,
        override: ov,
        raw: el,
      });
    }

    // stated total cross-check (in vendor's own terms, against RFx quantities)
    if (ex.stated_total && ex.stated_total.amount) {
      let sum = 0;
      for (const el of ex.lines || []) {
        const line = el.rfx_line_id ? lineById[el.rfx_line_id] : null;
        if (!line || el.price === null || el.derived_from === "prior_contract") continue;
        const per = el.basis_unit === "kg" ? el.price * line.est_weight_kg : el.price / (el.basis_qty || 1);
        sum += per * line.annual_qty;
      }
      const diff = sum - ex.stated_total.amount;
      if (Math.abs(diff) / ex.stated_total.amount > 0.005)
        vflags.push({ code: "TOTAL_MISMATCH", sev: "warn", msg: `Vendor's own total (${ex.stated_total.currency} ${ex.stated_total.amount.toLocaleString("en-IN")}) differs from their line prices × RFx quantities (${sum.toLocaleString("en-IN", { maximumFractionDigits: 0 })}) by ${diff.toLocaleString("en-IN", { maximumFractionDigits: 0 })}. We use line prices, not their total.` });
      else vflags.push({ code: "TOTAL_OK", sev: "info", msg: "Vendor's stated total reconciles with their line prices." });
    }
    for (const u of ex.unresolved || []) vflags.push({ code: "MODEL_NOTE", sev: "info", msg: u });

    // questionnaire
    const qreasons: string[] = [];
    let anyFail = false,
      allPass = true;
    for (const qq of rfx.questionnaire) {
      const ans = (ex.questionnaire || []).find((x) => x.question_id === qq.id);
      let assessment = ans?.assessment || "unanswered";
      let auto_note: string | undefined;
      if (/certif/i.test(qq.text) && /iso/i.test(qq.text)) {
        const cert = (ex.documents || []).find((d) => /iso|9001|certif/i.test(d.kind + " " + d.summary) && d.valid_until);
        if (cert && cert.valid_until && cert.valid_until < rfx.due_date) {
          assessment = "fail";
          auto_note = `Attached certificate expired on ${cert.valid_until} (checked by system).`;
        } else if (!cert && assessment === "pass") {
          assessment = "partial";
          auto_note = "Claimed, but no certificate with a validity date was attached.";
        }
      }
      const ovq = qOverrides[key(vid, qq.id)];
      const eff = ovq || assessment;
      q.push({ vendor_id: vid, question_id: qq.id, answer: ans?.answer || "Not answered", assessment: eff, reasoning: ans?.reasoning || "", auto_note, overridden: !!ovq, source: ans?.source || null });
      if (qq.must_have) {
        // Must-haves: a fail or no answer at all disqualifies (no evidence = not qualified);
        // partial evidence keeps the vendor in as "conditional" for the buyer to judge.
        if (eff === "fail" || eff === "unanswered") {
          anyFail = true;
          qreasons.push(`${qq.id} ${eff === "fail" ? "failed" : "not answered"}${auto_note ? ": " + auto_note : ""}`);
        }
        if (eff !== "pass") {
          allPass = false;
          if (eff === "partial") qreasons.push(`${qq.id} ${eff}${auto_note ? ": " + auto_note : ""}`);
        }
      }
    }
    const qualification = anyFail ? "not_qualified" : allPass ? "qualified" : "conditional";

    const vc = cells.filter((c) => c.vendor_id === vid);
    vendors.push({
      vendor_id: vid,
      name: r.vendor.name,
      format: r.vendor.format,
      qualification,
      qual_reasons: qreasons,
      quoted: vc.filter((c) => c.unit_inr !== null).length,
      missing: vc.filter((c) => c.status === "missing").length,
      review: vc.filter((c) => c.status === "review").length,
      deviation: vc.filter((c) => c.status === "deviation").length,
      total_inr: vc.reduce((s, c) => s + (c.status !== "deviation" && c.annual_inr ? c.annual_inr : 0), 0),
      total_if_rebate_inr: vc.reduce((s, c) => {
        const l = lineById[c.line_id];
        return s + (c.status !== "deviation" && c.unit_inr_if_rebate ? c.unit_inr_if_rebate * l.annual_qty : 0);
      }, 0),
      basket_total_inr: 0,
      flags: vflags,
      terms: {
        currency: ex.currency,
        payment: ex.payment_terms_days,
        lead: ex.lead_time_days,
        validity: ex.validity_days,
        freight: ex.freight?.included === true ? "Delivered" : ex.freight?.included === false ? "Ex-works (freight added)" : "Not stated",
        tax: ex.tax?.basis === "exclusive" ? `Ex-GST${ex.tax.gst_rate_pct ? ` (${ex.tax.gst_rate_pct}%)` : ""}` : ex.tax?.basis === "mixed" ? "Mixed (normalised)" : ex.tax?.basis === "inclusive" ? "Incl. GST (removed)" : "Unclear",
      },
      adjustments: ex.adjustments || [],
    });
  }

  // like-for-like basket: lines every responding vendor priced at the asked spec
  const basket = rfx.lines
    .filter((l) => vendors.length > 0 && vendors.every((v) => cells.find((c) => c.vendor_id === v.vendor_id && c.line_id === l.id && c.unit_inr !== null && c.status !== "deviation")))
    .map((l) => l.id);
  for (const v of vendors) {
    v.basket_total_inr = cells.filter((c) => c.vendor_id === v.vendor_id && basket.includes(c.line_id)).reduce((s, c) => s + (c.annual_inr || 0), 0);
  }

  // peer outlier check (needs everyone normalised first)
  for (const l of rfx.lines) {
    const lc = cells.filter((c) => c.line_id === l.id && c.unit_inr !== null && c.status !== "deviation");
    for (const c of lc) {
      const others = lc.filter((o) => o !== c).map((o) => o.unit_inr!) as number[];
      const m = median(others);
      if (m && others.length >= 2) {
        const ratio = c.unit_inr! / m;
        if (ratio > 1.6 || ratio < 0.6) {
          c.flags.push({ code: "OUTLIER", sev: "warn", msg: `${ratio > 1 ? Math.round((ratio - 1) * 100) + "% above" : Math.round((1 - ratio) * 100) + "% below"} the median of other vendors (${inr(m)}). Check the unit or the line match.` });
          if (c.status === "ok" && !c.override) c.status = "review";
        }
      }
    }
  }
  for (const v of vendors) v.review = cells.filter((c) => c.vendor_id === v.vendor_id && c.status === "review").length;

  const cellMap = Object.fromEntries(cells.map((c) => [key(c.vendor_id, c.line_id), c]));
  return { cells, q, vendors, basket, cellMap };
}
