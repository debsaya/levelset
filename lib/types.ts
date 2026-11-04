export type RfxLine = {
  id: string;
  description: string;
  type: string;
  ply: number;
  dimensions_mm: { L: number; W: number; H: number };
  flute: string;
  board_gsm: string;
  bursting_factor: string;
  print: string;
  end_use: string;
  annual_qty: number;
  uom: string;
  est_weight_kg: number;
  is_new: boolean;
};

export type Question = { id: string; text: string; kind: "yes_no" | "number" | "text"; must_have: boolean };

export type Rfx = {
  id: string;
  title: string;
  buyer: { company: string; name: string; role: string; plant: string };
  scope: string;
  currency: string;
  due_date: string;
  lines: RfxLine[];
  questionnaire: Question[];
  terms: Record<string, string>;
};

export type VendorMsg = {
  id: string;
  name: string;
  city: string;
  contact: string;
  email: string;
  format: string;
  subject: string;
  received_at: string;
  body: string;
  attachments: string[];
};

export type SourceRef = { file: string; location: string; quote: string };

export type ExtractedLine = {
  rfx_line_id: string | null;
  vendor_item_text: string;
  price: number | null;
  currency: string;
  basis_unit: "piece" | "kg";
  basis_qty: number;
  tax_included: boolean | null;
  derived_from: "explicit" | "rule" | "prior_contract";
  spec_deviation: string | null;
  match_confidence: number;
  read_confidence: number;
  note: string | null;
  vendor_size?: { L: number; W: number; H: number | null; unit: "mm" | "cm" | "inch" } | null;
  vendor_ply?: number | null;
  source: SourceRef;
};

export type Adjustment = {
  kind: "discount" | "rebate" | "one_time_charge" | "surcharge";
  pct: number | null;
  amount: number | null;
  conditional: boolean;
  condition: string | null;
  description: string;
  source: SourceRef;
};

export type QAnswer = {
  question_id: string;
  answer: string;
  assessment: "pass" | "fail" | "partial" | "unanswered";
  reasoning: string;
  source: SourceRef | null;
};

export type DocFact = { file: string; kind: string; summary: string; valid_until: string | null };

export type Extraction = {
  vendor_name: string;
  quote_ref: string | null;
  quote_date: string | null;
  currency: string;
  fx_rate_stated: number | null;
  tax: { basis: "exclusive" | "inclusive" | "mixed" | "unclear"; gst_rate_pct: number | null; note: string; source: SourceRef | null };
  freight: { included: boolean | null; note: string; source: SourceRef | null };
  payment_terms_days: number | null;
  lead_time_days: number | null;
  validity_days: number | null;
  adjustments: Adjustment[];
  lines: ExtractedLine[];
  not_quoted: { rfx_line_id: string; reason: string }[];
  questionnaire: QAnswer[];
  documents: DocFact[];
  stated_total: { amount: number; currency: string; note: string; source: SourceRef } | null;
  unresolved: string[];
};

export type ResponseStatus = "new" | "reading" | "done" | "error";

export type VendorResponse = {
  vendor: VendorMsg;
  status: ResponseStatus;
  extraction?: Extraction;
  error?: string;
  model?: string;
  ms?: number;
};

export type Assumptions = {
  fx_usd_inr: number;
  freight_inr_per_kg: Record<string, number>;
  default_freight_inr_per_kg: number;
  apply_conditional_rebates: boolean;
  per_kg_band: [number, number];
  review_threshold: number;
};

export type CellOverride = {
  action: "accept" | "override" | "exclude";
  unit_inr?: number;
  note: string;
  at: string;
};

export type AuditEntry = { at: string; who: string; what: string };

export type ChatMsg = { role: "user" | "assistant"; text: string; ops?: string[] };

export type PriorContracts = Record<string, { vendor: string; contract_ref: string; period: string; basis: string; prices: Record<string, number> }>;
