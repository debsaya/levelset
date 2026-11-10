// Thin REST client for the Gemini API with model fallback and retry.
// Server-only: the API key never reaches the browser.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Models that just told us their quota is used up are skipped for a while (per server instance).
const exhausted = new Map<string, number>();

export function modelChain(): string[] {
  const fromEnv = (process.env.GEMINI_MODEL || "").split(",").map((s) => s.trim()).filter(Boolean);
  const defaults = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-flash-latest", "gemini-3.5-flash-lite"];
  const all = Array.from(new Set([...fromEnv, ...defaults]));
  const ok = all.filter((m) => (exhausted.get(m) || 0) < Date.now());
  return ok.length ? ok : all;
}

export type GeminiPart = Record<string, unknown>;
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

type Req = {
  system?: string;
  contents: GeminiContent[];
  responseSchema?: unknown;
  tools?: unknown[];
  thinking?: "low" | "high";
  maxOutputTokens?: number;
  /** epoch ms after which no new attempt starts and in-flight calls are cut */
  deadline?: number;
  /** longest one call may take before we give up on that model and try the next (a stuck model must not eat the whole budget) */
  attemptMs?: number;
  /** small, simple input: try the lightest model first (it answers in seconds) and fall back to the stronger ones */
  fast?: boolean;
  /** stream the answer: called with each new piece of text, and with null when what was shown must be thrown away (a retry or another model starts) */
  onText?: (delta: string | null) => void;
};

export class GeminiError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

/** Read a streamed (SSE) Gemini reply into the same shape generateContent returns. Parts are kept exactly as sent so thought signatures survive. */
export async function readSse(res: Response, onText: (d: string) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finishReason: string | undefined;
  const parts: any[] = [];
  const add = (p: any) => {
    const last = parts[parts.length - 1];
    if (typeof p.text === "string" && !p.functionCall) {
      if (last && typeof last.text === "string" && !last.functionCall && !!last.thought === !!p.thought) {
        last.text += p.text;
        if (p.thoughtSignature) last.thoughtSignature = p.thoughtSignature;
      } else parts.push({ ...p });
      if (!p.thought && p.text) onText(p.text);
    } else parts.push(p);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      let j: any;
      try {
        j = JSON.parse(d);
      } catch {
        continue;
      }
      if (j.error) throw new GeminiError(`${j.error.message || "stream error"}`, j.error.code || 502);
      const c = j.candidates?.[0];
      for (const p of c?.content?.parts || []) add(p);
      if (c?.finishReason) finishReason = c.finishReason;
    }
  }
  return { candidates: [{ content: { role: "model", parts }, finishReason }] };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function thinkingConfig(model: string, level: "low" | "high") {
  if (/gemini-(3|4)/.test(model)) return { thinkingLevel: level };
  if (/2\.5/.test(model)) return { thinkingBudget: level === "low" ? 1024 : 4096 };
  return undefined;
}

export async function generate(req: Req): Promise<{ model: string; content: GeminiContent; text: string; raw: any; attempts: string[] }> {
  const attempts: string[] = [];
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("The AI reader is not set up on this server (no API key).", 500);
  let lastErr: GeminiError | null = null;
  const chain = modelChain();
  const order = req.fast ? [...chain.filter((m) => /lite/.test(m)), ...chain.filter((m) => !/lite/.test(m))] : chain;
  for (const model of order) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const generationConfig: Record<string, unknown> = {};
      if (req.responseSchema) {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = req.responseSchema;
      }
      if (req.maxOutputTokens) generationConfig.maxOutputTokens = req.maxOutputTokens;
      const tc = attempt < 2 ? thinkingConfig(model, req.thinking || "low") : undefined;
      if (tc) generationConfig.thinkingConfig = tc;
      const body: Record<string, unknown> = { contents: req.contents, generationConfig };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
      if (req.tools) body.tools = req.tools;
      let res: Response;
      const tStart = Date.now();
      const left = (req.deadline ?? Date.now() + 280_000) - Date.now();
      if (left < 5000) throw lastErr || new GeminiError("Ran out of time waiting for the AI service. Try again.", 504);
      try {
        res = await fetch(req.onText ? `${BASE}/${model}:streamGenerateContent?alt=sse` : `${BASE}/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(req.attemptMs ? Math.min(left, req.attemptMs) : left),
        });
      } catch (e: any) {
        if (e?.name === "TimeoutError" || e?.name === "AbortError") {
          if (req.attemptMs && left > req.attemptMs) {
            attempts.push(`${model}:timeout:${Date.now() - tStart}ms`);
            lastErr = new GeminiError(`${model} did not answer in time`, 504);
            break; // this model is stuck: go to the next one
          }
          throw new GeminiError("The AI service took too long. Try again.", 504);
        }
        lastErr = new GeminiError(`Network error calling Gemini: ${e?.message}`, 502);
        await sleep(800);
        continue;
      }
      attempts.push(`${model}:${res.status}:${Date.now() - tStart}ms`);
      if (res.ok) {
        let raw: any;
        let shown = false;
        try {
          raw = req.onText ? await readSse(res, (d) => ((shown = true), req.onText!(d))) : await res.json();
        } catch (e: any) {
          if (shown) req.onText?.(null);
          if (e?.name === "TimeoutError" || e?.name === "AbortError") {
            if (req.attemptMs && left > req.attemptMs) {
              attempts.push(`${model}:stream-timeout:${Date.now() - tStart}ms`);
              lastErr = new GeminiError(`${model} did not answer in time`, 504);
              break;
            }
            throw new GeminiError("The AI service took too long. Try again.", 504);
          }
          lastErr = e instanceof GeminiError ? e : new GeminiError(`Stream from ${model} broke: ${e?.message}`, 502);
          continue;
        }
        const cand = raw?.candidates?.[0];
        const content: GeminiContent = cand?.content || { role: "model", parts: [] };
        if (!content.parts) content.parts = [];
        const text = content.parts.filter((p: any) => typeof p.text === "string" && !p.thought).map((p: any) => p.text).join("");
        if (!content.parts.length) {
          lastErr = new GeminiError(`Empty response from ${model} (finishReason: ${cand?.finishReason || "unknown"})`, 502);
          if (shown) req.onText?.(null);
          continue;
        }
        return { model, content, text, raw, attempts };
      }
      const errText = await res.text();
      lastErr = new GeminiError(`${model}: ${res.status} ${errText.slice(0, 300)}`, res.status);
      if (res.status === 404) break; // model not available: try next model
      if (res.status === 400 && /thinking/i.test(errText)) continue; // retry without thinking config
      if (res.status === 400) break;
      if (res.status === 429 && /quota|exceeded|limit/i.test(errText)) {
        exhausted.set(model, Date.now() + 10 * 60_000);
        break; // quota used up: go straight to the next model, don't wait
      }
      if (res.status === 429 || res.status >= 500) {
        const m = errText.match(/retry in ([\d.]+)s/i);
        const wait = m ? Math.min(parseFloat(m[1]) * 1000, 8000) : 2500 * (attempt + 1);
        if (attempt < 1) { // one short retry, then the next model: waiting on a busy one costs more than switching
          await sleep(res.status === 503 ? 2500 * (attempt + 1) : wait);
          continue;
        }
        break; // quota exhausted for this model: fall back to the next one
      }
      break;
    }
  }
  throw lastErr || new GeminiError("Gemini call failed", 500);
}

export function parseJson<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "");
  return JSON.parse(t) as T;
}
