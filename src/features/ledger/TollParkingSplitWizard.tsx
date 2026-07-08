import React, { useEffect, useMemo, useState } from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import type { CategoryPresets, LedgerEntry } from "../../types";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatKRW } from "../../utils/formatter";
import {
  applyTollParkingSplit,
  applyTollParkingToPresets,
  countUnsplitSource,
  findTollParkingCandidates,
  presetHasTollParking,
  PARKING,
  TOLL,
  TP_PARENT,
  TP_SOURCE,
  type TPTarget,
} from "../../utils/tollParkingSplit";

interface Props {
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  /** ledger 업데이트. 별도 setDataWithHistory 호출 → 한 단계 undo. */
  onChangeLedger: (next: LedgerEntry[]) => void;
  /** preset 업데이트. ledger와 별도 호출 → 두 단계 undo (ledger 먼저 undo 후 preset). */
  onChangeCategoryPresets: (next: CategoryPresets) => void;
  onClose: () => void;
}

/**
 * 유류교통비 "통행·주차" 합본 소분류를 "톨비" / "주차비"로 분리하는 마법사.
 * description으로 자동 분류(톨/하이패스/통행 → 톨비, 주차 → 주차비)하고, 사용자가 체크박스로 제외 가능.
 * 적용 시 프리셋(톨비·주차비 추가, 잔여 없으면 통행·주차 제거)과 ledger 재분류를 한 번에. (TaxiSplitWizard와 동일 UX)
 */
export const TollParkingSplitWizard: React.FC<Props> = ({
  ledger,
  categoryPresets,
  onChangeLedger,
  onChangeCategoryPresets,
  onClose,
}) => {
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  const candidates = useMemo(() => findTollParkingCandidates(ledger), [ledger]);
  const hasSplitInPresets = useMemo(() => presetHasTollParking(categoryPresets), [categoryPresets]);
  const hasTransportGroup = useMemo(
    () => !!categoryPresets.expenseDetails?.find((g) => g.main === TP_PARENT),
    [categoryPresets]
  );
  // 분류 불가로 '통행·주차'에 남는 항목 수 (예: '휘발유') — 안내용
  const unsplitCount = useMemo(() => countUnsplitSource(ledger), [ledger]);
  const unclassifiedCount = Math.max(0, unsplitCount - candidates.length);

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

  const selected = useMemo(
    () => candidates.filter((c) => !excluded.has(c.entry.id)),
    [candidates, excluded]
  );
  const tollCount = useMemo(() => selected.filter((c) => c.target === TOLL).length, [selected]);
  const parkingCount = useMemo(() => selected.filter((c) => c.target === PARKING).length, [selected]);
  const selectedSum = useMemo(() => selected.reduce((s, c) => s + (c.entry.amount || 0), 0), [selected]);

  const fullyMigrated = hasSplitInPresets && candidates.length === 0;
  const canApply = (selected.length > 0 || !hasSplitInPresets) && hasTransportGroup;

  const apply = () => {
    if (!canApply) return;
    const idToTarget = new Map<string, TPTarget>();
    for (const c of selected) idToTarget.set(c.entry.id, c.target);

    // 재분류 후 '통행·주차'에 남는 항목이 있으면 프리셋에서 소스를 지우지 않는다(고아 분류 방지).
    const nextLedger = applyTollParkingSplit(ledger, idToTarget);
    const sourceRemains = nextLedger.some(
      (l) => l.kind === "expense" && l.subCategory === TP_PARENT && l.detailCategory === TP_SOURCE
    );

    // 1. 프리셋 업데이트 (톨비·주차비 추가, 잔여 없으면 통행·주차 제거) — 먼저(별도 undo 단계)
    onChangeCategoryPresets(applyTollParkingToPresets(categoryPresets, !sourceRemains));
    // 2. ledger 재분류
    if (idToTarget.size > 0) onChangeLedger(nextLedger);
  };

  const targetBadge = (target: TPTarget) => (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 10,
        // 색 의미는 중립 — 톨비/주차비 구분 가독성용. 톨비=보라, 주차비=청록 계열 변수 재사용.
        background: target === TOLL ? "var(--primary-light)" : "var(--accent-light)",
        color: target === TOLL ? "var(--primary)" : "var(--accent)",
        whiteSpace: "nowrap",
      }}
    >
      {target}
    </span>
  );

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
        aria-labelledby="tollparking-split-title"
        style={{ maxWidth: 680, width: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 0 }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 id="tollparking-split-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🅿️ 통행·주차 분리</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              유류교통비 "통행·주차"를 <strong>톨비</strong> / <strong>주차비</strong>로 분리. 프리셋 추가 + 기존 항목 재분류를 한 번에.
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
            <div style={{ padding: "16px 18px", background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: 8, color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
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
            <div style={{ padding: "24px 18px", textAlign: "center", color: "var(--success)", background: "var(--primary-light)", border: "1px solid var(--success)", borderRadius: 10 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>이미 적용되어 있습니다</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                프리셋에 '톨비'·'주차비'가 있고, 재분류할 통행·주차 항목도 없습니다.
              </div>
            </div>
          )}

          {/* 작업 미리보기 */}
          {hasTransportGroup && !fullyMigrated && (
            <>
              {/* 프리셋 변경 표시 */}
              <div style={{ padding: "12px 14px", background: hasSplitInPresets ? "var(--primary-light)" : "var(--accent-light)", border: `1px solid ${hasSplitInPresets ? "var(--success)" : "var(--accent)"}`, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: hasSplitInPresets ? "var(--success)" : "var(--accent)" }}>
                  ① 카테고리 프리셋 변경
                </div>
                {hasSplitInPresets ? (
                  <div style={{ color: "var(--success)" }}>
                    ✓ 이미 유류교통비.subs에 '톨비'·'주차비' 있음 — 변경 없음
                  </div>
                ) : (
                  <div style={{ color: "var(--accent)", lineHeight: 1.6 }}>
                    유류교통비.subs에 <strong>'톨비'</strong>·<strong>'주차비'</strong>를 '통행·주차' 다음에 추가합니다.
                    {unclassifiedCount === 0 && " (분리 후 '통행·주차'는 제거)"}
                  </div>
                )}
              </div>

              {/* 재분류 후보 */}
              <div style={{ padding: "12px 14px", background: candidates.length > 0 ? "var(--warning-bg)" : "var(--primary-light)", border: `1px solid ${candidates.length > 0 ? "var(--warning)" : "var(--success)"}`, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: candidates.length > 0 ? "var(--warning)" : "var(--success)" }}>
                  ② Ledger 재분류 — {candidates.length}건 검출 (톨비 {tollCount} · 주차비 {parkingCount})
                </div>
                {candidates.length === 0 ? (
                  <div style={{ color: "var(--success)" }}>
                    ✓ 재분류할 통행·주차 항목이 없습니다 — 이미 모두 처리됨 또는 해당 항목 없음
                  </div>
                ) : (
                  <div style={{ color: "var(--text)", lineHeight: 1.6 }}>
                    description이 <strong>주차</strong>면 주차비, <strong>톨·하이패스·통행</strong>이면 톨비로 detailCategory를 바꿉니다. 체크박스로 제외 가능.
                  </div>
                )}
              </div>

              {/* 분류 보류 안내 */}
              {unclassifiedCount > 0 && (
                <div style={{ padding: "10px 14px", background: "var(--surface-hover)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  ⏸ 톨·주차로 판단되지 않는 <strong>{unclassifiedCount}건</strong>(예: '휘발유')은 그대로 '통행·주차'에 둡니다.
                  이 경우 '통행·주차' 소분류는 프리셋에 남겨둡니다.
                </div>
              )}

              {/* 후보 리스트 */}
              {candidates.length > 0 && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ padding: "10px 14px", background: "var(--surface-hover)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                    <span>선택 {selected.length}/{candidates.length}건</span>
                    <span>합 {formatKRW(selectedSum)}</span>
                  </div>
                  <div style={{ maxHeight: 280, overflowY: "auto" }}>
                    {candidates.map((c) => {
                      const l = c.entry;
                      const checked = !excluded.has(l.id);
                      return (
                        <label
                          key={l.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 14px",
                            borderBottom: "1px solid var(--border-light)",
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
                          {targetBadge(c.target)}
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", minWidth: 90, textAlign: "right" }}>
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
                {!hasSplitInPresets && selected.length === 0
                  ? "프리셋만 추가"
                  : selected.length === 0 && hasSplitInPresets
                    ? "변경 사항 없음"
                    : `적용 (${selected.length}건${!hasSplitInPresets ? " + 프리셋" : ""})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
