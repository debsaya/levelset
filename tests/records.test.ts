import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MASTER, certificate } from "../lib/vendorpool";
import saved from "../data/saved_reading.json";

const DUE = "2026-11-18";

describe("Vendor records match the certificates vendors later attach", () => {
  for (const id of ["V1", "V2", "V3"]) {
    it(`${id}: the date on record is the date on the certificate`, () => {
      const rec = MASTER.find((v) => v.id === id)!;
      const doc = (saved as any).extractions[id].extraction.documents.find((d: any) => /iso/i.test(d.kind));
      assert.equal(rec.iso_valid_until, doc.valid_until);
    });
  }
  it("the wording says it is a record, not a verdict on the vendor", () => {
    for (const v of MASTER) assert.match(certificate(v, DUE).text, /on record/);
  });
});
