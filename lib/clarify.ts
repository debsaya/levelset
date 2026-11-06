// The "email the vendor" flow, in plain words. Each open problem becomes one point written the way a buyer would say it,
// and the email is built from those same points, so what the buyer ticks is exactly what the vendor reads.
import type { Normalized, VendorSummary } from "./normalize";
import { readBackItems } from "./readback";
import type { Rfx } from "./types";
import { titleInSentence as rawTitleInSentence } from "./spec";

/** "FY27 annual rate contract — corrugated packaging" reads better in a sentence as "…contract, corrugated packaging". */
const titleInSentence = (t: string) => rawTitleInSentence(t).replace(/\s+[—–-]\s+/g, ", ");
const plainTitle = (t: string) => t.replace(/\s+[—–-]\s+/g, ", ");

/** One thing to ask the vendor. `items` are short lines shown as a list under it (item IDs, prices). */
export type Point = { id: string; text: string; items?: string[] };

const desc = (rfx: Rfx, id: string) => `${id} ${rfx.lines.find((l) => l.id === id)?.description ?? ""}`.trim();
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Turn the checker's wording about a must-have question into something a vendor can act on. */
function plainNote(note: string): string {
  return note
    .replace(/\s*\(checked by system\)/i, "")
    .replace(/^Attached certificate expired on ([\d-]+)\.?/i, "The certificate you attached expired on $1.")
    .replace(/^Claimed, but no certificate with a validity date was attached\.?/i, "You said yes, but no certificate with a validity date was attached.")
    .replace(/^Certificate attached, but its validity date \(.*?\) could not be read reliably\. Please check it\.?/i, "A certificate was attached, but we couldn't read its validity date clearly.")
    .trim();
}

/** "Offered 3-ply instead of 5-ply" reads as "3-ply instead of 5-ply" after "you offered"; anything else is shown as a different spec. */
function offered(dev?: string | null): string {
  const t = (dev || "").trim().replace(/\.+$/, "");
  if (!t) return "a different spec";
  return /^offered\s+/i.test(t) ? t.replace(/^offered\s+/i, "") : `a different spec (${t})`;
}

/** Everything we would ask this vendor, most important first. Empty when there is nothing to ask. */
export function vendorPoints(v: VendorSummary, n: Normalized, rfx: Rfx): Point[] {
  const out: Point[] = [];
  const cells = n.cells.filter((c) => c.vendor_id === v.vendor_id);
  const plant = (rfx.buyer.plant || "").split(",")[0].trim();

  // 1. Items with no price
  const missing = cells.filter((c) => c.status === "missing" && !c.flags.some((f) => f.code === "NO_PRIOR_PRICE"));
  if (missing.length && missing.length <= 12) out.push({ id: "missing", text: `We couldn't find a price from you for ${plural(missing.length, "this item", "these items")}. Could you quote ${plural(missing.length, "it", "them")}, or tell us if you can't supply ${plural(missing.length, "it", "them")}?`, items: missing.map((c) => desc(rfx, c.line_id)) });
  else if (missing.length) out.push({ id: "missing", text: `We couldn't find prices from you for ${missing.length} of the ${cells.length} items (${missing.map((c) => c.line_id).join(", ")}). Could you quote the rest, or tell us which ones you can't supply?` });
  for (const c of cells.filter((c) => c.flags.some((f) => f.code === "NO_PRIOR_PRICE")))
    out.push({ id: `noprior-${c.line_id}`, text: `For ${desc(rfx, c.line_id)}, you wrote "${c.source?.quote}", but we have no price from last year to compare it with. Could you give us the price per piece?` });

  // 2. A different spec from the one we asked for
  const dev = cells.filter((c) => c.status === "deviation");
  for (const c of dev)
    out.push({ id: `dev-${c.line_id}`, text: `For ${desc(rfx, c.line_id)}, you offered ${offered(c.raw?.spec_deviation)}. Could you also quote the exact specification we listed, and share test results showing your alternative gives the same box strength?` });

  // 3. Prices we were not sure how to read, and the final read-back of the prices they are winning
  const rb = readBackItems(v.vendor_id, n, rfx);
  const covered = new Set(rb?.ids ?? []);
  const unsure = cells.filter((c) => c.status === "review" && !c.override && !covered.has(c.line_id));
  if (unsure.length)
    out.push({ id: "unsure", text: `We weren't fully sure how to read ${plural(unsure.length, "this price", "these prices")}. Could you confirm ${plural(unsure.length, "it is", "each is")} per piece and for the exact item listed?`, items: unsure.map((c) => `${desc(rfx, c.line_id)}: you wrote ${c.quoted_as}${c.source?.quote && c.source.quote.length <= 70 ? ` ("${c.source.quote}")` : ""}`) });
  const rules = cells.filter((c) => c.derived_from === "rule");
  if (rules.length) out.push({ id: "perkg", text: `You quoted a rate per kg ("${rules[0].source?.quote}"). For ${rules.length} ${plural(rules.length, "item", "items")} we worked out a price per piece using our own box weights. Could you confirm those per-piece prices, and tell us whether printed boxes cost extra?` });
  const prior = cells.filter((c) => c.derived_from === "prior_contract" && c.unit_inr !== null);
  if (prior.length) out.push({ id: "prior", text: `For ${prior.length} ${plural(prior.length, "item", "items")} you said the price stays the same as last year, so we have used last year's contract rate. Could you confirm ${plural(prior.length, "it holds", "they hold")} for the new contract year?` });

  // 4. Terms
  for (const a of v.adjustments.filter((a) => a.conditional))
    out.push({ id: `cond-${out.length}`, text: `You mentioned: "${a.description.replace(/\.+$/, "")}". If we split the order between suppliers, how would you measure this?` });
  for (const a of v.adjustments.filter((a) => a.kind === "one_time_charge"))
    out.push({ id: `once-${out.length}`, text: `You quoted a one-time charge (${a.description.replace(/\.+$/, "")}). Can any existing tooling be reused, or the charge waived?` });
  if (v.terms.freight.startsWith("Ex-works")) out.push({ id: "freight", text: `Your prices are ex-works, so we have added freight ourselves. Could you give us a price delivered to ${plant || "our plant"}?` });
  if (v.terms.currency !== "INR") out.push({ id: "fx", text: `Your quote is in ${v.terms.currency}. Could you give us a firm price in INR, or tell us how currency movement would be shared?` });
  for (const f of v.flags.filter((f) => f.code === "TOTAL_MISMATCH"))
    out.push({ id: "total", text: `The total on your quote doesn't match your item prices at our quantities. We have gone with your item prices. Could you confirm which one is right?` });

  // 5. Must-have questions
  for (const r of v.qual_reasons) {
    const m = r.match(/^(Q\d+) (failed|not answered|partial)(?:: (.*))?$/);
    const q = m && rfx.questionnaire.find((x) => x.id === m[1]);
    if (!m || !q) {
      out.push({ id: `q-${out.length}`, text: `One of our must-have questions still needs attention: ${plainNote(r)} Could you send what's needed?` });
      continue;
    }
    const note = m[3] ? plainNote(m[3]) : "";
    if (m[2] === "not answered") out.push({ id: `q-${m[1]}`, text: `You haven't answered one of our must-have questions yet: "${q.text}" Could you answer it?` });
    else if (m[2] === "failed") out.push({ id: `q-${m[1]}`, text: `About "${q.text}": ${note || "your answer doesn't meet our requirement."} Could you send a current document, or tell us how you would meet it?` });
    else out.push({ id: `q-${m[1]}`, text: `About "${q.text}": ${note || "we need a little more proof."} Could you send what's missing?` });
  }

  // 6. Last: the read-back of the prices they are winning
  if (rb) out.push({ id: "readback", text: `Before we finalise, please confirm the prices we have noted for you on ${rb.count} ${plural(rb.count, "item", "items")}. Reply "correct", or send the right price for any that are off.${rb.items.length < rb.count ? " Where you quoted in another unit we show what you wrote and what we read." : ""}`, items: [...rb.items, ...(rb.more > 0 ? [`(plus ${rb.more} smaller ${plural(rb.more, "item", "items")})`] : [])] });
  return out;
}

/** Two working days after today (skips Saturday and Sunday), written like "Wednesday, 11 November". */
export function replyBy(today: Date): string {
  const d = new Date(today);
  let left = 2;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

/** "Kaveri Packwell Pvt Ltd" reads as "Kaveri Packwell" in a greeting. */
const shortName = (name: string) => name.replace(/\s+(pvt\.?\s*ltd\.?|private limited|llp|limited|ltd\.?|co\.?|inc\.?)\s*$/i, "").trim() || name;

const firstName = (contact: string) => {
  const c = (contact || "").trim();
  if (!c || c.length < 2 || /[@\d]/.test(c)) return "";
  return c.split(/\s+/)[0];
};

/** A short, human first draft. Works with no AI and no network, so Copy is always instant. */
export function buildEmail(o: { points: Point[]; vendorName: string; contact?: string; buyer: { name: string; role: string; company: string }; rfxTitle: string; today?: Date }): { subject: string; body: string } {
  const hi = firstName(o.contact || "");
  const n = o.points.length;
  const lines: string[] = [`Hi ${hi || `${shortName(o.vendorName)} team`},`, ""];
  lines.push(`Thank you for your quote for the ${o.rfxTitle.replace(/\s+[—–-]\s+/g, ", ")}. Before we decide, ${n === 1 ? "I have one quick question" : `I have ${n === 2 ? "two" : n} quick questions`} so we can compare everyone on the same basis.`, "");
  o.points.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.text}`);
    for (const it of p.items ?? []) lines.push(`   • ${it}`);
    lines.push("");
  });
  lines.push(`A reply by ${replyBy(o.today ?? new Date())} would be a big help. Short answers under each point are fine, and I'm happy to talk it through on a call if that's easier.`, "", "Thanks,", o.buyer.name, `${o.buyer.role}, ${o.buyer.company}`);
  return { subject: `A few quick questions on your quote: ${o.rfxTitle.replace(/\s+[—–-]\s+/g, ", ")}`, body: lines.join("\n") };
}

const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};
const tidy = (t?: string) => {
  const x = (t || "").trim().replace(/[.;\s]+$/, "");
  return /^[A-Z][a-z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x;
};

/** The request itself, as the first email a vendor gets. Same voice and layout as the follow-up. */
export function buildRequestEmail(o: { rfx: Rfx; vendorName: string; contact?: string }): { subject: string; body: string } {
  const r = o.rfx;
  const hi = firstName(o.contact || "");
  const must = r.questionnaire.filter((q) => q.must_have).length;
  const t = r.terms || {};
  const how = ([["Prices", t.format], ["Delivery", t.delivery], ["Tax", t.taxes], ["Payment", t.payment]] as [string, string | undefined][]).filter(([, v]) => tidy(v));
  const lines = [
    `Hi ${hi || `${shortName(o.vendorName)} team`},`,
    "",
    `${r.buyer.company} would like a quote from ${shortName(o.vendorName)} for our ${titleInSentence(r.title)}.`,
    "",
    "What we need:",
    `• Prices for ${r.lines.length} items. The specs and yearly volumes are in the attached bid sheet (${r.id}_bid_sheet.xlsx). Feel free to use it, or not.`,
    `• Your answers to ${r.questionnaire.length} short supplier questions${must ? ` (${must} of them are must-haves)` : ""}.`,
    `• Your quote by ${longDate(r.due_date)}.`,
  ];
  if (how.length) lines.push("", "How we'd like it:", ...how.map(([k, v]) => `• ${k}: ${tidy(v)}`));
  lines.push("", "Send your quote in whatever form is easiest: the bid sheet, your own price list, a PDF, a photo, or just a reply to this email. Please keep the subject line so your reply reaches the right place.", "", "Thanks,", r.buyer.name, `${r.buyer.role}, ${r.buyer.company}`);
  return { subject: `[${r.id}] Request for quotation: ${r.title}`, body: lines.join("\n") };
}

const sign = (r: Rfx) => ["Thanks,", r.buyer.name, `${r.buyer.role}, ${r.buyer.company}`];

/** A nudge to a vendor who has not replied yet. Firmer, but still friendly, once the due date has passed. */
export function buildReminderEmail(o: { rfx: Rfx; vendorName: string; contact?: string; pastDue: boolean; today?: Date }): { subject: string; body: string } {
  const r = o.rfx;
  const hi = firstName(o.contact || "");
  const greet = `Hi ${hi || `${shortName(o.vendorName)} team`},`;
  const what = `our ${titleInSentence(r.title)}`;
  const lines = o.pastDue
    ? [greet, "", `We haven't received your quote for ${what} yet, and the due date (${longDate(r.due_date)}) has passed. I'd still like to include you in the comparison.`, "", `Could you send it by ${replyBy(o.today ?? new Date())}? If you won't be quoting this time, a one-line reply saying so would help.`]
    : [greet, "", `A quick reminder that we're waiting for your quote for ${what}. It is due on ${longDate(r.due_date)}.`, "", "Send it in whatever form is easiest: the bid sheet, your own price list, a PDF, a photo, or just a reply to this email. If you can't quote, a one-line reply saying so would help."];
  lines.push("", "Please keep the subject line so your reply reaches the right place.", "", ...sign(r));
  return { subject: `[${r.id}] ${o.pastDue ? "Quote overdue" : "Reminder"}: ${plainTitle(r.title)}`, body: lines.join("\n") };
}

/** One email to every invited vendor when the request changes after it went out. */
export function buildAmendmentEmail(o: { rfx: Rfx; revision: number; parts: string[] }): { subject: string; body: string } {
  const r = o.rfx;
  const lines = [
    "Hi all,",
    "",
    `We have updated our request for the ${titleInSentence(r.title)} (revision ${o.revision}).`,
    "",
    "What changed:",
    ...o.parts.map((p) => `• ${p}`),
    "",
    `Everything else stays the same. Please price the changes and send your updated quote by ${longDate(r.due_date)}. If a change affects a price you already gave us, please tell us.`,
    "",
    ...sign(r),
  ];
  return { subject: `[${r.id}] Updated request, revision ${o.revision}: ${plainTitle(r.title)}`, body: lines.join("\n") };
}
