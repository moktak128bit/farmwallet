/**
 * 자주 쓰는 거래(템플릿) 관리 모달 — PresetModal(src/features/stocks) 구조 미러.
 * confirm/토스트 등 삭제 UX는 부모(LedgerEntryForm)의 deleteTemplate이 수행한다.
 */
import type { LedgerTemplate } from "../../types";

const kindLabel: Record<LedgerTemplate["kind"], string> = { income: "수입", expense: "지출", transfer: "이체" };

interface Props {
  templates: LedgerTemplate[];
  onClose: () => void;
  onApply: (t: LedgerTemplate) => void;   // 적용 후 모달 닫기는 이 컴포넌트가 onClose 호출
  onDelete: (t: LedgerTemplate) => void;  // confirm+toast는 부모(폼)의 deleteTemplate이 수행
}

export function LedgerTemplateManageModal({ templates, onClose, onApply, onDelete }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>자주 쓰는 거래 관리</h3>
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
                      <td className="number">{t.amount?.toLocaleString() ?? "-"}</td>
                      <td>{t.fromAccountId || "-"}</td>
                      <td>{t.toAccountId || "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            onApply(t);
                            onClose();
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
