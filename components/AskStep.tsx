"use client";
import React, { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { useStore, type AnalystMsg, type Block } from "@/lib/store";
import { buildDb, contextDoc, runQuery, vendorFacts } from "@/lib/db";
import type { Normalized } from "@/lib/normalize";
import { checkGrounding } from "@/lib/grounding";
import { runScenario } from "@/lib/award";
import { downloadTable } from "@/lib/export";
import { Badge, Button, Card, Md, Spinner, cx } from "./ui";

const SUGGESTED = [
  "Who is cheapest on a like-for-like basis, and how much should I trust that?",
  "What if we split it — cheapest per line, but only among vendors who cleared the quality questionnaire?",
  "Which numbers are you unsure about, and what should I ask each vendor?",
  "How does Tungabhadra's new quote compare to last year's contract, line by line?",
  "Chart annual cost by vendor for the lines everyone quoted",
  "Draft an award recommendation I can send to my VP",
];

const COLORS = ["#2f5bea", "#12a07a", "#e08a00", "#c2417a", "#6b5bd6", "#3b8fbf"];

export default function AskStep({ n, initialAsk }: { n: Normalized; initialAsk?: string }) {
  const { s, set } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  const dbRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    buildDb(s.rfx, n, s.responses, s.prior).then((db) => {
      if (alive) {
        dbRef.current?.close?.();
        dbRef.current = db;
      }
    });
    return () => {
      alive = false;
    };
  }, [n, s.rfx, s.responses, s.prior]);
  const asked = useRef(false);
  useEffect(() => {
    if (initialAsk && !asked.current) {
      asked.current = true;
      setTimeout(() => ask(initialAsk), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAsk]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [s.analyst.length, live.length]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setInput("");
    setBusy(true);
    setLive([]);
    const userMsg: AnalystMsg = { role: "user", text: q };
    set((x) => ({ ...x, analyst: [...x.analyst, userMsg] }));
    for (let i = 0; i < 40 && !dbRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    const db = dbRef.current;
    let history: any[] = [...s.analystHistory, { role: "user", parts: [{ text: q }] }];
    const blocks: Block[] = [];
    const trace: { tool: string; sql: string; rows?: number; error?: string }[] = [];
    const nums: number[] = [];
    const collect = (rows: any[][]) => rows.forEach((r) => r.forEach((v) => typeof v === "number" && nums.push(v)));
    let finalText = "";
    let model = "";
    let error: string | undefined;
    try {
      for (let step = 0; step < 10; step++) {
        const res = await fetch("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: history, context: contextDoc(s.assumptions, n), facts: vendorFacts(n, s.assumptions) }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Analyst failed");
        model = j.model;
        history.push(j.content);
        const calls = (j.content.parts || []).filter((p: any) => p.functionCall);
        if (!calls.length) {
          finalText = (j.content.parts || []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("");
          break;
        }
        const responses: any[] = [];
        for (const p of calls) {
          const { name, args } = p.functionCall;
          if (name === "award_scenario") {
            const sc = runScenario(s.rfx, n, args || {});
            const tname = `scenario_${trace.length + 1}`;
            try {
              db.run(`CREATE TABLE ${tname}(line_id TEXT, vendor_id TEXT, vendor_name TEXT, unit_price_inr REAL, annual_value_inr REAL, status TEXT)`);
              const st = db.prepare(`INSERT INTO ${tname} VALUES (?,?,?,?,?,?)`);
              for (const r of sc.rows) st.run([r.line_id, r.vendor_id, r.vendor_name, r.unit_price_inr, r.annual_value_inr, r.status]);
              st.free();
            } catch {}
            const label = `${(args?.strategy || "cheapest_per_line") === "single_vendor" ? "Single vendor" : "Cheapest per line"} · ${(args?.eligibility || "qualified").replace(/_/g, " ")}${args?.count_conditional_rebates ? " · rebates counted" : ""}`;
            blocks.push({ kind: "table", title: `Award scenario: ${label}`, sql: `award_scenario(${JSON.stringify(args || {})})`, columns: ["Vendor", "Items won", "Annual value (₹)"], rows: [...sc.by_vendor.map((v) => [v.vendor, v.lines, v.annual_value_inr]), ["Total", sc.lines_awarded, sc.total_annual_value_inr]], note: [sc.lines_without_eligible_price.length ? `No eligible price for ${sc.lines_without_eligible_price.join(", ")}.` : "", sc.unverified_prices_in_award ? `${sc.unverified_prices_in_award} winning prices still need the buyer's check.` : "", sc.vendors_excluded.length ? `Excluded: ${sc.vendors_excluded.map((x) => x.vendor.split(" ")[0] + " (" + x.qualification.replace("_", " ") + ")").join(", ")}.` : ""].filter(Boolean).join(" ") });
            nums.push(sc.total_annual_value_inr, sc.lines_awarded, sc.unverified_prices_in_award, ...sc.by_vendor.flatMap((v) => [v.lines, v.annual_value_inr]));
            collect(sc.rows.map((r) => [r.unit_price_inr, r.annual_value_inr]));
            trace.push({ tool: name, sql: JSON.stringify(args || {}), rows: sc.rows.length });
            setLive((l) => [...l, `Running award scenario: ${label}`]);
            const { rows: _rows, ...summary } = sc;
            responses.push({ functionResponse: { name, response: { ...summary, line_table: tname, note: `Line-level winners are in SQLite table ${tname}(line_id, vendor_id, vendor_name, unit_price_inr, annual_value_inr, status). A summary table was already shown to the buyer.` } } });
            continue;
          }
          const r = runQuery(db, args.sql || "");
          trace.push({ tool: name, sql: args.sql, rows: r.rows.length, error: r.error });
          setLive((l) => [...l, `${name === "run_sql" ? "Querying" : name === "show_table" ? "Building table" : "Drawing chart"}${args.title ? `: ${args.title}` : ""}${r.error ? " — error, retrying" : ` (${r.rows.length} rows)`}`]);
          if (!r.error) collect(r.rows);
          if (name === "show_table" && !r.error) blocks.push({ kind: "table", title: args.title, note: args.note, sql: args.sql, columns: r.columns, rows: r.rows });
          if (name === "show_chart" && !r.error) blocks.push({ kind: "chart", title: args.title, chart_type: args.chart_type, x: args.x, y: args.y || [], y_label: args.y_label, sql: args.sql, columns: r.columns, rows: r.rows });
          const preview = r.rows.slice(0, name === "run_sql" ? 100 : 40);
          responses.push({
            functionResponse: {
              name,
              response: r.error ? { error: r.error, hint: "Fix the SQL (SQLite dialect) and try again." } : { columns: r.columns, rows: preview, row_count: r.rows.length, ...(name !== "run_sql" ? { shown_to_buyer: true } : {}) },
            },
          });
        }
        history.push({ role: "user", parts: responses });
      }
      if (!finalText) finalText = "I ran out of steps before finishing. Try narrowing the question.";
    } catch (e: any) {
      error = e.message;
    }
    const grounding = finalText ? checkGrounding(finalText, nums) : undefined;
    const msg: AnalystMsg = { role: "assistant", text: finalText, blocks, trace, grounding, model, error };
    // keep history bounded: last 24 contents, starting on a user text turn
    let h = history.slice(-24);
    while (h.length && !(h[0].role === "user" && h[0].parts?.[0]?.text)) h = h.slice(1);
    set((x) => ({ ...x, analyst: [...x.analyst, msg], analystHistory: error ? x.analystHistory : h }));
    setBusy(false);
    setLive([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="font-semibold">Ask the comparison</div>
            <div className="text-xs text-muted">The analyst writes SQL over the normalised data. Tables and charts come straight from query results; figures in its prose are checked against them.</div>
          </div>
          {s.analyst.length > 0 && (
            <Button variant="ghost" onClick={() => set((x) => ({ ...x, analyst: [], analystHistory: [] }))}>
              New conversation
            </Button>
          )}
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {!s.analyst.length && (
            <div className="mx-auto max-w-2xl space-y-3 pt-6">
              <div className="text-center text-muted">Try one of these, or ask your own.</div>
              <div className="grid grid-cols-2 gap-2">
                {SUGGESTED.map((q) => (
                  <button key={q} onClick={() => ask(q)} className="rounded-lg border border-line p-3 text-left text-[13px] hover:bg-panel">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {s.analyst.map((m, i) => (m.role === "user" ? <div key={i} className="ml-auto max-w-2xl rounded-lg bg-brand px-4 py-2 text-[13.5px] text-white">{m.text}</div> : <Answer key={i} m={m} />))}
          {busy && (
            <div className="space-y-1 text-[12.5px] text-muted">
              <div className="flex items-center gap-2">
                <Spinner /> Thinking…
              </div>
              {live.map((l, i) => (
                <div key={i} className="pl-6">
                  ↳ {l}
                </div>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-line p-3">
          {s.analyst.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SUGGESTED.map((q) => (
                <button key={q} disabled={busy} onClick={() => ask(q)} className="rounded-full border border-line px-2 py-0.5 text-[11.5px] text-muted hover:bg-panel">
                  {q.length > 60 ? q.slice(0, 58) + "…" : q}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex gap-2"
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything about the bids…" className="flex-1 rounded-md border border-line px-3 py-2 outline-none focus:border-kraft" />
            <Button variant="primary" disabled={busy || !input.trim()}>
              Ask
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}

function Answer({ m }: { m: Extract<AnalystMsg, { role: "assistant" }> }) {
  const [showSql, setShowSql] = useState(false);
  const ung = m.grounding?.ungrounded || [];
  const mark = ung.length
    ? (t: string) => {
        const parts: React.ReactNode[] = [];
        let rest = t;
        let k = 0;
        while (rest) {
          let idx = -1,
            hit = "";
          for (const u of ung) {
            const j = rest.indexOf(u);
            if (j >= 0 && (idx < 0 || j < idx)) {
              idx = j;
              hit = u;
            }
          }
          if (idx < 0) {
            parts.push(rest);
            break;
          }
          parts.push(rest.slice(0, idx));
          parts.push(
            <span key={k++} className="ungrounded" title="This figure doesn't match any query result in this answer. Treat it with care.">
              {hit}
            </span>
          );
          rest = rest.slice(idx + hit.length);
        }
        return <>{parts}</>;
      }
    : undefined;
  return (
    <div className="max-w-4xl space-y-3">
      {m.error && <div className="rounded-md bg-bad-soft p-3 text-[13px] text-bad">⚠ {m.error}</div>}
      {m.text && (
        <div className="text-[13.5px] leading-relaxed">
          <Md text={m.text} mark={mark} />
        </div>
      )}
      {m.blocks.map((b, i) => (b.kind === "table" ? <TableBlock key={i} b={b} /> : <ChartBlock key={i} b={b} />))}
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        {m.grounding &&
          (m.grounding.ungrounded.length ? (
            <Badge tone="warn" title="Highlighted figures could not be matched to any query result in this answer.">
              {m.grounding.ungrounded.length} of {m.grounding.checked} figures not traced to data
            </Badge>
          ) : m.grounding.checked ? (
            <Badge tone="good">✓ all {m.grounding.checked} figures trace to query results</Badge>
          ) : null)}
        {m.trace.length > 0 && (
          <button className="text-kraft" onClick={() => setShowSql(!showSql)}>
            {showSql ? "Hide" : "Show"} {m.trace.length} queries
          </button>
        )}
        {m.text && (
          <button className="text-kraft" onClick={() => navigator.clipboard.writeText(m.text)}>
            Copy text
          </button>
        )}
        {m.model && <span>· {m.model}</span>}
      </div>
      {showSql && (
        <div className="space-y-2">
          {m.trace.map((t, i) => (
            <div key={i} className="rounded border border-line bg-panel p-2 font-mono text-[11px]">
              <div className="mb-1 font-sans text-muted">
                {t.tool} · {t.error ? <span className="text-bad">{t.error}</span> : `${t.rows} rows`}
              </div>
              <pre className="whitespace-pre-wrap">{t.sql}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(v: any) {
  if (typeof v !== "number") return v ?? "";
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function TableBlock({ b }: { b: Extract<Block, { kind: "table" }> }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="text-[13px] font-semibold">{b.title}</div>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => downloadTable(b.title.replace(/[^\w]+/g, "_"), b.columns, b.rows, "csv")}>
            CSV
          </Button>
          <Button variant="ghost" onClick={() => downloadTable(b.title.replace(/[^\w]+/g, "_"), b.columns, b.rows, "xlsx")}>
            XLSX
          </Button>
        </div>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-[12.5px] tabular">
          <thead className="sticky top-0 bg-panel text-left text-[11px] text-muted">
            <tr>
              {b.columns.map((c) => (
                <th key={c} className="px-3 py-1.5">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((v, j) => (
                  <td key={j} className={cx("px-3 py-1", typeof v === "number" && "text-right")}>
                    {fmt(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {b.note && <div className="border-t border-line bg-panel px-3 py-1.5 text-[11.5px] text-muted">{b.note}</div>}
    </Card>
  );
}

function ChartBlock({ b }: { b: Extract<Block, { kind: "chart" }> }) {
  const data = b.rows.map((r) => Object.fromEntries(b.columns.map((c, i) => [c, r[i]])));
  const ys = b.y.filter((y) => b.columns.includes(y));
  const x = b.columns.includes(b.x) ? b.x : b.columns[0];
  const tick = (v: any) => (typeof v === "number" ? (Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : fmt(v)) : v);
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{b.title}</div>
        <Button variant="ghost" onClick={() => downloadTable(b.title.replace(/[^\w]+/g, "_"), b.columns, b.rows, "xlsx")}>
          Data XLSX
        </Button>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {b.chart_type === "line" ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
              <XAxis dataKey={x} fontSize={11} />
              <YAxis fontSize={11} tickFormatter={tick} label={b.y_label ? { value: b.y_label, angle: -90, position: "insideLeft", fontSize: 11 } : undefined} />
              <Tooltip formatter={(v: any) => fmt(v)} />
              <Legend />
              {ys.map((y, i) => (
                <Line key={y} dataKey={y} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          ) : b.chart_type === "scatter" ? (
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
              <XAxis dataKey={x} type="number" fontSize={11} name={x} />
              <YAxis dataKey={ys[0]} fontSize={11} name={ys[0]} tickFormatter={tick} />
              <Tooltip formatter={(v: any) => fmt(v)} />
              <Scatter data={data} fill={COLORS[0]} />
            </ScatterChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} />
              <XAxis dataKey={x} fontSize={11} interval={0} angle={data.length > 6 ? -30 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 70 : 30} />
              <YAxis fontSize={11} tickFormatter={tick} label={b.y_label ? { value: b.y_label, angle: -90, position: "insideLeft", fontSize: 11 } : undefined} />
              <Tooltip formatter={(v: any) => fmt(v)} />
              {ys.length > 1 && <Legend />}
              {ys.map((y, i) => (
                <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} stackId={b.chart_type === "stacked_bar" ? "a" : undefined} radius={b.chart_type === "stacked_bar" ? 0 : [3, 3, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
