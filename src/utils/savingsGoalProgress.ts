/**
 * 저축 목표(3-7) 진행률 — 순수 모듈 (React 의존 없음).
 *
 * 산정 방식 2가지 (SavingsGoal 필드로 선택):
 *  - linkedAccountIds: 연결 계좌의 "현재 잔액 합"(calculations.computeAccountBalances 결과 재사용).
 *    증권/암호화폐 계좌는 대상에서 제외한다 — computeAccountBalances의 currentBalance는 USD 다리를
 *    반영하지 않고(usdTransferNet 별도 필드) 평가액도 포함하지 않아, 그 계좌를 목표에 넣으면
 *    실제 자산보다 훨씬 작은 숫자로 "달성"처럼 보이는 착시가 생긴다 (업그레이드 기획 3-7 명시 규칙).
 *  - linkedCategory: 계좌 대신 "이 대/중분류에 해당하는 재테크(저축·투자) 이체의 전체 누적"으로 진행률을 잡는다.
 *    분류 판정은 summaryMath.classifyLedgerFlow 단일 기준(대시보드와 동일) — 문자열 재나열 금지.
 *
 * 두 방식 모두 월별 누적 시계열을 만들어 goalProjection.projectGoal에 그대로 넘긴다 —
 * ETA/기한 역산 문장(대시보드 InvestmentSummaryCard와 동일 포맷)을 얻기 위함.
 */
import type { Account, AccountBalanceRow, CategoryPresets, LedgerEntry, SavingsGoal } from "../types";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { isInvestmentLossEntry } from "./category";
import { toKrwByRate } from "./currency";
import { baseBalanceForAccount } from "../calculations";
import { buildMonthRange, getTodayKST } from "./date";
import { projectGoal } from "./goalProjection";

type MonthPoint = { month: string; value: number };
type Projection = ReturnType<typeof projectGoal>;

type SavingsGoalMode = "accounts" | "category" | "none";

interface SavingsGoalProgress {
  mode: SavingsGoalMode;
  /** 현재 진행 금액 (KRW) */
  currentKRW: number;
  /** 진행률 (%), target<=0이면 0. 음수 currentKRW는 0으로 clamp — 표시용 */
  pct: number;
  /** 월별 누적 시계열 (오름차순) — projectGoal 입력과 동일 */
  series: MonthPoint[];
  /** ETA·기한 역산 — utils/goalProjection.projectGoal 결과 그대로 (formatGoalProjectionLine과 함께 사용) */
  projection: Projection;
}

interface SavingsGoalProgressInput {
  ledger: LedgerEntry[];
  accounts: Account[];
  /** calculations.computeAccountBalances(accounts, ledger, trades) 결과 — 호출부에서 1회 계산해 넘긴다 */
  balances: AccountBalanceRow[];
  fxRate: number | null;
  categoryPresets?: CategoryPresets;
  /** ETA 산정 기준 "오늘"의 YYYY-MM. 미지정 시 getTodayKST() (테스트 결정성용 오버라이드) */
  nowMonth?: string;
}

/** 증권/암호화폐 계좌는 목표 연결 대상에서 제외 — 평가액 미포함 착시 방지 (3-7 규칙) */
function isEligibleLinkAccount(account: Account | undefined): boolean {
  return !!account && account.type !== "securities" && account.type !== "crypto";
}

function buildContinuousSeries(base: number, deltaByMonth: Map<string, number>, nowMonth: string): MonthPoint[] {
  if (deltaByMonth.size === 0) return [{ month: nowMonth, value: base }];
  const firstMonth = Array.from(deltaByMonth.keys()).sort()[0];
  const endMonth = nowMonth < firstMonth ? firstMonth : nowMonth;
  const months = buildMonthRange(firstMonth, endMonth);
  let running = base;
  return months.map((month) => {
    running += deltaByMonth.get(month) ?? 0;
    return { month, value: running };
  });
}

/** 방식 A: 연결 계좌들의 초기값 + 이후 입출금/이체 델타를 월별로 누적한 시계열 */
function buildAccountSeries(
  goal: SavingsGoal,
  accounts: Account[],
  ledger: LedgerEntry[],
  nowMonth: string
): MonthPoint[] {
  const accountById = new Map(accounts.map((a) => [a.id, a] as const));
  const eligibleIds = new Set(
    (goal.linkedAccountIds ?? []).filter((id) => isEligibleLinkAccount(accountById.get(id)))
  );
  if (eligibleIds.size === 0) return [];

  let base = 0;
  for (const id of eligibleIds) {
    const account = accountById.get(id);
    if (!account) continue;
    base += baseBalanceForAccount(account) + (account.cashAdjustment ?? 0) + (account.savings ?? 0);
  }

  const deltaByMonth = new Map<string, number>();
  for (const entry of ledger) {
    if (!entry.date) continue;
    // USD 다리는 이 방식에서 다루지 않음(대상 계좌가 증권/암호화폐 제외이므로 KRW 이체만 유효) — 원화 항목만 반영.
    if (entry.currency === "USD") continue;
    let delta = 0;
    if (entry.kind === "income") {
      if (entry.toAccountId && eligibleIds.has(entry.toAccountId)) delta += entry.amount;
    } else if (entry.kind === "expense") {
      if (entry.fromAccountId && eligibleIds.has(entry.fromAccountId)) delta -= entry.amount;
      if (entry.toAccountId && eligibleIds.has(entry.toAccountId)) delta += entry.amount;
    } else if (entry.kind === "transfer") {
      if (entry.fromAccountId && eligibleIds.has(entry.fromAccountId)) delta -= entry.amount;
      if (entry.toAccountId && eligibleIds.has(entry.toAccountId)) delta += entry.amount;
    }
    if (delta === 0) continue;
    const month = entry.date.slice(0, 7);
    deltaByMonth.set(month, (deltaByMonth.get(month) ?? 0) + delta);
  }

  return buildContinuousSeries(base, deltaByMonth, nowMonth);
}

/** 방식 B: linkedCategory와 일치하는 "재테크" 이체·손익의 전체 누적(월별) */
function buildCategorySeries(
  goal: SavingsGoal,
  ledger: LedgerEntry[],
  fxRate: number | null,
  categoryPresets: CategoryPresets | undefined,
  nowMonth: string
): MonthPoint[] {
  const cat = goal.linkedCategory;
  if (!cat) return [];

  const deltaByMonth = new Map<string, number>();
  for (const entry of ledger) {
    if (!entry.date) continue;
    if (classifyLedgerFlow(entry, categoryPresets) !== "investing") continue;
    if (entry.category !== cat && entry.subCategory !== cat && entry.detailCategory !== cat) continue;
    const amt = toKrwByRate(entry.amount, entry.currency, fxRate);
    const signed = isInvestmentLossEntry(entry) ? -amt : amt;
    const month = entry.date.slice(0, 7);
    deltaByMonth.set(month, (deltaByMonth.get(month) ?? 0) + signed);
  }

  return buildContinuousSeries(0, deltaByMonth, nowMonth);
}

/** 목표 하나의 진행률·ETA. balances는 accounts 방식에서 "현재값"만 사용(시계열 마지막 값과 별개로, 실시간 잔액을 그대로 반영). */
export function computeSavingsGoalProgress(
  goal: SavingsGoal,
  input: SavingsGoalProgressInput
): SavingsGoalProgress {
  const nowMonth = input.nowMonth ?? getTodayKST().slice(0, 7);
  const hasAccounts = (goal.linkedAccountIds ?? []).length > 0;
  const mode: SavingsGoalMode = hasAccounts ? "accounts" : goal.linkedCategory ? "category" : "none";

  let series: MonthPoint[];
  let currentKRW: number;

  if (mode === "accounts") {
    series = buildAccountSeries(goal, input.accounts, input.ledger, nowMonth);
    // "현재값"은 balances(호출부가 이미 계산한 AccountBalanceRow)를 그대로 신뢰 — 계좌 잔액의 단일 소스와 일치시킨다.
    const accountById = new Map(input.accounts.map((a) => [a.id, a] as const));
    const eligibleIds = new Set(
      (goal.linkedAccountIds ?? []).filter((id) => isEligibleLinkAccount(accountById.get(id)))
    );
    const balanceById = new Map(input.balances.map((row) => [row.account.id, row.currentBalance] as const));
    currentKRW = 0;
    for (const id of eligibleIds) currentKRW += balanceById.get(id) ?? 0;
  } else if (mode === "category") {
    series = buildCategorySeries(goal, input.ledger, input.fxRate, input.categoryPresets, nowMonth);
    currentKRW = series.length > 0 ? series[series.length - 1].value : 0;
  } else {
    series = [];
    currentKRW = 0;
  }

  const pct = goal.targetAmount > 0 ? Math.max(0, (currentKRW / goal.targetAmount) * 100) : 0;
  const projection = projectGoal({
    series: series.length > 0 ? series : [{ month: nowMonth, value: currentKRW }],
    target: goal.targetAmount,
    targetDate: goal.targetDate ?? null,
  });

  return { mode, currentKRW, pct, series, projection };
}
