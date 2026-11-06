import type { Rfx } from "./types";
import { buildLine } from "./spec";

export type Op = {
  op: string;
  target_id?: string | null;
  line?: any;
  question?: { text: string; kind: "yes_no" | "number" | "text"; must_have: boolean } | null;
  must_have?: boolean | null;
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

const hasVals = (x: any) => !!x && Object.values(x).some((v) => v !== null && v !== undefined && v !== "");

/** An edit that names a change but carries nothing to change. The model does this now and then: it says "updated" and sends an empty edit. */
export function incomplete(o: Op): string | null {
  if ((o.op === "add_line" || o.op === "update_line") && !hasVals(o.line)) return `${o.op === "add_line" ? "a new item" : o.target_id}: no details came through`;
  if (o.op === "update_question" && typeof o.must_have === "boolean") return null;
  if ((o.op === "add_question" || o.op === "update_question") && !hasVals(o.question)) return `${o.op === "add_question" ? "a new question" : o.target_id}: no details came through`;
  if (o.op === "set_meta" && !hasVals(o.meta)) return "event details: no details came through";
  if (o.op === "set_term" && (!o.term_key || o.term_value == null)) return "a term: no value came through";
  if (["update_line", "update_question", "remove_line", "remove_question"].includes(o.op) && !o.target_id) return `${o.op.replace("_", " ")}: no target`;
  return null;
}

/** A request title is a short name. If the model wrote its reasoning into it, keep only the name. */
export function cleanTitle(raw: string): string {
  let t = String(raw).replace(/\s+/g, " ").trim();
  if (t.length <= 90) return t;
  const m = /Title:\s*(.+?)(?:\.\s|\s+Scope:|$)/i.exec(t);
  if (m && m[1].length <= 90) return m[1].trim();
  const first = t.split(/(?<=[.?!])\s/)[0];
  if (first.length <= 90) return first.replace(/[.]$/, "");
  return t.slice(0, 90).replace(/\s+\S*$/, "").trim();
}

export function cleanScope(raw: string): string {
  const t = String(raw).replace(/\s+/g, " ").trim();
  return t.length <= 300 ? t : t.slice(0, 300).replace(/\s+\S*$/, "") + "…";
}

/** What a question update really changes, so the note and the screen agree. */
function changesOf(q: Record<string, any>, patch: Record<string, any>) {
  return Object.entries(patch).filter(([k, v]) => v !== null && v !== undefined && JSON.stringify(q[k]) !== JSON.stringify(v));
}

export function applyOps(rfx: Rfx, ops: Op[]): { rfx: Rfx; notes: string[]; failed: string[] } {
  const failed: string[] = [];
  const r: Rfx = structuredClone(rfx);
  const notes: string[] = [];
  for (const o of ops) {
    const bad = incomplete(o);
    if (bad) {
      failed.push(bad);
      continue;
    }
    try {
      if (o.op === "set_meta" && o.meta) {
        if (o.meta.title) r.title = cleanTitle(o.meta.title);
        if (o.meta.scope) r.scope = cleanScope(o.meta.scope);
        if (o.meta.due_date) r.due_date = o.meta.due_date;
        notes.push(`Updated event details — ${o.why}`);
      } else if (o.op === "add_line" && o.line && (!Number(o.line.length_mm) || !Number(o.line.width_mm))) {
        notes.push(`Couldn't add a line without its size. Say the dimensions in mm.`);
      } else if (o.op === "add_line" && o.line) {
        const id = nextId("L", r.lines.map((l) => l.id));
        const cand = buildLine({ ...o.line, is_new: o.line.is_new ?? r.id !== "RFX-NEW" }, id);
        // Same size, board and print as a line already on the request: vendors would price the same box twice.
        const twin = r.lines.find((l) => l.type === cand.type && l.ply === cand.ply && l.flute === cand.flute && l.print === cand.print && l.dimensions_mm.L === cand.dimensions_mm.L && l.dimensions_mm.W === cand.dimensions_mm.W && l.dimensions_mm.H === cand.dimensions_mm.H);
        if (twin) {
          failed.push(`${twin.id} is already this exact item (${twin.description}, ${twin.annual_qty.toLocaleString("en-IN")}/yr). To change the quantity, say "set ${twin.id} to ..." instead`);
          continue;
        }
        r.lines.push(cand);
        notes.push(`Added ${id}: ${cand.description} — ${o.why}`);
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
        const ch = changesOf(q, { ...(o.question || {}), ...(typeof o.must_have === "boolean" ? { must_have: o.must_have } : {}) });
        if (!ch.length) {
          failed.push(`${q.id}: the change did not come through`);
          continue;
        }
        Object.assign(q, Object.fromEntries(ch));
        notes.push(`Updated ${q.id}${ch.some(([k]) => k === "must_have") ? (q.must_have ? " (now a must-have)" : " (no longer a must-have)") : ""} — ${o.why}`);
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
  return { rfx: r, notes, failed };
}
