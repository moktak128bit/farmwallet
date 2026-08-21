/**
 * 자주 쓰는 거래(템플릿) 관리 모달 — PresetModal(src/features/stocks) 구조 미러.
 * confirm/토스트 등 삭제 UX는 부모(LedgerEntryForm)의 deleteTemplate이 수행한다.
 * 접근성: 포커스 트랩 + ESC 닫기 + role="dialog" (다른 모달들과 동일 패턴).
 */
import { useEffect } from "react";
import type { LedgerTemplate } from "../../types";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";
import { formatNumber } from "../../utils/formatter";

const kindLabel: Record<LedgerTemplate["kind"], string> = { income: "수입", expense: "지출", transfer: "이체" };

interface Props {
  templates: LedgerTemplate[];
  onClose: () => void;
  /** 적용 성공 여부 반환 — false(사용자가 confirm 취소)면 모달을 닫지 않는다 */
  onApply: (t: LedgerTemplate) => boolean;
  onDelete: (t: LedgerTemplate) => void;  // confirm+undo 토스트는 부모(폼)의 deleteTemplate이 수행
}

export function LedgerTemplateManageModal({ templates, onClose, onApply, onDelete }: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const isTopModal = useModalStackEntry(true);

  // ESC로 닫기 — 모달 중첩 시 최상위만
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && isTopModal()) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, isTopModal]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-template-manage-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="ledger-template-manage-title" style={{ margin: 0 }}>자주 쓰는 거래 관리</h3>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-body">
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {templates.length === 0 ? (
              <p className="hint">저장된 템플릿이 없습니다.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>종류</th>
                    <th>카테고리</th>
                    <th>금액</th>
                    <th>출금</th>
                    <th>입금</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{kindLabel[t.kind]}</td>
                      <td>{[t.mainCategory, t.subCategory].filter(Boolean).join(" > ") || "-"}</td>
                      <td className="number">{t.amount != null ? formatNumber(t.amount) : "-"}</td>
                      <td>{t.fromAccountId || "-"}</td>
                      <td>{t.toAccountId || "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            // 적용 성공 시에만 닫는다 — 수정/입력 중 confirm을 취소했는데도 모달이
                            // 닫혀 작업 흐름이 끊기던 문제 수정
                            if (onApply(t)) onClose();
                          }}
                          style={{ marginRight: 6, fontSize: 13, padding: "6px 12px" }}
                        >
                          적용
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => onDelete(t)}
                          style={{ fontSize: 13, padding: "6px 12px" }}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
