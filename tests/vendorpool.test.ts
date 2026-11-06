import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MASTER, certificate, parseVendorLines, suggest } from "../lib/vendorpool";
import { demoState, markSent } from "../lib/store";

const DUE = "2026-11-18";

describe("Choosing who gets the request", () => {
  it("the suggested shortlist keeps the incumbent and drops expired, far-away and wrong-category vendors", () => {
    const ids = suggest(MASTER, DUE).map((p) => p.id);
    assert.ok(ids.includes("V5"), "incumbent is in");
    assert.ok(!ids.includes("V2"), "expired certificate is out");
    assert.ok(!ids.includes("V9"), "840 km away is out");
    assert.ok(!ids.includes("V10"), "steel drums are not corrugated");
    assert.ok(ids.length >= 4 && ids.length <= 5);
  });
  it("every suggestion says why", () => {
    for (const p of suggest(MASTER, DUE)) assert.ok(p.why.length > 10);
  });
  it("reads certificate status as of the due date", () => {
    const v = (id: string) => MASTER.find((x) => x.id === id)!;
    assert.equal(certificate(v("V2"), DUE).tone, "bad");
    assert.equal(certificate(v("V4"), DUE).tone, "warn");
    assert.equal(certificate(v("V1"), DUE).tone, "good");
  });
  it("reads vendors from pasted lines in the usual shapes", () => {
    const { vendors, skipped } = parseVendorLines(
      ["Asha Traders <asha@ashatraders.in>", "Bharat Cartons, bharat@cartons.co.in, Pune", "sales@xyzpack.com", "just a name"].map((l) => l.split(/,(?![^<]*>)/)),
      20,
      "paste"
    );
    assert.equal(vendors.length, 3);
    assert.equal(vendors[0].name, "Asha Traders");
    assert.equal(vendors[0].email, "asha@ashatraders.in");
    assert.equal(vendors[1].city, "Pune");
    assert.equal(vendors[2].name, "xyzpack");
    assert.deepEqual(skipped, ["just a name"]);
    assert.equal(vendors[0].id, "V20");
  });
  it("skips a spreadsheet header row without complaint", () => {
    const { vendors, skipped } = parseVendorLines([["Vendor name", "Email"], ["Asha", "asha@x.in"]], 30, "upload");
    assert.equal(vendors.length, 1);
    assert.equal(skipped.length, 0);
  });
  it("sending the sample event keeps replies only from invited vendors", () => {
    const s = demoState();
    s.sentTo = s.sentTo.filter((i) => i !== "V3");
    const sent = markSent(s);
    assert.ok(sent.sentAt);
    assert.equal(sent.responses.length, 4);
    assert.ok(!sent.responses.some((r) => r.vendor.id === "V3"));
  });
  it("sending twice does not change the send time", () => {
    const once = markSent(demoState());
    assert.equal(markSent(once).sentAt, once.sentAt);
  });
});
