/**
 * buildMonthlyReview — 월간 리뷰 내러티브 회귀 테스트.
 * 핵심: 진행 중인 달은 전월·전년·3개월 평균 전부 '동기(1~N일)'로 강제, 완결 월은 전체 월 비교,
 * 빈 데이터 안전, USD는 원화 환산(이상치·증감 TOP까지).
 */
import { describe, expect, it } from "vitest";
import type { BudgetGoal, LedgerEntry, RecurringExpense } from "../types";
import { buildMonthlyReview, buildMonthlyReviewMarkdown } from "../utils/monthlyReview";

let seq = 0;
function entry(p: Partial<LedgerEntry> & { date: string; amount: number }): LedgerEntry {
  seq += 1;
  return {
    id: `r${seq}`,
    kind: "expense",
    category: "지출",
    subCategory: "식비",
    description: "",
    ...p
  } as LedgerEntry;
}
const income = (date: string, amount: number): LedgerEntry =>
  entry({ date, amount, kind: "income", category: "급여", subCategory: "급여" });

const TODAY = "2026-08-21";

describe("buildMonthlyReview — 동기 비교(진행 중인 달)", () => {
  const ledger = [
    entry({ date: "2026-08-10", amount: 120_000 }),
    entry({ date: "2026-08-25", amount: 999_000 }), // 미래 일자 — 동기 집계에서 제외
    entry({ date: "2026-07-10", amount: 100_000 }),
    entry({ date: "2026-07-28", amount: 500_000 }), // 전월 22일 이후 — 동기 비교에서 제외
    entry({ date: "2025-08-05", amount: 60_000 }),
    entry({ date: "2025-08-30", amount: 700_000 }), // 전년 22일 이후 — 제외
    income("2026-08-01", 1_000_000),
    income("2026-07-01", 1_000_000)
  ];

  it("partialDay·라벨에 '동기(1~N일)'가 붙고 전월·전년도 1~N일만 합산한다", () => {
    const r = buildMonthlyReview({ ledger, month: "2026-08", todayIso: TODAY, fxRate: null });
    expect(r.partialDay).toBe(21);
    expect(r.compareLabel.prevMonth).toBe("전월 동기(1~21일)");
    expect(r.compareLabel.prevYear).toBe("전년 동월 동기(1~21일)");
    expect(r.compareLabel.avg3).toContain("동기(1~21일)");
    expect(r.numbers.expense).toBe(120_000);
    expect(r.numbers.vsPrevMonth.expense.base).toBe(100_000);
    expect(r.numbers.vsPrevMonth.expense.pct).toBeCloseTo(20);
    expect(r.numbers.vsPrevYear.expense.base).toBe(60_000);
    expect(r.numbers.vsPrevYear.expense.pct).toBeCloseTo(100);
    expect(r.headline).toContain("(1~21일)");
    expect(r.headline).toContain("전월 동기(1~21일) 대비 지출 +20.0%");
    // 무지출일도 1~오늘까지만 센다 (21일 중 지출일 1일)
    const zero = r.wins.find((w) => w.kind === "zero-days");
    // 전월 동기(1~21일)도 무지출 20일로 같아 비교 꼬리표 생략
    expect(zero?.text).toBe("무지출일 20일 / 21일");
  });

  it("완결 월은 전체 월 비교 — partialDay null, 라벨에 동기 없음", () => {
    const r = buildMonthlyReview({ ledger, month: "2026-07", todayIso: TODAY, fxRate: null });
    expect(r.partialDay).toBeNull();
    expect(r.compareLabel.prevMonth).toBe("전월");
    expect(r.numbers.expense).toBe(600_000);
    expect(r.headline).toContain("2026년 7월 ·");
    expect(r.headline).not.toContain("동기");
    const zero = r.wins.find((w) => w.kind === "zero-days");
    expect(zero?.text).toContain("무지출일 29일 / 31일");
  });

  it("무지출일 전월 비교 — 전월 같은 기간(1~N일)의 무지출일과 차이를 붙인다", () => {
    const r = buildMonthlyReview({
      ledger: [...ledger, entry({ date: "2026-07-15", amount: 1_000 }), entry({ date: "2026-07-16", amount: 1_000 })],
      month: "2026-08", todayIso: TODAY, fxRate: null
    });
    expect(r.wins.find((w) => w.kind === "zero-days")?.text).toBe("무지출일 20일 / 21일 (전월 동기(1~21일) 18일 → +2일)");
  });
});

describe("buildMonthlyReview — 빈 데이터", () => {
  it("기록이 없으면 hasData=false, 모든 수치 0, wins/warnings 비어 있음", () => {
    const r = buildMonthlyReview({ ledger: [], month: "2026-06", todayIso: TODAY, fxRate: null, budgetGoals: [{ id: "b1", category: "식비", monthlyLimit: 100_000 }] });
    expect(r.hasData).toBe(false);
    expect(r.headline).toBe("2026년 6월 기록이 없습니다.");
    expect(r.numbers.income).toBe(0);
    expect(r.numbers.expense).toBe(0);
    expect(r.numbers.realSavingsRate).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(r.topExpenses).toEqual([]);
    // 예산은 '지킴'으로 잡히지만(0원 사용) 무지출일은 데이터 없는 달에 만들지 않는다
    expect(r.wins.find((w) => w.kind === "zero-days")).toBeUndefined();
    const md = buildMonthlyReviewMarkdown(r, "2026-08-21 10:00");
    expect(md).toContain("# 2026-06 월간 리뷰");
    expect(md).not.toContain("## 숫자 한 장");
  });

  it("다른 달에만 기록이 있어도 대상 월은 빈 달로 본다", () => {
    const r = buildMonthlyReview({ ledger: [entry({ date: "2026-05-10", amount: 10_000 })], month: "2026-06", todayIso: TODAY, fxRate: null });
    expect(r.hasData).toBe(false);
    expect(r.numbers.vsPrevMonth.expense.base).toBe(10_000);
  });
});

describe("buildMonthlyReview — USD 환산", () => {
  it("USD 지출은 환율로 원화 환산해 합산·TOP·증감 TOP에 반영한다", () => {
    const ledger = [
      entry({ date: "2026-04-10", amount: 100_000 }),
      entry({ date: "2026-05-10", amount: 100_000 }),
      entry({ date: "2026-06-10", amount: 100_000 }),
      entry({ date: "2026-07-10", amount: 100, currency: "USD" }) // 1400원 → 140,000원 = +40%
    ];
    const r = buildMonthlyReview({ ledger, month: "2026-07", todayIso: TODAY, fxRate: 1400 });
    expect(r.numbers.expense).toBe(140_000);
    expect(r.topExpenses[0]).toEqual({ category: "식비", amount: 140_000, share: 100 });
    const g = r.warnings.find((w) => w.kind === "growth-top");
    expect(g?.text).toContain("140,000원");
    expect(g?.text).toContain("+40.0%");
  });

  it("환율 미로드(null)면 액면 그대로 — 대시보드 공통 정책", () => {
    const ledger = [entry({ date: "2026-07-10", amount: 100, currency: "USD" })];
    const r = buildMonthlyReview({ ledger, month: "2026-07", todayIso: TODAY, fxRate: null });
    expect(r.numbers.expense).toBe(100);
  });
});

describe("buildMonthlyReview — wins/warnings", () => {
  const goal = (o: Partial<BudgetGoal> & { category: string; monthlyLimit: number }): BudgetGoal => ({ id: `g-${o.category}`, ...o });

  it("완결 월: 예산 이내면 지킴(win), 초과면 warning", () => {
    const ledger = [
      entry({ date: "2026-07-05", amount: 300_000 }),
      entry({ date: "2026-07-06", amount: 80_000, subCategory: "교통" })
    ];
    const r = buildMonthlyReview({
      ledger, month: "2026-07", todayIso: TODAY, fxRate: null,
      budgetGoals: [goal({ category: "식비", monthlyLimit: 500_000 }), goal({ category: "교통", monthlyLimit: 50_000 })]
    });
    expect(r.wins.find((w) => w.kind === "budget-kept")?.text).toContain("식비 예산 지킴 — 300,000원 / 500,000원 (60%)");
    expect(r.warnings.find((w) => w.kind === "budget-over")?.text).toContain("교통 예산 초과 — 80,000원 / 50,000원 (160%)");
  });

  it("진행 중인 달: 경과 비율 이하 사용이면 페이스 양호, 초과면 'N일 만에' 경고", () => {
    const ledger = [
      entry({ date: "2026-08-05", amount: 100_000 }), // 식비 20% vs 경과 68%
      entry({ date: "2026-08-06", amount: 90_000, subCategory: "교통" })
    ];
    const r = buildMonthlyReview({
      ledger, month: "2026-08", todayIso: TODAY, fxRate: null,
      budgetGoals: [goal({ category: "식비", monthlyLimit: 500_000 }), goal({ category: "교통", monthlyLimit: 50_000 })]
    });
    expect(r.wins.find((w) => w.kind === "budget-pace")?.text).toContain("식비 예산 페이스 양호 — 사용 20% (경과 68%)");
    expect(r.warnings.find((w) => w.kind === "budget-over")?.text).toContain("21일 만에");
    expect(r.wins.find((w) => w.kind === "budget-kept")).toBeUndefined();
  });

  it("실질 저축률 상승은 win, 하락은 warning (전월 대비 %p)", () => {
    const base = [income("2026-06-01", 1_000_000), income("2026-07-01", 1_000_000)];
    const up = buildMonthlyReview({
      ledger: [...base, entry({ date: "2026-06-10", amount: 500_000 }), entry({ date: "2026-07-10", amount: 300_000 })],
      month: "2026-07", todayIso: TODAY, fxRate: null
    });
    expect(up.numbers.realSavingsRate).toBeCloseTo(70);
    expect(up.numbers.prevRealSavingsRate).toBeCloseTo(50);
    expect(up.wins.find((w) => w.kind === "savings-rate-up")?.text).toContain("+20.0%p");
    const down = buildMonthlyReview({
      ledger: [...base, entry({ date: "2026-06-10", amount: 300_000 }), entry({ date: "2026-07-10", amount: 500_000 })],
      month: "2026-07", todayIso: TODAY, fxRate: null
    });
    expect(down.warnings.find((w) => w.kind === "savings-rate-down")?.text).toContain("-20.0%p");
  });

  it("카테고리 감소 TOP은 win, 이상치(z)는 warning — 성장 TOP와 같은 카테고리는 중복 생략", () => {
    const ledger: LedgerEntry[] = [];
    // 교통: 6개월 100k → 이번 달 20k (감소 -80%)
    // 식비: 6개월 100k 안정 → 이번 달 400k (z 매우 큼 + 성장 +300% → growth-top 1건만)
    for (let i = 1; i <= 6; i++) {
      const mm = `2026-${String(i).padStart(2, "0")}`;
      ledger.push(entry({ date: `${mm}-10`, amount: 100_000, subCategory: "교통" }));
      ledger.push(entry({ date: `${mm}-11`, amount: 100_000 + i * 1000, subCategory: "식비" }));
    }
    ledger.push(entry({ date: "2026-07-10", amount: 20_000, subCategory: "교통" }));
    ledger.push(entry({ date: "2026-07-11", amount: 400_000, subCategory: "식비" }));
    const r = buildMonthlyReview({ ledger, month: "2026-07", todayIso: TODAY, fxRate: null });
    expect(r.wins.find((w) => w.kind === "decrease-top")?.text).toContain("교통 지출 감소 — 20,000원");
    expect(r.warnings.find((w) => w.kind === "growth-top")?.text).toContain("식비 지출 증가 — 400,000원");
    expect(r.warnings.filter((w) => w.kind === "anomaly")).toEqual([]);
    expect(r.topExpenses.map((t) => t.category)).toEqual(["식비", "교통"]);
  });

  it("구독비가 최근 3개월 평균 대비 20% 이상 늘면 warning — 등록된 구독 반복지출 제목도 구독으로 본다", () => {
    const recurring: RecurringExpense[] = [{ id: "rc1", title: "넷플릭스 구독", amount: 15_000, category: "문화", frequency: "monthly", startDate: "2026-01-01" }];
    const ledger = [
      entry({ date: "2026-04-03", amount: 10_000, subCategory: "문화", description: "넷플릭스 구독" }),
      entry({ date: "2026-05-03", amount: 10_000, subCategory: "문화", description: "넷플릭스 구독" }),
      entry({ date: "2026-06-03", amount: 10_000, subCategory: "문화", description: "넷플릭스 구독" }),
      entry({ date: "2026-07-03", amount: 15_000, subCategory: "문화", description: "넷플릭스 구독" })
    ];
    const r = buildMonthlyReview({ ledger, month: "2026-07", todayIso: TODAY, fxRate: null, recurring });
    expect(r.warnings.find((w) => w.kind === "subscription-spike")?.text).toContain("구독비 급증 — 15,000원");
    // recurring 없이 description만으로는 구독으로 보지 않음 (문자열 '구독' 규칙은 카테고리 기준)
    const r2 = buildMonthlyReview({ ledger, month: "2026-07", todayIso: TODAY, fxRate: null });
    expect(r2.warnings.find((w) => w.kind === "subscription-spike")).toBeUndefined();
  });
});

describe("buildMonthlyReviewMarkdown", () => {
  it("진행 중인 달은 동기 안내를 포함하고 표·잘한 점·주의·지출 TOP을 담는다", () => {
    const ledger = [income("2026-08-01", 1_000_000), entry({ date: "2026-08-10", amount: 120_000 }), entry({ date: "2026-07-10", amount: 100_000 })];
    const r = buildMonthlyReview({ ledger, month: "2026-08", todayIso: TODAY, fxRate: null });
    const md = buildMonthlyReviewMarkdown(r, "2026-08-21 10:00");
    expect(md).toContain("1~21일 동기 기준");
    expect(md).toContain("| 구분 | 이번 달 | 전월 동기(1~21일) 대비 | 전년 동월 동기(1~21일) 대비 |");
    expect(md).toContain("| 지출 | 120,000원 | +20,000원 (+20.0%) |");
    expect(md).toContain("## 잘한 점");
    expect(md).toContain("## 주의");
    expect(md).toContain("| 식비 | 120,000원 | 100.0% |");
    expect(md).toContain("## 한 줄 회고");
  });
});
