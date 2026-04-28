import type { Account, LedgerEntry } from "../types";

/**
 * 데이트성 지출 판정.
 * 매칭 규칙: kind=expense AND (category 또는 subCategory에 "데이트" 부분일치).
 * trim 후 비교 — 공백 차이 방어.
 *
 * 예시 매칭: "데이트비", "데이트(저녁)", "주말데이트", "기념일 데이트"
 * 비매칭: "외식" (데이트 키워드 없음), 수입/이체 항목
 */
export function isDateEntry(l: LedgerEntry): boolean {
  if (l.kind !== "expense") return false;
  const cat = (l.category || "").trim();
  const sub = (l.subCategory || "").trim();
  return cat.includes("데이트") || sub.includes("데이트");
}

/**
 * "모임 통장"으로 간주할 계좌 판정 — 계좌명에 "모임" 포함.
 * 데이트 지출이 모임 통장에서 나갔는지 vs 개인 통장인지 분리할 때 사용.
 */
export function isMoimAccount(a: Account): boolean {
  return (a.name ?? "").includes("모임");
}

/** 모임 계좌 id Set — 다회 매칭 빠르게. */
export function getMoimAccountIds(accounts: Account[]): Set<string> {
  return new Set(accounts.filter(isMoimAccount).map((a) => a.id));
}

export interface DatePartnerShare {
  /** 데이트 계좌(설정에서 지정)에서 빠져나간 지출 합. */
  dateAccountSpend: number;
  /** 그 중 상대 부담분 = dateAccountSpend × 0.5. 실질 지출 계산에서 차감. */
  datePartnerShare: number;
}

/**
 * 데이트 계좌의 50/50 분담 계산.
 * 사용자가 Settings에서 dateAccountId를 지정해 두면, 그 계좌의 지출 중 절반은
 * 상대가 부담한 것으로 간주해 "실질 지출"에서 빼기 위함.
 *
 * @param fExp 기간 필터된 지출 항목들 (재테크·환전 제외 상태 가정)
 * @param dateAccountId 데이트 계좌 id (null이면 분담 없음 → 0/0 반환)
 */
export function computeDatePartnerShare(
  fExp: LedgerEntry[],
  dateAccountId: string | null
): DatePartnerShare {
  if (!dateAccountId) return { dateAccountSpend: 0, datePartnerShare: 0 };
  let dateAccountSpend = 0;
  for (const l of fExp) {
    if (l.fromAccountId === dateAccountId) dateAccountSpend += Number(l.amount);
  }
  return { dateAccountSpend, datePartnerShare: dateAccountSpend * 0.5 };
}

export interface DateMoimSplit {
  /** 모임 통장에서 나간 데이트 지출 합. */
  dateMoim: number;
  /** 개인 통장(모임이 아닌)에서 나간 데이트 지출 합. */
  datePersonal: number;
}

/**
 * 데이트 지출을 모임/개인으로 분리 합산.
 * fromAccountId가 모임 계좌면 dateMoim, 아니면 datePersonal.
 * fromAccountId가 비어있으면 datePersonal로 분류.
 */
export function splitDateMoimVsPersonal(
  dateEntries: LedgerEntry[],
  moimAccountIds: Set<string>
): DateMoimSplit {
  let dateMoim = 0;
  let datePersonal = 0;
  for (const l of dateEntries) {
    const a = Number(l.amount);
    if (l.fromAccountId && moimAccountIds.has(l.fromAccountId)) dateMoim += a;
    else datePersonal += a;
  }
  return { dateMoim, datePersonal };
}

export interface DateAccountUtilization {
  /** 분담 통장에서 결제된 데이트 합 */
  viaSharedAccount: number;
  /** 개인 통장/카드에서 결제된 데이트 합 */
  viaPersonal: number;
  /** 전체 데이트성 지출 합 */
  totalDate: number;
  /** 분담 통장 활용률 (0~1). totalDate=0이면 0. */
  utilizationRate: number;
  /** 현재 본인 부담 추정: 분담통장 결제의 50% + 개인 결제 100%. */
  currentSelfBurden: number;
  /** 모든 데이트를 분담 통장으로 결제했을 때 본인 부담 (50/50 가정). */
  optimalSelfBurden: number;
  /** 분담 통장 활용 미흡으로 인한 추가 부담 = currentSelfBurden − optimalSelfBurden. */
  lostShareSavings: number;
}

/**
 * 분담 통장 활용도와 잠재 절감액 계산.
 * 입력은 splitDateMoimVsPersonal 결과를 그대로 받아서 파생값만 계산하는 순수 함수.
 *
 * 핵심 가설: 모든 데이트가 분담 통장에서 결제되면 본인 부담은 정확히 50%.
 * 현재 개인 결제분은 100% 본인 부담 → 그 절반이 "분담 못 한 손실"로 계산됨.
 * (정산으로 일부 회수 가능하지만 그건 별개 — 여기선 분담 시스템 자체의 비효율만 측정)
 */
export interface MoimFlowMonth {
  month: string;            // "YYYY-MM"
  myTransfer: number;       // 본인 계좌 → 분담 통장 (kind=transfer)
  partnerDeposit: number;   // 외부 입금 (kind=income, 상대 입금·캐시백 등)
  spending: number;         // 분담 통장 출금 합 (kind=expense)
  balanceChange: number;    // myTransfer + partnerDeposit - spending
}

export interface MoimFlowAnalysis {
  months: MoimFlowMonth[];
  cumBalance: number;       // 모든 월 balanceChange 누적 (= 현재 모임통장 잔액 변동)
  anomalies: { month: string; type: "partner_low"; message: string }[];
}

/**
 * 분담 통장의 월별 자금 흐름 분석.
 *
 * @param ledger 전체 ledger
 * @param accountId 분담 통장 id (Settings에서 설정한 dateAccountId)
 * @param months 분석할 월 배열 ("YYYY-MM" 정렬됨)
 *
 * 이상 감지 (anomalies):
 *  - partner_low: 어떤 달의 partnerDeposit이 다른 달 평균의 50% 미만이면 "상대 입금 누락 가능"
 *    (예: 평균 30만인데 한 달 1500원만 입금 → 자동 이체 실패 가능성)
 */
export function computeMoimAccountFlow(
  ledger: LedgerEntry[],
  accountId: string | null,
  months: string[]
): MoimFlowAnalysis {
  if (!accountId || months.length === 0) {
    return { months: [], cumBalance: 0, anomalies: [] };
  }

  const byMonth = new Map<string, MoimFlowMonth>();
  for (const m of months) {
    byMonth.set(m, { month: m, myTransfer: 0, partnerDeposit: 0, spending: 0, balanceChange: 0 });
  }

  for (const l of ledger) {
    const m = l.date?.slice(0, 7);
    if (!m || !byMonth.has(m)) continue;
    const row = byMonth.get(m)!;
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (l.kind === "transfer" && l.toAccountId === accountId) {
      row.myTransfer += amount;
    } else if (l.kind === "income" && l.toAccountId === accountId) {
      row.partnerDeposit += amount;
    } else if (l.kind === "expense" && l.fromAccountId === accountId) {
      row.spending += amount;
    }
  }

  const result: MoimFlowMonth[] = [];
  let cumBalance = 0;
  for (const m of months) {
    const row = byMonth.get(m)!;
    row.balanceChange = row.myTransfer + row.partnerDeposit - row.spending;
    cumBalance += row.balanceChange;
    result.push(row);
  }

  // 이상 감지: 상대 입금(partnerDeposit) 평균 대비 50% 미만인 월
  const partnerDeposits = result.map((r) => r.partnerDeposit).filter((v) => v > 0);
  const anomalies: { month: string; type: "partner_low"; message: string }[] = [];
  if (partnerDeposits.length >= 2) {
    const avg = partnerDeposits.reduce((s, v) => s + v, 0) / partnerDeposits.length;
    const threshold = avg * 0.5;
    for (const r of result) {
      if (r.partnerDeposit > 0 && r.partnerDeposit < threshold) {
        anomalies.push({
          month: r.month,
          type: "partner_low",
          message: `상대 입금 ${r.partnerDeposit.toLocaleString()}원 (평균 ${Math.round(avg).toLocaleString()}원의 ${Math.round((r.partnerDeposit / avg) * 100)}%)`,
        });
      }
    }
  }

  return { months: result, cumBalance, anomalies };
}

export function computeDateAccountUtilization(split: DateMoimSplit): DateAccountUtilization {
  const total = split.dateMoim + split.datePersonal;
  const utilizationRate = total > 0 ? split.dateMoim / total : 0;
  const currentSelfBurden = split.dateMoim / 2 + split.datePersonal;
  const optimalSelfBurden = total / 2;
  return {
    viaSharedAccount: split.dateMoim,
    viaPersonal: split.datePersonal,
    totalDate: total,
    utilizationRate,
    currentSelfBurden,
    optimalSelfBurden,
    lostShareSavings: currentSelfBurden - optimalSelfBurden,
  };
}
