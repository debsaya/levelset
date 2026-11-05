// Checks that every figure in the analyst's prose traces back to a query result from the same turn.
export type GroundReport = { checked: number; ungrounded: string[] };

const NUM_RE = /(₹|Rs\.?|USD|\$)?\s?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(crore|cr|lakh|lakhs|lac|l\b|k\b|%|\/kg|kg)?/gi;

function parse(m: RegExpExecArray): { value: number; display: string; pct: boolean } | null {
  const raw = m[2].replace(/,/g, "");
  let v = parseFloat(raw);
  if (isNaN(v)) return null;
  const suf = (m[3] || "").toLowerCase();
  if (suf === "crore" || suf === "cr") v *= 1e7;
  else if (suf.startsWith("lakh") || suf === "lac" || suf === "l") v *= 1e5;
  else if (suf === "k") v *= 1e3;
  return { value: v, display: m[0].trim(), pct: suf === "%" };
}

function decimalsShown(s: string) {
  const d = s.replace(/[^\d.]/g, "").split(".")[1];
  return d ? d.length : 0;
}

export function checkGrounding(text: string, resultNumbers: number[]): GroundReport {
  const pool = resultNumbers.filter((x) => typeof x === "number" && isFinite(x));
  const ungrounded: string[] = [];
  let checked = 0;
  const cleaned = text.replace(/\b[LQV]\d{1,2}\b/g, " ").replace(/\b20\d\d\b/g, " ").replace(/FY\d\d/gi, " ").replace(/\bISO[\s-]?\d{3,5}(?::\d{4})?/gi, " ").replace(/\b\d{4,5}:\d{4}\b/g, " ");
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(cleaned))) {
    const p = parse(m);
    if (!p) continue;
    if (!m[1] && !m[3] && p.value < 10 && Number.isInteger(p.value)) continue; // small counts ("3 vendors")
    checked++;
    const d = decimalsShown(m[2]);
    const scaleTol = m[3] && /cr|crore|lakh|lac|l|k/i.test(m[3]) ? 0.006 : 0;
    const ok = pool.some((r) => {
      const cands = p.pct ? [r, r * 100] : [r, Math.abs(r)];
      return cands.some((c) => {
        const tol = Math.max(0.5 * Math.pow(10, -d) * (scaleTol ? 0 : 1), Math.abs(c) * Math.max(scaleTol, 0.0005));
        return Math.abs(Math.abs(c) - p.value) <= tol + 1e-9;
      });
    });
    if (!ok) ungrounded.push(p.display);
  }
  return { checked, ungrounded: Array.from(new Set(ungrounded)) };
}
