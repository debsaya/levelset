"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import type { VendorMsg, VendorResponse } from "@/lib/types";
import { Badge, Button, Card, Spinner, cx, fileToB64, mimeFor } from "./ui";

export function fileName(url: string) {
  return url.includes("#name=") ? decodeURIComponent(url.split("#name=")[1]) : url.split("/").pop()!;
}

const FORMAT_ICON: Record<string, string> = { Excel: "📊", "PDF on letterhead": "📄", "Word document": "📝", "Photo of rate card": "📷", "Email (incumbent)": "✉️" };

export default function InboxStep({ onNext }: { onNext: () => void }) {
  const { s, set, log } = useStore();
  const [sel, setSel] = useState<string | undefined>(s.responses[0]?.vendor.id);
  const [adding, setAdding] = useState(false);
  const visible = s.sentAt || s.mode === "blank" ? s.responses : [];
  const cur = s.responses.find((r) => r.vendor.id === sel);

  function patch(id: string, p: Partial<VendorResponse>) {
    set((x) => ({ ...x, responses: x.responses.map((r) => (r.vendor.id === id ? { ...r, ...p } : r)) }));
  }

  async function read(r: VendorResponse, uploaded?: File[]) {
    patch(r.vendor.id, { status: "reading", error: undefined });
    try {
      const files = uploaded
        ? await Promise.all(uploaded.map(async (f) => ({ name: f.name, mime: f.type || mimeFor(f.name), data: await fileToB64(f) })))
        : await Promise.all(
            r.vendor.attachments.map(async (url) => {
              const blob = await (await fetch(url)).blob();
              const name = fileName(url);
              return { name, mime: mimeFor(name), data: await fileToB64(blob) };
            })
          );
      const pc = s.prior[r.vendor.id];
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: r.vendor, files, rfx: s.rfx, prior: pc ? { contract_ref: pc.contract_ref, period: pc.period, line_ids: Object.keys(pc.prices) } : null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Extraction failed");
      patch(r.vendor.id, { status: "done", extraction: j.extraction, model: j.model, ms: j.ms });
      log(`Read response from ${r.vendor.name} (${j.extraction.lines?.length ?? 0} prices, ${j.model}, ${(j.ms / 1000).toFixed(0)}s)`);
    } catch (e: any) {
      patch(r.vendor.id, { status: "error", error: e.message });
    }
  }

  async function readAll() {
    const todo = visible.filter((r) => r.status !== "done" && r.status !== "reading");
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) await read(queue.shift()!);
    };
    await Promise.all([worker(), worker()]);
  }

  const doneCount = visible.filter((r) => r.status === "done").length;

  return (
    <div className="grid h-full grid-cols-[380px_1fr] gap-4 p-4">
      <Card className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="font-semibold">Inbox</div>
            <div className="text-xs text-muted">
              {visible.length} responses · {doneCount} read
            </div>
          </div>
          <Button variant="primary" onClick={readAll} disabled={!visible.some((r) => r.status === "new" || r.status === "error")}>
            Read all
          </Button>
        </div>
        <div className="flex-1 divide-y divide-line overflow-y-auto">
          {!s.sentAt && s.mode === "demo" && (
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>Nothing yet — the RFx hasn&apos;t been sent.</p>
              <Button onClick={() => set((x) => ({ ...x, sentAt: new Date().toISOString() }))}>Skip ahead: simulate replies arriving</Button>
            </div>
          )}
          {visible.map((r) => (
            <button key={r.vendor.id} onClick={() => setSel(r.vendor.id)} className={cx("block w-full px-4 py-3 text-left", sel === r.vendor.id && "bg-brand-soft")}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">
                  {FORMAT_ICON[r.vendor.format] || "📎"} {r.vendor.name}
                </span>
                <StatusBadge r={r} />
              </div>
              <div className="truncate text-xs text-muted">{r.vendor.subject}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {new Date(r.vendor.received_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {r.vendor.format}
              </div>
            </button>
          ))}
        </div>
        <div className="space-y-2 border-t border-line p-3">
          <Button className="w-full justify-center" onClick={() => setAdding(true)}>
            + Add a vendor response (upload any file)
          </Button>
          {doneCount > 0 && (
            <Button variant="primary" className="w-full justify-center" onClick={onNext}>
              Compare {doneCount} vendors →
            </Button>
          )}
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        {adding ? (
          <AddResponse
            onCancel={() => setAdding(false)}
            onAdd={(vendor, files) => {
              set((x) => ({ ...x, responses: [...x.responses, { vendor, status: "new" }] }));
              setAdding(false);
              setSel(vendor.id);
              setTimeout(() => read({ vendor, status: "new" }, files), 50);
            }}
            nextId={`V${s.responses.length + 1}`}
          />
        ) : cur ? (
          <ResponseDetail r={cur} onRead={() => read(cur)} />
        ) : (
          <div className="p-8 text-muted">Select a response.</div>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ r }: { r: VendorResponse }) {
  if (r.status === "reading")
    return (
      <Badge tone="brand">
        <Spinner className="h-2.5 w-2.5" /> reading
      </Badge>
    );
  if (r.status === "error") return <Badge tone="bad">error</Badge>;
  if (r.status === "done") {
    const ex = r.extraction!;
    const low = (ex.lines || []).filter((l) => Math.min(l.match_confidence, l.read_confidence) < 0.75).length;
    return (
      <span className="flex gap-1">
        <Badge tone="good">{new Set(ex.lines.map((l) => l.rfx_line_id).filter(Boolean)).size} priced</Badge>
        {low > 0 && <Badge tone="warn">{low} unsure</Badge>}
      </span>
    );
  }
  return <Badge>unread</Badge>;
}

function ResponseDetail({ r, onRead }: { r: VendorResponse; onRead: () => void }) {
  const ex = r.extraction;
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold">{r.vendor.name}</div>
            <div className="text-xs text-muted">
              {r.vendor.contact} &lt;{r.vendor.email}&gt; · {r.vendor.city}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {r.status === "done" && (
              <span className="text-[11px] text-muted">
                read by {r.model} in {((r.ms || 0) / 1000).toFixed(0)}s
              </span>
            )}
            <Button onClick={onRead} disabled={r.status === "reading"}>
              {r.status === "reading" ? <Spinner /> : null}
              {r.status === "done" ? "Re-read" : "Read with AI"}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="rounded-md border border-line bg-panel p-3">
          <div className="mb-1 text-xs font-medium text-muted">{r.vendor.subject}</div>
          <pre className="whitespace-pre-wrap font-sans text-[13px]">{r.vendor.body}</pre>
          {r.vendor.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {r.vendor.attachments.map((a) => (
                <a key={a} href={a} target="_blank" className="rounded border border-line bg-white px-2 py-1 text-xs text-brand hover:underline">
                  📎 {fileName(a)}
                </a>
              ))}
            </div>
          )}
          {r.vendor.attachments.some((a) => /\.(jpe?g|png)$/i.test(fileName(a))) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.vendor.attachments.find((a) => /\.(jpe?g|png)$/i.test(fileName(a)))} alt="attachment" className="mt-3 max-h-72 rounded border border-line" />
          )}
        </div>
        {r.status === "error" && <div className="rounded-md bg-bad-soft p-3 text-sm text-bad">{r.error}</div>}
        {r.status === "reading" && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Reading every attachment, mapping prices to RFx lines, citing sources…
          </div>
        )}
        {ex && (
          <>
            <div className="grid grid-cols-4 gap-2 text-[12.5px]">
              <Fact k="Currency" v={`${ex.currency}${ex.fx_rate_stated ? ` (ref ₹${ex.fx_rate_stated})` : ""}`} />
              <Fact k="Tax" v={`${ex.tax.basis}${ex.tax.gst_rate_pct ? `, GST ${ex.tax.gst_rate_pct}%` : ""}`} />
              <Fact k="Freight" v={ex.freight.included === true ? "Delivered" : ex.freight.included === false ? "Extra / ex-works" : "Not stated"} />
              <Fact k="Payment / lead" v={`${ex.payment_terms_days ?? "–"} d / ${ex.lead_time_days ?? "–"} d`} />
            </div>
            {(ex.unresolved?.length > 0 || ex.adjustments?.length > 0) && (
              <div className="space-y-1.5">
                {ex.adjustments.map((a, i) => (
                  <div key={i} className="rounded-md border border-line px-3 py-2 text-[12.5px]">
                    <Badge tone={a.conditional ? "warn" : "brand"}>{a.kind.replace(/_/g, " ")}</Badge> {a.description}
                    {a.condition && <span className="text-muted"> — if {a.condition}</span>}
                    <div className="mt-0.5 text-[11px] text-muted">
                      {a.source.file} · {a.source.location} · “{a.source.quote}”
                    </div>
                  </div>
                ))}
                {ex.unresolved.map((u, i) => (
                  <div key={i} className="rounded-md bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
                    ⚠ {u}
                  </div>
                ))}
              </div>
            )}
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Prices as read ({ex.lines.length})</div>
              <table className="w-full text-[12px] tabular">
                <thead className="text-left text-[11px] text-muted">
                  <tr className="border-b border-line">
                    <th className="py-1 pr-2">Line</th>
                    <th className="py-1 pr-2">Vendor wrote</th>
                    <th className="py-1 pr-2 text-right">Price</th>
                    <th className="py-1 pr-2">Per</th>
                    <th className="py-1 pr-2">Conf.</th>
                    <th className="py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {ex.lines.map((l, i) => {
                    const c = Math.min(l.match_confidence, l.read_confidence);
                    return (
                      <tr key={i} className="border-b border-line align-top">
                        <td className="py-1 pr-2 font-medium">{l.rfx_line_id || "?"}</td>
                        <td className="py-1 pr-2">
                          {l.vendor_item_text}
                          {l.spec_deviation && <div className="text-warn">≠ {l.spec_deviation}</div>}
                          {l.note && <div className="text-muted">{l.note}</div>}
                        </td>
                        <td className="py-1 pr-2 text-right">{l.price === null ? <span className="text-muted">prior</span> : `${l.currency} ${l.price}`}</td>
                        <td className="py-1 pr-2 text-muted">
                          {l.basis_qty !== 1 ? l.basis_qty + " " : ""}
                          {l.basis_unit}
                          {l.tax_included ? " incl. GST" : ""}
                        </td>
                        <td className="py-1 pr-2">
                          <Badge tone={c >= 0.75 ? "good" : "warn"}>{Math.round(c * 100)}%</Badge>
                        </td>
                        <td className="py-1 text-muted">
                          {l.source.location} · “{l.source.quote}”
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {ex.not_quoted.length > 0 && (
                <div className="mt-2 text-[12px] text-muted">
                  <b>Not quoted:</b> {ex.not_quoted.map((n) => `${n.rfx_line_id} (${n.reason})`).join("; ")}
                </div>
              )}
            </div>
            <button className="text-xs text-brand" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? "Hide" : "Show"} raw extraction JSON
            </button>
            {showRaw && <pre className="max-h-96 overflow-auto rounded bg-panel p-3 text-[11px]">{JSON.stringify(ex, null, 1)}</pre>}
          </>
        )}
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}

function AddResponse({ onCancel, onAdd, nextId }: { onCancel: () => void; onAdd: (v: VendorMsg, files: File[]) => void; nextId: string }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div className="space-y-3 p-5">
      <div className="font-semibold">Add a vendor response</div>
      <div className="text-xs text-muted">Drop in anything — a PDF, Excel, Word file, phone photo, or paste the email text. It is read against the current RFx exactly like the others.</div>
      <input className="w-full rounded-md border border-line px-3 py-2" placeholder="Vendor name" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea className="h-36 w-full rounded-md border border-line px-3 py-2 text-[13px]" placeholder="Paste the email body (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
      <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.docx,.jpg,.jpeg,.png,.txt" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || !name.trim() || (!body.trim() && !files.length)}
          onClick={async () => {
            setBusy(true);
            const small = files.reduce((a, f) => a + f.size, 0) < 1_500_000;
            const attachments = small ? await Promise.all(files.map(async (f) => `data:${f.type || mimeFor(f.name)};base64,${await fileToB64(f)}#name=${encodeURIComponent(f.name)}`)) : [];
            onAdd(
              {
                id: nextId,
                name: name.trim(),
                city: "",
                contact: name.trim(),
                email: "uploaded@manual",
                format: files.length ? files.map((f) => f.name.split(".").pop()?.toUpperCase()).join(" + ") : "Email text",
                subject: `Response from ${name.trim()}`,
                received_at: new Date().toISOString(),
                body: body || "(no email body)",
                attachments,
              },
              files
            );
          }}
        >
          Add &amp; read
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
