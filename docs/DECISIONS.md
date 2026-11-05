# How I decided: the product judgement behind Levelset

This is the "why" behind the build. It answers three questions a buyer with ₹4 crore on the line would ask:

1. **What can go wrong when AI reads vendor quotes?**
2. **What stops a wrong number from reaching my award decision?**
3. **How do I know each safeguard actually works?**

Every safeguard below has three parts: **the rule** (a product decision), **where it lives** (the code), and **the proof** (an automated test you can run with `npm test`; 80 tests, ~1 second, no API key needed).

---

## 1. The one decision everything else follows

> **The model reads. Code calculates. The buyer decides anything uncertain.**

A language model is very good at reading a messy photo of a rate card. It is not something I would trust to do ₹4 crore of arithmetic, or to decide that an expired certificate is "close enough". So the work is split:

| Who | Does | Never does |
|---|---|---|
| **AI (Gemini)** | Reads each reply and writes down each price *exactly as written*, with a quote and location, plus how sure it is | Converts units, currency, tax or freight; decides who is approved |
| **Code** (`lib/normalize.ts`) | Does every conversion, re-checks matches, applies the must-have rules, raises the flags | Guesses. If it can't be sure, it flags |
| **Buyer** | Resolves amber cells (accept / override / exclude), changes assumptions, makes the award | — |

Why this matters for trust: a buyer can click any price and see the original quote, each conversion step, and who touched it. The audit trail never says "the AI thought so".

---

## 2. Edge cases: rule → code → proof

| # | What goes wrong in real life | The rule I chose | Where | Proof (test) |
|---|---|---|---|---|
| 1 | **An expired ISO certificate.** Vendor says "ISO certified", the attached certificate ran out in March. The AI reads "yes" and moves on. | The **code** checks the certificate's validity date against the RFx due date. Expired → the must-have **fails**, whatever the vendor or model said. Judged on the *event date*, not today, so a certificate valid on the due date passes. | `normalize.ts`, questionnaire block | *"an EXPIRED ISO certificate fails the must-have even though the vendor (and the model) said yes"*; *"valid on the RFx due date still counts"* |
| 2 | **ISO claimed, nothing attached.** | A claim without evidence is at most **needs proof**, never approved. | same | *"claiming ISO without attaching a certificate downgrades to needs proof"* |
| 3 | **Must-have left blank.** Vendor skipped the food-safe inks question. | No answer = no evidence = **not approved**. Silence must never qualify a vendor by default. Partly met = **needs proof**: the buyer judges. | same | *"a must-have left unanswered is NOT approved"*; *"only partly met → needs proof"* |
| 4 | **"Size in inches" read as a different product.** The photo vendor writes sizes in inches; the AI flags "different spec" and the vendor gets thrown out of the comparison. | A **unit is not a spec.** Inches or cm alone never creates a deviation. A real change (ply, flute, board, GSM, print, "instead of") still does. I fixed it twice: in the prompt (rule 6) *and* in code (`realDeviation`) because prompts alone drift. | `extract/route.ts` rule 6; `realDeviation()` in `normalize.ts` | *"'size given in inches' is a unit, not a different spec"*; *"a real change … is a deviation"*, including the tricky *"Size in inches but 5-ply board instead"* |
| 5 | **"Rest same as last year."** One-line email, no prices. | The AI marks the line `prior_contract`; **code looks the price up** in the FY26 contract and shows where it came from. The AI never types a price it didn't read. | `normalize.ts` prior-contract block | *"pulls the FY26 contract price and says where it came from"* |
| 6 | **"Same as last year" for a line that didn't exist last year.** | Stay **empty** with a warning ("ask the vendor"). Never invent a price. | same | *"stays EMPTY with a warning, rather than inventing a price"*; *"a vendor with no prior contract cannot use 'same as last year'"* |
| 7 | **A group rule stretched too far.** "₹42/kg for the 5-ply" quietly applied to printed trays and partitions. | Rule-derived prices are marked; on non-standard lines (not plain RSC) they are **flagged against last year's price** for the buyer to confirm with the vendor. | `RULE_VS_PRIOR` | *"a group rule applied to a non-RSC line is flagged"*; *"same rule on an RSC line is only informational"* |
| 8 | **Wrong unit.** ₹340 per piece that was meant per 100. | Every price implies a ₹/kg figure. Outside the ₹25–90/kg corrugated band → amber with "likely a unit error". The band is the buyer's setting. | `UNIT_SUSPECT` | *"a price that implies a silly ₹/kg is flagged"*; *"per-100 price is divided by 100"* |
| 9 | **Photo matched to the wrong line.** The AI reads a blurry "8x6x4" row and picks the wrong item. | **Code re-verifies every match against the size the vendor wrote** (inch/cm/mm, ~13 mm + 3% tolerance). Moves it if the size fits another line (and says so); **drops** it if the size fits no line. | `normalize.ts` size check | *"moves a price to the line whose size it actually matches"*; *"drops a price whose written size fits NO line"*; *"no false REMATCHED"* |
| 10 | **GST included, or not said.** | Included + stated rate → removed. Included + **rate not stated** → assume 5% *but send to review*. | `GST_INCLUDED` | both GST tests |
| 11 | **Ex-works vs delivered.** Cheapest ex-works quote isn't cheapest at the plant. | Freight is added for ex-works using the **buyer's own** ₹/kg assumption (vendor-specific, else default). Unstated = treated as delivered **but flagged**. | `FREIGHT_ADDED` / `FREIGHT_UNCLEAR` | *"ex-works quotes get the buyer's freight assumption added"*; *"unstated freight is treated as delivered but flagged"* |
| 12 | **USD quote.** | Converted at the **buyer's** FX rate, not the vendor's "reference" rate; changes live if the buyer changes it. Unknown currency is **blocked**, not guessed. | `FX` / `FX_UNKNOWN` | the three FX tests |
| 13 | **A conditional rebate in a footnote.** "5% off if volume > X". | **Not counted** in the headline price (it may never be earned). The "if earned" price is shown beside it. One tick lets the buyer count it. | `uncondPct` / `condPct` | the three discount tests |
| 14 | **Vendor's own total doesn't add up.** | Cross-check their total against their line prices × *our* quantities. We always use line prices; a mismatch is flagged. | `TOTAL_MISMATCH` | *"vendor's own total is cross-checked"* |
| 15 | **One vendor way off the pack.** | Price ±60% off the median of the others → amber. **Needs 3+ vendors**, so thin data doesn't create false alarms. | `OUTLIER` | both outlier tests |
| 16 | **Blurry or uncertain reads.** | Confidence below the buyer's threshold (default 80%) → amber. An unreadable price is **empty**, never zero. | `LOW_CONFIDENCE`, `UNREADABLE` | the confidence tests |
| 17 | **A cheaper vendor who offered a different spec.** | Deviating prices **never** count toward totals, "best price", or an award. | `SPEC_DEVIATION` | *"deviating lines never count toward totals"*; *"never used as the best price"* |
| 18 | **Awarding to someone who isn't approved just because they're cheapest.** | Awards only use approved vendors by default. Anyone excluded is **named with the reason**. Widening is a visible choice, and the tool shows the price of doing so. | `lib/award.ts` | the award tests |
| 19 | **Holes in coverage.** | Lines nobody eligible priced are reported as **gaps**, never costed at zero. Awards report how many winning prices still rest on unverified cells. | `runScenario` | *"lines nobody eligible quoted are reported as gaps"*; *"unverified prices … are counted"* |
| 20 | **AI writes a confident number that isn't in the data.** | Every figure in the analyst's prose is checked against the query results of that turn; anything that doesn't trace is highlighted. Tables and charts come only from SQL, never from model-typed numbers. | `lib/grounding.ts` | the four grounding tests (invented figure caught; ISO numbers, years and line ids not mistaken for figures) |

| 21 | **A zero or negative price.** A typo, or "0" meaning "no quote". Left alone it would be "the cheapest" and win the award. *(A gap I found while testing and fixed.)* | Never a price. The cell is empty, flagged, and can't win. The buyer can still key in a price they got by phone. Same for a per-kg price on a line with no weight. | `INVALID_PRICE` | *"a zero or negative price is not a price"*; *"per-kg price on a line with no weight"* |
| 22 | **A percentage surcharge hidden in the terms** (fuel, handling). It made a vendor look cheaper than they are. *(Gap, fixed.)* | Unconditional % surcharges are added to the unit price. Conditional ones and fixed one-time charges (plates, dies) stay out of the unit price and are shown beside it. | `surchargePct` | *"an unconditional percentage surcharge is added"*; *"a conditional surcharge and a one-time charge do NOT change the unit price"* |
| 23 | **An unrelated expired certificate.** The vendor attaches an expired FSC certificate and a valid ISO one; the ISO question could read the wrong one. Or an old and a renewed ISO certificate side by side. *(Gap, fixed.)* | Only ISO documents are judged for the ISO question; if there are several, the newest counts. | questionnaire block | three certificate tests |
| 24 | **Prices that expired before the event.** "Valid 15 days" from a quote dated weeks before the due date. *(New check.)* | Flagged for the buyer: ask for a refreshed quote. Missing or unreadable dates raise nothing. | `QUOTE_EXPIRED` | two validity tests |
| 25 | **Quantity slabs / the same item twice.** | The reader gives both prices; code keeps the more confident one, **never averages**, and shows the buyer both so they can pick. Slabs are not modelled yet (see limits). | `DUPLICATE` | *"the same item priced twice … is flagged and never averaged"* |
| 26 | **Noise from the reader:** an invented line id, an answer to a question that doesn't exist, a regret line, a reply with no prices, no replies at all. | Ignored safely, never crashes, never costed. A regret keeps its reason. | various | the Coverage and noise tests |
| 27 | **Other tax cases:** 18% GST, quotes that mix inclusive and exclusive lines, lower-case currency codes. | Same basis for every line, whatever the quote mixes. | `GST_INCLUDED` | the Tax variety tests |
| 28 | **Hidden state.** The same inputs must always give the same answer, and the data must never be modified in place. | Pure functions. | `normalize()` | the "Safety net" tests |

---

## 3. The review queue: when a number is "amber"

A cell is **trusted** only if nothing questions it. Any warning-level flag (unit suspect, low confidence, rule-vs-prior, GST rate unstated, freight unclear, duplicate, re-matched, outlier, unreadable) moves it to **review** and keeps it out of any claim of certainty. Info-level notes (converted from USD, per-kg, prior-contract pull) are shown but don't interrupt the buyer.

**Why a queue and not a block:** stopping on every doubt makes the tool unusable at 30 lines × 5 vendors; trusting every number makes it dangerous. The queue is ordered by what could change the award, and the buyer can **accept** (keep, I've looked), **override** (use my price, with a note) or **exclude**. Each action is written to the audit log and flows straight into totals (tested).

**Honest labels.** "Not approved" vendors still show prices, because buyers need to see what they'd be giving up. They are marked clearly, never ranked, and never in the default award.

---

## 4. How I wrote the prompts

- **Extraction prompt** (`app/api/extract/route.ts`): the first rule is *"Do NOT convert currency, units, tax or freight."* The AI is a reader, not an accountant. It must cite a quote and location for every number, record the vendor's *own* size (so code can re-check the match), lower confidence when unsure, list what it couldn't read, and *"Never invent a price."*
- **Analyst prompt** (`app/api/analyst/route.ts`): *"Always query before answering; every figure you state must come from a query result."* Award questions go through a deterministic calculator tool rather than SQL the model writes itself. It speaks the buyer's language (approved / needs proof / not approved), never database words.
- **Co-pilot** (`app/api/copilot/route.ts`): edits the RFx through structured operations, and an `add_line` is rejected unless the item is complete (a real bug I found: it once added a 0×0 box).
- **Prompts don't carry the rules; code does.** Where a mistake would be costly (inches vs spec, expired certificates, line matching) the prompt asks nicely **and** code enforces it. Prompts drift between model versions; tests don't.

---

## 5. What I measured (and what I didn't)

Scored against the answer key that generated the fictional vendor files (`scripts/eval.py`): per-piece price, ex-GST, before freight and discounts.

| Vendor reply | Result |
|---|---|
| Excel in the vendor's own layout | 30 / 30 lines correct |
| Letterhead PDF | 27 / 27 lines quoted correct |
| Word letter (USD, 7-ply, GST-inclusive) | 29 / 29 lines quoted correct |
| Angled phone photo (inches, bundle pricing) | 9 / 19 at first → **15 / 19** after adding a transcription pass and the code-side size re-match; the rest go to review |
| One-line email ("rest same as last year") | Prices resolved by the prior-contract lookup |

What this does **not** prove: it's one fictional dataset I built, so accuracy on your real quotes will differ. The photo is the hardest case by design.

---

## 6. What's real and what I left out, on purpose

**Real:** the AI reading (every vendor reply goes through a live model), the co-pilot, the analyst's SQL, all calculations and checks, the audit trail, the exports.

**Stubbed:** sending email (preview and simulated send only) and the inbox (replies are pre-loaded). That's plumbing; the brief said to stub plumbing.

**Left out deliberately:**

- **Live FX and freight lookups.** They're assumptions the buyer owns and can see. A hidden live rate would make yesterday's comparison unrepeatable.
- **Automatic award.** The tool reaches a *defensible* award by showing the working; a person signs it.
- **Supplier scoring weights.** Weights are a negotiation inside the company, not a default I should invent. Must-haves are hard rules; the rest is shown side by side.
- **Auto-chasing vendors.** The tool drafts the clarifying questions; it doesn't send them. A wrong auto-email to a supplier costs more than a click.
- **Login and multi-user.** Out of scope for a take-home; state lives in the browser.

## 7. Known limits (so you don't have to find them)

- Box weight is **computed from the spec**, so per-kg quotes are accurate to a few percent, and the tool says so on each converted cell.
- "Needs proof" and "not approved" depend on questions the RFx marks as must-haves. A badly written must-have gives a badly drawn line.
- The size re-match assumes the vendor's written size is reliable; a mis-read size can still send a price to review or drop it (both visible, neither silent).
- **Not modelled yet:** quantity price breaks as a structure (they arrive as duplicates and the buyer picks), and minimum order quantities. Both would need new fields in the reading step, which I chose not to risk this close to the demo.
- Number formats such as decimal commas are a reading problem, not a code problem; they belong in the extraction accuracy checks above, not in unit tests.
- Free-tier model limits can slow a live read. The app retries and shows a clear message rather than failing silently.

## 8. Run the proof

```bash
npm install
npm test        # 80 checks, no API key needed
```

I also confirmed the tests are not decorative: deliberately breaking the certificate-expiry rule fails 13 of them, removing the inches-vs-spec fix fails one, and removing the second round of fixes (rows 21 to 24) fails 6.
