"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { applyOps } from "@/lib/rfxOps";
import { postJson } from "@/lib/api";
import { Badge, Button, Card, Md, Spinner, cx } from "./ui";

const SUGGESTIONS = [
  "Add a 2-colour die-cut tray 300×220×50 for the new cookie SKU, ~80k a year",
  "Make FSC certification a must-have and tell me who that might exclude",
  "Ask vendors to quote a separate price for printing plates and dies",
  "Cut volumes on all 7-ply lines by 20%",
];

export default function RfxStep({ onNext }: { onNext: () => void }) {
  const { s, set, log } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"lines" | "questionnaire" | "terms">("lines");
  const [flash, setFlash] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [s.copilot.length, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const msgs = [...s.copilot, { role: "user" as const, text }];
    set((x) => ({ ...x, copilot: msgs }));
    setInput("");
    setBusy(true);
    try {
      const j = await postJson("/api/copilot", { messages: msgs.slice(1), rfx: s.rfx });
      if (j.error) throw new Error(j.error);
      const before = new Set(s.rfx.lines.map((l) => JSON.stringify(l)));
      const { rfx, notes } = applyOps(s.rfx, j.ops || []);
      setFlash(rfx.lines.filter((l) => !before.has(JSON.stringify(l))).map((l) => l.id));
      set((x) => ({ ...x, rfx, copilot: [...msgs, { role: "assistant", text: j.reply, ops: notes }] }));
      if (notes.length) log(`Co-pilot edited RFx: ${notes.length} change(s)`);
    } catch (e: any) {
      set((x) => ({ ...x, copilot: [...msgs, { role: "assistant", text: `⚠️ ${e.message}` }] }));
    } finally {
      setBusy(false);
    }
  }

  const r = s.rfx;
  const tonnes = r.lines.reduce((a, l) => a + l.annual_qty * l.est_weight_kg, 0) / 1000;
  return (
    <div className="grid h-full grid-cols-[minmax(340px,420px)_1fr] gap-4 p-4">
      <Card className="flex min-h-0 flex-col">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">RFx co-pilot</div>
          <div className="text-xs text-muted">Talk the RFx into shape. Every edit shows up on the right with a reason.</div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {s.copilot.map((m, i) => (
            <div key={i} className={cx("rounded-lg px-3 py-2 text-[13px] leading-relaxed", m.role === "user" ? "ml-8 bg-brand text-white" : "mr-4 bg-panel")}>
              <Md text={m.text} />
              {m.ops && m.ops.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-line pt-2">
                  {m.ops.map((o, j) => (
                    <div key={j} className="text-[11.5px] text-muted">✎ {o}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Spinner /> drafting…
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-line p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((q) => (
              <button key={q} onClick={() => send(q)} disabled={busy} className="rounded-full border border-line px-2 py-0.5 text-[11.5px] text-muted hover:bg-panel">
                {q}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. add a die-cut tray for the new cookie SKU…" className="flex-1 rounded-md border border-line px-3 py-2 text-[13px] outline-none focus:border-kraft" />
            <Button variant="primary" disabled={busy || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col">
        <div className="flex items-start justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-xs text-muted">{r.id} · due {r.due_date}</div>
            <div className="text-[15px] font-semibold">{r.title}</div>
            <div className="mt-1 max-w-3xl text-xs text-muted">{r.scope}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-1.5">
              <Badge>{r.lines.length} lines</Badge>
              <Badge>{tonnes.toFixed(0)} t/yr est.</Badge>
              <Badge>{r.questionnaire.length} questions · {r.questionnaire.filter((q) => q.must_have).length} must-have</Badge>
            </div>
            <Button variant="primary" onClick={onNext} disabled={!r.lines.length}>
              Review &amp; send →
            </Button>
          </div>
        </div>
        <div className="flex gap-4 border-b border-line px-4 text-[13px]">
          {(["lines", "questionnaire", "terms"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx("border-b-2 py-2 capitalize", tab === t ? "border-brand font-medium text-ink" : "border-transparent text-muted")}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          {tab === "lines" && (
            <table className="w-full text-[12.5px] tabular">
              <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Spec</th>
                  <th className="px-3 py-2">Board</th>
                  <th className="px-3 py-2">End use</th>
                  <th className="px-3 py-2 text-right">Annual qty</th>
                  <th className="px-3 py-2 text-right" title="Computed by code from dimensions and board GSM. Used to convert per-kg quotes.">
                    Est. kg / pc ⓘ
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id} className={cx("border-t border-line", flash.includes(l.id) && "bg-kraft-soft")}>
                    <td className="px-3 py-1.5 font-medium">
                      {l.id} {l.is_new && <Badge tone="brand">new</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">{l.description}</td>
                    <td className="px-3 py-1.5 text-[11.5px] text-muted">
                      {l.board_gsm} · {l.bursting_factor}
                    </td>
                    <td className="px-3 py-1.5 text-muted">{l.end_use}</td>
                    <td className="px-3 py-1.5 text-right">
                      {l.annual_qty.toLocaleString("en-IN")} {l.uom === "set" ? "sets" : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right">{l.est_weight_kg.toFixed(3)}</td>
                  </tr>
                ))}
                {!r.lines.length && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted">
                      No lines yet. Describe what you're buying in the co-pilot.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {tab === "questionnaire" && (
            <div className="divide-y divide-line">
              {r.questionnaire.map((q) => (
                <div key={q.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                  <span className="w-8 font-medium">{q.id}</span>
                  <span className="flex-1">{q.text}</span>
                  <Badge>{q.kind.replace("_", "/")}</Badge>
                  {q.must_have ? <Badge tone="bad">must-have</Badge> : <Badge>scored</Badge>}
                </div>
              ))}
              <div className="px-4 py-3 text-xs text-muted">Must-haves decide qualification: fail one and the vendor is out; partly meet one and they stay in as &quot;conditional&quot; until the buyer decides.</div>
            </div>
          )}
          {tab === "terms" && (
            <div className="divide-y divide-line">
              {Object.entries(r.terms).map(([k, v]) => (
                <div key={k} className="flex gap-3 px-4 py-2.5 text-[13px]">
                  <span className="w-36 font-medium capitalize">{k.replace(/_/g, " ")}</span>
                  <span className="flex-1">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
