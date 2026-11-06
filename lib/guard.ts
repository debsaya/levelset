// Shared checks for the AI routes: valid JSON, same-site callers only, a polite rate limit, and the right shape.
// The rate limit is per server instance (in memory), a safety net rather than a hard guarantee.
const hits = new Map<string, number[]>();

export function rateLimited(ip: string, bucket: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
  const k = bucket + ":" + ip;
  const recent = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(k, recent);
    return true;
  }
  recent.push(now);
  hits.set(k, recent);
  if (hits.size > 5000) for (const [key, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(key);
  return false;
}

const bad = (status: number, error: string) => Response.json({ error, status }, { status });

/** Browsers send these headers on their own; a page on another site cannot fake them. */
export function sameSite(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);

/** Reads the JSON body and checks it. Returns the body, or a ready-made error response. */
export async function guard(req: Request, bucket: string, check: (b: Record<string, any>) => string | null, max = 40): Promise<Record<string, any> | Response> {
  if (!sameSite(req)) return bad(403, "This service only answers requests from the Levelset page.");
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (rateLimited(ip, bucket, max)) return bad(429, "Too many requests in a short time. Wait a moment and try again.");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 12_000_000) return bad(413, "That is too large to send. Try smaller files.");
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return bad(400, "The request was not valid JSON.");
  }
  if (!isObj(body)) return bad(400, "The request body must be a JSON object.");
  const problem = check(body);
  if (problem) return bad(400, problem);
  return body;
}

export const need = {
  rfx: (b: Record<string, any>) => (isObj(b.rfx) && Array.isArray(b.rfx.lines) && Array.isArray(b.rfx.questionnaire) && isObj(b.rfx.terms) ? null : "Missing or invalid rfx."),
};

/** Turns internal errors into something a buyer can read. Quota and busy messages pass through: the client retries on them. */
export function friendly(msg: string): string {
  if (/quota|exceeded|RESOURCE_EXHAUSTED|429|high demand|overloaded|unavailable|503|504/i.test(msg)) return msg.slice(0, 200);
  if (/GenerateContentRequest|INVALID_ARGUMENT|"error"\s*:|Cannot read properties|is not iterable|undefined|JSON/i.test(msg)) return "The AI could not process that. Please try again, or rephrase it.";
  return msg.slice(0, 200);
}
