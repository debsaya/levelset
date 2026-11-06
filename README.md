# Levelset — kill the quote spreadsheet

A working prototype for a buyer who has to get from "five vendors replied in five shapes" to a defensible award decision.

**Live:** https://levelset-three.vercel.app

## The flow (four steps, Ask AI on every tab)

1. **Collect quotes.** Tell the co-pilot what you are buying (attach a spec, a drawing or last year's sheet if you have one). It drafts the RFx as structured edits; the **RFx package** section holds the items, questionnaire and terms. The co-pilot's opening message follows where the work stands (drafting, ready to send, waiting, reading, checking). Choose who gets it in **Onboarded vendors** (vendor master, an uploaded list, pasted emails, or one by hand), review and send (email is stubbed). Replies arrive in the inbox in any format. Vendors who have not replied can be chased (reminder drafted, you send it). After sending you can change the request: edits go into an **amendment draft**, **Send amendment** issues revision 2 to the same vendors, **Discard** drops it.
2. **Read quotes.** Every reply (Excel, PDF, Word, phone photo, email text) is read by the AI into one shape, with a verbatim quote and location for every number. Large phone photos are shrunk in the browser first.
3. **Compare.** One normalised table. Conversions are shown step by step; anything uncertain is amber in a review queue. Accept, override or exclude, and each action is audit-logged.
4. **Decision.** Award scenarios (cheapest approved, split, incumbent-weighted), the must-have questionnaire, and an Excel export.

**Ask AI** (drawer, every tab): ask in plain language; the analyst writes SQL against an in-browser SQLite of the comparison and every table and chart comes from that result. A **Next step** bar on each tab says what to do now, and a progress panel with an ETA shows during long AI calls (it also explains the free-tier model's slower pace).

## What's real and what's stubbed

| Part | Status |
|---|---|
| RFx co-pilot (chat → structured edits to the draft, incl. attachments and amendments) | **Real** LLM loop (Gemini), structured output, with a retry and a per-item repair call if an edit comes back empty |
| Sending email, reminders, other channels | Stubbed (preview + simulated send). Reply-to plus-addressing shown for routing |
| Reading vendor responses (Excel, PDF, Word, phone photo, email text) | **Real** LLM extraction with per-number citations |
| Unit / currency / GST / freight / discount normalisation | **Deterministic code** (`lib/normalize.ts`), every step shown |
| Quality checks (₹/kg sanity band, peer outliers, low confidence, expired certificates, totals that don't reconcile) | **Deterministic code** |
| Analyst ("ask the data") | **Real** tool-using LLM agent writing read-only SQL against an in-browser SQLite of the comparison |
| Number grounding check on the analyst's prose | **Deterministic code** (`lib/grounding.ts`) |
| Exports | Excel workbook (comparison, provenance, questionnaire, assumptions, audit log); CSV/XLSX per answer table |
| Login / SSO | Stub. State lives in the browser (localStorage) |

## Design principle

**The model reads; code calculates; the buyer decides anything uncertain.**

- The extractor is told never to convert anything. It records the price exactly as written, the unit basis, and a verbatim quote and location for each number.
- Conversions (per 100 → per piece, ₹/kg → per piece using a weight computed from the spec, USD → INR at the buyer's rate, GST-inclusive → exclusive, ex-works + freight) are plain code, shown step by step in each cell.
- Anything the system isn't sure about goes to a review queue (amber) instead of silently entering totals. Buyer accept/override/exclude actions are logged.
- Analyst tables and charts are rendered from SQL results, never from model-typed numbers. Figures in its prose that don't match a query result are highlighted.

## Hardening and QA

- **API guard** (`lib/guard.ts`) on every POST route: valid JSON, same-site requests only, per-IP rate limit, shape checks, 12 MB body cap, plain-language errors (`friendly()`).
- **Security headers** in `next.config.ts`, including a Content-Security-Policy (verified in a real browser: no violations, in-browser SQLite still runs).
- **Accessibility:** axe-core reports zero violations on every step; skip link, landmarks, labelled dialogs, Escape closes the topmost layer, full keyboard path through the flow, contrast fixed.
- **Large photos:** compressed in the browser (canvas, JPEG) before upload, so a 10 MB phone photo goes up at ~2 MB.
- **Empty or fake PDFs** are set aside with a reason instead of a generic AI error.
- The QA pass and its findings are written up in the project notes; every defect found was fixed and pinned by a test where it could be.

## Where to look (how it thinks)

- [`docs/DECISIONS.md`](docs/DECISIONS.md): 47 real-world edge cases (expired ISO certificate, "size in inches" vs a real spec change, "same as last year", conditional rebates...), each mapped to the rule, the code and a test, plus the workflow, hardening and known limits.
- `tests/`: 237 automated checks for those rules and the guards. Run `npm test` (about 1 second, no API key needed).
- `lib/normalize.ts`: all conversions, flags and the must-have rules. `lib/award.ts`: award scenarios. `lib/grounding.ts`: the check on the analyst's numbers. `lib/rfxOps.ts`: co-pilot edits and amendments. `lib/guard.ts`: API protection.
- `app/api/*/route.ts`: the prompts.

## Run locally

```bash
npm install
echo "GEMINI_API_KEY=..." > .env.local     # free key: https://aistudio.google.com
npm run dev
npm test      # run the checks
```

Optional: `GEMINI_MODEL=model-a,model-b` to set the model fallback order.

**Free-tier note.** On the free Gemini tier the stronger models can return 429 (quota). The app falls back along the chain (ending at `gemini-3.5-flash-lite`), which is slower and more variable, so the UI shows a progress panel with an ETA. `/api/diag` reports which models currently answer. For a live demo, use a key with billing or check `/api/diag` first.

## Deploy (Vercel)

1. Push this folder to a GitHub repo.
2. vercel.com → Add New → Project → import the repo (framework auto-detected: Next.js).
3. Settings → Environment Variables → add `GEMINI_API_KEY`.
4. Deploy. Check `/api/health` shows `key_configured: true`, and `/api/diag` for model availability.

## Demo data (fictional)

`scripts/` (outside the app) generated: buyer Saffronleaf Foods (Bidadi plant), 30 corrugated packaging lines (~1,000 t/yr, ~₹4.4 Cr), a 9-question supplier questionnaire, and five vendor replies: an Excel in the vendor's own format (3-ply priced per 100 nos; stated total leaves out two lines), a letterhead PDF with a conditional 5% rebate in a page-2 footnote and an expired ISO certificate, a Word letter quoting USD with 7-ply prices GST-inclusive, a regret line and an alternate spec, an angled phone photo of a rate card in inches with bundle pricing and sizes not in the RFx, and the incumbent's one-line email: "₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra."

## Known limits

No real authentication; rate limiting is per server instance; a real screen-reader pass and very large PDFs were not tested. See `docs/DECISIONS.md` §7.
