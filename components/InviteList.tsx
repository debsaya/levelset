"use client";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "@/lib/store";
import { MASTER, certificate, isCategory, parseVendorLines, type PoolVendor } from "@/lib/vendorpool";
import { Badge, Button, Card, cx } from "./ui";

type Channel = "list" | "lastyear" | "upload" | "paste" | "email";

const CHANNELS: { id: Channel; label: string; tip: string }[] = [
  { id: "list", label: "Vendor list", tip: "Pick from the vendors your company already works with." },
  { id: "lastyear", label: "Last year's vendors", tip: "Invite everyone who held the previous contract." },
  { id: "upload", label: "Upload a list", tip: "An Excel or CSV file with vendor names and emails." },
  { id: "paste", label: "Paste emails", tip: "Paste names and emails from anywhere: an email, a chat, a sheet." },
  { id: "email", label: "Add one by email", tip: "A vendor that is not on any list yet." },
];

const SOURCE: Record<PoolVendor["source"], string> = { master: "Vendor list", upload: "Uploaded", paste: "Pasted", manual: "Added by hand" };

/** Step 1, before sending: who gets this request, and the ways to bring vendors in. */
export default function InviteList() {
  const { s, set, log } = useStore();
  const pool = s.pool ?? MASTER;
  const due = s.rfx.due_date;
  const invitees = s.sentTo.map((id) => pool.find((v) => v.id === id)).filter(Boolean) as PoolVendor[];
  const [ch, setCh] = useState<Channel | null>(invitees.length ? null : "list");
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState("");
  const [one, setOne] = useState({ name: "", email: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const nextNum = () => Math.max(0, ...pool.map((v) => parseInt(v.id.replace(/\D/g, ""), 10) || 0)) + 1;
  const invite = (ids: string[]) => set((x) => ({ ...x, sentTo: Array.from(new Set([...x.sentTo, ...ids])) }));
  const remove = (id: string) => set((x) => ({ ...x, sentTo: x.sentTo.filter((i) => i !== id) }));

  /** New vendors from an upload, paste or form: add to the pool (skipping ones already there) and invite them. */
  function addNew(found: PoolVendor[], skipped: string[], from: string) {
    const fresh: PoolVendor[] = [];
    const existing: string[] = [];
    for (const v of found) {
      const dup = pool.find((p) => p.email.toLowerCase() === v.email.toLowerCase()) || fresh.find((p) => p.email.toLowerCase() === v.email.toLowerCase());
      if (dup) existing.push(dup.id);
      else fresh.push(v);
    }
    set((x) => ({ ...x, pool: [...(x.pool ?? MASTER), ...fresh], sentTo: Array.from(new Set([...x.sentTo, ...fresh.map((v) => v.id), ...existing])) }));
    setMsg(`${found.length ? `Added ${found.length} ${found.length === 1 ? "vendor" : "vendors"}${existing.length ? ` (${existing.length} already on your list)` : ""}.` : "No vendors found."}${skipped.length ? ` Skipped ${skipped.length} without an email: ${skipped.slice(0, 2).join("; ")}${skipped.length > 2 ? "…" : ""}` : ""}`);
    if (found.length) log(`Added ${found.length} vendor(s) from ${from}`);
  }

  async function onFile(f: File) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
      const { vendors, skipped } = parseVendorLines(rows, nextNum(), "upload");
      addNew(vendors, skipped, `the file ${f.name}`);
    } catch {
      setMsg("That file could not be read. Use Excel or CSV with a name and an email on each row.");
    }
  }

  const cert = { valid: 0, expired: 0, missing: 0 };
  for (const v of invitees) {
    const t = certificate(v, due).tone;
    if (t === "bad") cert.expired++;
    else if (t === "warn") cert.missing++;
    else cert.valid++;
  }
  const certParts = [cert.valid && `${cert.valid} valid`, cert.expired && `${cert.expired} expired`, cert.missing && `${cert.missing} missing`].filter(Boolean) as string[];
  const compliance = certParts.length > 1 ? `${certParts.slice(0, -1).join(", ")} & ${certParts[certParts.length - 1]}` : certParts[0] || "";
  const lastYear = pool.filter((v) => v.incumbent || s.prior[v.id]);
  const available = pool.filter((v) => !s.sentTo.includes(v.id) && (!q || `${v.name} ${v.city}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3.5 border-b border-kraft/25 border-l-4 border-l-kraft bg-kraft-soft px-5 py-3.5">
        <span className="tabular grid h-10 w-10 shrink-0 place-items-center rounded-full bg-kraft text-[17px] font-semibold text-white" aria-hidden>
          {invitees.length}
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink">{invitees.length ? `Request quotations from ${invitees.length === 1 ? "1 onboarded vendor" : `${invitees.length} onboarded vendors`}` : "No vendors selected yet"}</div>
          <div className="mt-0.5 text-[12.5px] text-kraft">
            {invitees.length ? "Remove anyone you do not want to invite, or add more below." : "Pick one of the options below to add vendors."}
            {invitees.length > 0 && compliance && <span className={cx("ml-1.5 font-medium", cert.expired > 0 ? "text-bad" : "text-kraft")}>Compliance: {compliance} ISO certificate.</span>}
          </div>
        </div>
      </div>

      <div className="divide-y divide-line">
        {invitees.map((v, i) => {
          const fit = certificate(v, due);
          return (
            <div key={v.id} className="flex items-center gap-4 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="tabular w-5 shrink-0 text-right text-[12.5px] text-muted">{i + 1}.</span>
                  <span className="truncate text-[13.5px] font-medium">{v.name}</span>
                  {s.prior[v.id] && <Badge tone="brand">incumbent</Badge>}
                  {v.source !== "master" && <Badge>{SOURCE[v.source]}</Badge>}
                </div>
                <div className="truncate pl-7 text-[11.5px] text-muted">
                  {`${v.city || "City not given"}${v.km != null ? ` · ${v.km} km from the plant` : ""} · ${v.history}`}
                </div>
              </div>
              {v.source === "master" && (
                <span title="From your vendor records, before any quote arrives. You can still send to this vendor." className={cx("hidden shrink-0 text-[12px] md:block", fit.tone === "bad" ? "text-bad" : fit.tone === "warn" ? "text-warn" : "text-muted")}>
                  {fit.text}
                </span>
              )}
              <button onClick={() => remove(v.id)} aria-label={`Remove ${v.name}`} title="Leave this vendor out" className="shrink-0 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-panel hover:text-ink">
                Remove
              </button>
            </div>
          );
        })}
        {!invitees.length && <div className="px-5 py-8 text-center text-[13px] text-muted">No vendors selected yet. Pick one of the options below to bring vendors in.</div>}
      </div>

      <div className="border-t border-line bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="text-[13.5px] font-semibold">Add vendors</div>
          {CHANNELS.map((c) => (
            <button key={c.id} onClick={() => (setCh(ch === c.id ? null : c.id), setMsg(null))} aria-pressed={ch === c.id} title={c.tip} className={cx("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px] font-medium transition", ch === c.id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-[#cfd3da] hover:bg-panel")}>
              <span aria-hidden className="text-[13px] leading-none opacity-60">+</span>
              {c.label}
            </button>
          ))}
          <span title="Connecting your ERP or vendor master (SAP, Tally, Oracle, Ariba) is stubbed in this prototype. The built-in vendor list stands in for it." className="inline-flex cursor-help items-center rounded-full border border-dashed border-line px-3 py-1 text-[12.5px] text-muted">
            Connect ERP · planned
          </span>
        </div>

      {ch && (
        <div className="mt-3 rounded-xl border border-line bg-panel px-4 py-3.5 text-[12.5px]">
          {ch === "list" && (
            <div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your vendors by name or city" className="mb-2 w-full rounded-md border border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-kraft" />
              <div className="max-h-52 divide-y divide-line overflow-y-auto rounded-md border border-line bg-white">
                {available.map((v) => {
                  const fit = certificate(v, due);
                  const off = !isCategory(v);
                  return (
                    <div key={v.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{v.name}</div>
                        <div className="truncate text-[11.5px] text-muted">
                          {v.city}
                          {v.km != null ? ` · ${v.km} km` : ""} · {v.history}
                        </div>
                      </div>
                      <span className={cx("hidden text-[11.5px] sm:inline", fit.tone === "bad" ? "text-bad" : fit.tone === "warn" ? "text-warn" : "text-muted")}>{off ? "Not a corrugated maker" : fit.text}</span>
                      <Button onClick={() => invite([v.id])}>Add</Button>
                    </div>
                  );
                })}
                {!available.length && <div className="px-3 py-4 text-center text-muted">{q ? "No vendor matches." : "Everyone on your list is already chosen."}</div>}
              </div>
            </div>
          )}
          {ch === "lastyear" && (
            <div>
              {lastYear.length ? (
                <>
                  <p className="text-muted">Held the previous contract: {lastYear.map((v) => `${v.name} (${s.prior[v.id]?.period ?? "FY26"})`).join(", ")}.</p>
                  <Button
                    className="mt-2.5"
                    onClick={() => {
                      invite(lastYear.map((v) => v.id));
                      setCh(null);
                    }}
                  >
                    Invite {lastYear.length === 1 ? "vendor" : "all"}
                  </Button>
                </>
              ) : (
                <p className="text-muted">No previous contract on file for this category.</p>
              )}
            </div>
          )}
          {ch === "upload" && (
            <div>
              <p className="text-muted">Excel or CSV, one vendor per row: name and email, and optionally city. A header row is fine. Your own vendor-master export works as it is.</p>
              <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv,.txt" onChange={(e) => (e.target.files?.[0] && onFile(e.target.files[0]), (e.target.value = ""))} />
              <Button className="mt-2.5" onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
            </div>
          )}
          {ch === "paste" && (
            <div>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"One per line, for example:\nAsha Traders <asha@ashatraders.in>\nBharat Cartons, bharat@cartons.co.in, Pune\nsales@xyzpack.com"} className="h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-kraft" />
              <Button
                className="mt-2"
                variant="primary"
                disabled={!paste.trim()}
                onClick={() => {
                  const { vendors, skipped } = parseVendorLines(paste.split(/\n|;/).map((l) => l.split(/\t|,(?![^<]*>)/)), nextNum(), "paste");
                  addNew(vendors, skipped, "pasted text");
                  setPaste("");
                }}
              >
                Add these vendors
              </Button>
            </div>
          )}
          {ch === "email" && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const { vendors, skipped } = parseVendorLines([[one.name, one.email]], nextNum(), "manual");
                addNew(vendors, skipped, "a hand-typed address");
                setOne({ name: "", email: "" });
              }}
            >
              <input value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} placeholder="Company name" className="min-w-[180px] flex-1 rounded-md border border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-kraft" />
              <input value={one.email} onChange={(e) => setOne({ ...one, email: e.target.value })} placeholder="Email address" type="email" className="min-w-[200px] flex-1 rounded-md border border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-kraft" />
              <Button variant="primary" disabled={!/.+@.+\..+/.test(one.email)}>
                Add
              </Button>
            </form>
          )}
          {msg && <div className="mt-2 text-[12px] text-ink">{msg}</div>}
        </div>
      )}
      </div>
    </Card>
  );
}
