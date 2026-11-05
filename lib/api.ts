"use client";
/** POST JSON to our API. Responses are heartbeat-streamed, so read text and parse.
 *  Retries when the network drops or the model service is busy. Returns {error} on failure. */
export async function postJson<T = any>(url: string, body: unknown, tries = 3): Promise<T & { error?: string }> {
  const payload = JSON.stringify(body);
  let last: any = { error: "Request failed" };
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      const txt = (await res.text()).trim();
      last = txt ? JSON.parse(txt) : { error: "The connection closed before the AI answered." };
      if (!res.ok && !last.error) last.error = `HTTP ${res.status}`;
    } catch (e: any) {
      last = { error: e?.message || "Network error" };
    }
    if (!last.error || !/high demand|overloaded|unavailable|503|504|429|quota|fetch|network|closed|too long|timed out/i.test(last.error)) return last;
    await new Promise((ok) => setTimeout(ok, 4000 * (i + 1)));
  }
  if (/quota|exceeded|RESOURCE_EXHAUSTED/i.test(last.error || "")) last.error = "Today's free Gemini quota is used up. Turn on billing for the key in Google AI Studio, or try again after it resets (1:30 PM IST).";
  else if (/high demand|overloaded|503/i.test(last.error || "")) last.error = "Google's AI service is busy right now. Please try again in a minute.";
  return last;
}
