"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { applyOps } from "@/lib/rfxOps";
import { postJson } from "@/lib/api";
import { fileName, useReader } from "@/lib/reader";
import { isoDate, type Normalized } from "@/lib/normalize";
import type { Rfx, VendorResponse } from "@/lib/types";
import { Badge, Button, Card, Disclosure, Md, Spinner, cx } from "./ui";
import { downloadBidSheet } from "@/lib/bidsheet";

const COLS = "grid-cols-[minmax(190px,1.5fr)_repeat(6,minmax(96px,1fr))]";
const HEADS = [
  { label: "Prices", tip: "A price for every item you asked for." },
  { label: "GST", tip: "Whether prices are with or without GST, and the rate. You asked for prices excluding GST." },
  { label: "Freight", tip: "Whether delivery to your plant is included in the price, or charged extra (ex-works)." },
  { label: "Pay · lead", tip: "Payment terms (days to pay after delivery) and lead time (days from order to delivery)." },
  { label: "Certificate", tip: "A valid ISO 9001 certificate, still in date on the quote due date." },
  { label: "Questions", tip: "Answers to your supplier questionnaire, including the must-haves." },
];

const SUGGESTIONS = ["Add a 2-colour die-cut tray 300×220×50, ~80k a year", "Make FSC certification a must-have", "Cut volumes on all 7-ply lines by 20%"];

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
    ex.tax.basis === "exclusive" ? { label: "Tax", state: "ok", text: `ex-GST${ex.tax.gst_rate_pct ? ` ${ex.tax.gst_rate_pct}%` : ""}` } : ex.tax.basis === "inclusive" ? { label: "Tax", state: "warn", text: "GST included, we remove it" } : { label: "Tax", state: "warn", text: "GST not stated" };

  const freight: Req = ex.freight.included === true ? { label: "Freight", state: "ok", text: "delivered" } : ex.freight.included === false ? { label: "Freight", state: "warn", text: "ex-works, we add freight" } : { label: "Freight", state: "warn", text: "not stated" };

  const pay = ex.payment_terms_days;
  const lead = ex.lead_time_days;
  const terms: Req = pay != null && lead != null ? { label: "Payment & lead time", state: "ok", text: `${pay} d pay · ${lead} d lead` } : { label: "Payment & lead time", state: "warn", text: pay == null && lead == null ? "neither stated" : pay == null ? "payment not stated" : "lead time not stated" };

  const iso = ex.documents.find((d) => /iso|9001/i.test(`${d.kind} ${d.file}`));
  const until = iso ? isoDate(iso.valid_until) : null;
  const cert: Req = !iso ? { label: "Certificate", state: "warn", text: "ISO 9001 not sent" } : !until ? { label: "Certificate", state: "warn", text: "validity date unreadable" } : until < rfx.due_date ? { label: "Certificate", state: "bad", text: `expired ${monthYear(until)}` } : { label: "Certificate", state: "ok", text: `ISO 9001 to ${monthYear(until)}` };

  const answered = (id: string) => ex.questionnaire.some((a) => a.question_id === id && a.assessment !== "unanswered");
  const nAns = rfx.questionnaire.filter((q) => answered(q.id)).length;
  const mustMissing = rfx.questionnaire.filter((q) => q.must_have && !answered(q.id)).length;
  const qn: Req = mustMissing ? { label: "Questionnaire", state: "bad", text: `${mustMissing} must-have unanswered` } : nAns === rfx.questionnaire.length ? { label: "Questionnaire", state: "ok", text: `${nAns}/${rfx.questionnaire.length} answered` } : { label: "Questionnaire", state: "warn", text: `${nAns}/${rfx.questionnaire.length} answered` };

  return [{ label: "Prices", state: quoted === total ? "ok" : quoted > 0 ? "warn" : "bad", text: `${quoted}/${total} lines` }, tax, freight, terms, cert, qn];
}

export default function CollectStep({ n, onSend, onRead, onNext }: { n: Normalized; onSend: () => void; onRead: (add?: boolean) => void; onNext: () => void }) {
  const { s, set, log } = useStore();
  const { readAll } = useReader();
  const r = s.rfx;
  const repliesIn = !!s.sentAt || s.mode === "blank";
  const replies = repliesIn ? s.responses : [];
  const unread = replies.filter((x) => x.status !== "done").length;
  const readN = replies.filter((x) => x.status === "done").length;
  const vendorsInvited = s.responses.length;
  const followUp = replies.filter((x) => x.status === "done" && requirements(x, n, s.rfx).some((q) => q.state === "warn" || q.state === "bad")).length;

  // main action: one clear next move
  let primary: { label: string; run: () => void; disabled?: boolean };
  if (!vendorsInvited) primary = { label: "Add vendor quotes →", run: () => onRead(true) };
  else if (!repliesIn) primary = { label: `Send request to ${vendorsInvited} vendors`, run: onSend, disabled: !r.lines.length };
  else if (unread > 0) primary = { label: `Read ${unread} ${unread === 1 ? "quote" : "quotes"} →`, run: () => (readAll(), onRead()) };
  else primary = { label: "Continue to compare →", run: onNext };

  // ---------- request co-pilot (side panel) ----------
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [s.copilot.length, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const msgs = [...s.copilot, { role: "user" as const, text }];
    set((x) => ({ ...x, copilot: msgs }));
    setInput("");
    setBusy(true);
    try {
      const j = await postJson("/api/copilot", { messages: msgs.slice(1), rfx: s.rfx });
      if (j.error) throw new Error(j.error);
      const before = new Set(s.rfx.lines.map((l) => JSON.stringify(l)));
      const { rfx, notes } = applyOps(s.rfx, j.ops || []);
      setFlash(rfx.lines.filter((l) => !before.has(JSON.stringify(l))).map((l) => l.id));
      set((x) => ({ ...x, rfx, copilot: [...msgs, { role: "assistant", text: j.reply, ops: notes }] }));
      if (notes.length) log(`Co-pilot edited the request: ${notes.length} change(s)`);
    } catch (e: any) {
      set((x) => ({ ...x, copilot: [...msgs, { role: "assistant", text: `⚠️ ${e.message}` }] }));
    } finally {
      setBusy(false);
    }
  }

  const due = new Date(r.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const mustN = r.questionnaire.filter((q) => q.must_have).length;
  const status = !vendorsInvited ? "No vendors yet. Add a quote from any vendor, in any file." : !repliesIn ? "Nothing collected yet. Send the request, and vendors reply in whatever format suits them: Excel, PDF, Word, a photo or a one-line email." : `${replies.length} of ${vendorsInvited} vendors have replied · ${readN} read so far${followUp ? ` · ${followUp} need a follow-up (marked below)` : ""}`;

  return (
    <div className="grid h-full grid-cols-[1fr_minmax(300px,340px)] gap-4 p-4">
      {/* ---------- main: what has been collected ---------- */}
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        {/* one quiet line of context, the state of play, and the one next move */}
        <div className="flex items-end justify-between gap-4 px-1 pt-1">
          <div className="min-w-0">
            <div className="truncate text-xs text-muted">
              {r.id} · {r.title.replace(/\s*—\s*/, ": ")} · quotes due {due}
            </div>
            <p className="mt-1 text-[16px] font-semibold tracking-tight">{status}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button variant="primary" onClick={primary.run} disabled={primary.disabled}>
              {primary.label}
            </Button>
            {vendorsInvited > 0 && !repliesIn && (
              <button className="text-[12px] text-muted underline-offset-2 hover:underline" onClick={() => set((x) => ({ ...x, sentAt: new Date().toISOString() }))} title="Demo shortcut: email is simulated, so this makes the five vendor replies arrive">
                Demo: skip to replies arriving
              </button>
            )}
            {repliesIn && vendorsInvited > 0 && (
              <button className="text-[12px] text-muted underline-offset-2 hover:underline" onClick={onSend}>
                View the request that was sent
              </button>
            )}
          </div>
        </div>

        {/* one table: the column headings are what every quote needs; the colours say whether each vendor gave it */}
        <Card className="overflow-hidden">
          <div className={cx("grid items-center gap-x-3 border-b border-line bg-panel px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted", COLS)}>
            <span>Vendor</span>
            {HEADS.map((h) => (
              <span key={h.label} title={h.tip} className="cursor-help">
                {h.label}
              </span>
            ))}
          </div>
          {s.responses.map((v) => {
            const got = repliesIn;
            const reqs = got ? requirements(v, n, r) : [];
            const files = v.vendor.attachments.map(fileName);
            return (
              <div key={v.vendor.id} className={cx("grid items-center gap-x-3 border-b border-line px-4 py-3 last:border-b-0", COLS)}>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{v.vendor.name}</div>
                  {got ? (
                    <div className="mt-0.5 truncate text-[11.5px] text-muted" title={files.join(", ") || "Email text only"}>
                      {v.status === "reading" ? "Reading… · " : v.status === "error" ? "Couldn't read · " : ""}
                      {v.vendor.format} · {new Date(v.vendor.received_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : "email text"}
                    </div>
                  ) : (
                    <div className="mt-0.5 truncate text-[11.5px] text-muted">Waiting for the request · {v.vendor.email}</div>
                  )}
                </div>
                {got
                  ? reqs.map((q) => (
                      <div key={q.label} className="flex min-w-0 items-start gap-1.5" title={q.text}>
                        <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] text-white", q.state === "ok" && "bg-good", q.state === "warn" && "bg-warn", q.state === "bad" && "bg-bad", q.state === "none" && "bg-line text-muted")}>{q.state === "ok" ? "✓" : q.state === "none" ? "–" : q.state === "bad" ? "✕" : "!"}</span>
                        <span className={cx("min-w-0 text-[12px] leading-snug", q.state === "bad" ? "text-bad" : q.state === "warn" ? "text-warn" : "text-muted")}>{q.text}</span>
                      </div>
                    ))
                  : HEADS.map((h) => (
                      <span key={h.label} className="text-[12px] text-line">
                        –
                      </span>
                    ))}
              </div>
            );
          })}
        </Card>

        {/* other ways a quote can arrive */}
        {repliesIn && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed border-line px-4 py-3 text-[12.5px]">
            <span className="text-muted">Quotes arrive by reply to the request email. Got one another way?</span>
            <span className="ml-auto flex flex-wrap gap-2">
              <Button onClick={() => onRead(true)}>Add a quote file or email text</Button>
              <Button onClick={() => downloadBidSheet(r)} title="Optional. The items and questions pre-filled, for vendors who prefer a form. Vendors can still reply in any format.">
                Download Excel bid sheet
              </Button>
            </span>
          </div>
        )}

        <Disclosure title="What we asked vendors" summary={`${r.lines.length} items · ${r.questionnaire.length} questions (${mustN} must-have) · terms`} defaultOpen={flash.length > 0}>
          <RequestDetail r={r} flash={flash} />
        </Disclosure>
      </div>

      {/* ---------- side: request co-pilot ---------- */}
      <Card className="flex min-h-0 flex-col">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">Request co-pilot</div>
          <div className="text-xs text-muted">Want to change what vendors are asked? Say so here. {s.sentAt ? "The request has already gone out, so changes apply to a re-send." : "The request updates as you talk."}</div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {s.copilot.map((m, i) => (
            <div key={i} className={cx("rounded-lg px-3 py-2 text-[12.5px] leading-relaxed", m.role === "user" ? "ml-6 bg-brand text-white" : "mr-2 bg-panel")}>
              <Md text={m.text} />
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
              <Spinner /> drafting…
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-line p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((q) => (
              <button key={q} onClick={() => send(q)} disabled={busy} className="rounded-full border border-line px-2 py-0.5 text-left text-[11.5px] text-muted hover:bg-panel">
                {q}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Change the request…" className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-[13px] outline-none focus:border-kraft" />
            <Button variant="primary" disabled={busy || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </Card>
    </div>
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
