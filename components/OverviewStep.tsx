"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, type Normalized } from "@/lib/normalize";
import { lastYear, savingOnCommon, scenarios } from "@/lib/award";
import { useReader } from "@/lib/reader";
import { ClarifyModal, vendorIssues } from "./CompareStep";
import { Badge, Button, Spinner, cx } from "./ui";

type Go = (page: "compare" | "ask" | "quotes" | "rfx", opts?: { review?: boolean; ask?: string }) => void;

const QUAL = {
  qualified: { tone: "good" as const, label: "Qualified" },
  conditional: { tone: "warn" as const, label: "Conditional" },
  not_qualified: { tone: "bad" as const, label: "Not qualified" },
};

export default function OverviewStep({ n, go }: { n: Normalized; go: Go }) {
  const { s } = useStore();
  const { readAll, hasSaved, loadSaved, savedAt } = useReader();
  const savedLabel = savedAt ? new Date(savedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  const [clarify, setClarify] = useState<string | null>(null);
  const total = s.responses.length;
  const done = s.responses.filter((r) => r.status === "done").length;
  const reading = s.responses.filter((r) => r.status === "reading").length;
  const errors = s.responses.filter((r) => r.status === "error").length;
  const sc = useMemo(() => scenarios(s.rfx, n), [s.rfx, n]);
  const best = [...sc].filter((x) => x.key !== "split_qc").sort((a, b) => b.linesCovered - a.linesCovered || a.total - b.total)[0];
  const single = sc.find((x) => x.key === "single");
  const ly = useMemo(() => lastYear(s.rfx, s.prior, best, n), [s.rfx, s.prior, best, n]);
  const review = n.cells.filter((c) => c.status === "review").length;
  const issues = useMemo(() => Object.fromEntries(n.vendors.map((v) => [v.vendor_id, vendorIssues(v, n, s.rfx, s.responses)])), [n, s.rfx, s.responses]);
  const openQs = Object.values(issues).reduce((a, b) => a + b.length, 0);
  const due = new Date(s.rfx.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-6 px-6 py-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-kraft">
              Buyer: {s.rfx.buyer.company} · {s.rfx.lines.length} items · {s.responses.length} vendors invited · quotes due {due}
            </div>
            <h1 className="mt-1 text-[28px] font-semibold leading-tight">{s.rfx.title.replace(/\s*—\s*/, ": ")}</h1>
          </div>
          {done > 0 && (
            <div className="flex gap-2">
              <Button onClick={() => go("compare")}>Open comparison</Button>
              <Button variant="primary" onClick={() => go("ask")}>
                Ask a question
              </Button>
            </div>
          )}
        </header>

        <p className="-mt-3 max-w-3xl text-[15px] leading-relaxed text-muted">
          Suppliers reply in whatever format they like. Levelset reads every reply into <span className="font-medium text-ink">one like-for-like comparison</span>, so you can pick a winner and defend it.
        </p>

        <section className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
          <Step n={1} state="done" title="Replies come in" line={`${total} replies · ${[...new Set(s.responses.map((r) => r.vendor.format.split(" ")[0]))].join(", ")}`} />
          <Arrow />
          <Step n={2} state={done === 0 ? (reading > 0 ? "active" : "todo") : done < total ? "active" : "done"} title="AI reads each one" line={done === 0 ? "Excel, PDF, Word, photos and emails, read as they are" : `${n.vendors.reduce((a, v) => a + v.quoted, 0)} prices matched to your ${s.rfx.lines.length} items · ${done}/${total} read`} />
          <Arrow />
          <Step n={3} state={done === 0 ? "todo" : "done"} title="You compare and decide" line={done === 0 ? "One table in ₹ per box, delivered, ex-GST" : `${review} prices for you to check · ${n.vendors.filter((v) => v.qualification === "qualified").length} vendors qualified`} />
        </section>

        {done === 0 ? (
          <div className="rounded-2xl border border-line bg-white p-8">
            <div className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
              <div>
                <div className="text-[44px] font-semibold leading-none tabular">
                  {total}
                  <span className="text-muted">/{total}</span>
                </div>
                <div className="mt-2 text-[17px] font-medium">quotes are in, in {new Set(s.responses.map((r) => r.vendor.format)).size} different formats</div>
                <p className="mt-2 max-w-md text-muted">
                  Excel, a letterhead PDF, a Word letter in USD, a phone photo and a one-line email. Read them all and you&apos;ll get one comparison in rupees per box, delivered, ex-GST.
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <Button variant="primary" className="px-5 py-2.5 text-[14px]" onClick={readAll} disabled={reading > 0}>
                    {reading > 0 ? (
                      <>
                        <Spinner /> Reading {reading} of {total}…
                      </>
                    ) : (
                      `Read all ${total} quotes`
                    )}
                  </Button>
                  <button className="text-[13px] text-muted underline-offset-4 hover:underline" onClick={() => go("quotes")}>
                    See the raw quotes
                  </button>
                  {hasSaved && (
                    <button className="text-[13px] text-muted underline-offset-4 hover:underline" disabled={reading > 0} onClick={loadSaved} title="Real results from an earlier live run of the AI reader, in case the AI service is slow or unavailable.">
                      Load saved reading{savedLabel ? ` (live run, ${savedLabel})` : ""}
                    </button>
                  )}
                </div>
                {errors > 0 && <div className="mt-3 text-[13px] text-bad">{errors} quote(s) couldn&apos;t be read. Open Quotes to retry.</div>}
              </div>
              <div className="space-y-2">
                {s.responses.map((r) => (
                  <div key={r.vendor.id} className="flex items-center justify-between rounded-lg bg-panel px-3 py-2 text-[13px]">
                    <span className="font-medium">{r.vendor.name}</span>
                    <span className="flex items-center gap-2 text-muted">
                      {r.vendor.format}
                      {r.status === "reading" && <Spinner className="h-3 w-3" />}
                      {r.status === "done" && <span className="text-good">✓</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* KPI row */}
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                label="Best qualified award"
                value={best ? crore(best.total) : "–"}
                sub={best ? `${best.vendorsUsed.length} vendor${best.vendorsUsed.length > 1 ? "s" : ""} · ${best.linesCovered}/${s.rfx.lines.length} items` : "No qualified vendor yet"}
                accent
              />
              {(() => {
                const alt = sc.find((x) => x.key === "split_qc");
                return done < 2 ? (
                  <Kpi label="Saving from splitting" value="–" sub="Needs at least 2 quotes read" />
                ) : alt && best && alt.total < best.total ? (
                  <Kpi label="If you accept conditional vendors" value={`−${crore(best.total - alt.total)}`} sub={`${alt.unverified} of those prices still need checking`} tone="good" onClick={() => go("ask", { ask: "What would it take to safely include the conditional vendors in the award, and how much would it save? Show the lines that move." })} />
                ) : (
                  <Kpi
                    label="Saving from splitting"
                    value={single && best && single.key !== best.key ? crore(Math.max(0, savingOnCommon(single, best))) : "₹0"}
                    sub={single && best && single.key !== best.key ? `vs ${single.label.replace("All to ", "all to ")}, on the same items` : `${single?.label.replace("All to ", "") || "One vendor"} is cheapest on every item`}
                  />
                );
              })()}
              <Kpi
                label="vs FY26 contract rates"
                value={ly ? `${ly.delta > 0 ? "+" : "−"}${crore(Math.abs(ly.delta)).replace("₹", "₹")}` : "–"}
                sub={ly ? `${((ly.delta / ly.fy26) * 100).toFixed(1)}% on ${ly.lines} items with a FY26 price` : "No prior contract on file"}
                tone={ly ? (ly.delta > 0 ? "bad" : "good") : undefined}
              />
              <Kpi label="Waiting on you" value={`${review}`} sub={`prices to check · ${openQs} vendor questions`} tone={review ? "warn" : "good"} onClick={() => go("compare", { review: true })} />
            </section>
            {done < total && (
              <div className="flex items-center justify-between rounded-xl bg-kraft-soft px-4 py-3 text-[13px]">
                <span>
                  {done} of {total} quotes read. {errors > 0 ? `${errors} couldn't be read (connection or busy AI). Press Read the rest to retry.` : "Numbers above cover only those."}
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

            <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
              {/* award options */}
              <div className="rounded-2xl border border-line bg-white">
                <div className="flex items-center justify-between px-5 pt-4">
                  <h2 className="text-[15px] font-semibold">Award options</h2>
                  <span className="text-[12px] text-muted">annual value, landed at plant, ex-GST</span>
                </div>
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
                            <div className="text-[20px] font-semibold tabular">{crore(x.total)}</div>
                            <div className="text-[12px] text-muted">
                              {x.linesCovered}/{s.rfx.lines.length} items
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-panel">
                          {x.vendorsUsed.map((v, i) => (
                            <div key={v.vendor_id} title={`${v.name}: ${crore(v.value)}`} style={{ width: `${(v.value / x.total) * 100}%`, background: ["#15181d", "#9c6a32", "#6f8a7a", "#b9a17f", "#8a93a3"][i % 5] }} />
                          ))}
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
                <div className="flex justify-end px-5 pb-4">
                  <button className="text-[13px] font-medium text-kraft hover:underline" onClick={() => go("ask", { ask: "Compare the award options and recommend one I can defend to my VP. Show the line-level split." })}>
                    Ask the analyst to compare these →
                  </button>
                </div>
              </div>

              {/* attention */}
              <div className="rounded-2xl border border-line bg-white">
                <div className="px-5 pt-4">
                  <h2 className="text-[15px] font-semibold">Needs your attention</h2>
                </div>
                <div className="space-y-1 p-3">
                  {review > 0 && (
                    <Attention tone="warn" title={`${review} prices the system isn't sure about`} body="Unit conversions, photo reads and group rules. Check them before you award." action="Review" onClick={() => go("compare", { review: true })} />
                  )}
                  {n.vendors
                    .filter((v) => v.qualification !== "qualified")
                    .map((v) => (
                      <Attention key={v.vendor_id} tone={v.qualification === "not_qualified" ? "bad" : "warn"} title={`${v.name}: ${QUAL[v.qualification].label.toLowerCase()}`} body={v.qual_reasons.join("; ") || "Questionnaire incomplete"} action="Ask vendor" onClick={() => setClarify(v.vendor_id)} />
                    ))}
                  {n.vendors
                    .filter((v) => v.adjustments.some((a) => a.conditional))
                    .map((v) => (
                      <Attention key={"r" + v.vendor_id} tone="neutral" title={`${v.name}: ${v.adjustments.filter((a) => a.conditional).every((a) => a.kind === "one_time_charge") ? "one-time charge" : v.adjustments.filter((a) => a.conditional).every((a) => a.kind === "surcharge") ? "surcharge" : "conditional rebate"}`} body={v.adjustments.filter((a) => a.conditional).map((a) => a.description.replace(/\.+$/, "")).join("; ") + ". Not counted in totals."} action="Ask vendor" onClick={() => setClarify(v.vendor_id)} />
                    ))}
                </div>
              </div>
            </section>

            {/* vendor scorecards */}
            <section>
              <h2 className="mb-3 text-[15px] font-semibold">Vendors</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                        <span className="text-muted">Priced</span>
                        <span className="text-right tabular">
                          {v.quoted}/{s.rfx.lines.length}
                        </span>
                        <span className="text-muted">To check</span>
                        <span className={cx("text-right tabular", v.review > 0 && "text-warn")}>{v.review}</span>
                        <span className="text-muted">Payment</span>
                        <span className="text-right tabular">{v.terms.payment ? `${v.terms.payment} days` : "–"}</span>
                        <span className="text-muted">Quoted as</span>
                        <span className="text-right">{v.format.split(" ")[0]}</span>
                      </div>
                      <button onClick={() => setClarify(v.vendor_id)} className="mt-auto pt-3 text-left text-[12.5px] font-medium text-kraft hover:underline">
                        {issues[v.vendor_id]?.length || 0} open questions → draft email
                      </button>
                    </div>
                  ))}
              </div>
            </section>
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

function Step({ n, state, title, line }: { n: number; state: "todo" | "active" | "done"; title: string; line: string }) {
  return (
    <div className={cx("flex items-start gap-3 rounded-xl border px-4 py-3", state === "todo" ? "border-line bg-white" : state === "active" ? "border-kraft bg-kraft-soft" : "border-line bg-white")}>
      <span className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold", state === "done" ? "bg-ink text-white" : state === "active" ? "bg-kraft text-white" : "bg-panel text-muted")}>{state === "done" ? "✓" : n}</span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold">{title}</div>
        <div className="text-[12px] leading-snug text-muted">{line}</div>
      </div>
    </div>
  );
}

function Arrow() {
  return <div className="hidden items-center text-muted md:flex">→</div>;
}

function Kpi({ label, value, sub, accent, tone, onClick }: { label: string; value: string; sub: string; accent?: boolean; tone?: "good" | "bad" | "warn"; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cx("rounded-2xl border p-4 text-left transition", accent ? "border-ink bg-ink text-white" : "border-line bg-white", onClick && "hover:border-[#cfd3da]")}
    >
      <div className={cx("text-[12px] font-medium", accent ? "text-white/70" : "text-muted")}>{label}</div>
      <div className={cx("mt-1 text-[28px] font-semibold leading-tight tabular", tone === "good" && "text-good", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</div>
      <div className={cx("mt-0.5 text-[12px]", accent ? "text-white/70" : "text-muted")}>{sub}</div>
    </button>
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
