# How I decided: the product judgement behind Levelset

This is the "why" behind the build. It answers three questions a buyer with ₹4 crore on the line would ask:

1. **What can go wrong when AI reads vendor quotes?**
2. **What stops a wrong number from reaching my award decision?**
3. **How do I know each safeguard actually works?**

Every safeguard below has three parts: **the rule** (a product decision), **where it lives** (the code), and **the proof** (an automated test you can run with `npm test`; 237 tests, ~1 second, no API key needed).

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

| 29 | **Dates in odd formats.** The reader writes a certificate date as "15/03/2025" or "June 2027" instead of 2025-03-15. Comparing them as text gives the wrong answer by luck. *(Gap, fixed.)* | Day-first and ISO dates are parsed; anything else is **not guessed**: an ISO claim with an unreadable date becomes "needs proof". | `isoDate()` | the four date tests |
| 30 | **Currency written as "Rs." or "₹".** The system blocked it as an unknown currency. *(Gap, fixed.)* | The usual spellings of INR and USD are recognised. Truly unknown currencies are still blocked. | `currencyCode()` | the two currency tests |
| 31 | **The buyer types a blank or bad override price.** A blank box became NaN and a trusted, cheapest ₹0 cell. *(Gap, fixed.)* | An override without a usable positive price is ignored; the cell stays in review. | `normalize()` override guard | *"an override with a blank/NaN/zero/negative price is ignored"* |
| 32 | **A discount of 100% or more, or a negative pack size.** | Nothing can bring a price to zero or below; the cell is empty and flagged. *(Gap, fixed.)* | `INVALID_PRICE` | the two "too good to be true" tests |
| 33 | **Vendor's own total includes GST.** It looked like an error in their line prices. | If the difference is exactly 5/12/18/28% GST the message says so. A total in another currency is not compared. | `TOTAL_MISMATCH` / `TOTAL_CURRENCY` | the two total tests |
| 34 | **The word "ISO" hiding in other words.** A question about "isolation" or "precision" would trigger the certificate check. *(Gap, fixed.)* | Whole-word match only. | questionnaire block | the "precision/isolation" test |
| 35 | **Sloppy reads.** The model omits tax, freight, documents, confidence scores or the whole questionnaire. | Never crashes. Missing evidence means **no approval**; missing confidence means **review**, not trust. | `normalize()` | the "Sloppy extractions" tests |
| 36 | **Nothing to award.** No approved vendors, a vendor id that doesn't exist, ties. | Empty awards, not errors; ties resolve the same way every time. | `lib/award.ts` | the "Awards with nothing to award" tests |
| 37 | **Unit confusion in sizes:** millimetres labelled inches, a ply nobody asked for, length and width swapped, flat items with no height. | Left out visibly or matched correctly; never forced onto the wrong line. | size check | the four size tests |

| 38 | **Per tonne / per 100 kg quotes.** Read as plain per-kg, the price is 1,000× or 100× off. *(Gap, fixed.)* | Weight-based prices are divided by the pack size before conversion (prompt rule 2 teaches the reader to record it). | `normalize()` per-kg step | *"₹42,000 per tonne and ₹4,200 per 100 kg both equal ₹42 per kg"* |
| 39 | **Per-kg vs per-piece swapped on a heavy box.** On a 1 kg+ box, ₹41 a piece and ₹41 a kg both look plausible, so the ₹/kg sanity band can't catch it. *(Found by sweeping all 30 lines; fixed.)* | If almost every price in a quote uses one basis and one line uses the other, that line is flagged: a misread is likelier than a real change. | `BASIS_MIXED` | the "vendor quotes per piece / per kg" sweeps |
| 40 | **Order-of-magnitude misreads** (decimal shifted, ×100 / ÷100, per-100 vs per-piece, INR read as USD and back). | Every one of these, on every one of the 30 lines, is caught and none can be trusted without review. | band + `UNIT_SUSPECT` | the misread sweeps (160+ simulated misreads) |
| 41 | **A misread LOW price wins the line.** Awards pick the cheapest, so a 3.04 mistaken for 3.40 is exactly the number that gets chosen. | The award calculator reports any winner more than 15% below the next-best eligible offer. The analyst must tell the buyer to check those against the original quote before awarding. | `winning_prices_far_below_next_best` | the winner-margin tests |
| 42 | **Freight read the opposite way to the vendor's wording** ("freight extra" read as delivered). Moves every price by 2 to 5%. | Contradictions between the reader's decision and the vendor's own words are flagged on the vendor and on every price. | `FREIGHT_CONFLICT` | the freight tests (including "no extra charges" not being a false alarm) |
| 43 | **GST not stated at all.** | Flagged on the vendor: a 5 to 18% error could hide in it. | `TAX_UNCLEAR` | the GST tests |
| 44 | **A discount the reader called unconditional but whose wording sets a condition** ("5% on annual offtake above ₹1 Cr"). Giving credit they may never earn is the costlier mistake. | Not counted; the "if earned" price is shown. A percentage that looks like a fraction (0.05) or is huge (40) is flagged. A surcharge is the opposite: never hidden by condition wording. | `ADJ_CONDITION`, `ADJ_SCALE` | the discount tests |
| 45 | **A price that could belong to two similar items** (a rounded size fits two lines). | Flagged on the cell, naming both lines. | `AMBIGUOUS_MATCH` | the two similar-item tests |

| 46 | **A misread digit or slipped row on a photo or scan** that stays in a believable range. The checks above can't see it. | Photos and scans are held to a **higher confidence bar** (default 90%, against 80% for clean files; the buyer's setting). A clear photo passes like any other file; one the AI was unsure of goes to review and is counted in "still needs your check". Blanket distrust of every photo was rejected: it would punish clear images and train buyers to ignore the flag. | `isPhotoSource()`, `PHOTO_CONFIDENCE` | the photo-confidence tests |
| 47 | **The vendor is the only one who knows what they meant.** | A **read-back** is added to the clarification email: for the items we'd award them, what they wrote and what we read, built by code (exact numbers, never retyped by the AI), asking them to reply "correct" or give the right price. It never says they are winning and never shows other vendors' prices. | `lib/readback.ts` | the five read-back tests |

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

**Real:** the AI reading (every vendor reply goes through a live model), the co-pilot (including attachments and amendments), the analyst's SQL, all calculations and checks, the audit trail, the exports.

**Stubbed:** sending email, reminders and the other channels (preview and simulated send only), the inbox for the demo set, and login/SSO. That's plumbing; the brief said to stub plumbing.

**The workflow, as built (four steps, Ask AI on every tab):**

- *Collect quotes:* co-pilot drafts the RFx; **Onboarded vendors** picks vendors from the master, an uploaded list, pasted emails or one by hand, with a suggested shortlist by rules the buyer can read (category, certificate not expired, distance, incumbent kept). Vendors who haven't replied show as no-reply rows with a drafted reminder.
- *Amendments:* once sent, edits go to a **draft** instead of silently changing what vendors priced against. **Send amendment** issues revision 2 to the same vendors; **Discard** drops it. A vendor can never be compared against a spec they were not sent.
- *Read, Compare, Decision:* as in sections 2 and 3. A **Next step** bar on every tab says the one thing to do now, worked out from where the work stands (`lib/flow.ts`).
- *Waiting honestly:* a progress panel with a learned ETA runs during AI calls, and a short note explains the free-tier model's pace. No spinner that hides how long it will take.

**Left out deliberately:**

- **Live FX and freight lookups.** They're assumptions the buyer owns and can see. A hidden live rate would make yesterday's comparison unrepeatable.
- **Automatic award.** The tool reaches a *defensible* award by showing the working; a person signs it.
- **Supplier scoring weights.** Weights are a negotiation inside the company, not a default I should invent. Must-haves are hard rules; the rest is shown side by side.
- **Auto-chasing vendors.** The tool drafts the reminders and clarifying questions; it doesn't send them. A wrong auto-email to a supplier costs more than a click.
- **Login and multi-user.** Out of scope for a take-home; state lives in the browser.

## 7. Known limits (so you don't have to find them)

- Box weight is **computed from the spec**, so per-kg quotes are accurate to a few percent, and the tool says so on each converted cell.
- "Needs proof" and "not approved" depend on questions the RFx marks as must-haves. A badly written must-have gives a badly drawn line.
- The size re-match assumes the vendor's written size is reliable; a mis-read size can still send a price to review or drop it (both visible, neither silent).
- **What the checks cannot see:** a misread that stays in a believable range, such as 3.40 read as 3.04, or a few-percent GST or freight error with consistent wording. These are caught indirectly, and for photos and scans by process (rows 46 and 47): by confidence scores, the peer comparison when 3+ vendors quoted the line, the 15% winner check, and the citation next to every price so the buyer can look. If the vendor quotes the only price on a line there is no peer to compare with.
- **Not modelled yet:** quantity price breaks as a structure (they arrive as duplicates and the buyer picks), and minimum order quantities. Both would need new fields in the reading step, which I chose not to risk this close to the demo.
- Number formats such as decimal commas are a reading problem, not a code problem; they belong in the extraction accuracy checks above, not in unit tests.
- Free-tier model limits can slow a live read. On the free key the stronger models return 429 and the app falls back to `gemini-3.5-flash-lite`: slower and more variable. It retries, shows the progress panel and a clear message rather than failing silently. `/api/diag` shows which models answer right now; for a live demo, check it first or use a key with billing.
- **Security is basic, not production.** There is no real authentication (SSO is a stub), and the per-IP rate limit lives in server memory, so it is per instance. The API guard, same-site check, body cap and CSP stop casual misuse, not a determined attacker.
- **Not tested:** a real screen-reader pass (axe and keyboard checks are clean, which is not the same thing), and very large PDFs.

## 8. What "proof" means here, and doesn't

The tests prove the **code** does what each rule says, on every case I could think of and on odd inputs the reader might produce. They cannot prove the **AI reads every real document correctly** (that is the accuracy table in section 5), and they only cover situations I thought of. That is why the review queue exists: the system is designed to say "I'm not sure" about the unexpected case, instead of pretending to be right.

## 9. Run the proof

```bash
npm install
npm test        # 237 checks, no API key needed
```

I also confirmed the tests are not decorative: deliberately breaking the certificate-expiry rule fails 13 of them, removing the inches-vs-spec fix fails one, and removing the second round of fixes (rows 21 to 24) fails 6, removing the third round (rows 29 to 34) fails 10, and removing the fourth (rows 38 to 45) fails 14.

## 10. Hardening and QA (what I tried to break)

I tested the live site as a QA engineer would, and fixed what I found.

| Area | What I checked | Result |
|---|---|---|
| Co-pilot | Empty edits, must-have toggles, attachments, amendment send and discard | An `update_question` once arrived empty. Fixed with a flat `must_have` field, one retry and a per-item repair call; `incomplete()` rejects empty edits |
| API | Malformed JSON, wrong shapes, oversize bodies, cross-site calls, bursts | Clean 400/413/429 with plain-language messages (`lib/guard.ts`); no raw stack or "Failed to fetch" |
| Extraction | Empty and fake PDFs, non-JSON replies | Set aside with a reason, never a generic AI error |
| Ask AI | Write attempts and multi-statement SQL, ungrounded numbers | `runQuery` allows one read-only SELECT/WITH only; unmatched figures are highlighted |
| Flow | Send to zero vendors, empty states, resets | Next-step bar covers each case; no "send to 0 vendors" |
| Layout | Phone and tablet widths | Header and grids stack below `lg`, no horizontal scroll |
| Accessibility | axe-core on every step, keyboard-only run | Zero violations. Skip link, landmarks, labelled dialog with focus on Cancel, Escape closes confirm, then menu, then the Ask AI drawer; contrast raised on kraft and muted text |
| Security headers | Real-browser load | CSP, frame, referrer and content-type headers; no violations, WASM SQLite runs |
| Large photos | 10 MB phone photo | Resized and re-encoded in the browser (`lib/image.ts`): request body ~2.3 MB |

All of this is covered by `npm test` where it is code (237 tests) and by the browser checks above where it is not.
