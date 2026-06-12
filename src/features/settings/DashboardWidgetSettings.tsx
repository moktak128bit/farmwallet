/**
 * 대시보드 위젯 설정 탭 — 위젯 표시/숨김, 배당 추적 티커, ISA 목표 포트폴리오,
 * 자산 스냅샷·목표 자산 곡선 편집기. SettingsPage에서 분리.
 * 위젯 목록·저장은 features/dashboard/dashboardWidgets 단일 정의를 공유한다
 * (DashboardPage가 같은 정의를 읽어 마운트 시 숨김을 적용 — 탭 전환 시 재마운트되므로 즉시 반영).
 * 순서 변경 UI는 제거 — 대시보드는 고정 레이아웃(그리드 묶음 포함)이라 표시/숨김만 제공한다.
 * React.memo로 감싸므로 부모가 넘기는 콜백(onChangeData)은 참조가 안정적이어야 한다.
 */
import React, { useEffect, useState } from "react";
import type {
  AppData,
  AssetSnapshotAccountBreakdown,
  AssetSnapshotPoint
} from "../../types";
import { ISA_PORTFOLIO } from "../../constants/config";
import {
  DASHBOARD_WIDGETS,
  loadHiddenDashboardWidgets,
  saveHiddenDashboardWidgets
} from "../dashboard/dashboardWidgets";

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
        placeholder={"날짜\t2025-07-01\t2025-07-15\n투자(매수금)\t500000\t1000000\n투자(평가금)\t500000\t1025000\n총자산(매수금)\t3120000\t3940516\n총자산(평가금)\t3120000\t3980000"}
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

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
}

export const DashboardWidgetSettings: React.FC<Props> = React.memo(function DashboardWidgetSettings({
  data,
  onChangeData
}) {
  // 숨긴 위젯 ID 집합 — dashboardWidgets 공용 로더 사용 (마운트 시 로드, 토글 즉시 저장)
  const [hiddenWidgets, setHiddenWidgets] = useState<Set<string>>(() => loadHiddenDashboardWidgets());

  const toggleDashboardWidget = (id: string) => {
    setHiddenWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHiddenDashboardWidgets(next);
      return next;
    });
  };

  return (
    <div className="card">
      <h3>대시보드 위젯 표시</h3>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="dividend-tracking-ticker" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>배당 성장 추적 티커</label>
        <input
          id="dividend-tracking-ticker"
          type="text"
          placeholder="예: 458730, 0167B0"
          value={data.dividendTrackingTicker ?? ""}
          onChange={(e) => onChangeData({ ...data, dividendTrackingTicker: e.target.value.trim() || undefined })}
          style={{ width: "100%", maxWidth: 320, padding: "8px 12px" }}
        />
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          대시보드 "배당 성장 추적" 위젯에 표시할 종목 — 쉼표로 여러 개 지정 가능 (종목당 차트 1개).
          2개 미만이면 보유 중이면서 분배금 기록이 2건 이상인 종목을 최근 수령 순으로 자동 보충합니다.
        </p>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
        체크를 해제한 위젯은 대시보드 탭에서 숨겨집니다. 목록 순서는 대시보드의 실제 표시 순서입니다 (순서 변경은 지원하지 않습니다).
      </p>
      {DASHBOARD_WIDGETS.map(({ id, label }) => (
        <div
          key={id}
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
        >
          <input
            type="checkbox"
            id={`settings-widget-${id}`}
            checked={!hiddenWidgets.has(id)}
            onChange={() => toggleDashboardWidget(id)}
          />
          <label htmlFor={`settings-widget-${id}`} style={{ flex: 1 }}>
            {label}
          </label>
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
