/**
 * 삭제 토스트 [실행 취소] 공용 헬퍼 — restore-by-id 재삽입 방식.
 * 풀 스냅샷 언두와 달리, 삭제 이후 다른 변경(시세 갱신·동기화·편집)이 끼어도
 * 그 변경을 보존한 채 삭제된 항목만 되살린다. 같은 id가 이미 존재하면 no-op(false).
 */
import { toast } from "react-hot-toast";

/**
 * 삭제된 항목을 원래 위치에 재삽입하는 복원 함수를 만든다.
 * - getList: 복원 시점의 최신 배열을 읽는 함수 (예: () => useAppStore.getState().data.ledger)
 * - apply: 새 배열을 저장하는 기존 안정 콜백 (onChange* — 새 히스토리 write)
 * - index: 삭제 전 원 인덱스 — 범위 내면 그 자리에 splice, 아니면 push
 * 반환: 복원 성공 여부 (이미 같은 id가 있으면 false)
 */
export function buildRestoreById<T extends { id: string }>(
  getList: () => T[] | undefined,
  apply: (next: T[]) => void,
  item: T,
  index?: number
): () => boolean {
  return () => {
    const list = getList() ?? [];
    if (list.some((x) => x.id === item.id)) return false;
    const next = [...list];
    if (index != null && index >= 0 && index <= next.length) next.splice(index, 0, item);
    else next.push(item);
    apply(next);
    return true;
  };
}

/** 삭제 성공 토스트 + [실행 취소] 버튼. 버튼은 더블클릭/더블탭 가드 포함. */
export function showDeleteUndoToast(message: string, restore: () => boolean): void {
  let handled = false; // 더블클릭/더블탭 가드
  toast.success(
    (t) => (
      <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>{message}</span>
        <button
          type="button"
          className="primary"
          style={{ padding: "6px 14px", fontSize: 13, flexShrink: 0 }}
          onClick={() => {
            if (handled) return;
            handled = true;
            toast.dismiss(t.id);
            if (restore()) {
              toast.success("삭제를 되돌렸습니다.", { id: "delete-undo-result" });
            } else {
              toast.error("이미 복원되었거나 데이터가 변경되어 되돌릴 수 없습니다.", { id: "delete-undo-result" });
            }
          }}
        >
          실행 취소
        </button>
      </span>
    ),
    { id: "delete-undo", duration: 7000 }
  );
}
