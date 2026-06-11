/**
 * 자주 쓰는 거래(템플릿) 칩 행 — LedgerEntryForm 내부 전용.
 * React.memo — 부모가 넘기는 콜백은 안정적(useCallback)이어야 memo가 효과를 가진다.
 * 부모(폼)는 form을 deps에 넣지 않은(latest-ref) 콜백을 전달해 타이핑 중 재렌더를 막는다.
 */
import React from "react";
import type { LedgerTemplate } from "../../types";

const kindLabel: Record<LedgerTemplate["kind"], string> = { income: "수입", expense: "지출", transfer: "이체" };

interface Props {
  templates: LedgerTemplate[];
  onApply: (t: LedgerTemplate) => void;
  onSaveCurrent: () => void;
  onOpenManage: () => void;
}

export const LedgerTemplateChips = React.memo(function LedgerTemplateChips({
  templates, onApply, onSaveCurrent, onOpenManage
}: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {templates.length > 0 && (
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>자주 쓰는 거래</span>
      )}
      {templates.map((t) => {
        const cat = [t.mainCategory, t.subCategory].filter(Boolean).join(" > ") || "-";
        const acct = [t.fromAccountId, t.toAccountId].filter(Boolean).join(" → ");
        return (
          <button
            key={t.id}
            type="button"
            tabIndex={-1}
            className="secondary"
            onClick={() => onApply(t)}
            title={`${kindLabel[t.kind]} / ${cat}${acct ? ` / ${acct}` : ""}`}
            style={{ fontSize: 12, padding: "6px 12px", maxWidth: 200 }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
              {t.name}
            </span>
            {t.amount ? (
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {t.amount.toLocaleString()}원</span>
            ) : null}
          </button>
        );
      })}
      <button type="button" tabIndex={-1} className="secondary" onClick={onSaveCurrent} style={{ fontSize: 11, padding: "4px 8px" }}>
        템플릿으로 저장
      </button>
      {templates.length > 0 && (
        <button type="button" tabIndex={-1} className="secondary" onClick={onOpenManage} style={{ fontSize: 11, padding: "4px 8px" }}>
          관리
        </button>
      )}
    </div>
  );
});
