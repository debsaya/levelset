"use client";
import { markSent, useStore } from "./store";
import type { VendorResponse } from "./types";
import { fileToB64, mimeFor } from "@/components/ui";
import { postJson } from "./api";
import savedRaw from "@/data/saved_reading.json";

const saved = savedRaw as unknown as { recorded_at: string | null; extractions: Record<string, { extraction: any; model?: string; ms?: number }> };

export function fileName(url: string) {
  return url.includes("#name=") ? decodeURIComponent(url.split("#name=")[1]) : url.split("/").pop()!;
}

/** Sends a vendor's email + attachments to the extractor. Shared by Overview and Quotes. */
export function useReader() {
  const { s, set, log } = useStore();
  const patch = (id: string, p: Partial<VendorResponse>) => set((x) => ({ ...x, responses: x.responses.map((r) => (r.vendor.id === id ? { ...r, ...p } : r)) }));

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
      const bytes = files.reduce((a, f) => a + f.data.length, 0); // base64 text; the host rejects bodies over about 4.5 MB
      if (bytes > 4_000_000) throw new Error("Those files are too large for this demo (about 3 MB in total). Try fewer or smaller files, or one at a time.");
      const pc = s.prior[r.vendor.id];
      const j: any = await postJson("/api/extract", { vendor: r.vendor, files, rfx: s.rfx, prior: pc ? { contract_ref: pc.contract_ref, period: pc.period, line_ids: Object.keys(pc.prices) } : null }, 3, { kind: "extract", label: r.vendor.name });
      if (j.error) throw new Error(j.error);
      patch(r.vendor.id, { status: "done", extraction: j.extraction, model: j.model, ms: j.ms });
      log(`Read quote from ${r.vendor.name} (${j.extraction.lines?.length ?? 0} prices, ${(j.ms / 1000).toFixed(0)}s)`);
    } catch (e: any) {
      patch(r.vendor.id, { status: "error", error: e.message || "Couldn't reach the reader. Try again." });
    }
  }

  /** Reads every unread quote at once. All of them show "reading" straight away, so nothing looks stuck waiting its turn. */
  async function readAll() {
    if (!s.sentAt && s.mode === "demo") set(markSent);
    const queue = s.responses.filter((r) => r.status !== "done" && r.status !== "reading" && (s.mode !== "demo" || s.sentAt || s.sentTo.includes(r.vendor.id)));
    if (!queue.length) return;
    set((x) => ({ ...x, responses: x.responses.map((r) => (queue.some((q) => q.vendor.id === r.vendor.id) ? { ...r, status: "reading" as const, error: undefined } : r)) }));
    await Promise.all(queue.map((r) => read(r)));
  }
  const hasSaved = Object.keys(saved.extractions).length > 0;
  /** Fallback for a flaky connection or an exhausted AI quota: real results from an earlier live run, labelled as such. */
  function loadSaved() {
    let n = 0;
    for (const r of s.responses) {
      const e = saved.extractions[r.vendor.id];
      if (e && r.status !== "done") {
        patch(r.vendor.id, { status: "done", extraction: e.extraction, model: `saved run (${e.model || "AI"})`, ms: e.ms, error: undefined });
        n++;
      }
    }
    if (n) log(`Loaded saved reading for ${n} quote(s), recorded from a live run on ${saved.recorded_at ? new Date(saved.recorded_at).toLocaleDateString("en-IN") : "an earlier date"}`);
  }
  return { read, readAll, hasSaved, loadSaved, savedAt: saved.recorded_at };
}
