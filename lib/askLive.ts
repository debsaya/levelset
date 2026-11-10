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
