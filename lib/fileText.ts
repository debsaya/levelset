// Turn office files into text the model can cite by location.
import * as XLSX from "xlsx";
import mammoth from "mammoth";

export async function xlsxToText(buf: Buffer): Promise<string> {
  const wb = XLSX.read(buf, { type: "buffer", cellFormula: false });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    out.push(`=== Sheet "${name}" ===`);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v !== undefined && cell.v !== "") cells.push(`${addr}=${String(cell.v)}`);
      }
      if (cells.length) out.push(cells.join(" | "));
    }
  }
  return out.join("\n");
}

export async function docxToText(buf: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  let p = 0;
  const text = html
    .replace(/<\/(td|th)>/g, " | ")
    .replace(/<\/tr>/g, "\n")
    .replace(/<p>/g, () => `\n[para ${++p}] `)
    .replace(/<h\d>/g, "\n## ")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export type InFile = { name: string; mime: string; data: string };

export async function toParts(files: InFile[]) {
  const parts: Record<string, unknown>[] = [];
  for (const f of files) {
    const buf = Buffer.from(f.data, "base64");
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv") || f.mime.includes("spreadsheet")) {
      parts.push({ text: `--- FILE: ${f.name} (spreadsheet; cells shown as ADDRESS=value) ---\n${await xlsxToText(buf)}` });
    } else if (lower.endsWith(".docx") || f.mime.includes("wordprocessing")) {
      parts.push({ text: `--- FILE: ${f.name} (Word document; paragraphs numbered) ---\n${await docxToText(buf)}` });
    } else if (lower.endsWith(".pdf") || f.mime === "application/pdf") {
      parts.push({ text: `--- FILE: ${f.name} (PDF follows) ---` });
      parts.push({ inlineData: { mimeType: "application/pdf", data: f.data } });
    } else if (f.mime.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/.test(lower)) {
      parts.push({ text: `--- FILE: ${f.name} (image/photo follows) ---` });
      parts.push({ inlineData: { mimeType: f.mime.startsWith("image/") ? f.mime : "image/jpeg", data: f.data } });
    } else {
      parts.push({ text: `--- FILE: ${f.name} (text) ---\n${buf.toString("utf8")}` });
    }
  }
  return parts;
}
