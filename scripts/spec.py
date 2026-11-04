"""Single source of truth for the fabricated demo world.

Buyer: Saffronleaf Foods Pvt Ltd (fictional), Bidadi plant, Karnataka.
Event: FY27 annual rate contract for corrugated packaging, 30 lines.
"""
import json, random, math

random.seed(27)

BOARD_GSM = {3: 450, 5: 750, 7: 1050}

# (id, type, ply, L, W, H, flute, print, annual_qty, use, extra)
LINES = [
    ("L01", "RSC", 3, 200, 150, 100, "B", "Plain", 260000, "Spice pouch shipper (100 g x 24)"),
    ("L02", "RSC", 3, 250, 200, 150, "B", "Plain", 190000, "Spice pouch shipper (200 g x 24)"),
    ("L03", "RSC", 3, 300, 200, 200, "B", "1 colour", 150000, "Namkeen shipper (150 g x 30)"),
    ("L04", "RSC", 3, 300, 250, 150, "B", "1 colour", 125000, "Masala box shipper"),
    ("L05", "RSC", 3, 350, 250, 200, "B", "Plain", 95000, "Bulk pouch shipper (1 kg x 10)"),
    ("L06", "RSC", 3, 220, 160, 120, "B", "2 colour", 165000, "Retail-ready spice carton"),
    ("L07", "RSC", 3, 250, 180, 80, "B", "2 colour", 80000, "Gift pack outer"),
    ("L08", "RSC", 3, 180, 120, 90, "B", "Plain", 210000, "Sachet shipper"),
    ("L09", "RSC", 5, 400, 300, 300, "BC", "Plain", 115000, "Biscuit shipper (12 x 400 g)"),
    ("L10", "RSC", 5, 450, 300, 250, "BC", "1 colour", 95000, "Cookie tin shipper"),
    ("L11", "RSC", 5, 400, 350, 250, "BC", "1 colour", 85000, "RTE meal shipper"),
    ("L12", "RSC", 5, 500, 350, 300, "BC", "Plain", 70000, "Atta 5 kg x 4 shipper"),
    ("L13", "RSC", 5, 380, 280, 240, "BC", "2 colour", 90000, "Modern-trade display shipper"),
    ("L14", "RSC", 5, 420, 320, 280, "BC", "1 colour", 80000, "Pickle jar shipper (12 x 500 g)"),
    ("L15", "RSC", 5, 350, 300, 300, "BC", "Plain", 100000, "Ghee jar shipper"),
    ("L16", "RSC", 5, 480, 320, 320, "BC", "2 colour", 60000, "Festive combo shipper"),
    ("L17", "RSC", 5, 300, 300, 250, "BC", "1 colour", 85000, "Sauce bottle shipper"),
    ("L18", "RSC", 5, 550, 400, 300, "BC", "Plain", 45000, "Rice 10 kg x 2 shipper"),
    ("L19", "RSC", 7, 600, 400, 400, "BCB", "Plain", 25000, "Bulk ingredient carton (25 kg)"),
    ("L20", "RSC", 7, 550, 450, 400, "BCB", "1 colour", 20000, "Institutional pack carton"),
    ("L21", "RSC", 7, 650, 450, 450, "BCB", "Plain", 15000, "Bulk dry-fruit carton (30 kg)"),
    ("L22", "RSC", 7, 500, 500, 450, "BCB", "Plain", 18000, "Oil tin carton (4 x 5 L)"),
    ("L23", "Partition", 3, 400, 300, 280, "B", "Plain", 120000, "9-cell partition set for L14"),
    ("L24", "Partition", 3, 350, 300, 300, "B", "Plain", 80000, "12-cell partition set for L15"),
    ("L25", "Layer pad", 3, 1200, 1000, 0, "B", "Plain", 40000, "Pallet layer pad"),
    ("L26", "Die-cut tray", 3, 380, 280, 60, "B", "2 colour", 150000, "Shelf-ready tray"),
    ("L27", "Die-cut tray", 5, 400, 300, 80, "BC", "1 colour", 90000, "Heavy shelf-ready tray"),
    ("L28", "Die-cut crash-lock", 3, 250, 200, 120, "B", "2 colour", 70000, "E-commerce crash-lock box"),
    ("L29", "Printed sleeve", 3, 300, 200, 100, "E", "4 colour", 60000, "Festive gift sleeve (NEW)"),
    ("L30", "RSC", 5, 600, 400, 300, "BC", "1 colour", 30000, "Export carton, moisture-resistant (NEW)"),
]

NEW_LINES = {"L29", "L30"}


def board_gsm(ply, flute):
    if flute == "E":
        return 400
    return BOARD_GSM[ply]


def area_m2(t, L, W, H):
    if t == "RSC":
        return (2 * L + 2 * W + 40) * (W + H) / 1e6
    if t == "Partition":
        # cells: approximate total strip area
        cells = 9 if L == 400 else 12
        n_long = int(math.sqrt(cells)) - 1 if cells == 9 else 3
        n_short = 2 if cells == 9 else 2
        return (n_long * L * H + n_short * W * H + (n_long + n_short) * 0) / 1e6
    if t == "Layer pad":
        return L * W / 1e6
    if t == "Die-cut tray":
        return (L + 2 * H + 30) * (W + 2 * H + 30) / 1e6
    if t == "Die-cut crash-lock":
        return (2 * L + 2 * W + 40) * (W + H + 40) / 1e6
    if t == "Printed sleeve":
        return (2 * W + 2 * H + 30) * L / 1e6
    raise ValueError(t)


def weight_kg(l):
    lid, t, ply, L, W, H, flute, pr, qty, use = l
    return round(area_m2(t, L, W, H) * board_gsm(ply, flute) / 1000, 3)


GSM_SPEC = {3: "150/120/150", 5: "150/120/120/120/150", 7: "180/120/150/120/150/120/180"}
BF_SPEC = {3: "18 BF", 5: "20 BF", 7: "22 BF"}


def describe(l):
    lid, t, ply, L, W, H, flute, pr, qty, use = l
    dims = f"{L} x {W}" + (f" x {H}" if H else "") + " mm"
    if t == "Layer pad":
        dims = f"{L} x {W} mm"
    return f"{ply}-ply {t} {dims}, {flute}-flute, {pr}"


# ---- "fair market" price model (INR per kg, ex-GST, delivered Bidadi) ----
def base_per_kg(l):
    lid, t, ply, L, W, H, flute, pr, qty, use = l
    p = {3: 38.0, 5: 41.0, 7: 44.0}[ply]
    p += {"Plain": 0, "1 colour": 2.0, "2 colour": 3.5, "4 colour": 7.0}[pr]
    if t.startswith("Die-cut"):
        p += 4
    if t == "Partition":
        p += 3
    if t == "Layer pad":
        p -= 1
    if t == "Printed sleeve":
        p += 5
    if lid == "L30":
        p += 6
    return p


def fair_unit(l):
    return base_per_kg(l) * weight_kg(l) + 0.40  # conversion overhead per piece


def rfx():
    lines = []
    for l in LINES:
        lid, t, ply, L, W, H, flute, pr, qty, use = l
        lines.append({
            "id": lid,
            "description": describe(l),
            "type": t,
            "ply": ply,
            "dimensions_mm": {"L": L, "W": W, "H": H},
            "flute": flute,
            "board_gsm": GSM_SPEC[ply] if flute != "E" else "E-flute 120/100/120 + 250 GSM duplex top",
            "bursting_factor": BF_SPEC[ply],
            "print": pr,
            "end_use": use,
            "annual_qty": qty,
            "uom": "piece" if t not in ("Partition",) else "set",
            "est_weight_kg": weight_kg(l),
            "is_new": lid in NEW_LINES,
        })
    return {
        "id": "RFX-2026-PKG-014",
        "title": "FY27 Annual Rate Contract — Corrugated Packaging",
        "buyer": {"company": "Saffronleaf Foods Pvt Ltd", "name": "Ananya Rao", "role": "Category Buyer, Packaging",
                  "plant": "Bidadi Plant, Ramanagara, Karnataka 562109"},
        "scope": ("Annual rate contract (Apr 2027 to Mar 2028) for 30 corrugated packaging items used across "
                  "spices, snacks, staples and ready-to-eat lines at the Bidadi plant. Award may be split by line. "
                  "Volumes are forecasts, not commitments."),
        "currency": "INR",
        "due_date": "2026-11-18",
        "lines": lines,
        "questionnaire": [
            {"id": "Q1", "text": "Are you ISO 9001:2015 certified? Attach a valid certificate.", "kind": "yes_no", "must_have": True},
            {"id": "Q2", "text": "Do you use food-safe, low-migration inks and adhesives suitable for secondary food packaging?", "kind": "yes_no", "must_have": True},
            {"id": "Q3", "text": "Do you have an in-house lab for BCT, ECT, burst strength and moisture testing?", "kind": "yes_no", "must_have": True},
            {"id": "Q4", "text": "Monthly converting capacity (tonnes)?", "kind": "number", "must_have": False},
            {"id": "Q5", "text": "Standard lead time from PO (days)?", "kind": "number", "must_have": False},
            {"id": "Q6", "text": "Do you accept 60-day payment terms?", "kind": "yes_no", "must_have": False},
            {"id": "Q7", "text": "Do you hold FSC or recycled-content certification?", "kind": "yes_no", "must_have": False},
            {"id": "Q8", "text": "Price validity (days) and kraft paper price escalation clause, if any?", "kind": "text", "must_have": False},
            {"id": "Q9", "text": "Quality rejections or complaints from any FMCG customer in the last 12 months?", "kind": "text", "must_have": False},
        ],
        "terms": {
            "delivery": "DAP Saffronleaf Bidadi plant (freight included in price)",
            "payment": "60 days from receipt of goods and invoice",
            "taxes": "Quote prices exclusive of GST; state GST rate separately",
            "validity": "Prices valid 90 days from submission",
            "price_review": "Quarterly review linked to kraft paper index; +/-5% band",
            "quality": "Lot-wise COA with BCT and burst results; AQL 1.5",
            "format": "Quote per piece (per set for partitions) in INR. Any format accepted.",
        },
    }


VENDORS = [
    {"id": "V1", "name": "Kaveri Packwell Pvt Ltd", "city": "Hosur, Tamil Nadu", "contact": "Suresh Natarajan", "email": "suresh.n@kaveripackwell.co.in", "format": "Excel"},
    {"id": "V2", "name": "Deccan Corrugated Industries", "city": "Medchal, Hyderabad", "contact": "Farhan Siddiqui", "email": "sales@deccancorrugated.in", "format": "PDF on letterhead"},
    {"id": "V3", "name": "Coastal Packaging Solutions LLP", "city": "Sri City SEZ, Andhra Pradesh", "contact": "Meera Iyer", "email": "meera.iyer@coastalpack.co", "format": "Word document"},
    {"id": "V4", "name": "Nandi Box Works", "city": "Peenya, Bengaluru", "contact": "Manjunath G", "email": "nandiboxworks@gmail.com", "format": "Photo of rate card"},
    {"id": "V5", "name": "Tungabhadra Packaging Co.", "city": "Tumakuru, Karnataka", "contact": "Ravi Kumar", "email": "ravi@tungabhadrapack.in", "format": "Email (incumbent)"},
]


def r2(x):
    return round(x + 1e-9, 2)


def vendor_prices():
    """Truth table of what each vendor quotes, in their own terms."""
    out = {}
    rnd = random.Random(42)
    by = {l[0]: l for l in LINES}
    # V1 Kaveri: delivered, ex-GST, factor 1.03; L01-L08 quoted per 100 nos
    v1 = {}
    for l in LINES:
        u = fair_unit(l) * 1.03 * rnd.uniform(0.97, 1.04)
        if l[0] in ("L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08"):
            v1[l[0]] = {"price": r2(u * 100), "basis": "per 100 nos", "unit_inr": u}
        else:
            v1[l[0]] = {"price": r2(u), "basis": "per piece", "unit_inr": u}
    out["V1"] = v1
    # V2 Deccan: ex-works Hyderabad, ex-GST, 0.99, no die-cut (L26-28); 5% conditional rebate
    v2 = {}
    for l in LINES:
        if l[0] in ("L26", "L27", "L28"):
            continue
        u = (fair_unit(l) - 0.9 * weight_kg(l)) * 0.99 * rnd.uniform(0.97, 1.03)  # ex-works is cheaper by ~freight
        v2[l[0]] = {"price": r2(u), "basis": "per piece", "unit_inr": u}
    out["V2"] = v2
    # V3 Coastal: USD per piece, delivered; 7-ply incl 5% GST; regret L12; L21 alternate 5-ply
    fx = 88.20
    v3 = {}
    for l in LINES:
        if l[0] == "L12":
            continue
        u = fair_unit(l) * 1.06 * rnd.uniform(0.97, 1.03)
        if l[0] == "L21":
            u = u * 0.78  # cheaper because it is 5-ply alternate
        usd = u / fx
        if l[2] == 7 and l[0] != "L21":
            usd = usd * 1.05
        v3[l[0]] = {"price": round(usd, 4 if usd < 1 else 3), "basis": "USD per piece", "unit_inr": u}
    out["V3"] = v3
    # V4 Nandi: rate card, per box (inches), ex-works Peenya, GST extra, partitions per bundle of 25
    v4 = {}
    v4_lines = ["L01", "L02", "L03", "L05", "L06", "L08", "L09", "L10", "L12", "L13", "L14", "L15", "L17", "L18", "L19", "L22", "L23", "L24", "L25"]
    for lid in v4_lines:
        l = by[lid]
        u = (fair_unit(l) - 0.5 * weight_kg(l)) * 0.91 * rnd.uniform(0.97, 1.03)
        if lid in ("L23", "L24"):
            v4[lid] = {"price": float(round(u * 25)), "basis": "per bundle of 25 sets", "unit_inr": u}
        else:
            # small vendors round to 50 paise
            v4[lid] = {"price": round(u * 2) / 2, "basis": "per box", "unit_inr": u}
    out["V4"] = v4
    return out


def prior_contract():
    """FY26 rate contract with incumbent Tungabhadra (per piece, ex-works Tumakuru, ex-GST)."""
    rnd = random.Random(7)
    pc = {}
    for l in LINES:
        if l[0] in NEW_LINES:
            continue
        ply = l[2]
        per_kg = {3: 36.5, 5: 40.0, 7: 43.0}[ply] + (base_per_kg(l) - {3: 38.0, 5: 41.0, 7: 44.0}[ply])
        u = per_kg * weight_kg(l) * rnd.uniform(0.98, 1.02) + 0.35
        pc[l[0]] = r2(u)
    return pc


if __name__ == "__main__":
    R = rfx()
    tot_kg = sum(l["annual_qty"] * l["est_weight_kg"] for l in R["lines"])
    tot_val = sum(l[8] * fair_unit(l) for l in LINES)
    print("tonnes/yr", round(tot_kg / 1000, 1), "fair value Cr", round(tot_val / 1e7, 2))
    for l in LINES:
        print(l[0], describe(l), weight_kg(l), round(fair_unit(l), 2))
