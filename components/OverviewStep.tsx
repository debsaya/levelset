"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, type Normalized } from "@/lib/normalize";
import { lastYear, savingOnCommon, scenarios } from "@/lib/award";
import { exportWorkbook } from "@/lib/export";
import { useReader } from "@/lib/reader";
import { ClarifyModal, vendorIssues } from "./CompareStep";
import { Badge, Blocked, Button, Spinner, cx } from "./ui";
import { blocker } from "@/lib/flow";

type Go = (page: "compare" | "ask" | "quotes" | "rfx", opts?: { review?: boolean; ask?: string }) => void;

const QUAL = {
  qualified: { tone: "good" as const, label: "Approved" },
  conditional: { tone: "warn" as const, label: "Needs proof" },
  not_qualified: { tone: "bad" as const, label: "Not approved" },
};

/** Step 4: the decision. One answer up front; everything that supports it is one click away. */
export default function OverviewStep({ n, go }: { n: Normalized; go: Go }) {
  const { s } = useStore();
  const { readAll, hasSaved, loadSaved } = useReader();
  const [clarify, setClarify] = useState<string | null>(null);
  const total = s.responses.length;
  const done = s.responses.filter((r) => r.status === "done").length;
  const reading = s.responses.filter((r) => r.status === "reading").length;
  const errors = s.responses.filter((r) => r.status === "error").length;
  const sc = useMemo(() => scenarios(s.rfx, n), [s.rfx, n]);
  const best = [...sc].filter((x) => x.key !== "split_qc").sort((a, b) => b.linesCovered - a.linesCovered || a.total - b.total)[0];
  const ly = useMemo(() => lastYear(s.rfx, s.prior, best, n), [s.rfx, s.prior, best, n]);
  const review = n.cells.filter((c) => c.status === "review").length;
  const issues = useMemo(() => Object.fromEntries(n.vendors.map((v) => [v.vendor_id, vendorIssues(v, n, s.rfx, s.responses)])), [n, s.rfx, s.responses]);
  const approved = n.vendors.filter((v) => v.qualification === "qualified").length;
  const attention = n.vendors.filter((v) => v.qualification !== "qualified").length + n.vendors.filter((v) => v.adjustments.some((a) => a.conditional)).length;

  const names = best ? best.vendorsUsed.map((v) => `${v.name.split(" ")[0]} (${v.lines} ${v.lines === 1 ? "item" : "items"})`) : [];
  const headline = !best
    ? "No approved vendor has cleared the must-have questions yet"
    : best.vendorsUsed.length === 1
      ? `Award all ${best.linesCovered} items to ${best.vendorsUsed[0].name}`
      : `Split the award: ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  const lyUp = !!ly && ly.delta > 0;
  const tile = "rounded-xl bg-white/[0.07] p-3.5";
  const tileLabel = "text-[11px] font-medium uppercase tracking-[0.06em] text-white/55";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1480px] space-y-4 px-5 py-6 lg:px-8">
        {done === 0 ? (
          <Blocked bare b={blocker(s) || { title: "Nothing to decide yet", text: "Read the quotes first. Your recommended award then appears here.", to: "quotes", cta: "Go to Read quotes" }} go={(p) => go(p)} />
        ) : (
          <>
            {done < total && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-kraft-soft px-4 py-3 text-[13px]">
                <span>
                  {done} of {total} replies read, so this covers only those. {errors > 0 ? `${errors} couldn't be read (connection or busy AI).` : ""}
                </span>
                <div className="flex items-center gap-2">
                  {hasSaved && (
                    <Button variant="ghost" onClick={loadSaved} disabled={reading > 0}>
                      Load saved reading
                    </Button>
                  )}
                  <Button onClick={readAll} disabled={reading > 0}>
                    {reading ? <Spinner /> : null} Read the rest
                  </Button>
                </div>
              </div>
            )}

            <section className="overflow-hidden rounded-2xl bg-ink text-white">
              <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:p-7">
                <div className="flex flex-col">
                  <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/60">Recommended award</div>
                  <h1 className="mt-1.5 text-[26px] font-semibold leading-snug">{headline}</h1>
                  {best && <p className="mt-1 text-[13.5px] text-white/70">{best.detail}</p>}
                  {best && (
                    <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-[48px] font-semibold leading-none tabular">{crore(best.total)}</span>
                      <span className="text-[13px] text-white/70">a year, delivered to your plant, ex-GST</span>
                    </div>
                  )}
                  {best && best.linesMissing.length > 0 && <div className="mt-2 text-[13px] text-white/80">No approved price for {best.linesMissing.length === 1 ? "item" : "items"} {best.linesMissing.join(", ")}</div>}
                  <div className="mt-auto flex flex-wrap gap-2 pt-6">
                    <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => exportWorkbook(s.rfx, n, s.assumptions, s.audit)}>
                      Export to Excel
                    </Button>
                    <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => go("ask", { ask: "Why is this the recommended award? Compare the options and show the line-level split." })}>
                      Ask AI why
                    </Button>
                  </div>
                </div>
                {best && (
                  <div className="grid grid-cols-2 gap-3 self-start">
                    <div className={tile}>
                      <div className={tileLabel}>Against last year</div>
                      <div className={cx("mt-1 text-[24px] font-semibold tabular", ly ? (lyUp ? "text-[#f3c06a]" : "text-[#7fd6a4]") : "text-white/60")}>{ly ? `${lyUp ? "+" : "−"}${Math.abs((ly.delta / ly.fy26) * 100).toFixed(1)}%` : "–"}</div>
                      <div className="mt-0.5 text-[12px] leading-snug text-white/65">{ly ? `${crore(Math.abs(ly.delta))} ${lyUp ? "higher" : "lower"}, on the ${ly.lines} items that had a price then` : "No last-year price to compare with"}</div>
                    </div>
                    <div className={tile}>
                      <div className={tileLabel}>Items covered</div>
                      <div className="mt-1 text-[24px] font-semibold tabular">
                        {best.linesCovered}
                        <span className="text-[16px] text-white/55">/{s.rfx.lines.length}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] leading-snug text-white/65">{best.linesMissing.length ? `${best.linesMissing.length} without an approved price` : "every item has an approved price"}</div>
                    </div>
                    <div className={tile}>
                      <div className={tileLabel}>Awarded to</div>
                      <div className="mt-1 text-[24px] font-semibold tabular">{best.vendorsUsed.length} {best.vendorsUsed.length === 1 ? "vendor" : "vendors"}</div>
                      <div className="mt-0.5 text-[12px] leading-snug text-white/65">{best.vendorsUsed.map((v) => `${v.name.split(" ")[0]} ${crore(v.value)}`).join(" · ")}</div>
                    </div>
                    <div className={tile}>
                      <div className={tileLabel}>Approved vendors</div>
                      <div className="mt-1 text-[24px] font-semibold tabular">
                        {approved}
                        <span className="text-[16px] text-white/55">/{n.vendors.length}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] leading-snug text-white/65">answered every must-have question</div>
                    </div>
                  </div>
                )}
              </div>
              {review > 0 && (
                <div role="status" className="flex flex-col gap-3 bg-kraft-soft px-6 py-3.5 text-[13.5px] text-ink sm:flex-row sm:items-center sm:justify-between lg:px-7">
                  <div>
                    <div className="font-semibold">Not final until you check {review} flagged {review === 1 ? "price" : "prices"}</div>
                    <div className="mt-0.5 text-[12.5px] text-muted">
                      The system wasn&apos;t sure about these (unit conversions, photo reads, group rules).{" "}
                      {best ? (best.unverified > 0 ? `${best.unverified} of them are behind this award, so the total can still change.` : "None of them are behind this award, but a correction could still change which vendor wins an item.") : ""}
                    </div>
                  </div>
                  <Button className="shrink-0" onClick={() => go("compare", { review: true })}>
                    Check {review === 1 ? "it" : "them"} →
                  </Button>
                </div>
              )}
            </section>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
              <div className="order-last lg:order-none">
                <Panel title="Vendors" summary={`${n.vendors.length} vendors · ${approved} approved`}>
                  <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                    {[...n.vendors]
                      .sort((a, b) => ({ qualified: 0, conditional: 1, not_qualified: 2 }[a.qualification] - { qualified: 0, conditional: 1, not_qualified: 2 }[b.qualification]) || (a.avg_over_best_pct ?? 1e9) - (b.avg_over_best_pct ?? 1e9))
                      .map((v, i) => (
                        <div key={v.vendor_id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[13.5px] font-semibold leading-snug">{v.name}</div>
                            {done >= 2 && v.qualification !== "not_qualified" && <span className="text-[11px] text-muted tabular">#{i + 1}</span>}
                          </div>
                          <div className="mt-1.5">
                            <Badge tone={QUAL[v.qualification].tone}>{QUAL[v.qualification].label}</Badge>
                          </div>
                          <div className="mt-3 text-[22px] font-semibold tabular">{v.avg_over_best_pct === null ? "–" : v.avg_over_best_pct < 0.05 ? "Cheapest" : `+${v.avg_over_best_pct.toFixed(1)}%`}</div>
                          <div className="text-[11.5px] text-muted">{v.avg_over_best_pct === null ? "no comparable prices" : "vs the lowest price, on the items they quoted"}</div>
                          {(() => {
                            const r = s.responses.find((x) => x.vendor.id === v.vendor_id);
                            const captured = r?.extraction?.lines?.length ?? 0;
                            const left = Math.max(0, captured - v.quoted);
                            const file = r?.vendor.attachments?.[0];
                            return (
                              <div className="mt-3 space-y-1 rounded-lg bg-panel px-2.5 py-2 text-[11.5px] leading-snug text-muted">
                                <div>
                                  <span className="font-medium text-ink">{v.format}</span> → {captured} prices captured
                                </div>
                                <div>→ {v.quoted} matched to your items{left > 0 ? ` (${left} didn't match an item)` : ""}</div>
                                <div className={v.review > 0 ? "text-warn" : undefined}>→ {v.review} flagged for you</div>
                                {file && (
                                  <a href={`/${file}`} target="_blank" rel="noreferrer" className="inline-block pt-0.5 font-medium text-kraft hover:underline">
                                    View the original file ↗
                                  </a>
                                )}
                              </div>
                            );
                          })()}
                          <div className="mt-3 flex items-center justify-between text-[12px]">
                            <span className="text-muted">Payment</span>
                            <span className="tabular">{v.terms.payment ? `${v.terms.payment} days` : "–"}</span>
                          </div>
                          <button onClick={() => setClarify(v.vendor_id)} className="mt-auto pt-3 text-left text-[12.5px] font-medium text-kraft hover:underline">
                            {issues[v.vendor_id]?.length || 0} open questions → draft email
                          </button>
                        </div>
                      ))}
                  </div>
                </Panel>
              </div>

              <div className="space-y-4">
                <Panel title="Needs your attention" summary={attention ? `${attention} ${attention === 1 ? "item" : "items"}` : "nothing open"}>
                  <div className="space-y-1 p-3">
                    {attention === 0 && <div className="p-3 text-[13px] text-muted">Nothing is open.</div>}
                    {n.vendors
                      .filter((v) => v.qualification !== "qualified")
                      .map((v) => (
                        <Attention key={v.vendor_id} tone={v.qualification === "not_qualified" ? "bad" : "warn"} title={`${v.name}: ${QUAL[v.qualification].label.toLowerCase()}`} body={v.qual_reasons.length && v.qual_reasons.every((r) => /not answered/i.test(r)) ? `Didn't answer the ${v.qual_reasons.length} must-have questions` : v.qual_reasons.join("; ") || "Questionnaire incomplete"} action="Ask vendor" onClick={() => setClarify(v.vendor_id)} />
                      ))}
                    {n.vendors
                      .filter((v) => v.adjustments.some((a) => a.conditional))
                      .map((v) => (
                        <Attention key={"r" + v.vendor_id} tone="neutral" title={`${v.name}: ${v.adjustments.filter((a) => a.conditional).every((a) => a.kind === "one_time_charge") ? "one-time charge" : v.adjustments.filter((a) => a.conditional).every((a) => a.kind === "surcharge") ? "surcharge" : "conditional rebate"}`} body={v.adjustments.filter((a) => a.conditional).map((a) => a.description.replace(/\.+$/, "")).join("; ") + ". Not counted in totals."} action="Ask vendor" onClick={() => setClarify(v.vendor_id)} />
                      ))}
                  </div>
                </Panel>

                <Panel title="Other ways to award it" summary={`${sc.length} ${sc.length === 1 ? "way" : "ways"} compared`}>
                  <details className="border-b border-line bg-panel px-5 py-2.5 text-[12.5px] leading-relaxed text-muted">
                    <summary className="cursor-pointer font-medium text-ink">How to read these numbers</summary>
                    <div className="mt-2 space-y-1.5">
                      <p>Each option is a different rule for who can win each item. The recommended one is the lowest total that covers the most items.</p>
                      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                        <dt className="font-medium text-ink">Total</dt>
                        <dd>The winning price for each item times your yearly volume, added up. Delivered to your plant, ex-GST.</dd>
                        <dt className="font-medium text-ink">Items</dt>
                        <dd>How many of your {s.rfx.lines.length} items have a price under that rule. Totals only compare fairly when this number matches, so each option also shows its difference on the items both cover.</dd>
                        <dt className="font-medium text-ink">Approved</dt>
                        <dd>A vendor who answered all your must-have questions. &ldquo;Needs proof&rdquo; vendors answered but still owe evidence.</dd>
                      </dl>
                    </div>
                  </details>
                  <div className="divide-y divide-line">
                    {sc.map((x) => {
                      const isBest = best && x.key === best.key;
                      return (
                        <div key={x.key} className="px-5 py-4">
                          <div className="flex items-baseline justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 font-medium">
                                {x.label} {isBest && <Badge tone="brand">recommended</Badge>}
                              </div>
                              <div className="text-[12.5px] text-muted">{x.detail}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-[18px] font-semibold tabular">{crore(x.total)}</div>
                              <div className="text-[12px] text-muted">
                                {x.linesCovered}/{s.rfx.lines.length} items
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                            {x.vendorsUsed.map((v) => (
                              <span key={v.vendor_id}>
                                {v.name.split(" ")[0]} · {v.lines} {v.lines === 1 ? "item" : "items"} · {crore(v.value)}
                              </span>
                            ))}
                          </div>
                          {best && !isBest && (() => {
                            const d = savingOnCommon(x, best);
                            const common = Object.keys(x.byLine).filter((l) => best.byLine[l] !== undefined).length;
                            return (
                              <div className="mt-1.5 text-[12px] text-muted">
                                {Math.abs(d) < 1 ? "Same cost as the recommended option" : `${crore(Math.abs(d))} ${d > 0 ? "more" : "less"} than the recommended option`} on the {common} items both cover
                              </div>
                            );
                          })()}
                          {(x.linesMissing.length > 0 || x.unverified > 0) && (
                            <div className="mt-1.5 text-[12px] text-warn">
                              {x.linesMissing.length > 0 && `No qualified price for ${x.linesMissing.join(", ")}. `}
                              {x.unverified > 0 && `${x.unverified} winning prices still need your check.`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!sc.length && <div className="p-5 text-muted">No vendor has cleared the must-have questions yet.</div>}
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>
      {clarify &&
        (() => {
          const v = n.vendors.find((x) => x.vendor_id === clarify)!;
          return <ClarifyModal v={v} issues={issues[clarify] || []} onClose={() => setClarify(null)} />;
        })()}
    </div>
  );
}

function Panel({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        {summary && <span className="text-[12.5px] text-muted">{summary}</span>}
      </div>
      {children}
    </section>
  );
}

function Attention({ tone, title, body, action, onClick }: { tone: "warn" | "bad" | "neutral"; title: string; body: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 hover:bg-panel">
      <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-muted")} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[12px] leading-snug text-muted">{body}</div>
      </div>
      <button onClick={onClick} className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-medium hover:bg-panel">
        {action}
      </button>
    </div>
  );
}
