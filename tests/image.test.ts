import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_MAX_SIDE, targetSize } from "../lib/image";

describe("Phone photo shrinking", () => {
  it("scales the long side down to the limit and keeps the shape", () => {
    const t = targetSize(4000, 3000);
    assert.equal(t.w, PHOTO_MAX_SIDE);
    assert.equal(t.h, 1350);
    const p = targetSize(3000, 4000);
    assert.equal(p.h, PHOTO_MAX_SIDE);
    assert.equal(p.w, 1350);
  });
  it("leaves small pictures alone", () => assert.deepEqual(targetSize(1200, 800), { w: 1200, h: 800 }));
});
