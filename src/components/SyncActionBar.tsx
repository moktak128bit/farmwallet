import React from "react";
import { formatTimeAgo } from "../utils/date";

interface Props {
  latestBackupAt: string | null;
  gistLastPushAt: string | null;
  gistLastPullAt: string | null;
  gitLastPushAt: string | null;
  gitLastPullAt: string | null;
  gistConfigured: boolean;
  isGistSaving: boolean;
  isPushingToGit: boolean;
  isPullingFromGit: boolean;
  isOnRestoreBranch: boolean;
  gitCurrentBranch: string;
  newVersionAvailable: boolean;
  /** 로컬 백업 + (설정돼 있으면) Gist 저장 */
  onSave: () => void;
  onGistLoad: () => void;
  onGitPush: () => void;
  onGitPull: () => void;
}

/**
 * 상태 메뉴 동기화 액션.
 * - [저장] 하나가 로컬 백업 + Gist를 함께 — 서브 라벨에 각각의 마지막 저장 시각
 * - [불러오기]는 Gist 버전 선택
 * - git(코드 배포)은 dev 전용, "개발자" 접힘 안에
 */
export const SyncActionBar: React.FC<Props> = ({
  latestBackupAt,
  gistLastPushAt,
  gistLastPullAt,
  gitLastPushAt,
  gitLastPullAt,
  gistConfigured,
  isGistSaving,
  isPushingToGit,
  isPullingFromGit,
  isOnRestoreBranch,
  gitCurrentBranch,
  newVersionAvailable,
  onSave,
  onGistLoad,
  onGitPush,
  onGitPull,
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={rowStyle}>
        <SyncBtn
          variant="primary"
          label={isGistSaving ? "저장 중..." : "저장"}
          sub={gistConfigured
            ? `로컬 ${formatTimeAgo(latestBackupAt)} · Gist ${formatTimeAgo(gistLastPushAt)}`
            : formatTimeAgo(latestBackupAt)}
          onClick={onSave}
          disabled={isGistSaving}
          title={gistConfigured ? "로컬 백업과 Gist에 함께 저장" : "현재 데이터를 백업 파일로 저장"}
        />
        {gistConfigured && (
          <SyncBtn
            variant="secondary"
            label="불러오기"
            sub={gistLastPullAt ? `마지막 ${formatTimeAgo(gistLastPullAt)}` : "버전 선택"}
            onClick={onGistLoad}
            title="Gist 버전 목록에서 선택해서 불러오기"
          />
        )}
      </div>

      {import.meta.env.DEV && (
        <details>
          <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>개발자 (git)</summary>
          <div style={{ ...rowStyle, marginTop: 6 }}>
            <SyncBtn
              variant="navy"
              label={
                isPushingToGit
                  ? "푸시 중..."
                  : isOnRestoreBranch
                    ? "이전 버전"
                    : "푸시"
              }
              sub={isOnRestoreBranch ? gitCurrentBranch.replace("restore/", "") : formatTimeAgo(gitLastPushAt)}
              onClick={onGitPush}
              disabled={isPushingToGit || isOnRestoreBranch}
              title={
                isOnRestoreBranch
                  ? `이전 버전 상태(${gitCurrentBranch})에서는 업로드할 수 없습니다. 최신 main으로 돌아간 뒤 시도하세요.`
                  : "커밋된 코드를 GitHub에 올림 (커밋 안 된 변경·데이터 제외)"
              }
            />
            <SyncBtn
              variant={newVersionAvailable ? "success" : "secondary"}
              label={
                isPullingFromGit
                  ? "받는 중..."
                  : newVersionAvailable
                    ? "새 버전 적용"
                    : "내려받기"
              }
              sub={formatTimeAgo(gitLastPullAt)}
              onClick={onGitPull}
              disabled={isPullingFromGit}
              title="git 원격의 특정 버전으로 내려받기"
            />
          </div>
        </details>
      )}
    </div>
  );
};

/* ───────────── 내부 헬퍼 컴포넌트 ───────────── */

type Variant = "primary" | "secondary" | "success" | "navy";

interface SyncBtnProps {
  variant: Variant;
  label: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

const SyncBtn: React.FC<SyncBtnProps> = ({ variant, label, sub, onClick, disabled, title }) => {
  const v = variantStyle(variant, disabled);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...btnBaseStyle,
        ...v,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span style={subStyle}>{sub}</span>
    </button>
  );
};

/* ───────────── 스타일 ───────────── */

const rowStyle: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };

const btnBaseStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  gap: 2,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid transparent",
  minWidth: 92,
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

const subStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.8,
  lineHeight: 1,
  whiteSpace: "nowrap",
};

function variantStyle(variant: Variant, disabled?: boolean): React.CSSProperties {
  if (disabled) {
    return {
      background: "var(--text-muted)",
      color: "#fff",
      opacity: 0.65,
    };
  }
  switch (variant) {
    case "primary":
      return { background: "var(--primary)", color: "var(--primary-text)" };
    case "success":
      return { background: "var(--success, #22c55e)", color: "#fff" };
    case "navy":
      // 테마 변수 사용 — 하드코딩 #0f172a는 다크모드 배경(--bg)과 동일해 버튼이 묻혔음.
      // 라이트: 진한 네이비 배경 + 밝은 글자 / 다크: 밝은 배경 + 어두운 글자.
      return { background: "var(--text)", color: "var(--bg)" };
    case "secondary":
      return { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" };
  }
}
