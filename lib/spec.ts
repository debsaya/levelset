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
  return `${l.ply}-ply ${l.type} ${dims}, ${l.flute}-flute, ${l.print}`;
}

export function buildLine(p: any, id: string): RfxLine {
  const ply = Number(p.ply) || 3;
  const flute = p.flute || (ply === 3 ? "B" : ply === 5 ? "BC" : "BCB");
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
