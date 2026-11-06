"use client";
import { Fragment, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, type Normalized } from "@/lib/normalize";
import { lastYear, savingOnCommon, scenarios } from "@/lib/award";
import { creditValue, levelled } from "@/lib/levelled";
import { exportWorkbook } from "@/lib/export";
import { useReader } from "@/lib/reader";
import { ClarifyModal } from "./ClarifyModal";
import { vendorPoints } from "@/lib/clarify";
import { Badge, Blocked, Button, Disclosure, Spinner, cx } from "./ui";
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
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const total = s.responses.length;
  const done = s.responses.filter((r) => r.status === "done").length;
  const reading = s.responses.filter((r) => r.status === "reading").length;
  const errors = s.responses.filter((r) => r.status === "error").length;
  const sc = useMemo(() => scenarios(s.rfx, n), [s.rfx, n]);
  const best = [...sc].filter((x) => x.key !== "split_qc").sort((a, b) => b.linesCovered - a.linesCovered || a.total - b.total)[0];
  const ly = useMemo(() => lastYear(s.rfx, s.prior, best, n), [s.rfx, s.prior, best, n]);
  const review = n.cells.filter((c) => c.status === "review").length;
  const points = useMemo(() => Object.fromEntries(n.vendors.map((v) => [v.vendor_id, vendorPoints(v, n, s.rfx)])), [n, s.rfx]);
  const approved = n.vendors.filter((v) => v.qualification === "qualified").length;
  // Problems on vendors you could still award to: a different spec on an item, or a total that does not match their own lines.
  const awardable = n.vendors.filter((v) => v.qualification !== "not_qualified");
  const altSpec = awardable.filter((v) => v.deviation > 0).map((v) => ({ v, lines: n.cells.filter((c) => c.vendor_id === v.vendor_id && c.status === "deviation").map((c) => c.line_id) }));
  const totalOff = awardable.filter((v) => v.flags.some((f) => f.code === "TOTAL_MISMATCH"));
  // Every vendor on the same full scope, with gaps estimated, so a partial quote can't look cheaper or dearer than it is.
  const lv = useMemo(() => levelled(n, s.rfx), [n, s.rfx]);
  const nLines = s.rfx.lines.length;
  const rate = s.assumptions.cost_of_capital_pct ?? 10;
  // Vendors with gaps whose full-scope cost would already undercut the recommended award once they quote the rest.
  const couldWin = best && best.linesCovered === nLines ? awardable.filter((v) => lv[v.vendor_id]?.filled > 0 && lv[v.vendor_id].total !== null && lv[v.vendor_id].total! < best.total * 0.995 && !(best.vendorsUsed.length === 1 && best.vendorsUsed[0].vendor_id === v.vendor_id)) : [];
  const attention = n.vendors.filter((v) => v.qualification !== "qualified").length + n.vendors.filter((v) => v.adjustments.some((a) => a.conditional)).length + altSpec.length + totalOff.length + couldWin.length;
  const askedOn = (id: string) => {
    const a = s.asked?.[id];
    return a ? new Date(a.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  };
  const hasUnapproved = n.vendors.some((v) => v.qualification === "not_qualified");

  const names = best ? best.vendorsUsed.map((v) => `${v.name.split(" ")[0]} (${v.lines} ${v.lines === 1 ? "item" : "items"})`) : [];
  const headline = !best
    ? "No approved vendor has cleared the must-have questions yet"
    : best.vendorsUsed.length === 1
      ? `Award all ${best.linesCovered} items to ${best.vendorsUsed[0].name}`
      : `Split the award: ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  const lyUp = !!ly && ly.delta > 0;
  const facts = best
    ? [
        `${best.linesCovered} of ${nLines} items covered`,
        ly ? `${lyUp ? "+" : "−"}${Math.abs((ly.delta / ly.fy26) * 100).toFixed(1)}% vs last year (${crore(Math.abs(ly.delta))} ${lyUp ? "higher" : "lower"}, on the ${ly.lines} items that had a price then)` : "no last-year price to compare with",
        ...(best.vendorsUsed.length > 1 ? [best.vendorsUsed.map((v) => `${v.name.split(" ")[0]} ${crore(v.value)}`).join(", ")] : []),
      ]
    : [];
  const ranked = [...n.vendors].sort((a, b) => ({ qualified: 0, conditional: 1, not_qualified: 2 }[a.qualification] - { qualified: 0, conditional: 1, not_qualified: 2 }[b.qualification]) || (lv[a.vendor_id]?.total ?? 1e18) - (lv[b.vendor_id]?.total ?? 1e18));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] space-y-4 px-5 py-6 lg:px-8">
        {done === 0 ? (
          <Blocked bare b={blocker(s) || { title: "Nothing to decide yet", text: "Read the quotes first. Your recommended award then appears here.", to: "quotes", cta: "Go to Read quotes" }} go={(p) => go(p)} />
        ) : (
          <>
            {done < total && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-kraft-soft px-4 py-3 text-[13px]">
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

            <section className="rounded-xl border border-line bg-white">
              <div className="px-6 py-5">
                <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Recommended award</div>
                <h1 className="mt-1 text-[24px] font-semibold leading-snug">{headline}</h1>
                {best && (
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[34px] font-semibold leading-none tabular">{crore(best.total)}</span>
                    <span className="text-[13px] text-muted">a year, delivered to your plant, ex-GST</span>
                  </div>
                )}
                {facts.length > 0 && <p className="mt-2 text-[13px] text-muted">{facts.join(" · ")}</p>}
                {best && best.linesMissing.length > 0 && <p className="mt-1 text-[13px] text-warn">No approved price for {best.linesMissing.length === 1 ? "item" : "items"} {best.linesMissing.join(", ")}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => exportWorkbook(s.rfx, n, s.assumptions, s.audit)}>Export to Excel</Button>
                  <Button onClick={() => go("ask", { ask: "Why is this the recommended award? Compare the options and show the line-level split." })}>Ask AI why</Button>
                </div>
              </div>
              {review > 0 && (
                <div role="status" className="flex flex-col gap-2 border-t border-line bg-kraft-soft px-6 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-semibold">
                      {best && best.unverified === 0
                        ? `${review} flagged ${review === 1 ? "price" : "prices"} to check. None is behind this award.`
                        : best
                          ? `Not final: ${best.unverified} of the ${review} flagged ${review === 1 ? "price is" : "prices are"} behind this award.`
                          : `${review} flagged ${review === 1 ? "price" : "prices"} to check.`}
                    </span>{" "}
                    <span className="text-muted">{best ? (best.unverified > 0 ? "Checking them can change the total." : "The total stands, but a correction could still change which vendor wins an item.") : ""}</span>
                  </div>
                  <Button className="shrink-0" onClick={() => go("compare", { review: true })}>
                    Check {review === 1 ? "it" : "them"} →
                  </Button>
                </div>
              )}
            </section>

            <Panel title="Needs your attention" summary={attention ? `${attention} ${attention === 1 ? "item" : "items"}` : "none"}>
              <div className="space-y-0.5 p-2">
                    {attention === 0 && <div className="p-3 text-[13px] text-muted">No vendor or document problems.{review > 0 ? ` The ${review} flagged ${review === 1 ? "price is" : "prices are"} in Compare.` : ""}</div>}
                    {n.vendors
                      .filter((v) => v.qualification !== "qualified")
                      .map((v) => (
                        <Attention key={v.vendor_id} tone={v.qualification === "not_qualified" ? "bad" : "warn"} title={`${v.name}: ${QUAL[v.qualification].label.toLowerCase()}`} body={v.qual_reasons.length && v.qual_reasons.every((r) => /not answered/i.test(r)) ? `Didn't answer the ${v.qual_reasons.length} must-have questions` : v.qual_reasons.join("; ") || "Questionnaire incomplete"} action={askedOn(v.vendor_id) ? "Email again" : "Email vendor"} done={askedOn(v.vendor_id)} onClick={() => setClarify(v.vendor_id)} />
                      ))}
                    {n.vendors
                      .filter((v) => v.adjustments.some((a) => a.conditional))
                      .map((v) => (
                        <Attention key={"r" + v.vendor_id} tone="neutral" title={`${v.name}: ${v.adjustments.filter((a) => a.conditional).every((a) => a.kind === "one_time_charge") ? "one-time charge" : v.adjustments.filter((a) => a.conditional).every((a) => a.kind === "surcharge") ? "surcharge" : "conditional rebate"}`} body={v.adjustments.filter((a) => a.conditional).map((a) => a.description.replace(/\.+$/, "")).join("; ") + ". Not counted in totals."} action={askedOn(v.vendor_id) ? "Email again" : "Email vendor"} done={askedOn(v.vendor_id)} onClick={() => setClarify(v.vendor_id)} />
                      ))}
                    {altSpec.map(({ v, lines }) => (
                      <Attention key={"a" + v.vendor_id} tone="warn" title={`${v.name}: different spec on ${lines.length === 1 ? "an item" : `${lines.length} items`}`} body={`${lines.join(", ")} ${lines.length === 1 ? "was" : "were"} quoted on a different spec, so ${lines.length === 1 ? "it isn't" : "they aren't"} counted. Ask whether they can quote what you specified.`} action={askedOn(v.vendor_id) ? "Email again" : "Email vendor"} done={askedOn(v.vendor_id)} onClick={() => setClarify(v.vendor_id)} />
                    ))}
                    {couldWin.map((v) => (
                      <Attention key={"w" + v.vendor_id} tone="warn" title={`${v.name}: could beat this award once they quote the rest`} body={`They quoted ${lv[v.vendor_id].quoted} of ${nLines} items. If the other ${lv[v.vendor_id].filled} ${lv[v.vendor_id].filled === 1 ? "comes" : "come"} in at the median of other vendors, their full cost is about ${crore(lv[v.vendor_id].total!)}, ${crore(best!.total - lv[v.vendor_id].total!)} less than this award. Ask for the missing prices before you award.`} action={askedOn(v.vendor_id) ? "Email again" : "Email vendor"} done={askedOn(v.vendor_id)} onClick={() => setClarify(v.vendor_id)} />
                    ))}
                    {totalOff.map((v) => (
                      <Attention key={"t" + v.vendor_id} tone="warn" title={`${v.name}: their total doesn't match their prices`} body="We use their line prices, not the total they wrote. Check which one they meant." action={askedOn(v.vendor_id) ? "Email again" : "Email vendor"} done={askedOn(v.vendor_id)} onClick={() => setClarify(v.vendor_id)} />
                    ))}
              </div>
            </Panel>

            <Panel title="Vendors" summary={`${n.vendors.length} vendors · ${approved} approved`}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <caption className="sr-only">Vendors ranked by yearly cost of the full scope</caption>
                  <thead>
                    <tr className="border-b border-line text-[11.5px] font-medium text-muted">
                      <th scope="col" className="py-2 pl-5 pr-3 font-medium">Vendor</th>
                      <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Status</th>
                      <th scope="col" className="py-2 pl-3 pr-5 text-right font-medium sm:px-3">A year, all {nLines} items</th>
                      <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Compared with lowest approved</th>
                      <th scope="col" className="hidden py-2 pl-3 pr-5 text-right font-medium md:table-cell">Quoted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((v, i) => {
                      const l = lv[v.vendor_id];
                      const vs = l?.vsLowestApproved ?? null;
                      const open = !!openRows[v.vendor_id];
                      const r = s.responses.find((x) => x.vendor.id === v.vendor_id);
                      const captured = r?.extraction?.lines?.length ?? 0;
                      const left = Math.max(0, captured - v.quoted);
                      const file = r?.vendor.attachments?.[0];
                      const isLowest = done >= 2 && i === 0 && v.qualification === "qualified" && approved >= 2 && l?.total != null;
                      const nq = points[v.vendor_id]?.length || 0;
                      return (
                        <Fragment key={v.vendor_id}>
                          <tr className="border-b border-line last:border-b-0 hover:bg-panel/60">
                            <td className="py-2.5 pl-5 pr-3">
                              <button onClick={() => setOpenRows((x) => ({ ...x, [v.vendor_id]: !x[v.vendor_id] }))} aria-expanded={open} className="flex items-center gap-2 text-left font-medium">
                                <span aria-hidden="true" className={cx("text-[10px] text-muted transition-transform", open && "rotate-90")}>▶</span>
                                {done >= 2 && v.qualification === "qualified" && approved >= 2 && <span className="text-[12px] font-normal text-muted tabular">{i + 1}.</span>}
                                {v.name}
                              </button>
                              <div className="mt-1 pl-5 sm:hidden">
                                <Badge tone={QUAL[v.qualification].tone}>{QUAL[v.qualification].label}</Badge>
                              </div>
                            </td>
                            <td className="hidden px-3 py-2.5 sm:table-cell">
                              <Badge tone={QUAL[v.qualification].tone}>{QUAL[v.qualification].label}</Badge>
                            </td>
                            <td className="py-2.5 pl-3 pr-5 text-right tabular sm:px-3">
                              {l?.total != null ? (
                                <>
                                  <span className="font-semibold">{crore(l.total)}</span>
                                  {l.filled > 0 && <span className="ml-1 text-[11.5px] text-warn" title={`${l.filled} of ${nLines} items are estimated`}>est.</span>}
                                </>
                              ) : (
                                <span className="text-warn">can&apos;t be costed</span>
                              )}
                            </td>
                            <td className="hidden px-3 py-2.5 text-right tabular sm:table-cell">
                              {vs === null ? "–" : isLowest ? <span className="font-medium text-good">Lowest</span> : v.qualification === "qualified" && Math.abs(vs) < 0.05 ? "Lowest" : `${vs < 0 ? "−" : "+"}${Math.abs(vs).toFixed(1)}%`}
                            </td>
                            <td className="hidden py-2.5 pl-3 pr-5 text-right tabular text-muted md:table-cell">
                              {l ? `${l.quoted}/${nLines}` : "–"}
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-b border-line bg-panel/60 last:border-b-0">
                              <td colSpan={5} className="px-5 py-3">
                                <div className="grid gap-x-8 gap-y-1 text-[12.5px] leading-snug text-muted sm:grid-cols-2">
                                  <div>
                                    <span className="font-medium text-ink">{v.format}</span>: {captured} prices read, {v.quoted} matched to your items{left > 0 ? ` (${left} didn't match an item)` : ""}
                                  </div>
                                  <div>Payment {v.terms.payment ? `${v.terms.payment} days` : "not stated"}{l?.total != null && v.terms.payment ? `. ${crore(l.total - creditValue(l.total, v.terms.payment, rate))} after payment terms at ${rate}% a year` : ""}</div>
                                  {v.deviation > 0 && <div className="text-warn">{v.deviation} on a different spec, not counted</div>}
                                  <div className={v.review > 0 ? "text-warn" : undefined}>
                                    {v.review} {v.review === 1 ? "price" : "prices"} flagged for you
                                  </div>
                                  {l && l.filled > 0 && (
                                    <div className="text-warn sm:col-span-2">
                                      Quoted {l.quoted} of {nLines} items. The other {l.filled} {l.filled === 1 ? "is" : "are"} estimated at {crore(l.filledValue)}. Ask them to quote {l.filled === 1 ? "it" : "these"}.
                                    </div>
                                  )}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
                                  <button onClick={() => setClarify(v.vendor_id)} className="font-medium text-kraft hover:underline">
                                    {askedOn(v.vendor_id) ? `Emailed ${askedOn(v.vendor_id)} · email again` : `Email ${v.name.split(" ")[0]} · ${nq} ${nq === 1 ? "question" : "questions"}`}
                                  </button>
                                  {file && (
                                    <a href={`/${file}`} target="_blank" rel="noreferrer" className="font-medium text-kraft hover:underline">
                                      View the original file ↗
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <details className="border-t border-line px-5 py-2.5 text-[12.5px] leading-relaxed text-muted">
                <summary className="cursor-pointer font-medium text-ink">How these costs are worked out</summary>
                <p className="mt-1.5">
                  Every vendor is costed on the same {nLines} items at your yearly volumes. An item a vendor hasn't quoted, or quoted on a different spec, is filled in at the median of the other approved vendors' prices. That keeps a partial quote from looking cheaper than it is. Those fills are estimates for comparison only. Payment terms are valued separately, using the cost of money you set in Compare. The award itself uses real quotes.
                </p>
              </details>
            </Panel>

            <Disclosure title="Other ways to award it" summary={`${sc.length} ${sc.length === 1 ? "way" : "ways"} compared`}>
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
                              {x.linesMissing.length > 0 && `No approved price for ${x.linesMissing.join(", ")}. `}
                              {x.unverified > 0 && `${x.unverified} winning prices still need your check.`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!sc.length && <div className="p-5 text-muted">No vendor has cleared the must-have questions yet.</div>}
                  </div>
            </Disclosure>
          </>
        )}
      </div>
      {clarify &&
        (() => {
          const v = n.vendors.find((x) => x.vendor_id === clarify)!;
          return <ClarifyModal v={v} points={points[clarify] || []} onClose={() => setClarify(null)} />;
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

function Attention({ tone, title, body, action, done, onClick }: { tone: "warn" | "bad" | "neutral"; title: string; body: string; action: string; done?: string; onClick: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 hover:bg-panel">
      <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-muted")} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[12px] leading-snug text-muted">{body}</div>
        {done && <div className="mt-0.5 text-[12px] font-medium text-good">✓ Emailed {done}. Waiting for their reply.</div>}
      </div>
      <button onClick={onClick} className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-medium hover:bg-panel">
        {action}
      </button>
    </div>
  );
}
