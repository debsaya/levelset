import { friendly } from "./guard";
// Long model calls can sit silent for a minute; some networks drop idle connections.
// Stream a space every few seconds, then the JSON. JSON.parse ignores the leading whitespace.
export function heartbeatJson(work: () => Promise<unknown>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode(" "));
      const t = setInterval(() => ctrl.enqueue(enc.encode(" ")), 4000);
      try {
        ctrl.enqueue(enc.encode(JSON.stringify(await work())));
      } catch (e: any) {
        ctrl.enqueue(enc.encode(JSON.stringify({ error: friendly(e?.message || String(e)), status: e?.status || 500 })));
      } finally {
        clearInterval(t);
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** Like heartbeatJson, but the work can send pieces of text on the way. One JSON object per line:
 *  {t:"d",x} a piece of text, {t:"r"} throw away what was shown, {t:"done",...} the result, {t:"err",...} a failure. */
export function ndjsonStream(work: (emit: (e: Record<string, unknown>) => void) => Promise<Record<string, unknown>>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: Record<string, unknown>) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      emit({ t: "hb" });
      const t = setInterval(() => emit({ t: "hb" }), 4000);
      try {
        emit({ t: "done", ...(await work(emit)) });
      } catch (e: any) {
        emit({ t: "err", error: friendly(e?.message || String(e)), status: e?.status || 500 });
      } finally {
        clearInterval(t);
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
