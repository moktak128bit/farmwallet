import { describe, it, expect } from "vitest";
import {
  candidateToRecurringPrefill,
  detectRecurringCandidates,
  isCandidateRegistered,
} from "../utils/recurringDetection";
import type { LedgerEntry, RecurringExpense } from "../types";

const TODAY = "2026-08-20";

let seq = 0;
function entry(o: Partial<LedgerEntry> & { date: string; amount: number }): LedgerEntry {
  seq += 1;
  return {
    id: `L${seq}`,
    kind: "expense",
    category: "지출",
    subCategory: "구독비",
    description: "넷플릭스",
    fromAccountId: "card1",
    ...o,
  } as LedgerEntry;
}

/** 같은 설명·금액을 날짜 목록마다 생성 */
function series(dates: string[], amount: number, extra: Partial<LedgerEntry> = {}): LedgerEntry[] {
  return dates.map((date) => entry({ date, amount, ...extra }));
}

const MONTHLY_DATES = ["2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15"];

function rec(o: Partial<RecurringExpense> & { title: string }): RecurringExpense {
  return { id: "R1", amount: 0, category: "구독비", frequency: "monthly", startDate: "2026-01-01", ...o } as RecurringExpense;
}

describe("detectRecurringCandidates — 간격·주기", () => {
  it("매월 같은 날 ≥3회 같은 금액 → monthly 후보(활성)", () => {
    const ledger = series(MONTHLY_DATES, 17000);
    const [c, ...rest] = detectRecurringCandidates(ledger, [], TODAY);
    expect(rest).toHaveLength(0);
    expect(c).toBeDefined();
    expect(c.cadence).toBe("monthly");
    expect(c.occurrences).toBe(6);
    expect(c.intervalDays).toBeGreaterThanOrEqual(28);
    expect(c.intervalDays).toBeLessThanOrEqual(33);
    expect(c.amountMedian).toBe(17000);
    expect(c.status).toBe("active");
    expect(c.alreadyRegistered).toBe(false);
    expect(c.label).toBe("넷플릭스");
    expect(c.key).toBe("넷플릭스|card1");
  });

  it("2회뿐이면 후보 아님", () => {
    const ledger = series(["2026-07-15", "2026-08-15"], 17000);
    expect(detectRecurringCandidates(ledger, [], TODAY)).toHaveLength(0);
  });

  it("불규칙 간격(편의점·장보기형)은 제외", () => {
    const ledger = series(["2026-07-01", "2026-07-03", "2026-07-20", "2026-08-02", "2026-08-15"], 17000);
    expect(detectRecurringCandidates(ledger, [], TODAY)).toHaveLength(0);
  });

  it("매주 같은 요일·같은 금액 → weekly", () => {
    const ledger = series(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17"], 9900, { description: "주간 세차" });
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(c?.cadence).toBe("weekly");
    expect(c?.status).toBe("new"); // 첫 발생 ≤ 90일
  });

  it("매주 장보기 — 간격은 규칙적이지만 금액 ±10% 밖이면 오탐 방지로 제외", () => {
    const dates = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];
    const amounts = [52000, 81000, 36000, 64000, 47000, 93000];
    const ledger = dates.map((date, i) => entry({ date, amount: amounts[i], description: "이마트", subCategory: "식비" }));
    expect(detectRecurringCandidates(ledger, [], TODAY)).toHaveLength(0);
  });

  it("매년 같은 날 ≥3회 → yearly (lookback 확장)", () => {
    const ledger = series(["2023-09-01", "2024-09-01", "2025-09-01"], 129000, { description: "도메인 갱신" });
    const [c] = detectRecurringCandidates(ledger, [], TODAY, { lookbackMonths: 48 });
    expect(c?.cadence).toBe("yearly");
    expect(c?.status).toBe("active"); // 2025-09-01 이후 354일 < 400
  });

  it("lookback 밖의 발생은 집계하지 않는다", () => {
    const ledger = series(["2025-05-15", "2025-06-15", "2025-07-15"], 17000); // 12개월 밖 (기준 2025-08-20)
    expect(detectRecurringCandidates(ledger, [], TODAY, { lookbackMonths: 12 })).toHaveLength(0);
  });

  it("같은 날 이중 결제는 1회로 세고 간격 판정을 깨지 않는다", () => {
    const ledger = [...series(MONTHLY_DATES, 17000), entry({ date: "2026-06-15", amount: 17000 })];
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(c?.cadence).toBe("monthly");
    expect(c?.occurrences).toBe(6);
  });
});

describe("detectRecurringCandidates — 금액 드리프트·클러스터", () => {
  it("마지막 결제만 +30% → amountChanged, lastAmount=인상 후 금액", () => {
    const ledger = [...series(MONTHLY_DATES.slice(0, 5), 9900), entry({ date: "2026-08-15", amount: 12900 })];
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(c?.status).toBe("amountChanged");
    expect(c?.amountMedian).toBe(9900);
    expect(c?.lastAmount).toBe(12900);
    expect(Math.round(c!.amountDriftPct)).toBe(30);
    expect(c?.occurrences).toBe(6);
    expect(c?.lastSeen).toBe("2026-08-15");
  });

  it("±10% 안의 소폭 변동은 active 유지", () => {
    const amounts = [10000, 10500, 9800, 10200, 10900, 9600];
    const ledger = MONTHLY_DATES.map((date, i) => entry({ date, amount: amounts[i] }));
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(c?.status).toBe("active");
  });

  it("같은 상호의 멤버십(정기) + 일반 구매(불규칙)가 섞여도 멤버십 클러스터만 잡는다", () => {
    const membership = series(MONTHLY_DATES, 4990, { description: "쿠팡", subCategory: "구독비" });
    const purchases = [
      entry({ date: "2026-04-02", amount: 38000, description: "쿠팡", subCategory: "생활" }),
      entry({ date: "2026-04-20", amount: 12000, description: "쿠팡", subCategory: "생활" }),
      entry({ date: "2026-06-03", amount: 75000, description: "쿠팡", subCategory: "생활" }),
      entry({ date: "2026-08-01", amount: 22000, description: "쿠팡", subCategory: "생활" }),
    ];
    const out = detectRecurringCandidates([...membership, ...purchases], [], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].amountMedian).toBe(4990);
    expect(out[0].subCategory).toBe("구독비");
    expect(out[0].status).toBe("active");
    expect(out[0].entryIds).toHaveLength(6);
  });
});

describe("detectRecurringCandidates — 상태", () => {
  it("monthly 마지막 발생 후 45일 초과 → stopped", () => {
    const ledger = series(["2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15"], 17000); // 마지막 6/15, 오늘 8/20 = 66일
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(c?.status).toBe("stopped");
  });

  it("monthly 마지막 발생 후 45일 이내면 stopped 아님", () => {
    const ledger = series(["2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15"], 17000); // 36일
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(c?.status).toBe("active");
  });

  it("첫 발생 ≤90일 → new", () => {
    const ledger = series(["2026-06-10", "2026-07-10", "2026-08-10"], 17000);
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(c?.status).toBe("new");
    expect(c?.firstSeen).toBe("2026-06-10");
  });

  it("정렬: 신규 → 금액변경 → 해지 → 활성", () => {
    const ledger = [
      ...series(MONTHLY_DATES, 17000, { description: "활성A" }),
      ...series(["2026-06-10", "2026-07-10", "2026-08-10"], 5000, { description: "신규B" }),
      ...series(["2026-03-15", "2026-04-15", "2026-05-15"], 8000, { description: "해지C" }),
      ...series(MONTHLY_DATES.slice(0, 5), 9900, { description: "인상D" }),
      entry({ date: "2026-08-15", amount: 12900, description: "인상D" }),
    ];
    const out = detectRecurringCandidates(ledger, [], TODAY);
    expect(out.map((c) => c.status)).toEqual(["new", "amountChanged", "stopped", "active"]);
  });
});

describe("detectRecurringCandidates — 지출 판정·키", () => {
  it("이체·수입·신용결제(레거시)·환전은 후보가 아니다", () => {
    const ledger = [
      ...series(MONTHLY_DATES, 300000, { kind: "transfer", category: "이체", subCategory: "저축이체", description: "적금" }),
      ...series(MONTHLY_DATES, 3000000, { kind: "income", category: "수입", subCategory: "월급", description: "월급" }),
      ...series(MONTHLY_DATES, 500000, { category: "신용결제", subCategory: undefined, description: "카드값" }),
    ];
    expect(detectRecurringCandidates(ledger, [], TODAY)).toHaveLength(0);
  });

  it("설명이 비면 소분류로 식별하고, 둘 다 없으면 제외", () => {
    const byDetail = series(MONTHLY_DATES, 17000, { description: "", detailCategory: "넷플릭스" });
    const blank = series(MONTHLY_DATES, 5000, { description: "", detailCategory: undefined });
    const out = detectRecurringCandidates([...byDetail, ...blank], [], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("넷플릭스");
  });

  it("출금 계좌가 다르면 다른 키", () => {
    const a = series(MONTHLY_DATES, 17000, { fromAccountId: "card1" });
    const b = series(MONTHLY_DATES, 17000, { fromAccountId: "card2" });
    const out = detectRecurringCandidates([...a, ...b], [], TODAY);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((c) => c.key))).toEqual(new Set(["넷플릭스|card1", "넷플릭스|card2"]));
  });

  it("표기 차이(카드사 접두·지점)는 normalizeMerchant로 한 키에 모인다", () => {
    const dates = MONTHLY_DATES;
    const ledger = dates.map((date, i) =>
      entry({ date, amount: 4500, description: i % 2 === 0 ? "신한카드 스타벅스 강남점" : "스타벅스", subCategory: "식비" })
    );
    const out = detectRecurringCandidates(ledger, [], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].occurrences).toBe(6);
  });
});

describe("detectRecurringCandidates — USD", () => {
  it("USD 항목은 fxRate로 원화 환산해 중앙값·금액을 낸다", () => {
    const ledger = series(MONTHLY_DATES, 15, { description: "ChatGPT Plus", currency: "USD" });
    const [c] = detectRecurringCandidates(ledger, [], TODAY, { fxRate: 1400 });
    expect(c).toBeDefined();
    expect(c.currency).toBe("USD");
    expect(c.amountMedian).toBe(21000);
    expect(c.lastAmount).toBe(21000);
    expect(candidateToRecurringPrefill(c).amount).toBe(21000);
  });

  it("환율이 없으면 액면 그대로 비교하되 후보 자체는 유지된다", () => {
    const ledger = series(MONTHLY_DATES, 15, { description: "ChatGPT Plus", currency: "USD" });
    const [c] = detectRecurringCandidates(ledger, [], TODAY, { fxRate: null });
    expect(c?.amountMedian).toBe(15);
  });
});

describe("alreadyRegistered — 느슨 매칭", () => {
  it("제목 정규화 일치면 등록됨 (금액이 달라도)", () => {
    const ledger = series(MONTHLY_DATES, 17000);
    const [c] = detectRecurringCandidates(ledger, [rec({ title: "넷플릭스", amount: 13500 })], TODAY);
    expect(c?.alreadyRegistered).toBe(true);
  });

  it("제목이 설명에 포함되면 등록됨 (\"넷플릭스 프리미엄\" ↔ \"넷플릭스\")", () => {
    const ledger = series(MONTHLY_DATES, 17000, { description: "넷플릭스 프리미엄" });
    const [c] = detectRecurringCandidates(ledger, [rec({ title: "넷플릭스" })], TODAY);
    expect(c?.alreadyRegistered).toBe(true);
  });

  it("제목이 소분류와 일치하면 등록됨", () => {
    const ledger = series(MONTHLY_DATES, 17000, { description: "NFLX 결제", detailCategory: "넷플릭스" });
    const [c] = detectRecurringCandidates(ledger, [rec({ title: "넷플릭스" })], TODAY);
    expect(c?.alreadyRegistered).toBe(true);
  });

  it("다른 제목이면 미등록 — 카테고리(구독비)만 같아선 등록으로 치지 않는다", () => {
    const ledger = series(MONTHLY_DATES, 17000);
    const [c] = detectRecurringCandidates(ledger, [rec({ title: "유튜브 프리미엄", category: "구독비" })], TODAY);
    expect(c?.alreadyRegistered).toBe(false);
  });

  it("종료일이 지난 반복은 등록으로 치지 않는다", () => {
    const ledger = series(MONTHLY_DATES, 17000);
    const [c] = detectRecurringCandidates(ledger, [rec({ title: "넷플릭스", endDate: "2026-05-31" })], TODAY);
    expect(c?.alreadyRegistered).toBe(false);
  });

  it("isCandidateRegistered 단독: 빈 제목 반복은 무시", () => {
    expect(isCandidateRegistered({ key: "넷플릭스|c", label: "넷플릭스" }, [], [rec({ title: "  " })], TODAY)).toBe(false);
  });
});

describe("candidateToRecurringPrefill", () => {
  it("제목·마지막 금액·대표 분류·주기·마지막 발생일·출금계좌를 채운다 (생성은 하지 않음)", () => {
    const ledger = [...series(MONTHLY_DATES.slice(0, 5), 9900), entry({ date: "2026-08-15", amount: 12900 })];
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(candidateToRecurringPrefill(c)).toEqual({
      title: "넷플릭스",
      amount: 12900,
      category: "구독비",
      frequency: "monthly",
      startDate: "2026-08-15",
      fromAccountId: "card1",
    });
  });

  it("분류가 없으면 '구독비' 기본값", () => {
    const ledger = series(MONTHLY_DATES, 17000, { subCategory: undefined });
    const [c] = detectRecurringCandidates(ledger, [], TODAY);
    expect(candidateToRecurringPrefill(c).category).toBe("구독비");
  });
});
