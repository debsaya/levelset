"use client";
import { useEffect, useRef, useState } from "react";
import { markSent, useStore } from "@/lib/store";
import { applyOps } from "@/lib/rfxOps";
import { postJson } from "@/lib/api";
import { fileName, useReader } from "@/lib/reader";
import { isoDate, type Normalized } from "@/lib/normalize";
import type { Rfx, VendorResponse } from "@/lib/types";
import { Badge, Button, Card, Disclosure, Dots, Md, cx, fileToB64, mimeFor } from "./ui";
import { prepFile } from "@/lib/image";
import { appNow } from "@/lib/clock";
import InviteList from "./InviteList";
import { MASTER, type PoolVendor } from "@/lib/vendorpool";
import { downloadBidSheet } from "@/lib/bidsheet";
import { greeting, requestSummary } from "@/lib/greeting";
import { buildAmendmentEmail, buildReminderEmail } from "@/lib/clarify";
import { EmailDraftModal } from "./EmailDraftModal";
import AskStep, { type Suggestion } from "./AskStep";
import { setCopilotBusy, useCopilotBusy } from "@/lib/askLive";

const COLS = "grid-cols-[minmax(190px,1.5fr)_repeat(6,minmax(96px,1fr))]";
const HEADS = [
  { label: "Prices", tip: "A price for every item you asked for." },
  { label: "GST", tip: "Green: the vendor quoted prices without GST, with GST charged on top (the rate is shown). Amber: GST is already inside the price (we take it out) or was not stated (we assume it is extra). You asked for prices without GST." },
  { label: "Freight", tip: "Whether delivery to your plant is included in the price, or charged extra (ex-works)." },
  { label: "Pay · lead", tip: "Payment terms (days to pay after delivery) and lead time (days from order to delivery)." },
  { label: "Certificate", tip: "A valid ISO 9001 certificate, still in date on the quote due date." },
  { label: "Questions", tip: "Answers to your supplier questionnaire, including the must-haves." },
];

const SUGGESTIONS = ["Add a 2-colour die-cut tray 300×220×50, ~80k a year", "Make FSC certification a must-have", "Cut volumes on all 7-ply lines by 20%"];
const BLANK_SUGGESTIONS = ["5-ply export carton 600×400×300, 30,000 a year", "Printed 3-ply mono cartons 300×200×150, 4-colour, 80k a year", "Layer pads 1100×1100 for pallets, 50,000 a year"];

/** What an unsent amendment changes compared with the request that went out. */
function diffRfx(sent: Rfx, draft: Rfx) {
  const ids = new Set(sent.lines.map((l) => l.id));
  const dIds = new Set(draft.lines.map((l) => l.id));
  const added = draft.lines.filter((l) => !ids.has(l.id)).map((l) => l.id);
  const removed = sent.lines.filter((l) => !dIds.has(l.id)).map((l) => l.id);
  const changed = draft.lines.filter((l) => ids.has(l.id) && JSON.stringify(l) !== JSON.stringify(sent.lines.find((x) => x.id === l.id))).map((l) => l.id);
  const qa = new Map(sent.questionnaire.map((q) => [q.id, JSON.stringify(q)]));
  const qChanged = draft.questionnaire.filter((q) => qa.get(q.id) !== JSON.stringify(q)).length + sent.questionnaire.filter((q) => !draft.questionnaire.some((d) => d.id === q.id)).length;
  const termsChanged = JSON.stringify(sent.terms) !== JSON.stringify(draft.terms);
  const parts = [
    added.length && `${added.length} new ${added.length === 1 ? "item" : "items"} (${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""})`,
    changed.length && `${changed.length} ${changed.length === 1 ? "item" : "items"} changed`,
    removed.length && `${removed.length} ${removed.length === 1 ? "item" : "items"} removed`,
    qChanged && `${qChanged} ${qChanged === 1 ? "question" : "questions"} changed`,
    termsChanged && "terms changed",
  ].filter(Boolean) as string[];
  return { parts, flash: [...added, ...changed] };
}

type Req = { label: string; state: "ok" | "warn" | "bad" | "none"; text: string };

const monthYear = (d: string) => new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

/** The six things every quote has to give us, and whether this vendor's quote did. Pure reading of what the AI extracted. */
function requirements(r: VendorResponse, n: Normalized, rfx: Rfx): Req[] {
  const ex = r.extraction;
  if (r.status !== "done" || !ex) return ["Prices", "Tax", "Freight", "Payment & lead time", "Certificate", "Questionnaire"].map((label) => ({ label, state: "none" as const, text: "not read yet" }));
  const v = n.vendors.find((x) => x.vendor_id === r.vendor.id);
  const total = rfx.lines.length;
  const quoted = v?.quoted ?? 0;

  const tax: Req =
    ex.tax.basis === "exclusive" ? { label: "Tax", state: "ok", text: `GST extra${ex.tax.gst_rate_pct ? ` (${ex.tax.gst_rate_pct}%)` : ""}` } : ex.tax.basis === "inclusive" ? { label: "Tax", state: "warn", text: "GST in price, we remove it" } : { label: "Tax", state: "warn", text: "GST not stated, assumed extra" };

  const freight: Req = ex.freight.included === true ? { label: "Freight", state: "ok", text: "delivered" } : ex.freight.included === false ? { label: "Freight", state: "warn", text: "ex-works, we add freight" } : { label: "Freight", state: "warn", text: "not stated" };

  const pay = ex.payment_terms_days;
  const lead = ex.lead_time_days;
  const terms: Req = pay != null && lead != null ? { label: "Payment & lead time", state: "ok", text: `${pay} d pay · ${lead} d lead` } : { label: "Payment & lead time", state: "warn", text: pay == null && lead == null ? "neither stated" : pay == null ? "payment not stated" : "lead time not stated" };

  const iso = ex.documents.find((d) => /iso|9001/i.test(`${d.kind} ${d.file}`));
  const until = iso ? isoDate(iso.valid_until) : null;
  const cert: Req = !iso ? { label: "Certificate", state: "warn", text: "ISO 9001 not sent" } : !until ? { label: "Certificate", state: "warn", text: "validity date unreadable" } : until < rfx.due_date ? { label: "Certificate", state: "bad", text: `ISO 9001 expired ${monthYear(until)}` } : { label: "Certificate", state: "ok", text: `ISO 9001 valid until ${monthYear(until)}` };

  const answered = (id: string) => ex.questionnaire.some((a) => a.question_id === id && a.assessment !== "unanswered");
  const nAns = rfx.questionnaire.filter((q) => answered(q.id)).length;
  const mustMissing = rfx.questionnaire.filter((q) => q.must_have && !answered(q.id)).length;
  const qn: Req = mustMissing ? { label: "Questionnaire", state: "bad", text: `${mustMissing} must-have unanswered` } : nAns === rfx.questionnaire.length ? { label: "Questionnaire", state: "ok", text: `${nAns}/${rfx.questionnaire.length} answered` } : { label: "Questionnaire", state: "warn", text: `${nAns}/${rfx.questionnaire.length} answered` };

  return [{ label: "Prices", state: quoted === total ? "ok" : quoted > 0 ? "warn" : "bad", text: `${quoted}/${total} lines` }, tax, freight, terms, cert, qn];
}

export default function CollectStep({ n, onSend, onRead, onNext, suggested, askSignal = 0 }: { n: Normalized; onSend: () => void; onRead: (add?: boolean) => void; onNext: () => void; suggested?: Suggestion[]; askSignal?: number }) {
  const { s, set, log, reset, loadExample } = useStore();
  const { readAll } = useReader();
  const r = s.rfx;
  const blank = s.mode === "blank";
  const pool = s.pool ?? MASTER;
  const invitees = s.sentTo.map((id) => pool.find((v) => v.id === id)).filter(Boolean) as PoolVendor[];
  const sent = !!s.sentAt;
  const repliesIn = sent || (blank && s.responses.length > 0);
  const replies = repliesIn ? s.responses : [];
  const unread = replies.filter((x) => x.status !== "done").length;
  const readN = replies.filter((x) => x.status === "done").length;
  const vendorsInvited = invitees.length || s.responses.length;
  const followUp = replies.filter((x) => x.status === "done" && requirements(x, n, s.rfx).some((q) => q.state === "warn" || q.state === "bad")).length;
  // One row per invited vendor, with their reply if one has come; replies from vendors nobody invited get a row too.
  const matchResp = (v: { id: string; name: string }) => s.responses.find((x) => x.vendor.id === v.id || x.vendor.name.toLowerCase() === v.name.toLowerCase());
  const rows: { v: { id: string; name: string; email: string }; resp?: VendorResponse }[] = repliesIn ? [...invitees.map((v) => ({ v, resp: matchResp(v) })), ...s.responses.filter((x) => !invitees.some((v) => matchResp(v) === x)).map((x) => ({ v: x.vendor, resp: x }))] : [];
  const noReply = rows.filter((x) => !x.resp).length;
  const pastDue = r.due_date < appNow(s.mode).toISOString().slice(0, 10);
  const showStart = blank && !sent && !s.responses.length && !r.lines.length;
  const showInvite = !sent && !showStart && !(blank && s.responses.length > 0);
  // The reminder and the amendment each open an email the buyer sends from their own mail, then marks as sent.
  const [draft, setDraft] = useState<null | { kind: "remind"; id: string; name: string; email: string; contact: string } | { kind: "amend" }>(null);
  const markReminded = (v: { id: string; name: string }) => {
    set((x) => ({ ...x, reminded: { ...(x.reminded || {}), [v.id]: new Date().toISOString() } }));
    log(`${pastDue ? "Chased" : "Reminded"} ${v.name} (email marked as sent)`);
    setDraft(null);
  };

  // main action: one clear next move
  let primary: { label: string; run: () => void; disabled?: boolean };
  if (showStart) primary = { label: "Send request →", run: onSend, disabled: true };
  else if (showInvite) primary = { label: `Request quotes (${invitees.length})`, run: onSend, disabled: !r.lines.length || !invitees.length };
  else if (!replies.length) primary = { label: "Add a quote file or email text", run: () => onRead(true) };
  else if (unread > 0) primary = { label: `Read ${unread} ${unread === 1 ? "quote" : "quotes"} →`, run: () => (readAll(), onRead()) };
  else primary = { label: "Continue to compare →", run: onNext };

  // ---------- request co-pilot (side panel) ----------
  // One assistant, two jobs: change the request (it edits what you send) or ask about the quotes (it only reads).
  const [mode, setMode] = useState<"change" | "ask">(readN > 0 ? "ask" : "change");
  const asking = mode === "ask";
  // The Ask AI button in the header lands here on this step: show the question side of the panel.
  useEffect(() => {
    if (askSignal) setMode("ask");
  }, [askSignal]);
  const [input, setInput] = useState("");
  const busy = useCopilotBusy();
  const setBusy = setCopilotBusy;
  const [flash, setFlash] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [s.copilot.length, busy]);

  // Before the request is sent, the co-pilot edits it directly. After, it edits a pending amendment.
  const locked = !!s.sentAt;
  const shown = locked && s.rfxDraft ? s.rfxDraft : s.rfx;
  const amend = s.rfxDraft ? diffRfx(s.rfx, s.rfxDraft) : null;

  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(raw: string) {
    const text = raw.trim() || (files.length ? "I've attached a file. Add what it contains to the request." : "");
    if (!text || busy) return;
    const base = locked ? s.rfxDraft ?? s.rfx : s.rfx;
    const sentFiles = files;
    const msgs = [...s.copilot, { role: "user" as const, text, ...(sentFiles.length ? { files: sentFiles.map((f) => f.name) } : {}) }];
    set((x) => ({ ...x, copilot: msgs }));
    setInput("");
    setFiles([]);
    setBusy(true);
    try {
      const enc = await Promise.all((await Promise.all(sentFiles.map(prepFile))).map(async (f) => ({ name: f.name, mime: f.type || mimeFor(f.name), data: await fileToB64(f) })));
      const j = await postJson("/api/copilot", { messages: msgs.map((m) => ({ role: m.role, text: m.text })), rfx: base, files: enc, amending: locked }, 3, { kind: "copilot", label: "Co-pilot" });
      if (j.error) throw new Error(j.error);
      const before = new Set(base.lines.map((l) => JSON.stringify(l)));
      const { rfx, notes, failed } = applyOps(base, j.ops || []);
      setFlash(rfx.lines.filter((l) => !before.has(JSON.stringify(l))).map((l) => l.id));
      const reply = { role: "assistant" as const, text: failed.length ? `${j.reply}\n\n⚠️ Not applied: ${failed.join("; ")}. Try saying it a different way.` : j.reply, ops: notes };
      set((x) => ({ ...x, ...(locked ? (notes.length ? { rfxDraft: rfx } : {}) : { rfx }), copilot: [...msgs, reply] }));
      if (notes.length) log(locked ? `Co-pilot drafted an amendment: ${notes.length} change(s), not yet sent to vendors` : `Co-pilot edited the request: ${notes.length} change(s)`);
    } catch (e: any) {
      set((x) => ({ ...x, copilot: [...msgs, { role: "assistant", text: `⚠️ ${e.message}` }] }));
    } finally {
      setBusy(false);
    }
  }

  function sendAmendment() {
    if (!s.rfxDraft || !amend) return;
    const rev = (s.revision || 1) + 1;
    set((x) => ({ ...x, rfx: x.rfxDraft!, rfxDraft: null, revision: rev }));
    log(`Amendment (revision ${rev}) marked as sent to ${vendorsInvited} vendors: ${amend.parts.join(", ")}`);
    setFlash([]);
    setDraft(null);
  }
  function discardAmendment() {
    set((x) => ({ ...x, rfxDraft: null }));
    log("Discarded the unsent amendment");
    setFlash([]);
  }

  const due = new Date(r.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const mustN = r.questionnaire.filter((q) => q.must_have).length;
  const headline = showStart
    ? "Start by telling the co-pilot what you are buying."
    : showInvite
      ? "Onboarded vendor(s):"
      : !replies.length
        ? `Sent to ${invitees.length} ${invitees.length === 1 ? "vendor" : "vendors"}. Waiting for their replies.`
        : `${replies.length} of ${vendorsInvited} vendors replied`;
  const chips: { text: string; tone: "plain" | "warn" }[] = repliesIn && replies.length ? [{ text: `${readN} read`, tone: "plain" }, ...(followUp ? [{ text: `${followUp} need a follow-up`, tone: "warn" as const }] : []), ...(noReply ? [{ text: pastDue ? `${noReply} no reply by the due date` : `${noReply} no reply yet`, tone: pastDue ? ("warn" as const) : ("plain" as const) }] : [])] : [];

  return (
    <div className="grid w-full grid-cols-1 gap-4 p-4 lg:h-full lg:grid-cols-[1fr_minmax(300px,340px)]">
      {/* ---------- main: what has been collected ---------- */}
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        {/* the state of play, and the one next move */}
        <div className="flex items-end justify-between gap-4 px-1 pt-1">
          <div className="min-w-0">
            <p className="text-[18px] font-semibold tracking-tight">{headline}</p>
            {chips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {chips.map((c) => (
                  <span key={c.text} className={cx("rounded-full border px-2.5 py-0.5 text-[12px]", c.tone === "warn" ? "border-warn/40 bg-warn-soft font-medium text-warn" : "border-line bg-white text-muted")}>
                    {c.text}
                  </span>
                ))}
                {followUp > 0 && <span className="text-[11.5px] text-muted">marked ! in the table</span>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button variant="primary" onClick={primary.run} disabled={primary.disabled}>
              {primary.label}
            </Button>
            {!blank && showInvite && invitees.length > 0 && (
              <button className="text-[12px] text-muted underline-offset-2 hover:underline" onClick={() => set(markSent)} title="Demo shortcut: email is simulated, so this makes the five vendor replies arrive">
                Demo: skip to replies arriving
              </button>
            )}
            {s.sentAt && vendorsInvited > 0 && (
              <button className="text-[12px] text-muted underline-offset-2 hover:underline" onClick={onSend}>
                View the request that was sent
              </button>
            )}
          </div>
        </div>

        {amend && amend.parts.length > 0 && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3">
            <div className="min-w-0 text-[13px]">
              <div className="font-semibold text-warn">Amendment draft, not sent</div>
              <div className="text-muted">
                {amend.parts.join(" · ")}. Vendors haven&apos;t been told. The comparison still uses the request you sent. Sent, each vendor will need to price the changes.
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button onClick={discardAmendment}>Discard</Button>
              <Button variant="primary" onClick={() => setDraft({ kind: "amend" })}>
                Email amendment
              </Button>
            </div>
          </div>
        )}

        {draft?.kind === "remind" && (
          <EmailDraftModal title={`${pastDue ? "Chase" : "Remind"} ${draft.name}`} to={draft.email} initial={buildReminderEmail({ rfx: r, vendorName: draft.name, contact: draft.contact, pastDue })} sentLabel="Mark sent" onSent={() => markReminded(draft)} onClose={() => setDraft(null)} />
        )}
        {draft?.kind === "amend" && amend && (
          <EmailDraftModal title="Email the amendment to your vendors" hint="One email to everyone you invited. Check it, send it from your own mail, then mark it as sent. Marking it sent makes the changes the live request." to={invitees.map((v) => v.email).filter(Boolean).join(",")} initial={buildAmendmentEmail({ rfx: s.rfxDraft || r, revision: (s.revision || 1) + 1, parts: amend.parts })} sentLabel="Mark sent" onSent={sendAmendment} onClose={() => setDraft(null)} />
        )}

        {showStart ? (
          <GetStarted onSample={() => reset("demo")} onExample={() => loadExample()} onAdd={() => onRead(true)} />
        ) : showInvite ? (
          <InviteList />
        ) : (
          /* one table: the column headings are what every quote needs; the colours say whether each vendor gave it */
          <Card className="overflow-hidden">
            {replies.length > 0 && (
              <div className={cx("grid items-center gap-x-3 border-b border-line bg-panel px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted", COLS)}>
                <span>Vendor</span>
                {HEADS.map((h) => (
                  <span key={h.label} title={h.tip} className="cursor-help">
                    {h.label}
                  </span>
                ))}
              </div>
            )}
            {rows.map(({ v, resp }) => {
              if (!resp) {
                const when = s.reminded?.[v.id];
                return (
                  <div key={v.id} className={cx("grid items-center gap-x-3 border-b border-line px-4 py-3 last:border-b-0", COLS)}>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium">{v.name}</div>
                      <div className="mt-0.5 truncate text-[11.5px] text-muted">{v.email}</div>
                    </div>
                    <div className="col-span-6 flex items-center justify-between gap-3 text-[12px]">
                      <span className={cx(pastDue ? "text-warn" : "text-muted")}>
                        {pastDue ? "No reply by the due date" : `Sent ${new Date(s.sentAt!).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · no reply yet`}
                        {when ? ` · ${pastDue ? "chased" : "reminded"} ${new Date(when).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                      </span>
                      <Button onClick={() => setDraft({ kind: "remind", id: v.id, name: v.name, email: v.email, contact: (v as { contact?: string }).contact || pool.find((p) => p.id === v.id)?.contact || "" })} title="Opens a reminder email you can send from your own mail.">
                        {pastDue ? "Chase" : "Remind"}
                      </Button>
                    </div>
                  </div>
                );
              }
              const files = resp.vendor.attachments.map(fileName);
              const reqs = requirements(resp, n, r);
              return (
                <div key={v.id} className={cx("grid items-center gap-x-3 border-b border-line px-4 py-3 last:border-b-0", COLS)}>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">{resp.vendor.name}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-muted" title={files.join(", ") || "Email text only"}>
                      {resp.status === "reading" ? "Reading… · " : resp.status === "error" ? "Couldn't read · " : ""}
                      {resp.vendor.format} · {new Date(resp.vendor.received_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : "email text"}
                    </div>
                  </div>
                  {reqs.map((q) => (
                    <div key={q.label} className="flex min-w-0 items-start gap-1.5" title={q.text}>
                      <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] text-white", q.state === "ok" && "bg-good", q.state === "warn" && "bg-warn", q.state === "bad" && "bg-bad", q.state === "none" && "bg-line text-muted")}>{q.state === "ok" ? "✓" : q.state === "none" ? "–" : q.state === "bad" ? "✕" : "!"}</span>
                      <span className={cx("min-w-0 text-[12px] leading-snug", q.state === "bad" ? "text-bad" : q.state === "warn" ? "text-warn" : "text-muted")}>{q.text}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </Card>
        )}

        {/* other ways a quote can arrive */}
        {(repliesIn || sent) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed border-line px-4 py-3 text-[12.5px]">
            <span className="text-muted">Quotes arrive by reply to the request email. Got one another way?</span>
            <span className="ml-auto flex flex-wrap gap-2">
              <Button onClick={() => onRead(true)}>Add quote</Button>
              <Button onClick={() => downloadBidSheet(r)} title="Optional. The items and questions pre-filled, for vendors who prefer a form. Vendors can still reply in any format.">
                Bid sheet
              </Button>
            </span>
          </div>
        )}

        {(!blank || shown.lines.length > 0) && (
        <Disclosure key={s.rfxDraft ? "draft" : "sent"} title={s.rfxDraft ? "RFx package (amendment draft)" : "RFx package"} summary={`${shown.lines.length} items · ${shown.questionnaire.length} questions (${shown.questionnaire.filter((q) => q.must_have).length} must-have) · terms`} defaultOpen={flash.length > 0 || !!s.rfxDraft}>
          {shown.lines.length > 0 && (
            <div className="border-b border-line px-5 py-3 text-[12.5px] leading-relaxed text-muted">
              <Md text={requestSummary(shown)} />
            </div>
          )}
          <RequestDetail r={shown} flash={amend ? amend.flash : flash} />
        </Disclosure>
        )}
      </div>

      {/* ---------- side: request co-pilot ---------- */}
      <Card className="flex min-h-0 flex-col">
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Ask AI</div>
            <div role="tablist" aria-label="What to ask AI" className="inline-flex rounded-lg border border-line bg-panel p-0.5 text-[12px]">
              {([["ask", "About quotes"], ["change", "Change request"]] as const).map(([m, label]) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx("rounded-md px-2.5 py-1 font-medium transition", mode === m ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-0.5 text-xs text-muted">{asking ? "Questions about the quotes you have read. It only reads, nothing here changes your request." : locked ? "Changes you ask for here become an amendment. Vendors are told only when you send it." : "Talk the request into shape. It updates as you talk."}</div>
        </div>
        {asking && (
          <div className="min-h-[460px] flex-1 lg:min-h-0">
            {readN > 0 ? (
              <AskStep n={n} compact suggested={suggested} />
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-[12.5px] text-muted">
                <div>
                  <div className="font-medium text-ink">Nothing to ask about yet</div>
                  <p className="mt-1">Once vendors reply and you read their quotes, you can ask questions about them here. Until then, use Change request to shape what you send.</p>
                </div>
              </div>
            )}
          </div>
        )}
        <div className={cx("flex-1 space-y-3 overflow-y-auto p-3", asking && "hidden")}>
          <div className="mr-2 rounded-lg bg-panel px-3 py-2 text-[12.5px] leading-relaxed">
            <Md text={greeting(shown, { sentAt: s.sentAt, vendors: vendorsInvited, hasDraft: !!(amend && amend.parts.length), chosen: invitees.length, replied: replies.length, read: readN, flagged: n.cells.filter((c) => c.status === "review").length, noReply, pastDue })} />
          </div>
          {s.copilot.map((m, i) => (
            <div key={i} className={cx("lv-rise rounded-lg px-3 py-2 text-[12.5px] leading-relaxed", m.role === "user" ? "ml-6 bg-brand text-white" : "mr-2 bg-panel")}>
              <Md text={m.text} />
              {m.files && m.files.length > 0 && <div className="mt-1.5 text-[11.5px] text-white/80">📎 {m.files.join(", ")}</div>}
              {m.ops && m.ops.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-line pt-2">
                  {m.ops.map((o, j) => (
                    <div key={j} className="text-[11.5px] text-muted">
                      ✎ {o}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Dots /> drafting…
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className={cx("border-t border-line p-3", asking && "hidden")}>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(shown.lines.length ? SUGGESTIONS : BLANK_SUGGESTIONS).map((q) => (
              <button key={q} onClick={() => send(q)} disabled={busy} className="rounded-full border border-line px-2 py-0.5 text-left text-[11.5px] text-muted hover:bg-panel">
                {q}
              </button>
            ))}
          </div>
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-panel px-2 py-0.5 text-[11.5px]">
                  <span className="truncate">{f.name}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} className="text-muted hover:text-ink" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <input ref={fileRef} type="file" multiple hidden accept=".pdf,.xlsx,.xls,.csv,.docx,.jpg,.jpeg,.png,.txt" onChange={(e) => {
              // Take the files out before clearing the input, which also empties the list the browser hands us.
              const picked = Array.from(e.target.files || []);
              e.target.value = "";
              setFiles((f) => [...f, ...picked].slice(0, 5));
            }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} title="Attach a file for the co-pilot to read: a spec sheet, last year's order, an Excel list of items, a photo of a drawing" aria-label="Attach a file" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-[15px] text-muted hover:bg-panel hover:text-ink disabled:opacity-40">
              📎
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={files.length ? "Say what to do with the file…" : "Change the request…"} className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-[13px] outline-none focus:border-kraft" />
            <Button variant="primary" disabled={busy || (!input.trim() && !files.length)}>
              Send
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}

/** A new request has nothing to show yet: say what to do, and let the buyer start from sample data instead. */
function GetStarted({ onSample, onExample, onAdd }: { onSample: () => void; onExample: () => void; onAdd: () => void }) {
  return (
    <Card className="p-6">
      <div className="text-[15px] font-semibold">How do you want to start?</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-4 sm:col-span-2">
          <div className="text-[13.5px] font-semibold">Describe it to the co-pilot</div>
          <div className="mt-0.5 text-[12px] text-muted">Type what you need in Ask AI on the right, or attach a spec sheet or last year&apos;s order with the paperclip. The items it adds show up here, and then you choose which vendors get the request.</div>
        </div>
        <button onClick={onSample} className="rounded-xl border border-line p-4 text-left hover:bg-panel">
          <div className="text-[13.5px] font-semibold">Load the sample event</div>
          <div className="mt-0.5 text-[12px] text-muted">A ready request for corrugated packaging, 30 items and a questionnaire, with five vendors chosen. Nothing sent yet.</div>
        </button>
        <button onClick={onExample} className="rounded-xl border border-line p-4 text-left hover:bg-panel">
          <div className="text-[13.5px] font-semibold">Load the finished example</div>
          <div className="mt-0.5 text-[12px] text-muted">The same event, already sent, with five vendor replies in.</div>
        </button>
        <button onClick={onAdd} className="rounded-xl border border-dashed border-line p-4 text-left hover:bg-panel sm:col-span-2">
          <div className="text-[13.5px] font-semibold">I already have a vendor quote</div>
          <div className="mt-0.5 text-[12px] text-muted">Upload a file or paste an email and read it directly.</div>
        </button>
      </div>
    </Card>
  );
}

/** The request itself: items, questions and terms. Closed by default because the buyer already agreed it. */
function RequestDetail({ r, flash }: { r: Rfx; flash: string[] }) {
  const [tab, setTab] = useState<"lines" | "questionnaire" | "terms">("lines");
  const names = { lines: "Items", questionnaire: "Questions", terms: "Terms" };
  return (
    <div>
      <div className="flex gap-4 border-b border-line px-5 text-[13px]">
        {(["lines", "questionnaire", "terms"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("border-b-2 py-2", tab === t ? "border-brand font-medium text-ink" : "border-transparent text-muted")}>
            {names[t]}
          </button>
        ))}
      </div>
      <div className="max-h-[420px] overflow-auto">
        {tab === "lines" && (
          <table className="w-full text-[12.5px] tabular">
            <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">Spec</th>
                <th className="px-3 py-2">End use</th>
                <th className="px-3 py-2 text-right">Annual qty</th>
                <th className="px-3 py-2 text-right" title="Computed by code from dimensions and board GSM. Used to convert per-kg quotes.">
                  Est. kg / pc ⓘ
                </th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id} className={cx("border-t border-line", flash.includes(l.id) && "bg-kraft-soft")}>
                  <td className="px-3 py-1.5 font-medium">
                    {l.id} {l.is_new && <Badge tone="brand">new</Badge>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">{l.description}</td>
                  <td className="px-3 py-1.5 text-muted">{l.end_use}</td>
                  <td className="px-3 py-1.5 text-right">
                    {l.annual_qty.toLocaleString("en-IN")} {l.uom === "set" ? "sets" : ""}
                  </td>
                  <td className="px-3 py-1.5 text-right">{l.est_weight_kg.toFixed(3)}</td>
                </tr>
              ))}
              {!r.lines.length && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted">
                    No items yet. Describe what you&apos;re buying in the co-pilot.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === "questionnaire" && (
          <div className="divide-y divide-line">
            {r.questionnaire.map((q) => (
              <div key={q.id} className="flex items-start gap-3 px-5 py-2.5 text-[13px]">
                <span className="w-8 font-medium">{q.id}</span>
                <span className="flex-1">{q.text}</span>
                <Badge>{q.kind.replace("_", "/")}</Badge>
                {q.must_have ? <Badge tone="bad">must-have</Badge> : <Badge>scored</Badge>}
              </div>
            ))}
            <div className="px-5 py-3 text-xs text-muted">Must-haves decide approval: fail one and the vendor is out; partly meet one and they stay in as &quot;needs proof&quot; until the buyer decides.</div>
          </div>
        )}
        {tab === "terms" && (
          <div className="divide-y divide-line">
            {Object.entries(r.terms).map(([k, v]) => (
              <div key={k} className="flex gap-3 px-5 py-2.5 text-[13px]">
                <span className="w-36 font-medium capitalize">{k.replace(/_/g, " ")}</span>
                <span className="flex-1">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
