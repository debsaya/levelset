"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { postJson } from "@/lib/api";
import { buildEmail, type Point } from "@/lib/clarify";
import type { VendorSummary } from "@/lib/normalize";
import { Badge, Button, Card, CopyButton, Spinner, cx } from "./ui";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Ask a vendor to clear up open points: tick what to ask, adjust the email, send it from your own mail, then mark it sent. */
export function ClarifyModal({ v, points, onClose }: { v: VendorSummary; points: Point[]; onClose: () => void }) {
  const { s, set, log } = useStore();
  const vendor = s.responses.find((r) => r.vendor.id === v.vendor_id)?.vendor;
  const asked = s.asked?.[v.vendor_id];
  const [picked, setPicked] = useState<Set<string>>(() => new Set(points.map((p) => p.id)));
  const chosen = useMemo(() => points.filter((p) => picked.has(p.id)), [points, picked]);
  const fresh = useMemo(() => buildEmail({ points: chosen, vendorName: v.name, contact: vendor?.contact, buyer: s.rfx.buyer, rfxTitle: s.rfx.title }), [chosen, v.name, vendor?.contact, s.rfx.buyer, s.rfx.title]);
  const [subject, setSubject] = useState(fresh.subject);
  const [body, setBody] = useState(fresh.body);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [polished, setPolished] = useState(false);
  const first = useRef(true);

  // Follow the ticked points until the buyer edits the text by hand.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!edited) {
      setSubject(fresh.subject);
      setBody(fresh.body);
      setPolished(false);
    }
  }, [fresh, edited]);

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function reset() {
    setSubject(fresh.subject);
    setBody(fresh.body);
    setEdited(false);
    setPolished(false);
    setErr("");
  }
  async function polish() {
    setBusy(true);
    setErr("");
    try {
      const j = await postJson("/api/clarify", { vendor: { name: v.name, contact: vendor?.contact }, buyer: s.rfx.buyer, rfx_id: s.rfx.id, rfx_title: s.rfx.title, draft: { subject, body }, today: new Date().toISOString().slice(0, 10) }, 3, { kind: "clarify", label: "Email" });
      if (j.error) throw new Error(j.error);
      if (!j.body || !j.subject) throw new Error("The AI returned an empty email.");
      // Never let a rewrite lose or change a figure or item: every number and item ID in your email must still be there.
      const tokens = (t: string) => t.match(/\b[A-Z]{1,2}\d{1,3}\b|₹?\d[\d,]*(?:\.\d+)?/g) || [];
      const have = new Set(tokens(j.body));
      // ...and the layout: the AI must not squash the email into one block.
      const rows = (x: string) => x.split("\n").filter((l) => l.trim()).length;
      if (rows(j.body) < rows(body) * 0.7) throw new Error("it squashed the layout");
      const lost = tokens(body).filter((t) => !have.has(t));
      if (lost.length) throw new Error(`it changed or dropped ${lost.slice(0, 3).join(", ")}${lost.length > 3 ? " and more" : ""}`);
      setSubject(j.subject);
      setBody(j.body);
      setEdited(true);
      setPolished(true);
    } catch (e: any) {
      setErr(`The AI couldn't polish it right now (${e.message}). Your email is unchanged and still ready to send.`);
    } finally {
      setBusy(false);
    }
  }
  function openMail() {
    const to = vendor?.email ? encodeURIComponent(vendor.email) : "";
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  function markSent() {
    set((x) => ({ ...x, asked: { ...(x.asked || {}), [v.vendor_id]: { at: new Date().toISOString(), subject, points: chosen.length } } }));
    log(`Emailed ${v.name} ${chosen.length} ${chosen.length === 1 ? "question" : "questions"} about their quote`);
  }
  function unmark() {
    set((x) => {
      const a = { ...(x.asked || {}) };
      delete a[v.vendor_id];
      return { ...x, asked: a };
    });
  }
  const long = body.length > 1800;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 sm:p-6" onClick={onClose}>
      <Card className="flex max-h-full w-[980px] max-w-full flex-col overflow-hidden" >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3" onClick={(e) => e.stopPropagation()}>
          <div>
            <div className="font-semibold">Email {v.name}</div>
            <div className="text-xs text-muted">Choose what to ask, check the email, send it from your own mail, then mark it as sent.</div>
          </div>
          <div className="flex items-center gap-3">
            {asked && <Badge tone="good">Marked as sent {when(asked.at)}</Badge>}
            <button onClick={onClose} aria-label="Close" className="text-muted">✕</button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" onClick={(e) => e.stopPropagation()}>
          <div className="border-b border-line p-5 md:border-b-0 md:border-r">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">What to ask</div>
              <div className="text-[12px] text-muted">{chosen.length} of {points.length} selected</div>
            </div>
            {!points.length && <div className="rounded-lg bg-panel p-3 text-[13px] text-muted">Nothing to ask this vendor right now.</div>}
            <ul className="space-y-2">
              {points.map((p) => (
                <li key={p.id}>
                  <label className={cx("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px] leading-snug", picked.has(p.id) ? "border-line bg-white" : "border-transparent bg-panel text-muted")}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#8a5a1f]" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="min-w-0">
                      <span className="block">{p.text}</span>
                      {p.items && p.items.length > 0 && <span className="mt-1 block text-[11.5px] text-muted">{p.items.length} {p.items.length === 1 ? "item" : "items"} listed in the email</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-h-0 flex-col gap-2 p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">The email</div>
              <div className="text-[12px] text-muted">{vendor?.email ? `To: ${vendor.email}` : "No email address on file"}</div>
            </div>
            <input value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} aria-label="Subject" className="rounded-lg border border-line px-3 py-2 text-[13px] font-medium outline-none focus:border-kraft" />
            <textarea value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} aria-label="Email body" rows={16} className="min-h-[260px] flex-1 resize-y rounded-lg border border-line px-3 py-2.5 font-sans text-[13px] leading-relaxed outline-none focus:border-kraft" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              {polished && <span className="text-good">✓ Smoothed out by the AI. Read it once before sending.</span>}
              {edited && !polished && <span>You've edited this email.</span>}
              {edited && (
                <button onClick={reset} className="font-medium text-kraft hover:underline">
                  Start again from the ticked points
                </button>
              )}
              {long && <span>Long email: if your mail app cuts it off, use Copy and paste it in.</span>}
            </div>
            {err && <div className="rounded-lg bg-bad-soft p-2.5 text-[12.5px] text-bad">{err}</div>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="text-[12px] text-muted">
            {asked ? (
              <>
                You marked this as sent.{" "}
                <button onClick={unmark} className="font-medium text-kraft hover:underline">
                  Undo
                </button>
              </>
            ) : (
              "Demo: nothing is sent from here. Send it from your own email, then mark it as sent."
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={polish} disabled={busy || !chosen.length} title="Has the AI make the wording sound more natural. It keeps every number and question.">
              {busy ? <Spinner /> : null}Smooth the wording
            </Button>
            <CopyButton text={() => `Subject: ${subject}\n\n${body}`} label="Copy email" />
            <Button onClick={openMail} disabled={!vendor?.email}>Open in my email app</Button>
            {asked ? (
              <Button variant="primary" onClick={onClose}>Done</Button>
            ) : (
              <Button variant="primary" onClick={markSent} disabled={!chosen.length}>Mark as sent</Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
