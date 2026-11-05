"use client";
import { useStore } from "./store";
import type { VendorResponse } from "./types";
import { fileToB64, mimeFor } from "@/components/ui";
import { postJson } from "./api";

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
      const pc = s.prior[r.vendor.id];
      const j: any = await postJson("/api/extract", { vendor: r.vendor, files, rfx: s.rfx, prior: pc ? { contract_ref: pc.contract_ref, period: pc.period, line_ids: Object.keys(pc.prices) } : null });
      if (j.error) throw new Error(j.error);
      patch(r.vendor.id, { status: "done", extraction: j.extraction, model: j.model, ms: j.ms });
      log(`Read quote from ${r.vendor.name} (${j.extraction.lines?.length ?? 0} prices, ${(j.ms / 1000).toFixed(0)}s)`);
    } catch (e: any) {
      patch(r.vendor.id, { status: "error", error: e.message || "Couldn't reach the reader. Try again." });
    }
  }

  async function readAll() {
    if (!s.sentAt) set((x) => ({ ...x, sentAt: new Date().toISOString() }));
    const queue = s.responses.filter((r) => r.status !== "done" && r.status !== "reading");
    const worker = async () => {
      while (queue.length) await read(queue.shift()!);
    };
    await Promise.all([worker(), worker()]);
  }
  return { read, readAll };
}
