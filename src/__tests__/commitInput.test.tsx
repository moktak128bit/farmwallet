// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommitInput, CommitTextarea } from "../components/ui/CommitInput";

afterEach(cleanup);

describe("CommitInput — 포커스 중 외부 변경 (회귀)", () => {
  it("입력 없이 포커스만 했다가 blur하면, 그 사이 들어온 외부 값(Gist·다른 탭)을 옛 draft로 되돌리지 않는다", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<CommitInput aria-label="라벨" value="상체" onCommit={onCommit} />);
    const input = screen.getByLabelText("라벨") as HTMLInputElement;
    fireEvent.focus(input);
    rerender(<CommitInput aria-label="라벨" value="하체" onCommit={onCommit} />);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("하체");
  });

  it("사용자가 고친 경우는 커밋한다", () => {
    const onCommit = vi.fn();
    render(<CommitInput aria-label="라벨" value="상체" onCommit={onCommit} />);
    const input = screen.getByLabelText("라벨") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "등" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("등");
  });

  it("textarea 버전도 같은 규칙", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<CommitTextarea aria-label="메모" value="a" onCommit={onCommit} />);
    const ta = screen.getByLabelText("메모") as HTMLTextAreaElement;
    fireEvent.focus(ta);
    rerender(<CommitTextarea aria-label="메모" value="b" onCommit={onCommit} />);
    fireEvent.blur(ta);
    expect(onCommit).not.toHaveBeenCalled();
    expect(ta.value).toBe("b");
  });
});
