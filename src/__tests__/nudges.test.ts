/** 3-11 — 알림 센터/넛지 엔진 (utils/nudges.buildNudges) 순수 규칙 검증 */
import { describe, expect, it } from "vitest";
import { buildNudges, type NudgeContext } from "../utils/nudges";
import type { Account, BudgetGoal, LedgerEntry, Loan, RecurringExpense } from "../types";
import { BUDGET_ALL_CATEGORY } from "../types";

const baseCtx: NudgeContext = {
  today: "2026-07-15",
  ledger: [],
  recurringExpenses: [],
  budgetGoals: []
};

const ledgerEntry = (over: Partial<LedgerEntry> & { id: string; date: string }): LedgerEntry =>
  ({ kind: "expense", category: "지출", subCategory: "식비", description: "", amount: 10_000, ...over } as LedgerEntry);

const recurring = (over: Partial<RecurringExpense> & { id: string }): RecurringExpense => ({
  title: over.title ?? "월세",
  amount: over.amount ?? 500_000,
  category: over.category ?? "주거",
  frequency: over.frequency ?? "monthly",
  startDate: over.startDate ?? "2026-01-10",
  ...over
});

const goal = (over: Partial<BudgetGoal> & { id: string; category: string }): BudgetGoal => ({
  monthlyLimit: 300_000,
  ...over
});

const loan = (over: Partial<Loan> & { id: string }): Loan => ({
  institution: "은행",
  loanName: "주담대",
  loanAmount: 100_000_000,
  annualInterestRate: 3,
  repaymentMethod: "equal_payment",
  loanDate: "2020-01-01",
  maturityDate: "2030-01-01",
  ...over
});

describe("buildNudges — 반복지출 미등록", () => {
  it("마감일이 지났고 아직 기록 안 됐으면 critical 넛지", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-10",
      recurringExpenses: [recurring({ id: "r1", startDate: "2026-01-10" })]
    };
    const out = buildNudges(ctx);
    const n = out.find((x) => x.dedupeKey.startsWith("recurring:r1"));
    expect(n).toBeDefined();
    expect(n?.severity).toBe("critical");
    expect(n?.tab).toBe("budget");
  });

  it("이미 가계부에 기록됐으면 넛지가 없다", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-10",
      recurringExpenses: [recurring({ id: "r1", startDate: "2026-01-10", category: "주거", title: "월세", amount: 500_000 })],
      ledger: [
        ledgerEntry({ id: "l1", date: "2026-07-10", kind: "expense", category: "지출", subCategory: "주거", amount: 500_000 })
      ]
    };
    const out = buildNudges(ctx);
    expect(out.some((x) => x.dedupeKey.startsWith("recurring:"))).toBe(false);
  });

  it("아직 마감일이 안 왔으면(미래) 넛지가 없다", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-05",
      recurringExpenses: [recurring({ id: "r1", startDate: "2026-01-10" })] // 다음 마감 7/10, 아직 미래
    };
    const out = buildNudges(ctx);
    expect(out.some((x) => x.dedupeKey.startsWith("recurring:"))).toBe(false);
  });
});

describe("buildNudges — 예산 페이스", () => {
  it("이 페이스면 초과(over-pace)면 warn 넛지", () => {
    const ledger: LedgerEntry[] = [];
    // 7/1~7/5 동안 하루 5만원씩 지출 → 월말 예상이 한도(30만)를 크게 넘음
    for (let d = 1; d <= 5; d++) {
      ledger.push(
        ledgerEntry({ id: `e${d}`, date: `2026-07-0${d}`, kind: "expense", category: "지출", subCategory: "식비", amount: 50_000 })
      );
    }
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-05", ledger, budgetGoals: [goal({ id: "g1", category: "식비", monthlyLimit: 300_000 })] };
    const out = buildNudges(ctx);
    const n = out.find((x) => x.dedupeKey.startsWith("budget:g1"));
    expect(n).toBeDefined();
    expect(["warn", "critical"]).toContain(n?.severity);
  });

  it("한도 내 지출이면 넛지가 없다", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-05",
      ledger: [ledgerEntry({ id: "e1", date: "2026-07-01", kind: "expense", category: "지출", subCategory: "식비", amount: 10_000 })],
      budgetGoals: [goal({ id: "g1", category: "식비", monthlyLimit: 3_000_000 })]
    };
    const out = buildNudges(ctx);
    expect(out.some((x) => x.dedupeKey.startsWith("budget:"))).toBe(false);
  });

  it("한도 미설정(0)이면 넛지가 없다 — 'ok' 상태로 스킵", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-05",
      budgetGoals: [goal({ id: "g1", category: BUDGET_ALL_CATEGORY, monthlyLimit: 0 })]
    };
    const out = buildNudges(ctx);
    expect(out.some((x) => x.dedupeKey.startsWith("budget:"))).toBe(false);
  });
});

describe("buildNudges — 종합과세", () => {
  const div = (id: string, date: string, amount: number): LedgerEntry =>
    ({ id, date, kind: "income", category: "배당", description: "d", amount } as LedgerEntry);

  it("임계 80% 미만이면 넛지 없음", () => {
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-01", ledger: [div("d1", "2026-03-01", 10_000_000)] };
    expect(buildNudges(ctx).some((x) => x.dedupeKey.startsWith("tax:"))).toBe(false);
  });

  it("임계 80~90%면 warn, 90%+면 critical", () => {
    const warnCtx: NudgeContext = { ...baseCtx, today: "2026-07-01", ledger: [div("d1", "2026-03-01", 17_000_000)] };
    const warn = buildNudges(warnCtx).find((x) => x.dedupeKey.startsWith("tax:"));
    expect(warn?.severity).toBe("warn");

    const critCtx: NudgeContext = { ...baseCtx, today: "2026-07-01", ledger: [div("d1", "2026-03-01", 19_000_000)] };
    const crit = buildNudges(critCtx).find((x) => x.dedupeKey.startsWith("tax:"));
    expect(crit?.severity).toBe("critical");
  });

  it("절세계좌(excludeAccountIds)로 받은 배당은 임계 합산에서 빠진다 (accounts 통해 반영)", () => {
    const accounts: Account[] = [
      { id: "isa1", name: "ISA", institution: "증권사", type: "securities", initialBalance: 0, taxShelter: "isa" }
    ];
    const withShelter: LedgerEntry = { ...div("d2", "2026-03-01", 19_000_000), toAccountId: "isa1" } as LedgerEntry;
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-01", ledger: [withShelter], accounts };
    expect(buildNudges(ctx).some((x) => x.dedupeKey.startsWith("tax:"))).toBe(false);
  });
});

describe("buildNudges — 다가오는 배당(선행배당)", () => {
  it("다음 달 예상 배당이 있으면 info 넛지", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-15",
      ledger: [
        { id: "d1", date: "2025-08-15", kind: "income", category: "배당", description: "AAPL 배당", amount: 100_000 } as LedgerEntry
      ]
    };
    const out = buildNudges(ctx);
    const n = out.find((x) => x.dedupeKey.startsWith("dividend-forward:"));
    expect(n).toBeDefined();
    expect(n?.severity).toBe("info");
  });

  it("예상 배당이 없으면 넛지 없음", () => {
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-15" };
    expect(buildNudges(ctx).some((x) => x.dedupeKey.startsWith("dividend-forward:"))).toBe(false);
  });
});

describe("buildNudges — 환율 밴드", () => {
  it("이력이 없으면 넛지 없음(coverage 부족)", () => {
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-15", fxRate: 1400 };
    expect(buildNudges(ctx).some((x) => x.dedupeKey === "fxband")).toBe(false);
  });

  it("현재 환율이 최근 1년 분포 극단(저점)이면 info 넛지", () => {
    const historicalDailyFx = [] as { date: string; rate: number }[];
    // 최근 1년 대부분을 1400원대로 채워 현재(1100) 가 하위 극단이 되게 함
    const d = new Date("2025-07-16");
    const end = new Date("2026-07-14");
    while (d <= end) {
      const iso = d.toISOString().slice(0, 10);
      historicalDailyFx.push({ date: iso, rate: 1400 });
      d.setDate(d.getDate() + 1);
    }
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-15", fxRate: 1100, historicalDailyFx };
    const out = buildNudges(ctx);
    const n = out.find((x) => x.dedupeKey === "fxband");
    expect(n).toBeDefined();
    expect(n?.severity).toBe("info");
    expect(n?.title).toContain("저점");
  });
});

describe("buildNudges — 대출 만기 D-3", () => {
  it("만기가 3일 이내면 warn 넛지", () => {
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-15", loans: [loan({ id: "loan1", maturityDate: "2026-07-17" })] };
    const n = buildNudges(ctx).find((x) => x.dedupeKey === "loan:loan1:maturity");
    expect(n).toBeDefined();
    expect(n?.severity).toBe("warn");
  });

  it("만기가 4일 이상 남았으면 넛지 없음", () => {
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-15", loans: [loan({ id: "loan1", maturityDate: "2026-07-20" })] };
    expect(buildNudges(ctx).some((x) => x.dedupeKey === "loan:loan1:maturity")).toBe(false);
  });

  it("이미 만기가 지났으면 넛지 없음", () => {
    const ctx: NudgeContext = { ...baseCtx, today: "2026-07-15", loans: [loan({ id: "loan1", maturityDate: "2026-07-10" })] };
    expect(buildNudges(ctx).some((x) => x.dedupeKey === "loan:loan1:maturity")).toBe(false);
  });
});

describe("buildNudges — 백업 경과", () => {
  it("latestBackupAt 미주입(undefined)이면 판단 보류 — 넛지 없음", () => {
    const ctx: NudgeContext = { ...baseCtx };
    expect(buildNudges(ctx).some((x) => x.dedupeKey === "backup-stale")).toBe(false);
  });

  it("백업이 없으면(null) warn 넛지", () => {
    const ctx: NudgeContext = { ...baseCtx, latestBackupAt: null };
    const n = buildNudges(ctx).find((x) => x.dedupeKey === "backup-stale");
    expect(n).toBeDefined();
    expect(n?.severity).toBe("warn");
  });

  it("24시간 이상 지났으면 warn 넛지", () => {
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    const ctx: NudgeContext = { ...baseCtx, latestBackupAt: old };
    expect(buildNudges(ctx).some((x) => x.dedupeKey === "backup-stale")).toBe(true);
  });

  it("24시간 이내면 넛지 없음", () => {
    const recent = new Date(Date.now() - 1 * 3_600_000).toISOString();
    const ctx: NudgeContext = { ...baseCtx, latestBackupAt: recent };
    expect(buildNudges(ctx).some((x) => x.dedupeKey === "backup-stale")).toBe(false);
  });
});

describe("buildNudges — 저장공간 사용률", () => {
  it("80% 미만이면 넛지 없음", () => {
    const ctx: NudgeContext = { ...baseCtx, storageRatio: 0.5 };
    expect(buildNudges(ctx).some((x) => x.dedupeKey === "storage-usage")).toBe(false);
  });

  it("80% 이상이면 warn, 95% 이상이면 critical", () => {
    const warn = buildNudges({ ...baseCtx, storageRatio: 0.85 }).find((x) => x.dedupeKey === "storage-usage");
    expect(warn?.severity).toBe("warn");
    const crit = buildNudges({ ...baseCtx, storageRatio: 0.97 }).find((x) => x.dedupeKey === "storage-usage");
    expect(crit?.severity).toBe("critical");
  });
});

describe("buildNudges — 마이그레이션 리포트", () => {
  it("변경 없는 리포트는 넛지 없음", () => {
    const ctx: NudgeContext = { ...baseCtx, lastMigrationReport: { at: "2026-07-01T00:00:00.000Z", toVersion: 12, hasChanges: false } };
    expect(buildNudges(ctx).some((x) => x.dedupeKey.startsWith("migration:"))).toBe(false);
  });

  it("변경 있는 리포트는 info 넛지", () => {
    const ctx: NudgeContext = { ...baseCtx, lastMigrationReport: { at: "2026-07-01T00:00:00.000Z", toVersion: 12, hasChanges: true } };
    const n = buildNudges(ctx).find((x) => x.dedupeKey.startsWith("migration:"));
    expect(n).toBeDefined();
    expect(n?.severity).toBe("info");
  });
});

describe("buildNudges — 규칙 격리·정렬", () => {
  it("severity 순서(critical→warn→info)로 정렬된다", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-15",
      storageRatio: 0.97, // critical
      latestBackupAt: null, // warn
      lastMigrationReport: { at: "2026-07-01T00:00:00.000Z", toVersion: 12, hasChanges: true } // info
    };
    const out = buildNudges(ctx);
    const severities = out.map((n) => n.severity);
    const firstWarnIdx = severities.indexOf("warn");
    const firstInfoIdx = severities.indexOf("info");
    const lastCriticalIdx = severities.lastIndexOf("critical");
    if (firstWarnIdx !== -1 && lastCriticalIdx !== -1) expect(lastCriticalIdx).toBeLessThan(firstWarnIdx);
    if (firstInfoIdx !== -1 && firstWarnIdx !== -1) expect(firstWarnIdx).toBeLessThan(firstInfoIdx);
  });

  it("한 규칙이 예외를 던져도(손상된 loans 항목) 다른 규칙은 계속 평가된다", () => {
    const ctx: NudgeContext = {
      ...baseCtx,
      today: "2026-07-15",
      loans: [{ maturityDate: null } as unknown as Loan], // 손상 데이터 — diffDays가 처리 못해도 throw 없이 스킵
      storageRatio: 0.97
    };
    const out = buildNudges(ctx);
    expect(out.some((x) => x.dedupeKey === "storage-usage")).toBe(true);
  });
});
