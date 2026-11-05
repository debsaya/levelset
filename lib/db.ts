"use client";
// In-browser SQLite (sql.js) built from the normalised comparison. The analyst's SQL runs here,
// so every number the buyer sees in a table or chart comes from this database, not from the model.
import type { Normalized } from "./normalize";
import type { PriorContracts, Rfx, VendorResponse, Assumptions } from "./types";

let SQLp: Promise<any> | null = null;
function loadSql(): Promise<any> {
  if (SQLp) return SQLp;
  SQLp = new Promise((resolve, reject) => {
    const w = window as any;
    const init = () => w.initSqlJs({ locateFile: (f: string) => f }).then(resolve, reject);
    if (w.initSqlJs) return init();
    const s = document.createElement("script");
    s.src = "sql-wasm.js";
    s.onload = init;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return SQLp;
}

export const SCHEMA_DOC = `Tables (SQLite):
rfx_lines(line_id TEXT, description TEXT, item_type TEXT, ply INT, length_mm INT, width_mm INT, height_mm INT, print TEXT, end_use TEXT, annual_qty INT, uom TEXT, est_weight_kg REAL, is_new INT)
vendors(vendor_id TEXT, vendor_name TEXT, city TEXT, response_format TEXT, qualification TEXT -- 'qualified' | 'conditional' | 'not_qualified', qualification_reason TEXT, lines_priced INT, lines_missing INT, cells_needing_review INT, quote_currency TEXT, payment_terms_days INT, lead_time_days INT, validity_days INT, freight_terms TEXT, tax_terms TEXT)
quotes(vendor_id TEXT, line_id TEXT, status TEXT -- 'ok' | 'review' | 'missing' | 'deviation' | 'excluded', unit_price_inr REAL -- landed at plant, ex-GST, INR per piece; NULL if missing, unit_price_inr_if_rebate REAL, annual_value_inr REAL, implied_inr_per_kg REAL, confidence REAL, needs_review INT, quoted_as TEXT -- original price as the vendor wrote it, derived_from TEXT -- explicit | rule | prior_contract, flags TEXT, source_file TEXT, source_quote TEXT)
questionnaire(vendor_id TEXT, question_id TEXT, question TEXT, must_have INT, answer TEXT, assessment TEXT -- pass | fail | partial | unanswered, note TEXT)
vendor_terms(vendor_id TEXT, kind TEXT -- discount | rebate | one_time_charge | surcharge, description TEXT, pct REAL, amount REAL, conditional INT, condition TEXT)
prior_prices(vendor_id TEXT, line_id TEXT, unit_price_inr REAL -- last year's contract price, per piece ex-works, ex-GST)`;

export async function buildDb(rfx: Rfx, n: Normalized, responses: VendorResponse[], prior: PriorContracts) {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run(`CREATE TABLE rfx_lines(line_id TEXT, description TEXT, item_type TEXT, ply INT, length_mm INT, width_mm INT, height_mm INT, print TEXT, end_use TEXT, annual_qty INT, uom TEXT, est_weight_kg REAL, is_new INT);
  CREATE TABLE vendors(vendor_id TEXT, vendor_name TEXT, city TEXT, response_format TEXT, qualification TEXT, qualification_reason TEXT, lines_priced INT, lines_missing INT, cells_needing_review INT, quote_currency TEXT, payment_terms_days INT, lead_time_days INT, validity_days INT, freight_terms TEXT, tax_terms TEXT);
  CREATE TABLE quotes(vendor_id TEXT, line_id TEXT, status TEXT, unit_price_inr REAL, unit_price_inr_if_rebate REAL, annual_value_inr REAL, implied_inr_per_kg REAL, confidence REAL, needs_review INT, quoted_as TEXT, derived_from TEXT, flags TEXT, source_file TEXT, source_quote TEXT);
  CREATE TABLE questionnaire(vendor_id TEXT, question_id TEXT, question TEXT, must_have INT, answer TEXT, assessment TEXT, note TEXT);
  CREATE TABLE vendor_terms(vendor_id TEXT, kind TEXT, description TEXT, pct REAL, amount REAL, conditional INT, condition TEXT);
  CREATE TABLE prior_prices(vendor_id TEXT, line_id TEXT, unit_price_inr REAL);`);
  const ins = (sql: string, rows: any[][]) => {
    const st = db.prepare(sql);
    for (const r of rows) st.run(r.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x)));
    st.free();
  };
  ins(
    "INSERT INTO rfx_lines VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    rfx.lines.map((l) => [l.id, l.description, l.type, l.ply, l.dimensions_mm.L, l.dimensions_mm.W, l.dimensions_mm.H, l.print, l.end_use, l.annual_qty, l.uom, l.est_weight_kg, l.is_new])
  );
  const city = Object.fromEntries(responses.map((r) => [r.vendor.id, r.vendor.city]));
  ins(
    "INSERT INTO vendors VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    n.vendors.map((v) => [v.vendor_id, v.name, city[v.vendor_id], v.format, v.qualification, v.qual_reasons.join("; "), v.quoted, v.missing, v.review, v.terms.currency, v.terms.payment, v.terms.lead, v.terms.validity, v.terms.freight, v.terms.tax])
  );
  ins(
    "INSERT INTO quotes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    n.cells.map((c) => [
      c.vendor_id,
      c.line_id,
      c.status,
      c.unit_inr === null ? null : Math.round(c.unit_inr * 100) / 100,
      c.unit_inr_if_rebate === null ? null : Math.round(c.unit_inr_if_rebate * 100) / 100,
      c.annual_inr === null ? null : Math.round(c.annual_inr),
      c.per_kg === null ? null : Math.round(c.per_kg * 10) / 10,
      c.confidence,
      c.status === "review" ? 1 : 0,
      c.quoted_as,
      c.derived_from,
      c.flags.filter((f) => f.sev !== "info").map((f) => f.code).join(",") || (c.missing_reason ?? ""),
      c.source?.file ?? null,
      c.source?.quote ?? null,
    ])
  );
  const qtext = Object.fromEntries(rfx.questionnaire.map((q) => [q.id, q]));
  ins(
    "INSERT INTO questionnaire VALUES (?,?,?,?,?,?,?)",
    n.q.map((q) => [q.vendor_id, q.question_id, qtext[q.question_id]?.text, qtext[q.question_id]?.must_have, q.answer, q.assessment, q.auto_note || q.reasoning])
  );
  ins(
    "INSERT INTO vendor_terms VALUES (?,?,?,?,?,?,?)",
    n.vendors.flatMap((v) => v.adjustments.map((a) => [v.vendor_id, a.kind, a.description, a.pct, a.amount, a.conditional, a.condition]))
  );
  ins(
    "INSERT INTO prior_prices VALUES (?,?,?)",
    Object.entries(prior).flatMap(([vid, pc]) => Object.entries(pc.prices).map(([lid, p]) => [vid, lid, p]))
  );
  return db;
}

export type QueryResult = { columns: string[]; rows: any[][]; error?: string };

export function runQuery(db: any, sql: string, limit = 500): QueryResult {
  const clean = sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(clean) || /;\s*\S/.test(clean) || /\b(insert|update|delete|drop|alter|create|attach|pragma)\b/i.test(clean.replace(/'[^']*'/g, "")))
    return { columns: [], rows: [], error: "Only a single read-only SELECT/WITH query is allowed." };
  try {
    const res = db.exec(clean);
    if (!res.length) return { columns: [], rows: [] };
    return { columns: res[0].columns, rows: res[0].values.slice(0, limit) };
  } catch (e: any) {
    return { columns: [], rows: [], error: e?.message || String(e) };
  }
}

export function contextDoc(a: Assumptions, n: Normalized) {
  return `${SCHEMA_DOC}

Current buyer assumptions: USD→INR ${a.fx_usd_inr}; freight added for ex-works vendors at ₹/kg ${JSON.stringify(a.freight_inr_per_kg)} (default ${a.default_freight_inr_per_kg}); conditional rebates counted: ${a.apply_conditional_rebates ? "yes" : "no"}; review threshold ${a.review_threshold}.
Vendors in this event: ${n.vendors.map((v) => `${v.vendor_id}=${v.name} (${v.qualification})`).join(", ")}.
Like-for-like basket (lines every vendor priced at spec): ${n.basket.join(", ") || "none"}.`;
}

export function vendorFacts(n: Normalized, a: Assumptions) {
  const lines = n.vendors.map((v) => {
    const cells = n.cells.filter((c) => c.vendor_id === v.vendor_id);
    const missing = cells.filter((c) => c.status === "missing").map((c) => c.line_id);
    const dev = cells.filter((c) => c.status === "deviation").map((c) => c.line_id);
    const adj = v.adjustments.length
      ? v.adjustments.map((x) => `${x.kind}${x.pct ? " " + x.pct + "%" : ""}${x.amount ? " ₹" + x.amount : ""}${x.conditional ? ` CONDITIONAL on ${x.condition} (not counted in unit_price_inr)` : ""}: ${x.description}`).join("; ")
      : "none";
    return `- ${v.vendor_id} ${v.name}: ${v.qualification.toUpperCase()}${v.qual_reasons.length ? ` (${v.qual_reasons.join("; ")})` : ""}. Replied as: ${v.format}. Priced ${v.quoted}/${cells.length} lines${missing.length ? `; no price for ${missing.join(", ")}` : ""}${dev ? (dev.length ? `; alternate spec on ${dev.join(", ")}` : "") : ""}. Currency ${v.terms.currency}; ${v.terms.freight}${v.terms.freight.startsWith("Ex-works") ? ` at ₹${a.freight_inr_per_kg[v.vendor_id] ?? a.default_freight_inr_per_kg}/kg` : ""}; tax ${v.terms.tax}; payment ${v.terms.payment ?? "?"} days; lead time ${v.terms.lead ?? "?"} days. Discounts/rebates/charges: ${adj}. Cells needing review: ${v.review}.`;
  });
  return lines.join("\n");
}
