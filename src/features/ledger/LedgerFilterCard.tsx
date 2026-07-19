/**
 * 가계부 검색·필터 카드 (기본 접힘).
 * LedgerPage에서 분리 — React.memo로 감싸 폼 타이핑 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 */
import React from "react";
import type { Account, LedgerEntry } from "../../types";
import { LedgerFilterBar } from "./LedgerFilterBar";
import type { ActiveFilterChip } from "./ledgerActiveFilters";

type SetStr = React.Dispatch<React.SetStateAction<string | undefined>>;
type SetNum = React.Dispatch<React.SetStateAction<number | undefined>>;

interface Props {
  ledger: LedgerEntry[];
  /** 현재 수입/지출/이체 탭으로 좁혀진 목록 (부모 memo) — 카테고리 옵션용 */
  tabLedger: LedgerEntry[];
  accounts: Account[];
  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  filterMainCategory?: string;
  filterSubCategory?: string;
  filterDetailCategory?: string;
  filterFromAccountId?: string;
  filterToAccountId?: string;
  /** 입금/출금 상관없이 해당 계좌가 관련된 모든 거래 (from 또는 to) */
  filterAccountId: string | null;
  setFilterMainCategory: SetStr;
  setFilterSubCategory: SetStr;
  setFilterDetailCategory: SetStr;
  setFilterFromAccountId: SetStr;
  setFilterToAccountId: SetStr;
  setFilterAccountId: (v: string | null) => void;
  filterAmountMin?: number;
  filterAmountMax?: number;
  setFilterAmountMin: SetNum;
  setFilterAmountMax: SetNum;
  filterTagsInput: string;
  setFilterTagsInput: React.Dispatch<React.SetStateAction<string>>;
  dateFilter: { startDate?: string; endDate?: string };
  setDateFilter: React.Dispatch<React.SetStateAction<{ startDate?: string; endDate?: string }>>;
  /** 활성 필터 칩 (단일 소스 — LedgerSummarySection과 공유) */
  activeFilterChips: ActiveFilterChip[];
  viewMode: "all" | "monthly";
  setViewMode: React.Dispatch<React.SetStateAction<"all" | "monthly">>;
  clearAllFilters: () => void;
}

export const LedgerFilterCard: React.FC<Props> = React.memo(function LedgerFilterCard({
  ledger,
  tabLedger,
  accounts,
  showFilters,
  setShowFilters,
  searchQuery,
  setSearchQuery,
  filterMainCategory,
  filterSubCategory,
  filterDetailCategory,
  filterFromAccountId,
  filterToAccountId,
  filterAccountId,
  setFilterMainCategory,
  setFilterSubCategory,
  setFilterDetailCategory,
  setFilterFromAccountId,
  setFilterToAccountId,
  setFilterAccountId,
  filterAmountMin,
  filterAmountMax,
  setFilterAmountMin,
  setFilterAmountMax,
  filterTagsInput,
  setFilterTagsInput,
  dateFilter,
  setDateFilter,
  activeFilterChips,
  viewMode,
  setViewMode,
  clearAllFilters
}) {
  // 활성 필터 카운트·요약은 단일 소스(activeFilterChips)에서 — LedgerSummarySection 칩과 항상 일치.
  const activeCount = activeFilterChips.length;
  const summaryText = activeCount === 0 ? "" : activeFilterChips.slice(0, 3).map((c) => c.label).join(" · ") + (activeCount > 3 ? ` 외 ${activeCount - 3}` : "");

  // 금액 입력 파싱 — 빈 문자열이면 undefined(필터 해제), 숫자면 음수 방지 후 정수.
  const onAmountChange = (setter: SetNum) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[,\s]/g, "");
    if (raw === "") { setter(undefined); return; }
    const n = Number(raw);
    setter(Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined);
  };

  return (
    <div className="card" style={{ padding: showFilters ? 16 : 10, marginBottom: 16 }}>
      {/* 항상 보이는 1줄 헤더 — 토글 + 활성 필터 요약 + 우측 액션 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          title={showFilters ? "필터 접기" : "필터 펼치기"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            cursor: "pointer",
            flex: "0 0 auto",
          }}
        >
          <span>🔍 검색·필터</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{showFilters ? "▲" : "▼"}</span>
          {activeCount > 0 && (
            <span style={{
              display: "inline-block",
              minWidth: 18,
              padding: "1px 6px",
              fontSize: 11,
              fontWeight: 700,
              background: "var(--primary)",
              color: "#fff",
              borderRadius: 9,
              textAlign: "center",
            }}>
              {activeCount}
            </span>
          )}
        </button>

        {/* 접힌 상태에서 활성 필터 요약 칩 */}
        {!showFilters && activeCount > 0 && (
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={activeFilterChips.map((c) => c.label).join(" · ")}>
            {summaryText}
          </span>
        )}

        {/* 우측 액션: 초기화(필터 있을 때만) + 월별 토글 */}
        <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              title="검색·카테고리·계좌·금액·태그·날짜 필터 모두 초기화 (월별/종류 탭은 유지)"
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              🔄 초기화
            </button>
          )}
          <button
            type="button"
            onClick={() => setViewMode(viewMode === "monthly" ? "all" : "monthly")}
            title={viewMode === "monthly" ? "월별 보기 끄기 (전체 기간)" : "월별 보기 켜기"}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 8,
              border: viewMode === "monthly" ? "2px solid var(--primary)" : "2px solid var(--border)",
              background: viewMode === "monthly" ? "var(--primary)" : "var(--surface)",
              color: viewMode === "monthly" ? "white" : "var(--text)",
              cursor: "pointer",
            }}
          >
            {viewMode === "monthly" ? "월별 ✓" : "월별"}
          </button>
        </div>
      </div>

      {/* 펼친 상태 — 기존 필터 UI 전체 */}
      {showFilters && (
        <div style={{ marginTop: 14 }}>
          <LedgerFilterBar
            ledger={ledger}
            tabLedger={tabLedger}
            accounts={accounts}
            filterMainCategory={filterMainCategory}
            filterSubCategory={filterSubCategory}
            filterDetailCategory={filterDetailCategory}
            filterFromAccountId={filterFromAccountId}
            filterToAccountId={filterToAccountId}
            filterAccountId={filterAccountId}
            setFilterMainCategory={setFilterMainCategory}
            setFilterSubCategory={setFilterSubCategory}
            setFilterDetailCategory={setFilterDetailCategory}
            setFilterFromAccountId={setFilterFromAccountId}
            setFilterToAccountId={setFilterToAccountId}
            setFilterAccountId={setFilterAccountId}
          />
          <div style={{ position: "relative", marginTop: 4 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="거래 검색 (날짜, 카테고리, 내용, 계좌, 태그, 금액)"
              style={{
                width: "100%",
                padding: "12px 16px",
                paddingRight: searchQuery ? 40 : 16,
                fontSize: 15,
                borderRadius: 10,
                border: "2px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 18,
                  color: "var(--text-muted)",
                  lineHeight: 1,
                  padding: "0 4px",
                }}
                aria-label="검색어 지우기"
              >
                ×
              </button>
            )}
          </div>

          {/* 상세 필터: 금액 범위 / 날짜 범위 / 태그 — 입력 비우면 해당 필터 해제 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
            <label style={detailFieldStyle}>
              <span style={detailLabelStyle}>금액(원)</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={filterAmountMin != null ? filterAmountMin.toLocaleString() : ""}
                  onChange={onAmountChange(setFilterAmountMin)}
                  placeholder="최소"
                  style={{ ...detailInputStyle, width: 96 }}
                />
                <span style={{ color: "var(--text-muted)" }}>~</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={filterAmountMax != null ? filterAmountMax.toLocaleString() : ""}
                  onChange={onAmountChange(setFilterAmountMax)}
                  placeholder="최대"
                  style={{ ...detailInputStyle, width: 96 }}
                />
              </span>
            </label>

            <label style={detailFieldStyle}>
              <span style={detailLabelStyle}>기간</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input
                  type="date"
                  value={dateFilter.startDate ?? ""}
                  max={dateFilter.endDate || undefined}
                  onChange={(e) => setDateFilter((d) => ({ ...d, startDate: e.target.value || undefined }))}
                  style={detailInputStyle}
                />
                <span style={{ color: "var(--text-muted)" }}>~</span>
                <input
                  type="date"
                  value={dateFilter.endDate ?? ""}
                  min={dateFilter.startDate || undefined}
                  onChange={(e) => setDateFilter((d) => ({ ...d, endDate: e.target.value || undefined }))}
                  style={detailInputStyle}
                />
              </span>
            </label>

            <label style={{ ...detailFieldStyle, flex: 1, minWidth: 160 }}>
              <span style={detailLabelStyle}>태그</span>
              <input
                type="text"
                value={filterTagsInput}
                onChange={(e) => setFilterTagsInput(e.target.value)}
                placeholder="쉼표로 구분 (모두 포함)"
                style={{ ...detailInputStyle, width: "100%", minWidth: 0 }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
});

const detailFieldStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const detailLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

const detailInputStyle: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  boxSizing: "border-box",
  outline: "none",
};
