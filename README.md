# Levelset

Turn a pile of vendor quotes into one decision you can defend.

A working prototype for a buyer who gets five quotes in five different shapes (Excel, PDF, Word, a phone photo, a one-line email) and has to pick a vendor.

**Live demo:** https://levelset-three.vercel.app (sign in with the demo button, no password)

## How it works

1. **Collect.** Describe what you are buying to the AI co-pilot. It drafts the request: items, questions and terms. Pick the vendors and send it. Sending email is simulated.
2. **Read.** The AI reads every reply into one table, with the exact quote and location for each number.
3. **Compare.** Prices are converted to the same basis (per piece, delivered, ex-GST). Anything uncertain goes to a review list for you to accept, change or exclude.
4. **Decide.** See the recommended award, who is eligible, and what still needs attention. Export to Excel.

**Ask AI** is on every tab. Ask a question in plain words and it answers from the comparison data.

## Principle

The AI reads, code calculates, and the buyer decides anything uncertain. All unit, currency, GST and freight conversions are plain code, shown step by step.

## Run it locally

You need Node 20 or newer.

```bash
npm install
npm test                                   # no API key needed
echo "GEMINI_API_KEY=your-key" > .env.local   # free key: https://aistudio.google.com
npm run dev                                # opens at http://localhost:3000
```

The AI features need a Gemini key. Without one, the tests still run and the app opens, but the co-pilot, Ask AI and reading new replies will not work.

## More

- [`docs/DECISIONS.md`](docs/DECISIONS.md): the edge cases handled, the reasoning, and known limits.
- `lib/normalize.ts` has the conversions and checks. `lib/award.ts` has the award options.
- Demo data is fictional: a packaging buyer, 30 items and 5 vendor replies.
