import React from "react";

interface TabErrorBoundaryProps {
  /** 탭 표시명 (예: "주식") — 오류 메시지에 표시 */
  tabName: string;
  children: React.ReactNode;
}

interface TabErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * 탭 단위 격리 ErrorBoundary.
 * 한 탭의 렌더 에러가 다른 탭(13개)을 망가뜨리지 않도록 카드 영역에서만 안전 모드로 전환.
 * AppErrorBoundary와 달리 백업 복원/리셋은 제공하지 않으며, 탭 내부에서만 retry 가능.
 */
export class TabErrorBoundary extends React.Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  state: TabErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<TabErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[TabErrorBoundary:${this.props.tabName}] uncaught render error`, error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private handleRetry = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="card"
        role="alert"
        style={{ padding: "var(--space-8)", border: "1px solid var(--danger)" }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "var(--space-2)", color: "var(--danger)" }}>
          {this.props.tabName} 탭 렌더 오류
        </h3>
        <p style={{ marginTop: 0, color: "var(--text-muted)", fontSize: 14 }}>
          이 탭에서만 오류가 발생했습니다. 다른 탭은 정상 동작합니다. 다시 시도하거나 다른 탭을 사용하세요.
        </p>
        <pre
          style={{
            margin: "var(--space-4) 0",
            padding: "var(--space-3)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            fontSize: 12,
            maxHeight: 160,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {error.message}
        </pre>
        {componentStack && (
          <details style={{ marginBottom: "var(--space-4)" }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
              컴포넌트 스택 (디버깅용)
            </summary>
            <pre
              style={{
                margin: "var(--space-2) 0 0 0",
                padding: "var(--space-3)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 11,
                maxHeight: 200,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {componentStack}
            </pre>
          </details>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button type="button" className="primary" onClick={this.handleRetry}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }
}
