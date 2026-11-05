import type { Rfx } from "./types";
import { buildLine } from "./spec";

export type Op = {
  op: string;
  target_id?: string | null;
  line?: any;
  question?: { text: string; kind: "yes_no" | "number" | "text"; must_have: boolean } | null;
  term_key?: string | null;
  term_value?: string | null;
  meta?: { title?: string | null; scope?: string | null; due_date?: string | null } | null;
  why: string;
};

function nextId(prefix: string, ids: string[]) {
  const n = ids.map((i) => parseInt(i.replace(/\D/g, ""), 10)).filter((x) => !isNaN(x));
  const m = n.length ? Math.max(...n) + 1 : 1;
  return `${prefix}${String(m).padStart(2, "0")}`;
}

export function applyOps(rfx: Rfx, ops: Op[]): { rfx: Rfx; notes: string[] } {
  const r: Rfx = structuredClone(rfx);
  const notes: string[] = [];
  for (const o of ops) {
    try {
      if (o.op === "set_meta" && o.meta) {
        if (o.meta.title) r.title = o.meta.title;
        if (o.meta.scope) r.scope = o.meta.scope;
        if (o.meta.due_date) r.due_date = o.meta.due_date;
        notes.push(`Updated event details — ${o.why}`);
      } else if (o.op === "add_line" && o.line && (!Number(o.line.length_mm) || !Number(o.line.width_mm))) {
        notes.push(`Couldn't add a line without its size. Say the dimensions in mm.`);
      } else if (o.op === "add_line" && o.line) {
        const id = nextId("L", r.lines.map((l) => l.id));
        r.lines.push(buildLine({ ...o.line, is_new: o.line.is_new ?? r.id !== "RFX-NEW" }, id));
        notes.push(`Added ${id}: ${r.lines[r.lines.length - 1].description} — ${o.why}`);
      } else if (o.op === "update_line" && o.target_id) {
        const i = r.lines.findIndex((l) => l.id === o.target_id);
        if (i < 0) continue;
        const cur = r.lines[i];
        const merged: Record<string, any> = {
          type: cur.type,
          ply: cur.ply,
          length_mm: cur.dimensions_mm.L,
          width_mm: cur.dimensions_mm.W,
          height_mm: cur.dimensions_mm.H,
          flute: cur.flute,
          print: cur.print,
          end_use: cur.end_use,
          annual_qty: cur.annual_qty,
          uom: cur.uom,
          is_new: cur.is_new,
          ...Object.fromEntries(Object.entries(o.line || {}).filter(([, v]) => v !== null && v !== undefined)),
        };
        if (o.line && o.line.ply && !o.line.flute) merged.flute = null;
        r.lines[i] = buildLine(merged, cur.id);
        notes.push(`Updated ${cur.id} — ${o.why}`);
      } else if (o.op === "remove_line" && o.target_id) {
        r.lines = r.lines.filter((l) => l.id !== o.target_id);
        notes.push(`Removed ${o.target_id} — ${o.why}`);
      } else if (o.op === "add_question" && o.question) {
        const id = nextId("Q", r.questionnaire.map((q) => q.id));
        r.questionnaire.push({ id, ...o.question });
        notes.push(`Added ${id}${o.question.must_have ? " (must-have)" : ""} — ${o.why}`);
      } else if (o.op === "update_question" && o.target_id) {
        const q = r.questionnaire.find((x) => x.id === o.target_id);
        if (!q) continue;
        Object.assign(q, Object.fromEntries(Object.entries(o.question || {}).filter(([, v]) => v !== null && v !== undefined)));
        notes.push(`Updated ${q.id} — ${o.why}`);
      } else if (o.op === "remove_question" && o.target_id) {
        r.questionnaire = r.questionnaire.filter((q) => q.id !== o.target_id);
        notes.push(`Removed ${o.target_id} — ${o.why}`);
      } else if (o.op === "set_term" && o.term_key) {
        r.terms[o.term_key] = o.term_value || "";
        notes.push(`Term "${o.term_key}" — ${o.why}`);
      } else if (o.op === "remove_term" && o.term_key) {
        delete r.terms[o.term_key];
        notes.push(`Removed term "${o.term_key}" — ${o.why}`);
      }
    } catch {
      notes.push(`Skipped an edit I couldn't apply (${o.op}).`);
    }
  }
  return { rfx: r, notes };
}
