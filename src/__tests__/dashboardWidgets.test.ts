// @vitest-environment jsdom
/**
 * 대시보드 위젯 숨김 설정(dashboardWidgets) 테스트 —
 * 저장/로드 왕복, 알 수 없는 ID 필터링, 손상 데이터 폴백.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../constants/config";
import {
  DASHBOARD_WIDGETS,
  isDashboardWidgetVisible,
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

  describe("isDashboardWidgetVisible (4-2 seasonalOnly)", () => {
    it("일반 위젯은 저장 없으면 표시, 숨김 집합에 있으면 숨김 (기존 동작 그대로)", () => {
      expect(isDashboardWidgetVisible("budgetAlert", new Set(), "2026-03-01")).toBe(true);
      expect(isDashboardWidgetVisible("budgetAlert", new Set(["budgetAlert"]), "2026-03-01")).toBe(false);
    });

    it("taxActions는 계절(10~12월) 밖엔 기본 숨김", () => {
      expect(isDashboardWidgetVisible("taxActions", new Set(), "2026-03-01")).toBe(false);
      expect(isDashboardWidgetVisible("taxActions", new Set(), "2026-09-30")).toBe(false);
    });

    it("taxActions는 10~12월엔 기본 표시", () => {
      expect(isDashboardWidgetVisible("taxActions", new Set(), "2026-10-01")).toBe(true);
      expect(isDashboardWidgetVisible("taxActions", new Set(), "2026-12-31")).toBe(true);
    });

    it("taxActions — 비계절에 설정에서 켜면(뒤집힘) 표시된다", () => {
      expect(isDashboardWidgetVisible("taxActions", new Set(["taxActions"]), "2026-03-01")).toBe(true);
    });

    it("taxActions — 계절에 설정에서 끄면(뒤집힘) 숨겨진다", () => {
      expect(isDashboardWidgetVisible("taxActions", new Set(["taxActions"]), "2026-11-01")).toBe(false);
    });
  });
});
