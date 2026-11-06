import type { Rfx } from "./types";

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const tonnes = (r: Rfx) => r.lines.reduce((a, l) => a + l.annual_qty * l.est_weight_kg, 0) / 1000;

/** What the request contains, in one paragraph. Shown with the RFx package, worked out from the request as it stands. */
export function requestSummary(rfx: Rfx): string {
  const mustN = rfx.questionnaire.filter((q) => q.must_have).length;
  const items = `**${plural(rfx.lines.length, "item")}**${rfx.lines.some((l) => l.est_weight_kg > 0) ? ` (about ${Math.round(tonnes(rfx)).toLocaleString("en-IN")} tonnes a year)` : ""}`;
  const facts = rfx.questionnaire.length ? `${items} and a ${rfx.questionnaire.length}-question supplier questionnaire${mustN ? ` with ${plural(mustN, "must-have")}` : ""}` : `${items} and no supplier questionnaire yet`;
  return `${facts}, on your standard terms. Each item's weight is worked out from its size, so a price per kg can be compared with a price per piece.`;
}

type Where = {
  sentAt: string | null;
  /** vendors the request went to, or is about to go to */
  vendors: number;
  hasDraft: boolean;
  /** vendors chosen so far (before sending) */
  chosen?: number;
  /** replies that have come in, and how many of those are read */
  replied?: number;
  read?: number;
  /** prices waiting for the buyer's check */
  flagged?: number;
  /** invited vendors with no reply yet, and whether the due date has passed */
  noReply?: number;
  pastDue?: boolean;
};

/** What the request co-pilot says first. It follows where the work stands: drafting, ready to send, waiting, reading, checking. It never states anything that is no longer true. */
export function greeting(rfx: Rfx, o: Where): string {
  if (!rfx.lines.length) return "Tell me what you need to buy: the box type, size (L×W×H in mm), print and roughly how many a year. Or attach a spec sheet or last year's order with the paperclip. I'll draft the items, the questionnaire and the terms.";

  if (o.hasDraft) return `You have an **amendment that vendors haven't seen yet**. It is summarised at the top of the page. Keep refining it here, then send it or discard it.`;

  const change = "Tell me what to change. After sending, a change becomes an **amendment**: vendors only hear about it when you send it.";

  if (!o.sentAt) {
    const n = o.chosen ?? 0;
    if (!n) return `Your request is drafted. Next, choose the **onboarded vendors** who should receive it. Tell me if anything needs to change first, for example *"make FSC a must-have"*.`;
    return `Your request is ready to go to **${plural(n, "vendor")}**. Check the RFx package, then send it. Tell me if anything needs to change first, for example *"add a 5-ply export carton 600×400×300, 30k a year"*.`;
  }

  const when = new Date(o.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const replied = o.replied ?? 0;
  const read = o.read ?? 0;
  const silent = o.noReply ?? 0;

  if (!replied) return `The request went to **${plural(o.vendors, "vendor")}** on ${when}. No replies yet. Quotes can arrive in any format, and you can add one yourself if a vendor sent it another way.\n\n${change}`;

  const chase = silent ? ` ${plural(silent, "vendor")} ${silent === 1 ? "has" : "have"}n't replied${o.pastDue ? " by the due date. You can chase them" : " yet. You can send a reminder"}.` : "";
  const unread = replied - read;
  let status: string;
  if (unread > 0) status = `**${replied} of ${o.vendors}** vendors have replied. ${plural(unread, "quote")} ${unread === 1 ? "is" : "are"} not read yet. Read ${unread === 1 ? "it" : "them"} to see the prices.`;
  else if ((o.flagged ?? 0) > 0) status = `All **${plural(read, "quote")}** are read. **${plural(o.flagged!, "price")}** ${o.flagged === 1 ? "needs" : "need"} your check in Compare before you decide.`;
  else status = `All **${plural(read, "quote")}** are read and no price is flagged. Review the award in Decision.`;

  return `${status}${chase}\n\n${change}`;
}
