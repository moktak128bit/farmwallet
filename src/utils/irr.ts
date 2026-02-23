/**
 * XIRR (Extended Internal Rate of Return) for irregular cash flows.
 * Uses Newton-Raphson to find r such that NPV(r) = 0.
 */

export interface CashFlowItem {
  date: string; // yyyy-mm-dd
  amount: number; // positive = inflow, negative = outflow
}

/**
 * Compute years from base date (fractional).
 */
function yearsFromBase(dateStr: string, baseTime: number): number {
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return 0;
  return (t - baseTime) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * XIRR: internal rate of return for irregular cash flows.
 * Returns annualized rate (e.g. 0.05 = 5%) or null if no solution.
 */
export function xirr(cashFlows: CashFlowItem[], guess = 0.1): number | null {
  if (cashFlows.length < 2) return null;
  const hasPos = cashFlows.some((c) => c.amount > 0);
  const hasNeg = cashFlows.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const baseTime = new Date(cashFlows[0].date).getTime();
  const flows = cashFlows.map((c) => ({
    y: yearsFromBase(c.date, baseTime),
    amount: c.amount
  }));

  let r = guess;
  const maxIter = 50;
  const tol = 1e-9;

  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    for (const f of flows) {
      const factor = Math.pow(1 + r, f.y);
      npv += f.amount / factor;
      if (f.y !== 0) dnpv -= f.y * f.amount / Math.pow(1 + r, f.y + 1);
    }
    if (Math.abs(npv) < tol) return r;
    if (Math.abs(dnpv) < 1e-15) break;
    const rNext = r - npv / dnpv;
    if (rNext <= -1) break;
    if (Math.abs(rNext - r) < tol) return rNext;
    r = rNext;
  }
  return null;
}
