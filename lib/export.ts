"use client";
import * as XLSX from "xlsx";
import type { Normalized } from "./normalize";
import type { Assumptions, AuditEntry, Rfx } from "./types";

export function downloadTable(name: string, columns: string[], rows: any[][], kind: "csv" | "xlsx") {
  const ws = XLSX.utils.aoa_to_sheet([columns, ...rows]);
  if (kind === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    trigger(new Blob([csv], { type: "text/csv" }), `${name}.csv`);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
    XLSX.writeFile(wb, `${name}.xlsx`);
  }
}

function trigger(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function exportWorkbook(rfx: Rfx, n: Normalized, a: Assumptions, audit: AuditEntry[]) {
  const wb = XLSX.utils.book_new();
  const vs = n.vendors;
  const cmp = [
    ["Line", "Description", "Annual qty", ...vs.map((v) => `${v.name} (₹/pc landed ex-GST)`), "Lowest", "Lowest vendor"],
    ...rfx.lines.map((l) => {
      const prices = vs.map((v) => n.cellMap[`${v.vendor_id}|${l.id}`]);
      const valid = prices.map((c, i) => ({ c, i })).filter(({ c }) => c && c.unit_inr !== null && c.status !== "deviation");
      const best = valid.sort((x, y) => x.c.unit_inr! - y.c.unit_inr!)[0];
      return [
        l.id,
        l.description,
        l.annual_qty,
        ...prices.map((c) => (!c ? "" : c.unit_inr === null ? c.status.toUpperCase() : `${c.unit_inr.toFixed(2)}${c.status === "review" ? " (review)" : c.status === "deviation" ? " (alt spec)" : ""}`)),
        best ? Number(best.c.unit_inr!.toFixed(2)) : "",
        best ? vs[best.i].name : "",
      ];
    }),
    [],
    ["", "Annual value, quoted lines", "", ...vs.map((v) => Math.round(v.total_inr))],
    ["", `Like-for-like basket (${n.basket.length} lines)`, "", ...vs.map((v) => Math.round(v.basket_total_inr))],
    ["", "Qualification", "", ...vs.map((v) => v.qualification)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmp), "Comparison");
  const detail = [
    ["Vendor", "Line", "Status", "Quoted as", "Unit ₹ landed ex-GST", "If conditional rebate", "Annual ₹", "₹/kg", "Confidence", "Calculation", "Flags", "Source file", "Source location", "Source quote", "Buyer action"],
    ...n.cells.map((c) => [
      vs.find((v) => v.vendor_id === c.vendor_id)?.name,
      c.line_id,
      c.status,
      c.quoted_as,
      c.unit_inr === null ? "" : Number(c.unit_inr.toFixed(4)),
      c.unit_inr_if_rebate === null ? "" : Number(c.unit_inr_if_rebate.toFixed(4)),
      c.annual_inr === null ? "" : Math.round(c.annual_inr),
      c.per_kg === null ? "" : Number(c.per_kg.toFixed(1)),
      c.confidence ?? "",
      c.steps.map((s) => `${s.label}: ${s.value}`).join(" | "),
      c.flags.map((f) => `[${f.sev}] ${f.msg}`).join(" | ") || c.missing_reason || "",
      c.source?.file ?? "",
      c.source?.location ?? "",
      c.source?.quote ?? "",
      c.override ? `${c.override.action}${c.override.unit_inr ? " " + c.override.unit_inr : ""} — ${c.override.note}` : "",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), "Cell detail & provenance");
  const q = [
    ["Vendor", "Question", "Must-have", "Answer", "Assessment", "Why", "System check", "Buyer overridden"],
    ...n.q.map((x) => {
      const qq = rfx.questionnaire.find((y) => y.id === x.question_id);
      return [vs.find((v) => v.vendor_id === x.vendor_id)?.name, `${x.question_id} ${qq?.text}`, qq?.must_have ? "yes" : "", x.answer, x.assessment, x.reasoning, x.auto_note || "", x.overridden ? "yes" : ""];
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(q), "Questionnaire");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Assumption", "Value"],
      ["USD→INR", a.fx_usd_inr],
      ["Freight ₹/kg (ex-works vendors)", JSON.stringify(a.freight_inr_per_kg)],
      ["Conditional rebates counted", a.apply_conditional_rebates ? "yes" : "no"],
      ["₹/kg sanity band", a.per_kg_band.join("–")],
      ["Review threshold", a.review_threshold],
      ["Review threshold for photos and scans", a.photo_review_threshold ?? 0.9],
    ]),
    "Assumptions"
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["When", "Who", "What"], ...audit.map((x) => [x.at, x.who, x.what])]), "Audit log");
  XLSX.writeFile(wb, `${rfx.id}_comparison.xlsx`);
}
