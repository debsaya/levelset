import { NextResponse } from "next/server";
import { modelChain } from "@/lib/gemini";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, key_configured: !!process.env.GEMINI_API_KEY, models: modelChain() });
}
