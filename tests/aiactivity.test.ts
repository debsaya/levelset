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
  it("the bar and the time left come from the same clock", () => {
    for (const now of [10_000, 30_000, 60_000]) {
      const g = groupProgress([job(1, 0), job(2, 0)], 90_000, now);
      assert.ok(Math.abs(g.pct - (1 - g.left / 90_000)) < 1e-9);
    }
  });
  it("the bar never moves backwards when an early job finishes", () => {
    const before = groupProgress([job(1, 0), job(2, 20_000)], 90_000, 40_000).pct;
    const after = groupProgress([job(1, 0, 40_000), job(2, 20_000)], 90_000, 41_000).pct;
    assert.ok(after >= before);
  });
});
