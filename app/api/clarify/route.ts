import { guard, need } from "@/lib/guard";
import { heartbeatJson } from "@/lib/stream";
import { generate, parseJson } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    questions_count: { type: "number" },
  },
  required: ["subject", "body", "questions_count"],
};

const SYSTEM = `You write short emails from a buyer at an Indian manufacturing company to a supplier who has sent a quote. Write the way a polite, busy person writes to someone they work with: warm, plain, direct.
- Sound human. Short sentences. No corporate or legal phrasing, no jargon, and never mention systems, AI, flags, checks, normalising or "the RFx". Say "your quote".
- Keep every question, every item ID and every number EXACTLY as given. Never round, reword, recompute or drop one. Keep any list of items and any "plus N smaller items" note as it is.
- Keep the layout exactly: greeting on its own line, a blank line between paragraphs, every numbered question starting on a new line, and each listed item on its own line. Never join the email into one block.
- Keep the questions numbered, one per open point, each answerable in a line. Quote the supplier's own words where they are given.
- Do not reveal other suppliers' prices or names. Do not say who is cheapest or promise an award. Do not make new commitments.
- Ask for a reply by the date already in the draft.
- Sign off with the buyer's name and role, as in the draft.`;

export async function POST(req: Request) {
  const g = await guard(req, "ai", (b) => (b.vendor && typeof b.vendor === "object" && (Array.isArray(b.issues) || (b.draft && typeof b.draft.body === "string")) ? null : "Missing vendor or draft."));
  if (g instanceof Response) return g;
  const body = g;
  return heartbeatJson(async () => {
    const { vendor, buyer, rfx_id, rfx_title, issues, draft, today } = body;
    const task = draft
      ? `Here is a draft email. Rewrite it so it reads like a real person wrote it. Change the wording only, not the content.\n\nSubject: ${String(draft.subject || "").slice(0, 300)}\n\n${String(draft.body).slice(0, 12000)}`
      : `Open points to ask about:\n${(issues as string[]).map((i: string, n: number) => `${n + 1}. ${i}`).join("\n")}\n\nDraft the email.`;
    const out = await generate({
      system: SYSTEM,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Today: ${today}\nRFx: ${rfx_id} — ${rfx_title}\nBuyer: ${buyer.name}, ${buyer.role}, ${buyer.company}\nVendor: ${vendor.name} (contact: ${vendor.contact})\n\n${task}`,
            },
          ],
        },
      ],
      responseSchema: SCHEMA,
      thinking: "low",
      maxOutputTokens: 8000,
    });
    return { ...parseJson<Record<string, unknown>>(out.text), model: out.model, attempts: out.attempts };
  });
}
