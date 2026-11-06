import master from "@/data/vendor_master.json";

export type PoolVendor = {
  id: string;
  name: string;
  contact: string;
  email: string;
  city: string;
  km: number | null;
  categories: string[];
  iso_valid_until: string | null;
  incumbent: boolean;
  history: string;
  /** where this vendor came into the list from */
  source: "master" | "upload" | "paste" | "manual";
};

export const MASTER = master as PoolVendor[];

export type Fit = { tone: "good" | "warn" | "bad" | "none"; text: string };

/** What the buyer needs to know about a vendor before inviting them. Plain facts from the record, worked out by code. */
export function certificate(v: PoolVendor, due: string): Fit {
  if (!v.iso_valid_until) return { tone: "warn", text: "No ISO 9001 on file" };
  if (v.iso_valid_until < due) return { tone: "bad", text: `ISO 9001 expired ${new Date(v.iso_valid_until).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` };
  return { tone: "good", text: `ISO 9001 to ${new Date(v.iso_valid_until).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` };
}

export const isCategory = (v: PoolVendor, cat = "corrugated") => v.categories.includes(cat);

/** A suggested shortlist, by rules the buyer can read: right category, a certificate that is not expired, near enough to deliver, and at least one vendor besides the incumbent. */
export function suggest(pool: PoolVendor[], due: string): { id: string; why: string }[] {
  const ok = pool.filter((v) => isCategory(v) && !(v.iso_valid_until && v.iso_valid_until < due) && (v.km == null || v.km <= 400));
  const inc = ok.filter((v) => v.incumbent);
  const certified = ok.filter((v) => !v.incumbent && v.iso_valid_until).sort((a, b) => (a.km ?? 999) - (b.km ?? 999));
  const picks = [...inc, ...certified.slice(0, 5 - inc.length)];
  return picks.map((v) => ({
    id: v.id,
    why: v.incumbent ? "Incumbent. Keeps the relationship and gives a price to compare against" : `${certificate(v, due).text}${v.km != null ? `, ${v.km} km from the plant` : ""}`,
  }));
}

/** Reads a list of vendors from pasted text or a spreadsheet's rows: "Name <email>", "Name, email", or just an email. */
export function parseVendorLines(lines: string[][], startId: number, source: PoolVendor["source"]): { vendors: PoolVendor[]; skipped: string[] } {
  const vendors: PoolVendor[] = [];
  const skipped: string[] = [];
  let id = startId;
  for (const cells of lines) {
    const joined = cells.map((c) => String(c ?? "").trim()).filter(Boolean).join(" ");
    if (!joined) continue;
    const email = /[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/.exec(joined)?.[0];
    if (!email || email.length > 120) {
      if (!/^(name|vendor|supplier)\b/i.test(joined)) skipped.push(joined.slice(0, 60));
      continue;
    }
    const rest = cells.map((c) => String(c ?? "").trim()).filter((c) => c && !c.includes(email));
    const name = (rest[0] || joined.replace(email, "").replace(/[<>(),;]/g, " ").trim() || email.split("@")[1].split(".")[0]).replace(/\s+/g, " ").slice(0, 80);
    vendors.push({ id: `V${id++}`, name, contact: name, email, city: (rest[1] || "").slice(0, 60), km: null, categories: ["corrugated"], iso_valid_until: null, incumbent: false, history: source === "upload" ? "Added from an uploaded list" : source === "paste" ? "Added from pasted emails" : "Added by hand", source });
  }
  return { vendors, skipped };
}
