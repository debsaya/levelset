// An optional Excel bid sheet the buyer can send with the request: the items and questions pre-filled,
// with blanks for the vendor's price and terms. Vendors may ignore it: any format is still accepted,
// and the same reader handles this sheet like any other Excel file.
import * as XLSX from "xlsx";
import type { Rfx } from "./types";

export function downloadBidSheet(rfx: Rfx) {
  const wb = XLSX.utils.book_new();

  const head: (string | number)[][] = [
    ["Request for quotation", rfx.id],
    [rfx.title],
    ["Buyer", `${rfx.buyer.company}, ${rfx.buyer.plant}`],
    ["Quotes due", rfx.due_date],
    [],
    ["Your details (please fill in)"],
    ["Vendor name", ""],
    ["Quote reference", ""],
    ["Quote date", ""],
    ["Currency", rfx.currency],
    ["GST rate % (prices should be excluding GST)", ""],
    ["Freight (delivered to our plant / ex-works)", ""],
    ["Payment terms (days)", ""],
    ["Lead time (days from order to delivery)", ""],
    ["Price valid for (days)", ""],
    [],
    ["Prices"],
    ["Line", "Item", "Annual quantity", "Unit price", "Price is per (piece / 100 pieces / kg)", "Remarks"],
    ...rfx.lines.map((l) => [l.id, l.description, l.annual_qty, "", "", ""]),
  ];
  const quote = XLSX.utils.aoa_to_sheet(head);
  quote["!cols"] = [{ wch: 44 }, { wch: 52 }, { wch: 16 }, { wch: 14 }, { wch: 34 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, quote, "Quote");

  const qs = XLSX.utils.aoa_to_sheet([["ID", "Question", "Must-have", "Your answer"], ...rfx.questionnaire.map((q) => [q.id, q.text, q.must_have ? "Yes" : "No", ""])]);
  qs["!cols"] = [{ wch: 6 }, { wch: 80 }, { wch: 12 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, qs, "Questions");

  XLSX.writeFile(wb, `${rfx.id}_bid_sheet.xlsx`);
}
