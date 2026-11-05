"use client";
import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import type { Assumptions, AuditEntry, CellOverride, ChatMsg, PriorContracts, Rfx, VendorMsg, VendorResponse } from "./types";
import seedRfx from "@/data/rfx.json";
import seedVendors from "@/data/vendors.json";
import seedPrior from "@/data/prior_contracts.json";

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
  sentAt: string | null;
  sentTo: string[];
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
    copilot: [
      {
        role: "assistant",
        text:
          "I've loaded the **FY27 corrugated packaging** event: 30 lines (~1,000 t/yr, ~₹4.4 Cr at market rates), a 9-question supplier questionnaire with 3 must-haves, and your standard terms. I\u2019ve also worked out each box\u2019s weight, so vendors who quote per kg can be compared fairly.\n\nTell me what to change — e.g. *\"add a 5-ply export carton 600×400×300, 30k a year\"* or *\"make FSC a must-have\"*.",
      },
    ],
    sentAt: null,
    sentTo: (seedVendors as VendorMsg[]).map((v) => v.id),
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
    copilot: [{ role: "assistant", text: "Tell me what you need to buy — category, rough volumes, where it ships to and when you need quotes. I'll draft the line items, a supplier questionnaire and terms, and ask only what I can't sensibly assume." }],
    sentTo: [],
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
const Ctx = createContext<{ s: State; set: (fn: (s: State) => State) => void; reset: (mode: "demo" | "blank") => void; log: (what: string) => void } | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, undefined, demoState);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.version === 3) dispatch({ type: "replace", state: { ...parsed, responses: parsed.responses.map((r: VendorResponse) => (r.status === "reading" ? { ...r, status: "new" } : r)) } });
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
  const log = (what: string) => set((x) => ({ ...x, audit: [{ at: new Date().toISOString(), who: x.rfx.buyer.name, what }, ...x.audit] }));
  return <Ctx.Provider value={{ s, set, reset, log }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("no store");
  return c;
}
