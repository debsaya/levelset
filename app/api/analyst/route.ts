import { NextResponse } from "next/server";
import { generate } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "run_sql",
        description: "Run a read-only SQLite query over the comparison database and get rows back (max 100). Use it to look before you answer. The buyer does not see these rows.",
        parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      },
      {
        name: "show_table",
        description: "Show the buyer a table produced by a SQLite query. The numbers come straight from the database. Name columns readably with AS.",
        parameters: {
          type: "object",
          properties: { title: { type: "string" }, sql: { type: "string" }, note: { type: "string", description: "Optional one-line caveat shown under the table" } },
          required: ["title", "sql"],
        },
      },
      {
        name: "show_chart",
        description: "Show the buyer a chart produced by a SQLite query. x is the category column; y lists numeric columns (one series each).",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            sql: { type: "string" },
            chart_type: { type: "string", enum: ["bar", "stacked_bar", "line", "scatter"] },
            x: { type: "string" },
            y: { type: "array", items: { type: "string" } },
            y_label: { type: "string" },
          },
          required: ["title", "sql", "chart_type", "x", "y"],
        },
      },
    ],
  },
];

const SYSTEM = (context: string) => `You are the procurement analyst inside a quote-levelling tool. A category buyer is asking questions about a live RFx comparison. Every vendor response has already been extracted and normalised by deterministic code into a SQLite database.

DATABASE AND CURRENT ASSUMPTIONS
${context}

How to work:
- Always query before answering. Never estimate or recall numbers; every figure you state must come from a query result in this conversation. Do arithmetic (totals, differences, percentages, savings) in SQL, not in your head.
- Compare on unit_price_inr (landed at the buyer's plant, ex-GST, INR per piece). Annual value = unit price x annual_qty.
- Rows with status 'missing' have no price. Rows with needs_review = 1 are machine-read values the buyer has not verified yet. Rows with status 'deviation' are a different spec from what was asked. Exclude 'missing' and 'deviation' from price comparisons unless asked, and say when an answer depends on unverified cells.
- Conditional rebates are NOT included in unit_price_inr. unit_price_inr_if_rebate shows the price if the condition is met. Mention this when it changes the answer.
- "Qualified" means vendors.qualification = 'qualified'. 'conditional' means a must-have is partly met or unproven; say so explicitly rather than silently including or excluding them.
- For award scenarios, compute the line-level winners and the total in SQL, compare to a baseline (e.g. the cheapest single vendor, or last year's prices from prior_prices), and list what was excluded and why.
- Use show_table for anything with more than 3 numbers and show_chart when a picture helps. Do not repeat a table's contents in your text.
- Final answer: lead with the answer in one or two sentences, then caveats (coverage gaps, unverified cells, conditional vendors, assumptions like FX and freight). Be concise. Use Indian number formatting (lakh, crore) for rupee totals. Write money as ₹.
- If the question cannot be answered from the data, say what is missing and what you would ask the vendor.`;

export async function POST(req: Request) {
  try {
    const { contents, context } = await req.json();
    const out = await generate({ system: SYSTEM(context), contents, tools: TOOLS, thinking: "low", maxOutputTokens: 8000 });
    return NextResponse.json({ content: out.content, model: out.model });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
