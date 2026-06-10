import React, { useEffect, useMemo, useState } from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import type { CategoryPresets, LedgerEntry } from "../../types";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatKRW } from "../../utils/formatter";
import {
  addTaxiToPresets,
  applyTaxiSplit,
  findTaxiCandidates,
  presetHasTaxi,
  TAXI_PARENT,
} from "../../utils/taxiSplit";

interface Props {
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  /** ledger 업데이트. 별도 setDataWithHistory 호출 → 한 단계 undo. */
  onChangeLedger: (next: LedgerEntry[]) => void;
  /** preset 업데이트. ledger 업데이트와 별도 호출 → 두 단계 undo (ledger 먼저 undo 후 preset). */
  onChangeCategoryPresets: (next: CategoryPresets) => void;
  onClose: () => void;
}

export const TaxiSplitWizard: React.FC<Props> = ({
  ledger,
  categoryPresets,
  onChangeLedger,
  onChangeCategoryPresets,
  onClose,
}) => {
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  const candidates = useMemo(() => findTaxiCandidates(ledger), [ledger]);
  const hasTaxiInPresets = useMemo(() => presetHasTaxi(categoryPresets), [categoryPresets]);
  const hasTransportGroup = useMemo(
    () => !!categoryPresets.expenseDetails?.find((g) => g.main === TAXI_PARENT),
    [categoryPresets]
  );

  // 제외(=체크 해제) 상태 — 기본은 모두 선택
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // ledger 변화 시(=적용 후) excluded 리셋
  useEffect(() => {
    setExcluded(new Set());
  }, [ledger]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of candidates) if (!excluded.has(c.id)) ids.add(c.id);
    return ids;
  }, [candidates, excluded]);

  const selectedSum = useMemo(() => {
    let sum = 0;
    for (const c of candidates) if (selectedIds.has(c.id)) sum += c.amount;
    return sum;
  }, [candidates, selectedIds]);

  const fullyMigrated = hasTaxiInPresets && candidates.length === 0;
  const canApply = (selectedIds.size > 0 || !hasTaxiInPresets) && hasTransportGroup;

  const apply = () => {
    if (!canApply) return;
    // 1. 프리셋 업데이트 (필요 시)
    if (!hasTaxiInPresets) {
      onChangeCategoryPresets(addTaxiToPresets(categoryPresets));
    }
    // 2. ledger 업데이트
    if (selectedIds.size > 0) {
      onChangeLedger(applyTaxiSplit(ledger, selectedIds));
    }
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
        aria-labelledby="taxi-split-title"
        style={{ maxWidth: 680, width: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 0 }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 id="taxi-split-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🚕 택시 소분류 분리</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              유류교통비 안에서 "택시"를 별도 소분류로 분리. 프리셋 추가 + 기존 항목 재분류를 한 번에.
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
          {/* 유류교통비 그룹 자체가 없으면 작업 불가 */}
          {!hasTransportGroup && (
            <div style={{ padding: "16px 18px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 13, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, marginBottom: 4 }}>
                <AlertTriangle size={16} /> 유류교통비 그룹이 카테고리 프리셋에 없습니다
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                Categories 페이지에서 유류교통비 대분류를 먼저 만들어야 이 마법사를 사용할 수 있습니다.
              </div>
            </div>
          )}

          {/* 이미 완전 적용된 상태 */}
          {fullyMigrated && (
            <div style={{ padding: "24px 18px", textAlign: "center", color: "#059669", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>이미 적용되어 있습니다</div>
              <div style={{ fontSize: 12, color: "#065f46" }}>
                프리셋에 '택시' 소분류가 있고, 유류교통비 안에 재분류할 택시 항목도 없습니다.
              </div>
            </div>
          )}

          {/* 작업 미리보기 */}
          {hasTransportGroup && !fullyMigrated && (
            <>
              {/* 프리셋 변경 표시 */}
              <div style={{ padding: "12px 14px", background: hasTaxiInPresets ? "#f0fdf4" : "#eff6ff", border: `1px solid ${hasTaxiInPresets ? "#86efac" : "#bfdbfe"}`, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: hasTaxiInPresets ? "#065f46" : "#1e3a8a" }}>
                  ① 카테고리 프리셋 변경
                </div>
                {hasTaxiInPresets ? (
                  <div style={{ color: "#065f46" }}>
                    ✓ 이미 유류교통비.subs에 '택시' 있음 — 변경 없음
                  </div>
                ) : (
                  <div style={{ color: "#1e3a8a", lineHeight: 1.6 }}>
                    유류교통비.subs에 <strong>'택시'</strong>를 '대중교통' 다음 위치로 추가합니다.
                  </div>
                )}
              </div>

              {/* 재분류 후보 */}
              <div style={{ padding: "12px 14px", background: candidates.length > 0 ? "#fffbeb" : "#f0fdf4", border: `1px solid ${candidates.length > 0 ? "#fde68a" : "#86efac"}`, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: candidates.length > 0 ? "#78350f" : "#065f46" }}>
                  ② Ledger 재분류 — {candidates.length}건 검출
                </div>
                {candidates.length === 0 ? (
                  <div style={{ color: "#065f46" }}>
                    ✓ 재분류할 택시 항목이 없습니다 — 이미 모두 처리됨 또는 해당 항목 없음
                  </div>
                ) : (
                  <div style={{ color: "#78350f", lineHeight: 1.6 }}>
                    유류교통비 안에서 description이 <strong>택시·카카오T·우버·타다</strong>로 매칭되는 항목들의 detailCategory를 <strong>'택시'</strong>로 변경합니다. 체크박스로 제외 가능.
                  </div>
                )}
              </div>

              {/* 후보 리스트 */}
              {candidates.length > 0 && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ padding: "10px 14px", background: "#f8fafc", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 700, color: "#475569" }}>
                    <span>선택 {selectedIds.size}/{candidates.length}건</span>
                    <span>합 {formatKRW(selectedSum)}</span>
                  </div>
                  <div style={{ maxHeight: 280, overflowY: "auto" }}>
                    {candidates.map((l) => {
                      const checked = !excluded.has(l.id);
                      return (
                        <label
                          key={l.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 14px",
                            borderBottom: "1px solid #f1f5f9",
                            cursor: "pointer",
                            background: checked ? "rgba(37,99,235,0.04)" : "transparent",
                            fontSize: 13,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(l.id)}
                            style={{ cursor: "pointer", flexShrink: 0 }}
                          />
                          <span style={{ color: "var(--text-muted)", fontSize: 11, minWidth: 78, flexShrink: 0 }}>{l.date}</span>
                          <span style={{ flex: 1, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                            {l.description || "(설명 없음)"}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 80, textAlign: "right" }}>
                            {l.detailCategory || "(미분류)"} → 택시
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", minWidth: 90, textAlign: "right" }}>
                            {formatKRW(l.amount)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {!fullyMigrated && hasTransportGroup && "💡 적용 후 Ctrl+Z로 단계별 되돌리기 가능"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
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
            {!fullyMigrated && (
              <button
                type="button"
                onClick={apply}
                disabled={!canApply}
                style={{
                  padding: "8px 18px",
                  fontSize: 13,
                  fontWeight: 700,
                  background: canApply ? "var(--primary, #2563eb)" : "var(--border)",
                  color: canApply ? "#fff" : "var(--text-muted)",
                  border: "none",
                  borderRadius: 6,
                  cursor: canApply ? "pointer" : "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Check size={14} />
                {!hasTaxiInPresets && selectedIds.size === 0
                  ? "프리셋만 추가"
                  : selectedIds.size === 0 && hasTaxiInPresets
                    ? "변경 사항 없음"
                    : `적용 (${selectedIds.size}건${!hasTaxiInPresets ? " + 프리셋" : ""})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
