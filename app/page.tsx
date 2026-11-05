"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { StoreProvider, useStore } from "@/lib/store";
import { normalize } from "@/lib/normalize";
import OverviewStep from "@/components/OverviewStep";
import CollectStep from "@/components/CollectStep";
import SendStep from "@/components/SendStep";
import InboxStep from "@/components/InboxStep";
import CompareStep from "@/components/CompareStep";
import AskStep from "@/components/AskStep";
import { cx } from "@/components/ui";

type Page = "overview" | "compare" | "ask" | "quotes" | "rfx" | "send";

function App() {
  const { s, reset, hydrated } = useStore();
  const [page, setPage] = useState<Page>("rfx");
  const [opts, setOpts] = useState<{ review?: boolean; ask?: string; nonce: number }>({ nonce: 0 });
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<null | "demo" | "blank">(null);
  const n = useMemo(() => normalize(s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior), [s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior]);
  const review = n.cells.filter((c) => c.status === "review").length;
  const total = s.responses.length;
  const read = s.responses.filter((r) => r.status === "done").length;
  const go = (p: Page, o?: { review?: boolean; ask?: string }) => {
    setOpts({ ...o, nonce: Date.now() });
    setPage(p);
  };

  // Open on the first unfinished step, once the saved session has loaded.
  const landed = useRef(false);
  useEffect(() => {
    if (!hydrated || landed.current) return;
    landed.current = true;
    if (!s.sentAt && s.mode === "demo") setPage("rfx");
    else if (total && read < total) setPage("quotes");
    else if (read > 0) setPage(review > 0 ? "compare" : "overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // The four steps of the buyer's job, in order. "Ask AI" is a helper, not a step.
  type St = "done" | "active" | "todo";
  const steps: { id: Page; label: string; hint: string; state: St; note?: string }[] = [
    { id: "rfx", label: "Collect quotes", hint: "See which vendor quotes and documents have come in, and what each one still needs to give us. Change what you ask for with the co-pilot.", state: s.sentAt ? "done" : "active", note: s.sentAt ? `${total} in` : "not sent" },
    { id: "quotes", label: "Read quotes", hint: "The AI reads each quote, in any format, into one standard layout. Every price shows where it was found.", state: total && read === total ? "done" : s.sentAt || read ? "active" : "todo", note: total && s.sentAt ? `${read}/${total} read` : undefined },
    { id: "compare", label: "Compare", hint: "Every vendor side by side, on the same items, units and currency. Check anything flagged.", state: read === 0 ? "todo" : read === total && review === 0 ? "done" : "active", note: read > 0 && review > 0 ? `${review} to check` : undefined },
    { id: "overview", label: "Decision", hint: "Your recommended award and the reasons behind it.", state: read === 0 ? "todo" : "active" },
  ];
  const cur: Page = page === "send" ? "rfx" : page;
  const here = () => go(!s.sentAt && s.mode === "demo" ? "rfx" : total && read < total ? "quotes" : read > 0 ? (review > 0 ? "compare" : "overview") : "quotes");

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-white px-5">
        <button onClick={here} className="flex items-center gap-2" title="Back to where you left off">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[13px] font-bold text-white">L</span>
          <span className="text-[15px] font-semibold tracking-tight">Levelset</span>
        </button>
        <nav className="flex h-full items-stretch gap-1">
          {steps.map((t, i) => (
            <div key={t.id} className="flex items-center">
              {i > 0 && <span className="px-1 text-line">—</span>}
              <button onClick={() => go(t.id)} title={t.hint} className={cx("relative flex h-full items-center gap-2 px-2.5 text-[13.5px]", cur === t.id ? "font-semibold text-ink" : "text-muted hover:text-ink")}>
                <span className={cx("grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold", t.state === "done" ? "bg-ink text-white" : cur === t.id ? "bg-kraft text-white" : "bg-panel text-muted")}>{t.state === "done" ? "✓" : i + 1}</span>
                {t.label}
                {t.note && <span className={cx("hidden text-[11.5px] font-normal lg:inline", /check/.test(t.note) ? "text-warn" : "text-muted")}>{t.note}</span>}
                {cur === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-ink" />}
              </button>
            </div>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => go("ask")} title="Ask questions about the comparison in plain English" className={cx("rounded-lg border px-3 py-1.5 text-[13px] font-medium transition", page === "ask" ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-panel")}>
            Ask AI
          </button>
          <span className="hidden rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-muted lg:inline" title="Demo with made-up companies. The AI reads and answers for real; only the sending of emails to vendors is simulated.">
            Demo data
          </span>
          <div className="relative">
            <button onClick={() => setMenu(!menu)} className="grid h-8 w-8 place-items-center rounded-full bg-kraft-soft text-[12px] font-semibold text-kraft" title={`${s.rfx.buyer.name}, ${s.rfx.buyer.role}`}>
              {s.rfx.buyer.name
                .split(" ")
                .map((x) => x[0])
                .join("")}
            </button>
            {menu && (
              <div className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-line bg-white p-1.5 text-[13px] shadow-lg">
                <div className="px-3 py-2 text-[12px] text-muted">
                  {s.rfx.buyer.name}
                  <br />
                  {s.rfx.buyer.role}, {s.rfx.buyer.company}
                </div>
                <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-panel" onClick={() => (setConfirm("demo"), setMenu(false))}>
                  Reset the demo event
                </button>
                <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-panel" onClick={() => (setConfirm("blank"), setMenu(false))}>
                  Start a new request from scratch
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        {page === "overview" && <OverviewStep n={n} go={go} />}
        {page === "rfx" && <CollectStep n={n} onSend={() => go("send")} onRead={() => go("quotes")} onNext={() => go("compare")} />}
        {page === "send" && <SendStep onNext={() => go("rfx")} />}
        {page === "quotes" && <InboxStep n={n} onNext={() => go("compare")} />}
        {page === "compare" && <CompareStep key={opts.nonce} n={n} onNext={() => go("overview")} initialReview={!!opts.review} />}
        {page === "ask" && <AskStep key={opts.nonce} n={n} initialAsk={opts.ask} />}
      </main>
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" onClick={() => setConfirm(null)}>
          <div className="w-[420px] rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold">{confirm === "demo" ? "Reset the demo event?" : "Start a new request?"}</div>
            <p className="mt-1.5 text-[13px] text-muted">This clears the quotes you've read, your review decisions and the analyst conversation in this browser.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-lg px-3.5 py-2 text-[13px] hover:bg-panel" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white"
                onClick={() => {
                  reset(confirm);
                  setConfirm(null);
                  go("rfx");
                }}
              >
                {confirm === "demo" ? "Reset" : "Start new"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  );
}
