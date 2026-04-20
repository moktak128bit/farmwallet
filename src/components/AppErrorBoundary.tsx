import React from "react";

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  onRestoreLatestBackup?: () => Promise<void>;
  onResetData?: () => Promise<void> | void;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  isRecovering: boolean;
  recoveryMessage: string | null;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
    isRecovering: false,
    recoveryMessage: null
  };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[AppErrorBoundary] uncaught render error", error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private handleRetry = (): void => {
    this.setState({
      error: null,
      componentStack: null,
      recoveryMessage: null
    });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleRestoreLatestBackup = async (): Promise<void> => {
    if (!this.props.onRestoreLatestBackup) return;
    this.setState({
      isRecovering: true,
      recoveryMessage: "최근 백업 복원 중..."
    });
    try {
      await this.props.onRestoreLatestBackup();
      this.setState({
        error: null,
        isRecovering: false,
        recoveryMessage: "복원 완료. 페이지를 새로고침합니다."
      });
      window.location.reload();
    } catch (error) {
      this.setState({
        isRecovering: false,
        recoveryMessage: error instanceof Error ? error.message : "백업 복원에 실패했습니다."
      });
    }
  };

  private handleResetData = async (): Promise<void> => {
    if (!this.props.onResetData) return;
    this.setState({
      isRecovering: true,
      recoveryMessage: "앱 데이터를 초기화하는 중..."
    });
    try {
      await this.props.onResetData();
      this.setState({
        error: null,
        isRecovering: false,
        recoveryMessage: "초기화 완료. 페이지를 새로고침합니다."
      });
      window.location.reload();
    } catch (error) {
      this.setState({
        isRecovering: false,
        recoveryMessage: error instanceof Error ? error.message : "데이터 초기화에 실패했습니다."
      });
    }
  };

  render() {
    const { error, componentStack, isRecovering, recoveryMessage } = this.state;

    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          background: "var(--bg)",
          color: "var(--text)"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--surface)",
            padding: 20
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 10 }}>앱 오류가 발생했습니다.</h2>
          <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
            렌더링 중 예외가 발생해 안전 모드로 전환했습니다. 아래 복구 동작을 선택할 수 있습니다.
          </p>
          <pre
            style={{
              margin: "14px 0",
              padding: 12,
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              fontSize: 12,
              maxHeight: 200,
              overflow: "auto",
              whiteSpace: "pre-wrap"
            }}
          >
            {error.message}
          </pre>
          {componentStack && (
            <details style={{ marginBottom: 14 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
                컴포넌트 스택 (디버깅용)
              </summary>
              <pre
                style={{
                  margin: "8px 0 0 0",
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  fontSize: 11,
                  maxHeight: 240,
                  overflow: "auto",
                  whiteSpace: "pre-wrap"
                }}
              >
                {componentStack}
              </pre>
            </details>
          )}
          {recoveryMessage && (
            <p style={{ marginTop: 0, marginBottom: 14, color: "var(--text-muted)" }}>{recoveryMessage}</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="primary" disabled={isRecovering} onClick={this.handleRetry}>
              다시 시도
            </button>
            <button
              type="button"
              className="secondary"
              disabled={isRecovering || !this.props.onRestoreLatestBackup}
              onClick={() => void this.handleRestoreLatestBackup()}
            >
              최근 백업 복원
            </button>
            <button
              type="button"
              className="secondary"
              disabled={isRecovering || !this.props.onResetData}
              onClick={() => void this.handleResetData()}
            >
              데이터 초기화
            </button>
            <button type="button" className="secondary" disabled={isRecovering} onClick={this.handleReload}>
              새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }
}
