import { useSyncExternalStore } from "react";

/**
 * What an Ask AI question is doing right now. It lives outside the panel so that closing the panel, switching steps
 * or flipping to the other tab doesn't lose the progress: the question keeps running, and the panel picks it up again.
 */
export type AskLive = { busy: boolean; live: string[]; draft: string; blocks: unknown[] };

let state: AskLive = { busy: false, live: [], draft: "", blocks: [] };
const subs = new Set<() => void>();

export function setAskLive(p: Partial<AskLive> | ((s: AskLive) => Partial<AskLive>)) {
  state = { ...state, ...(typeof p === "function" ? p(state) : p) };
  subs.forEach((f) => f());
}

export function useAskLive(): AskLive {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => state,
    () => state
  );
}

/** Whether the request co-pilot is working on a message. Kept here for the same reason: leaving the step mid-reply must not lose it. */
let copilotBusy = false;
const copilotSubs = new Set<() => void>();

export function setCopilotBusy(b: boolean) {
  copilotBusy = b;
  copilotSubs.forEach((f) => f());
}

export function useCopilotBusy(): boolean {
  return useSyncExternalStore(
    (cb) => {
      copilotSubs.add(cb);
      return () => void copilotSubs.delete(cb);
    },
    () => copilotBusy,
    () => copilotBusy
  );
}

/** Stopping one Ask AI question. The question's own signal is separate from the global stop in api.ts (Start over, Sign out). */
let askCtl: AbortController | null = null;
let askByUser = false;
export function askSignal(): AbortSignal {
  askByUser = false;
  askCtl = new AbortController();
  return askCtl.signal;
}
export function stopAsk() {
  askByUser = true;
  askCtl?.abort();
}
export const askStoppedByUser = () => askByUser;
