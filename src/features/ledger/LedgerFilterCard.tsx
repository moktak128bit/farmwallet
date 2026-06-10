/**
 * 가계부 검색·필터 카드 (기본 접힘).
 * LedgerPage에서 분리 — React.memo로 감싸 폼 타이핑 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 */
import React from "react";
import type { Account, LedgerEntry } from "../../types";
import { LedgerFilterBar } from "./LedgerFilterBar";

type SetStr = React.Dispatch<React.SetStateAction<string | undefined>>;

interface Props {
  ledger: LedgerEntry[];
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
  setFilterMainCategory: SetStr;
  setFilterSubCategory: SetStr;
  setFilterDetailCategory: SetStr;
  setFilterFromAccountId: SetStr;
  setFilterToAccountId: SetStr;
  filterAccountId: string | null;
  filterAmountMin?: number;
  filterAmountMax?: number;
  filterTagsInput: string;
  dateFilter: { startDate?: string; endDate?: string };
  viewMode: "all" | "monthly";
  setViewMode: React.Dispatch<React.SetStateAction<"all" | "monthly">>;
  clearAllFilters: () => void;
}

export const LedgerFilterCard: React.FC<Props> = React.memo(function LedgerFilterCard({
  ledger,
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
  setFilterMainCategory,
  setFilterSubCategory,
  setFilterDetailCategory,
  setFilterFromAccountId,
  setFilterToAccountId,
  filterAccountId,
  filterAmountMin,
  filterAmountMax,
  filterTagsInput,
  dateFilter,
  viewMode,
  setViewMode,
  clearAllFilters
}) {
  // 활성 필터 카운트 계산 — 사용자가 적용한 좁히기 개수 (월별/종류 탭은 별도)
  const activeChips: string[] = [];
  if (searchQuery) activeChips.push(`"${searchQuery}"`);
  if (filterMainCategory) activeChips.push(filterMainCategory);
  if (filterSubCategory) activeChips.push(filterSubCategory);
  if (filterDetailCategory) activeChips.push(filterDetailCategory);
  if (filterFromAccountId) activeChips.push(`출금:${accounts.find(a => a.id === filterFromAccountId)?.name ?? filterFromAccountId}`);
  if (filterToAccountId) activeChips.push(`입금:${accounts.find(a => a.id === filterToAccountId)?.name ?? filterToAccountId}`);
  if (filterAccountId) activeChips.push(accounts.find(a => a.id === filterAccountId)?.name ?? filterAccountId);
  if (filterAmountMin != null) activeChips.push(`≥${filterAmountMin.toLocaleString()}`);
  if (filterAmountMax != null) activeChips.push(`≤${filterAmountMax.toLocaleString()}`);
  if (filterTagsInput) activeChips.push(`#${filterTagsInput}`);
  if (dateFilter.startDate || dateFilter.endDate) activeChips.push(`${dateFilter.startDate ?? "?"}~${dateFilter.endDate ?? "?"}`);
  const activeCount = activeChips.length;
  const summaryText = activeCount === 0 ? "" : activeChips.slice(0, 3).join(" · ") + (activeChips.length > 3 ? ` 외 ${activeChips.length - 3}` : "");

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
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={activeChips.join(" · ")}>
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
            accounts={accounts}
            filterMainCategory={filterMainCategory}
            filterSubCategory={filterSubCategory}
            filterDetailCategory={filterDetailCategory}
            filterFromAccountId={filterFromAccountId}
            filterToAccountId={filterToAccountId}
            setFilterMainCategory={setFilterMainCategory}
            setFilterSubCategory={setFilterSubCategory}
            setFilterDetailCategory={setFilterDetailCategory}
            setFilterFromAccountId={setFilterFromAccountId}
            setFilterToAccountId={setFilterToAccountId}
          />
          <div style={{ position: "relative", marginTop: 4 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="거래 검색 (날짜, 카테고리, 내용, 계좌...)"
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
        </div>
      )}
    </div>
  );
});
