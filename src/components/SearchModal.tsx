import React, { useEffect } from "react";
import type { SearchQuery, SavedFilter } from "../hooks/useSearch";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: SearchQuery;
  setSearchQuery: (query: SearchQuery | ((prev: SearchQuery) => SearchQuery)) => void;
  savedFilters: SavedFilter[];
  filteredResults: Array<{
    type: "ledger" | "trade";
    id: string;
    date: string;
    title: string;
    amount: number;
    accounts: string;
    accountId: string;
  }>;
  onSaveFilter: (name: string) => void;
  onApplyFilter: (id: string) => void;
  onDeleteFilter: (id: string) => void;
  onNavigate?: (payload: { type: "ledger" | "trade"; id: string }) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  searchQuery,
  setSearchQuery,
  savedFilters,
  filteredResults,
  onSaveFilter,
  onApplyFilter,
  onDeleteFilter,
  onNavigate
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>전역 검색</h3>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <label>
              <span>키워드 (티커/메모/계좌/카테고리)</span>
              <input
                type="text"
                value={searchQuery.keyword}
                onChange={(e) => setSearchQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="예: 삼성전자, 식비, CHK_KB"
              />
            </label>
            <label>
              <span>최소 금액</span>
              <input
                type="number"
                value={searchQuery.minAmount ?? ""}
                onChange={(e) =>
                  setSearchQuery((prev) => ({
                    ...prev,
                    minAmount: e.target.value ? Number(e.target.value) : undefined
                  }))
                }
                placeholder="0"
              />
            </label>
            <label>
              <span>최대 금액</span>
              <input
                type="number"
                value={searchQuery.maxAmount ?? ""}
                onChange={(e) =>
                  setSearchQuery((prev) => ({
                    ...prev,
                    maxAmount: e.target.value ? Number(e.target.value) : undefined
                  }))
                }
                placeholder="무제한"
              />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={searchQuery.includeLedger}
                onChange={(e) => setSearchQuery((prev) => ({ ...prev, includeLedger: e.target.checked }))}
              />
              <span>가계부 포함</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={searchQuery.includeTrades}
                onChange={(e) => setSearchQuery((prev) => ({ ...prev, includeTrades: e.target.checked }))}
              />
              <span>주식 거래 포함</span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
            <input
              type="text"
              placeholder="필터 이름 저장"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSaveFilter((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = "";
                }
              }}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const input = document.activeElement as HTMLInputElement;
                if (input && input.value) {
                  onSaveFilter(input.value);
                  input.value = "";
                }
              }}
            >
              뷰 저장
            </button>
          </div>

          {savedFilters.length > 0 && (
            <div className="saved-filters">
              {savedFilters.map((f) => (
                <div key={f.id} className="saved-filter-item">
                  <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => onApplyFilter(f.id)}>
                    {f.name}
                  </span>
                  <button type="button" className="link" onClick={() => onDeleteFilter(f.id)}>
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="search-results" style={{ maxHeight: 320, overflow: "auto", marginTop: 8 }}>
            {filteredResults.length === 0 && <p className="hint">검색 결과가 없습니다.</p>}
            {filteredResults.map((r) => (
              <div
                key={r.id}
                className="search-row"
                role="button"
                tabIndex={0}
                onClick={() => {
                  onNavigate?.({ type: r.type, id: r.id });
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onNavigate?.({ type: r.type, id: r.id });
                    onClose();
                  }
                }}
                style={{ cursor: onNavigate ? "pointer" : undefined }}
              >
                <div className="search-row-title">
                  <span className={`pill ${r.type === "trade" ? "muted" : ""}`} style={{ padding: "3px 8px", fontSize: 11 }}>
                    {r.type === "trade" ? "거래" : "가계부"}
                  </span>
                  <strong>{r.title}</strong>
                </div>
                <div className="search-row-meta">
                  <span>{r.date}</span>
                  <span>{r.accounts || r.accountId}</span>
                  <span>{Math.round(r.amount).toLocaleString()} 원</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
