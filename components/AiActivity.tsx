"use client";
import { useEffect, useState } from "react";
import { groupProgress, useAiActivity, type Kind } from "@/lib/aiActivity";

const WORD: Record<Kind, [string, string]> = {
  extract: ["Reading quotes", "Quotes read"],
  copilot: ["Co-pilot is working on your request", "Co-pilot done"],
  analyst: ["AI is looking at your data", "AI done"],
  clarify: ["Drafting the email", "Email drafted"],
};

const secs = (ms: number) => (ms < 60_000 ? `${Math.max(5, Math.round(ms / 5000) * 5)} s` : `${Math.round(ms / 30_000) / 2} min`);

/** Floating progress panel. Shows while the AI is working: what, how far along, roughly how long, and why it can be slow. */
export default function AiActivity() {
  const a = useAiActivity();
  const [now, setNow] = useState(() => Date.now());
  const busy = a.jobs.length > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);
  if (!busy) return null;
  const kinds = [...new Set(a.jobs.map((j) => j.kind))];
  const anyActive = a.jobs.some((j) => !j.end);
  const longest = Math.max(0, ...a.jobs.filter((j) => !j.end).map((j) => now - j.start));
  const showWhy = anyActive && (a.slow || longest > 10_000);
  return (
    <div role="status" aria-live="polite" className="lv-rise fixed bottom-4 left-4 z-50 w-[340px] rounded-xl border border-line bg-white p-3 shadow-lg">
      {kinds.map((k) => {
        const g = groupProgress(a.jobs.filter((j) => j.kind === k), a.expected[k], now);
        const finished = g.done === g.total;
        return (
          <div key={k} className="mb-2 last:mb-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium">{finished ? <span key="done" className="lv-settle inline-block">✓ {WORD[k][1]}</span> : WORD[k][0]}</span>
              <span className="tabular text-xs text-muted">
                {k === "extract" && g.total > 1 ? `${g.done} of ${g.total} · ` : ""}
                {finished ? "" : g.over ? "a little longer than usual" : `about ${secs(g.left)} left`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel" aria-hidden>
              <div className={`h-full rounded-full transition-[width,background-color] duration-500 ease-out ${finished ? "bg-good" : "lv-bar bg-kraft"} ${g.over ? "animate-pulse" : ""}`} style={{ width: `${Math.round((finished ? 1 : g.pct) * 100)}%` }} />
            </div>
          </div>
        );
      })}
      {showWhy && (
        <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed text-muted">
          {kinds.includes("extract") ? "Free AI tier: reading quotes takes a minute or two, photos longest." : "Free AI tier: answers can take up to half a minute."}
        </p>
      )}
    </div>
  );
}
