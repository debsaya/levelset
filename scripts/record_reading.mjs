// Records one real reading of the five demo quotes through the running app (npm run build && npm start),
// and saves it to data/saved_reading.json. The app uses it for the "finished example" and as the offline backup.
// Usage: node scripts/record_reading.mjs [http://localhost:3123]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const base = process.argv[2] || "http://localhost:3123";
const root = process.cwd();
const j = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const rfx = j("rfx.json"), vendors = j("vendors.json"), prior = j("prior_contracts.json");
const mime = (n) => (/\.pdf$/i.test(n) ? "application/pdf" : /\.xlsx$/i.test(n) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.docx$/i.test(n) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : /\.jpe?g$/i.test(n) ? "image/jpeg" : /\.png$/i.test(n) ? "image/png" : "text/plain");
const out = { recorded_at: new Date().toISOString(), extractions: {} };
async function one(v) {
  const files = v.attachments.map((a) => ({ name: a.split("/").pop(), mime: mime(a), data: readFileSync(join(root, "public", a)).toString("base64") }));
  const pc = prior[v.id];
  const body = { vendor: v, files, rfx, prior: pc ? { contract_ref: pc.contract_ref, period: pc.period, line_ids: Object.keys(pc.prices) } : null };
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${base}/api/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const r = JSON.parse((await res.text()).trim());
    if (!r.error) { out.extractions[v.id] = { extraction: r.extraction, model: r.model, ms: r.ms }; console.log(v.id, "ok", r.model, Math.round(r.ms / 1000) + "s", r.extraction.lines.length, "lines"); return; }
    console.log(v.id, "error", r.error.slice(0, 160)); await new Promise((k) => setTimeout(k, 5000 * (i + 1)));
  }
  console.log(v.id, "FAILED");
}
const queue = [...vendors];
await Promise.all([0, 1].map(async () => { while (queue.length) await one(queue.shift()); }));
if (Object.keys(out.extractions).length === vendors.length) { writeFileSync(join(root, "data", "saved_reading.json"), JSON.stringify(out)); console.log("saved", Object.keys(out.extractions).length, "readings"); }
else console.log("not saved: only", Object.keys(out.extractions).length, "of", vendors.length);
