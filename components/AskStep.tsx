"use client";
import React, { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { useStore, type AnalystMsg, type Block } from "@/lib/store";
import { buildDb, contextDoc, runQuery, vendorFacts } from "@/lib/db";
import type { Normalized } from "@/lib/normalize";
import { checkGrounding } from "@/lib/grounding";
import { runScenario } from "@/lib/award";
import { postStream } from "@/lib/api";
import { endJob, startJob } from "@/lib/aiActivity";
import { Badge, Button, Card, CopyButton, Dots, Md, cx } from "./ui";

const SUGGESTED = [
  { short: "Who is cheapest, and can I trust it?", q: "Who is cheapest on a like-for-like basis, and how much should I trust that?" },
  { short: "Best split between vendors", q: "What if we split it — cheapest per line, but only among vendors who cleared the quality questionnaire?" },
  { short: "Which numbers are you unsure about?", q: "Which numbers are you unsure about, and what should I ask each vendor?" },
  { short: "Tungabhadra vs last year", q: "How does Tungabhadra's new quote compare to last year's contract, line by line?" },
  { short: "Chart cost by vendor", q: "Chart annual cost by vendor for the lines everyone quoted" },
  { short: "Draft a note for my VP", q: "Draft an award recommendation I can send to my VP" },
];

// Show buyer-friendly words instead of database identifiers.
const WORDS: Record<string, string> = { not_qualified: "Not approved", qualified: "Approved", conditional: "Needs proof", qualified_or_conditional: "Approved or needs proof", needs_review: "Needs review", ok: "OK", missing: "No price", deviation: "Different spec" };
function plain(t: string) {
  return t.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (m) => (WORDS[m] ? WORDS[m].toLowerCase() : m.replace(/_/g, " ")));
}
function niceHeader(c: string) {
  if (!/^[a-z0-9_]+$/.test(c)) return c;
  let h = c.replace(/_inr$/, " (₹)").replace(/_/g, " ");
  h = h.replace(/\bid\b/g, "ID").replace(/\bqty\b/g, "quantity");
  return h.charAt(0).toUpperCase() + h.slice(1);
}
function niceCell(v: any) {
  return typeof v === "string" && WORDS[v] ? WORDS[v] : v;
}

const COLORS = ["#2f5bea", "#12a07a", "#e08a00", "#c2417a", "#6b5bd6", "#3b8fbf"];

export type Suggestion = { short: string; q: string };

/** Full page by default; `compact` is the narrow side-drawer version, with its own suggested questions. */
export default function AskStep({ n, initialAsk, compact = false, suggested }: { n: Normalized; initialAsk?: string; compact?: boolean; suggested?: Suggestion[] }) {
  const SUG = suggested && suggested.length ? suggested : SUGGESTED;
  const { s, set } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  // the answer as it is being written, and the tables and charts already built for it
  const [draft, setDraft] = useState("");
  const [liveBlocks, setLiveBlocks] = useState<Block[]>([]);
  const [showPrev, setShowPrev] = useState(false);
  const archive = s.analystArchive || [];
  const snapshot = (x: typeof s) => (x.analyst.length ? [{ id: String(Date.now()), at: new Date().toISOString(), title: (x.analyst.find((m) => m.role === "user") as any)?.text || "Chat", analyst: x.analyst, analystHistory: x.analystHistory }] : []);
  function startNew() {
    set((x) => ({ ...x, analystArchive: [...snapshot(x), ...(x.analystArchive || [])].slice(0, 8), analyst: [], analystHistory: [] }));
    setShowPrev(false);
  }
  function openChat(id: string) {
    set((x) => {
      const c = (x.analystArchive || []).find((a) => a.id === id);
      if (!c) return x;
      return { ...x, analyst: c.analyst, analystHistory: c.analystHistory, analystArchive: [...snapshot(x), ...(x.analystArchive || []).filter((a) => a.id !== id)].slice(0, 8) };
    });
    setShowPrev(false);
  }
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
  }, [s.analyst.length, live.length, liveBlocks.length, draft.length > 0]);

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
    const scTotals: number[] = [];
    const collect = (rows: any[][]) => rows.forEach((r) => r.forEach((v) => typeof v === "number" && nums.push(v)));
    let finalText = "";
    let model = "";
    let error: string | undefined;
    const job = startJob("analyst", "Ask AI"); // one job for the whole question, however many lookups it takes
    try {
      for (let step = 0; step < 10; step++) {
        setDraft("");
        const j = await postStream("/api/analyst", { contents: history, context: contextDoc(s.assumptions, n), facts: vendorFacts(n, s.assumptions), stream: true }, (d) => setDraft((t) => t + d), () => setDraft(""));
        if (j.error) throw new Error(j.error);
        model = j.model;
        history.push(j.content);
        const calls = (j.content.parts || []).filter((p: any) => p.functionCall);
        if (calls.length) setDraft(""); // a lookup is next: whatever was said before it is not the answer
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
            const label = `${(args?.strategy || "cheapest_per_line") === "single_vendor" ? "Single vendor" : "Cheapest per line"} · ${({ qualified: "approved vendors", qualified_or_conditional: "approved + needs-proof vendors", all: "all vendors" } as Record<string, string>)[args?.eligibility || "qualified"] || "approved vendors"}${args?.count_conditional_rebates ? " · rebates counted" : ""}`;
            blocks.push({ kind: "table", title: `Award scenario: ${label}`, sql: `award_scenario(${JSON.stringify(args || {})})`, columns: ["Vendor", "Items won", "Annual value (₹)"], rows: [...sc.by_vendor.map((v) => [v.vendor, v.lines, v.annual_value_inr]), ["Total", sc.lines_awarded, sc.total_annual_value_inr]], note: [sc.lines_without_eligible_price.length ? `No eligible price for ${sc.lines_without_eligible_price.join(", ")}.` : "", sc.unverified_prices_in_award ? `${sc.unverified_prices_in_award} winning prices still need the buyer's check.` : "", sc.vendors_excluded.length ? `Excluded: ${sc.vendors_excluded.map((x) => x.vendor.split(" ")[0] + " (" + ({ not_qualified: "not approved", conditional: "needs proof", qualified: "approved" } as Record<string, string>)[x.qualification] + ")").join(", ")}.` : ""].filter(Boolean).join(" ") });
            scTotals.push(sc.total_annual_value_inr);
            nums.push(sc.total_annual_value_inr, sc.lines_awarded, sc.unverified_prices_in_award, sc.prices_read_from_photos, ...sc.by_vendor.flatMap((v) => [v.lines, v.annual_value_inr]));
            collect(sc.rows.map((r) => [r.unit_price_inr, r.annual_value_inr]));
            trace.push({ tool: name, sql: JSON.stringify(args || {}), rows: sc.rows.length });
            setLive((l) => [...l, `Working out the award options (${label})`]);
            const { rows: _rows, ...summary } = sc;
            responses.push({ functionResponse: { name, response: { ...summary, line_table: tname, note: `Line-level winners are in SQLite table ${tname}(line_id, vendor_id, vendor_name, unit_price_inr, annual_value_inr, status). A summary table was already shown to the buyer.` } } });
            continue;
          }
          const r = runQuery(db, args.sql || "");
          trace.push({ tool: name, sql: args.sql, rows: r.rows.length, error: r.error });
          setLive((l) => [...l, r.error ? "Double-checking the data…" : name === "run_sql" ? "Looking up the numbers" : name === "show_table" ? `Preparing a table${args.title ? `: ${args.title}` : ""}` : `Drawing a chart${args.title ? `: ${args.title}` : ""}`]);
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
        setLiveBlocks([...blocks]);
      }
      if (!finalText) finalText = "I ran out of steps before finishing. Try narrowing the question.";
    } catch (e: any) {
      error = e.message;
    }
    endJob(job, !error, { model });
    // a saving is the difference between two scenario totals the buyer was shown
    for (let i = 0; i < scTotals.length; i++) for (let j = i + 1; j < scTotals.length; j++) nums.push(Math.abs(scTotals[i] - scTotals[j]));
    // figures the analyst was given as context (FX, freight, terms) also count as traceable
    for (const m of (contextDoc(s.assumptions, n) + vendorFacts(n, s.assumptions)).matchAll(/\d[\d,]*\.?\d*/g)) nums.push(parseFloat(m[0].replace(/,/g, "")));
    const grounding = finalText ? checkGrounding(finalText, nums) : undefined;
    const msg: AnalystMsg = { role: "assistant", text: finalText, blocks, trace, grounding, model, error };
    // keep history bounded: last 24 contents, starting on a user text turn
    let h = history.slice(-24);
    while (h.length && !(h[0].role === "user" && h[0].parts?.[0]?.text)) h = h.slice(1);
    set((x) => ({ ...x, analyst: [...x.analyst, msg], analystHistory: error ? x.analystHistory : h }));
    setBusy(false);
    setLive([]);
    setDraft("");
    setLiveBlocks([]);
  }

  return (
    <div className={cx("flex h-full min-h-0 flex-col", compact ? "p-0" : "p-4")}>
      <Card className={cx("flex min-h-0 flex-1 flex-col", compact && "rounded-none border-0")}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            {!compact && <div className="font-semibold">Ask the comparison</div>}
            <div className="text-xs text-muted">Ask in plain English. Answers come from your comparison data, and every number is checked against it.</div>
          </div>
          <div className="relative flex gap-1">
            {archive.length > 0 && (
              <Button variant="ghost" disabled={busy} onClick={() => setShowPrev(!showPrev)}>
                History ({archive.length})
              </Button>
            )}
            {s.analyst.length > 0 && (
              <Button variant="ghost" disabled={busy} onClick={startNew}>
                New conversation
              </Button>
            )}
            {showPrev && (
              <div className="absolute right-0 top-9 z-10 w-80 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
                {archive.map((a) => (
                  <button key={a.id} onClick={() => openChat(a.id)} className="block w-full border-b border-line px-3 py-2 text-left text-[12.5px] last:border-0 hover:bg-panel">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="text-[11px] text-muted">
                      {new Date(a.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {a.analyst.filter((m) => m.role === "user").length} questions
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {!s.analyst.length && (
            <div className={cx("mx-auto space-y-3", compact ? "pt-2" : "max-w-2xl pt-6")}>
              <div className="text-center text-muted">Try one of these, or ask your own.</div>
              <div className={cx("grid gap-2", compact ? "grid-cols-1" : "grid-cols-2")}>
                {SUG.map((x) => (
                  <button key={x.q} onClick={() => ask(x.q)} className="rounded-lg border border-line p-3 text-left text-[13px] hover:bg-panel">
                    {x.q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {s.analyst.map((m, i) => (m.role === "user" ? <div key={i} className="lv-rise ml-auto max-w-2xl rounded-lg bg-brand px-4 py-2 text-[13.5px] text-white">{m.text}</div> : <Answer key={i} m={m} />))}
          {busy && liveBlocks.length > 0 && (
            <div className="max-w-4xl space-y-3">
              {liveBlocks.map((b, i) => (b.kind === "table" ? <TableBlock key={i} b={b} /> : <ChartBlock key={i} b={b} />))}
            </div>
          )}
          {busy && draft && (
            <div className="max-w-4xl text-[13.5px] leading-relaxed">
              <Md text={plain(draft)} />
            </div>
          )}
          {busy && (
            <div className="space-y-1 text-[12.5px] text-muted">
              <div className="flex items-center gap-2">
                <Dots /> {draft ? "Checking the numbers…" : "Thinking…"}
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
              {SUG.slice(0, 4).map((x) => (
                <button key={x.q} disabled={busy} onClick={() => ask(x.q)} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted hover:bg-panel">
                  {x.short}
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
          <Md text={plain(m.text)} mark={mark} />
        </div>
      )}
      {m.grounding &&
        (m.grounding.ungrounded.length ? (
          <Badge tone="warn" title="The AI wrote this number from memory or worked it out itself. It is not in anything it looked up in your data this turn, so it may be right but has not been checked. Verify it before you use it.">
            Underlined number{m.grounding.ungrounded.length > 1 ? "s were" : " was"} not looked up in your data: check {m.grounding.ungrounded.length > 1 ? "them" : "it"}
          </Badge>
        ) : m.grounding.checked ? (
          <Badge tone="good">✓ Numbers checked against your data</Badge>
        ) : null)}
      {m.blocks.map((b, i) => (b.kind === "table" ? <TableBlock key={i} b={b} /> : <ChartBlock key={i} b={b} />))}
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        {m.trace.length > 0 && (
          <button className="inline-flex items-center rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink transition hover:border-[#cfd3da] hover:bg-panel" onClick={() => setShowSql(!showSql)}>
            {showSql ? "Hide steps" : "Show steps"}
          </button>
        )}
        {m.text && (
          <CopyButton link text={() => plain(m.text)} label="Copy" />
        )}
      </div>
      {showSql && (
        <div className="space-y-2">
          {m.model && <div className="text-[11.5px] text-muted">Answered by {m.model} · {m.trace.length} steps</div>}
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
        <div className="text-[13px] font-semibold">
          {b.title} {b.rows.length > 8 && <span className="ml-1 font-normal text-muted">· {b.rows.length} rows</span>}
        </div>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-[12.5px] tabular">
          <thead className="sticky top-0 bg-panel text-left text-[11px] text-muted">
            <tr>
              {b.columns.map((c) => (
                <th key={c} className="px-3 py-1.5">
                  {niceHeader(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((v, j) => (
                  <td key={j} className={cx("px-3 py-1", typeof v === "number" && "text-right")}>
                    {fmt(niceCell(v))}
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
