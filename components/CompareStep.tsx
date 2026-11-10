"use client";
import { vendorPoints } from "@/lib/clarify";
import { ClarifyModal } from "./ClarifyModal";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, inr, key, type Cell, type Normalized, type QCell, type VendorSummary } from "@/lib/normalize";
import { exportWorkbook } from "@/lib/export";
import { postJson } from "@/lib/api";
import { fileName } from "./InboxStep";
import { Badge, Blocked, Button, Card, Spinner, cx } from "./ui";
import { blocker } from "@/lib/flow";

const QUAL: Record<string, { tone: "good" | "warn" | "bad"; label: string }> = {
  qualified: { tone: "good", label: "Approved" },
  conditional: { tone: "warn", label: "Needs proof" },
  not_qualified: { tone: "bad", label: "Not approved" },
};

export default function CompareStep({ n, onNext, go, initialReview }: { n: Normalized; onNext: () => void; go: (p: "rfx" | "quotes") => void; initialReview?: boolean }) {
  const { s, set, log } = useStore();
  const [tab, setTab] = useState<"prices" | "questionnaire" | "audit">("prices");
  const [onlyReview, setOnlyReview] = useState(!!initialReview);
  const [sel, setSel] = useState<{ v: string; l: string } | null>(null);
  const [selQ, setSelQ] = useState<{ v: string; q: string } | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);
  const [showBasis, setShowBasis] = useState(false);
  // Escape closes the open price or question detail first.
  useEffect(() => {
    if (!sel && !selQ) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setSel(null);
      setSelQ(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sel, selQ]);
  const a = s.assumptions;
  const vs = n.vendors;
  const reviewCount = n.cells.filter((c) => c.status === "review").length;

  const rows = useMemo(() => s.rfx.lines.filter((l) => !onlyReview || vs.some((v) => ["review", "deviation"].includes(n.cellMap[key(v.vendor_id, l.id)]?.status))), [s.rfx.lines, onlyReview, n, vs]);

  if (!vs.length) {
    const b = blocker(s);
    return <Blocked b={b || { title: "Nothing to compare yet", text: "Read the quotes first. Every price then lands here side by side.", to: "quotes", cta: "Go to Read quotes" }} go={go} />;
  }

  const setA = (patch: Partial<typeof a>, what: string) => {
    set((x) => ({ ...x, assumptions: { ...x.assumptions, ...patch } }));
    log(what);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      {/* assumptions */}
      <Card className="px-4 py-2.5 text-[12.5px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button onClick={() => setShowBasis(!showBasis)} aria-expanded={showBasis} className="flex items-center gap-2 text-left" title="The assumptions behind every price. Open to change them.">
            <span aria-hidden="true" className={cx("text-[10px] text-muted transition-transform", showBasis && "rotate-90")}>▶</span>
            <span className="font-semibold">Prices are ₹ per piece, delivered to Bidadi, ex-GST</span>
            <span className="text-muted">· USD at ₹{a.fx_usd_inr} (your assumption, not a live rate)</span>
            <span className="inline-flex items-center rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink transition hover:border-[#cfd3da] hover:bg-panel">{showBasis ? "Close" : "Assumptions"}</span>
          </button>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => exportWorkbook(s.rfx, n, a, s.audit)}>Export Excel</Button>
            <Button variant="primary" onClick={onNext}>
              Finalise →
            </Button>
          </div>
        </div>
        {showBasis && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-2.5">
            <label className="flex items-center gap-1.5">
              USD→INR
              <input type="number" step="0.1" value={a.fx_usd_inr} onChange={(e) => setA({ fx_usd_inr: parseFloat(e.target.value) || 0 }, `Set FX to ${e.target.value}`)} className="w-20 rounded border border-line px-1.5 py-0.5 tabular" />
            </label>
            <label className="flex items-center gap-1.5" title="What paying later is worth to you, a year. Used on the Finalise page to value payment terms: 60 days to pay is worth more than 30.">
              Cost of money (% a year)
              <input type="number" step="0.5" min="0" value={a.cost_of_capital_pct ?? 10} onChange={(e) => setA({ cost_of_capital_pct: Math.max(0, parseFloat(e.target.value) || 0) }, `Set cost of money to ${e.target.value}%`)} className="w-16 rounded border border-line px-1.5 py-0.5 tabular" />
            </label>
            <span className="flex items-center gap-1.5" title="These vendors quoted at their factory gate, so we add transport to the Bidadi plant. Change the rate and every total updates.">
              Add freight (₹/kg) for vendors who quoted ex-works:
              {vs
                .filter((v) => v.terms.freight.startsWith("Ex-works"))
                .map((v) => (
                  <label key={v.vendor_id} className="flex items-center gap-1 text-muted">
                    {v.name.split(" ")[0]}
                    <input
                      type="number"
                      step="0.05"
                      value={a.freight_inr_per_kg[v.vendor_id] ?? a.default_freight_inr_per_kg}
                      onChange={(e) => setA({ freight_inr_per_kg: { ...a.freight_inr_per_kg, [v.vendor_id]: parseFloat(e.target.value) || 0 } }, `Set freight for ${v.name} to ₹${e.target.value}/kg`)}
                      className="w-16 rounded border border-line px-1.5 py-0.5 tabular text-ink"
                    />
                  </label>
                ))}
            </span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={a.apply_conditional_rebates} onChange={(e) => setA({ apply_conditional_rebates: e.target.checked }, `${e.target.checked ? "Counted" : "Stopped counting"} conditional rebates`)} />
              <span title="Some vendors offer a discount only if a condition is met, such as a yearly volume. Tick to count it anyway.">Count rebates that need a condition</span>
            </label>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-4 text-[13px]">
        {(["prices", "questionnaire", "audit"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("border-b-2 pb-1 capitalize", tab === t ? "border-brand font-medium" : "border-transparent text-muted")}>
            {t === "prices" ? "Price comparison" : t === "questionnaire" ? "Questionnaire & documents" : `Audit log (${s.audit.length})`}
          </button>
        ))}
        {tab === "prices" && (
          <label className="ml-auto flex items-center gap-1.5 text-[12.5px]">
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Show only lines needing review <Badge tone="warn" title="Prices flagged for a second look, across all vendors">{reviewCount} {reviewCount === 1 ? "price" : "prices"} to check</Badge>
          </label>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <Card className="min-h-0 flex-1 overflow-auto">
          {tab === "prices" && <PriceGrid n={n} rows={rows} sel={sel} onSel={(v, l) => { setSel({ v, l }); setSelQ(null); }} onClarify={setClarify} />}
          {tab === "questionnaire" && <QGrid n={n} onSel={(v, q) => { setSelQ({ v, q }); setSel(null); }} sel={selQ} />}
          {tab === "audit" && (
            <div className="divide-y divide-line text-[12.5px]">
              {s.audit.map((x, i) => (
                <div key={i} className="flex gap-3 px-4 py-2">
                  <span className="w-44 text-muted">{new Date(x.at).toLocaleString("en-IN")}</span>
                  <span className="w-28">{x.who}</span>
                  <span className="flex-1">{x.what}</span>
                </div>
              ))}
              {!s.audit.length && <div className="p-6 text-muted">Nothing yet.</div>}
            </div>
          )}
        </Card>
        {sel && n.cellMap[key(sel.v, sel.l)] && <CellDrawer c={n.cellMap[key(sel.v, sel.l)]} v={vs.find((x) => x.vendor_id === sel.v)!} onClose={() => setSel(null)} />}
        {clarify && (() => {
          const v = vs.find((x) => x.vendor_id === clarify)!;
          return <ClarifyModal v={v} points={vendorPoints(v, n, s.rfx)} onClose={() => setClarify(null)} />;
        })()}
        {selQ && <QDrawer qc={n.q.find((x) => x.vendor_id === selQ.v && x.question_id === selQ.q)!} v={vs.find((x) => x.vendor_id === selQ.v)!} onClose={() => setSelQ(null)} />}
      </div>
    </div>
  );
}

function VendorHead({ v, n, onClarify }: { v: VendorSummary; n: Normalized; onClarify: () => void }) {
  const { s } = useStore();
  const asked = s.asked?.[v.vendor_id];
  const q = QUAL[v.qualification];
  const warn = v.flags.filter((f) => f.sev !== "info");
  // Everything that used to be its own line, as one short line. The full wording is on hover.
  const short: Record<string, string> = { TOTAL_MISMATCH: "total differs from lines", TAX_UNCLEAR: "GST not stated" };
  const issues = [
    ...(v.deviation > 0 ? [`${v.deviation} off-spec`] : []),
    ...(v.review > 0 ? [`${v.review} to review`] : []),
    ...warn.map((f) => short[f.code] || f.msg.split(/[.;:]/)[0].slice(0, 40)),
  ];
  const full = [
    ...(v.deviation > 0 ? [`${v.deviation} on a different spec, not counted`] : []),
    ...(v.review > 0 ? [`${v.review} need review`] : []),
    ...warn.map((f) => f.msg),
  ];
  return (
    <div className="space-y-1 text-left font-normal normal-case tracking-normal">
      <div className="text-[12.5px] font-semibold text-ink">{v.name}</div>
      <div className="flex flex-wrap gap-1">
        <Badge tone={q.tone} title={`${q.label}: ${v.qualification === "qualified" ? "answered every must-have question and the documents are in date." : v.qualification === "conditional" ? "something still needs proof before this vendor can be approved." : "failed at least one must-have."}${v.qual_reasons.length ? "\n" + v.qual_reasons.join("\n") : ""}`}>
          {q.label}
        </Badge>
      </div>
      <div className="text-[11px] text-muted">
        {v.quoted - v.deviation}/{n.cells.filter((c) => c.vendor_id === v.vendor_id).length} priced · {v.terms.currency} · {v.terms.freight}
      </div>
      {issues.length > 0 && (
        <div className="text-[11px] leading-snug text-warn" title={full.join("\n")}>
          {issues.join(" · ")}
        </div>
      )}
      <button onClick={onClarify} className="text-[11px] font-medium text-kraft hover:underline">
        {asked ? `Emailed ${new Date(asked.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · resend` : "Email vendor"}
      </button>
    </div>
  );
}

function PriceGrid({ n, rows, sel, onSel, onClarify }: { n: Normalized; rows: any[]; sel: { v: string; l: string } | null; onSel: (v: string, l: string) => void; onClarify: (v: string) => void }) {
  const vs = n.vendors;
  return (
    <table className="w-full border-separate border-spacing-0 text-[12.5px] tabular">
      <thead className="sticky top-0 z-10 bg-panel text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="sticky left-0 z-20 min-w-[260px] border-b border-line bg-panel px-3 py-2 text-left">Line</th>
          {vs.map((v) => (
            <th key={v.vendor_id} className="min-w-[150px] border-b border-l border-line px-3 py-2 align-top">
              <VendorHead v={v} n={n} onClarify={() => onClarify(v.vendor_id)} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => {
          const cs = vs.map((v) => n.cellMap[key(v.vendor_id, l.id)]);
          const valid = cs.filter((c) => c && c.unit_inr !== null && c.status !== "deviation" && c.status !== "excluded");
          const best = valid.length ? Math.min(...valid.map((c) => c.unit_inr!)) : null;
          const qualified = valid.filter((c) => vs.find((v) => v.vendor_id === c.vendor_id)?.qualification === "qualified");
          const bestQ = qualified.length ? Math.min(...qualified.map((c) => c.unit_inr!)) : null;
          return (
            <tr key={l.id}>
              <td className="sticky left-0 z-[5] border-b border-line bg-white px-3 py-1.5">
                <div className="font-medium">
                  {l.id} <span className="font-normal text-muted">· {l.annual_qty.toLocaleString("en-IN")}/yr</span>
                </div>
                <div className="text-[11.5px] text-muted">{l.description}</div>
              </td>
              {cs.map((c, i) => (
                <td key={i} onClick={() => c && onSel(c.vendor_id, c.line_id)} className={cx("cursor-pointer border-b border-l border-line px-3 py-1.5 align-top hover:bg-panel", sel?.v === c?.vendor_id && sel?.l === l.id && "outline outline-2 -outline-offset-2 outline-kraft")}>
                  {c && <CellView c={c} best={best} bestQ={bestQ} />}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      <tfoot className="sticky bottom-0 z-20 bg-panel">
        <tr>
          <td className="sticky left-0 z-30 border-t border-line bg-panel px-3 py-2 font-semibold">
            Like-for-like basket
            <div className="text-[11px] font-normal text-muted">{n.basket.length} lines every vendor priced at spec. Compare vendors on this row.</div>
          </td>
          {vs.map((v) => {
            const min = Math.min(...vs.map((x) => x.basket_total_inr));
            return (
              <td key={v.vendor_id} className={cx("border-l border-t border-line px-3 py-2 font-semibold", v.basket_total_inr === min && "text-good")}>
                {n.basket.length ? crore(v.basket_total_inr) : "–"}
              </td>
            );
          })}
        </tr>
        <tr>
          <td className="sticky left-0 z-30 border-t border-line bg-panel px-3 py-2 text-muted">
            Annual value of the lines each vendor priced
            <div className="text-[11px] text-muted">Not for comparing: each vendor priced a different number of lines ({vs.map((v) => `${v.quoted}`).join(" / ")}).</div>
          </td>
          {vs.map((v) => (
            <td key={v.vendor_id} className="border-l border-t border-line px-3 py-2 text-muted">
              <div>{crore(v.total_inr)}</div>
              {v.total_if_rebate_inr < v.total_inr - 1 && <div className="text-[11px]">{crore(v.total_if_rebate_inr)} if rebate earned</div>}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

function CellView({ c, best, bestQ }: { c: Cell; best: number | null; bestQ: number | null }) {
  if (c.status === "missing")
    return (
      <div className="text-[11.5px] text-muted" title={c.missing_reason}>
        — {c.flags.some((f) => f.code === "NO_PRIOR_PRICE") ? <Badge tone="warn" title="The vendor said 'same as last year', but there is no last-year price for this line. Ask them for a price.">ask vendor</Badge> : <span>not quoted</span>}
      </div>
    );
  if (c.status === "excluded") return <div className="text-[11.5px] text-muted line-through">excluded</div>;
  const isBest = best !== null && c.unit_inr === best;
  const isBestQ = bestQ !== null && c.unit_inr === bestQ;
  return (
    <div className={cx("-mx-1.5 rounded px-1.5 py-0.5", c.status === "review" && "bg-warn-soft/60", c.status === "deviation" && "bg-panel")}>
      <div className="flex items-center justify-between gap-1">
        <span className={cx("font-semibold", isBest && "text-good", c.status === "deviation" && "text-muted line-through decoration-1")}>{inr(c.unit_inr)}</span>
        <span className="flex gap-0.5">
          {isBestQ && <span title="Lowest among approved vendors" className="h-1.5 w-1.5 self-center rounded-full bg-good" />}
          {c.status === "review" && <span title="Needs review" className="h-1.5 w-1.5 self-center rounded-full bg-warn" />}
          {c.status === "deviation" && <Badge tone="warn">alt spec</Badge>}
          {c.override && <span title="Buyer decided" className="text-[10px] font-medium text-good">checked</span>}
          {c.derived_from === "prior_contract" && <Badge title="The vendor wrote 'same as last year', so this is the FY26 contract price (plus freight if they quoted ex-works).">FY26</Badge>}
          {c.derived_from === "rule" && <Badge title="The vendor gave one ₹/kg rate for a group of items. The price per piece is that rate times the estimated box weight.">₹/kg</Badge>}
        </span>
      </div>
      <div className="truncate text-[10.5px] text-muted">{c.quoted_as}</div>
    </div>
  );
}

function CellDrawer({ c, v, onClose }: { c: Cell; v: VendorSummary; onClose: () => void }) {
  const { s, set, log } = useStore();
  const [ov, setOv] = useState("");
  const [note, setNote] = useState("");
  const line = s.rfx.lines.find((l) => l.id === c.line_id)!;
  const k = key(c.vendor_id, c.line_id);
  const act = (action: "accept" | "override" | "exclude" | "reset") => {
    set((x) => {
      const o = { ...x.overrides };
      if (action === "reset") delete o[k];
      else o[k] = { action, unit_inr: action === "override" ? parseFloat(ov) : undefined, note, at: new Date().toISOString() };
      return { ...x, overrides: o };
    });
    log(`${action === "reset" ? "Reset" : action[0].toUpperCase() + action.slice(1)} ${v.name} / ${c.line_id}${action === "override" ? ` → ₹${ov}` : ""}${note ? ` (“${note}”)` : ""}`);
    setNote("");
    setOv("");
  };
  const srcUrl = c.source && s.responses.find((r) => r.vendor.id === c.vendor_id)?.vendor.attachments.find((a) => fileName(a) === c.source!.file);
  const STATUS: Record<string, { label: string; tone: "good" | "warn" | "neutral" }> = {
    ok: { label: "Looks fine", tone: "good" },
    review: { label: "Check this price", tone: "warn" },
    deviation: { label: "Different spec", tone: "warn" },
    missing: { label: "No price", tone: "neutral" },
    excluded: { label: "Excluded", tone: "neutral" },
  };
  const st = STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
  // Steps already show the freight sum, so the matching note would only repeat it.
  const alerts = c.flags.filter((f) => f.sev !== "info");
  const notes = c.flags.filter((f) => f.sev === "info" && f.code !== "FREIGHT_ADDED");
  const head = "text-[11px] font-semibold uppercase tracking-wide text-muted";
  const ovText = c.override
    ? `${c.override.action === "override" ? `You set the price to ${inr(c.override.unit_inr)}` : c.override.action === "exclude" ? "You excluded this price" : "You marked this price as right"}${c.override.note ? `: ${c.override.note}` : ""}`
    : "";
  return (
    <Card className="flex w-[380px] shrink-0 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="text-xs text-muted">{v.name}</div>
          <div className="font-semibold leading-snug">
            {c.line_id} · {line.description}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-[12.5px]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-2xl font-semibold tabular">{inr(c.unit_inr)}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <div className="mt-1 text-muted">
            per {line.uom}, delivered, ex-GST
            {c.per_kg !== null && ` · about ₹${c.per_kg.toFixed(1)}/kg · ${crore(c.annual_inr || 0)} a year`}
          </div>
        </div>
        {c.missing_reason && <div className="rounded bg-panel p-2">{c.missing_reason}</div>}
        {alerts.length > 0 && (
          <div>
            <div className={cx(head, "mb-1.5")}>Why this needs a look</div>
            <ul className="space-y-1.5">
              {alerts.map((f, i) => (
                <li key={i} className={cx("rounded px-2.5 py-2 leading-snug", f.sev === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad")}>
                  {f.msg}
                </li>
              ))}
            </ul>
          </div>
        )}
        {c.steps.length > 0 && (
          <div>
            <div className={cx(head, "mb-1.5")}>How we got this price</div>
            <dl className="divide-y divide-line rounded border border-line">
              {c.steps.map((x, i) => (
                <div key={i} className={cx("px-2.5 py-2", i === c.steps.length - 1 && "bg-panel font-semibold")}>
                  <dt className="text-[11.5px] font-medium text-muted">{x.label}</dt>
                  <dd className="mt-0.5 leading-snug">{x.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {notes.length > 0 && (
          <div>
            <div className={cx(head, "mb-1.5")}>Good to know</div>
            <ul className="list-disc space-y-1 pl-4 leading-snug text-muted">
              {notes.map((f, i) => (
                <li key={i}>{f.msg}</li>
              ))}
            </ul>
          </div>
        )}
        {c.source && (
          <div>
            <div className={cx(head, "mb-1.5")}>Where it came from</div>
            <div className="rounded border border-line p-2.5">
              <div className="font-mono text-[11.5px] leading-snug">&ldquo;{c.source.quote}&rdquo;</div>
              <div className="mt-1.5 text-[11px] text-muted">
                {srcUrl ? (
                  <a className="text-kraft hover:underline" href={srcUrl} target="_blank" rel="noreferrer">
                    {c.source.file}
                  </a>
                ) : (
                  c.source.file
                )}
                {c.source.location ? ` · ${c.source.location}` : ""}
              </div>
            </div>
          </div>
        )}
        <div className="space-y-3 border-t border-line pt-4">
          <div className={head}>Your decision</div>
          {(() => {
            const d = c.override?.action;
            const pick = "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-40";
            return (
              <div className="flex gap-2" role="group" aria-label="Decision">
                {c.unit_inr !== null && (
                  <button
                    type="button"
                    aria-pressed={d === "accept"}
                    onClick={(e) => { e.currentTarget.blur(); act("accept"); }}
                    className={cx(pick, "flex-1", d === "accept" ? "border-good bg-good text-white shadow-sm" : "border-line bg-white hover:border-good/50 hover:bg-good-soft", d && d !== "accept" && "text-muted")}
                  >
                    {d === "accept" ? "✓ Approved" : "Looks right"}
                  </button>
                )}
                <button
                  type="button"
                  aria-pressed={d === "exclude"}
                  onClick={(e) => { e.currentTarget.blur(); act("exclude"); }}
                  className={cx(pick, "flex-1", d === "exclude" ? "border-bad bg-bad text-white shadow-sm" : "bg-white hover:bg-bad-soft", d === "exclude" ? "" : d ? "border-line text-muted" : "border-bad/30 text-bad")}
                >
                  {d === "exclude" ? "✕ Excluded" : "Exclude"}
                </button>
              </div>
            );
          })()}
          {c.override && (
            <div className={cx("flex items-start justify-between gap-3 rounded-lg px-3 py-2 leading-snug", c.override.action === "exclude" ? "bg-bad-soft text-bad" : "bg-good-soft text-good")}>
              <div>
                {ovText}
                <div className="text-[11px] opacity-80">{new Date(c.override.at).toLocaleString("en-IN")}</div>
              </div>
              <button type="button" className="shrink-0 text-[12px] font-medium underline underline-offset-2 hover:no-underline" onClick={(e) => { e.currentTarget.blur(); act("reset"); }}>
                Undo
              </button>
            </div>
          )}
          <div>
            <label htmlFor="ov-price" className="mb-1 block text-[12px] text-muted">
              Or use a different price
            </label>
            <div className="flex gap-2">
              <input id="ov-price" className="w-28 rounded border border-line px-2 py-1.5 tabular" inputMode="decimal" placeholder={`₹ per ${line.uom}`} value={ov} onChange={(e) => setOv(e.target.value)} />
              <Button variant={ov && !isNaN(parseFloat(ov)) ? "primary" : "default"} disabled={!ov || isNaN(parseFloat(ov))} onClick={() => act("override")}>
                Use price
              </Button>
            </div>
          </div>
          <input className="w-full rounded border border-line px-2 py-1.5" aria-label="Note" placeholder="Add a note (optional). It is saved in the audit log." value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Card>
  );
}

const QTONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { pass: "good", partial: "warn", fail: "bad", unanswered: "neutral" };

function QGrid({ n, onSel, sel }: { n: Normalized; onSel: (v: string, q: string) => void; sel: { v: string; q: string } | null }) {
  const { s } = useStore();
  const vs = n.vendors;
  return (
    <table className="w-full border-separate border-spacing-0 text-[12.5px]">
      <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="min-w-[280px] border-b border-line px-3 py-2 text-left">Question</th>
          {vs.map((v) => (
            <th key={v.vendor_id} className="min-w-[160px] border-b border-l border-line px-3 py-2 text-left">
              <div className="normal-case tracking-normal text-ink">{v.name}</div>
              <Badge tone={QUAL[v.qualification].tone}>{QUAL[v.qualification].label}</Badge>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {s.rfx.questionnaire.map((q) => (
          <tr key={q.id}>
            <td className="border-b border-line px-3 py-2 align-top">
              <b>{q.id}</b> {q.text} {q.must_have && <Badge tone="bad">must-have</Badge>}
            </td>
            {vs.map((v) => {
              const qc = n.q.find((x) => x.vendor_id === v.vendor_id && x.question_id === q.id);
              return (
                <td key={v.vendor_id} onClick={() => onSel(v.vendor_id, q.id)} className={cx("cursor-pointer border-b border-l border-line px-3 py-2 align-top hover:bg-panel", sel?.v === v.vendor_id && sel?.q === q.id && "outline outline-2 -outline-offset-2 outline-kraft")}>
                  {qc && (
                    <>
                      <Badge tone={QTONE[qc.assessment]}>
                        {qc.assessment}
                        {qc.overridden ? " (you)" : ""}
                      </Badge>
                      <div className="mt-1 line-clamp-3 text-[11.5px] text-muted">{qc.answer}</div>
                      {qc.auto_note && <div className="mt-1 text-[11px] text-bad">⚑ {qc.auto_note}</div>}
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
        <tr>
          <td className="px-3 py-2 align-top font-semibold">Documents received</td>
          {vs.map((v) => {
            const r = s.responses.find((x) => x.vendor.id === v.vendor_id);
            return (
              <td key={v.vendor_id} className="border-l border-line px-3 py-2 align-top text-[11.5px]">
                {(r?.extraction?.documents || []).map((d, i) => (
                  <div key={i} className="mb-1">
                    📎 {d.file} <span className="text-muted">({d.kind})</span>
                    {d.valid_until && <div className={cx(d.valid_until < s.rfx.due_date ? "text-bad" : "text-muted")}>valid until {d.valid_until}</div>}
                  </div>
                ))}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

function QDrawer({ qc, v, onClose }: { qc: QCell; v: VendorSummary; onClose: () => void }) {
  const { s, set, log } = useStore();
  const q = s.rfx.questionnaire.find((x) => x.id === qc.question_id)!;
  const k = key(qc.vendor_id, qc.question_id);
  const setQ = (val: "pass" | "fail" | "partial" | "unanswered" | null) => {
    set((x) => {
      const o = { ...x.qOverrides };
      if (val) o[k] = val;
      else delete o[k];
      return { ...x, qOverrides: o };
    });
    log(`${val ? `Marked ${v.name} ${q.id} as ${val}` : `Reset ${v.name} ${q.id}`}`);
  };
  return (
    <Card className="flex w-[360px] shrink-0 flex-col overflow-hidden">
      <div className="flex items-start justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-xs text-muted">{v.name}</div>
          <div className="font-semibold">
            {q.id} {q.must_have && <Badge tone="bad">must-have</Badge>}
          </div>
        </div>
        <button onClick={onClose} className="text-muted">
          ✕
        </button>
      </div>
      <div className="space-y-3 overflow-y-auto p-4 text-[12.5px]">
        <div className="text-muted">{q.text}</div>
        <div className="rounded bg-panel p-2">{qc.answer}</div>
        <div>
          <Badge tone={QTONE[qc.assessment]}>{qc.assessment}</Badge> <span className="text-muted">{qc.reasoning}</span>
        </div>
        {qc.auto_note && <div className="rounded bg-bad-soft p-2 text-bad">System check: {qc.auto_note}</div>}
        {qc.source && (
          <div className="rounded border border-line p-2 font-mono text-[11.5px]">
            “{qc.source.quote}”<div className="mt-1 font-sans text-[11px] text-muted">{qc.source.file} · {qc.source.location}</div>
          </div>
        )}
        <div className="border-t border-line pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Buyer decision</div>
          <div className="flex flex-wrap gap-2">
            {(["pass", "partial", "fail"] as const).map((x) => (
              <Button key={x} onClick={() => setQ(x)}>
                {x}
              </Button>
            ))}
            {qc.overridden && (
              <Button variant="ghost" onClick={() => setQ(null)}>
                Reset
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
