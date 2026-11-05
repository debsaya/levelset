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

const SYSTEM = `You write clarification emails from an Indian manufacturing company's category buyer to a vendor who has quoted on an RFx.
- Polite, direct, plain English that a small-business owner will understand. No legalese.
- One numbered question per open issue, each answerable in one line. Quote the vendor's own words where it helps ("you wrote '...'").
- Ask for exactly what is needed to compare fairly (e.g. price per piece in INR, delivered to plant, ex-GST).
- Do not reveal other vendors' prices or names. Do not promise an award.
- Ask them to reply by a specific date: two working days after today.
- Sign off with the buyer's name and role.`;

export async function POST(req: Request) {
  const body = await req.json();
  return heartbeatJson(async () => {
    const { vendor, buyer, rfx_id, rfx_title, issues, today } = body;
    const out = await generate({
      system: SYSTEM,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Today: ${today}\nRFx: ${rfx_id} — ${rfx_title}\nBuyer: ${buyer.name}, ${buyer.role}, ${buyer.company}\nVendor: ${vendor.name} (contact: ${vendor.contact})\n\nOpen issues found by the system:\n${issues.map((i: string, n: number) => `${n + 1}. ${i}`).join("\n")}\n\nDraft the email.`,
            },
          ],
        },
      ],
      responseSchema: SCHEMA,
      thinking: "low",
      maxOutputTokens: 4000,
    });
    return { ...parseJson<Record<string, unknown>>(out.text), model: out.model };
  });
}
