"""Score extraction against ground truth: per-piece INR price, ex-GST, before freight/discounts."""
import json, sys
from spec import *
truth = json.load(open("/home/claude/scripts/truth.json"))
T = truth["prices_unit_inr_pre_adjustment"]
PC = truth["prior_contract_V5"]
W = {l[0]: weight_kg(l) for l in LINES}
FX = 88.20
tot_ok = tot = 0
for vid in sys.argv[1:] or ["V1", "V2", "V3", "V4", "V5"]:
    try:
        j = json.load(open(f"/home/claude/scripts/out_{vid}.json"))
    except FileNotFoundError:
        continue
    if "extraction" not in j:
        print(vid, "ERROR", j.get("error", "")[:200]); continue
    ex = j["extraction"]
    got = {}
    for l in ex["lines"]:
        lid = l["rfx_line_id"]
        if not lid: continue
        if l["derived_from"] == "prior_contract":
            got[lid] = ("prior", PC.get(lid))
            continue
        p = l["price"]
        if p is None: continue
        v = p * W[lid] if l["basis_unit"] == "kg" else p / (l["basis_qty"] or 1)
        if (l["currency"] or "").upper() == "USD": v *= FX
        if l["tax_included"]: v /= 1 + (ex["tax"]["gst_rate_pct"] or 5) / 100
        got[lid] = (l["derived_from"], v, min(l["match_confidence"], l["read_confidence"]))
    if vid == "V5":
        exp = {}
        for l in LINES:
            if l[1] == "RSC" and l[2] == 5: exp[l[0]] = 42 * W[l[0]]
            elif l[1] == "RSC" and l[2] == 3: exp[l[0]] = 38 * W[l[0]]
            elif l[0] in PC: exp[l[0]] = PC[l[0]]
    else:
        exp = T[vid]
    ok = 0; bad = []
    for lid, e in exp.items():
        g = got.get(lid)
        gv = g[1] if g else None
        if gv is not None and abs(gv - e) / e < 0.02: ok += 1
        else: bad.append((lid, round(e, 2), None if gv is None else round(gv, 2), g[0] if g else None, g[2] if g and len(g) > 2 else None))
    extra = [k for k in got if k not in exp]
    tot_ok += ok; tot += len(exp)
    nq = [n["rfx_line_id"] for n in ex["not_quoted"]]
    print(f"{vid}: {ok}/{len(exp)} correct | extra lines {extra} | not_quoted {nq} | adj {[(a['kind'], a['pct'], a['conditional']) for a in ex['adjustments']]} | freight {ex['freight']['included']} | tax {ex['tax']['basis']} {ex['tax']['gst_rate_pct']} | total {ex['stated_total'] and ex['stated_total']['amount']} | model {j.get('model')} {j.get('ms')}ms")
    for b in bad: print("   miss", b)
    print("   Q:", [(q["question_id"], q["assessment"]) for q in ex["questionnaire"]])
    print("   docs:", [(d["file"], d["kind"], d["valid_until"]) for d in ex["documents"]])
    print("   unresolved:", ex["unresolved"][:6])
print(f"TOTAL {tot_ok}/{tot}")
