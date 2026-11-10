import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appNow, SAMPLE_NOW } from "../lib/clock";
import { exampleState, demoState } from "../lib/store";

describe("The sample event's clock", () => {
  it("is pinned for the demo, so it never turns 'past due' later", () => {
    assert.equal(appNow("demo").getTime(), SAMPLE_NOW.getTime());
    assert.ok(SAMPLE_NOW.toISOString().slice(0, 10) < demoState().rfx.due_date);
  });
  it("uses the real clock for a request the buyer starts", () => {
    assert.ok(Math.abs(appNow("blank").getTime() - Date.now()) < 5000);
  });
});

describe("The finished example", () => {
  it("opens with an audit trail: the send, then one line per quote read, newest first", () => {
    const s = exampleState();
    const read = s.responses.filter((r) => r.status === "done").length;
    assert.equal(s.audit.length, read + 1);
    assert.match(s.audit[s.audit.length - 1].what, /^Sent /);
    assert.match(s.audit[0].what, /^Read quote from /);
  });
});
