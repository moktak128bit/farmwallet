import React, { useEffect, useMemo, useState } from "react";
import { Check, X, Plus } from "lucide-react";
import type { LedgerEntry } from "../../types";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatKRW } from "../../utils/formatter";
import {
  applyDescriptionMerge,
  findDescriptionGroups,
  buildVariantsByContext,
  type DescriptionGroup,
  type DescriptionVariant,
} from "../../utils/descriptionGrouping";

interface Props {
  ledger: LedgerEntry[];
  /** 머지 적용 시 새 ledger 배열로 호출. 호출자가 onChangeLedger로 연결. */
  onApply: (next: LedgerEntry[]) => void;
  onClose: () => void;
}

interface GroupUIState {
  /** 어떤 description들을 통합 대상으로 선택했는지 (description string 자체를 key로) */
  selected: Set<string>;
  /** 사용자가 선택한 통합 후 새 description (suggestedCanonical 또는 직접 입력) */
  canonical: string;
  /** 자동 감지에 없던 변형 중 사용자가 수동으로 추가한 것 (description → variant) */
  extras: Map<string, DescriptionVariant>;
}

export const DescriptionMergeModal: React.FC<Props> = ({ ledger, onApply, onClose }) => {
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  // 머지가 누적되면서 그룹이 줄어들 수 있도록 ledger 변화에 반응
  const groups = useMemo(() => findDescriptionGroups(ledger), [ledger]);
  // 같은 (kind/cat/sub) 컨텍스트의 모든 distinct description — 수동 추가 dropdown용
  const variantsByContext = useMemo(() => buildVariantsByContext(ledger), [ledger]);

  // 각 그룹의 UI 상태 — 초기엔 모든 변형 선택 + suggestedCanonical, extras 비어있음
  const [uiState, setUiState] = useState<Record<number, GroupUIState>>(() => {
    const init: Record<number, GroupUIState> = {};
    groups.forEach((g, i) => {
      init[i] = {
        selected: new Set(g.variants.map((v) => v.description)),
        canonical: g.suggestedCanonical,
        extras: new Map(),
      };
    });
    return init;
  });

  // ledger가 바뀔 때 (머지 적용 후) UI 상태 리셋 — 새 그룹들에 맞춰
  useEffect(() => {
    setUiState(() => {
      const next: Record<number, GroupUIState> = {};
      groups.forEach((g, i) => {
        next[i] = {
          selected: new Set(g.variants.map((v) => v.description)),
          canonical: g.suggestedCanonical,
          extras: new Map(),
        };
      });
      return next;
    });
  }, [groups]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggleVariant = (groupIdx: number, desc: string) => {
    setUiState((prev) => {
      const cur = prev[groupIdx];
      const sel = new Set(cur.selected);
      if (sel.has(desc)) sel.delete(desc); else sel.add(desc);
      return { ...prev, [groupIdx]: { ...cur, selected: sel } };
    });
  };

  const setCanonical = (groupIdx: number, value: string) => {
    setUiState((prev) => ({ ...prev, [groupIdx]: { ...prev[groupIdx], canonical: value } }));
  };

  const addExtraVariant = (groupIdx: number, variant: DescriptionVariant) => {
    setUiState((prev) => {
      const cur = prev[groupIdx];
      const newExtras = new Map(cur.extras);
      newExtras.set(variant.description, variant);
      const newSelected = new Set(cur.selected);
      newSelected.add(variant.description);  // 추가 시 자동 선택
      return { ...prev, [groupIdx]: { ...cur, extras: newExtras, selected: newSelected } };
    });
  };

  const applyGroupMerge = (groupIdx: number, group: DescriptionGroup) => {
    const state = uiState[groupIdx];
    if (!state || state.selected.size < 2) return;
    const ledgerIds = new Set<string>();
    // 자동 감지 변형
    for (const v of group.variants) {
      if (state.selected.has(v.description)) {
        for (const id of v.ledgerIds) ledgerIds.add(id);
      }
    }
    // 수동 추가 변형
    for (const [desc, v] of state.extras) {
      if (state.selected.has(desc)) {
        for (const id of v.ledgerIds) ledgerIds.add(id);
      }
    }
    const next = applyDescriptionMerge(ledger, ledgerIds, state.canonical);
    onApply(next);
    // useEffect로 uiState 자동 리셋됨
  };

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 2000 }}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={trapRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-modal-title"
        style={{ maxWidth: 720, width: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 0 }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 id="merge-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>유사 설명 통합</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              같은 카테고리 안에서 표기 변형을 하나로 합칩니다. 의미 다른 게 묶였으면 체크 해제, 더 합치고 싶으면 [+ 다른 변형 추가].
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", padding: 0, width: 28, height: 28, color: "var(--text-muted)" }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px", overflowY: "auto", flex: 1 }}>
          {groups.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>자동 감지된 유사 설명이 없습니다</div>
              <div style={{ fontSize: 12 }}>모든 description이 충분히 구분되어 있어요.</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                <strong style={{ color: "var(--text)" }}>{groups.length}개 그룹</strong> 발견 — 합산 금액 큰 순.
              </div>

              {groups.map((g, idx) => {
                const state = uiState[idx];
                if (!state) return null;
                const selectedCount = state.selected.size;
                // 같은 컨텍스트의 모든 변형 — 자동 감지 + 수동 추가에 없는 것만 추가 후보
                const allInContext = variantsByContext.get(g.contextKey) ?? [];
                const inGroupSet = new Set([
                  ...g.variants.map((v) => v.description),
                  ...state.extras.keys(),
                ]);
                const availableToAdd = allInContext.filter((v) => !inGroupSet.has(v.description));
                return (
                  <div
                    key={`${g.contextKey}|${idx}`}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "14px 16px",
                      marginBottom: 12,
                      background: "var(--surface)",
                    }}
                  >
                    {/* Group header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                        {g.subCategory || g.category || "(카테고리 없음)"}
                        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>
                          {g.variants.length + state.extras.size}개 변형 · {g.totalCount + Array.from(state.extras.values()).reduce((s, v) => s + v.count, 0)}건
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>
                        {formatKRW(g.totalAmount + Array.from(state.extras.values()).reduce((s, v) => s + v.totalAmount, 0))}
                      </div>
                    </div>

                    {/* Variants — auto-detected */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                      {g.variants.map((v) => {
                        const checked = state.selected.has(v.description);
                        return (
                          <label
                            key={v.description}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "6px 8px",
                              borderRadius: 6,
                              cursor: "pointer",
                              background: checked ? "rgba(37,99,235,0.06)" : "transparent",
                              fontSize: 13,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleVariant(idx, v.description)}
                              style={{ cursor: "pointer" }}
                            />
                            <span style={{ flex: 1, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {v.description}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 60, textAlign: "right" }}>
                              {v.count}건
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 90, textAlign: "right" }}>
                              {formatKRW(v.totalAmount)}
                            </span>
                          </label>
                        );
                      })}

                      {/* Extras — manually added */}
                      {Array.from(state.extras.values()).map((v) => {
                        const checked = state.selected.has(v.description);
                        return (
                          <label
                            key={`extra-${v.description}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "6px 8px",
                              borderRadius: 6,
                              cursor: "pointer",
                              background: checked ? "rgba(168, 85, 247, 0.08)" : "transparent",
                              border: "1px dashed rgba(168, 85, 247, 0.4)",
                              fontSize: 13,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleVariant(idx, v.description)}
                              style={{ cursor: "pointer" }}
                            />
                            <span style={{ flex: 1, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {v.description}
                              <span style={{ fontSize: 10, marginLeft: 6, color: "rgb(168, 85, 247)", fontWeight: 700 }}>+추가</span>
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 60, textAlign: "right" }}>
                              {v.count}건
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 90, textAlign: "right" }}>
                              {formatKRW(v.totalAmount)}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    {/* + 다른 변형 추가 dropdown */}
                    {availableToAdd.length > 0 && (
                      <details style={{ marginBottom: 12, fontSize: 12 }}>
                        <summary style={{ cursor: "pointer", color: "rgb(168, 85, 247)", fontWeight: 600, padding: "4px 0", userSelect: "none" }}>
                          <Plus size={12} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />
                          다른 변형 추가 (같은 카테고리 · {availableToAdd.length}개 가능)
                        </summary>
                        <div style={{ marginTop: 6, padding: "8px 10px", background: "rgba(168, 85, 247, 0.04)", borderRadius: 6, maxHeight: 200, overflowY: "auto" }}>
                          {availableToAdd.map((v) => (
                            <button
                              key={v.description}
                              type="button"
                              onClick={() => addExtraVariant(idx, v)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                width: "100%",
                                gap: 10,
                                padding: "5px 8px",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                borderRadius: 4,
                                fontSize: 12,
                                color: "var(--text)",
                                textAlign: "left",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(168, 85, 247, 0.1)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              <Plus size={12} color="rgb(168, 85, 247)" />
                              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.description}</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 50, textAlign: "right" }}>{v.count}건</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 80, textAlign: "right" }}>{formatKRW(v.totalAmount)}</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Canonical input + apply */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>통합할 이름:</span>
                      <input
                        type="text"
                        value={state.canonical}
                        onChange={(e) => setCanonical(idx, e.target.value)}
                        placeholder="새 description"
                        style={{
                          flex: 1,
                          minWidth: 180,
                          padding: "6px 10px",
                          fontSize: 13,
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          background: "var(--bg)",
                          color: "var(--text)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => applyGroupMerge(idx, g)}
                        disabled={selectedCount < 2 || !state.canonical.trim()}
                        style={{
                          padding: "7px 14px",
                          fontSize: 13,
                          fontWeight: 600,
                          background: selectedCount >= 2 && state.canonical.trim() ? "var(--primary, #2563eb)" : "var(--border)",
                          color: selectedCount >= 2 && state.canonical.trim() ? "#fff" : "var(--text-muted)",
                          border: "none",
                          borderRadius: 6,
                          cursor: selectedCount >= 2 && state.canonical.trim() ? "pointer" : "not-allowed",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Check size={14} />
                        통합 ({selectedCount}건)
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-muted)" }}>
          <span>💡 실수로 통합했다면 Ctrl+Z (Undo) 가능합니다.</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: "var(--border)",
              color: "var(--text)",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <X size={14} />
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
