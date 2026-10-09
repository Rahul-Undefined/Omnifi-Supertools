/** Pure finance functions. Unit-tested in tests/finance.test.ts. */

export function gst(amount: number, ratePct: number, inclusive: boolean) {
  const rate = ratePct / 100;
  if (inclusive) {
    const net = amount / (1 + rate);
    return { net, tax: amount - net, gross: amount };
  }
  const tax = amount * rate;
  return { net: amount, tax, gross: amount + tax };
}

export function percentage(mode: string, x: number, y: number) {
  if (mode === "is") return { label: `${x} is what % of ${y}`, value: y === 0 ? 0 : (x / y) * 100, unit: "%" };
  if (mode === "change") return { label: `Change from ${x} to ${y}`, value: x === 0 ? 0 : ((y - x) / Math.abs(x)) * 100, unit: "%" };
  return { label: `${x}% of ${y}`, value: (x / 100) * y, unit: "" };
}

export function margin(cost: number, revenue: number) {
  const profit = revenue - cost;
  return { profit, marginPct: revenue === 0 ? 0 : (profit / revenue) * 100, markupPct: cost === 0 ? 0 : (profit / cost) * 100 };
}

export function markup(cost: number, markupPct: number) {
  const price = cost * (1 + markupPct / 100);
  const profit = price - cost;
  return { price, profit, marginPct: price === 0 ? 0 : (profit / price) * 100 };
}

export function discount(price: number, discountPct: number) {
  const saved = price * (discountPct / 100);
  return { final: price - saved, saved };
}

export function emi(principal: number, annualRatePct: number, months: number) {
  const r = annualRatePct / 100 / 12;
  const payment = r === 0 ? principal / months : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  const totalPayment = payment * months;
  return { emi: payment, totalPayment, totalInterest: totalPayment - principal };
}

export function amortization(principal: number, annualRatePct: number, months: number) {
  const { emi: payment } = emi(principal, annualRatePct, months);
  const r = annualRatePct / 100 / 12;
  let balance = principal;
  const schedule = [];
  let totalInterest = 0;
  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const princ = Math.min(payment - interest, balance);
    balance = Math.max(0, balance - princ);
    totalInterest += interest;
    schedule.push({ month: m, payment: princ + interest, principal: princ, interest, balance });
  }
  return { payment, totalInterest, totalPaid: principal + totalInterest, schedule };
}

export function interest(principal: number, annualRatePct: number, years: number, compoundingPerYear: number) {
  const r = annualRatePct / 100;
  const total = compoundingPerYear <= 0 ? principal * (1 + r * years) : principal * Math.pow(1 + r / compoundingPerYear, compoundingPerYear * years);
  return { total, interest: total - principal };
}

export function cagr(start: number, end: number, years: number) {
  const c = start <= 0 || years <= 0 ? 0 : Math.pow(end / start, 1 / years) - 1;
  return { cagrPct: c * 100, totalGrowthPct: start === 0 ? 0 : ((end - start) / start) * 100 };
}

export function npv(ratePct: number, flows: number[]) {
  const r = ratePct / 100;
  return flows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
}

/** Newton-Raphson with bisection fallback. Returns null if it cannot converge. */
export function irr(flows: number[]): number | null {
  const f = (r: number) => flows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
  const df = (r: number) => flows.reduce((acc, cf, t) => acc - (t * cf) / Math.pow(1 + r, t + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const y = f(r);
    const d = df(r);
    if (Math.abs(y) < 1e-9) return r;
    if (d === 0 || !isFinite(d)) break;
    const next = r - y / d;
    if (!isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  let lo = -0.99;
  let hi = 10;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

export function roi(cost: number, finalValue: number, years: number) {
  const gain = finalValue - cost;
  const roiPct = cost === 0 ? 0 : (gain / cost) * 100;
  const annualizedPct = years > 0 && cost > 0 && finalValue > 0 ? (Math.pow(finalValue / cost, 1 / years) - 1) * 100 : null;
  return { gain, roiPct, annualizedPct };
}

export function breakEven(fixed: number, price: number, variable: number) {
  const contribution = price - variable;
  if (contribution <= 0) return null;
  const units = fixed / contribution;
  return { units, revenue: units * price, contribution };
}

export function straightLine(cost: number, salvage: number, years: number) {
  const dep = (cost - salvage) / years;
  const out = [];
  let acc = 0;
  for (let y = 1; y <= years; y++) {
    acc += dep;
    out.push({ year: y, depreciation: dep, accumulated: acc, bookValue: cost - acc });
  }
  return out;
}

export function decliningBalance(cost: number, salvage: number, years: number, factor: number) {
  const rate = factor / years;
  let book = cost;
  let acc = 0;
  const out = [];
  for (let y = 1; y <= years; y++) {
    let dep = book * rate;
    if (book - dep < salvage) dep = Math.max(0, book - salvage);
    if (y === years) dep = Math.max(0, book - salvage);
    acc += dep;
    book -= dep;
    out.push({ year: y, depreciation: dep, accumulated: acc, bookValue: book });
  }
  return out;
}
