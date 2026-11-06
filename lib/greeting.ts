import type { Rfx } from "./types";

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const tonnes = (r: Rfx) => r.lines.reduce((a, l) => a + l.annual_qty * l.est_weight_kg, 0) / 1000;

/** What the request co-pilot says first. Worked out from the request as it stands now, so it can never go stale. */
export function greeting(rfx: Rfx, o: { sentAt: string | null; vendors: number; hasDraft: boolean }): string {
  if (!rfx.lines.length)
    return "Tell me what you need to buy: the category, rough yearly volumes, where it ships to and when you need quotes. I'll draft the items, a supplier questionnaire and terms, and ask only what I can't sensibly assume.";

  const mustN = rfx.questionnaire.filter((q) => q.must_have).length;
  const items = `**${plural(rfx.lines.length, "item")}**${rfx.lines.some((l) => l.est_weight_kg > 0) ? ` (about ${Math.round(tonnes(rfx)).toLocaleString("en-IN")} tonnes a year)` : ""}`;
  const facts = rfx.questionnaire.length ? `${items} and a ${rfx.questionnaire.length}-question supplier questionnaire${mustN ? ` with ${plural(mustN, "must-have")}` : ""}` : `${items} and no supplier questionnaire yet`;

  if (o.hasDraft) return `You have an **amendment that vendors haven't seen yet**. It is summarised at the top of the page. Keep refining it here, then send it or discard it.`;

  if (o.sentAt) {
    const when = new Date(o.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return `This request went to **${plural(o.vendors, "vendor")}** on ${when}, with ${facts}.\n\nIf something needs to change, tell me. It becomes an **amendment**: vendors only hear about it when you send it, and your comparison keeps using what was sent.`;
  }

  return `Your request has ${facts}, on your standard terms. Each item's weight is worked out from its size, so a price per kg can be compared with a price per piece.\n\nTell me what to change, for example *"add a 5-ply export carton 600×400×300, 30k a year"* or *"make FSC a must-have"*.`;
}
