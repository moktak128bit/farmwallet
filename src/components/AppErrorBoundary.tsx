import React from "react";
import { STORAGE_KEYS } from "../constants/config";
import { saveSafetySnapshot } from "../services/backupService";
import type { AppData } from "../types";

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

    // 무확인 즉시 초기화 방지 — 강한 경고와 함께 명시적 확인을 받는다.
    const confirmed = window.confirm(
      "정말 모든 데이터를 초기화할까요?\n\n가계부·계좌·주식 거래 등 모든 앱 데이터가 삭제되며 복구할 수 없습니다.\n초기화 직전에 현재 데이터의 백업 스냅샷 저장을 시도합니다."
    );
    if (!confirmed) return;

    // 초기화 직전 백업 스냅샷 시도 — 손상 데이터라도 사본을 남겨 복구 여지를 확보
    this.setState({
      isRecovering: true,
      recoveryMessage: "초기화 전 백업 스냅샷 저장 중..."
    });
    let snapshotOk = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.DATA);
      if (!raw) {
        // 저장된 데이터가 아예 없으면 잃을 것이 없음 — 스냅샷 생략하고 진행
        snapshotOk = true;
      } else {
        const parsed = JSON.parse(raw) as AppData;
        snapshotOk = await saveSafetySnapshot(parsed, "오류 화면 데이터 초기화 직전 자동 스냅샷");
      }
    } catch (snapshotError) {
      console.warn("[AppErrorBoundary] 초기화 전 스냅샷 실패", snapshotError);
      snapshotOk = false;
    }
    if (!snapshotOk) {
      const proceedAnyway = window.confirm(
        "백업 스냅샷 저장에 실패했습니다 (데이터가 손상됐을 수 있음).\n그래도 데이터를 초기화할까요? 이 경우 복구가 불가능합니다."
      );
      if (!proceedAnyway) {
        this.setState({ isRecovering: false, recoveryMessage: "초기화를 취소했습니다." });
        return;
      }
    }

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
          padding: "var(--space-8)",
          background: "var(--bg)",
          color: "var(--text)"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
            background: "var(--surface)",
            padding: "var(--space-8)"
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "var(--space-3)" }}>앱 오류가 발생했습니다.</h2>
          <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
            렌더링 중 예외가 발생해 안전 모드로 전환했습니다. 아래 복구 동작을 선택할 수 있습니다.
          </p>
          <pre
            style={{
              margin: "var(--space-5) 0",
              padding: "var(--space-4)",
              borderRadius: "var(--radius-md)",
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
            <details style={{ marginBottom: "var(--space-5)" }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
                컴포넌트 스택 (디버깅용)
              </summary>
              <pre
                style={{
                  margin: "var(--space-2) 0 0 0",
                  padding: "var(--space-4)",
                  borderRadius: "var(--radius-md)",
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
            <p style={{ marginTop: 0, marginBottom: "var(--space-5)", color: "var(--text-muted)" }}>{recoveryMessage}</p>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
