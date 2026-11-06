"use client";
import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import type { Assumptions, AuditEntry, CellOverride, ChatMsg, PriorContracts, Rfx, VendorMsg, VendorResponse } from "./types";
import seedRfx from "@/data/rfx.json";
import seedVendors from "@/data/vendors.json";
import seedPrior from "@/data/prior_contracts.json";
import savedRaw from "@/data/saved_reading.json";
import { MASTER, type PoolVendor } from "./vendorpool";
import { tidyLines } from "./spec";

const savedReading = savedRaw as unknown as { recorded_at: string | null; extractions: Record<string, { extraction: any; model?: string; ms?: number }> };
/** true once a real reading of the five demo quotes has been recorded (see scripts/record_reading.mjs) */
export const hasSavedReading = Object.keys(savedReading.extractions).length > 0;

export type Block =
  | { kind: "table"; title: string; columns: string[]; rows: any[][]; note?: string; sql: string; error?: string }
  | { kind: "chart"; title: string; chart_type: string; x: string; y: string[]; y_label?: string; columns: string[]; rows: any[][]; sql: string; error?: string };

export type AnalystMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; blocks: Block[]; trace: { tool: string; sql: string; rows?: number; error?: string }[]; grounding?: { checked: number; ungrounded: string[] }; model?: string; error?: string };

export type State = {
  version: number;
  mode: "demo" | "blank";
  rfx: Rfx;
  copilot: ChatMsg[];
  /** edits asked for after the request was sent: kept apart until the buyer sends them to vendors as an amendment */
  rfxDraft?: Rfx | null;
  /** 1 for the request as first sent; goes up by one each time an amendment is sent */
  revision?: number;
  sentAt: string | null;
  /** the vendors this request goes to. Editable until it is sent. */
  sentTo: string[];
  /** every vendor the buyer can pick from: the vendor list plus anyone added by upload, paste or hand */
  pool?: PoolVendor[];
  /** vendor id → when the buyer last sent a reminder */
  reminded?: Record<string, string>;
  /** vendor id → the last "questions for the vendor" email the buyer marked as sent */
  asked?: Record<string, { at: string; subject: string; points: number }>;
  responses: VendorResponse[];
  assumptions: Assumptions;
  overrides: Record<string, CellOverride>;
  qOverrides: Record<string, "pass" | "fail" | "partial" | "unanswered">;
  audit: AuditEntry[];
  analyst: AnalystMsg[];
  analystHistory: any[];
  analystArchive?: { id: string; at: string; title: string; analyst: AnalystMsg[]; analystHistory: any[] }[];
  prior: PriorContracts;
};

const DEMO_ASSUMPTIONS: Assumptions = {
  fx_usd_inr: 88.2,
  freight_inr_per_kg: { V2: 2.2, V4: 0.35, V5: 0.6 },
  default_freight_inr_per_kg: 1.0,
  apply_conditional_rebates: false,
  per_kg_band: [25, 90],
  review_threshold: 0.8,
  photo_review_threshold: 0.9,
};

export function demoState(): State {
  return {
    version: 3,
    mode: "demo",
    rfx: structuredClone(seedRfx) as Rfx,
    copilot: [],
    rfxDraft: null,
    revision: 1,
    sentAt: null,
    sentTo: (seedVendors as VendorMsg[]).map((v) => v.id),
    pool: structuredClone(MASTER),
    reminded: {},
    responses: (seedVendors as VendorMsg[]).map((v) => ({ vendor: v, status: "new" })),
    assumptions: structuredClone(DEMO_ASSUMPTIONS),
    overrides: {},
    qOverrides: {},
    audit: [],
    analyst: [],
    analystHistory: [],
    prior: seedPrior as PriorContracts,
  };
}

/** The demo event with the request sent and the five quotes already read, from the recorded reading. Without a recording the quotes arrive unread. */
export function exampleState(): State {
  const s = demoState();
  return {
    ...s,
    sentAt: "2026-11-12T10:00:00+05:30",
    responses: s.responses.map((r) => {
      const e = savedReading.extractions[r.vendor.id];
      return e ? { ...r, status: "done" as const, extraction: e.extraction, model: `saved run (${e.model || "AI"})`, ms: e.ms } : r;
    }),
  };
}

/** Sending the request: from here the vendor list is fixed, and only invited vendors can reply. */
export function markSent(x: State): State {
  if (x.sentAt) return x;
  return { ...x, sentAt: new Date().toISOString(), responses: x.mode === "demo" ? x.responses.filter((r) => x.sentTo.includes(r.vendor.id)) : x.responses };
}

export function blankState(): State {
  const s = demoState();
  return {
    ...s,
    mode: "blank",
    rfx: {
      id: "RFX-NEW",
      title: "Untitled request",
      buyer: s.rfx.buyer,
      scope: "",
      currency: "INR",
      due_date: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
      lines: [],
      questionnaire: [],
      terms: {},
    },
    copilot: [],
    sentTo: [],
    pool: structuredClone(MASTER),
    reminded: {},
    responses: [],
    prior: {},
    assumptions: { ...s.assumptions, freight_inr_per_kg: {} },
  };
}

type Action = { type: "set"; fn: (s: State) => State } | { type: "replace"; state: State };

function reducer(s: State, a: Action): State {
  if (a.type === "replace") return a.state;
  return a.fn(s);
}

const KEY = "levelset-state-v3";
const Ctx = createContext<{ s: State; set: (fn: (s: State) => State) => void; reset: (mode: "demo" | "blank") => void; loadExample: () => void; log: (what: string) => void; hydrated: boolean } | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, undefined, demoState);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const base = demoState();
        const ok = parsed?.version === 3 && Array.isArray(parsed.rfx?.lines) && Array.isArray(parsed.rfx?.questionnaire) && parsed.rfx?.terms && typeof parsed.rfx.terms === "object" && Array.isArray(parsed.responses) && parsed.responses.every((r: any) => r?.vendor && typeof r.status === "string");
        // Saved by an older or odd version of the app: start clean rather than draw a half-matching screen.
        if (ok)
          dispatch({
            type: "replace",
            state: {
              ...base,
              ...parsed,
              rfx: tidyLines(parsed.rfx),
              rfxDraft: parsed.rfxDraft && Array.isArray(parsed.rfxDraft.lines) ? tidyLines(parsed.rfxDraft) : null,
              assumptions: { ...base.assumptions, ...(parsed.assumptions || {}) },
              sentTo: Array.isArray(parsed.sentTo) ? parsed.sentTo : base.sentTo,
              pool: Array.isArray(parsed.pool) ? parsed.pool : structuredClone(MASTER),
              reminded: parsed.reminded || {},
              asked: parsed.asked && typeof parsed.asked === "object" ? parsed.asked : {},
              overrides: parsed.overrides || {},
              qOverrides: parsed.qOverrides || {},
              audit: Array.isArray(parsed.audit) ? parsed.audit : [],
              analyst: Array.isArray(parsed.analyst) ? parsed.analyst : [],
              analystHistory: Array.isArray(parsed.analystHistory) ? parsed.analystHistory : [],
              prior: parsed.prior && typeof parsed.prior === "object" ? parsed.prior : base.prior,
              copilot: (Array.isArray(parsed.copilot) ? parsed.copilot : []).filter((m: ChatMsg, i: number) => !(i === 0 && m.role === "assistant" && /^(I.ve loaded the|Tell me what you need to buy)/.test(m.text))),
              responses: parsed.responses.map((r: VendorResponse) => (r.status === "reading" ? { ...r, status: "new" } : r)),
            },
          });
        else localStorage.removeItem(KEY);
      }
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [s, hydrated]);
  const set = (fn: (s: State) => State) => dispatch({ type: "set", fn });
  const reset = (mode: "demo" | "blank") => dispatch({ type: "replace", state: mode === "demo" ? demoState() : blankState() });
  const loadExample = () => dispatch({ type: "replace", state: exampleState() });
  const log = (what: string) => set((x) => ({ ...x, audit: [{ at: new Date().toISOString(), who: x.rfx.buyer.name, what }, ...x.audit] }));
  return <Ctx.Provider value={{ s, set, reset, loadExample, log, hydrated }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("no store");
  return c;
}
