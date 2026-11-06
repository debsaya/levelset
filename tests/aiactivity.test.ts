import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupProgress, type Job } from "../lib/aiActivity";

const job = (id: number, start: number, end?: number): Job => ({ id, kind: "extract", label: "v" + id, start, end });

describe("AI progress panel maths", () => {
  it("counts finished and active jobs", () => {
    const g = groupProgress([job(1, 0, 40_000), job(2, 0), job(3, 0)], 90_000, 45_000);
    assert.equal(g.total, 3);
    assert.equal(g.done, 1);
    assert.ok(g.pct > 1 / 3 && g.pct < 0.97);
  });
  it("time left shrinks and never goes negative", () => {
    assert.equal(groupProgress([job(1, 0)], 90_000, 30_000).left, 60_000);
    const late = groupProgress([job(1, 0)], 90_000, 200_000);
    assert.equal(late.left, 0);
    assert.equal(late.over, true);
  });
  it("never reaches 100% until every job is done", () => {
    assert.ok(groupProgress([job(1, 0), job(2, 0)], 1000, 999_999).pct < 1);
  });
  it("an all-done group reports nothing left", () => {
    const g = groupProgress([job(1, 0, 10), job(2, 0, 20)], 90_000, 30);
    assert.equal(g.done, 2);
    assert.equal(g.left, 0);
  });
});
