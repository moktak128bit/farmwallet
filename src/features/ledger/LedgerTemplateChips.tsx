/**
 * 자주 쓰는 거래(템플릿) 칩 행 — LedgerEntryForm 내부 전용.
 * React.memo — 부모가 넘기는 콜백은 안정적(useCallback)이어야 memo가 효과를 가진다.
 * 부모(폼)는 form을 deps에 넣지 않은(latest-ref) 콜백을 전달해 타이핑 중 재렌더를 막는다.
 */
import React, { useMemo } from "react";
import type { LedgerTemplate } from "../../types";
import { describeSuggestion, type DescriptionSuggestion } from "../../utils/ledgerSuggest";

const kindLabel: Record<LedgerTemplate["kind"], string> = { income: "수입", expense: "지출", transfer: "이체" };

/** 템플릿 표시 순서 — lastUsed desc(최근 사용 먼저) → 미사용은 등록순. 원본 배열은 건드리지 않는다. */
export function sortTemplatesByLastUsed(templates: LedgerTemplate[]): LedgerTemplate[] {
  return templates
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const la = a.t.lastUsed || "";
      const lb = b.t.lastUsed || "";
      if (la !== lb) return la > lb ? -1 : 1; // 빈 문자열(미사용)은 뒤로
      return a.i - b.i;
    })
    .map((x) => x.t);
}

interface Props {
  templates: LedgerTemplate[];
  onApply: (t: LedgerTemplate) => void;
  onSaveCurrent: () => void;
  onOpenManage: () => void;
}

export const LedgerTemplateChips = React.memo(function LedgerTemplateChips({
  templates, onApply, onSaveCurrent, onOpenManage
}: Props) {
  const sorted = useMemo(() => sortTemplatesByLastUsed(templates), [templates]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {templates.length > 0 && (
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>자주 쓰는 거래</span>
      )}
      {sorted.map((t) => {
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

interface RecentProps {
  /** 최근 30일 상위 설명 그룹 (ledgerSuggest.recentDescriptionGroups) */
  groups: DescriptionSuggestion[];
  /** 클릭 → 부모가 startCopy(g.lastEntry) 재사용 */
  onPick: (g: DescriptionSuggestion) => void;
}

/**
 * 최근 거래 칩 — 설명 인덱스에서 최근 30일 상위 6건. 템플릿과 달리 저장 없이 과거 항목을 그대로 폼에 적재한다.
 * React.memo — groups는 부모가 useMemo로, onPick은 useCallback으로 넘긴다.
 */
export const LedgerRecentChips = React.memo(function LedgerRecentChips({ groups, onPick }: RecentProps) {
  if (groups.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>최근 거래</span>
      {groups.map((g) => {
        const detail = describeSuggestion(g);
        return (
          <button
            key={`${g.kind}|${g.description}`}
            type="button"
            tabIndex={-1}
            className="secondary"
            onClick={() => onPick(g)}
            title={`${kindLabel[g.kind]} / ${detail || "-"} / 최근 30일 ${g.count}회 (마지막 ${g.lastDate})`}
            style={{ fontSize: 12, padding: "6px 12px", maxWidth: 220, display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
              {g.description}
            </span>
            {detail ? (
              <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>
                · {detail}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
});
