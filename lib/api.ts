"use client";
import { endJob, startJob, type Kind } from "./aiActivity";

/** POST JSON to our API. Responses are heartbeat-streamed, so read text and parse.
 *  Retries when the network drops or the model service is busy. Returns {error} on failure. */
export async function postJson<T = any>(url: string, body: unknown, tries = 3, track?: { kind: Kind; label: string }): Promise<T & { error?: string }> {
  const job = track ? startJob(track.kind, track.label) : 0;
  const res = await attempt<T>(url, body, tries);
  if (track) endJob(job, !res.error, res as any);
  return res;
}

async function attempt<T>(url: string, body: unknown, tries: number): Promise<T & { error?: string }> {
  const payload = JSON.stringify(body);
  let last: any = { error: "Request failed" };
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: AbortSignal.timeout(290_000) });
      const txt = (await res.text()).trim();
      if (res.status === 413) return { error: "Those files are too large for this demo (about 3 MB in total). Try fewer or smaller files, or one at a time." } as any;
      try {
        last = txt ? JSON.parse(txt) : { error: "The connection closed before the AI answered." };
      } catch {
        last = { error: `The server sent an unexpected reply (HTTP ${res.status}). Press retry.` };
      }
      if (!res.ok && !last.error) last.error = `HTTP ${res.status}`;
    } catch (e: any) {
      last = { error: e?.name === "TimeoutError" ? "The AI took too long. Press retry." : e?.message || "Network error" };
    }
    if (!last.error || !/high demand|overloaded|unavailable|503|504|429|quota|fetch|network|closed|too long|timed out|timeout/i.test(last.error)) return last;
    await new Promise((ok) => setTimeout(ok, 4000 * (i + 1)));
  }
  if (/quota|exceeded|RESOURCE_EXHAUSTED/i.test(last.error || "")) last.error = "Today's free AI quota is used up. It resets around 1:30 PM IST, so try again then.";
  else if (/failed to fetch|network|connection closed|load failed/i.test(last.error || "")) last.error = "Lost the connection while waiting for the AI. Press retry.";
  else if (/high demand|overloaded|503/i.test(last.error || "")) last.error = "Google's AI service is busy right now. Please try again in a minute.";
  return last;
}

/** POST and read a line-by-line stream (see ndjsonStream). onText gets each piece of text as it is written; onReset means discard what you showed.
 *  Returns the final object, or {error}. Retries a dropped or busy connection, but not after text has started to arrive. */
export async function postStream<T = any>(url: string, body: unknown, onText: (d: string) => void, onReset: () => void, tries = 2): Promise<T & { error?: string }> {
  const payload = JSON.stringify(body);
  let last: any = { error: "Request failed" };
  for (let i = 0; i < tries; i++) {
    let got = false;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: AbortSignal.timeout(290_000) });
      if (!res.body || !(res.headers.get("content-type") || "").includes("ndjson")) {
        // refused before streaming (rate limit, bad request): a plain JSON error
        const txt = (await res.text()).trim();
        try {
          last = txt ? JSON.parse(txt) : { error: "The connection closed before the AI answered." };
        } catch {
          last = { error: `The server sent an unexpected reply (HTTP ${res.status}). Press retry.` };
        }
        if (!last.error) last.error = `HTTP ${res.status}`;
      } else {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let fin: any = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let k: number;
          while ((k = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, k).trim();
            buf = buf.slice(k + 1);
            if (!line) continue;
            let e: any;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.t === "d") {
              got = true;
              onText(e.x);
            } else if (e.t === "r") onReset();
            else if (e.t === "done" || e.t === "err") fin = e;
          }
        }
        last = fin ? (fin.t === "err" ? { error: fin.error } : fin) : { error: "The connection closed before the AI answered." };
      }
    } catch (e: any) {
      last = { error: e?.name === "TimeoutError" ? "The AI took too long. Press retry." : e?.message || "Network error" };
    }
    if (!last.error || got || !/high demand|overloaded|unavailable|503|504|429|quota|fetch|network|closed|too long|timed out|timeout/i.test(last.error)) break;
    onReset();
    await new Promise((ok) => setTimeout(ok, 2500 * (i + 1)));
  }
  if (/quota|exceeded|RESOURCE_EXHAUSTED/i.test(last.error || "")) last.error = "Today's free AI quota is used up. It resets around 1:30 PM IST, so try again then.";
  else if (/failed to fetch|network|connection closed|load failed/i.test(last.error || "")) last.error = "Lost the connection while waiting for the AI. Press retry.";
  else if (/high demand|overloaded|503/i.test(last.error || "")) last.error = "Google's AI service is busy right now. Please try again in a minute.";
  return last;
}
