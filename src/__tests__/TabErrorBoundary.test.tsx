import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { TabErrorBoundary } from "../components/TabErrorBoundary";

function Bomb({ shouldThrow }: { shouldThrow: boolean }): React.ReactNode {
  if (shouldThrow) throw new Error("boom in tab");
  return <span>정상 렌더</span>;
}

describe("TabErrorBoundary", () => {
  const originalError = console.error;
  afterEach(() => {
    console.error = originalError;
  });

  it("자식이 정상이면 그대로 렌더", () => {
    render(
      <TabErrorBoundary tabName="테스트">
        <span>정상 렌더</span>
      </TabErrorBoundary>
    );
    expect(screen.getByText("정상 렌더")).toBeInTheDocument();
  });

  it("자식이 throw하면 에러 카드 표시 + tabName + message", () => {
    console.error = vi.fn();
    render(
      <TabErrorBoundary tabName="주식">
        <Bomb shouldThrow />
      </TabErrorBoundary>
    );
    expect(screen.getByText(/주식 탭 렌더 오류/)).toBeInTheDocument();
    expect(screen.getByText(/boom in tab/)).toBeInTheDocument();
  });

  it("다시 시도 버튼이 boundary 상태를 리셋", () => {
    console.error = vi.fn();
    function Wrapper() {
      const [throws, setThrows] = useState(true);
      return (
        <>
          <button onClick={() => setThrows(false)}>fix</button>
          <TabErrorBoundary tabName="설정">
            <Bomb shouldThrow={throws} />
          </TabErrorBoundary>
        </>
      );
    }
    render(<Wrapper />);
    expect(screen.getByText(/설정 탭 렌더 오류/)).toBeInTheDocument();

    // 부모에서 throw 원인 제거
    fireEvent.click(screen.getByText("fix"));
    // 그래도 boundary는 여전히 에러 상태 (자체 리셋 필요)
    expect(screen.getByText(/설정 탭 렌더 오류/)).toBeInTheDocument();

    // "다시 시도" 클릭 → 정상 렌더
    fireEvent.click(screen.getByText("다시 시도"));
    expect(screen.getByText("정상 렌더")).toBeInTheDocument();
  });
});
