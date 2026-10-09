import type { Row } from "../shared/table";

export type DummyKind = "people" | "transactions" | "invoices" | "products";

const FIRST = "James Mary Robert Patricia John Jennifer Michael Linda David Elizabeth William Barbara Richard Susan Joseph Jessica Thomas Sarah Charles Karen Daniel Lisa Matthew Nancy Anthony Betty Mark Sandra Steven Ashley Paul Emily Andrew Donna Joshua Michelle Kevin Carol Brian Amanda Priya Rahul Ananya Arjun Wei Mei Omar Fatima Lucas Sofia".split(" ");
const LAST = "Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez Hernandez Lopez Wilson Anderson Thomas Taylor Moore Jackson Martin Lee Thompson White Harris Clark Lewis Walker Hall Allen Young King Patel Sharma Chen Khan Nguyen Kim Singh Ali Rossi Silva".split(" ");
const VENDORS = "Amazon Business|Staples|Uber|Delta Air Lines|Marriott|Zoom|Slack|Google Workspace|Microsoft 365|AWS|FedEx|UPS|Verizon|Comcast|Office Depot|Costco|Home Depot|Starbucks|Shell|Chevron|Adobe|QuickBooks|Gusto|Bill.com|WeWork".split("|");
const CATEGORIES = "Office Supplies|Travel|Meals|Software|Utilities|Rent|Shipping|Fuel|Marketing|Professional Fees".split("|");
const PRODUCTS = "Ledger Pro|Close Kit|Payroll Suite|Audit Binder|Cash Tracker|Vendor Hub|Tax Organizer|Report Pack|Budget Builder|Forecast Lab".split("|");
const CITIES = "Austin TX|Denver CO|Chicago IL|Miami FL|Seattle WA|Boston MA|Phoenix AZ|Atlanta GA|Dallas TX|New York NY".split("|");

function rng(seed = Date.now()) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function generateRows(kind: DummyKind, count: number, seed?: number): Row[] {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const money = (min: number, max: number) => Math.round((min + r() * (max - min)) * 100) / 100;
  const date = (daysBack = 365) => { const d = new Date(Date.now() - Math.floor(r() * daysBack) * 86400000); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`; };
  const rows: Row[] = [];
  if (kind === "people") {
    rows.push(["ID", "First Name", "Last Name", "Email", "Phone", "City", "Department", "Start Date", "Salary"]);
    for (let i = 1; i <= count; i++) { const f = pick(FIRST), l = pick(LAST); rows.push([i, f, l, `${f.toLowerCase()}.${l.toLowerCase()}${i}@example.com`, `(${200 + Math.floor(r() * 800)}) 555-${String(1000 + Math.floor(r() * 9000))}`, pick(CITIES), pick(["Finance", "Sales", "Operations", "Engineering", "HR"]), date(2000), Math.round(45000 + r() * 120000)]); }
  } else if (kind === "transactions") {
    rows.push(["Date", "Description", "Amount", "Category", "Account"]);
    for (let i = 0; i < count; i++) { const v = pick(VENDORS); const credit = r() < 0.15; rows.push([date(), credit ? `Deposit from ${pick(["Stripe", "Client payment", "Refund " + v])}` : `${v} #${Math.floor(r() * 9000 + 1000)}`, credit ? money(500, 15000) : -money(5, 2500), credit ? "Revenue" : pick(CATEGORIES), pick(["Checking", "Visa 4421", "Amex 1007"])]); }
  } else if (kind === "invoices") {
    rows.push(["Invoice #", "Customer", "Invoice Date", "Due Date", "Amount", "Status"]);
    for (let i = 1; i <= count; i++) { const d = new Date(Date.now() - Math.floor(r() * 120) * 86400000); const due = new Date(d.getTime() + 30 * 86400000); const fmt = (x: Date) => `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")}/${x.getFullYear()}`; rows.push([`INV-${String(1000 + i)}`, `${pick(LAST)} ${pick(["LLC", "Inc", "Holdings", "Group", "Partners"])}`, fmt(d), fmt(due), money(250, 25000), due < new Date() ? pick(["Paid", "Paid", "Overdue"]) : "Open"]); }
  } else {
    rows.push(["SKU", "Product", "Category", "Unit Price", "Stock", "Reorder Level"]);
    for (let i = 1; i <= count; i++) rows.push([`SKU-${String(10000 + i)}`, pick(PRODUCTS), pick(["Software", "Service", "Add-on"]), money(19, 999), Math.floor(r() * 500), Math.floor(r() * 50)]);
  }
  return rows;
}
