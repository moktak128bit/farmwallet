import React from "react";
import type { AppData } from "../types";
import { formatTimeAgo } from "../utils/date";

interface Props {
  data: AppData;
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
  onLocalBackup: () => void;
  onGistSave: () => void;
  onGistLoad: () => void;
  onGitPush: () => void;
  onGitPull: () => void;
  onSearch: () => void;
}

/**
 * 헤더 동기화 액션 바.
 * - 3개 그룹: 로컬 / Gist(cloud) / git(repo)
 * - 각 push/save 버튼에 "마지막 저장 N분 전" 서브 라벨 표시 → 최신성 즉시 파악
 * - 그룹별 색상: 로컬=primary, Gist=green, git=navy, 불러오기=secondary
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
  onLocalBackup,
  onGistSave,
  onGistLoad,
  onGitPush,
  onGitPull,
  onSearch,
}) => {
  return (
    <div className="app-header-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {/* ─ 그룹 1: 로컬 ─ */}
      <Group>
        <GroupLabel>로컬</GroupLabel>
        <SyncBtn
          variant="primary"
          icon="💾"
          label="백업"
          sub={formatTimeAgo(latestBackupAt)}
          onClick={onLocalBackup}
          title="현재 데이터를 백업 파일로 저장"
        />
      </Group>

      {/* ─ 그룹 2: Gist (cloud) ─ */}
      {gistConfigured && (
        <Group>
          <GroupLabel>Gist</GroupLabel>
          <SyncBtn
            variant="success"
            icon="☁️"
            label={isGistSaving ? "저장 중..." : "저장"}
            sub={formatTimeAgo(gistLastPushAt)}
            onClick={onGistSave}
            disabled={isGistSaving}
            title="현재 데이터를 GitHub Gist에 업로드"
          />
          <SyncBtn
            variant="secondary"
            icon="⬇"
            label="불러오기"
            sub={gistLastPullAt ? `마지막 ${formatTimeAgo(gistLastPullAt)}` : "버전 선택"}
            onClick={onGistLoad}
            title="Gist 버전 목록에서 선택해서 불러오기"
          />
        </Group>
      )}

      {/* ─ 그룹 3: git (repo) ─ dev 전용 */}
      {import.meta.env.DEV && (
        <Group>
          <GroupLabel>git</GroupLabel>
          <SyncBtn
            variant="navy"
            icon="📦"
            label={
              isPushingToGit
                ? "푸시 중..."
                : isOnRestoreBranch
                  ? "⚠ 이전 버전"
                  : "푸시"
            }
            sub={isOnRestoreBranch ? gitCurrentBranch.replace("restore/", "") : formatTimeAgo(gitLastPushAt)}
            onClick={onGitPush}
            disabled={isPushingToGit || isOnRestoreBranch}
            title={
              isOnRestoreBranch
                ? `이전 버전 상태(${gitCurrentBranch})에서는 업로드할 수 없습니다. 최신 main으로 돌아간 뒤 시도하세요.`
                : "현재 코드·데이터를 git 원격에 push"
            }
          />
          <SyncBtn
            variant={newVersionAvailable ? "success" : "secondary"}
            icon="⬇"
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
        </Group>
      )}

      {/* ─ 검색 (standalone) ─ */}
      <button
        type="button"
        onClick={onSearch}
        style={{
          ...btnBaseStyle,
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          alignSelf: "stretch",
        }}
        title="전체 검색 (Ctrl+K)"
      >
        <span style={labelStyle}>🔍 검색</span>
      </button>
    </div>
  );
};

/* ───────────── 내부 헬퍼 컴포넌트 ───────────── */

const Group: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: "flex",
      gap: 4,
      alignItems: "stretch",
      background: "var(--surface)",
      borderRadius: 10,
      padding: 4,
      border: "1px solid var(--border)",
    }}
  >
    {children}
  </div>
);

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 8px",
      fontSize: 10,
      fontWeight: 700,
      color: "var(--text-muted)",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      minWidth: 32,
    }}
  >
    {children}
  </div>
);

type Variant = "primary" | "secondary" | "success" | "navy" | "muted";

interface SyncBtnProps {
  variant: Variant;
  icon?: string;
  label: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

const SyncBtn: React.FC<SyncBtnProps> = ({ variant, icon, label, sub, onClick, disabled, title }) => {
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
      <span style={labelStyle}>
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
        {label}
      </span>
      <span style={subStyle}>{sub}</span>
    </button>
  );
};

/* ───────────── 스타일 ───────────── */

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
  fontSize: 10,
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
      return { background: "#0f172a", color: "#fff" };
    case "secondary":
      return { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" };
    case "muted":
      return { background: "var(--text-muted)", color: "#fff" };
  }
}
