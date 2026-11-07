"use client";
import { useState } from "react";
import { markSent, useStore } from "@/lib/store";
import { Badge, Button, Card, cx } from "./ui";
import { MASTER, type PoolVendor } from "@/lib/vendorpool";
import { buildRequestEmail } from "@/lib/clarify";

export default function SendStep({ onNext }: { onNext: () => void }) {
  const { s, set, log } = useStore();
  const pool = s.pool ?? MASTER;
  const vendors = s.sentTo.map((id) => pool.find((v) => v.id === id)).filter(Boolean) as PoolVendor[];
  const [sel, setSel] = useState(vendors[0]?.id);
  const v = vendors.find((x) => x.id === sel) ?? vendors[0];
  const r = s.rfx;
  const replyTo = (id: string) => `${r.id.toLowerCase()}+${id.toLowerCase()}@inbound.levelset.app`;

  const mail = v ? buildRequestEmail({ rfx: r, vendorName: v.name, contact: v.contact }) : null;
  const email = v && mail ? `To: ${v.contact} <${v.email}>\nReply-To: ${replyTo(v.id)}\nSubject: ${mail.subject}\n\n${mail.body}` : "";

  function sendAll() {
    set(markSent);
    log(`Sent ${r.id} to ${vendors.length} vendors (email, simulated)`);
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 p-4 lg:h-full lg:grid-cols-[360px_1fr]">
      <Card className="flex min-h-0 flex-col">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">Send the request</div>
        </div>
        <div className="flex-1 divide-y divide-line overflow-y-auto">
          {vendors.map((x, i) => (
            <button key={x.id} onClick={() => setSel(x.id)} className={cx("block w-full px-4 py-2.5 text-left", sel === x.id && "bg-kraft-soft")}>
              <div className="flex items-center justify-between">
                <span className="font-medium"><span className="tabular mr-1.5 text-muted">{i + 1}.</span>{x.name}</span>
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
              <div className="text-xs text-good">✓ Marked as sent {new Date(s.sentAt).toLocaleString("en-IN")}</div>
              <Button variant="primary" className="w-full justify-center" onClick={onNext}>
                Back to list
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button variant="primary" className="w-full justify-center" onClick={sendAll} disabled={!vendors.length}>
                Request quotes ({vendors.length})
              </Button>
              <Button className="w-full justify-center" onClick={onNext}>
                Change vendors
              </Button>
            </div>
          )}
        </div>
      </Card>
      <Card className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="font-semibold">The email vendors will get</div>
          <Badge tone="warn" title="Sending email is simulated in this prototype, as the brief allows. Reading the replies and the reasoning are real.">Preview</Badge>
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-5 font-sans text-[13px] leading-relaxed">{email}</pre>
      </Card>
    </div>
  );
}
