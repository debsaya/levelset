"use client";
import { Fragment, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, type Normalized } from "@/lib/normalize";
import { lastYear, needsCheck, savingOnCommon, scenarios } from "@/lib/award";
import { creditValue, levelled } from "@/lib/levelled";
import { exportWorkbook } from "@/lib/export";
import { useReader } from "@/lib/reader";
import { ClarifyModal } from "./ClarifyModal";
import { vendorPoints } from "@/lib/clarify";
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
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [selKey, setSelKey] = useState<string | null>(null);
  const [view, setView] = useState<"item" | "vendor">("item");
  const [filter, setFilter] = useState<"all" | "up" | "check" | "gap">("all");
  const [showAll, setShowAll] = useState(false);
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
  const attention = n.vendors.filter((v) => v.qualification !== "qualified").length + n.vendors.filter((v) => v.adjustments.some((a) => a.conditional)).length + altSpec.length + totalOff.length + couldWin.length + (review > 0 ? 1 : 0);
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
  // The four questions an approver asks before signing: is everything priced, are the prices checked, are the winners approved, what does it do to last year's spend.
  const winners = best ? best.vendorsUsed.map((w) => n.vendors.find((v) => v.vendor_id === w.vendor_id)).filter(Boolean) as Normalized["vendors"] : [];
  const notApproved = winners.filter((v) => v.qualification !== "qualified");
  const tiles: { label: string; value: string; note: string; tone: "good" | "warn" | "plain" }[] = best
    ? [
        { label: "Coverage", value: `${best.linesCovered} of ${nLines}`, note: best.linesMissing.length ? `No approved price for ${best.linesMissing.join(", ")}` : "every item has a price", tone: best.linesMissing.length ? "warn" : "good" },
        { label: "Prices checked", value: best.unverified === 0 ? "Yes" : `${best.unverified} to check`, note: best.unverified === 0 ? (review > 0 ? `${review} flagged elsewhere, none behind this award` : "nothing flagged") : "behind this award, can change the total", tone: best.unverified === 0 ? "good" : "warn" },
        { label: best.vendorsUsed.length > 1 ? "Winning vendors" : "Winning vendor", value: notApproved.length === 0 ? "Approved" : `${notApproved.length} needs proof`, note: notApproved.length === 0 ? "must-have questions answered" : notApproved.map((v) => v.name.split(" ")[0]).join(", ") + " owes proof", tone: notApproved.length === 0 ? "good" : "warn" },
        { label: "Against last year", value: ly ? (Math.abs((ly.delta / ly.fy26) * 100) < 0.05 ? "Flat" : `${lyUp ? "+" : "−"}${Math.abs((ly.delta / ly.fy26) * 100).toFixed(1)}%`) : "n/a", note: ly ? `${crore(Math.abs(ly.delta))} ${lyUp ? "higher" : "lower"}, on the ${ly.lines} items priced then` : "no last-year price to compare with", tone: "plain" },
      ]
    : [];
  const blockers = best ? [best.linesMissing.length > 0, best.unverified > 0, notApproved.length > 0].filter(Boolean).length : 0;
  const verdict: { tone: "good" | "warn" | "bad"; text: string } = !best ? { tone: "bad", text: "Not ready" } : blockers === 0 ? { tone: "good", text: "Ready to approve" } : { tone: "warn", text: `${blockers} to settle before approving` };
  const ranked = [...n.vendors].sort((a, b) => ({ qualified: 0, conditional: 1, not_qualified: 2 }[a.qualification] - { qualified: 0, conditional: 1, not_qualified: 2 }[b.qualification]) || (lv[a.vendor_id]?.total ?? 1e18) - (lv[b.vendor_id]?.total ?? 1e18));

  // The option being looked at (the recommended one until you click another), cut item by item.
  const cur = (selKey && sc.find((x) => x.key === selKey)) || best;
  const prior1 = Object.values(s.prior)[0];
  const itemRows = !cur
    ? []
    : s.rfx.lines.map((l) => {
        const wid = cur.winners[l.id];
        const w = wid ? n.cells.find((c) => c.line_id === l.id && c.vendor_id === wid) : undefined;
        if (!w || w.unit_inr === null) return { l, w: undefined, vendor: "", spend: 0, nextGap: null as number | null, lyPct: null as number | null, check: false };
        const others = n.cells.filter((c) => c.line_id === l.id && c.vendor_id !== wid && cur.pool.includes(c.vendor_id) && c.unit_inr !== null && !["deviation", "excluded", "missing"].includes(c.status));
        const next = others.length ? Math.min(...others.map((c) => c.unit_inr!)) : null;
        const lyU = prior1?.prices[l.id];
        const spend = w.annual_inr || 0;
        return {
          l,
          w,
          vendor: n.vendors.find((v) => v.vendor_id === wid)?.name ?? "",
          spend,
          nextGap: next !== null ? ((next - w.unit_inr) / w.unit_inr) * 100 : null,
          lyPct: lyU && spend ? ((spend / l.annual_qty - lyU) / lyU) * 100 : null,
          check: needsCheck(w),
        };
      });
  const priced = itemRows.filter((r) => r.w);
  const counts = {
    all: itemRows.length,
    up: priced.filter((r) => r.lyPct !== null && r.lyPct > 0.05).length,
    check: priced.filter((r) => r.check).length,
    gap: priced.filter((r) => r.nextGap !== null && r.nextGap < 2).length,
  };
  const shownItems = [...itemRows]
    .filter((r) => (filter === "all" ? true : filter === "up" ? r.w && r.lyPct !== null && r.lyPct > 0.05 : filter === "check" ? r.check : r.w && r.nextGap !== null && r.nextGap < 2))
    .sort((a, b) => (filter === "up" ? (b.lyPct ?? 0) - (a.lyPct ?? 0) : filter === "gap" ? (a.nextGap ?? 99) - (b.nextGap ?? 99) : b.spend - a.spend));
  const visibleItems = showAll || filter !== "all" ? shownItems : shownItems.slice(0, 8);
  const byVendor = !cur
    ? []
    : cur.vendorsUsed.map((u) => {
        const mine = priced.filter((r) => r.w!.vendor_id === u.vendor_id);
        const lyBase = mine.reduce((a, r) => a + (prior1?.prices[r.l.id] ? prior1.prices[r.l.id] * r.l.annual_qty : 0), 0);
        const lyNow = mine.reduce((a, r) => a + (prior1?.prices[r.l.id] ? r.spend : 0), 0);
        return { ...u, v: n.vendors.find((x) => x.vendor_id === u.vendor_id)!, check: mine.filter((r) => r.check).length, lyPct: lyBase ? ((lyNow - lyBase) / lyBase) * 100 : null };
      });

  if (done === 0) return <Blocked b={blocker(s) || { title: "Nothing to decide yet", text: "Read the quotes first. Your recommended award then appears here.", to: "quotes", cta: "Go to Read quotes" }} go={(p) => go(p)} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] space-y-4 px-5 py-6 lg:px-8">
        {done === 0 ? (
          null
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
                      Load saved
                    </Button>
                  )}
                  <Button onClick={readAll} disabled={reading > 0}>
                    {reading ? <Spinner /> : null} Read the rest
                  </Button>
                </div>
              </div>
            )}

            <section className="overflow-hidden rounded-xl border border-line border-l-4 border-l-kraft bg-[linear-gradient(135deg,var(--color-kraft-soft),#ffffff_65%)] shadow-[0_10px_28px_-14px_rgba(80,55,20,0.35)]">
              <div className="px-6 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Recommended award</span>
                  <Badge tone={verdict.tone}>{verdict.text}</Badge>
                </div>
                <h1 className="mt-1 text-[24px] font-semibold leading-snug">{headline}</h1>
                {best && (
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[34px] font-semibold leading-none tabular">{crore(best.total)}</span>
                    <span className="text-[13px] text-muted">a year, delivered to your plant, ex-GST</span>
                  </div>
                )}
                {best && best.vendorsUsed.length > 1 && <p className="mt-2 text-[13px] text-muted">{best.vendorsUsed.map((v) => `${v.name.split(" ")[0]} ${crore(v.value)}`).join(" · ")}</p>}
                {tiles.length > 0 && (
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {tiles.map((t) => (
                      <div key={t.label} className="rounded-lg border border-line bg-white/80 px-3 py-2.5">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{t.label}</dt>
                        <dd className={cx("mt-0.5 flex items-center gap-1.5 text-[16px] font-semibold tabular", t.tone === "good" && "text-good", t.tone === "warn" && "text-warn")}>
                          {t.tone !== "plain" && <span aria-hidden="true" className="text-[13px]">{t.tone === "good" ? "✓" : "!"}</span>}
                          {t.value}
                        </dd>
                        <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{t.note}</div>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => exportWorkbook(s.rfx, n, s.assumptions, s.audit)}>Export Excel</Button>
                  <Button onClick={() => go("ask", { ask: "Why is this the recommended award? Compare the options and show the line-level split." })}>Why this?</Button>
                </div>
              </div>
            </section>

            <Panel title="Before you approve" summary={attention ? `${attention} ${attention === 1 ? "item" : "items"}` : "none"}>
              <div className="space-y-0.5 p-2">
                    {attention === 0 && <div className="p-3 text-[13px] text-muted">Nothing is open. You can approve this award.</div>}
                    {review > 0 && (
                      <Attention
                        tone={best && best.unverified > 0 ? "warn" : "neutral"}
                        title={best && best.unverified > 0 ? `${best.unverified} of the ${review} flagged prices are behind this award` : `${review} flagged ${review === 1 ? "price" : "prices"} to check, none behind this award`}
                        body={best ? (best.unverified > 0 ? "Checking them can change the total." : "The total stands, but a correction could still change which vendor wins an item.") : "Check them in Compare."}
                        action="Check them"
                        onClick={() => go("compare", { review: true })}
                      />
                    )}
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
                      <Attention key={"t" + v.vendor_id} tone="warn" title={`${v.name}: their total doesn't match their prices`} body={v.flags.find((f) => f.code === "TOTAL_MISMATCH")?.msg ?? "We use their line prices, not the total they wrote. Check which one they meant."} action={askedOn(v.vendor_id) ? "Email again" : "Email vendor"} done={askedOn(v.vendor_id)} onClick={() => setClarify(v.vendor_id)} />
                    ))}
              </div>
            </Panel>

            <Panel title={sc.length > 1 ? "Ways to award it" : "The award, item by item"} summary={sc.length > 1 ? "Pick one to see it item by item" : undefined}>
              {sc.length === 0 ? (
                <div className="p-5 text-muted">No vendor has cleared the must-have questions yet.</div>
              ) : (
                <>
                  <div role="radiogroup" aria-label="Ways to award" className={cx("grid gap-3 p-4", sc.length === 1 && "hidden", sc.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
                    {sc.map((x) => {
                      const isBest = !!best && x.key === best.key;
                      const on = !!cur && x.key === cur.key;
                      const d = best && !isBest ? savingOnCommon(x, best) : 0;
                      const common = best ? Object.keys(x.byLine).filter((l) => best.byLine[l] !== undefined).length : 0;
                      return (
                        <button key={x.key} role="radio" aria-checked={on} onClick={() => (setSelKey(x.key), setShowAll(false), setFilter("all"))} className={cx("flex flex-col rounded-xl border p-3.5 text-left transition", on ? "border-kraft bg-kraft-soft/60 ring-1 ring-kraft" : "border-line bg-white hover:border-[#cfd3da] hover:bg-panel/60")}>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[13px] font-semibold leading-snug">{x.label}</span>
                            {isBest && <Badge tone="brand">recommended</Badge>}
                          </div>
                          <div className="mt-2 flex items-baseline gap-2">
                            <span className="text-[20px] font-semibold leading-none tabular">{crore(x.total)}</span>
                            <span className="text-[12px] text-muted">{x.linesCovered}/{nLines} items</span>
                          </div>
                          {best && !isBest && (
                            <div className={cx("mt-1 text-[12px] font-medium", d > 1 ? "text-warn" : d < -1 ? "text-good" : "text-muted")}>
                              {Math.abs(d) < 1 ? "Same cost as recommended" : `${crore(Math.abs(d))} ${d > 0 ? "more" : "less"} than recommended`}
                              <span className="font-normal text-muted"> (on {common} shared items)</span>
                            </div>
                          )}
                          <div className="mt-1.5 text-[11.5px] leading-snug text-muted">{x.vendorsUsed.map((v) => v.name.split(" ")[0]).join(" + ")}</div>
                          {(x.linesMissing.length > 0 || x.unverified > 0) && (
                            <div className="mt-1.5 text-[11.5px] leading-snug text-warn">
                              {x.linesMissing.length > 0 && `${x.linesMissing.length} unpriced. `}
                              {x.unverified > 0 && `${x.unverified} to check.`}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {cur && (
                    <div className="border-t border-line">
                      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-semibold">{cur.label}</div>
                          <div className="text-[12px] leading-snug text-muted">{cur.detail}</div>
                        </div>
                        <div role="tablist" aria-label="Break it down by" className="inline-flex rounded-lg border border-line bg-panel p-0.5 text-[12.5px]">
                          {([["item", "By item"], ["vendor", "By vendor"]] as const).map(([m, label]) => (
                            <button key={m} role="tab" aria-selected={view === m} onClick={() => setView(m)} className={cx("rounded-md px-3 py-1 font-medium transition", view === m ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {view === "vendor" ? (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-[13px]">
                            <caption className="sr-only">Who supplies what under this option</caption>
                            <thead>
                              <tr className="border-y border-line text-[11.5px] font-medium text-muted">
                                <th scope="col" className="py-2 pl-5 pr-3 font-medium">Vendor</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Items</th>
                                <th scope="col" className="px-3 py-2 font-medium">Share of spend</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">A year</th>
                                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Vs last year</th>
                                <th scope="col" className="hidden py-2 pl-3 pr-5 font-medium md:table-cell">To sort out</th>
                              </tr>
                            </thead>
                            <tbody>
                              {byVendor.map((u) => (
                                <tr key={u.vendor_id} className="border-b border-line last:border-b-0">
                                  <td className="py-2.5 pl-5 pr-3">
                                    <div className="font-medium">{u.name}</div>
                                    <Badge tone={QUAL[u.v.qualification].tone}>{QUAL[u.v.qualification].label}</Badge>
                                  </td>
                                  <td className="px-3 py-2.5 text-right tabular">{u.lines}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel">
                                        <div className="h-full rounded-full bg-kraft" style={{ width: `${Math.max(3, (u.value / cur.total) * 100)}%` }} />
                                      </div>
                                      <span className="text-[12px] text-muted tabular">{Math.round((u.value / cur.total) * 100)}%</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-semibold tabular">{crore(u.value)}</td>
                                  <td className={cx("hidden px-3 py-2.5 text-right tabular sm:table-cell", u.lyPct !== null && u.lyPct > 0.05 && "text-warn")}>{u.lyPct === null ? "–" : `${u.lyPct > 0 ? "+" : "−"}${Math.abs(u.lyPct).toFixed(1)}%`}</td>
                                  <td className="hidden py-2.5 pl-3 pr-5 text-[12px] text-muted md:table-cell">
                                    {[u.v.qualification !== "qualified" ? "owes proof" : "", u.check ? `${u.check} ${u.check === 1 ? "price" : "prices"} to check` : ""].filter(Boolean).join(" · ") || "nothing"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
                            {([
                              ["all", "All items", counts.all],
                              ["up", "Price up vs last year", counts.up],
                              ["check", "Needs your check", counts.check],
                              ["gap", "Close call (next best within 2%)", counts.gap],
                            ] as const).map(([k, label, c]) => (
                              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={cx("rounded-full border px-2.5 py-0.5 text-[12px] transition", filter === k ? "border-ink bg-ink text-white" : "border-line bg-white text-muted hover:bg-panel hover:text-ink")}>
                                {label} <span className="tabular opacity-80">{c}</span>
                              </button>
                            ))}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left text-[13px]">
                              <caption className="sr-only">Winning vendor for each item under this option</caption>
                              <thead>
                                <tr className="border-y border-line text-[11.5px] font-medium text-muted">
                                  <th scope="col" className="py-2 pl-5 pr-3 font-medium">Item</th>
                                  <th scope="col" className="px-3 py-2 font-medium">Goes to</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">₹ / piece</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">A year</th>
                                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Vs last year</th>
                                  <th scope="col" className="hidden py-2 pl-3 pr-5 text-right font-medium md:table-cell">Next best is</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleItems.length === 0 && (
                                  <tr>
                                    <td colSpan={6} className="px-5 py-4 text-[13px] text-muted">Nothing matches this filter.</td>
                                  </tr>
                                )}
                                {visibleItems.map((r) => (
                                  <tr key={r.l.id} className="border-b border-line last:border-b-0 hover:bg-panel/60">
                                    <td className="max-w-[260px] py-2 pl-5 pr-3">
                                      <span className="font-medium tabular">{r.l.id}</span> <span className="text-muted">{r.l.description}</span>
                                    </td>
                                    {r.w ? (
                                      <>
                                        <td className="px-3 py-2">
                                          {r.vendor.split(" ")[0]}
                                          {r.check && <span className="ml-1.5 rounded bg-warn-soft px-1 py-0.5 text-[10.5px] font-medium text-warn">check</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular">{r.w.unit_inr!.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-right font-medium tabular">{crore(r.spend)}</td>
                                        <td className={cx("hidden px-3 py-2 text-right tabular sm:table-cell", r.lyPct !== null && r.lyPct > 0.05 ? "text-warn" : r.lyPct !== null && r.lyPct < -0.05 ? "text-good" : "text-muted")}>
                                          {r.lyPct === null ? (r.l.is_new ? "new item" : "–") : `${r.lyPct > 0 ? "+" : "−"}${Math.abs(r.lyPct).toFixed(1)}%`}
                                        </td>
                                        <td className={cx("hidden py-2 pl-3 pr-5 text-right tabular md:table-cell", r.nextGap !== null && r.nextGap < 2 ? "text-warn" : "text-muted")}>{r.nextGap === null ? "only quote" : `+${r.nextGap.toFixed(1)}%`}</td>
                                      </>
                                    ) : (
                                      <td colSpan={5} className="px-3 py-2 text-warn">No approved price under this option</td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {filter === "all" && shownItems.length > 8 && (
                            <button onClick={() => setShowAll(!showAll)} className="w-full border-t border-line px-5 py-2.5 text-left text-[12.5px] font-medium text-kraft hover:bg-panel">
                              {showAll ? "Show only the 8 biggest" : `Show all ${shownItems.length} items`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              <details className="border-t border-line px-5 py-2.5 text-[12.5px] leading-relaxed text-muted">
                <summary className="cursor-pointer font-medium text-ink">How to read these numbers</summary>
                <div className="mt-2 space-y-1.5">
                  <p>Each option is a different rule for who can win each item. The recommended one is the lowest total that covers the most items. Prices are per piece, delivered to your plant, ex-GST.</p>
                  <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium text-ink">Vs last year</dt>
                    <dd>The winning price against last year&apos;s contract price for that item. Only items that had a price then.</dd>
                    <dt className="font-medium text-ink">Next best is</dt>
                    <dd>How much higher the runner-up&apos;s price is. A small gap means the choice of vendor on that item barely matters, so it is a good one to trade for a better term.</dd>
                    <dt className="font-medium text-ink">Approved</dt>
                    <dd>A vendor who answered all your must-have questions. &ldquo;Needs proof&rdquo; vendors answered but still owe evidence.</dd>
                  </dl>
                </div>
              </details>
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
