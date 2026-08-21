/**
 * '덮어쓰기 적용' 공용 게이트 (1-6/1-10).
 *
 * 백업 복원·JSON/파일 가져오기·드래프트 복구·Gist 수동 pull이 window.confirm 대신 이걸 쓴다.
 * requestApply(before, after, ...)를 호출하면:
 *  - 차이 없음(hasChanges=false) → 모달 없이 즉시 onConfirm 실행 (되돌릴 것도 없는 덮어쓰기는 매번
 *    확인창을 띄우면 습관적 [확인] 클릭을 유발할 뿐이라 생략한다)
 *  - 차이 있음 → uiStore.pendingApply에 요약을 세팅해 이 모달이 렌더됨. [적용] 클릭 시에만 onConfirm.
 * 각 게이트는 스냅샷(saveSafetySnapshot)·정규화된 데이터 반영을 스스로 onConfirm 안에서 수행한다
 * (이 모달은 diff를 보여주고 실행 여부만 결정 — "위험 작업 confirm" 컨벤션을 대체).
 */
import React, { useEffect } from "react";
import type { AppData } from "../types";
import { useUIStore } from "../store/uiStore";
import { buildApplySummary, type ApplyDiff } from "../utils/applySummary";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";

interface RequestApplyOptions {
  /** 모달 제목 — 게이트별 문구 */
  title: string;
  /** 현재(적용 전) 데이터 */
  before: AppData;
  /** 정규화 완료된, 적용될 데이터 */
  after: AppData;
  /** [적용] 클릭(또는 차이 없어 즉시 통과) 시 실행 — 스냅샷·실제 반영은 호출부 책임 */
  onConfirm: () => void;
  /** [취소]/ESC 시 실행 (선택) */
  onCancel?: () => void;
  /** true면 "복구" 성격(드래프트 복구) — [적용] 버튼에 기본 포커스 */
  defaultFocusConfirm?: boolean;
}

/**
 * 게이트 호출부의 공용 진입점. 차이가 없으면 모달을 생략하고 즉시 적용한다.
 */
export function requestApply(options: RequestApplyOptions): void {
  const summary = buildApplySummary(options.before, options.after);
  if (!summary.hasChanges) {
    options.onConfirm();
    return;
  }
  useUIStore.getState().setPendingApply({
    title: options.title,
    summary,
    onConfirm: options.onConfirm,
    onCancel: options.onCancel,
    defaultFocusConfirm: options.defaultFocusConfirm
  });
}

const COLLECTION_LABEL: Record<string, string> = {
  accounts: "계좌",
  ledger: "가계부",
  trades: "주식 거래",
  loans: "대출",
  recurringExpenses: "반복 지출",
  budgetGoals: "예산 목표",
  customSymbols: "커스텀 종목",
  ledgerTemplates: "가계부 템플릿",
  stockPresets: "주식 프리셋",
  targetPortfolios: "목표 포트폴리오",
  workoutWeeks: "운동 주차",
  workoutRoutines: "운동 루틴",
  customExercises: "커스텀 운동",
  isaPortfolio: "ISA 포트폴리오"
};

function formatKrw(n: number): string {
  return `${Math.round(n).toLocaleString()}원`;
}

/** 건수·합계가 실제로 달라진 컬렉션/kind만 걸러 표에 보여준다 — 변화 없는 행은 노이즈. */
function changedCollectionRows(diff: ApplyDiff) {
  return Object.entries(diff.collections)
    .filter(([, c]) => c.added > 0 || c.removed > 0 || c.changed > 0)
    .map(([name, c]) => ({ name, label: COLLECTION_LABEL[name] ?? name, ...c }));
}

function changedKindRows(diff: ApplyDiff) {
  return Object.entries(diff.ledgerAmountByKind)
    .filter(([, v]) => v.before !== v.after)
    .map(([kind, v]) => ({ kind, ...v }));
}

/** props 없음 — uiStore.pendingApply를 직접 읽고 쓴다 (GistConflictModal과 달리 App은 렌더 줄만 추가) */
export const ApplyConfirmModal: React.FC = () => {
  const pendingApply = useUIStore((s) => s.pendingApply);
  const setPendingApply = useUIStore((s) => s.setPendingApply);
  const trapRef = useFocusTrap<HTMLDivElement>(!!pendingApply);
  const isTopModal = useModalStackEntry(!!pendingApply);

  const handleCancel = React.useCallback(() => {
    if (!pendingApply) return;
    pendingApply.onCancel?.();
    setPendingApply(null);
  }, [pendingApply, setPendingApply]);

  const handleConfirm = React.useCallback(() => {
    if (!pendingApply) return;
    pendingApply.onConfirm();
    setPendingApply(null);
  }, [pendingApply, setPendingApply]);

  useEffect(() => {
    if (!pendingApply) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopModal()) {
        e.stopPropagation();
        handleCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingApply, isTopModal, handleCancel]);

  if (!pendingApply) return null;

  const { title, summary, defaultFocusConfirm } = pendingApply;
  const { diff } = summary;
  const collectionRows = changedCollectionRows(diff);
  const kindRows = changedKindRows(diff);
  const dateChanged = summary.latestLedgerDateBefore !== summary.latestLedgerDateAfter;
  const totalChanged = diff.ledgerAmountTotal.before !== diff.ledgerAmountTotal.after;
  const tradesTotalChanged = diff.tradesTotalAmount.before !== diff.tradesTotalAmount.after;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-confirm-title"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--overlay-bg)",
        zIndex: "var(--z-modal)" as unknown as number,
        padding: "var(--space-8)"
      }}
    >
      <div
        ref={trapRef}
        className="card"
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          padding: "var(--space-8)"
        }}
      >
        <h3 id="apply-confirm-title" style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>
          {title}
        </h3>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
          적용하면 현재 데이터가 아래 내용으로 바뀝니다. 적용 직전 현재 데이터는 안전 스냅샷으로 보관됩니다.
        </p>

        {summary.newIntegrityErrorCount > 0 && (
          <div
            style={{
              padding: "var(--space-3) var(--space-4)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--danger)",
              background: "var(--danger-light)",
              color: "var(--danger)",
              fontSize: 13,
              fontWeight: 600,
              marginBottom: "var(--space-4)"
            }}
          >
            ⚠ 적용하면 새로 생기는 무결성 오류 {summary.newIntegrityErrorCount}건 (기존에 있던 경고는 제외한
            수치입니다)
          </div>
        )}

        <div style={{ overflowX: "auto", marginBottom: "var(--space-4)" }}>
          <table className="data-table compact" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th>항목</th>
                <th style={{ textAlign: "right" }}>추가</th>
                <th style={{ textAlign: "right" }}>삭제</th>
                <th style={{ textAlign: "right" }}>변경</th>
              </tr>
            </thead>
            <tbody>
              {collectionRows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                    건수 변화 없음
                  </td>
                </tr>
              ) : (
                collectionRows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.label}</td>
                    <td style={{ textAlign: "right" }}>{row.added > 0 ? `+${row.added}` : "-"}</td>
                    <td style={{ textAlign: "right" }}>{row.removed > 0 ? `-${row.removed}` : "-"}</td>
                    <td style={{ textAlign: "right" }}>{row.changed > 0 ? row.changed : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {kindRows.length > 0 && (
          <div style={{ overflowX: "auto", marginBottom: "var(--space-4)" }}>
            <table className="data-table compact" style={{ minWidth: 360 }}>
              <thead>
                <tr>
                  <th>가계부 kind</th>
                  <th style={{ textAlign: "right" }}>이전 합계</th>
                  <th style={{ textAlign: "right" }}>적용 후 합계</th>
                </tr>
              </thead>
              <tbody>
                {kindRows.map((row) => (
                  <tr key={row.kind}>
                    <td>{row.kind}</td>
                    <td style={{ textAlign: "right" }}>{formatKrw(row.before)}</td>
                    <td style={{ textAlign: "right" }}>{formatKrw(row.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ul style={{ margin: "0 0 var(--space-6)", paddingLeft: 18, fontSize: 13, color: "var(--text-muted)" }}>
          <li>
            최신 가계부 날짜: {summary.latestLedgerDateBefore || "—"}
            {dateChanged ? ` → ${summary.latestLedgerDateAfter || "—"}` : " (변화 없음)"}
          </li>
          {totalChanged && (
            <li>
              가계부 금액 합계: {formatKrw(diff.ledgerAmountTotal.before)} → {formatKrw(diff.ledgerAmountTotal.after)}
            </li>
          )}
          {tradesTotalChanged && (
            <li>
              주식 거래 금액 합계: {formatKrw(diff.tradesTotalAmount.before)} → {formatKrw(diff.tradesTotalAmount.after)}
            </li>
          )}
        </ul>

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="secondary"
            autoFocus={!defaultFocusConfirm}
            onClick={handleCancel}
          >
            취소
          </button>
          <button
            type="button"
            className="primary"
            autoFocus={!!defaultFocusConfirm}
            onClick={handleConfirm}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
};
