"use client";
import { useMemo, useState } from "react";
import { StoreProvider, useStore } from "@/lib/store";
import { normalize } from "@/lib/normalize";
import RfxStep from "@/components/RfxStep";
import SendStep from "@/components/SendStep";
import InboxStep from "@/components/InboxStep";
import CompareStep from "@/components/CompareStep";
import AskStep from "@/components/AskStep";
import { Badge, Button, cx } from "@/components/ui";

type StepId = "rfx" | "send" | "inbox" | "compare" | "ask";

function App() {
  const { s, reset } = useStore();
  const [step, setStep] = useState<StepId>("rfx");
  const n = useMemo(() => normalize(s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior), [s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior]);
  const read = s.responses.filter((r) => r.status === "done").length;
  const review = n.cells.filter((c) => c.status === "review").length;

  const steps: { id: StepId; label: string; hint: string; badge?: React.ReactNode }[] = [
    { id: "rfx", label: "Draft RFx", hint: "AI co-pilot", badge: <Badge>{s.rfx.lines.length} lines</Badge> },
    { id: "send", label: "Send", hint: "Email to vendors", badge: s.sentAt ? <Badge tone="good">sent</Badge> : undefined },
    { id: "inbox", label: "Responses", hint: "Read anything", badge: s.responses.length ? <Badge tone={read === s.responses.length ? "good" : "neutral"}>{read}/{s.responses.length} read</Badge> : undefined },
    { id: "compare", label: "Compare", hint: "Normalised & audited", badge: review ? <Badge tone="warn">{review} to review</Badge> : undefined },
    { id: "ask", label: "Ask", hint: "Plain-language analysis" },
  ];

  return (
    <div className="flex h-screen min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
        <div className="px-4 py-4">
          <div className="text-[15px] font-bold tracking-tight">
            Level<span className="text-brand">set</span>
          </div>
          <div className="text-[11px] text-muted">Kill the quote spreadsheet</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {steps.map((st, i) => (
            <button key={st.id} onClick={() => setStep(st.id)} className={cx("w-full rounded-md px-3 py-2 text-left", step === st.id ? "bg-white shadow-sm ring-1 ring-line" : "hover:bg-white/60")}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">
                  <span className="mr-1.5 text-muted">{i + 1}</span>
                  {st.label}
                </span>
              </div>
              <div className="flex items-center justify-between pl-4">
                <span className="text-[11px] text-muted">{st.hint}</span>
                {st.badge}
              </div>
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line p-3 text-[11px] text-muted">
          <div>
            Event: <b className="text-ink">{s.rfx.id}</b>
            <br />
            Buyer: {s.rfx.buyer.name}, {s.rfx.buyer.company}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" className="px-2 text-[11px]" onClick={() => confirm("Reset to the demo event? This clears extractions and decisions.") && (reset("demo"), setStep("rfx"))}>
              Reset demo
            </Button>
            <Button variant="ghost" className="px-2 text-[11px]" onClick={() => confirm("Start a blank RFx? This clears the demo event.") && (reset("blank"), setStep("rfx"))}>
              New RFx
            </Button>
          </div>
          <div className="leading-snug">Prototype · AI loops are live (Gemini). Email sending is simulated. All company names are fictional.</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden bg-[#fbfcfd]">
        {step === "rfx" && <RfxStep onNext={() => setStep("send")} />}
        {step === "send" && <SendStep onNext={() => setStep("inbox")} />}
        {step === "inbox" && <InboxStep onNext={() => setStep("compare")} />}
        {step === "compare" && <CompareStep n={n} onAsk={() => setStep("ask")} />}
        {step === "ask" && <AskStep n={n} />}
      </main>
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
