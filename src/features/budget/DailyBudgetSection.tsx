/**
 * 💰 하루 예산 한도 설정 카드 — 가계부 상단 진행 바·streak·월간 카드와 연동.
 * BudgetRecurringView에서 분리 — React.memo로 감싸 반복지출 폼 타이핑 등
 * 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 자체 상태 없음(설정값은 props로 직접 제어). 부모가 넘기는 onChangeDailyBudget은
 * App 소유 prop을 그대로 전달하므로 부모(BudgetRecurringView) 자체 상태 변경에는 참조가 안정적이다.
 */
import React from "react";
import type { DailyBudgetConfig } from "../../types";
import { DEFAULT_DAILY_BUDGET } from "../../utils/dailyBudget";

interface Props {
  dailyBudget?: DailyBudgetConfig;
  onChangeDailyBudget: (next: DailyBudgetConfig) => void;
}

export const DailyBudgetSection: React.FC<Props> = React.memo(function DailyBudgetSection({
  dailyBudget,
  onChangeDailyBudget,
}) {
  const cfg: DailyBudgetConfig = dailyBudget ?? DEFAULT_DAILY_BUDGET;
  const update = (patch: Partial<DailyBudgetConfig>) => onChangeDailyBudget({ ...cfg, ...patch });
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, borderLeft: "3px solid #10b981" }}>
      <div className="card-title" style={{ marginBottom: 8 }}>💰 하루 예산 한도 (가계부 상단 진행 바와 연동)</div>
      <p className="hint" style={{ marginBottom: 12 }}>
        "하루 ₩N원 이하" 원칙. 켜면 가계부 상단에 진행 바가 표시되고, 한도 초과 입력 시 confirm 경고가 뜹니다.
        <br />고정비(통신·구독·주거)와 카드결제·투자·이체는 자동 제외.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <span style={{ fontWeight: 600 }}>활성화 (가계부 상단 진행 바·streak·월간 카드 표시)</span>
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>일 한도 (원)</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={cfg.dailyLimit}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 0) update({ dailyLimit: n });
              }}
              style={{ width: 120, padding: "6px 10px", borderRadius: 6 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>모드</span>
            <select
              value={cfg.mode}
              onChange={(e) => update({ mode: e.target.value as "daily" | "weekly" })}
              style={{ padding: "6px 10px", borderRadius: 6 }}
            >
              <option value="daily">하루 단위</option>
              <option value="weekly">주간 평균 (×7)</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={cfg.warnOnExceed} onChange={(e) => update({ warnOnExceed: e.target.checked })} />
            <span>입력 초과 시 경고</span>
          </label>
        </div>
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>제외 카테고리 설정 (고급)</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>제외 대분류 (콤마 구분)</span>
              <input
                type="text"
                value={cfg.excludedCategories.join(", ")}
                onChange={(e) => update({ excludedCategories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder="신용결제, 재테크, 저축성지출, 이체, 수입"
                style={{ padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>제외 중분류 (콤마 구분)</span>
              <input
                type="text"
                value={cfg.excludedSubCategories.join(", ")}
                onChange={(e) => update({ excludedSubCategories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder="통신비, 구독비, 주거비"
                style={{ padding: "6px 10px", borderRadius: 6, fontSize: 12 }}
              />
            </label>
          </div>
        </details>
      </div>
    </div>
  );
});
