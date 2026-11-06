import { guard, need } from "@/lib/guard";
import { heartbeatJson } from "@/lib/stream";
import { generate, parseJson } from "@/lib/gemini";
import { toParts, type InFile } from "@/lib/fileText";
import { incomplete } from "@/lib/rfxOps";

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
  required: ["type", "ply", "length_mm", "width_mm", "height_mm", "print", "end_use", "annual_qty"],
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
          line: { ...LINE, description: "For add_line and update_line: the COMPLETE line with every field filled (for updates, copy unchanged values from the draft)." },
          question: {
            type: "object",
            nullable: true,
            properties: { text: { type: "string" }, kind: { type: "string", enum: ["yes_no", "number", "text"] }, must_have: { type: "boolean" } },
          },
          must_have: { type: "boolean", nullable: true, description: "For update_question when the buyer only wants to turn must-have on or off: set true or false here. No other fields are needed." },
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

const SYSTEM = `You are an RFx co-pilot for a category buyer at an Indian manufacturer. In this product you help the buyer put together a request for quotation for CORRUGATED PACKAGING (boxes, trays, layer pads, partitions, sleeves). You draft and edit the request through conversation: items, supplier questionnaire and commercial terms.

How you work:
- The buyer sees every change you make: items appear in the request table, terms in the terms tab, and each change is listed under your reply. Say plainly what you changed, in a short list, and where it shows ("see the Items tab").
- If the buyer has not yet said WHAT they want to buy (for example "I want to request quotes" or "help me start"), make NO edits at all: ops must be empty. Do not set a title, scope, terms or questions yet. Reply with one friendly line and ask for the items, with an example they can copy, such as "5-ply export carton 600x400x300 mm, 30,000 a year". Ask only this one thing.
- If they ask for something that is not corrugated packaging, say this prototype handles corrugated packaging only and offer the closest thing you can do.
- When the buyer gives some detail but not all, add what you can with sensible defaults and say in your reply which values are assumptions. Ask at most one or two sharp questions, only ones that change the request, in the buyer's own terms.
- When the buyer attaches a file (a spec sheet, last year's PO, a drawing, an Excel list), read it, add the items it contains, and say which file each change came from. If you cannot read it or it has no items, say so and change nothing.
- Specs: type, ply, inner dimensions in mm (L x W x H), print and annual quantity. Do NOT state weights or board GSM; the app computes them. Keep line ids stable; new lines get the next free id (the app assigns it).
- Think like an experienced buyer: avoid single-source risk, ask for prices per piece in INR ex-GST, delivered to plant, with GST rate stated; questionnaire must-haves should be things you would reject a vendor for. Flag terms that will hurt comparability.
- Every edit must carry its full payload: add_line and update_line need the complete line object, add_question needs the question object (text, kind and must_have); update_question needs either the question object or, to switch must-have on or off, just must_have: true/false, set_meta needs the meta object. An edit that names a change but has no payload does nothing, and the buyer will be told it failed.
- The title is a short name of at most 80 characters, such as "Annual contract for corrugated export cartons". Never put explanations, notes or the scope in the title. The scope is one or two sentences in the scope field.
- Propose, don't impose: do not mark a new question as a must-have unless the buyer asked for it or it is a safety or legal requirement. If you think one should be a must-have, say so in your reply and let the buyer decide.
- Never claim to have sent anything. Sending happens in the next step of the app. If the request is already sent, edits become an amendment the buyer sends separately.
- Keep replies under 100 words, plain language, no jargon.`;

export async function POST(req: Request) {
  const g = await guard(req, "ai", (b) => (Array.isArray(b.messages) && b.messages.length ? need.rfx(b) : "Missing messages."));
  if (g instanceof Response) return g;
  const body = g;
  return heartbeatJson(async () => {
    const { messages, rfx, files = [], amending = false } = body as { messages: any[]; rfx: any; files?: InFile[]; amending?: boolean };
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
      { role: "user" as const, parts: [{ text: `CURRENT RFx DRAFT:\n${JSON.stringify(draft)}${amending ? "\n\nNOTE: this request has ALREADY been sent to vendors. Whatever the buyer asks for now goes into an AMENDMENT DRAFT that vendors do not see until the buyer sends it. Say so in your reply (for example: I have added it to the amendment draft; vendors have not been told yet)." : ""}` }] },
      { role: "model" as const, parts: [{ text: "Understood. I have the current draft." }] },
      ...messages.map((m: any) => ({ role: m.role === "user" ? ("user" as const) : ("model" as const), parts: [{ text: m.text }] as Record<string, unknown>[] })),
    ];
    if (files.length) {
      const last = contents[contents.length - 1];
      if (last && last.role === "user") last.parts.push({ text: `The buyer attached ${files.length} file(s): ${files.map((f) => f.name).join(", ")}` }, ...(await toParts(files)));
    }
    const run = async (cs: typeof contents) => {
      const out = await generate({ system: SYSTEM, contents: cs, responseSchema: SCHEMA, thinking: "low", maxOutputTokens: 16000 });
      return { out, parsed: parseJson<{ reply: string; ops: any[] }>(out.text) };
    };
    let { out, parsed } = await run(contents);
    // The model sometimes says it made a change but sends an empty edit. Ask once for the complete edits.
    const problems = (parsed.ops || []).map((o) => incomplete(o)).filter(Boolean);
    if (problems.length) {
      try {
        const again = await run([
          ...contents,
          { role: "model" as const, parts: [{ text: out.text }] as Record<string, unknown>[] },
          { role: "user" as const, parts: [{ text: `Some of your edits were empty and did nothing (${problems.join("; ")}). Send ALL the edits again, each with its complete payload, and a reply that says only what really changed.` }] as Record<string, unknown>[] },
        ]);
        out = again.out;
        parsed = again.parsed;
      } catch {
        /* keep the first answer; the app reports what could not be applied */
      }
    }
    // Last resort for an update that is still empty: ask for just that one item, with its current values in front of the model.
    const lastAsk = [...messages].reverse().find((m: any) => m.role === "user")?.text || "";
    let repaired = 0;
    for (const o of parsed.ops || []) {
      if (!incomplete(o)) continue;
      try {
        if (o.op === "update_question" && o.target_id) {
          const cur = rfx.questionnaire.find((q: any) => q.id === o.target_id);
          if (!cur) continue;
          const fix = await generate({
            system: "You change one questionnaire item as the buyer asked. Reply with the COMPLETE updated question: its text, kind and must_have. Change only what the buyer asked.",
            contents: [{ role: "user" as const, parts: [{ text: `Current question: ${JSON.stringify(cur)}\nBuyer said: ${lastAsk}\nIntended change: ${o.why}` }] }],
            responseSchema: { type: "object", properties: { text: { type: "string" }, kind: { type: "string", enum: ["yes_no", "number", "text"] }, must_have: { type: "boolean" } }, required: ["text", "kind", "must_have"] },
            thinking: "low",
            maxOutputTokens: 2000,
            fast: true,
          });
          o.question = parseJson<any>(fix.text);
          repaired++;
        } else if (o.op === "update_line" && o.target_id) {
          const cur = rfx.lines.find((l: any) => l.id === o.target_id);
          if (!cur) continue;
          const fix = await generate({
            system: "You change one item of a corrugated-packaging request as the buyer asked. Reply with the COMPLETE updated line, copying every unchanged value from the current one.",
            contents: [{ role: "user" as const, parts: [{ text: `Current line: ${JSON.stringify({ id: cur.id, type: cur.type, ply: cur.ply, flute: cur.flute, length_mm: cur.dimensions_mm?.L, width_mm: cur.dimensions_mm?.W, height_mm: cur.dimensions_mm?.H, print: cur.print, end_use: cur.end_use, annual_qty: cur.annual_qty, uom: cur.uom })}\nBuyer said: ${lastAsk}\nIntended change: ${o.why}` }] }],
            responseSchema: LINE,
            thinking: "low",
            maxOutputTokens: 2000,
            fast: true,
          });
          o.line = parseJson<any>(fix.text);
          repaired++;
        }
      } catch {
        /* leave it empty: the app will say it did not come through */
      }
    }
    return { ...parsed, model: out.model, attempts: out.attempts, repaired };
  });
}
