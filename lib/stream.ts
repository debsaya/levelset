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
        ctrl.enqueue(enc.encode(JSON.stringify({ error: e?.message || String(e), status: e?.status || 500 })));
      } finally {
        clearInterval(t);
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
