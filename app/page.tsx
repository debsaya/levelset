"use client";
import AiActivity from "@/components/AiActivity";
import { useEffect, useMemo, useRef, useState } from "react";
import { StoreProvider, hasSavedReading, useStore } from "@/lib/store";
import Login from "@/components/Login";
import { normalize } from "@/lib/normalize";
import OverviewStep from "@/components/OverviewStep";
import CollectStep from "@/components/CollectStep";
import SendStep from "@/components/SendStep";
import InboxStep from "@/components/InboxStep";
import CompareStep from "@/components/CompareStep";
import AskStep, { type Suggestion } from "@/components/AskStep";
import { EventBar, cx } from "@/components/ui";
import { nextStep } from "@/lib/flow";

type Page = "overview" | "compare" | "ask" | "quotes" | "rfx" | "send";

// Ask AI sits beside whichever step you are on, and offers the questions that make sense there.
const ASK_BY_STEP: Record<Exclude<Page, "ask" | "send">, Suggestion[]> = {
  rfx: [
    { short: "What's missing from the quotes?", q: "Which vendors are missing something we asked for, and what exactly is missing from each?" },
    { short: "Who needs a follow-up?", q: "Which vendors need a follow-up, and what should I ask each of them?" },
    { short: "Certificates", q: "Which ISO certificates are expired or missing?" },
    { short: "Terms vs what we asked", q: "Did any vendor offer payment or validity terms different from what we asked for?" },
  ],
  quotes: [
    { short: "Low-confidence reads", q: "Which prices did you read with low confidence, and where in the source did they come from?" },
    { short: "Different units", q: "Which quotes were in a different unit, like per 100 pieces or per kg, and how did you convert them?" },
    { short: "Photo or scan prices", q: "Which prices were read from a photo or scan, and how sure are you of them?" },
    { short: "Different specs", q: "Did any vendor quote a different spec from what we asked for?" },
  ],
  compare: [
    { short: "What to double-check first", q: "Which prices should I double-check first, and why?" },
    { short: "Who is cheapest, really?", q: "Who is cheapest on a like-for-like basis, and how much should I trust that?" },
    { short: "Biggest gaps between vendors", q: "Which items have the biggest price gap between vendors?" },
    { short: "Items only one vendor quoted", q: "Which items did only one vendor quote?" },
  ],
  overview: [
    { short: "Why this recommendation?", q: "Why do you recommend this award, and how much should I trust it?" },
    { short: "Best split between vendors", q: "What if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?" },
    { short: "Compare with last year", q: "How does this award compare with last year's contract, line by line?" },
    { short: "Draft a note for my VP", q: "Draft an award recommendation I can send to my VP" },
  ],
};

function App({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const { s, reset, loadExample, hydrated } = useStore();
  const [page, setPage] = useState<Page>("rfx");
  const [opts, setOpts] = useState<{ review?: boolean; ask?: string; add?: boolean; nonce: number }>({ nonce: 0 });
  const [menu, setMenu] = useState(false);
  const [askUi, setAskUi] = useState<{ open: boolean; q?: string; k: number }>({ open: false, k: 0 });
  const [confirm, setConfirm] = useState<null | "demo" | "blank" | "example">(null);
  const n = useMemo(() => normalize(s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior), [s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior]);
  const review = n.cells.filter((c) => c.status === "review").length;
  const total = s.responses.length;
  const read = s.responses.filter((r) => r.status === "done").length;
  const go = (p: Page, o?: { review?: boolean; ask?: string; add?: boolean }) => {
    if (p === "ask") {
      setAskUi({ open: true, q: o?.ask, k: Date.now() });
      return;
    }
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
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-3 md:gap-6 md:px-5">
        <button onClick={here} className="flex items-center gap-2" title="Back to where you left off">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[13px] font-bold text-white">L</span>
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Levelset</span>
        </button>
        <nav className="flex h-full min-w-0 items-stretch gap-1 overflow-x-auto [scrollbar-width:none]">
          {steps.map((t, i) => (
            <div key={t.id} className="flex shrink-0 items-center">
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
        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
          <button onClick={() => setAskUi((a) => ({ ...a, open: !a.open, q: undefined }))} title="Ask questions about your quotes in plain English. Opens beside the step you are on." aria-expanded={askUi.open} className={cx("rounded-lg border px-3 py-1.5 text-[13px] font-medium transition", askUi.open ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-panel")}>
            Ask AI
          </button>
          <span className="hidden rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-muted lg:inline" title="Demo with made-up companies. The AI reads and answers for real; only the sending of emails to vendors is simulated.">
            Demo data
          </span>
          <div className="relative">
            <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex items-center gap-2 rounded-full border border-line py-0.5 pl-0.5 pr-3 hover:bg-panel" title={`${s.rfx.buyer.name}, ${s.rfx.buyer.role}`}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-kraft-soft text-[11.5px] font-semibold text-kraft">
                {s.rfx.buyer.name
                  .split(" ")
                  .map((x) => x[0])
                  .join("")}
              </span>
              <span className="hidden text-[12.5px] font-medium md:inline">{s.rfx.buyer.name.split(" ")[0]}</span>
              <span className="text-[9px] text-muted">▾</span>
            </button>
            {menu && (
              <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-line bg-white p-1.5 text-[13px] shadow-lg">
                <div className="px-3 py-2 text-[12px] text-muted">
                  {s.rfx.buyer.name}
                  <br />
                  {s.rfx.buyer.role}, {s.rfx.buyer.company}
                  <br />
                  <span className="text-[11.5px]">{email}</span>
                </div>
                <div className="my-1 border-t border-line" />
                <div className="px-3 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Sample data</div>
                <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-panel" onClick={() => (setConfirm("demo"), setMenu(false))}>
                  Start the sample event over
                  <span className="block text-[11.5px] text-muted">Request drafted, nothing sent yet</span>
                </button>
                <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-panel" onClick={() => (setConfirm("example"), setMenu(false))}>
                  Load the finished example
                  <span className="block text-[11.5px] text-muted">Request sent, five replies in</span>
                </button>
                <div className="my-1 border-t border-line" />
                <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-panel" onClick={() => (setConfirm("blank"), setMenu(false))}>
                  Start a new request from scratch
                </button>
              </div>
            )}
          </div>
          <button onClick={onSignOut} className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-panel hover:text-ink" title={`Signed in as ${email}`}>
            Sign out
          </button>
        </div>
      </header>
      <EventBar next={(() => { const nx = nextStep(s, review); /* The Collect step already has its own main button for these moves; don't say the same thing twice. */ if (nx.to === page || (page === "rfx" && (nx.to === "send" || nx.to === "quotes"))) return undefined; return { text: nx.text, cta: nx.cta, onClick: () => go(nx.to) }; })()} id={s.rfx.id} title={s.rfx.title} due={s.rfx.due_date} revision={s.revision || 1} blank={s.mode === "blank"} sent={!!s.sentAt} />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="min-w-0 lg:flex-1 lg:overflow-hidden">
        {page === "overview" && <OverviewStep n={n} go={go} />}
        {page === "rfx" && <CollectStep n={n} onSend={() => go("send")} onRead={(add) => go("quotes", add ? { add: true } : undefined)} onNext={() => go("compare")} />}
        {page === "send" && <SendStep onNext={() => go("rfx")} />}
        {page === "quotes" && <InboxStep key={opts.nonce} n={n} onNext={() => go("compare")} go={(p) => go(p)} initialAdd={!!opts.add} />}
        {page === "compare" && <CompareStep key={opts.nonce} n={n} onNext={() => go("overview")} go={(p) => go(p)} initialReview={!!opts.review} />}
        </div>
        {askUi.open && (
          <aside className="fixed bottom-0 right-0 top-[6.4rem] z-40 flex w-[440px] max-w-full flex-col border-l border-line bg-white shadow-xl min-[1700px]:static min-[1700px]:z-auto min-[1700px]:shrink-0 min-[1700px]:shadow-none" aria-label="Ask AI">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <div>
                <div className="text-[14px] font-semibold">Ask AI</div>
                <div className="text-[11.5px] text-muted">About your quotes · you&apos;re on {steps.find((x) => x.id === cur)?.label}</div>
              </div>
              <button onClick={() => setAskUi((a) => ({ ...a, open: false }))} aria-label="Close Ask AI" className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink">
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <AskStep key={askUi.k} n={n} initialAsk={askUi.q} compact suggested={ASK_BY_STEP[cur as keyof typeof ASK_BY_STEP]} />
            </div>
          </aside>
        )}
      </main>
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" onClick={() => setConfirm(null)}>
          <div className="w-[420px] rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold">{confirm === "demo" ? "Start the sample event over?" : confirm === "example" ? "Load the finished example?" : "Start a new request?"}</div>
            <p className="mt-1.5 text-[13px] text-muted">
              {confirm === "demo" && "You go back to the draft request for corrugated packaging with the five vendors chosen. Nothing is sent yet. This clears the quotes you have read, your review decisions and your questions to Ask AI."}
              {confirm === "example" && "You land on the same event after it was sent, with five vendor replies in. This replaces everything in this browser: your request, quotes, decisions and notes."}
              {confirm === "blank" && "You get an empty request. Tell the co-pilot what you are buying, choose vendors, and send. This replaces everything in this browser."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-lg px-3.5 py-2 text-[13px] hover:bg-panel" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white"
                onClick={() => {
                  if (confirm === "example") {
                    loadExample();
                    go(hasSavedReading ? "overview" : "quotes");
                  } else {
                    reset(confirm);
                    go("rfx");
                  }
                  setConfirm(null);
                }}
              >
                {confirm === "demo" ? "Start over" : confirm === "example" ? "Load it" : "Start new"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SESSION_KEY = "levelset-session";

/** The front door: a demo sign-in, then the four-step app. */
function Gate() {
  const { hydrated } = useStore();
  const [auth, setAuth] = useState<{ email: string } | null | undefined>(undefined);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      setAuth(raw ? JSON.parse(raw) : null);
    } catch {
      setAuth(null);
    }
  }, []);
  if (auth === undefined || !hydrated) return <div className="min-h-screen bg-panel" />;
  if (!auth)
    return (
      <Login
        onEnter={(email) => {
          try {
            localStorage.setItem(SESSION_KEY, JSON.stringify({ email, at: new Date().toISOString() }));
          } catch {}
          setAuth({ email });
        }}
      />
    );
  return (
    <>
    <AiActivity />
    <App
      email={auth.email}
      onSignOut={() => {
        try {
          localStorage.removeItem(SESSION_KEY);
        } catch {}
        setAuth(null);
      }}
    />
    </>
  );
}

export default function Page() {
  return (
    <StoreProvider>
      <Gate />
    </StoreProvider>
  );
}
