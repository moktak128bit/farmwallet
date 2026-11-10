/**
 * XIRR (Extended Internal Rate of Return) for irregular cash flows.
 * Uses Newton-Raphson to find r such that NPV(r) = 0, falling back to bisection when Newton diverges.
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

  const npvAt = (rate: number): number => {
    let npv = 0;
    for (const f of flows) npv += f.amount / Math.pow(1 + rate, f.y);
    return npv;
  };

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
  return bisectIrr(npvAt);
}

/**
 * Newton이 수렴하지 못할 때(큰 손실 종목 — 해가 −1 가까이 있어 Newton이 −1 밖으로 튄다) 이분법 폴백.
 * 부호가 바뀌는 구간을 (−0.9999, 1e6) 안에서 찾아 좁힌다. 구간이 없으면 null.
 */
function bisectIrr(npvAt: (rate: number) => number): number | null {
  const grid = [-0.9999, -0.99, -0.9, -0.5, 0, 0.5, 1, 3, 10, 100, 1e3, 1e6];
  let lo = NaN;
  let hi = NaN;
  let fLo = NaN;
  for (let i = 0; i < grid.length - 1; i++) {
    const a = npvAt(grid[i]);
    const b = npvAt(grid[i + 1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0) return grid[i];
    if (a * b < 0) { lo = grid[i]; hi = grid[i + 1]; fLo = a; break; }
  }
  if (Number.isNaN(lo)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-10) return mid;
    if (fLo * fMid < 0) hi = mid;
    else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}
