"use client";
import type { CSSProperties } from "react";
import { Button } from "./ui";

const HEADLINE = "Turn a pile of quotes into one decision that you can defend.".split(" ");

// The five shapes a quote arrives in, and where each starts in the pile (px away from its place in the list).
const PILE = [
  { tag: "XLS", name: "Excel sheet", sx: 14, sy: 94, sr: -7 },
  { tag: "PDF", name: "Letterhead PDF", sx: -18, sy: 30, sr: 5 },
  { tag: "DOC", name: "Word letter", sx: 10, sy: -20, sr: -3 },
  { tag: "JPG", name: "Phone photo", sx: -12, sy: -62, sr: 8 },
  { tag: "MAIL", name: "One-line email", sx: 20, sy: -112, sr: -6 },
];

/** A demo single sign-on screen. Nothing is checked or sent anywhere: it exists so the product opens the way a company tool would. */
export default function Login({ onEnter }: { onEnter: (email: string) => void }) {
  const email = "ananya.rao@saffronleaf.example";
  return (
    <main className="relative min-h-screen overflow-hidden bg-panel">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="lv-orb absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#f3e6d2] opacity-70 blur-3xl" />
        <div className="lv-orb absolute -bottom-32 right-0 h-[460px] w-[460px] rounded-full bg-[#dfe6f1] opacity-70 blur-3xl" style={{ animationDelay: "-9s" }} />
      </div>
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1080px] flex-col px-6 py-8">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-[15px] font-bold text-white">L</span>
          <span className="text-[20px] font-semibold tracking-tight">Levelset</span>
        </div>
        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.15fr_.85fr] lg:gap-16">
          <div className="min-w-0">
            <h1 className="max-w-[520px] text-[34px] font-semibold leading-[1.12] tracking-tight sm:text-[44px]">
              {HEADLINE.map((w, i) => (
                <span key={i}>
                  <span className="lv-word inline-block" style={{ animationDelay: `${150 + i * 75}ms` }}>
                    {w}
                  </span>{" "}
                </span>
              ))}
            </h1>
            <div aria-hidden className="relative mt-10 hidden h-[268px] w-[400px] sm:block">
              {PILE.map((c, i) => (
                <div key={c.tag} className="lv-pile flex items-center gap-2.5 rounded-xl border border-line bg-white px-2.5 shadow-sm" style={{ top: i * 54, left: 0, "--sx": `${c.sx}px`, "--sy": `${c.sy}px`, "--sr": `${c.sr}deg`, "--d": `${i * 90}ms` } as CSSProperties}>
                  <span className="grid h-7 w-9 place-items-center rounded-md bg-kraft-soft text-[10px] font-bold tracking-wide text-kraft">{c.tag}</span>
                  <span className="text-[13px] font-medium text-ink">{c.name}</span>
                </div>
              ))}
              <svg className="lv-decision absolute left-[222px] top-[104px]" width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="#85561f" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8h22M18 2l6 6-6 6" />
              </svg>
              <div className="lv-decision absolute left-[258px] top-[44px] w-[142px] rounded-2xl border border-line bg-white p-3.5 shadow-md">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="8" fill="#16794a" />
                    <path className="lv-check" d="M4.5 8.2l2.4 2.4 4.6-5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  One decision
                </div>
                <div className="mt-2.5 text-[24px] font-semibold tracking-tight">₹4.51 Cr</div>
                <div className="mt-0.5 text-[11.5px] text-muted">2 vendors · 30 items</div>
              </div>
            </div>
          </div>
          <div className="lv-rise mx-auto w-full min-w-0 max-w-[400px]" style={{ animationDelay: "450ms" }}>
            <div className="rounded-2xl border border-line bg-white p-7 shadow-lg">
              <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-kraft-soft text-[13px] font-semibold text-ink">AR</span>
                <div className="min-w-0">
                  <div className="text-[11.5px] text-muted">Signing in as</div>
                  <div className="truncate text-[14px] font-medium text-ink">{email}</div>
                </div>
              </div>
              <Button variant="primary" className="mt-4 w-full justify-center py-2.5 text-[14px]" onClick={() => onEnter(email)}>
                Continue with SSO
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
