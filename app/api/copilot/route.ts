import { heartbeatJson } from "@/lib/stream";
import { generate, parseJson } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

const LINE = {
  type: "object",
  nullable: true,
  properties: {
    type: { type: "string", description: "RSC, Partition, Layer pad, Die-cut tray, Die-cut crash-lock, Printed sleeve, ..." },
    ply: { type: "number" },
    length_mm: { type: "number" },
    width_mm: { type: "number" },
    height_mm: { type: "number", description: "0 for flat items like layer pads" },
    flute: { type: "string", nullable: true },
    print: { type: "string", description: "Plain, 1 colour, 2 colour, 4 colour" },
    end_use: { type: "string" },
    annual_qty: { type: "number" },
    uom: { type: "string", nullable: true },
    is_new: { type: "boolean", nullable: true },
  },
};

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "What you say to the buyer. Short. Markdown allowed." },
    ops: {
      type: "array",
      description: "Edits to apply to the RFx draft. Empty if you are only asking a question.",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["set_meta", "add_line", "update_line", "remove_line", "add_question", "update_question", "remove_question", "set_term", "remove_term"] },
          target_id: { type: "string", nullable: true, description: "Line id (L07) or question id (Q3) for update/remove" },
          line: LINE,
          question: {
            type: "object",
            nullable: true,
            properties: { text: { type: "string" }, kind: { type: "string", enum: ["yes_no", "number", "text"] }, must_have: { type: "boolean" } },
          },
          term_key: { type: "string", nullable: true },
          term_value: { type: "string", nullable: true },
          meta: {
            type: "object",
            nullable: true,
            properties: { title: { type: "string", nullable: true }, scope: { type: "string", nullable: true }, due_date: { type: "string", nullable: true } },
          },
          why: { type: "string", description: "One-line reason, shown to the buyer as a change note" },
        },
        required: ["op", "why"],
      },
    },
  },
  required: ["reply", "ops"],
};

const SYSTEM = `You are an RFx co-pilot for an Indian manufacturing company's category buyer. You draft and edit an RFx (request for quotation) through conversation: scope, line items, supplier questionnaire and commercial terms.

How you work:
- Act on the buyer's request by emitting ops against the current draft. Keep line ids stable; new lines get the next free id (the app assigns it).
- Specs: give type, ply, inner dimensions in mm (L x W x H), print and annual quantity. Do NOT state weights or board GSM; the app computes them.
- When the buyer is vague, propose sensible defaults AND say they are assumptions in your reply. Ask at most two sharp questions per turn, only ones that change the RFx.
- Think like an experienced buyer: avoid single-source risk, ask for prices per piece in INR ex-GST, delivered to plant, with GST rate stated; questionnaire must-haves should be things you would reject a vendor for. Flag terms that will hurt comparability.
- Never claim to have sent anything. Sending happens in the next step of the app.
- Keep replies under 120 words. Mention what you changed in plain language.`;

export async function POST(req: Request) {
  const body = await req.json();
  return heartbeatJson(async () => {
    const { messages, rfx } = body;
    const draft = {
      title: rfx.title,
      scope: rfx.scope,
      due_date: rfx.due_date,
      buyer: rfx.buyer,
      lines: rfx.lines.map((l: any) => ({ id: l.id, spec: l.description, end_use: l.end_use, annual_qty: l.annual_qty, uom: l.uom, new: l.is_new })),
      questionnaire: rfx.questionnaire,
      terms: rfx.terms,
    };
    const contents = [
      { role: "user" as const, parts: [{ text: `CURRENT RFx DRAFT:\n${JSON.stringify(draft)}` }] },
      { role: "model" as const, parts: [{ text: "Understood. I have the current draft." }] },
      ...messages.map((m: any) => ({ role: m.role === "user" ? ("user" as const) : ("model" as const), parts: [{ text: m.text }] })),
    ];
    const out = await generate({ system: SYSTEM, contents, responseSchema: SCHEMA, thinking: "low", maxOutputTokens: 16000 });
    const parsed = parseJson<{ reply: string; ops: any[] }>(out.text);
    return { ...parsed, model: out.model };
  });
}
