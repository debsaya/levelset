import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyOps, cleanScope, cleanTitle, incomplete, type Op } from "../lib/rfxOps";
import { buildLine } from "../lib/spec";
import { RFX } from "./helpers";

const op = (o: Partial<Op>): Op => ({ op: "set_meta", why: "test", ...o });

describe("Co-pilot edits: an edit with nothing in it is never counted as done", () => {
  it("flags empty payloads", () => {
    assert.ok(incomplete(op({ op: "update_question", target_id: "Q07", question: null })));
    assert.ok(incomplete(op({ op: "add_line", line: {} })));
    assert.ok(incomplete(op({ op: "set_meta", meta: { title: null, scope: null, due_date: null } })));
    assert.ok(incomplete(op({ op: "remove_line" })));
    assert.ok(incomplete(op({ op: "set_term", term_key: "x" })));
  });
  it("passes a real edit", () => {
    assert.equal(incomplete(op({ op: "update_question", target_id: "Q07", question: { text: "t", kind: "yes_no", must_have: true } })), null);
  });
  it("an empty update_question changes nothing and is reported as failed", () => {
    const q = RFX.questionnaire[0];
    const { rfx, notes, failed } = applyOps(RFX, [op({ op: "update_question", target_id: q.id, question: null })]);
    assert.deepEqual(rfx.questionnaire, RFX.questionnaire);
    assert.equal(notes.length, 0);
    assert.equal(failed.length, 1);
  });
  it("an update that repeats what is already there is not reported as a change", () => {
    const q = RFX.questionnaire[0];
    const { notes, failed } = applyOps(RFX, [op({ op: "update_question", target_id: q.id, question: { text: q.text, kind: q.kind, must_have: q.must_have } })]);
    assert.equal(notes.length, 0);
    assert.equal(failed.length, 1);
  });
  it("a real must-have change is applied and noted", () => {
    const q = RFX.questionnaire.find((x) => !x.must_have)!;
    const { rfx, notes, failed } = applyOps(RFX, [op({ op: "update_question", target_id: q.id, question: { text: q.text, kind: q.kind, must_have: true } })]);
    assert.equal(rfx.questionnaire.find((x) => x.id === q.id)!.must_have, true);
    assert.match(notes[0], /now a must-have/);
    assert.equal(failed.length, 0);
  });
  it("does not mutate the original request", () => {
    const before = JSON.stringify(RFX);
    applyOps(RFX, [op({ op: "set_meta", meta: { title: "Changed", scope: null, due_date: null } })]);
    assert.equal(JSON.stringify(RFX), before);
  });
});

describe("Co-pilot titles stay short", () => {
  it("keeps a normal title", () => assert.equal(cleanTitle("Corrugated boxes for Bidadi"), "Corrugated boxes for Bidadi"));
  it("pulls the title out of reasoning", () => {
    const long = "The user wants quotes. " + "I considered many things. ".repeat(20) + "Title: Corrugated boxes RFQ. Scope: x";
    assert.ok(cleanTitle(long).length <= 90);
  });
  it("truncates a long run-on", () => assert.ok(cleanTitle("word ".repeat(200)).length <= 90));
  it("limits scope", () => assert.ok(cleanScope("word ".repeat(200)).length <= 302));
});

describe("Flute text is sanitised", () => {
  const base = { type: "RSC", ply: 5, length_mm: 300, width_mm: 200, height_mm: 150, annual_qty: 1000, uom: "pcs" };
  for (const f of ["BC", "BC-flute", "bc flute", "BC flute flute", " b "]) {
    it(`"${f}" never repeats the word flute`, () => {
      const l = buildLine({ ...base, flute: f }, "L99");
      assert.doesNotMatch(l.description, /flute-flute|flute flute/i);
      assert.match(l.flute ?? "", /^[A-Z]{1,3}$/);
    });
  }
  it("falls back to a default for junk", () => assert.equal(buildLine({ ...base, flute: "???" }, "L98").flute, "BC"));
});

describe("Must-have switch without a full question object", () => {
  it("is accepted as a complete edit and applied", () => {
    const q = RFX.questionnaire.find((x) => !x.must_have)!;
    const o = op({ op: "update_question", target_id: q.id, must_have: true });
    assert.equal(incomplete(o), null);
    const { rfx, notes, failed } = applyOps(RFX, [o]);
    assert.equal(rfx.questionnaire.find((x) => x.id === q.id)!.must_have, true);
    assert.match(notes[0], /now a must-have/);
    assert.equal(failed.length, 0);
  });
});
