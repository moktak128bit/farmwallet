/**
 * 월간 리뷰 내러티브 — 순수 모듈 (React 의존 없음).
 *
 * 종합 월간 보고서(ComprehensiveMonthlySection)가 이미 내는 "숫자 한 장" 위에
 * 잘한 점(wins)·주의(warnings)·헤드라인을 문장으로 얹는다. 읽기 전용 — 저장하지 않는다.
 *
 * 재료는 전부 기존 단일 소스를 호출만 한다 (여기서 분류 규칙을 재정의하지 않음):
 *  - 수입/지출/재테크 분류: classifyLedgerFlow + toKrwAmount (summaryMath)
 *  - 전월·전년 동기 비교: compareMonths (dayCap)
 *  - 카테고리 이상치(z): detectSpendAnomalies
 *  - 카테고리 증감 TOP: computeCategoryGrowth
 *  - 예산 사용액: computeBudgetGoalSpent
 *  - 실질 저축률: computeMonthlyRealFlows + computeRealSavingsRate
 *
 * 진행 중인 달(month === todayIso의 달)이면 모든 비교를 "동기(1~N일)"로 강제한다 —
 * 전월·전년·최근 3개월 평균 전부 1~N일만 합산(컨벤션 13). 완결 월은 전체 월 비교.
 */
import type { BudgetGoal, CategoryPresets, LedgerEntry, RecurringExpense } from "../types";
import { BUDGET_ALL_CATEGORY } from "../types";
import { classifyLedgerFlow, toKrwAmount } from "../features/dashboard/summaryMath";
import { isInvestmentLossEntry } from "./category";
import { expenseMainName } from "./categoryMerge";
import { compareMonths } from "./monthComparison";
import { detectSpendAnomalies } from "./anomaly";
import { computeCategoryGrowth } from "./insightsTrends";
import { computeBudgetGoalSpent } from "./budgetUsage";
import { computeMonthlyRealFlows, computeRealSavingsRate } from "./savingsRate";
import { getLastDayOfMonth, shiftMonth } from "./date";

interface MonthlyReviewInput {
  ledger: LedgerEntry[];
  /** 대상 월 "YYYY-MM" */
  month: string;
  /** 오늘(KST) "YYYY-MM-DD" — 진행 중인 달 판정·동기 dayCap. 주입받아 순수·테스트 가능 */
  todayIso: string;
  categoryPresets?: CategoryPresets;
  fxRate: number | null;
  budgetGoals?: BudgetGoal[];
  recurring?: RecurringExpense[];
  /** 데이트 계좌 — 실질 저축률의 50% 차감(종합 보고서와 동일 기준). 없으면 null */
  dateAccountId?: string | null;
}

/** 비교 한 칸 — diff/pct는 compareMonths 규약(기준 0·현재>0이면 pct null="신규") */
interface ReviewDelta {
  current: number;
  base: number;
  diff: number;
  pct: number | null;
}

type ReviewItemKind =
  | "budget-kept"
  | "budget-pace"
  | "zero-days"
  | "savings-rate-up"
  | "decrease-top"
  | "anomaly"
  | "growth-top"
  | "new-category"
  | "budget-over"
  | "subscription-spike"
  | "savings-rate-down";

interface ReviewItem {
  kind: ReviewItemKind;
  text: string;
}

interface TopExpense {
  category: string;
  amount: number;
  /** 해당 월 지출 총액 대비 비중(%) */
  share: number;
}

interface MonthlyReview {
  month: string;
  /** 진행 중인 달이면 오늘 일자(1~N) — 모든 비교가 1~N일 동기로 계산됐음. 완결 월은 null */
  partialDay: number | null;
  /** 비교 라벨 — 진행 중인 달은 "전월 동기(1~N일)"처럼 '동기(1~N일)'를 반드시 포함 */
  compareLabel: { prevMonth: string; prevYear: string; avg3: string };
  /** 대상 월에 수입/지출/재테크 기록이 하나라도 있는지 — 없으면 UI는 내러티브를 숨긴다 */
  hasData: boolean;
  headline: string;
  numbers: {
    income: number;
    expense: number;
    /** 재테크 순집계(저축·투자 이체 + 투자수익 − 투자손실) */
    investing: number;
    realSavingsRate: number | null;
    /** 전월(동기) 실질 저축률 — 없으면 null */
    prevRealSavingsRate: number | null;
    vsPrevMonth: { income: ReviewDelta; expense: ReviewDelta };
    vsPrevYear: { income: ReviewDelta; expense: ReviewDelta };
  };
  wins: ReviewItem[];
  warnings: ReviewItem[];
  topExpenses: TopExpense[];
}

/* ───────────────── 내부 헬퍼 ───────────────── */

const fmtWon = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const fmtPct = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
const fmtPp = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(1)}%p`;
const dayOf = (iso: string) => Number(iso.slice(8, 10));

/** 지출 카테고리 증감 TOP에 오르는 최소 변화율(%) */
const GROWTH_WARN_PCT = 30;
const DECREASE_WIN_PCT = 20;
/** 구독비 급증 판정 — 최근 3개월 평균 대비 % 및 최소 금액(KRW) */
const SUBSCRIPTION_SPIKE_PCT = 20;
const SUBSCRIPTION_MIN_KRW = 10_000;
/** 저축률 변화를 wins/warnings에 올리는 최소 폭(%p) */
const SAVINGS_RATE_PP = 1;

/**
 * USD 항목을 원화 금액으로 사전 정규화한 얕은 복사본.
 * computeCategoryGrowth·detectSpendAnomalies는 raw amount를 합산하므로 여기서 환산해 넘긴다
 * (compareMonths·computeBudgetGoalSpent·computeMonthlyRealFlows는 스스로 환산하므로 raw ledger를 넘길 것 —
 *  정규화본을 넘기면 이중 환산).
 */
function toKrwLedger(ledger: LedgerEntry[], fxRate: number | null): LedgerEntry[] {
  return ledger.map((e) => (e.currency === "USD" ? { ...e, amount: toKrwAmount(e, fxRate), currency: undefined } : e));
}

/** 구독 판정 — 인사이트(useInsightsData)와 동일 문자열 규칙 + 등록된 구독 반복지출 제목 매칭 */
function isSubscriptionEntry(l: LedgerEntry, recurringTitles: Set<string>): boolean {
  if (l.kind !== "expense") return false;
  const cat = (l.category || "").trim();
  const sub = (l.subCategory || "").trim();
  const det = (l.detailCategory || "").trim();
  if (cat.includes("구독") || sub.includes("구독") || det.includes("구독")) return true;
  const desc = (l.description || "").trim();
  return desc !== "" && recurringTitles.has(desc);
}

/* ───────────────── 본체 ───────────────── */

export function buildMonthlyReview(input: MonthlyReviewInput): MonthlyReview {
  const { ledger, month, todayIso, categoryPresets, fxRate, budgetGoals = [], recurring = [], dateAccountId = null } = input;
  const curMonthStr = todayIso.slice(0, 7);
  const todayDayNum = dayOf(todayIso);
  const isCurrent = month === curMonthStr;
  const partialDay = isCurrent ? todayDayNum : null;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = getLastDayOfMonth(y, m);
  /** 집계 마지막 일자 — 진행 중인 달은 오늘, 완결 월은 말일 */
  const lastDay = partialDay != null ? Math.min(partialDay, daysInMonth) : daysInMonth;
  const prevMonth = shiftMonth(month, -1);
  const dayCap = partialDay;
  const sameLabel = partialDay != null ? ` 동기(1~${partialDay}일)` : "";
  const compareLabel = {
    prevMonth: `전월${sameLabel}`,
    prevYear: `전년 동월${sameLabel}`,
    avg3: `최근 3개월${partialDay != null ? ` 동기(1~${partialDay}일)` : ""} 평균`
  };

  /** 진행 중인 달이면 전 기간을 1~N일로 잘라낸 장부 — 동기 비교용(저축률·무지출일·구독) */
  const cappedLedger = dayCap != null ? ledger.filter((e) => !e.date || dayOf(e.date) <= dayCap) : ledger;
  const krwLedger = toKrwLedger(cappedLedger, fxRate);

  // ── 1. 이번 달 수입/지출/재테크 (classifyLedgerFlow 단일 기준, USD 환산) ──
  let investing = 0;
  let hasData = false;
  const expenseByCat = new Map<string, number>();
  const spendDays = new Set<string>();
  for (const e of cappedLedger) {
    if (!e.date?.startsWith(month)) continue;
    const flow = classifyLedgerFlow(e, categoryPresets);
    if (!flow) continue;
    const a = toKrwAmount(e, fxRate);
    hasData = true;
    if (flow === "investing") investing += isInvestmentLossEntry(e) ? -a : a;
    else if (flow === "expense" && a > 0) {
      const cat = expenseMainName(e) || "기타";
      expenseByCat.set(cat, (expenseByCat.get(cat) ?? 0) + a);
      spendDays.add(e.date);
    }
  }
  const expCmp = compareMonths(ledger, month, "expense", fxRate, categoryPresets, dayCap);
  const incCmp = compareMonths(ledger, month, "income", fxRate, categoryPresets, dayCap);
  const income = incCmp.current;
  const expense = expCmp.current;
  const delta = (cur: number, base: number, diff: number, pct: number | null): ReviewDelta => ({ current: cur, base, diff, pct });
  const vsPrevMonth = {
    income: delta(income, incCmp.previousMonth, incCmp.diffPrevMonth, incCmp.diffPrevMonthPct),
    expense: delta(expense, expCmp.previousMonth, expCmp.diffPrevMonth, expCmp.diffPrevMonthPct)
  };
  const vsPrevYear = {
    income: delta(income, incCmp.previousYearSameMonth, incCmp.diffPrevYear, incCmp.diffPrevYearPct),
    expense: delta(expense, expCmp.previousYearSameMonth, expCmp.diffPrevYear, expCmp.diffPrevYearPct)
  };

  // ── 2. 실질 저축률 (이번 달·전월 동기) ──
  const flows = computeMonthlyRealFlows(cappedLedger, {
    fxRate,
    dateAccountId,
    startMonth: prevMonth,
    endMonth: month,
    nonRealIncomeOverride: categoryPresets?.categoryTypes?.nonRealIncome
  });
  const curFlow = flows.get(month);
  const prevFlow = flows.get(prevMonth);
  const realSavingsRate = curFlow ? computeRealSavingsRate(curFlow.realIncome, curFlow.realExpense) : null;
  const prevRealSavingsRate = prevFlow ? computeRealSavingsRate(prevFlow.realIncome, prevFlow.realExpense) : null;

  // ── 3. TOP 지출 카테고리 ──
  const topExpenses: TopExpense[] = Array.from(expenseByCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount, share: expense > 0 ? (amount / expense) * 100 : 0 }));

  const wins: ReviewItem[] = [];
  const warnings: ReviewItem[] = [];

  // ── 4. 예산 — 지킴/페이스/초과 ──
  for (const g of budgetGoals) {
    if (!(g.monthlyLimit > 0)) continue;
    const spent = computeBudgetGoalSpent(g, cappedLedger, month, { categoryPresets, fxRate });
    const name = g.category === BUDGET_ALL_CATEGORY ? "전체 지출" : g.category;
    const usedPct = (spent / g.monthlyLimit) * 100;
    if (spent > g.monthlyLimit) {
      warnings.push({
        kind: "budget-over",
        text: partialDay != null
          ? `${name} 예산 초과 — ${partialDay}일 만에 ${fmtWon(spent)} / ${fmtWon(g.monthlyLimit)} (${usedPct.toFixed(0)}%)`
          : `${name} 예산 초과 — ${fmtWon(spent)} / ${fmtWon(g.monthlyLimit)} (${usedPct.toFixed(0)}%)`
      });
    } else if (partialDay == null) {
      wins.push({ kind: "budget-kept", text: `${name} 예산 지킴 — ${fmtWon(spent)} / ${fmtWon(g.monthlyLimit)} (${usedPct.toFixed(0)}%)` });
    } else {
      // 진행 중인 달: 경과일 비율 이하로 쓰고 있으면 페이스 양호 (선형 페이스 — 3-1 computeBudgetPace와 무관한 단순 판정)
      const elapsedPct = (lastDay / daysInMonth) * 100;
      if (usedPct <= elapsedPct) {
        wins.push({ kind: "budget-pace", text: `${name} 예산 페이스 양호 — 사용 ${usedPct.toFixed(0)}% (경과 ${elapsedPct.toFixed(0)}%)` });
      }
    }
  }

  // ── 5. 무지출일 (진행 중인 달은 1~오늘, 미래 일자는 세지 않음) ──
  if (hasData && lastDay > 0) {
    const zeroDays = lastDay - spendDays.size;
    if (zeroDays > 0) {
      // 전월 동기 무지출일 — 같은 기간(1~lastDay일)만
      const prevSpendDays = new Set<string>();
      const prevDaysInMonth = getLastDayOfMonth(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)));
      const prevLastDay = Math.min(lastDay, prevDaysInMonth);
      let prevHas = false;
      for (const e of cappedLedger) {
        if (!e.date?.startsWith(prevMonth) || dayOf(e.date) > prevLastDay) continue;
        prevHas = true;
        if (classifyLedgerFlow(e, categoryPresets) === "expense" && toKrwAmount(e, fxRate) > 0) prevSpendDays.add(e.date);
      }
      const prevZero = prevHas ? prevLastDay - prevSpendDays.size : null;
      const cmp = prevZero != null && prevZero !== zeroDays ? ` (${compareLabel.prevMonth} ${prevZero}일 → ${zeroDays > prevZero ? "+" : ""}${zeroDays - prevZero}일)` : "";
      wins.push({ kind: "zero-days", text: `무지출일 ${zeroDays}일 / ${lastDay}일${cmp}` });
    }
  }

  // ── 6. 저축률 변화 ──
  if (realSavingsRate != null && prevRealSavingsRate != null) {
    const pp = realSavingsRate - prevRealSavingsRate;
    if (pp >= SAVINGS_RATE_PP) {
      wins.push({ kind: "savings-rate-up", text: `실질 저축률 ${realSavingsRate.toFixed(1)}% — ${compareLabel.prevMonth} 대비 ${fmtPp(pp)}` });
    } else if (pp <= -SAVINGS_RATE_PP) {
      warnings.push({ kind: "savings-rate-down", text: `실질 저축률 ${realSavingsRate.toFixed(1)}% — ${compareLabel.prevMonth} 대비 ${fmtPp(pp)}` });
    }
  }

  // ── 7. 카테고리 증감 TOP (최근 3개월 평균 대비, 동기) ──
  const growth = computeCategoryGrowth({
    ledger: krwLedger,
    months: [shiftMonth(month, -3), shiftMonth(month, -2), prevMonth, month],
    curMonthStr,
    anomalyTargetMonth: month,
    todayDayNum,
    categoryPresets
  });
  const down = growth.down.find((r) => !r.isNew && r.pctChange <= -DECREASE_WIN_PCT && r.cur < r.avg3);
  if (down) {
    wins.push({ kind: "decrease-top", text: `${down.sub} 지출 감소 — ${fmtWon(down.cur)} (${compareLabel.avg3} ${fmtWon(down.avg3)} 대비 ${fmtPct(down.pctChange)})` });
  }
  const up = growth.up.find((r) => !r.isNew && r.pctChange >= GROWTH_WARN_PCT);
  if (up) {
    warnings.push({ kind: "growth-top", text: `${up.sub} 지출 증가 — ${fmtWon(up.cur)} (${compareLabel.avg3} ${fmtWon(up.avg3)} 대비 ${fmtPct(up.pctChange)})` });
  }
  const fresh = growth.up.find((r) => r.isNew);
  if (fresh) {
    warnings.push({ kind: "new-category", text: `신규 지출 카테고리 — ${fresh.sub} ${fmtWon(fresh.cur)} (최근 3개월 기록 없음)` });
  }

  // ── 8. 이상치 (z-score, 최근 6개월 평균 대비, 동기) ──
  const anomalies = detectSpendAnomalies(krwLedger, month, 6, dayCap ?? undefined, categoryPresets).filter((a) => a.isAnomaly);
  for (const a of anomalies.slice(0, 3)) {
    // 성장 TOP와 같은 카테고리면 중복 경고 생략
    if (up && up.sub === a.category) continue;
    warnings.push({
      kind: "anomaly",
      text: `${a.category} 이상치 — ${fmtWon(a.currentMonthAmount)} (6개월 평균 ${fmtWon(a.averageAmount)}, z=${a.zScore.toFixed(1)}${a.severity === "extreme" ? " 극단" : ""})`
    });
  }

  // ── 9. 구독비 급증 ──
  const recurringTitles = new Set(
    recurring
      .filter((r) => (r.title || "").includes("구독") || (r.category || "").includes("구독"))
      .map((r) => r.title.trim())
      .filter(Boolean)
  );
  const subMonths = [shiftMonth(month, -3), shiftMonth(month, -2), prevMonth];
  let subCur = 0;
  const subPrev = new Map<string, number>(subMonths.map((mm) => [mm, 0]));
  for (const e of krwLedger) {
    if (!e.date || !isSubscriptionEntry(e, recurringTitles)) continue;
    if (classifyLedgerFlow(e, categoryPresets) !== "expense") continue;
    const mm = e.date.slice(0, 7);
    if (mm === month) subCur += e.amount;
    else if (subPrev.has(mm)) subPrev.set(mm, (subPrev.get(mm) ?? 0) + e.amount);
  }
  const subPrevVals = Array.from(subPrev.values()).filter((v) => v > 0);
  if (subPrevVals.length > 0 && subCur >= SUBSCRIPTION_MIN_KRW) {
    const subAvg = subPrevVals.reduce((s, v) => s + v, 0) / subPrevVals.length;
    const pct = ((subCur - subAvg) / subAvg) * 100;
    if (pct >= SUBSCRIPTION_SPIKE_PCT) {
      warnings.push({ kind: "subscription-spike", text: `구독비 급증 — ${fmtWon(subCur)} (${compareLabel.avg3} ${fmtWon(subAvg)} 대비 ${fmtPct(pct)})` });
    }
  }

  // ── 10. 헤드라인 ──
  const monthLabel = `${y}년 ${m}월${partialDay != null ? `(1~${partialDay}일)` : ""}`;
  let headline: string;
  if (!hasData) {
    headline = `${monthLabel} 기록이 없습니다.`;
  } else {
    const parts: string[] = [`수입 ${fmtWon(income)}`, `지출 ${fmtWon(expense)}`];
    if (expCmp.diffPrevMonthPct != null && expCmp.previousMonth > 0) parts.push(`${compareLabel.prevMonth} 대비 지출 ${fmtPct(expCmp.diffPrevMonthPct)}`);
    if (realSavingsRate != null) parts.push(`실질 저축률 ${realSavingsRate.toFixed(1)}%`);
    headline = `${monthLabel} · ${parts.join(" · ")}`;
  }

  return {
    month,
    partialDay,
    compareLabel,
    hasData,
    headline,
    numbers: { income, expense, investing, realSavingsRate, prevRealSavingsRate, vsPrevMonth, vsPrevYear },
    wins,
    warnings,
    topExpenses
  };
}

/* ───────────────── 마크다운 ───────────────── */

const mdDelta = (d: ReviewDelta) =>
  `${d.diff > 0 ? "+" : ""}${fmtWon(d.diff)}${d.pct != null ? ` (${fmtPct(d.pct)})` : d.current > 0 ? " (신규)" : ""}`;

/** 리뷰를 마크다운 문서로 — ledgerMarkdownReport와 같은 '내보내기 파일' 용도(복사·붙여넣기 가능한 회고용) */
export function buildMonthlyReviewMarkdown(review: MonthlyReview, generatedAt: string): string {
  const { numbers: n } = review;
  let md = `# ${review.month} 월간 리뷰\n\n`;
  md += `> Farm Wallet 종합 월간 보고서에서 생성 (${generatedAt})`;
  if (review.partialDay != null) md += ` — 진행 중인 달: 모든 비교는 1~${review.partialDay}일 동기 기준`;
  md += `\n\n**${review.headline}**\n\n`;
  if (!review.hasData) return md;

  md += `## 숫자 한 장\n\n`;
  md += `| 구분 | 이번 달 | ${review.compareLabel.prevMonth} 대비 | ${review.compareLabel.prevYear} 대비 |\n`;
  md += `|------|------|------|------|\n`;
  md += `| 수입 | ${fmtWon(n.income)} | ${mdDelta(n.vsPrevMonth.income)} | ${mdDelta(n.vsPrevYear.income)} |\n`;
  md += `| 지출 | ${fmtWon(n.expense)} | ${mdDelta(n.vsPrevMonth.expense)} | ${mdDelta(n.vsPrevYear.expense)} |\n`;
  md += `| 재테크(순) | ${fmtWon(n.investing)} | | |\n`;
  md += `| 실질 저축률 | ${n.realSavingsRate != null ? `${n.realSavingsRate.toFixed(1)}%` : "-"} | ${
    n.realSavingsRate != null && n.prevRealSavingsRate != null ? fmtPp(n.realSavingsRate - n.prevRealSavingsRate) : "-"
  } | |\n\n`;

  md += `## 잘한 점\n\n`;
  md += review.wins.length ? review.wins.map((w) => `- ${w.text}\n`).join("") : `- (없음)\n`;
  md += `\n## 주의\n\n`;
  md += review.warnings.length ? review.warnings.map((w) => `- ${w.text}\n`).join("") : `- (없음)\n`;

  if (review.topExpenses.length) {
    md += `\n## 지출 TOP\n\n| 카테고리 | 금액 | 비중 |\n|------|------|------|\n`;
    for (const t of review.topExpenses) md += `| ${t.category.replace(/\|/g, "\\|")} | ${fmtWon(t.amount)} | ${t.share.toFixed(1)}% |\n`;
  }
  md += `\n## 한 줄 회고\n\n- \n`;
  return md;
}
