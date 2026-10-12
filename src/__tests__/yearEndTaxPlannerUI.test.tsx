// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { YearEndTaxPreviewSection } from "../features/reports/YearEndTaxPreviewSection";
import { STORAGE_KEYS } from "../constants/config";
import type { Account, LedgerEntry } from "../types";

vi.mock("../context/FxRateContext", () => ({ useFxRateValue: () => null }));
vi.mock("../store/appStore", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector({ data: { categoryPresets: {} } }),
}));
vi.mock("../utils/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/date")>()),
  getTodayKST: () => "2026-10-12",
}));

const accounts: Account[] = [{ id: "card", name: "신용", institution: "", type: "card", initialBalance: 0 }];
const ledger: LedgerEntry[] = [
  {
    id: "1",
    date: "2026-01-10",
    kind: "expense",
    category: "지출",
    subCategory: "식비",
    fromAccountId: "card",
    amount: 12_500_000,
    description: "",
  },
];
const mount = (year = 2026) => render(<YearEndTaxPreviewSection ledger={ledger} accounts={accounts} year={year} />);
const commit = (label: string, value: string) => {
  const field = screen.getByLabelText(label);
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("절세 가이드 화면과 연도별 설정", () => {
  it("총급여 입력 전에는 실수령액으로 실행 혜택을 추정하지 않는다", () => {
    mount();
    expect(screen.getByRole("region", { name: "올해 절세 실행 가이드" })).toBeInTheDocument();
    expect(screen.getByText("총급여 입력 필요")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /예정 지출/ })).not.toBeInTheDocument();
  });

  it("여유자금 0원 입력을 저장하고 재방문에도 유지", () => {
    localStorage.setItem(STORAGE_KEYS.YEAR_END_GROSS_SALARY, JSON.stringify({ "2026": 50_000_000 }));
    localStorage.setItem(
      STORAGE_KEYS.YEAR_END_TAX_PLANNER,
      JSON.stringify({ "2026": { paidPension: 3_000_000, pensionBudget: 2_000_000 } }),
    );
    const { unmount } = mount();
    expect(screen.getByText(/^추가 세액공제 가능액/)).toHaveTextContent(/330,000\s*원/);
    commit("연말까지 추가 납입할 여유자금 (원)", "0");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.YEAR_END_TAX_PLANNER)!)["2026"].pensionBudget).toBe(0);
    unmount();
    mount();
    expect(screen.getByLabelText("연말까지 추가 납입할 여유자금 (원)")).toHaveValue("0");
  });

  it("공제 사용액의 0원 덮어쓰기·빈칸 복원과 자녀 증액을 반영", () => {
    localStorage.setItem(STORAGE_KEYS.YEAR_END_GROSS_SALARY, JSON.stringify({ "2026": 50_000_000 }));
    mount();
    expect(screen.getByText(/공제 시작까지 남은 사용액/)).toHaveTextContent(/0\s*원/);
    commit("공제 대상 신용카드 사용액 (원)", "0");
    expect(screen.getByText(/공제 시작까지 남은 사용액/)).toHaveTextContent(/12,500,000\s*원/);
    commit("공제 대상 신용카드 사용액 (원)", "");
    expect(screen.getByText(/공제 시작까지 남은 사용액/)).toHaveTextContent(/0\s*원/);
    fireEvent.change(screen.getByLabelText("공제 요건을 충족한 자녀·손자녀 수"), { target: { value: "2" } });
    expect(screen.getByText(/현재 소득공제/)).toHaveTextContent(/4,000,000\s*원/);
  });

  it("연도 전환은 해당 연도의 설정만 읽고 다른 연도 설정을 보존", () => {
    localStorage.setItem(STORAGE_KEYS.YEAR_END_GROSS_SALARY, JSON.stringify({ "2026": 50_000_000 }));
    localStorage.setItem(
      STORAGE_KEYS.YEAR_END_TAX_PLANNER,
      JSON.stringify({ "2025": { pensionBudget: 123 }, "2026": { pensionBudget: 456 } }),
    );
    const view = mount();
    commit("연말까지 추가 납입할 여유자금 (원)", "789");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.YEAR_END_TAX_PLANNER)!)["2025"].pensionBudget).toBe(123);
    view.rerender(<YearEndTaxPreviewSection ledger={ledger} accounts={accounts} year={2025} />);
    expect(screen.queryByRole("region", { name: "올해 절세 실행 가이드" })).not.toBeInTheDocument();
    view.rerender(<YearEndTaxPreviewSection ledger={ledger} accounts={accounts} year={2026} />);
    expect(screen.getByLabelText("연말까지 추가 납입할 여유자금 (원)")).toHaveValue("789");
  });

  it("깨진 설정을 무시하고 기본 입력 화면을 연다", () => {
    localStorage.setItem(STORAGE_KEYS.YEAR_END_TAX_PLANNER, "broken-json");
    mount();
    expect(screen.getByLabelText("연말까지 추가 납입할 여유자금 (원)")).toHaveValue("");
  });
});
