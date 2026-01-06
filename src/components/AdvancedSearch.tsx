import React, { useState, useMemo } from "react";
import type { Account, LedgerEntry } from "../types";

interface SearchQuery {
  keyword: string;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  accountIds?: string[];
  categories?: string[];
  kinds?: ("income" | "expense" | "transfer")[];
  tags?: string[];
}

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  categories: string[];
  tags: string[];
  query: SearchQuery;
  onChange: (query: SearchQuery) => void;
  onSave?: (name: string, query: SearchQuery) => void;
  savedFilters?: { id: string; name: string; query: SearchQuery }[];
  onLoadFilter?: (query: SearchQuery) => void;
  onDeleteFilter?: (id: string) => void;
  onClose: () => void;
}

export const AdvancedSearch: React.FC<Props> = ({
  accounts,
  ledger,
  categories,
  tags,
  query,
  onChange,
  onSave,
  savedFilters = [],
  onLoadFilter,
  onDeleteFilter,
  onClose
}) => {
  const [filterName, setFilterName] = useState("");

  const handleSaveFilter = () => {
    if (!filterName.trim() || !onSave) return;
    onSave(filterName.trim(), query);
    setFilterName("");
  };

  // 고유한 카테고리 목록 추출
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    ledger.forEach(l => {
      if (l.category) cats.add(l.category);
      if (l.subCategory) cats.add(l.subCategory);
    });
    return Array.from(cats).sort();
  }, [ledger]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "700px", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-header">
          <h3>고급 검색</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* 키워드 검색 */}
            <label>
              <span>키워드</span>
              <input
                type="text"
                value={query.keyword}
                onChange={(e) => onChange({ ...query, keyword: e.target.value })}
                placeholder="설명, 메모에서 검색"
              />
            </label>

            {/* 날짜 범위 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                <span>시작일</span>
                <input
                  type="date"
                  value={query.startDate || ""}
                  onChange={(e) => onChange({ ...query, startDate: e.target.value || undefined })}
                />
              </label>
              <label>
                <span>종료일</span>
                <input
                  type="date"
                  value={query.endDate || ""}
                  onChange={(e) => onChange({ ...query, endDate: e.target.value || undefined })}
                />
              </label>
            </div>

            {/* 금액 범위 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                <span>최소 금액</span>
                <input
                  type="number"
                  value={query.minAmount || ""}
                  onChange={(e) => onChange({ ...query, minAmount: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="0"
                />
              </label>
              <label>
                <span>최대 금액</span>
                <input
                  type="number"
                  value={query.maxAmount || ""}
                  onChange={(e) => onChange({ ...query, maxAmount: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="무제한"
                />
              </label>
            </div>

            {/* 계좌 선택 */}
            <label>
              <span>계좌 (다중 선택)</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                {accounts.map((acc) => {
                  const isSelected = query.accountIds?.includes(acc.id);
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      className={isSelected ? "primary" : "secondary"}
                      onClick={() => {
                        const current = query.accountIds || [];
                        const next = isSelected
                          ? current.filter((id) => id !== acc.id)
                          : [...current, acc.id];
                        onChange({ ...query, accountIds: next.length > 0 ? next : undefined });
                      }}
                      style={{ fontSize: "12px", padding: "6px 12px" }}
                    >
                      {acc.name}
                    </button>
                  );
                })}
              </div>
            </label>

            {/* 카테고리 선택 */}
            <label>
              <span>카테고리 (다중 선택)</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                {uniqueCategories.map((cat) => {
                  const isSelected = query.categories?.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      className={isSelected ? "primary" : "secondary"}
                      onClick={() => {
                        const current = query.categories || [];
                        const next = isSelected
                          ? current.filter((c) => c !== cat)
                          : [...current, cat];
                        onChange({ ...query, categories: next.length > 0 ? next : undefined });
                      }}
                      style={{ fontSize: "12px", padding: "6px 12px" }}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </label>

            {/* 구분 선택 */}
            <label>
              <span>구분 (다중 선택)</span>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                {(["income", "expense", "transfer"] as const).map((kind) => {
                  const labels = { income: "수입", expense: "지출", transfer: "이체" };
                  const isSelected = query.kinds?.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={isSelected ? "primary" : "secondary"}
                      onClick={() => {
                        const current = query.kinds || [];
                        const next = isSelected
                          ? current.filter((k) => k !== kind)
                          : [...current, kind];
                        onChange({ ...query, kinds: next.length > 0 ? next : undefined });
                      }}
                      style={{ fontSize: "12px", padding: "6px 12px" }}
                    >
                      {labels[kind]}
                    </button>
                  );
                })}
              </div>
            </label>

            {/* 태그 선택 */}
            {tags.length > 0 && (
              <label>
                <span>태그 (다중 선택)</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                  {tags.map((tag) => {
                    const isSelected = query.tags?.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={isSelected ? "primary" : "secondary"}
                        onClick={() => {
                          const current = query.tags || [];
                          const next = isSelected
                            ? current.filter((t) => t !== tag)
                            : [...current, tag];
                          onChange({ ...query, tags: next.length > 0 ? next : undefined });
                        }}
                        style={{ fontSize: "12px", padding: "6px 12px" }}
                      >
                        #{tag}
                      </button>
                    );
                  })}
                </div>
              </label>
            )}

            {/* 저장된 필터 */}
            {savedFilters.length > 0 && (
              <div>
                <span style={{ display: "block", marginBottom: "8px", fontWeight: 600 }}>저장된 필터</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {savedFilters.map((filter) => (
                    <div
                      key={filter.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "var(--surface)",
                        borderRadius: "8px",
                        border: "1px solid var(--border)"
                      }}
                    >
                      <span>{filter.name}</span>
                      <div style={{ display: "flex", gap: "8px" }}>
                        {onLoadFilter && (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => onLoadFilter(filter.query)}
                            style={{ fontSize: "12px", padding: "4px 8px" }}
                          >
                            적용
                          </button>
                        )}
                        {onDeleteFilter && (
                          <button
                            type="button"
                            className="danger"
                            onClick={() => onDeleteFilter(filter.id)}
                            style={{ fontSize: "12px", padding: "4px 8px" }}
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 필터 저장 */}
            {onSave && (
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="필터 이름"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="primary"
                  onClick={handleSaveFilter}
                  disabled={!filterName.trim()}
                >
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
          <button type="button" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onChange({
                keyword: "",
                startDate: undefined,
                endDate: undefined,
                minAmount: undefined,
                maxAmount: undefined,
                accountIds: undefined,
                categories: undefined,
                kinds: undefined,
                tags: undefined
              });
            }}
          >
            초기화
          </button>
        </div>
      </div>
    </div>
  );
};

