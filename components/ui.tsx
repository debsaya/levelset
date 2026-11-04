"use client";
import React from "react";

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
  for (const raw of lines) {
    const l = raw.trimEnd();
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
