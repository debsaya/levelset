import type { State } from "./store";

export type Blocker = { title: string; text: string; to: "rfx" | "quotes"; cta: string };

/** Why the Read / Compare / Decision steps have nothing to show yet, worked out from what steps 1 and 2 actually hold. Null when there is something to show. */
export function blocker(s: State): Blocker | null {
  const done = s.responses.filter((r) => r.status === "done").length;
  if (done > 0) return null;
  const waiting = s.responses.length;
  if (!s.rfx.lines.length && !waiting) return { title: "There is no request yet", text: "Start in Collect quotes: tell the co-pilot what you are buying, then send the request to vendors.", to: "rfx", cta: "Go to Collect quotes" };
  if (!s.sentAt && !waiting) return { title: "The request has not been sent", text: "Send it to your vendors from Collect quotes. Their replies come back there.", to: "rfx", cta: "Go to Collect quotes" };
  if (!s.sentAt && s.mode === "demo") return { title: "The request has not been sent", text: "Send it to your vendors from Collect quotes. Their replies come back there.", to: "rfx", cta: "Go to Collect quotes" };
  if (!waiting) return { title: "No vendor has replied yet", text: "Replies arrive in Collect quotes. If a vendor sent a quote another way, add it there.", to: "rfx", cta: "Go to Collect quotes" };
  const reading = s.responses.filter((r) => r.status === "reading").length;
  if (reading) return { title: `Reading ${reading} ${reading === 1 ? "quote" : "quotes"}…`, text: "The AI is working through them. This page fills in as each one finishes.", to: "quotes", cta: "Watch it in Read quotes" };
  return { title: `${waiting} ${waiting === 1 ? "quote is" : "quotes are"} waiting to be read`, text: "Read them with the AI first. Then every price shows here.", to: "quotes", cta: "Go to Read quotes" };
}
