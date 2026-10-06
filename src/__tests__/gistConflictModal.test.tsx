// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { GistConflictModal } from "../components/GistConflictModal";
import type { GistConflict } from "../store/uiStore";

const base: GistConflict = {
  remoteDataJson: JSON.stringify({ ledger: [{ date: "2026-10-01", amount: 1000 }], trades: [], accounts: [] }),
  remoteUpdatedAt: "2026-10-02T01:00:00Z",
  pendingLocalDataJson: JSON.stringify({ ledger: [], trades: [], accounts: [] }),
};

describe("GistConflictModal — 충돌 사유별 안내", () => {
  afterEach(() => cleanup());

  it("기본: '자동' 없이 저장 직전 다른 기기 변경으로 안내하고 원격 적용을 권장", () => {
    render(<GistConflictModal conflict={base} onResolve={vi.fn()} />);
    expect(screen.getByText("저장 직전에 원격 Gist가 다른 기기에서 변경되었습니다. 어떻게 처리할지 선택하세요.")).toBeTruthy();
    expect(screen.getByText("원격 적용 (권장)")).toBeTruthy();
    expect(screen.getByText("이 기기 데이터로 덮어쓰기 (주의)")).toBeTruthy();
    expect(screen.getByText("저장하려던 데이터")).toBeTruthy();
    expect(screen.queryByText(/로컬 강제 푸시|push 대기 중/)).toBeNull();
  });

  it("never-synced: 아직 불러온 적 없는 기기라고 안내하고 원격 적용을 권장", () => {
    render(<GistConflictModal conflict={{ ...base, reason: "never-synced" }} onResolve={vi.fn()} />);
    expect(screen.getByText(/이 기기는 아직 이 Gist에서 데이터를 불러온 적이 없습니다/)).toBeTruthy();
    expect(screen.queryByText(/다른 기기에서 변경되었습니다/)).toBeNull();
    expect(screen.getByText("원격 적용 (권장)")).toBeTruthy();
  });

  it("restored: 복원 상태라고 안내하고 원격 적용(=복원 취소)을 권장하지 않는다", () => {
    render(<GistConflictModal conflict={{ ...base, reason: "restored" }} onResolve={vi.fn()} />);
    expect(screen.getByText(/Gist 과거 버전을 복원한 상태입니다/)).toBeTruthy();
    expect(screen.queryByText("원격 적용 (권장)")).toBeNull();
    expect(screen.getByText("원격 적용")).toBeTruthy();
  });
});

describe("GistConflictModal — 해결 진행 중 잠금", () => {
  afterEach(() => cleanup());

  it("ESC는 평소엔 취소로 해결한다", () => {
    const onResolve = vi.fn();
    render(<GistConflictModal conflict={base} onResolve={onResolve} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onResolve).toHaveBeenCalledWith("cancel");
  });

  it("onResolve가 끝나기 전(busy)에는 ESC·다른 버튼이 다른 선택을 겹쳐 부르지 않는다", async () => {
    let finish: () => void = () => {};
    const onResolve = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<GistConflictModal conflict={base} onResolve={onResolve} />);
    await act(async () => {
      fireEvent.click(screen.getByText("원격 적용 (권장)"));
    });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenLastCalledWith("apply-remote");

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByText("이 기기 데이터로 덮어쓰기 (주의)"));
    expect(onResolve).toHaveBeenCalledTimes(1);

    // 끝나면 다시 고를 수 있다(낡은 모달 가드가 모달을 최신본으로 바꿔 남긴 경우)
    await act(async () => {
      finish();
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onResolve).toHaveBeenCalledTimes(2);
    expect(onResolve).toHaveBeenLastCalledWith("cancel");
  });

  it("busy 중 무시한 ESC는 preventDefault로 거부를 알린다 — 뒤로가기가 즉시 모달 항목을 되살리게 (Q4)", async () => {
    let finish: () => void = () => {};
    const onResolve = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<GistConflictModal conflict={base} onResolve={onResolve} />);
    // 평소 ESC는 거부가 아니다(취소로 닫힘)
    const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    expect(window.dispatchEvent(idle)).toBe(true);
    expect(onResolve).toHaveBeenCalledWith("cancel");
    await act(async () => {
      finish();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("원격 적용 (권장)"));
    });
    const busyEsc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    expect(window.dispatchEvent(busyEsc)).toBe(false);
    expect(onResolve).toHaveBeenCalledTimes(2);
    await act(async () => {
      finish();
    });
  });
});
