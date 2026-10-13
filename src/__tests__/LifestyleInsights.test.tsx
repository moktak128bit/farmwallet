// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CategoryPresets, LedgerEntry } from "../types";
import { LifestyleInsights } from "../features/insights/LifestyleInsights";
import { STORAGE_KEYS } from "../constants/config";
import { exportLedgerCsv } from "../utils/csvExport";

vi.mock("../utils/date", async importOriginal => ({ ...await importOriginal<typeof import("../utils/date")>(), getTodayKST: () => "2026-10-13" }));
vi.mock("../utils/csvExport", () => ({ exportLedgerCsv: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
const entry = (id: string, date: string, amount: number, overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, date, amount, kind: "expense", category: "지출", subCategory: "유류교통비", description: "주유", ...overrides,
});
const ledger = ["2026-07", "2026-08", "2026-09"].flatMap(month => [
  entry(`${month}-salary`, `${month}-25`, 3_000_000, { kind: "income", category: "수입", subCategory: "급여", description: "월급" }),
  entry(`${month}-gas`, `${month}-05`, 100_000),
  entry(`${month}-maintenance`, `${month}-05`, 50_000, { detailCategory: "수리비", description: "자동차 수리" }),
  entry(`${month}-finance`, `${month}-05`, 300_000, { detailCategory: "자동차할부", description: "자동차할부" }),
  entry(`${month}-subscription`, `${month}-05`, 20_000, { subCategory: "구독비", detailCategory: "음악", description: "음악" }),
  entry(`${month}-food`, `${month}-05`, 500_000, { subCategory: "식비", description: "식사" }),
  entry(`${month}-taxi`, `${month}-05`, 40_000, { detailCategory: "택시", description: "택시" }),
]).concat([entry("curgas", "2026-10-05", 40_000), entry("curtaxi", "2026-10-05", 10_000, { detailCategory: "택시", description: "택시" })]);
const props = { ledger, accounts: [], categoryPresets: {} as CategoryPresets, fxRate: 1400, targetMonth: "2026-10",
  holdings: [{ name: "우주 ETF", valueKRW: 16_000_000, costKRW: 20_000_000 }] };
const commit = (label: string, value: string) => {
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.focus(input); fireEvent.change(input, { target: { value } }); fireEvent.blur(input);
};

describe("생활비·차량 시나리오 화면", () => {
  it("주유·차량·월 투자 계획과 모든 분류·시나리오를 렌더링한다", () => {
    render(<LifestyleInsights {...props} />);
    expect(screen.getByRole("region", { name: "월별 생활 분석과 시나리오" })).toBeInTheDocument();
    expect(screen.getByText("한 달 주유·충전비")).toBeInTheDocument();
    expect(screen.getByText(/차가 없었다면/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "월 투자 계획" })).toHaveValue("2000000");
    expect(screen.getByText(/투자 후 -10,000원/)).toBeInTheDocument();
    expect(screen.getByText(/8일간 새 기록이 없습니다/)).toBeInTheDocument();
    expect(screen.getAllByText(/기록 없음/)).toHaveLength(8);
  });
  it("대체 교통비를 입력해 시나리오를 계산하고 재방문에 복원한다", () => {
    const { unmount } = render(<LifestyleInsights {...props} />);
    expect(screen.getByText(/과거 기록과 대체 교통비가 있어야/)).toBeInTheDocument();
    commit("차 없이 쓸 대체 교통비", "50,000");
    commit("추정 감가상각 비용 (선택)", "150000");
    expect(screen.getByText("100,000원 / 월")).toBeInTheDocument();
    expect(screen.getByText("250,000원 / 월")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.LIFESTYLE_INSIGHTS)!)).toMatchObject({ replacementMonthly: 50_000, depreciationMonthly: 150_000 });
    unmount(); render(<LifestyleInsights {...props} />);
    expect(screen.getByRole("textbox", { name: "차 없이 쓸 대체 교통비" })).toHaveValue("50000");
  });
  it("0원 가정을 보존하며 음수·잘못된 감축률은 저장하지 않는다", () => {
    render(<LifestyleInsights {...props} />);
    commit("차 없이 쓸 대체 교통비", "0");
    expect(screen.getByText("150,000원 / 월")).toBeInTheDocument();
    commit("월 투자 계획", "-1000");
    expect(screen.getByRole("alert")).toHaveTextContent("0 이상의 숫자");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.LIFESTYLE_INSIGHTS)!).plannedInvestmentMonthly).toBe(2_000_000);
    commit("지출 감축률", "120");
    expect(screen.getByRole("alert")).toHaveTextContent("0~100%");
  });
  it("자동 차량 분류를 수정해 실제 원본 변경 없이 다시 계산한다", () => {
    const before = JSON.stringify(ledger);
    render(<LifestyleInsights {...props} />);
    fireEvent.change(screen.getByRole("combobox", { name: "차량 분류 curgas" }), { target: { value: "exclude" } });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.LIFESTYLE_INSIGHTS)!).vehicleOverrides.curgas).toBe("exclude");
    expect(screen.getByText("한 달 주유·충전비").closest("article")?.querySelector(".money")).toHaveTextContent("0원");
    expect(JSON.stringify(ledger)).toBe(before);
  });
  it("구독 정리와 카테고리 감축은 독립적인 가정으로 계산한다", () => {
    render(<LifestyleInsights {...props} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /음악 · 월평균/ }));
    expect(screen.getByText(/선택한 결제를 없앤 가정: 월 20,000원 · 연 240,000원/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "줄일 지출 분류" }), { target: { value: "식비" } });
    expect(screen.getByText("월 50,000원 · 연 환산 600,000원")).toBeInTheDocument();
    expect(screen.getByText(/다른 시나리오와 중복 합산하지 않습니다/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "감축 대상 범위" }), { target: { value: "detail" } });
    fireEvent.change(screen.getByRole("combobox", { name: "줄일 지출 분류" }), { target: { value: "식비 / 식사" } });
    commit("지출 감축률", "100");
    expect(screen.getByText("월 500,000원 · 연 환산 6,000,000원")).toBeInTheDocument();
  });
  it("거래 검색 결과만 CSV로 내보낸다", () => {
    render(<LifestyleInsights {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "생활 분석 거래 검색" }), { target: { value: "주유" } });
    fireEvent.click(screen.getByRole("button", { name: "표시된 거래 CSV 저장" }));
    expect(exportLedgerCsv).toHaveBeenCalledWith([ledger.find(row => row.id === "curgas")], [], "생활분석_2026-10.csv");
  });
  it("환율 미로드·기록 부재를 절약 0원이나 투자 가능 판정으로 바꾸지 않는다", () => {
    const { rerender } = render(<LifestyleInsights {...props} ledger={[]} holdings={[]} />);
    expect(screen.getByText("양수 평가액의 보유 종목이 없어 투자 집중도를 계산하지 않습니다.")).toBeInTheDocument();
    rerender(<LifestyleInsights {...props} ledger={[entry("usd", "2026-10-05", 10, { currency: "USD" })]} fxRate={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("환율이 없어");
    expect(screen.queryByText("한 달 주유·충전비")).not.toBeInTheDocument();
  });
});
