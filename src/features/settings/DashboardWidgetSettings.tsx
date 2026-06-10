/**
 * 대시보드 위젯 설정 탭 — 위젯 표시/순서, 배당 추적 티커, ISA 목표 포트폴리오,
 * 자산 스냅샷·목표 자산 곡선 편집기. SettingsPage에서 분리.
 * 위젯 표시/순서 상태와 localStorage 디바운스 저장은 이 컴포넌트가 소유한다
 * (탭 전환 시 부모가 이 컴포넌트를 언마운트/재마운트하므로 마운트 시 재로드).
 * React.memo로 감싸므로 부모가 넘기는 콜백(onChangeData)은 참조가 안정적이어야 한다.
 */
import React, { useEffect, useRef, useState } from "react";
import type {
  AppData,
  AssetSnapshotAccountBreakdown,
  AssetSnapshotPoint
} from "../../types";
import { STORAGE_KEYS, ISA_PORTFOLIO } from "../../constants/config";

const WIDGET_ID_DIVIDEND_TRACKING = "dividendTracking";

function migrateWidgetId(id: string): string {
  return id === "458730" ? WIDGET_ID_DIVIDEND_TRACKING : id;
}

const DASHBOARD_WIDGET_ORDER = ["summary", "assets", "income", "savingsFlow", "budget", "stocks", "portfolio", "targetPortfolio", WIDGET_ID_DIVIDEND_TRACKING, "isa", "realReturn", "goalPlanner", "investCapacity", "tradeVsSpend", "dividendCoverage", "concentration"];

type SnapshotNumericField = Exclude<keyof Omit<AssetSnapshotPoint, "date">, "accountBreakdown">;

const SNAPSHOT_FIELD_BY_LABEL: Record<string, SnapshotNumericField> = {
  "적금": "installmentSavings",
  "예금": "termDeposit",
  "연금저축(원금)": "pensionPrincipal",
  "연금저축(평가금)": "pensionEvaluation",
  "투자(매수금)": "investmentBuyAmount",
  "투자(평가금)": "investmentEvaluationAmount",
  "가상자산": "cryptoAssets",
  "배당,이자(누적)": "dividendInterestCumulative",
  "총자산(매수금)": "totalAssetBuyAmount",
  "총자산(평가금)": "totalAssetEvaluationAmount",
  "투자성과": "investmentPerformance"
};

const SNAPSHOT_NUMERIC_FIELDS: SnapshotNumericField[] = [
  "installmentSavings",
  "termDeposit",
  "pensionPrincipal",
  "pensionEvaluation",
  "investmentBuyAmount",
  "investmentEvaluationAmount",
  "cryptoAssets",
  "dividendInterestCumulative",
  "totalAssetBuyAmount",
  "totalAssetEvaluationAmount",
  "investmentPerformance"
];

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return null;
    const normalized = trimmed.replace(/,/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSnapshotAccountBreakdown(raw: unknown): AssetSnapshotAccountBreakdown[] {
  if (!Array.isArray(raw)) return [];
  const rows: AssetSnapshotAccountBreakdown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const accountId = String(obj.accountId ?? "").trim();
    if (!accountId) continue;
    const accountName = String(obj.accountName ?? accountId).trim() || accountId;
    const buyAmount = parseNullableNumber(obj.buyAmount);
    const evaluationAmount = parseNullableNumber(obj.evaluationAmount);
    if (buyAmount == null || evaluationAmount == null) continue;
    rows.push({ accountId, accountName, buyAmount, evaluationAmount });
  }
  return rows;
}

function normalizeSnapshotLabel(label: string): string {
  return label.replace(/\s+/g, "");
}

function normalizeAssetSnapshots(input: unknown): AssetSnapshotPoint[] | null {
  if (!Array.isArray(input)) return null;
  const rows: AssetSnapshotPoint[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const date = String(obj.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const row: AssetSnapshotPoint = { date };
    SNAPSHOT_NUMERIC_FIELDS.forEach((field) => {
      row[field] = parseNullableNumber(obj[field]);
    });
    row.accountBreakdown = normalizeSnapshotAccountBreakdown(obj.accountBreakdown);
    rows.push(row);
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function splitTableLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((cell) => cell.trim());
  }
  return line.split(/\s{2,}/).map((cell) => cell.trim());
}

function parseAssetSnapshotTable(text: string): AssetSnapshotPoint[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;

  const header = splitTableLine(lines[0]);
  if (header.length < 2 || !header[0].includes("날짜")) return null;
  const dates = header.slice(1).map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0) return null;

  const rows: AssetSnapshotPoint[] = dates.map((date) => ({ date }));

  for (const line of lines.slice(1)) {
    const cells = splitTableLine(line);
    if (cells.length < 2) continue;
    const labelKey = normalizeSnapshotLabel(cells[0]);
    const field = SNAPSHOT_FIELD_BY_LABEL[labelKey];
    if (!field) continue;

    dates.forEach((_, index) => {
      const raw = cells[index + 1] ?? "";
      rows[index][field] = parseNullableNumber(raw);
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function AssetSnapshotEditor({
  value,
  onChange
}: {
  value: AssetSnapshotPoint[];
  onChange: (v: AssetSnapshotPoint[]) => void;
}) {
  const valueKey = JSON.stringify(value);
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(JSON.stringify(value, null, 2));
  }, [valueKey, value]);

  const handleChange = (text: string) => {
    setRaw(text);
    const trimmed = text.trim();
    if (!trimmed) {
      onChange([]);
      setError(null);
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const normalized = normalizeAssetSnapshots(parsed);
      if (normalized == null) {
        setError("JSON 배열 형식으로 입력하세요.");
        return;
      }
      onChange(normalized);
      setError(null);
      return;
    } catch {
      // fall through to tabular parser
    }

    const fromTable = parseAssetSnapshotTable(text);
    if (fromTable) {
      onChange(fromTable);
      setError(null);
      return;
    }

    setError("JSON 배열 또는 탭(표) 형식으로 입력하세요.");
  };

  return (
    <>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        placeholder='날짜\t2025-07-01\t2025-07-15\n투자(매수금)\t500000\t1000000\n투자(평가금)\t500000\t1025000\n총자산(매수금)\t3120000\t3940516\n총자산(평가금)\t3120000\t3980000'
        style={{ width: "100%", minHeight: 140, padding: 8, fontSize: 12, fontFamily: "monospace" }}
      />
      {error && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>{error}</p>}
    </>
  );
}

function TargetNetWorthCurveEditor({
  value,
  onChange
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const valueKey = JSON.stringify(value);
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(JSON.stringify(value, null, 2));
  }, [valueKey, value]);

  const handleChange = (text: string) => {
    setRaw(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === "string" && typeof v === "number") cleaned[k] = v;
        }
        onChange(cleaned);
        setError(null);
      }
    } catch {
      setError("유효하지 않은 JSON");
    }
  };

  return (
    <>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        placeholder='{"2025-07-01": 3120000, "2025-12-15": 20333151}'
        style={{ width: "100%", minHeight: 100, padding: 8, fontSize: 12, fontFamily: "monospace" }}
      />
      {error && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>{error}</p>}
    </>
  );
}

function getDashboardWidgetNames(dividendTicker?: string): Record<string, string> {
  return {
    summary: "요약 카드",
    assets: "자산 구성",
    income: "수입/지출",
    savingsFlow: "저축·투자 기간별 현황",
    budget: "예산 요약",
    stocks: "주식 성과",
    portfolio: "포트폴리오",
    targetPortfolio: "목표 포트폴리오",
    [WIDGET_ID_DIVIDEND_TRACKING]: dividendTicker ? `배당 추적 (${dividendTicker})` : "배당 추적 (티커 선택)",
    isa: "ISA 포트폴리오",
    realReturn: "연간 진짜 수익률",
    goalPlanner: "목표 역산 플래너",
    investCapacity: "투자 여력 스코어",
    tradeVsSpend: "매매 vs 소비 패턴",
    dividendCoverage: "배당 vs 고정지출",
    concentration: "투자 집중도 vs 소비 다양성"
  };
}

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
}

export const DashboardWidgetSettings: React.FC<Props> = React.memo(function DashboardWidgetSettings({
  data,
  onChangeData
}) {
  const [dashboardVisibleWidgets, setDashboardVisibleWidgets] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(DASHBOARD_WIDGET_ORDER);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGETS);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        return new Set(Array.isArray(arr) ? arr.map(migrateWidgetId) : DASHBOARD_WIDGET_ORDER);
      }
    } catch (e) {
      console.warn("[SettingsView] 대시보드 위젯 설정 로드 실패", e);
    }
    return new Set(DASHBOARD_WIDGET_ORDER);
  });
  const [dashboardWidgetOrder, setDashboardWidgetOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [...DASHBOARD_WIDGET_ORDER];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) {
          // 저장된 순서에서 아직 유효한 위젯은 순서 그대로 유지, 신규 위젯은 뒤에 추가,
          // 제거된 위젯은 drop. 길이 불일치로 전체 초기화하지 않음.
          const currentSet = new Set(DASHBOARD_WIDGET_ORDER);
          const seen = new Set<string>();
          const kept: string[] = [];
          for (const raw of parsed) {
            const id = migrateWidgetId(raw);
            if (currentSet.has(id) && !seen.has(id)) {
              kept.push(id);
              seen.add(id);
            }
          }
          const missing = DASHBOARD_WIDGET_ORDER.filter((id) => !seen.has(id));
          return [...kept, ...missing];
        }
      }
    } catch (e) {
      console.warn("[SettingsView] 위젯 순서 로드 실패", e);
    }
    return [...DASHBOARD_WIDGET_ORDER];
  });

  // 탭 전환(=마운트) 시 저장된 위젯 설정 재로드 — 기존 SettingsPage 탭 전환 effect에서 이동
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGETS);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setDashboardVisibleWidgets(new Set(Array.isArray(arr) ? arr.map(migrateWidgetId) : DASHBOARD_WIDGET_ORDER));
      }
      const rawOrder = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER);
      if (rawOrder) {
        const parsed = JSON.parse(rawOrder) as string[];
        if (Array.isArray(parsed) && parsed.length === DASHBOARD_WIDGET_ORDER.length) setDashboardWidgetOrder(parsed.map(migrateWidgetId));
      }
    } catch (e) {
      console.warn("[SettingsView] 탭 전환 시 위젯 순서 로드 실패", e);
    }
  }, []);

  const dashboardSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dashboardSaveTimerRef.current) clearTimeout(dashboardSaveTimerRef.current);
    dashboardSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGETS, JSON.stringify(Array.from(dashboardVisibleWidgets)));
      dashboardSaveTimerRef.current = null;
    }, 300);
    return () => {
      if (dashboardSaveTimerRef.current) clearTimeout(dashboardSaveTimerRef.current);
    };
  }, [dashboardVisibleWidgets]);

  const dashboardOrderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dashboardOrderSaveTimerRef.current) clearTimeout(dashboardOrderSaveTimerRef.current);
    dashboardOrderSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER, JSON.stringify(dashboardWidgetOrder));
      dashboardOrderSaveTimerRef.current = null;
    }, 300);
    return () => {
      if (dashboardOrderSaveTimerRef.current) clearTimeout(dashboardOrderSaveTimerRef.current);
    };
  }, [dashboardWidgetOrder]);

  // 언마운트(탭 이탈) 시 대기 중인 디바운스 저장을 즉시 플러시.
  // 원본에서는 상태가 항상 마운트된 SettingsPage에 있어 탭 전환 후에도 저장이 완료됐다 —
  // 분리 후에는 언마운트가 타이머를 취소하므로 여기서 최신 값을 직접 기록해 동작을 보존한다.
  const visibleWidgetsRef = useRef(dashboardVisibleWidgets);
  visibleWidgetsRef.current = dashboardVisibleWidgets;
  const widgetOrderRef = useRef(dashboardWidgetOrder);
  widgetOrderRef.current = dashboardWidgetOrder;
  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (dashboardSaveTimerRef.current) {
        localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGETS, JSON.stringify(Array.from(visibleWidgetsRef.current)));
      }
      if (dashboardOrderSaveTimerRef.current) {
        localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER, JSON.stringify(widgetOrderRef.current));
      }
    };
  }, []);

  const toggleDashboardWidget = (id: string) => {
    setDashboardVisibleWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveDashboardWidgetOrder = (id: string, direction: "up" | "down") => {
    const idx = dashboardWidgetOrder.indexOf(id);
    if (idx === -1) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= dashboardWidgetOrder.length) return;
    setDashboardWidgetOrder((prev) => {
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  return (
    <div className="card">
      <h3>대시보드 위젯 표시 및 순서</h3>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="dividend-tracking-ticker" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>배당 추적 위젯 티커</label>
        <input
          id="dividend-tracking-ticker"
          type="text"
          placeholder="예: 458730"
          value={data.dividendTrackingTicker ?? ""}
          onChange={(e) => onChangeData({ ...data, dividendTrackingTicker: e.target.value.trim() || undefined })}
          style={{ width: "100%", maxWidth: 200, padding: "8px 12px" }}
        />
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          대시보드 배당 추적 위젯에 표시할 종목 티커. 비워두면 위젯에서 티커 선택 안내가 표시됩니다.
        </p>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
        표시 여부를 선택하고, 순서는 위/아래로 변경할 수 있습니다. 대시보드 탭에서도 동일하게 적용됩니다.
      </p>
      {dashboardWidgetOrder.map((id, index) => (
        <div
          key={id}
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
        >
          <input
            type="checkbox"
            id={`settings-widget-${id}`}
            checked={dashboardVisibleWidgets.has(id)}
            onChange={() => toggleDashboardWidget(id)}
          />
          <label htmlFor={`settings-widget-${id}`} style={{ flex: 1 }}>
            {getDashboardWidgetNames(data.dividendTrackingTicker)[id] ?? id}
          </label>
          <button
            type="button"
            className="secondary"
            style={{ padding: "4px 8px", fontSize: 11 }}
            onClick={() => moveDashboardWidgetOrder(id, "up")}
            disabled={index === 0}
            title="위로"
          >
            위
          </button>
          <button
            type="button"
            className="secondary"
            style={{ padding: "4px 8px", fontSize: 11 }}
            onClick={() => moveDashboardWidgetOrder(id, "down")}
            disabled={index === dashboardWidgetOrder.length - 1}
            title="아래로"
          >
            아래
          </button>
        </div>
      ))}
      <h3 style={{ marginTop: 24, marginBottom: 12 }}>ISA 목표 포트폴리오</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
        대시보드 ISA 위젯에 표시될 목표 비중을 편집합니다. 비중 합계는 100%가 되도록 조정하세요.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table compact" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>라벨</th>
              <th>티커</th>
              <th>종목명</th>
              <th style={{ width: 80 }}>비중 (%)</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {(data.isaPortfolio ?? ISA_PORTFOLIO.map((item) => ({ ticker: item.ticker, name: item.name, weight: item.weight, label: item.label }))).map((item, index) => (
              <tr key={`${item.ticker}-${index}`}>
                <td>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => {
                      const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                      list[index] = { ...list[index], label: e.target.value };
                      onChangeData({ ...data, isaPortfolio: list });
                    }}
                    style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={item.ticker}
                    onChange={(e) => {
                      const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                      list[index] = { ...list[index], ticker: e.target.value };
                      onChangeData({ ...data, isaPortfolio: list });
                    }}
                    style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => {
                      const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                      list[index] = { ...list[index], name: e.target.value };
                      onChangeData({ ...data, isaPortfolio: list });
                    }}
                    style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={item.weight}
                    onChange={(e) => {
                      const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                      list[index] = { ...list[index], weight: Number(e.target.value) || 0 };
                      onChangeData({ ...data, isaPortfolio: list });
                    }}
                    style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={() => {
                      const list = (data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label }))).filter((_, i) => i !== index);
                      onChangeData({ ...data, isaPortfolio: list });
                    }}
                    title="삭제"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="secondary"
        style={{ marginTop: 8 }}
        onClick={() => {
          const list = data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label }));
          onChangeData({
            ...data,
            isaPortfolio: [...list, { ticker: "", name: "", weight: 0, label: "" }]
          });
        }}
      >
        + 종목 추가
      </button>

      <h3 style={{ marginTop: 24, marginBottom: 12 }}>자산 스냅샷(반월/일별)</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        표를 그대로 붙여넣거나(JSON 배열도 가능) 날짜별 자산 스냅샷을 저장합니다. 저장된 값은 대시보드에서
        총자산(매수금/평가금), 투자성과, 1일/15일 수익률로 시각화됩니다.
      </p>
      <AssetSnapshotEditor
        value={data.assetSnapshots ?? []}
        onChange={(assetSnapshots) => onChangeData({ ...data, assetSnapshots })}
      />

      <h3 style={{ marginTop: 24, marginBottom: 12 }}>목표 자산 곡선</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        2026년 1월 이전 구간에서 참고용으로 표시할 목표 자산 금액. 날짜(YYYY-MM-DD)를 키로, 금액을 값으로 하는 JSON. 비워두면 해당 구간은 0원으로 표시됩니다.
      </p>
      <TargetNetWorthCurveEditor
        value={data.targetNetWorthCurve ?? {}}
        onChange={(targetNetWorthCurve) => onChangeData({ ...data, targetNetWorthCurve })}
      />
    </div>
  );
});
