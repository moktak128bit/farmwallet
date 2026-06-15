/**
 * 고정 지출/구독 추가·수정 폼 (two-column 왼쪽 카드).
 * BudgetRecurringView에서 분리 — recForm/editingRecurringId 상태를 이 컴포넌트가 소유해
 * 폼 타이핑이 부모(BudgetRecurringView)를 재렌더하지 않는다.
 * React.memo(forwardRef)로 감싸 폼과 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *
 * 부모 → 폼 외부 접점은 ref API(RecurringFormCardHandle)로 노출:
 *   - notifyRecurringDeleted(id): 목록에서 항목 삭제 시 — 해당 항목을 수정 중이었다면 수정 모드 해제
 *   - startEditRecurring(item): 목록의 "수정" 버튼 → 폼을 해당 항목 수정 모드로 전환
 */
import React, { useImperativeHandle, useState } from "react";
import type { Account, Recurrence, RecurringExpense } from "../../types";
import { getTodayKST } from "../../utils/date";
import { newIdWithPrefix } from "../../utils/id";

const createRecurring = (): RecurringExpense => ({
  id: newIdWithPrefix("R"),
  title: "",
  amount: 0,
  category: "",
  frequency: "monthly",
  startDate: getTodayKST(), // UTC 파싱 함정 회피 — KST 00:00~08:59에 전날로 기록되는 문제 방지
  fromAccountId: undefined,
  toAccountId: undefined
});

/** 부모(BudgetRecurringView)에서 ref로 호출하는 폼 외부 접점 */
export interface RecurringFormCardHandle {
  notifyRecurringDeleted: (id: string) => void;
  startEditRecurring: (item: RecurringExpense) => void;
}

interface Props {
  accounts: Account[];
  recurring: RecurringExpense[];
  onChangeRecurring: (next: RecurringExpense[]) => void;
}

export const RecurringFormCard = React.memo(React.forwardRef<RecurringFormCardHandle, Props>(
  function RecurringFormCard({ accounts, recurring, onChangeRecurring }, ref) {
    const [recForm, setRecForm] = useState<RecurringExpense>(createRecurring);
    const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);

    const addRecurring = () => {
      if (!recForm.title || !recForm.amount) return;
      if (editingRecurringId) {
        // 수정 모드
        onChangeRecurring(recurring.map((r) => (r.id === editingRecurringId ? recForm : r)));
        setEditingRecurringId(null);
      } else {
        // 추가 모드
        onChangeRecurring([recForm, ...recurring]);
      }
      setRecForm(createRecurring());
    };

    const cancelEdit = () => {
      setRecForm(createRecurring());
      setEditingRecurringId(null);
    };

    useImperativeHandle(ref, () => ({
      notifyRecurringDeleted: (id: string) => {
        if (editingRecurringId === id) {
          setEditingRecurringId(null);
          setRecForm(createRecurring());
        }
      },
      // 목록 "수정" 버튼 → 폼을 수정 모드로 전환 (id 유지 — 저장 시 같은 항목 교체)
      startEditRecurring: (item: RecurringExpense) => {
        setRecForm({ ...item });
        setEditingRecurringId(item.id);
      }
    }), [editingRecurringId]);

    return (
      <div className="card form-grid">
        <h3>{editingRecurringId ? "고정 지출/구독 수정" : "고정 지출/구독 추가"}</h3>
        <label>
          <span>제목</span>
          <input
            value={recForm.title}
            onChange={(e) => setRecForm({ ...recForm, title: e.target.value })}
            placeholder="예: 넷플릭스"
          />
        </label>
        <label>
          <span>금액</span>
          <input
            type="number"
            value={recForm.amount || ""}
            onChange={(e) => setRecForm({ ...recForm, amount: Number(e.target.value) || 0 })}
            placeholder="17000"
          />
        </label>
        <label>
          <span>카테고리</span>
          <input
            value={recForm.category}
            onChange={(e) => setRecForm({ ...recForm, category: e.target.value })}
            placeholder="구독비"
          />
        </label>
        <label>
          <span>주기</span>
          <select
            value={recForm.frequency}
            onChange={(e) => setRecForm({ ...recForm, frequency: e.target.value as Recurrence })}
          >
            <option value="weekly">매주</option>
            <option value="monthly">매월</option>
            <option value="yearly">매년</option>
          </select>
        </label>
        <label>
          <span>시작일</span>
          <input
            type="date"
            value={recForm.startDate}
            onChange={(e) => setRecForm({ ...recForm, startDate: e.target.value })}
          />
        </label>
        <label>
          <span>출금 계좌</span>
          <select
            value={recForm.fromAccountId || ""}
            onChange={(e) => setRecForm({ ...recForm, fromAccountId: e.target.value || undefined })}
          >
            <option value="">선택</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.id} - {acc.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>입금 계좌 (저축성지출/이체용)</span>
          <select
            value={recForm.toAccountId || ""}
            onChange={(e) => setRecForm({ ...recForm, toAccountId: e.target.value || undefined })}
          >
            <option value="">선택</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.id} - {acc.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          {editingRecurringId && (
            <button type="button" className="secondary" onClick={cancelEdit}>
              취소
            </button>
          )}
          <button type="button" className="primary" onClick={addRecurring}>
            {editingRecurringId ? "수정" : "추가"}
          </button>
        </div>
      </div>
    );
  }
));
