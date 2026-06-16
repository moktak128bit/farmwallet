import { describe, it, expect, vi, beforeEach } from "vitest";
import type React from "react";

// react-hot-toast 모킹 — showDeleteUndoToast가 넘기는 렌더 함수/옵션을 가로채 검사
vi.mock("react-hot-toast", () => {
  const success = vi.fn();
  const error = vi.fn();
  const dismiss = vi.fn();
  const toast = Object.assign(vi.fn(), { success, error, dismiss });
  return { toast, default: toast };
});

import { toast } from "react-hot-toast";
import { buildRestoreById, showDeleteUndoToast } from "../utils/undoToast";

type Row = { id: string; name: string };

describe("buildRestoreById", () => {
  it("index 미지정 시 말단에 push로 복원한다", () => {
    const list: Row[] = [{ id: "a", name: "A" }];
    const apply = vi.fn();
    const restore = buildRestoreById<Row>(() => list, apply, { id: "b", name: "B" });
    expect(restore()).toBe(true);
    expect(apply).toHaveBeenCalledWith([
      { id: "a", name: "A" },
      { id: "b", name: "B" }
    ]);
  });

  it("index 지정 시 원 위치에 splice로 복원한다", () => {
    const list: Row[] = [
      { id: "a", name: "A" },
      { id: "c", name: "C" }
    ];
    const apply = vi.fn();
    const restore = buildRestoreById<Row>(() => list, apply, { id: "b", name: "B" }, 1);
    expect(restore()).toBe(true);
    expect(apply).toHaveBeenCalledWith([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" }
    ]);
  });

  it("같은 id가 이미 존재하면 false를 반환하고 apply를 호출하지 않는다", () => {
    const list: Row[] = [{ id: "a", name: "A" }];
    const apply = vi.fn();
    const restore = buildRestoreById<Row>(() => list, apply, { id: "a", name: "A2" }, 0);
    expect(restore()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("getList가 undefined를 반환하면 빈 배열로 취급한다", () => {
    const apply = vi.fn();
    const restore = buildRestoreById<Row>(() => undefined, apply, { id: "a", name: "A" });
    expect(restore()).toBe(true);
    expect(apply).toHaveBeenCalledWith([{ id: "a", name: "A" }]);
  });

  it("index가 범위를 벗어나면 push로 폴백한다", () => {
    const list: Row[] = [{ id: "a", name: "A" }];
    const apply = vi.fn();
    const restore = buildRestoreById<Row>(() => list, apply, { id: "b", name: "B" }, 99);
    expect(restore()).toBe(true);
    expect(apply).toHaveBeenCalledWith([
      { id: "a", name: "A" },
      { id: "b", name: "B" }
    ]);
  });

  it("복원 시점의 최신 리스트를 읽는다 (삭제 후 다른 변경 보존)", () => {
    let list: Row[] = [{ id: "a", name: "A" }];
    const apply = vi.fn((next: Row[]) => { list = next; });
    const restore = buildRestoreById<Row>(() => list, apply, { id: "b", name: "B" }, 0);
    // 삭제 후 다른 항목이 추가된 상황
    list = [...list, { id: "c", name: "C" }];
    expect(restore()).toBe(true);
    expect(apply).toHaveBeenCalledWith([
      { id: "b", name: "B" },
      { id: "a", name: "A" },
      { id: "c", name: "C" }
    ]);
  });
});

describe("showDeleteUndoToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** toast.success에 넘겨진 렌더 함수에서 [실행 취소] 버튼 onClick을 추출 */
  function getUndoOnClick(): () => void {
    const renderFn = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      t: { id: string }
    ) => React.ReactElement;
    const el = renderFn({ id: "toast-1" });
    const children = el.props.children as React.ReactElement[];
    const button = children[1];
    return button.props.onClick as () => void;
  }

  it("성공 토스트를 duration 옵션과 함께 띄우고, 고정 id는 쓰지 않는다(연속 삭제 독립 복원)", () => {
    showDeleteUndoToast("삭제했습니다", () => true);
    expect(toast.success).toHaveBeenCalledTimes(1);
    const opts = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts).toMatchObject({ duration: 7000 });
    expect(opts.id).toBeUndefined(); // 고정 id 제거 — 각 토스트가 독립
  });

  it("버튼 클릭 시 토스트를 닫고 복원 성공 토스트를 띄운다", () => {
    const restore = vi.fn(() => true);
    showDeleteUndoToast("삭제했습니다", restore);
    const onClick = getUndoOnClick();
    onClick();
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("삭제를 되돌렸습니다.", { id: "delete-undo-result" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("복원 실패(false) 시 에러 토스트를 띄운다", () => {
    showDeleteUndoToast("삭제했습니다", () => false);
    const onClick = getUndoOnClick();
    onClick();
    expect(toast.error).toHaveBeenCalledWith(
      "이미 복원되었거나 데이터가 변경되어 되돌릴 수 없습니다.",
      { id: "delete-undo-result" }
    );
  });

  it("더블클릭해도 복원은 한 번만 실행된다", () => {
    const restore = vi.fn(() => true);
    showDeleteUndoToast("삭제했습니다", restore);
    const onClick = getUndoOnClick();
    onClick();
    onClick();
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
