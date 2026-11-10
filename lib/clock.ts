/** The sample event has fixed dates (replies on 12 to 18 Nov, due 18 Nov). Its clock is pinned to the day the request went out,
 *  so the page never turns into "past due" with chase emails when someone opens the demo later. A request you start yourself uses the real clock. */
export const SAMPLE_NOW = new Date("2026-11-12T12:00:00+05:30");
export function appNow(mode: "demo" | "blank"): Date {
  return mode === "demo" ? SAMPLE_NOW : new Date();
}
