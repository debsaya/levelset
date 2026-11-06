"use client";
import { readBackIssue } from "@/lib/readback";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, inr, key, type Cell, type Normalized, type QCell, type VendorSummary } from "@/lib/normalize";
import { exportWorkbook } from "@/lib/export";
import { postJson } from "@/lib/api";
import { fileName } from "./InboxStep";
import { Badge, Button, Card, Spinner, cx } from "./ui";

const QUAL: Record<string, { tone: "good" | "warn" | "bad"; label: string }> = {
  qualified: { tone: "good", label: "Approved" },
  conditional: { tone: "warn", label: "Needs proof" },
  not_qualified: { tone: "bad", label: "Not approved" },
};

export default function CompareStep({ n, onNext, onBack, initialReview }: { n: Normalized; onNext: () => void; onBack?: () => void; initialReview?: boolean }) {
  const { s, set, log } = useStore();
  const [tab, setTab] = useState<"prices" | "questionnaire" | "audit">("prices");
  const [onlyReview, setOnlyReview] = useState(!!initialReview);
  const [sel, setSel] = useState<{ v: string; l: string } | null>(null);
  const [selQ, setSelQ] = useState<{ v: string; q: string } | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);
  const [showBasis, setShowBasis] = useState(false);
  const a = s.assumptions;
  const vs = n.vendors;
  const reviewCount = n.cells.filter((c) => c.status === "review").length;

  const rows = useMemo(() => s.rfx.lines.filter((l) => !onlyReview || vs.some((v) => ["review", "deviation"].includes(n.cellMap[key(v.vendor_id, l.id)]?.status))), [s.rfx.lines, onlyReview, n, vs]);

  if (!vs.length)
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-6 py-8">
          <div className="rounded-2xl border border-line bg-white p-8 text-center">
            <div className="text-[20px] font-semibold">Nothing to compare yet</div>
            <p className="mx-auto mt-2 max-w-md text-muted">Once the vendor quotes are read, every price lands side by side here, normalised to one basis.</p>
            {onBack && (
              <Button variant="primary" className="mt-5 px-5 py-2.5 text-[14px]" onClick={onBack}>
                Go to Read quotes
              </Button>
            )}
          </div>
        </div>
      </div>
    );

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
            <span className={cx("text-[10px] text-muted transition-transform", showBasis && "rotate-90")}>▶</span>
            <span className="font-semibold">Prices are ₹ per piece, delivered to Bidadi, ex-GST</span>
            <span className="text-muted">· USD at ₹{a.fx_usd_inr}{showBasis ? "" : " · change assumptions"}</span>
          </button>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => exportWorkbook(s.rfx, n, a, s.audit)}>Export to Excel</Button>
            <Button variant="primary" onClick={onNext}>
              Continue to decision →
            </Button>
          </div>
        </div>
        {showBasis && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-2.5">
            <label className="flex items-center gap-1.5">
              USD→INR
              <input type="number" step="0.1" value={a.fx_usd_inr} onChange={(e) => setA({ fx_usd_inr: parseFloat(e.target.value) || 0 }, `Set FX to ${e.target.value}`)} className="w-20 rounded border border-line px-1.5 py-0.5 tabular" />
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
            Show only lines needing review <Badge tone="warn">{reviewCount} prices</Badge>
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
          return <ClarifyModal v={v} issues={vendorIssues(v, n, s.rfx, s.responses)} onClose={() => setClarify(null)} />;
        })()}
        {selQ && <QDrawer qc={n.q.find((x) => x.vendor_id === selQ.v && x.question_id === selQ.q)!} v={vs.find((x) => x.vendor_id === selQ.v)!} onClose={() => setSelQ(null)} />}
      </div>
    </div>
  );
}

function VendorHead({ v, n, onClarify }: { v: VendorSummary; n: Normalized; onClarify: () => void }) {
  const q = QUAL[v.qualification];
  const warn = v.flags.filter((f) => f.sev !== "info");
  return (
    <div className="space-y-1 text-left font-normal normal-case tracking-normal">
      <div className="text-[12.5px] font-semibold text-ink">{v.name}</div>
      <div className="flex flex-wrap gap-1">
        <Badge tone={q.tone} title={v.qual_reasons.join("\n") || "All must-haves met"}>
          {q.label}
        </Badge>
      </div>
      <div className="text-[11px] text-muted">
        {v.quoted}/{n.cells.filter((c) => c.vendor_id === v.vendor_id).length} priced · {v.terms.currency} · {v.terms.freight}
      </div>
      {v.review > 0 && <div className="text-[11px] text-warn">{v.review} need review</div>}
      {warn.map((f, i) => (
        <div key={i} className="text-[11px] leading-snug text-warn" title={f.msg}>
          {f.code === "TOTAL_MISMATCH" ? "Stated total doesn't match its lines" : f.msg.slice(0, 60)}
        </div>
      ))}
      <button onClick={onClarify} className="text-[11px] font-medium text-kraft hover:underline">
        Draft clarification email
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
            Annual value, lines priced
            <div className="text-[11px] font-normal text-muted">different lines per vendor — not comparable</div>
          </td>
          {vs.map((v) => (
            <td key={v.vendor_id} className="border-l border-t border-line px-3 py-2">
              <div className="font-semibold">{crore(v.total_inr)}</div>
              {v.total_if_rebate_inr < v.total_inr - 1 && <div className="text-[11px] text-muted">{crore(v.total_if_rebate_inr)} if rebate earned</div>}
            </td>
          ))}
        </tr>
        <tr>
          <td className="sticky left-0 z-30 border-t border-line bg-panel px-3 py-2 font-semibold">
            Like-for-like basket
            <div className="text-[11px] font-normal text-muted">{n.basket.length} lines every vendor priced at spec</div>
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
      </tfoot>
    </table>
  );
}

function CellView({ c, best, bestQ }: { c: Cell; best: number | null; bestQ: number | null }) {
  if (c.status === "missing")
    return (
      <div className="text-[11.5px] text-muted" title={c.missing_reason}>
        — {c.flags.some((f) => f.code === "NO_PRIOR_PRICE") ? <Badge tone="warn">ask vendor</Badge> : <span>not quoted</span>}
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
          {isBestQ && <span title="Lowest among qualified vendors" className="h-1.5 w-1.5 self-center rounded-full bg-good" />}
          {c.status === "review" && <span title="Needs review" className="h-1.5 w-1.5 self-center rounded-full bg-warn" />}
          {c.status === "deviation" && <Badge tone="warn">alt spec</Badge>}
          {c.override && <span title="Buyer decided" className="text-[10px] font-medium text-good">checked</span>}
          {c.derived_from === "prior_contract" && <Badge>FY26</Badge>}
          {c.derived_from === "rule" && <Badge>₹/kg</Badge>}
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
  return (
    <Card className="flex w-[380px] shrink-0 flex-col overflow-hidden">
      <div className="flex items-start justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-xs text-muted">{v.name}</div>
          <div className="font-semibold">
            {c.line_id} · {line.description}
          </div>
        </div>
        <button onClick={onClose} className="text-muted">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-[12.5px]">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular">{inr(c.unit_inr)}</span>
          <Badge tone={c.status === "ok" ? "good" : c.status === "review" ? "warn" : c.status === "missing" ? "neutral" : "warn"}>{c.status}</Badge>
        </div>
        {c.per_kg !== null && (
          <div className="text-muted">
            ≈ ₹{c.per_kg.toFixed(1)}/kg · annual {crore(c.annual_inr || 0)} · confidence {c.confidence !== null ? Math.round(c.confidence * 100) + "%" : "–"}
          </div>
        )}
        {c.missing_reason && <div className="rounded bg-panel p-2">{c.missing_reason}</div>}
        {c.steps.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">How we got this number</div>
            <ol className="space-y-1">
              {c.steps.map((st, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-5 text-muted">{i + 1}.</span>
                  <span>
                    <b>{st.label}:</b> {st.value}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {c.flags.length > 0 && (
          <div className="space-y-1.5">
            {c.flags.map((f, i) => (
              <div key={i} className={cx("rounded px-2 py-1.5", f.sev === "info" ? "bg-panel" : f.sev === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad")}>

                {f.msg}
              </div>
            ))}
          </div>
        )}
        {c.source && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Source</div>
            <div className="rounded border border-line p-2">
              <div className="font-mono text-[11.5px]">“{c.source.quote}”</div>
              <div className="mt-1 text-[11px] text-muted">
                {srcUrl ? (
                  <a className="text-kraft hover:underline" href={srcUrl} target="_blank">
                    {c.source.file}
                  </a>
                ) : (
                  c.source.file
                )}{" "}
                · {c.source.location}
              </div>
            </div>
          </div>
        )}
        <div className="space-y-2 border-t border-line pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Buyer decision</div>
          {c.override && (
            <div className="rounded bg-good-soft p-2 text-good">
              {c.override.action} {c.override.unit_inr ? inr(c.override.unit_inr) : ""} · {c.override.note || "no note"} · {new Date(c.override.at).toLocaleString("en-IN")}
            </div>
          )}
          <input className="w-full rounded border border-line px-2 py-1.5" placeholder="Note (why) — goes to the audit log" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {c.unit_inr !== null && <Button onClick={() => act("accept")}>Looks right</Button>}
            <Button variant="danger" onClick={() => act("exclude")}>
              Exclude
            </Button>
            {c.override && (
              <Button variant="ghost" onClick={() => act("reset")}>
                Reset
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <input className="w-28 rounded border border-line px-2 py-1.5 tabular" placeholder="₹ / piece" value={ov} onChange={(e) => setOv(e.target.value)} />
            <Button disabled={!ov || isNaN(parseFloat(ov))} onClick={() => act("override")}>
              Override price
            </Button>
          </div>
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

export function vendorIssues(v: VendorSummary, n: Normalized, rfx: any, responses: any[]): string[] {
  const out: string[] = [];
  const cells = n.cells.filter((c) => c.vendor_id === v.vendor_id);
  const lineDesc = (id: string) => `${id} (${rfx.lines.find((l: any) => l.id === id)?.description})`;
  const missing = cells.filter((c) => c.status === "missing" && !c.flags.some((f) => f.code === "NO_PRIOR_PRICE"));
  if (missing.length && missing.length <= 12) out.push(`No price for: ${missing.map((c) => `${lineDesc(c.line_id)} — ${c.missing_reason}`).join("; ")}. Ask whether they can quote.`);
  else if (missing.length) out.push(`No price for ${missing.length} of ${cells.length} lines (${missing.map((c) => c.line_id).join(", ")}). Ask whether they can quote the rest.`);
  for (const c of cells.filter((c) => c.flags.some((f) => f.code === "NO_PRIOR_PRICE"))) out.push(`${lineDesc(c.line_id)}: vendor wrote "${c.source?.quote}" but this line has no price last year. Ask for a price.`);
  for (const c of cells.filter((c) => c.status === "deviation")) out.push(`${lineDesc(c.line_id)}: they offered a different spec (${c.raw?.spec_deviation}). Ask whether they can quote the specified spec, and for test data proving the alternate meets the same BCT.`);
  for (const c of cells.filter((c) => c.status === "review" && !c.override)) {
    const f = c.flags.filter((x) => x.sev !== "info").map((x) => x.msg).join(" ");
    out.push(`${lineDesc(c.line_id)}: read as ${c.quoted_as}${c.source?.quote ? ` from "${c.source.quote}"` : ""}. Unsure because: ${f} Ask them to confirm the price and what unit it is for.`);
  }
  const rules = cells.filter((c) => c.derived_from === "rule");
  if (rules.length) out.push(`Their per-kg statement ("${rules[0].source?.quote}") was applied to ${rules.length} lines using our computed box weights. Ask them to confirm per-piece prices, and whether printed items cost extra.`);
  const prior = cells.filter((c) => c.derived_from === "prior_contract" && c.unit_inr !== null);
  if (prior.length) out.push(`For ${prior.length} lines they said prices are the same as last year; we used the FY26 contract. Ask them to confirm those prices hold for FY27.`);
  for (const a of v.adjustments) if (a.conditional) out.push(`Conditional ${a.kind}: "${a.description}" (condition: ${a.condition}). Ask how it is measured if the award is split across vendors.`);
  for (const a of v.adjustments) if (a.kind === "one_time_charge") out.push(`One-time charge: ${a.description}. Ask whether existing plates/dies can be reused or the charge waived.`);
  if (v.terms.freight.startsWith("Ex-works")) out.push(`Prices are ex-works; we have assumed freight. Ask for a delivered price to the Bidadi plant.`);
  if (v.terms.currency !== "INR") out.push(`Quote is in ${v.terms.currency}. Ask for a firm INR price, or how currency movement will be shared.`);
  for (const r of v.qual_reasons) out.push(`Questionnaire must-have: ${r}. Ask for evidence or a corrective plan.`);
  for (const f of v.flags.filter((f) => f.code === "TOTAL_MISMATCH")) out.push(`${f.msg} Ask them to confirm which lines their total covers.`);
  const rb = readBackIssue(v.vendor_id, n, rfx);
  if (rb) out.push(rb);
  void responses;
  return out;
}

export function ClarifyModal({ v, issues, onClose }: { v: VendorSummary; issues: string[]; onClose: () => void }) {
  const { s, log } = useStore();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body: string; model?: string } | null>(null);
  const [err, setErr] = useState("");
  const vendor = s.responses.find((r) => r.vendor.id === v.vendor_id)?.vendor;
  async function go() {
    setBusy(true);
    setErr("");
    try {
      const j = await postJson("/api/clarify", { vendor: { name: v.name, contact: vendor?.contact }, buyer: s.rfx.buyer, rfx_id: s.rfx.id, rfx_title: s.rfx.title, issues, today: new Date().toISOString().slice(0, 10) });
      if (j.error) throw new Error(j.error);
      setDraft(j);
      log(`Drafted clarification email to ${v.name} (${issues.length} issues)`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <Card className="flex max-h-full w-[760px] flex-col overflow-hidden" >
        <div className="flex items-center justify-between border-b border-line px-5 py-3" onClick={(e) => e.stopPropagation()}>
          <div>
            <div className="font-semibold">Clarify with {v.name}</div>
            <div className="text-xs text-muted">The system found {issues.length} open issues. The AI turns them into one email the vendor can answer line by line.</div>
          </div>
          <button onClick={onClose} className="text-muted">✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-[13px]" onClick={(e) => e.stopPropagation()}>
          <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted">
            {issues.map((i, k) => <li key={k}>{i}</li>)}
          </ol>
          {err && <div className="rounded bg-bad-soft p-2 text-bad">{err}</div>}
          {draft ? (
            <div className="rounded-md border border-line">
              <div className="border-b border-line bg-panel px-3 py-2 text-[12.5px]"><b>Subject:</b> {draft.subject}</div>
              <pre className="whitespace-pre-wrap p-3 font-sans text-[13px] leading-relaxed">{draft.body}</pre>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3" onClick={(e) => e.stopPropagation()}>
          {draft && <Button onClick={() => navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)}>Copy</Button>}
          <Button variant="primary" onClick={go} disabled={busy || !issues.length}>{busy ? <Spinner /> : null}{draft ? "Redraft" : "Draft email"}</Button>
        </div>
      </Card>
    </div>
  );
}
