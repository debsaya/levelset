import { generate, parseJson } from "@/lib/gemini";
import { toParts, type InFile } from "@/lib/fileText";
import { heartbeatJson } from "@/lib/stream";

export const runtime = "nodejs";
export const maxDuration = 300;

const S = (description?: string) => ({ type: "string", description });
const SN = (description?: string) => ({ type: "string", nullable: true, description });
const N = (description?: string) => ({ type: "number", description });
const NN = (description?: string) => ({ type: "number", nullable: true, description });
const B = (description?: string) => ({ type: "boolean", description });
const BN = (description?: string) => ({ type: "boolean", nullable: true, description });
const SRC = {
  type: "object",
  properties: {
    file: S("File name, or 'email body'"),
    location: S("Where in the file: sheet+cell (e.g. Quotation!F12), page and region (e.g. p2 footnote), paragraph number, or photo row number"),
    quote: S("Short verbatim snippet (max ~100 chars) exactly as written in the source"),
  },
  required: ["file", "location", "quote"],
};
const SRCN = { ...SRC, nullable: true };

const SCHEMA = {
  type: "object",
  properties: {
    vendor_name: S(),
    quote_ref: SN(),
    quote_date: SN("ISO date if stated"),
    currency: S("Main currency of the quote, ISO code e.g. INR, USD"),
    fx_rate_stated: NN("Exchange rate to INR the vendor states, if any"),
    tax: {
      type: "object",
      properties: {
        basis: { type: "string", enum: ["exclusive", "inclusive", "mixed", "unclear"] },
        gst_rate_pct: NN(),
        note: S(),
        source: SRCN,
      },
      required: ["basis", "gst_rate_pct", "note", "source"],
    },
    freight: {
      type: "object",
      properties: { included: BN("true if delivered to buyer plant at vendor cost; false if ex-works / freight extra; null if not stated"), note: S(), source: SRCN },
      required: ["included", "note", "source"],
    },
    payment_terms_days: NN(),
    lead_time_days: NN(),
    validity_days: NN(),
    adjustments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["discount", "rebate", "one_time_charge", "surcharge"] },
          pct: NN("Percent, e.g. 5 for 5%"),
          amount: NN("Absolute amount in quote currency, if not a percent"),
          conditional: B(),
          condition: SN(),
          description: S(),
          source: SRC,
        },
        required: ["kind", "pct", "amount", "conditional", "condition", "description", "source"],
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rfx_line_id: SN("The buyer's RFx line id this price is for"),
          vendor_item_text: S("How the vendor describes the item, short"),
          price: NN("Price exactly as quoted, before any conversion. null only when derived_from is prior_contract"),
          currency: S(),
          basis_unit: { type: "string", enum: ["piece", "kg"] },
          basis_qty: N("How many basis units the price covers: 1 for per piece, 100 for per 100 nos, 25 for a bundle of 25, 1 for per kg"),
          tax_included: BN(),
          derived_from: { type: "string", enum: ["explicit", "rule", "prior_contract"] },
          spec_deviation: SN("If the vendor offers a different spec than the RFx line, describe it"),
          match_confidence: N("0-1 confidence that this maps to the right RFx line"),
          read_confidence: N("0-1 confidence that the number was read correctly"),
          note: SN("Interpretation or assumption made, if any"),
          vendor_size: {
            type: "object",
            nullable: true,
            description: "The item's size exactly as the vendor wrote it (numbers and unit), or null if the vendor gave no size",
            properties: { L: N(), W: N(), H: NN("null for flat items"), unit: { type: "string", enum: ["mm", "cm", "inch"] } },
            required: ["L", "W", "H", "unit"],
          },
          vendor_ply: NN("Ply as the vendor wrote it, if stated"),
          source: SRC,
        },
        required: ["rfx_line_id", "vendor_item_text", "price", "currency", "basis_unit", "basis_qty", "tax_included", "derived_from", "spec_deviation", "match_confidence", "read_confidence", "note", "vendor_size", "vendor_ply", "source"],
      },
    },
    not_quoted: {
      type: "array",
      items: { type: "object", properties: { rfx_line_id: S(), reason: S() }, required: ["rfx_line_id", "reason"] },
    },
    questionnaire: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_id: S(),
          answer: S("The vendor's answer, condensed; 'Not answered' if absent"),
          assessment: { type: "string", enum: ["pass", "fail", "partial", "unanswered"] },
          reasoning: S("One line: why this assessment"),
          source: SRCN,
        },
        required: ["question_id", "answer", "assessment", "reasoning", "source"],
      },
    },
    documents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: S(),
          kind: S("e.g. quotation, iso_9001_certificate, questionnaire, rate_card, other"),
          summary: S(),
          valid_until: SN("ISO date if the document has an expiry/validity date"),
        },
        required: ["file", "kind", "summary", "valid_until"],
      },
    },
    stated_total: {
      type: "object",
      nullable: true,
      properties: { amount: N(), currency: S(), note: S(), source: SRC },
      required: ["amount", "currency", "note", "source"],
    },
    unresolved: { type: "array", items: S(), description: "Ambiguities or things the buyer must check" },
  },
  required: ["vendor_name", "quote_ref", "quote_date", "currency", "fx_rate_stated", "tax", "freight", "payment_terms_days", "lead_time_days", "validity_days", "adjustments", "lines", "not_quoted", "questionnaire", "documents", "stated_total", "unresolved"],
};

const SYSTEM = `You are the extraction engine of a procurement quote-levelling system. A vendor has replied to a buyer's RFx in whatever format they liked. Your job is to READ, not to calculate: capture exactly what the vendor said, mapped to the buyer's RFx lines, with a citation for every number.

Rules:
1. Record each price exactly as written. Do NOT convert currency, units, tax or freight. The system's code does all arithmetic.
2. basis_unit/basis_qty describe what the price is for: "per 100 nos" -> piece/100; "per bundle (25)" -> piece/25; "per box"/"per pc"/"per set" -> piece/1; "Rs/kg" -> kg/1.
3. Match vendor items to RFx lines by spec: item type, ply, dimensions, print. Vendors may use their own codes, a different order, or inches (1 inch = 25.4 mm; inch sizes are usually rounded to the nearest 0.5"). Lower match_confidence when matching on approximate dimensions or when two lines could fit. Include EVERY priced item the vendor lists, even ones that match no RFx line (rfx_line_id null): the system re-checks every match against the size you record in vendor_size, so record sizes exactly as written, row by row.
4. If a vendor states a pricing rule for a group ("Rs 42/kg for the 5-ply"), expand it to every RFx line it plausibly covers, derived_from "rule", same source quote, and note the interpretation (e.g. whether printed or die-cut items are included). Use match_confidence <= 0.75 where the scope of the rule is ambiguous.
5. If the vendor refers to earlier prices ("rest same as last year", "as per current contract"), emit a line for each affected RFx line with derived_from "prior_contract", price null, currency INR, basis piece/1. Do this only for lines not already priced elsewhere.
6. If a vendor offers a different spec than asked, still record the price and describe the difference in spec_deviation.
7. List in not_quoted every RFx line that has no price in this response, with the reason (regret, not mentioned, not on rate card...).
8. Capture every discount, rebate, surcharge or one-time charge, including ones in footnotes or small print. Say whether it is conditional and on what.
9. Questionnaire: assess each question against what the vendor actually said and attached. For must-have questions be strict: "partial" if they meet only part of it, "unanswered" if they did not address it. A claim with no attached evidence where evidence was requested is at most "partial".
10. Documents: list each attached file with its kind and any validity/expiry date (ISO format).
11. If the vendor states a grand total, capture it in stated_total.
12. read_confidence below 0.7 when text is blurry, angled, handwritten, or a row/column alignment is uncertain.
13. Put anything the buyer should double-check in unresolved. Never invent a price. If you cannot read something, say so.`;

const TRANSCRIBE = `You transcribe photos of printed or handwritten price lists exactly. Output every table row in order, top to bottom, one array per row, cells left to right, exactly as printed (keep units, 'x' separators, currency words). The photo may be angled: follow each row along its slant so the values stay on the right row. Never skip a row, never merge rows, never correct numbers. Put footnotes and terms printed outside the table in notes.`;
const TRANSCRIBE_SCHEMA = {
  type: "object",
  properties: {
    header: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["header", "rows", "notes"],
};

export async function POST(req: Request) {
  const input = await req.json();
  return heartbeatJson(() => extract(input));
}

async function extract(input: any) {
  {
    const { vendor, files, rfx, prior } = input as {
      vendor: { id: string; name: string; email: string; subject: string; body: string; received_at: string };
      files: InFile[];
      rfx: any;
      prior: { contract_ref: string; period: string; line_ids: string[] } | null;
    };
    const rfxBrief = {
      id: rfx.id,
      title: rfx.title,
      currency: rfx.currency,
      requested_terms: rfx.terms,
      lines: rfx.lines.map((l: any) => ({
        id: l.id,
        spec: l.description,
        type: l.type,
        ply: l.ply,
        dims_mm: l.dimensions_mm,
        print: l.print,
        uom: l.uom,
        new_this_year: l.is_new,
      })),
      questionnaire: rfx.questionnaire,
    };
    const priorText = prior
      ? `A prior contract with this vendor is on file: ${prior.contract_ref} (${prior.period}) covering lines ${prior.line_ids.join(", ")}. Lines not in that list have no prior price.`
      : "No prior contract with this vendor is on file.";
    const parts = [
      { text: `BUYER'S RFx (JSON):\n${JSON.stringify(rfxBrief)}` },
      { text: priorText },
      {
        text: `VENDOR EMAIL\nFrom: ${vendor.name} <${vendor.email}>\nReceived: ${vendor.received_at}\nSubject: ${vendor.subject}\n\n${vendor.body}\n\nAttachments follow.`,
      },
      ...(await toParts(files)),
      { text: "Extract this vendor's response now, following the rules." },
    ];
    const t0 = Date.now();
    // Photos get a transcription pass first: read every row before mapping anything.
    const images = files.filter((f) => f.mime.startsWith("image/"));
    for (const img of images) {
      try {
        const tr = await generate({
          system: TRANSCRIBE,
          contents: [{ role: "user", parts: [{ text: `Transcribe ${img.name}.` }, { inlineData: { mimeType: img.mime, data: img.data } }] }],
          responseSchema: TRANSCRIBE_SCHEMA,
          thinking: "low",
          maxOutputTokens: 12000,
        });
        const t = parseJson<{ header: string[]; rows: string[][]; notes: string[] }>(tr.text);
        const table = [t.header.join(" | "), ...t.rows.map((r, i) => `row ${i + 1}: ${r.join(" | ")}`)].join("\n");
        parts.splice(parts.length - 1, 0, { text: `--- MACHINE TRANSCRIPTION of ${img.name} (${t.rows.length} rows; check it against the image and use it so no row is skipped) ---\n${table}\nNotes on the card: ${t.notes.join(" / ")}` });
      } catch {
        /* fall back to the image alone */
      }
    }
    const out = await generate({ system: SYSTEM, contents: [{ role: "user", parts }], responseSchema: SCHEMA, thinking: "low", maxOutputTokens: 32000 });
    const extraction = parseJson(out.text);
    return { extraction, model: out.model, ms: Date.now() - t0 };
  }
}
