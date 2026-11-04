import json, random
import numpy as np, cv2
from playwright.sync_api import sync_playwright
from spec import *

P = json.load(open("/home/claude/scripts/vendor_quotes_raw.json"))
BY = {l[0]: l for l in LINES}


def inch(mm):
    return round(mm / 25.4 * 2) / 2


def fmt(x):
    return str(int(x)) if x == int(x) else f"{x:g}"


rows = []
for lid, q in P["V4"].items():
    lid_, t, ply, L, W, H, flute, pr, qty, use = BY[lid]
    if t == "Partition":
        rows.append((f"{fmt(inch(L))} x {fmt(inch(W))}", f"Partition {9 if lid == 'L23' else 12} cell", ply, f"{int(q['price'])} / bundle (25)", 0))
    elif t == "Layer pad":
        rows.append((f"{fmt(inch(L))} x {fmt(inch(W))}", "Pallet pad", ply, f"{q['price']:g}", 0))
    else:
        rows.append((f"{fmt(inch(L))} x {fmt(inch(W))} x {fmt(inch(H))}", "Box" + (" (print)" if pr != "Plain" else ""), ply, f"{q['price']:.2f}".rstrip("0").rstrip("."), inch(L)))
# distractor sizes not in the RFx
rng = random.Random(5)
for (s, ply, p) in [("11 x 9 x 7", 3, "6.50"), ("12 x 10 x 8", 3, "8.50"), ("14 x 10 x 10", 3, "11"), ("18 x 12 x 12", 5, "30"), ("20 x 16 x 14", 5, "49.50"), ("24 x 18 x 18", 7, "118")]:
    rows.append((s, "Box", ply, p, float(s.split(" x ")[0])))
box = sorted([r for r in rows if r[1].startswith("Box")], key=lambda r: (r[2], r[4]))
other = [r for r in rows if not r[1].startswith("Box")]
trs = "".join(f"<tr><td>{i+1}</td><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]} ply</td><td class=r>{r[3]}</td></tr>" for i, r in enumerate(box + other))
html = f"""<html><body style="margin:0;background:#fff">
<div id=card style="width:820px;padding:34px 40px;background:#fbf8f0;font-family:'DejaVu Serif';color:#1d1d1d">
<div style="text-align:center;font-size:30px;font-weight:bold;letter-spacing:2px">NANDI BOX WORKS</div>
<div style="text-align:center;font-size:14px">No. 88, 3rd Cross, Peenya 2nd Stage, Bengaluru - 560058 &nbsp;|&nbsp; Ph: 98450 xxxxx</div>
<div style="text-align:center;font-size:20px;margin:14px 0 8px;font-weight:bold;text-decoration:underline">RATE CARD &nbsp; (w.e.f. 01-10-2026)</div>
<div style="font-size:14px;margin-bottom:8px">Corrugated Boxes &mdash; Sizes in INCHES (inner) &mdash; Rate in Rs. per box</div>
<style>table{{border-collapse:collapse;width:100%;font-size:16px}} td,th{{border:1.5px solid #333;padding:4px 8px}} .r{{text-align:right}} th{{background:#e9e4d6}}</style>
<table><tr><th>No</th><th>Size (L x W x H)</th><th>Item</th><th>Ply</th><th>Rate Rs.</th></tr>{trs}</table>
<div style="font-size:14px;margin-top:12px;line-height:1.5">* GST 5% extra. &nbsp; * Transport extra (Peenya godown pickup or our tempo at actuals).<br>
* Printing upto 2 colour &mdash; rate as above for &ldquo;print&rdquo; items. &nbsp; * Rates subject to change with paper price.<br>
* Min order 500 boxes per size. &nbsp; * Payment 30 days.</div>
<div style="text-align:right;font-size:15px;margin-top:16px">for NANDI BOX WORKS<br><br>Proprietor</div>
</div></body></html>"""
open("/tmp/claude-0/ratecard.html", "w").write(html) if False else None
import os
os.makedirs("/home/claude/scripts/tmp", exist_ok=True)
open("/home/claude/scripts/tmp/ratecard.html", "w").write(html)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(device_scale_factor=1.6)
    pg.goto("file:///home/claude/scripts/tmp/ratecard.html")
    pg.locator("#card").screenshot(path="/home/claude/scripts/tmp/card.png")
    b.close()

card = cv2.imread("/home/claude/scripts/tmp/card.png")
h, w = card.shape[:2]
# background: dark wooden desk with noise
BW, BH = 1500, 2000
bg = np.zeros((BH, BW, 3), np.uint8)
bg[:] = (40, 62, 92)
noise = np.random.default_rng(1).normal(0, 9, (BH, BW, 1))
bg = np.clip(bg + noise + np.linspace(0, 30, BW)[None, :, None], 0, 255).astype(np.uint8)
src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
dst = np.float32([[230, 170], [1330, 235], [1250, 1840], [110, 1760]])
M = cv2.getPerspectiveTransform(src, dst)
warped = cv2.warpPerspective(card, M, (BW, BH))
mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (BW, BH))
# drop shadow
sh = cv2.GaussianBlur(cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (BW, BH)), (61, 61), 0)
sh = np.roll(np.roll(sh, 18, 0), 14, 1)
out = bg.astype(np.float32) * (1 - 0.55 * sh[..., None] / 255)
m = mask[..., None] / 255
out = out * (1 - m) + warped.astype(np.float32) * m
# lighting gradient (phone flash hotspot + falloff) and a slight blur
yy, xx = np.mgrid[0:BH, 0:BW]
light = 1.08 - 0.28 * (((xx - 520) / BW) ** 2 + ((yy - 600) / BH) ** 2) ** 0.5 * 2
out = np.clip(out * light[..., None], 0, 255).astype(np.uint8)
out = cv2.GaussianBlur(out, (3, 3), 0.8)
out = cv2.resize(out, (1125, 1500), interpolation=cv2.INTER_AREA)
cv2.imwrite("/home/claude/app/public/demo/V4/IMG_20261112_194512.jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 78])
print("photo ok", out.shape)
