import React, { useCallback, useEffect, useState } from "react";
import { GitBranch, X } from "lucide-react";

interface GitCommit {
  hash: string;
  date: string;
  message: string;
}

interface GitLogResponse {
  commits: GitCommit[];
  currentBranch: string;
  currentHead: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 선택된 ref 로 checkout 실행. ref 가 빈 문자열이면 "최신(main)" 으로 복귀 */
  onSelect: (ref: string, commit?: GitCommit) => Promise<void> | void;
  onLog: (message: string, type?: "success" | "error" | "info") => void;
}

export const GitVersionModal: React.FC<Props> = ({ isOpen, onClose, onSelect, onLog }) => {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("");
  const [currentHead, setCurrentHead] = useState<string>("");
  const [isFetching, setIsFetching] = useState(false);
  const [loadingRef, setLoadingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  const fetchLog = useCallback(() => {
    setCommits([]);
    setError(null);
    setIsFetching(true);
    fetch("/api/git-log")
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<GitLogResponse>;
      })
      .then((data) => {
        setCommits(data.commits ?? []);
        setCurrentBranch(data.currentBranch ?? "");
        setCurrentHead(data.currentHead ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "커밋 목록 조회 실패"))
      .finally(() => setIsFetching(false));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchLog();
  }, [isOpen, fetchCount, fetchLog]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = async (ref: string, commit?: GitCommit) => {
    const targetLabel = ref === "" ? "최신 main" : `${ref.slice(0, 7)} (${commit?.message.slice(0, 40) ?? ""})`;
    setLoadingRef(ref === "" ? "__latest__" : ref);
    onLog(`git 내려받기 실행 중... (${targetLabel})`, "info");
    try {
      await onSelect(ref, commit);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "내려받기 실패";
      setError(msg);
    } finally {
      setLoadingRef(null);
    }
  };

  const isOnRestoreBranch = currentBranch.startsWith("restore/");

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 2000 }}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="git 버전 선택"
        style={{ maxWidth: 560, padding: "24px 28px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GitBranch size={18} style={{ color: "var(--accent)" }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>git 버전 선택</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        {/* 현재 상태 뱃지 */}
        <div style={{
          padding: "8px 12px",
          borderRadius: 6,
          background: isOnRestoreBranch ? "var(--warning-bg, #fff7ed)" : "var(--surface-hover)",
          border: isOnRestoreBranch ? "1px solid var(--warning, #f59e0b)" : "1px solid var(--border)",
          fontSize: 12,
          marginBottom: 14
        }}>
          현재 브랜치: <code style={{ fontWeight: 600 }}>{currentBranch || "(unknown)"}</code>
          {currentHead && (
            <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
              @ {currentHead.slice(0, 7)}
            </span>
          )}
          {isOnRestoreBranch && (
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--warning, #b45309)" }}>
              ⚠ 이전 버전 상태입니다. "최신 main" 을 선택해 되돌아갈 수 있습니다.
            </div>
          )}
        </div>

        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-secondary)" }}>
          선택한 버전으로 <strong>임시 브랜치</strong>를 만들어 checkout 합니다. main 브랜치와 GitHub main 은 영향 받지 않습니다.
        </p>

        {isFetching && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 14 }}>
            커밋 목록 불러오는 중...
          </div>
        )}

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 0" }}>
            <div>{error}</div>
            <button
              type="button"
              className="secondary"
              style={{ marginTop: 8, fontSize: 12, padding: "4px 14px" }}
              onClick={() => setFetchCount((c) => c + 1)}
            >
              다시 시도
            </button>
          </div>
        )}

        {!isFetching && !error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
            {/* 최신 main 옵션 (항상 표시) */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px",
              borderRadius: 8,
              border: "2px solid var(--accent)",
              background: "var(--surface-hover)"
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  🔄 최신 main (기본)
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  main 브랜치로 복귀 후 `git pull origin main` 실행
                </div>
              </div>
              <button
                type="button"
                className="primary"
                style={{ fontSize: 12, padding: "6px 14px", minWidth: 76 }}
                disabled={loadingRef !== null}
                onClick={() => handleSelect("")}
              >
                {loadingRef === "__latest__" ? "..." : "내려받기"}
              </button>
            </div>

            {commits.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 14 }}>
                origin/main 커밋이 없습니다.
              </div>
            )}

            {commits.map((c, i) => {
              const d = new Date(c.date);
              const dateLabel = d.toLocaleString("ko-KR", {
                month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit"
              });
              const isLoading = loadingRef === c.hash;
              const isCurrent = c.hash === currentHead;
              return (
                <div
                  key={c.hash}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: isCurrent ? "var(--surface-hover)" : "var(--surface)",
                    opacity: loadingRef !== null && !isLoading ? 0.5 : 1
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, display: "flex", alignItems: "center", gap: 6 }}>
                      <code style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.hash.slice(0, 7)}</code>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{dateLabel}</span>
                      {i === 0 && (
                        <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>
                          HEAD
                        </span>
                      )}
                      {isCurrent && (
                        <span style={{ fontSize: 10, color: "var(--success, #059669)", fontWeight: 600 }}>
                          ← 현재
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.message}>
                      {c.message}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: 12, padding: "4px 12px", minWidth: 68, marginLeft: 8 }}
                    disabled={loadingRef !== null || isCurrent}
                    onClick={() => handleSelect(c.hash, c)}
                  >
                    {isLoading ? "..." : isCurrent ? "현재" : "선택"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" className="secondary" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
};
