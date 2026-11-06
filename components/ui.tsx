"use client";
import React, { useState } from "react";
import { copyText } from "@/lib/copy";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({ variant = "default", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "primary" && "bg-ink text-white hover:bg-black shadow-sm",
        variant === "default" && "border border-line bg-white hover:border-[#cfd3da] hover:bg-panel",
        variant === "ghost" && "hover:bg-panel text-muted",
        variant === "danger" && "border border-bad/30 text-bad bg-white hover:bg-bad-soft",
        className
      )}
    />
  );
}

export function Badge({ tone = "neutral", children, className, title }: { tone?: "neutral" | "good" | "warn" | "bad" | "brand"; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-panel text-muted",
        tone === "good" && "bg-good-soft text-good",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
        tone === "brand" && "bg-kraft-soft text-kraft",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-line bg-white", className)}>{children}</div>;
}

/** Three quiet dots, for "the AI is working on it". */
export function Dots() {
  return (
    <span className="lv-dots inline-flex items-center" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

function inline(s: string, key: string, mark?: (t: string) => React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  const push = (t: string) => out.push(mark ? <React.Fragment key={key + "t" + i++}>{mark(t)}</React.Fragment> : t);
  while ((m = re.exec(s))) {
    if (m.index > last) push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={key + i++}>{mark ? mark(t.slice(2, -2)) : t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={key + i++}>{t.slice(1, -1)}</code>);
    else out.push(<em key={key + i++}>{mark ? mark(t.slice(1, -1)) : t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) push(s.slice(last));
  return out;
}

/** Minimal markdown: paragraphs, bullets, numbered lists, ### headings, bold/italic/code. */
export function Md({ text, mark }: { text: string; mark?: (t: string) => React.ReactNode }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list;
    blocks.push(
      L.ordered ? (
        <ol key={blocks.length}>{L.items.map((t, i) => <li key={i}>{inline(t, `${blocks.length}-${i}`, mark)}</li>)}</ol>
      ) : (
        <ul key={blocks.length}>{L.items.map((t, i) => <li key={i}>{inline(t, `${blocks.length}-${i}`, mark)}</li>)}</ul>
      )
    );
    list = null;
  };
  let table: string[][] | null = null;
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    blocks.push(
      <div key={blocks.length} className="my-2 overflow-x-auto">
        <table className="text-[12.5px] tabular">
          <thead>
            <tr>{head.map((h, i) => <th key={i} className="border-b border-line px-2 py-1 text-left font-medium text-muted">{inline(h, `th${i}`, mark)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-line px-2 py-1">{inline(c, `td${i}-${j}`, mark)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    table = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flush();
      const cells = l.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      (table ||= []).push(cells);
      continue;
    }
    flushTable();
    const b = l.match(/^\s*[-*•]\s+(.*)/);
    const n = l.match(/^\s*\d+[.)]\s+(.*)/);
    if (b || n) {
      const ordered = !!n;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((b || n)![1]);
      continue;
    }
    flush();
    if (!l.trim()) continue;
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) blocks.push(<h3 key={blocks.length}>{inline(h[1], String(blocks.length), mark)}</h3>);
    else blocks.push(<p key={blocks.length}>{inline(l, String(blocks.length), mark)}</p>);
  }
  flush();
  flushTable();
  return <div className="md">{blocks}</div>;
}

export function fileToB64(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function mimeFor(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".csv")) return "text/csv";
  return "text/plain";
}

/** A section that stays closed until asked: title and a one-line summary are always visible, the detail is one click away. */
export function Disclosure({ title, summary, defaultOpen = false, children }: { title: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-line bg-white">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3.5 text-left">
        <span className={cx("grid h-5 w-5 shrink-0 place-items-center text-[11px] text-muted transition-transform", open && "rotate-90")}>▶</span>
        <span className="text-[14.5px] font-semibold">{title}</span>
        {summary && <span className="ml-auto text-[12.5px] text-muted">{summary}</span>}
      </button>
      {open && <div className="border-t border-line">{children}</div>}
    </section>
  );
}

/** The three-dots menu: quiet until needed. Each item can carry a one-line hint saying what it does. */
export function MoreMenu({ items, title = "More actions" }: { items: { label: string; hint?: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]; title?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative inline-block" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape" && open) setOpen(false); e.stopPropagation(); }}>
      <button aria-label={title} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={cx("grid h-7 w-7 place-items-center rounded-md text-[16px] leading-none text-muted hover:bg-panel hover:text-ink", open && "bg-panel text-ink")}>
        ⋯
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-8 z-50 w-64 rounded-xl border border-line bg-white p-1 text-left text-[13px] shadow-lg">
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={cx("block w-full rounded-lg px-3 py-2 text-left hover:bg-panel disabled:opacity-40", it.danger && "text-bad")}
              >
                <div className="font-medium">{it.label}</div>
                {it.hint && <div className="text-[11.5px] font-normal text-muted">{it.hint}</div>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** Shown on a step that has nothing to show yet: says why, in terms of the earlier steps, and offers the way forward. */
export function Blocked({ b, go, bare = false }: { b: { title: string; text: string; to: "rfx" | "quotes"; cta: string }; go: (p: "rfx" | "quotes") => void; bare?: boolean }) {
  const card = (
    <div className="rounded-2xl border border-line bg-white p-8 text-center">
      <div className="text-[20px] font-semibold tracking-tight">{b.title}</div>
      <p className="mx-auto mt-2 max-w-md text-muted">{b.text}</p>
      <Button variant="primary" className="mt-5 px-5 py-2.5 text-[14px]" onClick={() => go(b.to)}>
        {b.cta}
      </Button>
    </div>
  );
  if (bare) return card;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-6 py-8">{card}</div>
    </div>
  );
}

/** The request this whole session is about, shown the same way on every step. */
export function EventBar({ id, title, due, revision, blank, sent, next }: { id: string; title: string; due: string; revision: number; blank: boolean; sent: boolean; next?: { text: string; cta: string; onClick: () => void } }) {
  const d = new Date(due);
  const days = Math.ceil((d.getTime() - Date.now()) / 864e5);
  const dueText = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const left = days > 1 ? `${days} days left` : days === 1 ? "1 day left" : days === 0 ? "due today" : "past due";
  const untitled = blank && /^untitled/i.test(title);
  return (
    <section aria-label="Current request" className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-panel px-5 py-2">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Request</span>
        <h1 className={cx("truncate text-[14.5px] font-semibold tracking-tight", untitled && "font-normal italic text-muted")} title={title}>
          {untitled ? "Untitled request. Describe what you are buying in Collect quotes." : title.replace(/\s*—\s*/, ": ")}
        </h1>
      </div>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        {!blank && (
          <span className="rounded-md border border-line bg-white px-2 py-0.5 font-mono text-[11.5px] text-ink" title="The reference number of this request. It is in the subject line of the email vendors get, so their replies find their way back here.">
            {id}
            {revision > 1 ? ` · rev ${revision}` : ""}
          </span>
        )}
        {blank && <span className="rounded-md border border-dashed border-line bg-white px-2 py-0.5 text-[11.5px]">Draft, not sent</span>}
        <span className="rounded-md border border-line bg-white px-2 py-0.5" title="The date vendors have been asked to reply by.">
          Quotes due <b className="font-semibold text-ink">{dueText}</b>
          {!sent || days < 0 ? "" : <span className={cx("ml-1", days <= 3 && "text-warn")}>· {left}</span>}
        </span>
      </div>
      {next && (
        <div className="ml-auto flex items-center gap-2.5 text-[12.5px]">
          <span className="text-muted">
            <b className="font-semibold text-ink">Next:</b> {next.text}
          </span>
          <button onClick={next.onClick} className="rounded-lg bg-ink px-3 py-1 text-[12.5px] font-medium text-white hover:bg-black">
            {next.cta} →
          </button>
        </div>
      )}
    </section>
  );
}

/** A copy button that says what happened: turns green with "Copied!" for a moment, or says plainly that it could not copy. */
export function CopyButton({ text, label = "Copy", link, className }: { text: string | (() => string); label?: string; link?: boolean; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function go() {
    const ok = await copyText(typeof text === "function" ? text() : text);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), ok ? 2200 : 4000);
  }
  const base = link ? "text-[11.5px] font-medium" : "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition";
  const tone = state === "copied" ? (link ? "text-good" : "border-good/40 bg-good-soft text-good") : state === "failed" ? (link ? "text-bad" : "border-bad/30 bg-bad-soft text-bad") : link ? "text-kraft" : "border-line bg-white hover:border-[#cfd3da] hover:bg-panel";
  return (
    <button type="button" onClick={go} aria-live="polite" className={cx(base, tone, className)}>
      {state === "copied" ? "✓ Copied!" : state === "failed" ? "Couldn't copy. Select the text and press Ctrl+C" : label}
    </button>
  );
}
