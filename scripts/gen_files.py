import json, os, random, math
from spec import *

import os
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DEMO = f"{APP}/public/demo"
os.makedirs(f"{APP}/data", exist_ok=True)
for v in ["V1", "V2", "V3", "V4", "V5"]:
    os.makedirs(f"{DEMO}/{v}", exist_ok=True)

R = rfx()
P = vendor_prices()
PC = prior_contract()
BY = {l[0]: l for l in LINES}

json.dump(R, open(f"{APP}/data/rfx.json", "w"), indent=1)
json.dump({"V5": {"vendor": "Tungabhadra Packaging Co.", "contract_ref": "SFPL/RC/FY26/PKG-007",
                  "period": "Apr 2026 - Mar 2027", "basis": "INR per piece, ex-works Tumakuru, ex-GST",
                  "prices": PC}}, open(f"{APP}/data/prior_contracts.json", "w"), indent=1)

# ---------------- V1 Kaveri: Excel that ignores the template ----------------
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

wb = Workbook()
ws = wb.active
ws.title = "Quotation"
navy = PatternFill("solid", fgColor="1F3A5F")
light = PatternFill("solid", fgColor="EAF1F8")
thin = Side(style="thin", color="B7C4D3")
ws.merge_cells("A1:I1"); ws["A1"] = "KAVERI PACKWELL PVT LTD"
ws["A1"].font = Font(size=18, bold=True, color="FFFFFF"); ws["A1"].fill = navy
ws.merge_cells("A2:I2"); ws["A2"] = "Plot 41, SIPCOT Phase II, Hosur 635109  |  GSTIN 33AAKCK4417M1Z2  |  ISO 9001:2015  |  FSC Mix"
ws["A2"].font = Font(size=9, color="FFFFFF"); ws["A2"].fill = navy
ws["A4"] = "Commercial Offer to: Saffronleaf Foods Pvt Ltd, Bidadi"; ws["A4"].font = Font(bold=True)
ws["A5"] = "Our Ref: KPW/SFPL/2026/311     Date: 13-11-2026     Your enquiry: RFX-2026-PKG-014"
hdr = ["S.No", "Item Code", "Description", "Size (mm) LxWxH", "Ply / GSM", "Rate (Rs.)", "UOM", "Est. Qty / yr", "Value (Rs.)"]
for i, h in enumerate(hdr):
    c = ws.cell(row=7, column=i + 1, value=h)
    c.font = Font(bold=True, color="FFFFFF"); c.fill = navy; c.alignment = Alignment(horizontal="center", wrap_text=True)
order = [l for l in LINES]
grp = {3: [], 5: [], 7: []}
for l in order:
    grp[l[2]].append(l)
rows = grp[3] + grp[5] + grp[7]
random.Random(3).shuffle(grp[3])
r = 8
stated_total = 0
kaveri_codes = {}
for idx, l in enumerate(grp[3] + grp[5] + grp[7]):
    lid, t, ply, L, W, H, flute, pr, qty, use = l
    q = P["V1"][lid]
    code = f"KPW-{ply}P-{100 + idx:03d}"
    kaveri_codes[lid] = code
    tname = {"RSC": "Box (RSC)", "Partition": "Partition Set", "Layer pad": "Layer Pad", "Die-cut tray": "Die-Cut Tray",
             "Die-cut crash-lock": "Crash Lock Box", "Printed sleeve": "Sleeve E-Flute"}[t]
    desc = f"{ply} Ply {tname} - {pr}" + (" - MR coated" if lid == "L30" else "")
    size = f"{L}x{W}x{H}" if H else f"{L}x{W}"
    uom = "Per 100 Nos" if q["basis"] == "per 100 nos" else ("Per Set" if t == "Partition" else "Per Pc")
    val = (q["price"] / 100 if q["basis"] == "per 100 nos" else q["price"]) * qty
    vals = [idx + 1, code, desc, size, f"{ply} Ply / {GSM_SPEC[ply] if flute != 'E' else 'E-flute duplex'}", q["price"], uom, qty, round(val, 0)]
    for i, v in enumerate(vals):
        c = ws.cell(row=r, column=i + 1, value=v)
        c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
        if idx % 2: c.fill = light
        if i in (5, 8): c.number_format = "#,##0.00"
        if i == 7: c.number_format = "#,##0"
    if lid not in ("L29", "L30"):  # their total was computed before they added the two new lines
        stated_total += round(val, 0)
    r += 1
ws.cell(row=r + 1, column=8, value="TOTAL (excl. GST)").font = Font(bold=True)
c = ws.cell(row=r + 1, column=9, value=stated_total); c.font = Font(bold=True); c.number_format = "#,##0"
ws.cell(row=r + 3, column=1, value="Note: Rates for 3 ply boxes are per 100 Nos. All other rates per piece / per set.").font = Font(italic=True, size=9)
for col, w in zip("ABCDEFGHI", [6, 13, 34, 17, 26, 12, 13, 14, 15]):
    ws.column_dimensions[col].width = w

ws2 = wb.create_sheet("Terms & Compliance")
terms = [
    ("COMMERCIAL TERMS", ""),
    ("Prices", "Ex-GST. GST @ 5% extra as applicable."),
    ("Delivery", "Door delivery to Bidadi plant included in rates."),
    ("Payment", "60 days from date of invoice - accepted."),
    ("Validity", "90 days. Kraft price variation beyond +/-5% to be reviewed quarterly."),
    ("Printing plates / dies", "One-time cylinder & plate charge Rs. 4,500 per colour per design, extra."),
    ("Lead time", "10 working days from PO / schedule."),
    ("", ""),
    ("COMPLIANCE", ""),
    ("ISO 9001:2015", "Yes - certificate attached (valid till 31-Mar-2028)."),
    ("Food grade inks", "Yes. Water-based low-migration inks, starch adhesive."),
    ("Testing lab", "Yes - in-house BCT, ECT, burst & moisture (GSM / Cobb)."),
    ("Capacity", "1,200 MT per month (2 corrugators)."),
    ("FSC", "FSC Mix certified (COC available)."),
    ("Complaints last 12 months", "2 minor (print registration), both closed with CAPA."),
]
for i, (a, b) in enumerate(terms):
    ws2.cell(row=i + 1, column=1, value=a).font = Font(bold=True)
    ws2.cell(row=i + 1, column=2, value=b)
ws2.column_dimensions["A"].width = 28; ws2.column_dimensions["B"].width = 80
wb.save(f"{DEMO}/V1/Kaveri_Quotation_SFPL_FY27.xlsx")

# ---------------- PDFs (reportlab) ----------------
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DVB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DVS", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"))
pdfmetrics.registerFont(TTFont("DVSB", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"))
ss = getSampleStyleSheet()
N = ParagraphStyle("n", parent=ss["Normal"], fontName="DV", fontSize=8.5, leading=11)
NB = ParagraphStyle("nb", parent=N, fontName="DVB")
H1 = ParagraphStyle("h1", parent=N, fontName="DVSB", fontSize=16, leading=20, textColor=colors.HexColor("#7A1F1F"))
TINY = ParagraphStyle("t", parent=N, fontSize=6.2, leading=7.5, textColor=colors.HexColor("#555555"))


def deccan_letterhead(c, doc):
    c.saveState()
    c.setFillColor(colors.HexColor("#7A1F1F")); c.rect(0, A4[1] - 28 * mm, A4[0], 28 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("DVSB", 17); c.drawString(18 * mm, A4[1] - 14 * mm, "DECCAN CORRUGATED INDUSTRIES")
    c.setFont("DV", 8); c.drawString(18 * mm, A4[1] - 20 * mm, "Sy. No. 212, IDA Medchal, Hyderabad 501401  ·  GSTIN 36AAEFD7781K1ZP  ·  +91 40 2771 4410  ·  sales@deccancorrugated.in")
    c.setFillColor(colors.HexColor("#777777")); c.setFont("DV", 7)
    c.drawString(18 * mm, 10 * mm, "Regd. Office: 5-9-22, Secretariat Road, Hyderabad 500063 · Since 1994")
    c.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    c.restoreState()


doc = SimpleDocTemplate(f"{DEMO}/V2/DCI_Quotation_0418.pdf", pagesize=A4, topMargin=36 * mm, bottomMargin=20 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
el = []
el.append(Paragraph("QUOTATION", H1))
el.append(Paragraph("Ref: DCI/Q/2026-27/0418 &nbsp;&nbsp;&nbsp; Date: 14 November 2026", N))
el.append(Paragraph("To: Ms. Ananya Rao, Category Buyer – Packaging, Saffronleaf Foods Pvt Ltd, Bidadi", N))
el.append(Paragraph("Sub: Your RFQ RFX-2026-PKG-014 – Corrugated boxes for FY27", NB))
el.append(Spacer(1, 6))
el.append(Paragraph("Dear Madam, with reference to the above we are pleased to quote our best rates as under:", N))
el.append(Spacer(1, 6))
data = [["Sl", "Your Item", "Description", "Size (mm)", "Ply", "Rate / Pc*"]]
sl = 1
for l in LINES:
    lid = l[0]
    if lid not in P["V2"]:
        continue
    lid_, t, ply, L, W, H, flute, pr, qty, use = l
    size = f"{L}×{W}×{H}" if H else f"{L}×{W}"
    data.append([str(sl), lid, f"{t} {pr}", size, str(ply), f"₹ {P['V2'][lid]['price']:.2f}"])
    sl += 1
tb = Table(data, colWidths=[10 * mm, 18 * mm, 58 * mm, 34 * mm, 12 * mm, 26 * mm], repeatRows=1)
tb.setStyle(TableStyle([
    ("FONT", (0, 0), (-1, -1), "DV", 8), ("FONT", (0, 0), (-1, 0), "DVB", 8),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2E6E6")),
    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#999999")),
    ("ALIGN", (-1, 1), (-1, -1), "RIGHT"),
]))
el.append(tb)
el.append(Spacer(1, 8))
el.append(Paragraph("Items L26, L27 and L28 (die-cut trays / crash-lock): <b>Regret</b> – not in our present tooling capability.", N))
el.append(Spacer(1, 8))
el.append(Paragraph("<b>Terms &amp; Conditions</b>", N))
for t in [
    "1. Prices: Ex-works Medchal, Hyderabad. Freight &amp; transit insurance extra at actuals.",
    "2. GST @ 5% extra.",
    "3. Payment: 45 days from date of invoice. (We are unable to accept 60 days.)",
    "4. Delivery: 14 days from receipt of confirmed PO.",
    "5. Validity: 60 days. Prices subject to revision if kraft paper rates move by more than 5%.",
    "6. Quality: ISO 9001:2015 certified unit (certificate enclosed). Food-grade water-based inks and starch adhesive used. In-house lab with BCT, ECT, burst and Cobb testing.",
    "7. Capacity: 2,000 MT/month. No FSC certification at present.",
    "8. No customer quality complaints in the last 12 months.",
]:
    el.append(Paragraph(t, N))
el.append(Spacer(1, 14))
el.append(Paragraph("Thanking you and assuring our best services,<br/>For Deccan Corrugated Industries<br/><br/>Farhan Siddiqui, Sales Head", N))
el.append(Spacer(1, 40))
el.append(Paragraph("* All rates are before a volume rebate of 5% applicable on annual offtake exceeding ₹1,00,00,000 (Rupees One Crore only) across all items, settled quarterly by credit note. Rebate not applicable on freight. E&amp;OE.", TINY))
doc.build(el, onFirstPage=deccan_letterhead, onLaterPages=deccan_letterhead)


def certificate(path, company, addr, number, issued, valid, scope):
    d = SimpleDocTemplate(path, pagesize=A4, topMargin=30 * mm, leftMargin=25 * mm, rightMargin=25 * mm)
    C = ParagraphStyle("c", parent=N, fontName="DVS", fontSize=11, leading=16, alignment=1)
    CT = ParagraphStyle("ct", parent=C, fontName="DVSB", fontSize=22, leading=28, textColor=colors.HexColor("#14365D"))
    e = [Paragraph("CERTUS REGISTRAR SERVICES", ParagraphStyle("x", parent=C, fontSize=9, textColor=colors.grey)), Spacer(1, 20),
         Paragraph("CERTIFICATE OF REGISTRATION", CT), Spacer(1, 18),
         Paragraph("This is to certify that the Quality Management System of", C), Spacer(1, 8),
         Paragraph(f"<b>{company}</b><br/>{addr}", C), Spacer(1, 12),
         Paragraph("has been assessed and found to conform to the requirements of", C),
         Paragraph("<b>ISO 9001:2015</b>", ParagraphStyle("y", parent=C, fontSize=16, leading=22)), Spacer(1, 10),
         Paragraph(f"Scope: {scope}", C), Spacer(1, 26),
         Paragraph(f"Certificate No: {number}", C), Paragraph(f"Date of Issue: {issued}", C),
         Paragraph(f"<b>Valid Until: {valid}</b>", C), Spacer(1, 30),
         Paragraph("Validity of this certificate is subject to successful surveillance audits. Verify at certus-registrar.example/verify", ParagraphStyle("z", parent=C, fontSize=7, textColor=colors.grey))]
    d.build(e)


certificate(f"{DEMO}/V1/Kaveri_ISO9001_Certificate.pdf", "Kaveri Packwell Pvt Ltd", "Plot 41, SIPCOT Phase II, Hosur 635109, Tamil Nadu",
            "CRS-QMS-24-1187", "01 April 2025", "31 March 2028", "Design and manufacture of corrugated boxes, trays and fitments")
certificate(f"{DEMO}/V2/DCI_ISO9001_Certificate.pdf", "Deccan Corrugated Industries", "Sy. No. 212, IDA Medchal, Hyderabad 501401, Telangana",
            "CRS-QMS-23-0641", "15 August 2023", "14 August 2026", "Manufacture of corrugated boxes and fitments")
certificate(f"{DEMO}/V3/Coastal_ISO9001_Certificate.pdf", "Coastal Packaging Solutions LLP", "Unit 7, Sri City SEZ, Tirupati District, Andhra Pradesh 517646",
            "CRS-QMS-25-2290", "01 December 2024", "30 November 2027", "Manufacture of corrugated packaging for domestic and export markets")


# ---------------- V3 Coastal: Word doc, USD, commercials in paragraphs ----------------
from docx import Document
from docx.shared import Pt

d = Document()
st = d.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(10.5)
d.add_heading("Coastal Packaging Solutions LLP", level=1)
d.add_paragraph("Unit 7, Sri City SEZ, Tirupati District, Andhra Pradesh 517646")
d.add_paragraph("17 November 2026")
d.add_paragraph("Kind attn: Ms. Ananya Rao, Saffronleaf Foods Pvt Ltd")
d.add_paragraph("Re: Techno-commercial offer against RFX-2026-PKG-014")
d.add_paragraph(
    "Dear Ms. Rao, thank you for including Coastal in your FY27 packaging tender. As an export-oriented unit, our price book is maintained "
    "in US Dollars, and accordingly all prices in this offer are quoted in USD per piece (per set for partitions). For the purpose of your "
    "evaluation a reference exchange rate of ₹88.20 to the US Dollar may be used; actual invoicing will be in INR at the RBI reference rate "
    "prevailing on the date of invoice. Prices include delivery to your Bidadi plant (CIP Bidadi) and are exclusive of GST at 5%, with one "
    "exception: our 7-ply prices are quoted inclusive of GST at 5%, as they are drawn from our domestic list.")
d.add_paragraph(
    "Our payment expectation is 60 days from invoice, which we are pleased to accept in line with your terms. Prices are firm for 30 days "
    "only given USD exposure, after which they move with our monthly kraft index. Lead time is 21 days from PO for printed items and 15 days "
    "for plain items.")
part_usd = P["V3"]["L23"]["price"], P["V3"]["L24"]["price"], P["V3"]["L25"]["price"]
d.add_paragraph(
    f"For the fitments, the 9-cell partition set (your item 23) is offered at USD {part_usd[0]} per set and the 12-cell set (your item 24) at "
    f"USD {part_usd[1]} per set, while the pallet layer pad (item 25) is USD {part_usd[2]} each. Prices for the remaining items are tabulated below.")
t = d.add_table(rows=1, cols=4); t.style = "Light Grid Accent 1"
for i, h in enumerate(["Item", "Description", "Size (mm)", "USD / piece"]):
    t.rows[0].cells[i].text = h
for l in LINES:
    lid = l[0]
    if lid in ("L23", "L24", "L25") or lid not in P["V3"]:
        continue
    lid_, ty, ply, L, W, H, flute, pr, qty, use = l
    desc = f"{ply}-ply {ty}, {pr}"
    if lid == "L21":
        desc = "ALTERNATE OFFERED: 5-ply heavy-duty RSC (180/150/150/150/180 GSM, 26 BF) in place of 7-ply; BCT equivalent ~680 kgf"
    row = t.add_row().cells
    row[0].text = lid; row[1].text = desc; row[2].text = f"{L} x {W} x {H}"; row[3].text = f"{P['V3'][lid]['price']}"
d.add_paragraph(
    "We regret our inability to quote for item L12 (500 x 350 x 300 mm, 5-ply) as the blank exceeds our corrugator deckle at the required grain direction.")
d.add_heading("Responses to your supplier questionnaire", level=2)
d.add_paragraph(
    "Coastal is ISO 9001:2015 certified (certificate CRS-QMS-25-2290, valid until 30 November 2027) and FSC certified. All inks are water-based "
    "and low-migration, suitable for secondary food packaging, and we use corn-starch adhesive. Our in-house laboratory carries out BCT, ECT, burst, "
    "GSM and Cobb tests on every lot. Monthly converting capacity is about 800 tonnes. In March 2026 we had one major rejection from an FMCG customer "
    "relating to wet strength on export cartons; root cause was addressed and the CAPA was closed in May 2026.")
d.add_paragraph("Warm regards,\nMeera Iyer\nHead – Key Accounts, Coastal Packaging Solutions LLP")
d.save(f"{DEMO}/V3/Coastal_Offer_Saffronleaf_FY27.docx")

# ---------------- V5 Tungabhadra: email + questionnaire PDF ----------------
doc = SimpleDocTemplate(f"{DEMO}/V5/TP_Supplier_Questionnaire_2026.pdf", pagesize=A4, topMargin=20 * mm, leftMargin=20 * mm, rightMargin=20 * mm)
e = [Paragraph("Tungabhadra Packaging Co. – Supplier Questionnaire Response (Saffronleaf RFX-2026-PKG-014)", NB), Spacer(1, 8)]
qa = [
    ("Q1 ISO 9001:2015", "Yes. Cert no. CRS-QMS-24-0932, valid till 30-06-2027. Copy already with your QA team."),
    ("Q2 Food-safe inks & adhesives", "Yes, water based inks, starch gum."),
    ("Q3 In-house lab", "Burst, BCT and moisture tested in-house. ECT is done at an external NABL lab when required."),
    ("Q4 Capacity", "650 MT per month"),
    ("Q5 Lead time", "7 days (local, Tumakuru)"),
    ("Q6 60-day payment", "Yes, same as current contract"),
    ("Q7 FSC", "No"),
    ("Q8 Validity / escalation", "Same as current contract. Kraft linked, monthly."),
    ("Q9 Complaints", "One complaint on L26 trays (glue failure) in Aug 2026. Resolved."),
]
tb = Table([[Paragraph(a, NB), Paragraph(b, N)] for a, b in qa], colWidths=[55 * mm, 110 * mm])
tb.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
e.append(tb)
doc.build(e)

V5_EMAIL = """From: Ravi Kumar <ravi@tungabhadrapack.in>
To: Ananya Rao <ananya.rao@saffronleaf.in>
Date: Wed, 18 Nov 2026 21:42 +0530
Subject: RE: RFX-2026-PKG-014 FY27 corrugated boxes - quotation

Hi Ananya madam,

₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra.

Questionnaire attached. Pls confirm by Friday so we can block paper.

Regards
Ravi
Tungabhadra Packaging Co., Tumakuru
Sent from my phone
"""

# ---------------- vendors.json (inbox) ----------------
inbox = []
bodies = {
    "V1": "Dear Ananya, please find attached our best offer in our standard format along with ISO certificate. Rates for 3 ply are per 100 nos as per our practice. Regards, Suresh",
    "V2": "Madam, please find enclosed our quotation ref 0418 and ISO certificate. Kindly consider us favourably. Farhan Siddiqui",
    "V3": "Dear Ananya, attached is our techno-commercial offer along with our ISO certificate. Happy to discuss. Best, Meera",
    "V4": "sir pls find rate card. all sizes avilable. Manjunath 98450xxxxx",
    "V5": V5_EMAIL.split("\n\n", 1)[1],
}
subjects = {
    "V1": "Re: RFX-2026-PKG-014 – Kaveri Packwell offer",
    "V2": "Quotation DCI/Q/2026-27/0418 – Saffronleaf",
    "V3": "Coastal Packaging – Offer for FY27 corrugated packaging",
    "V4": "rate card",
    "V5": "RE: RFX-2026-PKG-014 FY27 corrugated boxes - quotation",
}
dates = {"V1": "2026-11-13T11:05:00+05:30", "V2": "2026-11-14T16:20:00+05:30", "V3": "2026-11-17T10:12:00+05:30", "V4": "2026-11-12T19:47:00+05:30", "V5": "2026-11-18T21:42:00+05:30"}
files = {
    "V1": ["Kaveri_Quotation_SFPL_FY27.xlsx", "Kaveri_ISO9001_Certificate.pdf"],
    "V2": ["DCI_Quotation_0418.pdf", "DCI_ISO9001_Certificate.pdf"],
    "V3": ["Coastal_Offer_Saffronleaf_FY27.docx", "Coastal_ISO9001_Certificate.pdf"],
    "V4": ["IMG_20261112_194512.jpg"],
    "V5": ["TP_Supplier_Questionnaire_2026.pdf"],
}
for v in VENDORS:
    inbox.append({**v, "subject": subjects[v["id"]], "received_at": dates[v["id"]], "body": bodies[v["id"]],
                  "attachments": [f"demo/{v['id']}/{f}" for f in files[v["id"]]]})
json.dump(inbox, open(f"{APP}/data/vendors.json", "w"), indent=1, ensure_ascii=False)

# ---------------- truth for evaluation ----------------
truth = {}
fx = 88.20
for vid, lines in P.items():
    truth[vid] = {lid: round(q["unit_inr"], 2) for lid, q in lines.items()}
json.dump({"prices_unit_inr_pre_adjustment": truth, "prior_contract_V5": PC,
           "V1_stated_total": stated_total}, open("/home/claude/scripts/truth.json", "w"), indent=1)
json.dump(P, open("/home/claude/scripts/vendor_quotes_raw.json", "w"), indent=1)
print("ok; V1 stated total", stated_total)
