"use client";
import { useMemo, useState } from "react";
import { StoreProvider, useStore } from "@/lib/store";
import { normalize } from "@/lib/normalize";
import OverviewStep from "@/components/OverviewStep";
import RfxStep from "@/components/RfxStep";
import SendStep from "@/components/SendStep";
import InboxStep from "@/components/InboxStep";
import CompareStep from "@/components/CompareStep";
import AskStep from "@/components/AskStep";
import { cx } from "@/components/ui";

type Page = "overview" | "compare" | "ask" | "quotes" | "rfx" | "send";

function App() {
  const { s, reset } = useStore();
  const [page, setPage] = useState<Page>("overview");
  const [opts, setOpts] = useState<{ review?: boolean; ask?: string; nonce: number }>({ nonce: 0 });
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<null | "demo" | "blank">(null);
  const n = useMemo(() => normalize(s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior), [s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior]);
  const review = n.cells.filter((c) => c.status === "review").length;
  const read = s.responses.filter((r) => r.status === "done").length;
  const go = (p: Page, o?: { review?: boolean; ask?: string }) => {
    setOpts({ ...o, nonce: Date.now() });
    setPage(p);
  };

  const tabs: { id: Page; label: string; count?: number | string }[] = [
    { id: "overview", label: "Overview" },
    { id: "compare", label: "Comparison" },
    { id: "ask", label: "Ask" },
    { id: "quotes", label: "Quotes" },
    { id: "rfx", label: "RFx" },
  ];

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-white px-5">
        <button onClick={() => go("overview")} className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[13px] font-bold text-white">L</span>
          <span className="text-[15px] font-semibold tracking-tight">Levelset</span>
        </button>
        <nav className="flex h-full items-stretch gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              className={cx("relative flex items-center gap-1.5 px-3 text-[13.5px]", page === t.id || (t.id === "rfx" && page === "send") ? "font-semibold text-ink" : "text-muted hover:text-ink")}
            >
              {t.label}
              {t.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px] tabular", t.id === "compare" ? "bg-warn-soft text-warn" : "bg-panel text-muted")}>{t.count}</span>}
              {(page === t.id || (t.id === "rfx" && page === "send")) && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink" />}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
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
                  Start a new RFx from scratch
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        {page === "overview" && <OverviewStep n={n} go={go} />}
        {page === "rfx" && <RfxStep onNext={() => go("send")} />}
        {page === "send" && <SendStep onNext={() => go("overview")} />}
        {page === "quotes" && <InboxStep onNext={() => go("overview")} />}
        {page === "compare" && <CompareStep key={opts.nonce} n={n} onAsk={() => go("ask")} initialReview={!!opts.review} />}
        {page === "ask" && <AskStep key={opts.nonce} n={n} initialAsk={opts.ask} />}
      </main>
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" onClick={() => setConfirm(null)}>
          <div className="w-[420px] rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold">{confirm === "demo" ? "Reset the demo event?" : "Start a new RFx?"}</div>
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
                  go(confirm === "demo" ? "overview" : "rfx");
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
