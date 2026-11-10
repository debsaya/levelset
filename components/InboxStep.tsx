"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import type { VendorMsg, VendorResponse } from "@/lib/types";
import { Badge, Blocked, Button, Card, Disclosure, MoreMenu, Spinner, cx, fileToB64, mimeFor, OnEscape } from "./ui";
import { prepFile } from "@/lib/image";
import { blocker } from "@/lib/flow";
import { MASTER } from "@/lib/vendorpool";
import { fileName, useReader } from "@/lib/reader";
import type { Normalized } from "@/lib/normalize";

export { fileName };

const FORMAT_ICON: Record<string, string> = {};

export default function InboxStep({ n, onNext, go, initialAdd = false }: { n: Normalized; onNext: () => void; go: (p: "rfx" | "quotes") => void; initialAdd?: boolean }) {
  const { s, set, log } = useStore();
  const [sel, setSel] = useState<string | undefined>(s.responses[0]?.vendor.id);
  const [adding, setAdding] = useState(initialAdd);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const visible = s.sentAt || s.mode === "blank" ? s.responses : [];
  const cur = visible.find((r) => r.vendor.id === sel);

  const { read, readAll, hasSaved, loadSaved } = useReader();

  const doneCount = visible.filter((r) => r.status === "done").length;
  const pool = s.pool ?? MASTER;
  const nextId = `V${Math.max(...pool.map((v) => parseInt(v.id.replace(/\D/g, ""), 10) || 0), ...s.responses.map((r) => parseInt(r.vendor.id.replace(/\D/g, ""), 10) || 0)) + 1}`;

  const dropVendorKeys = <T,>(o: Record<string, T>, id: string) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith(`${id}|`))) as Record<string, T>;
  function removeVendor(id: string) {
    const name = s.responses.find((r) => r.vendor.id === id)?.vendor.name;
    set((x) => ({ ...x, responses: x.responses.filter((r) => r.vendor.id !== id), overrides: dropVendorKeys(x.overrides, id), qOverrides: dropVendorKeys(x.qOverrides, id) }));
    log(`Removed the response from ${name}`);
    if (sel === id) setSel(s.responses.find((r) => r.vendor.id !== id)?.vendor.id);
    setDeleting(null);
  }
  function saveReading() {
    const extractions = Object.fromEntries(s.responses.filter((r) => r.status === "done" && r.extraction).map((r) => [r.vendor.id, { extraction: r.extraction, model: r.model, ms: r.ms }]));
    const blob = new Blob([JSON.stringify({ recorded_at: new Date().toISOString(), extractions })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "saved_reading.json";
    a.click();
    URL.revokeObjectURL(a.href);
    log(`Saved the reading of ${Object.keys(extractions).length} quote(s) to a file`);
  }
  const menuFor = (r: VendorResponse) => [
    { label: r.status === "done" ? "Read again" : "Read with AI", hint: r.status === "done" ? "Runs the AI over the same files again and replaces the prices. Your accept / override choices are kept." : "Runs the AI over this vendor's files.", onClick: () => read(r), disabled: r.status === "reading" },
    { label: "Replace response…", hint: "Swap in different files or email text. Your choices on the old prices are cleared.", onClick: () => (setAdding(false), setReplacing(r.vendor.id), setSel(r.vendor.id)) },
    { label: "Delete response", hint: "Removes this vendor from the comparison.", onClick: () => setDeleting(r.vendor.id), danger: true },
  ];

  return (
    <div className="grid w-full grid-cols-1 gap-4 p-4 lg:h-full lg:grid-cols-[380px_1fr]">
      <Card className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="font-semibold">Vendor replies</div>
            <div className="text-xs text-muted">
              {visible.length} replies · {doneCount} read by the AI
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="primary" onClick={readAll} disabled={!visible.some((r) => r.status === "new" || r.status === "error")}>
              Read all
            </Button>
            <MoreMenu
              title="More actions for all replies"
              items={[
                ...(hasSaved ? [{ label: "Load the saved reading", hint: "Fills in the quotes from an earlier real run, without calling the AI. Useful if the connection is slow.", onClick: loadSaved }] : []),
                { label: "Save this reading as a file", hint: "Downloads what the AI read, so it can be kept as the saved reading.", onClick: saveReading, disabled: doneCount === 0 },
              ]}
            />
          </div>
        </div>
        <div className="flex-1 divide-y divide-line overflow-y-auto">
          {!s.sentAt && s.mode === "demo" && (
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>Nothing to read yet: the request has not been sent.</p>
            </div>
          )}
          {visible.map((r) => (
            <div key={r.vendor.id} className={cx("relative px-4 py-3 text-left", sel === r.vendor.id && "bg-kraft-soft")}>
              <div className="flex items-center justify-between gap-2">
                <button type="button" aria-current={sel === r.vendor.id ? "true" : undefined} onClick={() => (setAdding(false), setReplacing(null), setSel(r.vendor.id))} className="min-w-0 flex-1 truncate text-left font-medium after:absolute after:inset-0 after:content-['']">
                  {r.vendor.name}
                </button>
                <span className="relative z-10 flex shrink-0 items-center gap-1">
                  <StatusBadge r={r} n={n} />
                  <MoreMenu items={menuFor(r)} title={`Actions for ${r.vendor.name}`} />
                </span>
              </div>
              <div className="truncate text-xs text-muted">{r.vendor.subject}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {new Date(r.vendor.received_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {r.vendor.format}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-line p-3">
          <Button className="w-full justify-center" onClick={() => (setReplacing(null), setAdding(true))}>
            + Add reply
          </Button>
          {doneCount > 0 && (
            <Button variant="primary" className="w-full justify-center" onClick={onNext}>
              Compare →
            </Button>
          )}
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        {adding || replacing ? (
          <AddResponse
            key={replacing || "new"}
            names={pool.map((v) => v.name)}
            replacing={replacing ? s.responses.find((r) => r.vendor.id === replacing)?.vendor : undefined}
            onCancel={() => (setAdding(false), setReplacing(null))}
            onAdd={(vendor, files) => {
              if (replacing) {
                const id = replacing;
                const v = { ...vendor, id };
                set((x) => ({ ...x, responses: x.responses.map((r) => (r.vendor.id === id ? { vendor: v, status: "new" as const } : r)), overrides: dropVendorKeys(x.overrides, id), qOverrides: dropVendorKeys(x.qOverrides, id) }));
                log(`Replaced the response from ${v.name}`);
                setReplacing(null);
                setSel(id);
                setTimeout(() => read({ vendor: v, status: "new" }, files), 50);
                return;
              }
              // A reply from someone on the vendor list is filed under that vendor, so their row in Collect quotes fills in.
              const m = pool.find((p) => p.name.toLowerCase() === vendor.name.toLowerCase() && !s.responses.some((r) => r.vendor.id === p.id));
              const v = m ? { ...vendor, id: m.id, name: m.name, email: m.email, city: m.city, contact: m.contact } : vendor;
              set((x) => ({ ...x, responses: [...x.responses, { vendor: v, status: "new" }] }));
              setAdding(false);
              setSel(v.id);
              setTimeout(() => read({ vendor: v, status: "new" }, files), 50);
            }}
            nextId={nextId}
          />
        ) : cur ? (
          <ResponseDetail r={cur} onRead={() => read(cur)} menu={menuFor(cur)} />
        ) : (
          (() => {
            const b = blocker(s);
            return b ? <Blocked b={b} go={go} /> : <div className="p-8 text-muted">Select a response.</div>;
          })()
        )}
      </Card>
      {deleting && (
        <div role="dialog" aria-modal="true" aria-label="Delete this response" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" onClick={() => setDeleting(null)}>
          <OnEscape onClose={() => setDeleting(null)} />
          <div className="w-[420px] rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold">Delete the response from {s.responses.find((r) => r.vendor.id === deleting)?.vendor.name}?</div>
            <p className="mt-1.5 text-[13px] text-muted">This vendor leaves the comparison, along with its prices and any accept / override choices you made on them. You can add the response again later.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-lg px-3.5 py-2 text-[13px] hover:bg-panel" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="rounded-lg bg-bad px-3.5 py-2 text-[13px] font-medium text-white" onClick={() => removeVendor(deleting)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ r, n }: { r: VendorResponse; n: Normalized }) {
  if (r.status === "reading")
    return (
      <Badge tone="brand">
        <Spinner className="h-2.5 w-2.5" /> reading
      </Badge>
    );
  if (r.status === "error") return <Badge tone="bad">error</Badge>;
  if (r.status === "done") {
    const v = n.vendors.find((x) => x.vendor_id === r.vendor.id);
    return (
      <span className="lv-settle flex gap-1">
        <Badge tone="good">{v ? v.quoted : 0} priced</Badge>
        {v && v.review > 0 && <Badge tone="warn">{v.review} to check</Badge>}
      </span>
    );
  }
  return <Badge>unread</Badge>;
}

function ResponseDetail({ r, onRead, menu }: { r: VendorResponse; onRead: () => void; menu: { label: string; hint?: string; onClick: () => void; danger?: boolean; disabled?: boolean }[] }) {
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
              <span className="text-[11px] text-muted" title={r.model}>
                read by AI in {((r.ms || 0) / 1000).toFixed(0)}s
              </span>
            )}
            <Button onClick={onRead} disabled={r.status === "reading"} title={r.status === "done" ? "Runs the AI over the same files again and replaces the prices. Your accept / override choices are kept." : "Runs the AI over this vendor's files."}>
              {r.status === "reading" ? <Spinner /> : null}
              {r.status === "done" ? "Read again" : "Read with AI"}
            </Button>
            <MoreMenu items={menu.slice(1)} title="More actions for this response" />
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
                <a key={a} href={a} target="_blank" className="rounded border border-line bg-white px-2 py-1 text-xs text-kraft hover:underline">
                  {fileName(a)}
                </a>
              ))}
            </div>
          )}
          {r.vendor.attachments.some((a) => /\.(jpe?g|png)$/i.test(fileName(a))) && (
            <a href={r.vendor.attachments.find((a) => /\.(jpe?g|png)$/i.test(fileName(a)))} target="_blank" rel="noreferrer" title="Open the photo full size" className="mt-3 block w-fit cursor-zoom-in">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.vendor.attachments.find((a) => /\.(jpe?g|png)$/i.test(fileName(a)))} alt="attachment" className="max-h-72 rounded border border-line" />
            </a>
          )}
        </div>
        {r.status === "error" && <div className="rounded-md bg-bad-soft p-3 text-sm text-bad">{r.error}</div>}
        {r.status === "reading" && (
          <div className="space-y-2.5" role="status">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Reading every attachment, matching prices to your items, citing sources…
            </div>
            <div className="space-y-2" aria-hidden>
              <div className="lv-skeleton h-3 w-2/3" />
              <div className="lv-skeleton h-3 w-5/6" style={{ animationDelay: ".15s" }} />
              <div className="lv-skeleton h-3 w-1/2" style={{ animationDelay: ".3s" }} />
            </div>
          </div>
        )}
        {ex && (
          <>
            <Terms ex={ex} />
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
            <Disclosure title="Prices as read" summary={`${ex.lines.length} ${ex.lines.length === 1 ? "price" : "prices"}${ex.lines.filter((l) => Math.min(l.match_confidence, l.read_confidence) < 0.8).length ? ` · ${ex.lines.filter((l) => Math.min(l.match_confidence, l.read_confidence) < 0.8).length} low confidence` : ""} · where each was found`}>
              <div className="overflow-x-auto px-4 py-3">
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
                          <Badge tone={c >= 0.8 ? "good" : "warn"}>{Math.round(c * 100)}%</Badge>
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
            </Disclosure>
            <button className="inline-flex items-center rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink transition hover:border-[#cfd3da] hover:bg-panel" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? "Hide raw" : "Raw data"}
            </button>
            {showRaw && <pre className="max-h-96 overflow-auto rounded bg-panel p-3 text-[11px]">{JSON.stringify(ex, null, 1)}</pre>}
          </>
        )}
      </div>
    </div>
  );
}

const askedDays = (s: string | undefined) => {
  const m = /(\d+)\s*days?/i.exec(s || "");
  return m ? parseInt(m[1], 10) : null;
};

/** The commercial terms read from the quote, laid out quietly. Where the vendor differs from what the buyer asked for, say so. */
function Terms({ ex }: { ex: NonNullable<VendorResponse["extraction"]> }) {
  const { s } = useStore();
  const askPay = askedDays(s.rfx.terms.payment);
  const askValid = askedDays(s.rfx.terms.validity);
  const taxV = ex.tax.basis === "exclusive" ? `Extra${ex.tax.gst_rate_pct ? `, ${ex.tax.gst_rate_pct}%` : ""}` : ex.tax.basis === "inclusive" ? "Included in prices" : ex.tax.basis === "mixed" ? "Mixed" : "Not stated";
  const items: { k: string; v: string; sub?: string; warn?: boolean }[] = [
    { k: "Currency", v: ex.currency, sub: ex.fx_rate_stated ? `vendor's rate ₹${ex.fx_rate_stated}` : undefined },
    { k: "GST", v: taxV, sub: ex.tax.basis === "exclusive" ? "we compare without GST" : ex.tax.basis === "inclusive" ? "we take it out" : "we assume it is extra", warn: ex.tax.basis === "unclear" || ex.tax.basis === "mixed" },
    { k: "Delivery", v: ex.freight.included === true ? "To your plant, freight paid" : ex.freight.included === false ? "Ex-works, freight extra" : "Not stated", sub: ex.freight.included === false ? "we add freight" : undefined, warn: ex.freight.included === null },
    { k: "Payment", v: ex.payment_terms_days != null ? `${ex.payment_terms_days} days` : "Not stated", sub: askPay != null ? `you asked ${askPay} days` : undefined, warn: ex.payment_terms_days == null || (askPay != null && ex.payment_terms_days !== askPay) },
    { k: "Lead time", v: ex.lead_time_days != null ? `${ex.lead_time_days} days` : "Not stated", sub: "from order to delivery", warn: ex.lead_time_days == null },
    { k: "Price valid for", v: ex.validity_days != null ? `${ex.validity_days} days` : "Not stated", sub: askValid != null ? `you asked ${askValid} days` : undefined, warn: ex.validity_days == null || (askValid != null && ex.validity_days < askValid) },
  ];
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Terms in this quote</span>
        <span className="text-[11.5px] text-muted">Read from the quote so every price is compared on the same basis.</span>
      </div>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 border-y border-line py-3 lg:grid-cols-6">
        {items.map((i) => (
          <div key={i.k} className="min-w-0">
            <dt className="text-[11px] text-muted">{i.k}</dt>
            <dd className={cx("mt-0.5 text-[13px] font-medium", i.warn && "text-warn")}>
              {i.v}
              {i.sub && <div className={cx("text-[11px] font-normal", i.warn ? "text-warn" : "text-muted")}>{i.sub}</div>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AddResponse({ onCancel, onAdd, nextId, replacing, names }: { onCancel: () => void; onAdd: (v: VendorMsg, files: File[]) => void; nextId: string; replacing?: VendorMsg; names: string[] }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(replacing?.name || "");
  const [body, setBody] = useState("");
  const [picked, setFiles] = useState<File[]>([]);
  return (
    <div className="space-y-3 p-5">
      <div className="font-semibold">{replacing ? `Replace the response from ${replacing.name}` : "Add a vendor response"}</div>
      <div className="text-xs text-muted">Add whatever the vendor sent: a PDF, Excel or CSV file, a Word document, a phone photo, or paste the email text. It is read against your request exactly like the others.</div>
      <input list="levelset-vendors" className="w-full rounded-md border border-line px-3 py-2" placeholder="Vendor name" value={name} onChange={(e) => setName(e.target.value)} />
      <datalist id="levelset-vendors">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <textarea className="h-36 w-full rounded-md border border-line px-3 py-2 text-[13px]" placeholder="Paste the email body (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
      <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.docx,.jpg,.jpeg,.png,.txt" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || !name.trim() || (!body.trim() && !picked.length)}
          onClick={async () => {
            setBusy(true);
            const files = await Promise.all(picked.map(prepFile)); // big phone photos are shrunk to fit
            const small = files.reduce((a, f) => a + f.size, 0) < 1_500_000;
            const attachments = small ? await Promise.all(files.map(async (f) => `data:${f.type || mimeFor(f.name)};base64,${await fileToB64(f)}#name=${encodeURIComponent(f.name)}`)) : [];
            onAdd(
              {
                id: nextId,
                name: name.trim(),
                city: replacing?.city || "",
                contact: replacing?.contact || name.trim(),
                email: replacing?.email || "uploaded@manual",
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
          {replacing ? "Replace & read" : "Add & read"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
