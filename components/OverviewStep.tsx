"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, type Normalized } from "@/lib/normalize";
import { lastYear, scenarios } from "@/lib/award";
import { exportWorkbook } from "@/lib/export";
import { useReader } from "@/lib/reader";
import { ClarifyModal, vendorIssues } from "./CompareStep";
import { Badge, Button, Disclosure, Spinner, cx } from "./ui";

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
  const attention = (review > 0 ? 1 : 0) + n.vendors.filter((v) => v.qualification !== "qualified").length + n.vendors.filter((v) => v.adjustments.some((a) => a.conditional)).length;

  const names = best ? best.vendorsUsed.map((v) => `${v.name.split(" ")[0]} (${v.lines} ${v.lines === 1 ? "item" : "items"})`) : [];
  const headline = !best
    ? "No approved vendor has cleared the must-have questions yet"
    : best.vendorsUsed.length === 1
      ? `Award all ${best.linesCovered} items to ${best.vendorsUsed[0].name}`
      : `Split the award: ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] space-y-4 px-6 py-8">
        {done === 0 ? (
          <div className="rounded-2xl border border-line bg-white p-8 text-center">
            <div className="text-[20px] font-semibold">Nothing to decide yet</div>
            <p className="mx-auto mt-2 max-w-md text-muted">Once the vendor replies are read, your recommended award appears here, with everything behind it one click away.</p>
            <Button variant="primary" className="mt-5 px-5 py-2.5 text-[14px]" onClick={() => go("quotes")}>
              Go to the replies
            </Button>
          </div>
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

            <div className="rounded-2xl border border-ink bg-ink p-7 text-white">
              <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/60">Recommended</div>
              <h1 className="mt-1.5 text-[24px] font-semibold leading-snug">{headline}</h1>
              {best && (
                <>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-[44px] font-semibold leading-none tabular">{crore(best.total)}</span>
                    <span className="text-[13px] text-white/70">a year, delivered to your plant, ex-GST</span>
                  </div>
                  <div className="mt-3 space-y-1 text-[13.5px] text-white/80">
                    {ly && (
                      <div>
                        {crore(Math.abs(ly.delta))} ({Math.abs((ly.delta / ly.fy26) * 100).toFixed(1)}%) {ly.delta > 0 ? "higher" : "lower"} than last year&apos;s contract, on the {ly.lines} items that had a price then
                      </div>
                    )}
                    {best.linesMissing.length > 0 && <div>No approved price for {best.linesMissing.length === 1 ? "item" : "items"} {best.linesMissing.join(", ")}</div>}
                    {best.unverified > 0 && (
                      <div>
                        {best.unverified} of the winning prices still need your check{" "}
                        <button className="underline underline-offset-2" onClick={() => go("compare", { review: true })}>
                          Check them
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => exportWorkbook(s.rfx, n, s.assumptions, s.audit)}>
                  Export to Excel
                </Button>
                <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => go("ask", { ask: "Why is this the recommended award? Compare the options and show the line-level split." })}>
                  Ask AI why
                </Button>
              </div>
            </div>

            <Disclosure title="Other award options" summary={`${sc.length} ${sc.length === 1 ? "option" : "options"}`}>
              <div className="divide-y divide-line">
                {sc.map((x) => {
                  const isBest = best && x.key === best.key;
                  return (
                    <div key={x.key} className="px-5 py-4">
                      <div className="flex items-baseline justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            {x.label} {isBest && <Badge tone="brand">recommended</Badge>}
                          </div>
                          <div className="text-[12.5px] text-muted">{x.detail}</div>
                        </div>
                        <div className="text-right">
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
            </Disclosure>

            <Disclosure title="Needs your attention" summary={attention ? `${attention} ${attention === 1 ? "item" : "items"}` : "nothing open"}>
              <div className="space-y-1 p-3">
                {attention === 0 && <div className="p-3 text-[13px] text-muted">Nothing is open.</div>}
                {review > 0 && <Attention tone="warn" title={`${review} prices the system isn't sure about`} body="Unit conversions, photo reads and group rules. Check them before you award." action="Review" onClick={() => go("compare", { review: true })} />}
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
            </Disclosure>

            <Disclosure title="Vendors" summary={`${n.vendors.length} vendors · ${approved} approved`}>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
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
                      <div className="mt-3 text-[20px] font-semibold tabular">{v.avg_over_best_pct === null ? "–" : v.avg_over_best_pct < 0.05 ? "Cheapest" : `+${v.avg_over_best_pct.toFixed(1)}%`}</div>
                      <div className="text-[11.5px] text-muted">{v.avg_over_best_pct === null ? "no comparable prices" : "vs the lowest price, on the items they quoted"}</div>
                      <div className="mt-3 grid grid-cols-2 gap-1 text-[12px]">
                        <span className="text-muted">Payment</span>
                        <span className="text-right tabular">{v.terms.payment ? `${v.terms.payment} days` : "–"}</span>
                      </div>
                      <button onClick={() => setClarify(v.vendor_id)} className="mt-auto pt-3 text-left text-[12.5px] font-medium text-kraft hover:underline">
                        {issues[v.vendor_id]?.length || 0} open questions → draft email
                      </button>
                    </div>
                  ))}
              </div>
            </Disclosure>
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
