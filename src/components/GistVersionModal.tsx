import React, { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { getGistVersions, loadFromGistVersion, type GistVersion } from "../services/gistSync";
import { useModalStackEntry } from "../utils/modalStack";
import { useUIStore } from "../store/uiStore";
import { useAppStore } from "../store/appStore";
import { normalizeImportedData } from "../services/dataService";
import { requestApply } from "./ApplyConfirmModal";

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
  const [fetchCount, setFetchCount] = useState(0);
  const isTopModal = useModalStackEntry(isOpen);
  const hasDirtyChanges = useUIStore((s) => s.hasDirtyChanges);

  const fetchVersions = React.useCallback(() => {
    setVersions([]);
    setError(null);
    setIsFetching(true);
    getGistVersions(10)
      .then(setVersions)
      .catch((e) => setError(e instanceof Error ? e.message : "버전 목록 조회 실패"))
      .finally(() => setIsFetching(false));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchVersions();
  }, [isOpen, fetchCount, fetchVersions]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && isTopModal()) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, isTopModal]);

  if (!isOpen) return null;

  const handleLoad = async (version: GistVersion, index: number) => {
    setLoadingIndex(index);
    onLog("Gist 버전 불러오는 중...", "info");
    try {
      const result = await loadFromGistVersion(version.url);
      // 설정 카드 불러오기(manualPull)와 같은 변경 미리보기 게이트 — 덮어쓰기 확인을 대신한다.
      // 검증 실패는 catch로 가서 모달 안 오류로 표시(onLoad 호출 없음).
      const after = normalizeImportedData(JSON.parse(result.dataJson) as unknown);
      const when = new Date(version.committedAt).toLocaleString("ko-KR");
      requestApply({
        title: `Gist 버전 불러오기 (${when})`,
        before: useAppStore.getState().data,
        after,
        onConfirm: () => {
          onLog(`Gist 버전 불러오기 완료 (${when})`, "success");
          onLoad(result.dataJson, result.committedAt);
          onClose();
        },
        // 취소하면 버전 목록이 그대로 남아 다른 버전을 바로 고를 수 있다
        onCancel: () => onLog("Gist 버전 불러오기: 사용자 취소", "info")
      });
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
        {hasDirtyChanges && (
          <p style={{ margin: "-8px 0 16px", fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>
            저장하지 않은 변경이 있습니다 — 불러오면 사라집니다.
          </p>
        )}

        {isFetching && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 14 }}>
            버전 목록 불러오는 중...
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

        {!isFetching && !error && versions.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 14 }}>
            저장된 버전이 없습니다.
            <div style={{ fontSize: 12, marginTop: 4 }}>
              먼저 [저장] 버튼으로 Gist에 저장하세요.
            </div>
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
