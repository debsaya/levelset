// The co-pilot's opening message is worked out from the request, so it can never describe something that is no longer true.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { greeting } from "../lib/greeting";
import { RFX } from "./helpers";

const draft = { sentAt: null, vendors: 5, hasDraft: false };

describe("Co-pilot greeting", () => {
  it("states the real number of items and questions", () => {
    const g = greeting(RFX, draft);
    assert.match(g, new RegExp(`${RFX.lines.length} items`));
    assert.match(g, new RegExp(`${RFX.questionnaire.length}-question`));
  });

  it("follows the request when an item is added", () => {
    const more = { ...RFX, lines: [...RFX.lines, { ...RFX.lines[0], id: "L99" }] };
    assert.match(greeting(more, draft), new RegExp(`${RFX.lines.length + 1} items`));
  });

  it("does not quote a made-up spend estimate", () => {
    assert.doesNotMatch(greeting(RFX, draft), /Cr|market rates/);
  });

  it("says one item, not '1 items'", () => {
    const one = { ...RFX, lines: [RFX.lines[0]] };
    assert.match(greeting(one, draft), /\*\*1 item\*\*/);
  });

  it("after sending, explains that changes become an amendment", () => {
    const g = greeting(RFX, { sentAt: "2026-11-10T10:00:00Z", vendors: 5, hasDraft: false });
    assert.match(g, /5 vendors/);
    assert.match(g, /amendment/);
  });

  it("with an unsent amendment, points to it", () => {
    assert.match(greeting(RFX, { sentAt: "2026-11-10T10:00:00Z", vendors: 5, hasDraft: true }), /haven't seen/);
  });

  it("a blank request asks what to buy instead of describing nothing", () => {
    const g = greeting({ ...RFX, lines: [], questionnaire: [] }, draft);
    assert.match(g, /what you need to buy/);
    assert.doesNotMatch(g, /0 items/);
  });
});
