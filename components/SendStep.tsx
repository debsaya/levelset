"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, cx } from "./ui";
import seedVendors from "@/data/vendors.json";
import type { VendorMsg } from "@/lib/types";

export default function SendStep({ onNext }: { onNext: () => void }) {
  const { s, set, log } = useStore();
  // A request started from scratch picks its vendors from the vendor list; the sample event already has its five.
  const blank = s.mode === "blank";
  const master = seedVendors as VendorMsg[];
  const [picked, setPicked] = useState<string[]>(master.map((v) => v.id));
  const vendors = blank ? (s.sentAt ? master.filter((v) => s.sentTo.includes(v.id)) : master.filter((v) => picked.includes(v.id))) : s.responses.map((r) => r.vendor);
  const [sel, setSel] = useState(vendors[0]?.id);
  const v = vendors.find((x) => x.id === sel) ?? vendors[0];
  const r = s.rfx;
  const replyTo = (id: string) => `${r.id.toLowerCase()}+${id.toLowerCase()}@inbound.levelset.app`;

  const email = v
    ? `To: ${v.contact} <${v.email}>
Reply-To: ${replyTo(v.id)}
Subject: [${r.id}] Request for quotation — ${r.title}

Dear ${v.contact.split(" ")[0]},

${r.buyer.company} invites ${v.name} to quote for our ${r.title.toLowerCase()}.

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
    set((x) => ({ ...x, sentAt: new Date().toISOString(), sentTo: blank ? vendors.map((v) => v.id) : x.sentTo }));
    log(`Sent ${r.id} to ${vendors.length} vendors (email, simulated)`);
  }

  return (
    <div className="grid h-full grid-cols-[360px_1fr] gap-4 p-4">
      <Card className="flex min-h-0 flex-col">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">Send the request</div>
          <div className="text-xs text-muted">Each vendor below gets the email on the right. Each has its own reply-to address, so replies land in the right place automatically.</div>
        </div>
        <div className="flex-1 divide-y divide-line overflow-y-auto">
          {blank && !s.sentAt && (
            <div className="space-y-1 bg-panel px-4 py-3 text-[12.5px]">
              <div className="font-medium">Who should get this request?</div>
              {master.map((v) => (
                <label key={v.id} className="flex cursor-pointer items-center gap-2 py-0.5">
                  <input type="checkbox" checked={picked.includes(v.id)} onChange={() => setPicked((p) => (p.includes(v.id) ? p.filter((x) => x !== v.id) : [...p, v.id]))} />
                  <span className="truncate">{v.name}</span>
                  <span className="ml-auto text-[11px] text-muted">{v.city}</span>
                </label>
              ))}
              <div className="pt-1 text-[11.5px] text-muted">From your vendor list. Removing the checkmark leaves a vendor out.</div>
            </div>
          )}
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
          {!vendors.length && <div className="p-6 text-sm text-muted">No vendors chosen. Tick at least one above.</div>}
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
            <Button variant="primary" className="w-full justify-center" onClick={sendAll} disabled={!vendors.length}>
              Send request to {vendors.length} vendors
            </Button>
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
