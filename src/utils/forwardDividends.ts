/**
 * 선행 배당 캘린더 (C1) — 최근 12개월 배당 실적을 같은 달에 반복한다고 가정해 향후 12개월 예상 배당
 * 일정·금액을 만든다. "현금이 언제 얼마 들어오는가"(현금흐름 계획)가 핵심 가치.
 *
 * v1: 보유 변동 미반영(최근 12개월 패턴 그대로 투영). 종목 매수/매도에 따른 조정은 향후 개선.
 * 그래서 annualTotalKRW ≈ trailing12KRW (같은 페이스 가정).
 */
import type { LedgerEntry } from "../types";
import { isDividendEntryLoose } from "./categoryMatch";
import { addDaysToIso, parseIsoLocal } from "./date";

interface ForwardDividendMonth {
  /** YYYY-MM (미래) */
  month: string;
  amountKRW: number;
}

interface ForwardDividends {
  /** 향후 12개월 */
  months: ForwardDividendMonth[];
  /** 향후 12개월 예상 배당 합계 */
  annualTotalKRW: number;
  /** 최근 12개월 실제 수령 배당 합계 */
  trailing12KRW: number;
}

export function buildForwardDividends(
  ledger: LedgerEntry[],
  today: string,
  fxRate?: number | null
): ForwardDividends {
  const toKrw = (e: LedgerEntry) => (e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount);
  const start = addDaysToIso(today, -365);

  const byMonthOfYear = new Map<number, number>(); // 1..12 → KRW
  let trailing12 = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date) continue;
    if (e.date < start || e.date > today) continue;
    if (!isDividendEntryLoose(e)) continue;
    const krw = toKrw(e);
    trailing12 += krw;
    const moy = Number(e.date.slice(5, 7));
    if (moy >= 1 && moy <= 12) byMonthOfYear.set(moy, (byMonthOfYear.get(moy) ?? 0) + krw);
  }

  const base = parseIsoLocal(today) ?? new Date();
  const months: ForwardDividendMonth[] = [];
  let annualTotal = 0;
  for (let i = 1; i <= 12; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1); // 말일 클램프 불필요 (1일 고정)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const amt = byMonthOfYear.get(d.getMonth() + 1) ?? 0;
    months.push({ month: ym, amountKRW: amt });
    annualTotal += amt;
  }

  return { months, annualTotalKRW: annualTotal, trailing12KRW: trailing12 };
}
