import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exampleState } from "../lib/store";
import { normalize } from "../lib/normalize";
import { scenarios } from "../lib/award";

const run = () => {
  const s: any = exampleState();
  return { s, n: normalize(s.rfx, s.responses, s.assumptions, s.overrides, s.qOverrides, s.prior) };
};

describe("An ISO claim in the questionnaire is not a certificate", () => {
  it("Tungabhadra only wrote the claim, so they need to send proof", () => {
    const { n } = run();
    assert.equal(n.vendors.find((v) => v.name.startsWith("Tungabhadra"))!.qualification, "conditional");
  });
  it("the recommended award is the split between the vendors who attached certificates", () => {
    const { s, n } = run();
    const sc = scenarios(s.rfx, n);
    const split = sc.find((x) => x.key === "split_q")!;
    assert.deepEqual(split.vendorsUsed.map((u) => u.name.split(" ")[0]).sort(), ["Coastal", "Kaveri"]);
    assert.ok(!sc[0].vendorsUsed.some((u) => u.name.startsWith("Tungabhadra")));
  });
});
