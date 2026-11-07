// The co-pilot's opening message follows where the work stands, so it can never describe something that is no longer true.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { greeting, requestSummary } from "../lib/greeting";
import { RFX } from "./helpers";

const draft = { sentAt: null, vendors: 5, hasDraft: false };
const SENT = "2026-11-10T10:00:00Z";

describe("Request summary (shown with the RFx package)", () => {
  it("states the real number of items and questions", () => {
    const g = requestSummary(RFX);
    assert.match(g, new RegExp(`${RFX.lines.length} items`));
    assert.match(g, new RegExp(`${RFX.questionnaire.length}-question`));
  });

  it("follows the request when an item is added", () => {
    const more = { ...RFX, lines: [...RFX.lines, { ...RFX.lines[0], id: "L99" }] };
    assert.match(requestSummary(more), new RegExp(`${RFX.lines.length + 1} items`));
  });

  it("does not quote a made-up spend estimate", () => {
    assert.doesNotMatch(requestSummary(RFX), /Cr|market rates/);
  });

  it("says one item, not '1 items'", () => {
    assert.match(requestSummary({ ...RFX, lines: [RFX.lines[0]] }), /\*\*1 item\*\*/);
  });
});

describe("Co-pilot greeting", () => {
  it("a blank request asks what to buy instead of describing nothing", () => {
    const g = greeting({ ...RFX, lines: [], questionnaire: [] }, draft);
    assert.match(g, /what you need to buy/);
    assert.doesNotMatch(g, /0 items/);
  });

  it("drafted, no vendors yet: says to choose the onboarded vendors", () => {
    assert.match(greeting(RFX, { ...draft, chosen: 0 }), /onboarded vendors/);
  });

  it("drafted with vendors chosen: ready to send to that many", () => {
    const g = greeting(RFX, { ...draft, chosen: 5 });
    assert.match(g, /ready to go to \*\*5 vendors\*\*/);
    assert.match(greeting(RFX, { ...draft, chosen: 1 }), /\*\*1 vendor\*\*/);
  });

  it("the opening is short and no longer repeats the item summary", () => {
    assert.doesNotMatch(greeting(RFX, { ...draft, chosen: 5 }), /tonnes|must-have|-question/);
  });

  it("sent, no replies: waiting, and changes become an amendment", () => {
    const g = greeting(RFX, { sentAt: SENT, vendors: 5, hasDraft: false });
    assert.match(g, /5 vendors/);
    assert.match(g, /No replies yet/);
    assert.match(g, /amendment/);
  });

  it("some replies not read yet: says how many are unread", () => {
    const g = greeting(RFX, { sentAt: SENT, vendors: 5, hasDraft: false, replied: 3, read: 1, noReply: 2 });
    assert.match(g, /3 of 5/);
    assert.match(g, /2 quotes are not read yet/);
    assert.match(g, /2 vendors haven't replied yet/);
  });

  it("all read with flagged prices: points to Compare", () => {
    const g = greeting(RFX, { sentAt: SENT, vendors: 5, hasDraft: false, replied: 5, read: 5, flagged: 3 });
    assert.match(g, /All \*\*5 quotes\*\* are read/);
    assert.match(g, /3 prices\*\* need your check in Compare/);
  });

  it("all read and clean: points to Finalise", () => {
    const g = greeting(RFX, { sentAt: SENT, vendors: 5, hasDraft: false, replied: 5, read: 5, flagged: 0 });
    assert.match(g, /no price is flagged/);
    assert.match(g, /Finalise/);
  });

  it("past the due date, a silent vendor can be chased", () => {
    const g = greeting(RFX, { sentAt: SENT, vendors: 5, hasDraft: false, replied: 4, read: 4, noReply: 1, pastDue: true });
    assert.match(g, /1 vendor hasn't replied by the due date/);
    assert.match(g, /chase/);
  });

  it("with an unsent amendment, points to it", () => {
    assert.match(greeting(RFX, { sentAt: SENT, vendors: 5, hasDraft: true }), /haven't seen/);
  });
});
