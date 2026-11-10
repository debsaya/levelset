"use client";
import { useSyncExternalStore } from "react";

/** What the AI is doing right now, so the screen can show progress and an honest time estimate.
 *  Free-tier AI can take a minute or two; without this, a slow answer looks like a stuck app. */
export type Kind = "extract" | "copilot" | "analyst" | "clarify";
export type Job = { id: number; kind: Kind; label: string; start: number; end?: number; ok?: boolean };
export type Snap = { jobs: Job[]; slow: boolean; expected: Record<Kind, number> };

const DEFAULTS: Record<Kind, number> = { extract: 65_000, copilot: 15_000, analyst: 45_000, clarify: 12_000 };
const KEY = "levelset-ai-timing";

function loadExpected(): Record<Kind, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in DEFAULTS && typeof v === "number" && v > 3000 && v < 300_000)) } as Record<Kind, number>;
  } catch {
    return { ...DEFAULTS };
  }
}

let snap: Snap = { jobs: [], slow: false, expected: { ...DEFAULTS } };
let loaded = false;
let nextId = 1;
const subs = new Set<() => void>();
let clearTimer: ReturnType<typeof setTimeout> | undefined;

function emit(p: Partial<Snap>) {
  snap = { ...snap, ...p };
  subs.forEach((f) => f());
}

export function startJob(kind: Kind, label: string): number {
  if (!loaded) {
    loaded = true;
    snap = { ...snap, expected: loadExpected() };
  }
  if (clearTimer) clearTimeout(clearTimer);
  const id = nextId++;
  // A new batch starts from a clean list once the old one has finished.
  const keep = snap.jobs.some((j) => !j.end) ? snap.jobs : [];
  emit({ jobs: [...keep, { id, kind, label, start: Date.now() }] });
  return id;
}

/** Call when the answer is in. `meta` is what the server said about which model answered. */
export function endJob(id: number, ok: boolean, meta?: { model?: string; attempts?: string[] }) {
  const j = snap.jobs.find((x) => x.id === id);
  if (!j) return;
  const dur = Date.now() - j.start;
  const slow = snap.slow || !!(meta && ((meta.model && /lite/i.test(meta.model)) || meta.attempts?.some((a) => /:429:/.test(a))));
  let expected = snap.expected;
  if (ok && dur > 3000) {
    expected = { ...expected, [j.kind]: Math.round(expected[j.kind] * 0.4 + dur * 0.6) };
    try {
      localStorage.setItem(KEY, JSON.stringify(expected));
    } catch {}
  }
  emit({ jobs: snap.jobs.map((x) => (x.id === id ? { ...x, end: Date.now(), ok } : x)), slow, expected });
  if (snap.jobs.every((x) => x.end)) {
    clearTimer = setTimeout(() => emit({ jobs: snap.jobs.every((x) => x.end) ? [] : snap.jobs }), 2500);
  }
}

/** Remove one job (a stopped question leaves no "done" tick behind). */
export function dropJob(id: number) {
  emit({ jobs: snap.jobs.filter((j) => j.id !== id) });
}

/** Drop every job from the progress panel (used when the AI calls behind them were cancelled). */
export function clearJobs() {
  if (clearTimer) clearTimeout(clearTimer);
  emit({ jobs: [] });
}

export function useAiActivity(): Snap {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snap,
    () => snap
  );
}

/** Pure helper for the panel and the tests: progress 0..1 for a group of jobs of one kind. */
export function groupProgress(jobs: Job[], expectedMs: number, now: number) {
  const total = jobs.length;
  const done = jobs.filter((j) => j.end).length;
  const active = jobs.filter((j) => !j.end);
  // One clock for both: the bar is the share of the expected time that has passed, and "left" is the rest of it.
  const elapsed = total ? Math.max(0, now - Math.min(...jobs.map((j) => j.start))) : 0;
  const left = active.length ? Math.max(0, expectedMs - elapsed) : 0;
  const pct = active.length ? Math.min(0.97, elapsed / expectedMs) : total ? 1 : 0;
  return { total, done, pct, elapsed, left, over: active.length > 0 && elapsed > expectedMs };
}
