// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { MobileDrawer } from "../components/MobileDrawer";

/** 햄버거 버튼 + 드로어 — App.tsx 배선을 최소로 흉내 */
function Harness({ onCloseSpy }: { onCloseSpy?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onCloseSpy?.();
    setOpen(false);
  };
  return (
    <>
      <button type="button" aria-label="메뉴 열기" onClick={() => setOpen(true)}>
        메뉴
      </button>
      <MobileDrawer open={open} onClose={close}>
        <button type="button">대시보드</button>
        <button type="button">가계부</button>
      </MobileDrawer>
    </>
  );
}

const flushRaf = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

describe("MobileDrawer", () => {
  it("닫혀 있으면 아무것도 렌더하지 않는다", () => {
    render(
      <MobileDrawer open={false} onClose={() => {}}>
        <span>내용</span>
      </MobileDrawer>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("열리면 role=dialog + aria-modal + 첫 포커스(닫기 버튼)", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("메뉴 열기"));
    const dialog = screen.getByRole("dialog", { name: "메뉴" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await flushRaf();
    expect(document.activeElement).toBe(screen.getByLabelText("닫기"));
  });

  it("ESC를 누르면 onClose가 호출되고 포커스가 햄버거 버튼으로 복귀한다", async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    const opener = screen.getByLabelText("메뉴 열기");
    opener.focus();
    fireEvent.click(opener);
    await flushRaf();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // 패널 내부(포커스된 요소)에서 ESC → 버블링으로 패널 onKeyDown 처리
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("ESC 이외 키는 닫지 않는다", async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    fireEvent.click(screen.getByLabelText("메뉴 열기"));
    await flushRaf();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("닫기 버튼·오버레이 클릭으로 닫힌다", async () => {
    const spy = vi.fn();
    const { container } = render(<Harness onCloseSpy={spy} />);
    fireEvent.click(screen.getByLabelText("메뉴 열기"));
    fireEvent.click(screen.getByLabelText("닫기"));
    expect(spy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("메뉴 열기"));
    const overlay = container.querySelector(".drawer-overlay");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Tab이 패널 내부에서 순환한다 (마지막 → 첫 요소)", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("메뉴 열기"));
    await flushRaf();
    const last = screen.getByText("가계부");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("닫기"));
  });
});
