// Test fixtures: build the same objects the AI reader produces, so each check can be tested on its own.
// Run with: npm test
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, key } from "../lib/normalize";
import type { Assumptions, CellOverride, Extraction, ExtractedLine, PriorContracts, Rfx, VendorMsg, VendorResponse } from "../lib/types";

const read = (f: string) => JSON.parse(readFileSync(join(process.cwd(), "data", f), "utf8"));

export const RFX: Rfx = read("rfx.json");
export const PRIOR: PriorContracts = read("prior_contracts.json");

/** The demo's default buyer assumptions (same numbers as lib/store.tsx). */
export const A: Assumptions = {
  fx_usd_inr: 88.2,
  freight_inr_per_kg: { V2: 2.2, V4: 0.35, V5: 0.6 },
  default_freight_inr_per_kg: 1.0,
  apply_conditional_rebates: false,
  per_kg_band: [25, 90],
  review_threshold: 0.8,
};

const SRC = { file: "quote.xlsx", location: "row 1", quote: "3.40 per pc" };

export function vendorMsg(id: string): VendorMsg {
  return { id, name: `Vendor ${id}`, city: "Bengaluru", contact: "x", email: "x@example.com", format: "Excel", subject: "Quote", received_at: "2026-11-10", body: "", attachments: [] };
}

/** One extracted price line. Defaults: a clean, confident, per-piece INR price. */
export function line(rfx_line_id: string | null, price: number | null, over: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    rfx_line_id,
    vendor_item_text: `item for ${rfx_line_id}`,
    price,
    currency: "INR",
    basis_unit: "piece",
    basis_qty: 1,
    tax_included: false,
    derived_from: "explicit",
    spec_deviation: null,
    match_confidence: 0.98,
    read_confidence: 0.98,
    note: null,
    source: SRC,
    ...over,
  };
}

const passAll = RFX.questionnaire.map((q) => ({ question_id: q.id, answer: "Yes", assessment: "pass" as const, reasoning: "stated", source: null }));

/** A clean extraction: ex-GST 5%, delivered, ISO certificate valid beyond the RFx due date, all questions passed. */
export function extraction(lines: ExtractedLine[], over: Partial<Extraction> = {}): Extraction {
  return {
    vendor_name: "Vendor",
    quote_ref: "Q-1",
    quote_date: "2026-11-10",
    currency: "INR",
    fx_rate_stated: null,
    tax: { basis: "exclusive", gst_rate_pct: 5, note: "", source: null },
    freight: { included: true, note: "delivered", source: null },
    payment_terms_days: 45,
    lead_time_days: 10,
    validity_days: 30,
    adjustments: [],
    lines,
    not_quoted: [],
    questionnaire: passAll.map((x) => ({ ...x })),
    documents: [{ file: "iso.pdf", kind: "ISO 9001 certificate", summary: "ISO 9001:2015 certificate", valid_until: "2027-06-30" }],
    stated_total: null,
    unresolved: [],
    ...over,
  };
}

export function respond(id: string, ex: Extraction): VendorResponse {
  return { vendor: vendorMsg(id), status: "done", extraction: ex };
}

type Opts = { overrides?: Record<string, CellOverride>; qOverrides?: Record<string, "pass" | "fail" | "partial" | "unanswered">; assumptions?: Partial<Assumptions>; prior?: PriorContracts; rfx?: Rfx };

/** Run the real normaliser over { vendorId: extraction }. */
export function run(by: Record<string, Extraction>, o: Opts = {}) {
  const rfx = o.rfx || RFX;
  const responses = Object.entries(by).map(([id, ex]) => respond(id, ex));
  return normalize(rfx, responses, { ...A, ...(o.assumptions || {}) }, o.overrides || {}, o.qOverrides || {}, o.prior || PRIOR);
}

export const cellOf = (n: ReturnType<typeof run>, v: string, l: string) => {
  const c = n.cellMap[key(v, l)];
  if (!c) throw new Error(`no cell ${v}|${l}`);
  return c;
};
export const codes = (c: { flags: { code: string }[] }) => c.flags.map((f) => f.code);
export const vendorOf = (n: ReturnType<typeof run>, v: string) => n.vendors.find((x) => x.vendor_id === v)!;
export const override = (action: CellOverride["action"], unit_inr?: number): CellOverride => ({ action, unit_inr, note: "test", at: "2026-11-11" });
