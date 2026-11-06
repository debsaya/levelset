"use client";
import { useState } from "react";
import { markSent, useStore } from "@/lib/store";
import { Badge, Button, Card, cx } from "./ui";
import { MASTER, type PoolVendor } from "@/lib/vendorpool";
import { titleInSentence } from "@/lib/spec";

export default function SendStep({ onNext }: { onNext: () => void }) {
  const { s, set, log } = useStore();
  const pool = s.pool ?? MASTER;
  const vendors = s.sentTo.map((id) => pool.find((v) => v.id === id)).filter(Boolean) as PoolVendor[];
  const [sel, setSel] = useState(vendors[0]?.id);
  const v = vendors.find((x) => x.id === sel) ?? vendors[0];
  const r = s.rfx;
  const replyTo = (id: string) => `${r.id.toLowerCase()}+${id.toLowerCase()}@inbound.levelset.app`;

  const email = v
    ? `To: ${v.contact} <${v.email}>
Reply-To: ${replyTo(v.id)}
Subject: [${r.id}] Request for quotation — ${r.title}

Dear ${v.contact.split(" ")[0]},

${r.buyer.company} invites ${v.name} to quote for our ${titleInSentence(r.title)}.

• ${r.lines.length} line items (specs and annual volumes in the attached bid sheet, ${r.id}_bid_sheet.xlsx; using it is optional)
• A ${r.questionnaire.length}-question supplier questionnaire (${r.questionnaire.filter((q) => q.must_have).length} must-haves)
• Quotes due by ${r.due_date}

Our preferred basis: ${r.terms.format || "price per piece in INR"}; ${r.terms.delivery || ""}; ${r.terms.taxes || ""}.

Reply in whatever format suits you: the bid sheet, your own price list, a PDF, a photo, or just this email. Please keep the subject line so your reply reaches the right event.

Regards,
${r.buyer.name}
${r.buyer.role}, ${r.buyer.company}`
    : "";

  function sendAll() {
    set(markSent);
    log(`Sent ${r.id} to ${vendors.length} vendors (email, simulated)`);
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 p-4 lg:h-full lg:grid-cols-[360px_1fr]">
      <Card className="flex min-h-0 flex-col">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">Send the request</div>
          <div className="text-xs text-muted">Each vendor below gets the email on the right. Each has its own reply-to address, so replies land in the right place automatically.</div>
        </div>
        <div className="flex-1 divide-y divide-line overflow-y-auto">
          {vendors.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)} className={cx("block w-full px-4 py-2.5 text-left", sel === x.id && "bg-kraft-soft")}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{x.name}</span>
                {s.sentAt ? <Badge tone="good">sent</Badge> : <Badge>draft</Badge>}
              </div>
              <div className="text-xs text-muted">
                {x.city} · {x.email}
              </div>
            </button>
          ))}
          {!vendors.length && <div className="p-6 text-sm text-muted">No vendors chosen yet. Go back and choose who gets this request.</div>}
        </div>
        <div className="border-t border-line p-3">
          {s.sentAt ? (
            <div className="space-y-2">
              <div className="text-xs text-good">✓ Sent {new Date(s.sentAt).toLocaleString("en-IN")} · SMTP is stubbed in this prototype</div>
              <Button variant="primary" className="w-full justify-center" onClick={onNext}>
                Back to collected quotes →
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button variant="primary" className="w-full justify-center" onClick={sendAll} disabled={!vendors.length}>
                Send request to {vendors.length} {vendors.length === 1 ? "vendor" : "vendors"}
              </Button>
              <Button className="w-full justify-center" onClick={onNext}>
                Change who gets it
              </Button>
            </div>
          )}
        </div>
      </Card>
      <Card className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="font-semibold">The email vendors will get</div>
          <Badge tone="warn" title="The prototype fakes the SMTP server, as the brief allows. Extraction and reasoning are real.">plumbing stubbed</Badge>
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-5 font-sans text-[13px] leading-relaxed">{email}</pre>
        <div className="border-t border-line bg-panel px-4 py-2.5 text-xs text-muted">
          Design choice: we never force vendors into a portal or template. Adoption by small vendors is the real constraint — the system absorbs the mess instead.
        </div>
      </Card>
    </div>
  );
}
