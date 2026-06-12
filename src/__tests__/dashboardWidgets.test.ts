/**
 * 대시보드 위젯 숨김 설정(dashboardWidgets) 테스트 —
 * 저장/로드 왕복, 알 수 없는 ID 필터링, 손상 데이터 폴백.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../constants/config";
import {
  DASHBOARD_WIDGETS,
  loadHiddenDashboardWidgets,
  saveHiddenDashboardWidgets,
} from "../features/dashboard/dashboardWidgets";

describe("dashboardWidgets", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEYS.DASHBOARD_HIDDEN_WIDGETS);
  });

  it("위젯 ID는 중복 없이 정의된다", () => {
    const ids = DASHBOARD_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("저장 없으면 빈 집합(전부 표시)", () => {
    expect(loadHiddenDashboardWidgets().size).toBe(0);
  });

  it("save → load 왕복", () => {
    saveHiddenDashboardWidgets(new Set(["salaryTimer", "budgetAlert"]));
    const loaded = loadHiddenDashboardWidgets();
    expect(loaded.has("salaryTimer")).toBe(true);
    expect(loaded.has("budgetAlert")).toBe(true);
    expect(loaded.size).toBe(2);
  });

  it("알 수 없는 ID(제거된 위젯·구버전 키 값)는 로드 시 걸러진다", () => {
    window.localStorage.setItem(
      STORAGE_KEYS.DASHBOARD_HIDDEN_WIDGETS,
      JSON.stringify(["salaryTimer", "ghostWidget", 42])
    );
    const loaded = loadHiddenDashboardWidgets();
    expect(Array.from(loaded)).toEqual(["salaryTimer"]);
  });

  it("손상된 JSON이면 빈 집합으로 폴백", () => {
    window.localStorage.setItem(STORAGE_KEYS.DASHBOARD_HIDDEN_WIDGETS, "{broken");
    expect(loadHiddenDashboardWidgets().size).toBe(0);
  });
});
