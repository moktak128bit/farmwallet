// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ConnectConfirmModal } from "../components/ConnectConfirmModal";

const payload = { gistId: "abcdef1234567890", token: "ghp_test" };

const esc = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

describe("ConnectConfirmModal — ESC", () => {
  afterEach(() => cleanup());

  it("평소 ESC는 취소, 연결 진행 중(busy) ESC는 무시하며 preventDefault로 거부를 알린다 (Q4)", async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onCancel = vi.fn();
    render(<ConnectConfirmModal payload={payload} currentGistId="" onConfirm={onConfirm} onCancel={onCancel} />);

    expect(window.dispatchEvent(esc())).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText("연결"));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(window.dispatchEvent(esc())).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    expect(window.dispatchEvent(esc())).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
