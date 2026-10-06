/**
 * 인앱 알림 센터 / 넛지 엔진 (3-11) — 순수함수.
 *
 * 기존 계산(반복지출 미등록·예산 페이스·종합과세·선행배당·환율 밴드·대출 만기)을 **호출만** 해서
 * "지금 확인해야 할 것" 목록(Nudge[])을 만든다. 새 집계 로직은 만들지 않는다 — 각 규칙의 진짜 계산은
 * 이미 단일 소스(budgetPace.ts, taxCalculator.ts 등)에 있고 여기서는 임계값 판정 + 표시 문구만 얹는다.
 *
 * 규칙 격리: 한 규칙이 예외를 던져도(예: 손상된 항목) 나머지 규칙은 계속 평가되도록 각 규칙 함수를
 * try/catch로 감싼다 (buildNudges 자체가 절대 throw하지 않아야 헤더 벨이 항상 뜬다).
 *
 * 순수성: DOM/localStorage/IndexedDB를 이 파일에서 직접 읽지 않는다.
 * localStorage 사용률(storageRatio)·마이그레이션 리포트·세전환산 토글처럼 브라우저 상태가 필요한 값은
 * 호출부(NotificationCenter)가 미리 읽어 NudgeContext 필드로 주입한다.
 *
 * 대출 상환일: Loan에는 매달 상환일 필드가 없다(신용카드 paymentDay와 달리). 있는 날짜 필드 중
 * 실제 "상환이 걸리는 날"에 가장 가까운 것은 maturityDate(만기일)뿐이라, 만기 D-3 임박으로 대체한다.
 */
import type {
  Account,
  BudgetGoal,
  CategoryPresets,
  HistoricalDailyFx,
  Loan,
  LedgerEntry,
  MarketEnvSnapshot,
  RecurringExpense,
  StockTrade
} from "../types";
import type { TabId } from "../components/ui/Tabs";
import { findOverdueRecurring } from "./recurringAlert";
import { computeBudgetPace } from "./budgetPace";
import { buildComprehensiveTaxTracker } from "./taxCalculator";
import { formatNumber } from "./formatter";
import { buildForwardDividends, buildTaxForwardMonths, netQtyByTicker } from "./forwardDividends";
import { buildShelterAccountMap } from "./taxShelter";
import { buildFxHistory } from "./portfolioHistory";
import { buildFxBand, describeFxBand } from "./fxBand";
import { parseIsoLocal } from "./date";
import { computeLoanBalancesById } from "../calculations";

export type NudgeSeverity = "info" | "warn" | "critical";

export interface Nudge {
  /** 표시·정렬용 고유 id. dedupeKey와 같은 값을 쓴다(스누즈 조회 키 통일) */
  id: string;
  severity: NudgeSeverity;
  title: string;
  detail: string;
  /** 클릭 시 이동할 탭 */
  tab: TabId;
  /** 스누즈(7일) 매칭 키 — 같은 항목이 값만 바뀌어도 계속 같은 키를 써야 스누즈가 먹는다 */
  dedupeKey: string;
  /** 발생 기준 시각(ISO) — 정렬용. 순수성을 위해 ctx.today에서 파생(실제 시:분:초 아님) */
  at: string;
}

export interface NudgeContext {
  /** KST YYYY-MM-DD. 호출부가 getTodayKST()로 주입(결정성 유지) */
  today: string;
  ledger: LedgerEntry[];
  recurringExpenses: RecurringExpense[];
  budgetGoals: BudgetGoal[];
  categoryPresets?: CategoryPresets;
  accounts?: Account[];
  loans?: Loan[];
  /** 현재 USD/KRW 환율 (FxRateContext) — 미로드면 null/undefined */
  fxRate?: number | null;
  /** 종합과세 세전 환산(gross-up) 토글 — hooks/useTaxGrossUp 값을 그대로 전달 */
  taxGrossUp?: boolean;
  /** 주식 거래 — 선행배당 보유 반영(전량 매도 종목 제외)용. 배당 탭과 같은 netQtyByTicker 맵을 만든다 */
  trades?: StockTrade[];
  historicalDailyFx?: HistoricalDailyFx[];
  marketEnvSnapshots?: MarketEnvSnapshot[];
  /** localStorage 사용률 0~1 — utils/storageUsage.measureLocalStorageUsage(...).ratio */
  storageRatio?: number | null;
  /** 마지막 스키마 마이그레이션 리포트 — services/migrationReport.readLastMigrationReport() 결과 */
  lastMigrationReport?: { at: string; toVersion: number; hasChanges: boolean } | null;
}

const won = (n: number) => `${formatNumber(n)}원`;

/** a, b(둘 다 YYYY-MM-DD) 사이 일수. b - a. 파싱 실패 시 null */
function diffDays(a: string, b: string): number | null {
  const da = parseIsoLocal(a);
  const db = parseIsoLocal(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** 규칙 하나를 실행하고 예외를 흡수 — 한 규칙의 손상 데이터가 전체 넛지 생성을 막지 않게 */
function safeRule(build: () => Nudge[]): Nudge[] {
  try {
    return build();
  } catch (err) {
    console.warn("[nudges] rule failed", err);
    return [];
  }
}

/** 반복지출 미등록 — 마감일이 지났거나(오늘 포함) grace 안인데 아직 안 기록됨 (기존 헤더 배지와 같은 판정) */
function ruleRecurringOverdue(ctx: NudgeContext): Nudge[] {
  const missing = findOverdueRecurring(ctx.recurringExpenses, ctx.ledger, ctx.today).filter((m) => !m.alreadyLogged);
  return missing.map((m) => {
    const overdueDays = diffDays(m.dueDate, ctx.today) ?? 0;
    return {
      id: `recurring:${m.recurring.id}:${m.dueDate}`,
      // 기록 리마인더일 뿐 데이터 위험이 아니다 — critical이면 헤더 벨 배지가 상시 빨강이 된다
      severity: "warn" as const,
      title: `반복지출 미등록 — ${m.recurring.title || "(제목 없음)"}`,
      detail:
        overdueDays > 0
          ? `${m.dueDate} 마감(${overdueDays}일 지남) · ${won(m.recurring.amount)}`
          : `오늘 마감 · ${won(m.recurring.amount)}`,
      tab: "budget",
      dedupeKey: `recurring:${m.recurring.id}:${m.dueDate}`,
      at: ctx.today
    };
  });
}

/** 예산 페이스 — 이 페이스면 초과할 예정(over-pace)이거나 이미 초과(exceeded)인 예산만 */
function ruleBudgetPace(ctx: NudgeContext): Nudge[] {
  // getThisMonthKST()(실제 시각)가 아닌 ctx.today에서 파생 — 순수성/결정성(테스트 가능성) 유지
  const month = ctx.today.slice(0, 7);
  const out: Nudge[] = [];
  for (const goal of ctx.budgetGoals) {
    const pace = computeBudgetPace(goal, ctx.ledger, month, ctx.today, {
      categoryPresets: ctx.categoryPresets,
      fxRate: ctx.fxRate
    });
    if (pace.status !== "over-pace" && pace.status !== "exceeded") continue;
    out.push({
      id: `budget:${goal.id}:${month}`,
      severity: pace.status === "exceeded" ? "critical" : "warn",
      title: `예산 ${pace.status === "exceeded" ? "초과" : "페이스 초과 예상"} — ${goal.category}`,
      detail: pace.message,
      tab: "budget",
      dedupeKey: `budget:${goal.id}:${month}`,
      at: ctx.today
    });
  }
  return out;
}

/** 종합과세 임계 접근 — 80%↑ 주의, 90%↑ 위험 */
function ruleComprehensiveTax(ctx: NudgeContext): Nudge[] {
  const excludeAccountIds = ctx.accounts ? new Set(buildShelterAccountMap(ctx.accounts).keys()) : undefined;
  // 배당 탭 종합과세 카드와 같은 투영 — 보유 반영 + 절세계좌 제외 + 이번 달 미수령 잔여분
  const forwardMonths = buildTaxForwardMonths(ctx.ledger, ctx.today, ctx.fxRate, {
    currentQtyByTicker: ctx.trades ? netQtyByTicker(ctx.trades) : undefined,
    excludeAccountIds
  });
  const t = buildComprehensiveTaxTracker(ctx.ledger, ctx.today, ctx.fxRate, {
    grossUp: ctx.taxGrossUp === true,
    excludeAccountIds,
    forwardMonths
  });
  if (t.pctOfThreshold < 0.8) return [];
  const severity: NudgeSeverity = t.pctOfThreshold >= 0.9 || t.exceeded ? "critical" : "warn";
  return [
    {
      id: `tax:${t.year}`,
      severity,
      title: t.exceeded ? "종합과세 임계 초과" : `종합과세 임계 ${Math.round(t.pctOfThreshold * 100)}%`,
      detail: t.exceeded
        ? `올해 금융소득 ${won(t.ytdGross)} — 임계 ${won(t.threshold)} 초과 ${won(t.ytdGross - t.threshold)}`
        : `올해 금융소득 ${won(t.ytdGross)} / 임계 ${won(t.threshold)} — 남음 ${won(t.remainingToThreshold)}`,
      tab: "dividends",
      dedupeKey: `tax:${t.year}`,
      at: ctx.today
    }
  ];
}

/** 다가오는 배당 — 선행배당 캘린더의 가장 가까운 미래 달 예상액이 있으면 info로 미리 알림 */
function ruleUpcomingDividend(ctx: NudgeContext): Nudge[] {
  // 보유 반영 — 전량 매도한 종목의 과거 배당이 '다가오는 배당'으로 뜨지 않게 (배당 탭 캘린더와 동일)
  const fwd = buildForwardDividends(ctx.ledger, ctx.today, ctx.fxRate, {
    currentQtyByTicker: ctx.trades ? netQtyByTicker(ctx.trades) : undefined
  });
  const next = fwd.months[0];
  if (!next || next.amountKRW <= 0) return [];
  return [
    {
      id: `dividend-forward:${next.month}`,
      severity: "info",
      title: `다가오는 배당 — ${next.month}`,
      detail: `선행배당 기준 예상 ${won(next.amountKRW)} (최근 12개월 패턴 투영)`,
      tab: "dividends",
      dedupeKey: `dividend-forward:${next.month}`,
      at: ctx.today
    }
  ];
}

/** 환율 밴드 — 최근 1년 분포에서 극단(하위 20%/상위 20%)일 때만 */
function ruleFxBand(ctx: NudgeContext): Nudge[] {
  if (!ctx.historicalDailyFx && !ctx.marketEnvSnapshots) return [];
  const fxHistory = buildFxHistory(ctx.historicalDailyFx, ctx.marketEnvSnapshots);
  const result = buildFxBand(fxHistory, ctx.fxRate ?? null, ctx.today);
  const band = result.band;
  if (!band || band.percentileOfCurrent == null) return [];
  const pct = band.percentileOfCurrent;
  if (pct > 20 && pct < 80) return [];
  const label = describeFxBand(band);
  return [
    {
      id: "fxband",
      severity: "info",
      title: pct <= 20 ? "환율 저점권 — USD 매수 참고" : "환율 고점권 — USD 매도/환전 참고",
      detail: label?.text ?? `최근 1년 분위 ${Math.round(pct)}%`,
      tab: "stocks",
      dedupeKey: "fxband",
      at: ctx.today
    }
  ];
}

/** 대출 만기 D-3 — Loan에 월별 상환일 필드가 없어 만기일(maturityDate) 임박으로 대체 */
function ruleLoanMaturity(ctx: NudgeContext): Nudge[] {
  const out: Nudge[] = [];
  // 잔금은 상환 반영 값(전체 대출 목록으로 단일 승자 매칭) — 원금(loanAmount)을 찍거나 다 갚은 대출에 알리지 않게
  const balances = computeLoanBalancesById(ctx.loans, ctx.ledger, ctx.today);
  for (const loan of ctx.loans ?? []) {
    const d = diffDays(ctx.today, loan.maturityDate);
    if (d == null || d < 0 || d > 3) continue;
    const balance = balances.get(loan.id) ?? 0;
    if (balance <= 0) continue;
    out.push({
      id: `loan:${loan.id}:maturity`,
      severity: "warn",
      title: `대출 만기 D-${d} — ${loan.loanName || loan.institution}`,
      detail: `${loan.institution} · 만기 ${loan.maturityDate} · 잔액 ${won(balance)}`,
      tab: "debt",
      dedupeKey: `loan:${loan.id}:maturity`,
      at: ctx.today
    });
  }
  return out;
}

const STORAGE_WARNING_RATIO = 0.8;

/** localStorage 사용률 80%+ */
function ruleStorageUsage(ctx: NudgeContext): Nudge[] {
  if (ctx.storageRatio == null || ctx.storageRatio < STORAGE_WARNING_RATIO) return [];
  const pct = Math.round(ctx.storageRatio * 100);
  return [
    {
      id: "storage-usage",
      severity: ctx.storageRatio >= 0.95 ? "critical" : "warn",
      title: `저장공간 사용률 ${pct}%`,
      detail: "localStorage 한계(5MB)에 가까워지고 있습니다. 설정 > 백업에서 오래된 데이터를 정리하세요.",
      tab: "settings",
      dedupeKey: "storage-usage",
      at: ctx.today
    }
  ];
}

/** 마지막 마이그레이션 리포트 — 실제 변경이 있었던 마이그레이션만 확인 유도 */
function ruleMigrationReport(ctx: NudgeContext): Nudge[] {
  const r = ctx.lastMigrationReport;
  if (!r || !r.hasChanges) return [];
  return [
    {
      id: `migration:${r.at}`,
      severity: "info",
      title: `스키마 마이그레이션(v${r.toVersion}) 결과 미확인`,
      detail: "데이터 구조가 자동 업그레이드되며 값이 바뀐 항목이 있습니다. 설정 > 백업에서 확인하세요.",
      tab: "settings",
      dedupeKey: `migration:${r.at}`,
      at: ctx.today
    }
  ];
}

const RULES: Array<(ctx: NudgeContext) => Nudge[]> = [
  ruleRecurringOverdue,
  ruleBudgetPace,
  ruleComprehensiveTax,
  ruleUpcomingDividend,
  ruleFxBand,
  ruleLoanMaturity,
  ruleStorageUsage,
  ruleMigrationReport
];

const SEVERITY_ORDER: Record<NudgeSeverity, number> = { critical: 0, warn: 1, info: 2 };

/** 컨텍스트로부터 넛지 목록 생성 — severity(critical>warn>info) → id 순으로 정렬해 항상 같은 순서를 보장 */
export function buildNudges(ctx: NudgeContext): Nudge[] {
  const out: Nudge[] = [];
  for (const rule of RULES) out.push(...safeRule(() => rule(ctx)));
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
}
