/**
 * 헤더 "반복지출 N건 미등록" 배지 클릭 → 미등록 항목 체크리스트 → "가계부에 반영" 원클릭 모달.
 *
 * 반영 경로는 예산 탭과 동일한 utils/recurringGenerate(generate + filterDuplicate)를 **반드시** 거친다 —
 * 배지 판정(마감일~오늘 윈도우, 금액 ±1) ≠ 생성 dedup(같은 달, 금액 ±100)이라
 * 배지 목록을 LedgerEntry로 직접 조립해 삽입하면 같은 달 중복 생성이 난다.
 * 각 항목은 마감일이 속한 달 기준으로 생성하고, 마감일과 같은 날짜의 발생만 후보로 삼는다
 * (연간 grace로 전월 기념일이 떠 있는 1월, 주간이 월 경계를 넘는 경우 대응).
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { LedgerEntry, RecurringExpense } from "../types";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";
import { useAppStore } from "../store/appStore";
import {
  filterDuplicateOccurrences,
  generateOccurrencesForMonthFromRecurring,
  getDefaultExpenseCategory
} from "../utils/recurringGenerate";

interface RecurringDueCandidateItem {
  recurring: RecurringExpense;
  /** 배지 판정 마감일(yyyy-mm-dd) — 이 날짜의 발생만 생성 후보 */
  dueDate: string;
}

interface Props {
  isOpen: boolean;
  items: RecurringDueCandidateItem[];
  onClose: () => void;
  /** 생성된 항목 일괄 반영(부모가 setDataWithHistory 1회) — 반영된 id 목록은 호출 측에서 undo 토스트에 사용 */
  onApply: (entries: LedgerEntry[]) => void;
  /** "예산 탭에서 자세히" */
  onGoBudget?: () => void;
}

/**
 * 배지 항목 → 생성 후보 LedgerEntry (현재 ledger 기준 중복 제거 후 마감일과 같은 날짜의 발생).
 * 중복으로 걸러지면 null — 이미 같은 달에 반영된 것으로 본다.
 */
function buildCandidate(
  item: RecurringDueCandidateItem,
  ledger: LedgerEntry[],
  defaultExpenseCategory: string
): LedgerEntry | null {
  const month = item.dueDate.slice(0, 7);
  const occurrences = generateOccurrencesForMonthFromRecurring([item.recurring], month, defaultExpenseCategory);
  const deduped = filterDuplicateOccurrences(occurrences, ledger, month);
  return deduped.find((e) => e.date === item.dueDate) ?? null;
}

export const RecurringDuePopover: React.FC<Props> = ({ isOpen, items, onClose, onApply, onGoBudget }) => {
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
  const isTopModal = useModalStackEntry(isOpen);
  const categoryPresets = useAppStore((s) => s.data.categoryPresets);
  const ledger = useAppStore((s) => s.data.ledger);
  const defaultExpenseCategory = useMemo(() => getDefaultExpenseCategory(categoryPresets), [categoryPresets]);

  // 미리보기 후보 — 금액/날짜 표시용. 실제 반영 시점엔 최신 ledger로 재생성(stale 이중 생성 방지)
  const candidates = useMemo(
    () =>
      items.map((item) => ({
        item,
        candidate: buildCandidate(item, ledger, defaultExpenseCategory)
      })),
    [items, ledger, defaultExpenseCategory]
  );
  const applicable = useMemo(() => candidates.filter((c) => c.candidate !== null), [candidates]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 열릴 때 기본 전체 체크(생성 가능한 항목만)
  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set(applicable.map((c) => c.item.recurring.id)));
    // applicable은 ledger 변화로도 바뀌지만 열린 뒤 사용자의 체크 선택을 덮지 않도록 isOpen에만 반응
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // 모달 중첩 시 최상위 모달만 ESC로 닫힘
      if (e.key === "Escape" && isTopModal()) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, isTopModal]);

  if (!isOpen) return null;

  const selectedCount = applicable.filter((c) => selected.has(c.item.recurring.id)).length;
  const allChecked = applicable.length > 0 && selectedCount === applicable.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    const chosen = items.filter((it) => selected.has(it.recurring.id));
    if (chosen.length === 0) {
      toast.error("반영할 항목을 선택해주세요.");
      return;
    }
    // 확인 시점의 최신 ledger로 재생성 — 미리보기 이후 다른 경로(예산 탭·수동 입력·탭 동기화)로
    // 들어온 항목과 재대조해 stale 스냅샷 이중 생성을 막는다.
    const latestLedger = useAppStore.getState().data.ledger;
    const entries: LedgerEntry[] = [];
    for (const it of chosen) {
      const e = buildCandidate(it, latestLedger, defaultExpenseCategory);
      if (e) entries.push(e);
    }
    if (entries.length === 0) {
      toast.error("이미 모두 반영되어 추가할 항목이 없습니다.");
      onClose();
      return;
    }
    onApply(entries);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-due-title"
        style={{ maxWidth: 440, padding: "22px 24px" }}
      >
        <div className="modal-header" style={{ marginBottom: 12 }}>
          <h3 id="recurring-due-title" style={{ margin: 0, fontSize: 16 }}>
            미등록 반복지출 {items.length}건
          </h3>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>

        {applicable.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => {
                if (e.target.checked) setSelected(new Set(applicable.map((c) => c.item.recurring.id)));
                else setSelected(new Set());
              }}
            />
            전체 선택 ({selectedCount}/{applicable.length})
          </label>
        )}

        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "50vh", overflowY: "auto" }}>
          {candidates.map(({ item, candidate }) => {
            const id = item.recurring.id;
            const disabled = candidate === null;
            return (
              <li
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 6px",
                  borderTop: "1px solid var(--border)",
                  fontSize: 14,
                  opacity: disabled ? 0.55 : 1
                }}
              >
                <input
                  type="checkbox"
                  checked={!disabled && selected.has(id)}
                  disabled={disabled}
                  onChange={() => toggle(id)}
                  aria-label={`${item.recurring.title} 반영`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.recurring.title || "(제목 없음)"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {candidate ? candidate.date : item.dueDate}
                    {" · "}
                    {candidate ? candidate.subCategory || candidate.category : item.recurring.category || "-"}
                    {disabled && " · 같은 달에 이미 반영됨"}
                  </div>
                </div>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", color: "var(--accent)" }}>
                  {Math.round(item.recurring.amount).toLocaleString()}원
                </div>
              </li>
            );
          })}
        </ul>

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
          {onGoBudget ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onGoBudget();
              }}
              style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
            >
              예산 탭에서 자세히
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="primary" onClick={handleApply} disabled={selectedCount === 0}>
            가계부에 반영 ({selectedCount}건)
          </button>
        </div>
      </div>
    </div>
  );
};
