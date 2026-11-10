// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import type { Account, LedgerEntry } from "../types";

/**
 * GAS 빌드(워커 없음) 무한 렌더 회귀 (2026-11-10):
 * usePortfolioWorker·useReportWorker의 동기 계산이 deps=[params](호출부가 매 렌더 새로 만드는 객체)라
 * 매 렌더 재계산 → effect setState → 다시 렌더… 대시보드가 10초에 2만 번 커밋했고, 가계부는 useDeferredValue가
 * 영영 못 따라와 인라인 편집이 화면에 안 보였다("GAS 가계부에서 수정이 안 된다").
 */

const accounts: Account[] = [{ id: "A", name: "통장", institution: "", type: "checking", initialBalance: 1000 } as Account];
const ledger: LedgerEntry[] = [
  { id: "L1", date: "2026-11-01", kind: "expense", category: "지출", subCategory: "식비", description: "점심", amount: 100, fromAccountId: "A" } as LedgerEntry,
];

// 앱처럼 배열은 저장소의 같은 참조 — 감싸는 params 객체만 매 렌더 새로 만든다
const noTrades: never[] = [];
const noPrices: never[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GAS 동기 계산 — 매 렌더 새 params 객체여도 루프 없음", () => {
  it("usePortfolioWorker", async () => {
    vi.stubEnv("VITE_GAS_BUILD", "1");
    const { usePortfolioWorker } = await import("../hooks/usePortfolioWorker");
    let renders = 0;
    let last: ReturnType<typeof usePortfolioWorker> | null = null;
    const seen = new Set<unknown>();
    function Probe() {
      renders++;
      // App처럼 매 렌더 객체 리터럴로 넘긴다
      last = usePortfolioWorker({ accounts, ledger, trades: noTrades, prices: noPrices, fxRate: 1400, needsBalances: true, needsPortfolioAggregation: false });
      seen.add(last);
      return null;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    rerender(<Probe />);
    expect(renders).toBeLessThanOrEqual(6); // StrictMode 없이 3회 렌더 + 여유
    expect(seen.size).toBe(1); // 입력이 같으면 같은 결과 객체(하위 memo가 흔들리지 않게)
    expect(last!.balances.find((b) => b.account.id === "A")?.currentBalance).toBe(900);
  });

  it("useReportWorker", async () => {
    vi.stubEnv("VITE_GAS_BUILD", "1");
    const { useReportWorker } = await import("../hooks/useReportWorker");
    let renders = 0;
    const seen = new Set<unknown>();
    function Probe() {
      renders++;
      seen.add(
        useReportWorker({
          accounts, ledger, trades: noTrades, prices: noPrices, startDate: "2026-11-01", endDate: "2026-11-30", fxRate: 1400,
          dateAccountId: null, nonRealIncomeOverride: undefined, fxHistory: undefined,
        } as Parameters<typeof useReportWorker>[0])
      );
      return null;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    rerender(<Probe />);
    expect(renders).toBeLessThanOrEqual(6);
    expect(seen.size).toBe(1);
  });
});
