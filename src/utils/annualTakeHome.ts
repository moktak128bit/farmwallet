/**
 * 내 실질 월급 — 최근 12개 완료월에 통장으로 들어온 근로소득(급여·상여·수당, 세후 실수령) ÷ 12.
 *
 * "월급 291만"만 보면 연 2~4회 들어오는 상여·수당이 빠져 실제로 쓸 수 있는 돈을 과소평가하고, 상여가 든 달만 보면
 * 과대평가한다. 1년치를 12로 나눈 값이 매달 기대할 수 있는 실제 월급이다.
 *
 * - 근로소득 판정은 incomeClassification.computeIncomeNatureKeys의 salaryKeys(대시보드·인사이트 공용 단일 소스).
 * - 진행 중인 달은 뺀다(월급날 전이면 0이라 평균을 깎는다). 창 = [이번 달−12, 이번 달−1].
 * - 회사 퇴직연금 적립(DC)은 쓸 수 있는 돈이 아니라 합계에 넣지 않고 따로 알려 준다(isIncomeExcludedFromTotals).
 * - "정기 월급" = 창 안에서 가장 많은 달에 나온 근로소득 항목(보통 "급여")의 월 중앙값. 나머지 항목은 상여·수당.
 */
import type { LedgerEntry } from "../types";
import { toKrwAmount } from "../features/dashboard/summaryMath";
import { isExcludedIncomeEntry } from "./savingsRate";
import { isIncomeExcludedFromTotals } from "./realIncome";
import { shiftMonth } from "./date";

interface TakeHomeMonth {
  month: string;
  /** 정기 월급(regularKey) */
  regular: number;
  /** 그 밖의 근로소득(상여·수당 등) */
  extra: number;
  /** 상여·수당 내역 — 항목·금액·가계부 메모(예: 상여 600,000 "추석 떡값") */
  extras: Array<{ key: string; amount: number; desc: string }>;
  /** 정기 월급에 연말정산 환급 등이 섞였다는 가계부 메모(설명에 "환급"이 든 경우) */
  refundNote: string | null;
}

export interface AnnualTakeHome {
  /** 창의 첫 달·마지막 달 (YYYY-MM) */
  from: string;
  to: string;
  /** 창 안 근로소득 합계 (세후 실수령) */
  total: number;
  /** total ÷ 창 개월 수(기록이 창보다 짧으면 기록 시작 이후 개월 수) */
  monthlyAvg: number;
  /** 나눈 개월 수 — 12 미만이면 기록이 1년이 안 된 것 */
  divisorMonths: number;
  regularKey: string | null;
  /** 정기 월급 월 중앙값 (나온 달만) */
  regularMedian: number;
  regularTotal: number;
  extraTotal: number;
  /** 상여·수당 항목별 합 (큰 순) */
  extraItems: Array<{ key: string; total: number }>;
  byMonth: TakeHomeMonth[];
  /** 근로소득이 한 번이라도 들어온 달 수 */
  paidMonths: number;
  /** 직전 12개월(창 바로 앞) 합계 — 그 기간 전체가 기록 안에 있을 때만, 아니면 null */
  prevTotal: number | null;
  /** 같은 창의 회사 퇴직연금 적립 — 합계에 넣지 않음 */
  retirement: number;
  /**
   * 정기 월급에 환급이 섞인 달 — 그 달 정기 월급 − 나머지 달 정기 월급 중앙값(추정, 양수일 때만).
   * 가계부가 환급액을 따로 적지 않아 정확한 환급액이 아니라 "평소보다 많은 만큼"이다.
   */
  refundExtras: Array<{ month: string; aboveTypical: number; note: string }>;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

/** from~to(포함) 사이 달 목록 */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 600; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export function computeAnnualTakeHome(params: {
  ledger: LedgerEntry[];
  salaryKeys: Set<string>;
  fxRate: number | null;
  /** 진행 중인 달 (YYYY-MM, KST) — 기본 창의 기준이자 기간 상한(진행 중인 달은 넣지 않는다) */
  curMonth: string;
  windowMonths?: number;
  /** 직접 고른 기간(YYYY-MM, 포함). 주면 windowMonths 대신 이 기간. to는 지난달을 넘지 못한다 */
  range?: { from: string; to: string };
}): AnnualTakeHome | null {
  const { ledger, salaryKeys, fxRate, curMonth } = params;
  const lastDone = shiftMonth(curMonth, -1);
  let from: string;
  let to: string;
  if (params.range) {
    to = params.range.to > lastDone ? lastDone : params.range.to;
    from = params.range.from > to ? to : params.range.from;
  } else {
    const n0 = params.windowMonths ?? 12;
    to = lastDone;
    from = shiftMonth(curMonth, -n0);
  }
  const months = monthRange(from, to);
  const n = months.length;
  const prevFrom = shiftMonth(from, -n);

  const byMonth = new Map<string, Map<string, number>>();
  const extrasByMonth = new Map<string, Array<{ key: string; amount: number; desc: string }>>();
  const refundNoteByMonth = new Map<string, string>();
  let prev = 0;
  let retirement = 0;
  let firstRecordMonth: string | null = null;
  for (const l of ledger) {
    const m = l.date?.slice(0, 7);
    if (!m) continue;
    if (!firstRecordMonth || m < firstRecordMonth) firstRecordMonth = m;
    if (l.kind !== "income" || !(Number(l.amount) > 0)) continue;
    if (m >= from && m <= to && isIncomeExcludedFromTotals(l)) retirement += toKrwAmount(l, fxRate);
    if (isExcludedIncomeEntry(l)) continue;
    const key = l.subCategory || l.category || "";
    if (!salaryKeys.has(key)) continue;
    const amt = toKrwAmount(l, fxRate);
    if (m >= from && m <= to) {
      const row = byMonth.get(m) ?? new Map<string, number>();
      row.set(key, (row.get(key) ?? 0) + amt);
      byMonth.set(m, row);
      const list = extrasByMonth.get(m) ?? [];
      list.push({ key, amount: Math.round(amt), desc: (l.description ?? "").trim() });
      extrasByMonth.set(m, list);
      if ((l.description ?? "").includes("환급")) refundNoteByMonth.set(m, (l.description ?? "").trim());
    } else if (m >= prevFrom && m < from) {
      prev += amt;
    }
  }
  if (byMonth.size === 0) return null;

  // 정기 월급 항목 = 가장 많은 달에 나온 항목 (동률이면 합계가 큰 쪽)
  const monthsByKey = new Map<string, number>();
  const totalByKey = new Map<string, number>();
  for (const row of byMonth.values()) {
    for (const [k, v] of row) {
      monthsByKey.set(k, (monthsByKey.get(k) ?? 0) + 1);
      totalByKey.set(k, (totalByKey.get(k) ?? 0) + v);
    }
  }
  const regularKey =
    [...monthsByKey.keys()].sort(
      (a, b) => (monthsByKey.get(b)! - monthsByKey.get(a)!) || (totalByKey.get(b)! - totalByKey.get(a)!)
    )[0] ?? null;

  const rows: TakeHomeMonth[] = months.map((m) => {
    const row = byMonth.get(m);
    let regular = 0;
    let extra = 0;
    if (row) {
      for (const [k, v] of row) {
        if (k === regularKey) regular += v;
        else extra += v;
      }
    }
    const extras = (extrasByMonth.get(m) ?? []).filter((x) => x.key !== regularKey);
    return { month: m, regular: Math.round(regular), extra: Math.round(extra), extras, refundNote: refundNoteByMonth.get(m) ?? null };
  });
  const regularTotal = rows.reduce((s, r) => s + r.regular, 0);
  const extraTotal = rows.reduce((s, r) => s + r.extra, 0);
  const total = regularTotal + extraTotal;
  // 기록이 창보다 늦게 시작했으면(1년 미만) 기록 시작 이후 개월 수로 나눈다 — 기록 전 달을 0원 월급으로 치지 않게
  const startMonth = firstRecordMonth && firstRecordMonth > from ? firstRecordMonth : from;
  const divisorMonths = months.filter((m) => m >= startMonth).length || n;
  // 환급이 섞인 달 — 나머지 달 정기 월급 중앙값보다 많은 만큼(추정)
  const refundExtras: AnnualTakeHome["refundExtras"] = [];
  for (const r of rows) {
    if (!r.refundNote) continue;
    const typical = median(rows.filter((x) => x !== r && x.regular > 0).map((x) => x.regular));
    const above = Math.round(r.regular - typical);
    if (typical > 0 && above > 0) refundExtras.push({ month: r.month, aboveTypical: above, note: r.refundNote });
  }
  const extraItems = [...totalByKey.entries()]
    .filter(([k]) => k !== regularKey)
    .map(([key, t]) => ({ key, total: Math.round(t) }))
    .sort((a, b) => b.total - a.total);

  return {
    from,
    to,
    total,
    monthlyAvg: Math.round(total / divisorMonths),
    divisorMonths,
    regularKey,
    regularMedian: Math.round(median(rows.map((r) => r.regular).filter((v) => v > 0))),
    regularTotal,
    extraTotal,
    extraItems,
    byMonth: rows,
    paidMonths: rows.filter((r) => r.regular + r.extra > 0).length,
    prevTotal: firstRecordMonth != null && firstRecordMonth <= prevFrom ? Math.round(prev) : null,
    retirement: Math.round(retirement),
    refundExtras,
  };
}

/**
 * 실질 월급 추이 — 각 완료월을 끝으로 하는 12개월 평균 실수령(이동 평균). 인사이트 수입 탭 분석용.
 * points개의 최근 완료월마다 computeAnnualTakeHome을 그 달 기준으로 다시 계산한다(정의가 대시보드 숫자와 같도록).
 * partial=true는 그 시점까지 기록이 12개월이 안 돼 있는 달로만 나눈 값.
 */
export function computeTakeHomeTrend(params: {
  ledger: LedgerEntry[];
  salaryKeys: Set<string>;
  fxRate: number | null;
  curMonth: string;
  points?: number;
}): Array<{ month: string; monthlyAvg: number; total: number; partial: boolean }> {
  const points = params.points ?? 12;
  const out: Array<{ month: string; monthlyAvg: number; total: number; partial: boolean }> = [];
  for (let i = points - 1; i >= 0; i--) {
    const asOf = shiftMonth(params.curMonth, -i);
    const r = computeAnnualTakeHome({ ledger: params.ledger, salaryKeys: params.salaryKeys, fxRate: params.fxRate, curMonth: asOf });
    if (!r) continue;
    out.push({ month: r.to, monthlyAvg: r.monthlyAvg, total: r.total, partial: r.divisorMonths < r.byMonth.length });
  }
  return out;
}
