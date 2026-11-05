# Levelset — kill the quote spreadsheet

A working prototype for a buyer who has to get from "five vendors replied in five shapes" to a defensible award decision.

**Flow:** Draft RFx with an AI co-pilot → send (email, stubbed) → vendors reply however they like → the system reads every reply → one normalised, audited comparison → ask questions in plain language → export.

## What's real and what's stubbed

| Part | Status |
|---|---|
| RFx co-pilot (chat → structured edits to the draft) | **Real** LLM loop (Gemini), structured output |
| Sending email | Stubbed (preview + simulated send). Reply-to plus-addressing shown for routing |
| Reading vendor responses (Excel, PDF, Word, phone photo, email text) | **Real** LLM extraction with per-number citations |
| Unit / currency / GST / freight / discount normalisation | **Deterministic code** (`lib/normalize.ts`), every step shown |
| Quality checks (₹/kg sanity band, peer outliers, low confidence, expired certificates, totals that don't reconcile) | **Deterministic code** |
| Analyst ("ask the data") | **Real** tool-using LLM agent writing SQL against an in-browser SQLite of the comparison |
| Number grounding check on the analyst's prose | **Deterministic code** (`lib/grounding.ts`) |
| Exports | Excel workbook (comparison, provenance, questionnaire, assumptions, audit log); CSV/XLSX per answer table |

## Design principle

**The model reads; code calculates; the buyer decides anything uncertain.**

- The extractor is told never to convert anything. It records the price exactly as written, the unit basis, and a verbatim quote and location for each number.
- Conversions (per 100 → per piece, ₹/kg → per piece using a weight computed from the spec, USD → INR at the buyer's rate, GST-inclusive → exclusive, ex-works + freight) are plain code, shown step by step in each cell.
- Anything the system isn't sure about goes to a review queue (amber) instead of silently entering totals. Buyer accept/override/exclude actions are logged.
- Analyst tables and charts are rendered from SQL results, never from model-typed numbers. Figures in its prose that don't match a query result are highlighted.

## Where to look (how it thinks)

- [`docs/DECISIONS.md`](docs/DECISIONS.md): 47 real-world edge cases (expired ISO certificate, "size in inches" vs a real spec change, "same as last year", conditional rebates...), each mapped to the rule, the code and a test.
- `tests/`: 151 automated checks for those rules. Run `npm test` (about 1 second, no API key needed).
- `lib/normalize.ts`: all conversions, flags and the must-have rules. `lib/award.ts`: award scenarios. `lib/grounding.ts`: the check on the analyst's numbers.
- `app/api/*/route.ts`: the prompts.

## Run locally

```bash
npm install
echo "GEMINI_API_KEY=..." > .env.local     # free key: https://aistudio.google.com
npm run dev
npm test      # run the checks
```

Optional: `GEMINI_MODEL=model-a,model-b` to set the model fallback order.

## Deploy (Vercel)

1. Push this folder to a GitHub repo.
2. vercel.com → Add New → Project → import the repo (framework auto-detected: Next.js).
3. Settings → Environment Variables → add `GEMINI_API_KEY`.
4. Deploy. Check `/api/health` shows `key_configured: true`.

## Demo data (fictional)

`scripts/` (outside the app) generated: buyer Saffronleaf Foods (Bidadi plant), 30 corrugated packaging lines (~1,000 t/yr, ~₹4.4 Cr), a 9-question supplier questionnaire, and five vendor replies: an Excel in the vendor's own format (3-ply priced per 100 nos; stated total leaves out two lines), a letterhead PDF with a conditional 5% rebate in a page-2 footnote and an expired ISO certificate, a Word letter quoting USD with 7-ply prices GST-inclusive, a regret line and an alternate spec, an angled phone photo of a rate card in inches with bundle pricing and sizes not in the RFx, and the incumbent's one-line email: "₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra."
