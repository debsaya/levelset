import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocker } from "../lib/flow";
import { blankState, demoState, exampleState } from "../lib/store";

describe("Why a later step is empty follows steps 1 and 2", () => {
  it("a blank request points back to step 1", () => {
    const b = blocker(blankState());
    assert.equal(b?.to, "rfx");
    assert.match(b!.title, /no request/i);
  });
  it("a request that has not been sent points back to step 1", () => {
    const b = blocker(demoState());
    assert.equal(b?.to, "rfx");
    assert.match(b!.title, /not been sent/i);
  });
  it("a sent request with unread quotes points to step 2", () => {
    const s = exampleState();
    s.responses = s.responses.map((r) => ({ ...r, status: "new" as const, extraction: undefined }));
    const b = blocker(s);
    assert.equal(b?.to, "quotes");
    assert.match(b!.title, /waiting to be read/);
  });
  it("quotes being read are called out", () => {
    const s = demoState();
    s.sentAt = "2026-11-12T10:00:00+05:30";
    s.responses = s.responses.map((r) => ({ ...r, status: "reading" as const }));
    assert.match(blocker(s)!.title, /Reading 5 quotes/);
  });
  it("a sent blank request with no replies says nobody has replied", () => {
    const s = blankState();
    s.rfx.lines = demoState().rfx.lines.slice(0, 2);
    s.sentAt = "2026-11-12T10:00:00+05:30";
    assert.match(blocker(s)!.title, /No vendor has replied/);
  });
  it("is silent once at least one quote has been read", () => {
    const s = demoState();
    s.responses[0] = { ...s.responses[0], status: "done" };
    assert.equal(blocker(s), null);
  });
});

import { nextStep } from "../lib/flow";
describe("What to do next", () => {
  it("a blank request says to describe what you are buying", () => {
    assert.match(nextStep(blankState(), 0).text, /co-pilot/);
  });
  it("the reset sample event says to check vendors and send", () => {
    const n = nextStep(demoState(), 0);
    assert.equal(n.to, "send");
    assert.match(n.text, /5 vendors/);
  });
  it("sent with unread quotes says to read them", () => {
    const s = exampleState();
    s.responses = s.responses.map((r) => ({ ...r, status: "new" as const, extraction: undefined }));
    assert.equal(nextStep(s, 0).to, "quotes");
    assert.match(nextStep(s, 0).text, /5 quotes/);
  });
  it("flagged prices send you to compare, and a clean comparison to the decision", () => {
    const s = demoState();
    s.sentAt = "2026-11-12T10:00:00+05:30";
    s.responses = s.responses.map((r) => ({ ...r, status: "done" as const }));
    assert.equal(nextStep(s, 3).to, "compare");
    assert.equal(nextStep(s, 0).to, "overview");
  });
});
