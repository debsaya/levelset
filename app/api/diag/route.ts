import { NextResponse } from "next/server";
import { rateLimited, sameSite } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 120;

// Times a tiny call on each candidate model so we can pick a healthy, fast one.
let cache: { at: number; data: unknown } | null = null;

export async function GET(req: Request) {
  if (cache && Date.now() - cache.at < 60_000) return NextResponse.json(cache.data); // one real check a minute, however often this is opened
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (!sameSite(req) && rateLimited(ip, "diag", 3)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const key = process.env.GEMINI_API_KEY;
  const models = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];
  const out = await Promise.all(
    models.map(async (m) => {
      const t0 = Date.now();
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key || "" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the word ok." }] }] }),
          signal: AbortSignal.timeout(60000),
        });
        return { model: m, status: r.status, ms: Date.now() - t0 };
      } catch (e: any) {
        return { model: m, status: 0, ms: Date.now() - t0, err: e?.name };
      }
    })
  );
  cache = { at: Date.now(), data: out };
  return NextResponse.json(out);
}
