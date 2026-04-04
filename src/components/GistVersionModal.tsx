import React, { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { getGistVersions, loadFromGistVersion, type GistVersion } from "../services/gistSync";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (dataJson: string, committedAt: string) => void;
  onLog: (message: string, type?: "success" | "error" | "info") => void;
}

export const GistVersionModal: React.FC<Props> = ({ isOpen, onClose, onLoad, onLog }) => {
  const [versions, setVersions] = useState<GistVersion[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setVersions([]);
    setError(null);
    setIsFetching(true);
    getGistVersions(5)
      .then(setVersions)
      .catch((e) => setError(e instanceof Error ? e.message : "버전 목록 조회 실패"))
      .finally(() => setIsFetching(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleLoad = async (version: GistVersion, index: number) => {
    setLoadingIndex(index);
    onLog("Gist 버전 불러오는 중...", "info");
    try {
      const result = await loadFromGistVersion(version.url);
      onLog(`Gist 버전 불러오기 완료 (${new Date(version.committedAt).toLocaleString("ko-KR")})`, "success");
      onLoad(result.dataJson, result.committedAt);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "불러오기 실패";
      onLog(`Gist 버전 불러오기 실패: ${msg}`, "error");
      setError(msg);
    } finally {
      setLoadingIndex(null);
    }
  };

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
        aria-label="Gist 버전 선택"
        style={{ maxWidth: 460, padding: "24px 28px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <History size={18} style={{ color: "var(--accent)" }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Gist 버전 선택</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          불러올 버전을 선택하세요. 현재 데이터가 선택한 버전으로 교체됩니다.
        </p>

        {isFetching && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 14 }}>
            버전 목록 불러오는 중...
          </div>
        )}

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 0" }}>{error}</div>
        )}

        {!isFetching && !error && versions.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 14 }}>
            저장된 버전이 없습니다.
          </div>
        )}

        {versions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {versions.map((v, i) => {
              const d = new Date(v.committedAt);
              const label = d.toLocaleString("ko-KR", {
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", second: "2-digit"
              });
              const isLoading = loadingIndex === i;
              return (
                <div
                  key={v.sha}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: i === 0 ? "var(--surface-hover)" : "var(--surface)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: i === 0 ? 600 : 400 }}>
                      {label}
                      {i === 0 && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                          최신
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {v.sha.slice(0, 8)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: 12, padding: "4px 12px", minWidth: 68 }}
                    disabled={loadingIndex !== null}
                    onClick={() => handleLoad(v, i)}
                  >
                    {isLoading ? "..." : "불러오기"}
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
