// Deterministic packaging engineering helpers. The co-pilot proposes specs; this code computes weights.
import type { RfxLine } from "./types";

const BOARD_GSM: Record<number, number> = { 3: 450, 5: 750, 7: 1050 };
export const GSM_SPEC: Record<number, string> = { 3: "150/120/150", 5: "150/120/120/120/150", 7: "180/120/150/120/150/120/180" };
export const BF_SPEC: Record<number, string> = { 3: "18 BF", 5: "20 BF", 7: "22 BF" };

export function boardGsm(ply: number, flute: string) {
  if (flute === "E") return 400;
  return BOARD_GSM[ply] ?? 450 + (ply - 3) * 150;
}

export function blankAreaM2(type: string, L: number, W: number, H: number) {
  const t = type.toLowerCase();
  if (t.includes("partition")) {
    const cells = L >= 400 ? 9 : 12;
    const nLong = cells === 9 ? 2 : 3;
    return (nLong * L * H + 2 * W * H) / 1e6;
  }
  if (t.includes("pad")) return (L * W) / 1e6;
  if (t.includes("tray")) return ((L + 2 * H + 30) * (W + 2 * H + 30)) / 1e6;
  if (t.includes("crash")) return ((2 * L + 2 * W + 40) * (W + H + 40)) / 1e6;
  if (t.includes("sleeve")) return ((2 * W + 2 * H + 30) * L) / 1e6;
  return ((2 * L + 2 * W + 40) * (W + H)) / 1e6; // RSC
}

export function estWeightKg(type: string, ply: number, flute: string, L: number, W: number, H: number) {
  return Math.round(blankAreaM2(type, L, W, H) * boardGsm(ply, flute)) / 1000;
}

export function describeLine(l: Pick<RfxLine, "type" | "ply" | "dimensions_mm" | "flute" | "print">) {
  const { L, W, H } = l.dimensions_mm;
  const dims = H ? `${L} x ${W} x ${H} mm` : `${L} x ${W} mm`;
  return `${l.ply}-ply ${l.type} ${dims}, ${String(l.flute).replace(/[-\s]*flute/gi, "")}-flute, ${l.print}`;
}

/** Lines saved by an older version of the app can carry a flute written as "BC-flute" and a description that reads "BC-flute-flute". Tidy both when saved data is loaded, so old data never shows the typo. */
export function tidyLines<T extends { lines: RfxLine[] }>(r: T): T {
  return {
    ...r,
    lines: r.lines.map((l) => {
      const given = String(l.flute ?? "").replace(/flute/gi, "").replace(/[^A-Za-z]/g, "").toUpperCase();
      const flute = /^[A-Z]{1,3}$/.test(given) ? given : l.flute;
      const fixed = { ...l, flute };
      return { ...fixed, description: describeLine(fixed) };
    }),
  };
}

export function buildLine(p: any, id: string): RfxLine {
  const ply = Number(p.ply) || 3;
  // The model sometimes writes "BC-flute" or "b flute"; keep only the letters so the description never reads "BC-flute-flute".
  const given = String(p.flute ?? "").replace(/flute/gi, "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const flute = /^[A-Z]{1,3}$/.test(given) ? given : ply === 3 ? "B" : ply === 5 ? "BC" : "BCB";
  const dims = { L: Number(p.length_mm) || 0, W: Number(p.width_mm) || 0, H: Number(p.height_mm) || 0 };
  const type = p.type || "RSC";
  const print = p.print || "Plain";
  const line: RfxLine = {
    id,
    description: "",
    type,
    ply,
    dimensions_mm: dims,
    flute,
    board_gsm: flute === "E" ? "E-flute 120/100/120 + 250 GSM duplex top" : GSM_SPEC[ply] || "",
    bursting_factor: BF_SPEC[ply] || "",
    print,
    end_use: p.end_use || "",
    annual_qty: Number(p.annual_qty) || 0,
    uom: p.uom || (type.toLowerCase().includes("partition") ? "set" : "piece"),
    est_weight_kg: estWeightKg(type, ply, flute, dims.L, dims.W, dims.H),
    is_new: !!p.is_new,
  };
  line.description = describeLine(line);
  return line;
}

/** A request title as it reads mid-sentence: ordinary words go lowercase, but acronyms and codes ("FY27", "RFQ", "3PL") keep their capitals. */
export function titleInSentence(title: string) {
  return title.replace(/[^\s—–-]+/g, (w) => (/[A-Z]{2,}|\d/.test(w) ? w : w.toLowerCase()));
}
