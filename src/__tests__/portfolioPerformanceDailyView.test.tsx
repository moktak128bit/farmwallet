// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getEmptyData } from "../services/dataService";
import { useAppStore } from "../store/appStore";

const refresh = vi.fn();
vi.mock("../hooks/usePortfolioHistoryBackfill", () => ({ usePortfolioHistoryBackfill: () => ({ loading: false, completed: 0, total: 0, failed: 0, fxFailed: false, refresh }) }));
vi.mock("../context/FxRateContext", () => ({ useFxRateValue: () => 1300 }));
vi.mock("../utils/date", async original => ({ ...await original<typeof import("../utils/date")>(), getTodayKST: () => "2026-10-21" }));
vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  XAxis: ({ tickFormatter }: { tickFormatter: (date: string) => string }) => <span>{tickFormatter("2026-10-20")}</span>,
  ReferenceLine: ({ y }: { y: number }) => <span>기준값 {y}</span>,
  Line: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null, CartesianGrid: () => null,
}));
import { PortfolioPerformanceSection } from "../features/stocks/PortfolioPerformanceSection";

beforeEach(() => {
  refresh.mockReset();
  useAppStore.setState({ data: { ...getEmptyData(), trades: [{
    id: "t1", accountId: "a", ticker: "005930", name: "종목", date: "2026-10-19", side: "buy", quantity: 1, price: 1000, fee: 0, totalAmount: 1000, cashImpact: -1000,
  }], accounts: [{ id: "a", name: "증권", type: "securities", institution: "", initialBalance: 0 }],
  historicalDailyCloses: [{ ticker: "005930", date: "2026-10-19", close: 1000 }, { ticker: "005930", date: "2026-10-20", close: 1100 }],
  benchmarkDailyCloses: [{ ticker: "^KS11", date: "2026-10-19", close: 2000 }, { ticker: "^KS11", date: "2026-10-20", close: 2010 }],
  } });
});
afterEach(cleanup);

it("일자·1개월 보기·100 기준선과 실제 기록일 수를 보여주며 수동 일별 갱신을 제공한다", () => {
  render(<PortfolioPerformanceSection />);
  expect(screen.getByText("26.10.20")).toBeInTheDocument();
  expect(screen.getByText("기준값 100")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "1개월" })).toBeInTheDocument();
  expect(screen.getByText(/선택 기간에 종가가 기록된 날짜 2일/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "일별 시세 갱신" }));
  expect(refresh).toHaveBeenCalledWith(true);
});
