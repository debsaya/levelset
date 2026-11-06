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
      last = txt ? JSON.parse(txt) : { error: "The connection closed before the AI answered." };
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
