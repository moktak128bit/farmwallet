import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "./pwaRegister";
import { useUIStore } from "../store/uiStore";

export function PWAStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const setNewVersionAvailable = useUIStore((s) => s.setNewVersionAvailable);
  const setApplyPwaUpdate = useUIStore((s) => s.setApplyPwaUpdate);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // 매 시간 업데이트 확인
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000);
      }
    },
  });

  // SW의 needRefresh 상태를 uiStore에 반영 — 헤더의 "새 버전 적용" 버튼이 반응
  // (registerType:"prompt" — waiting SW가 생기면 onNeedRefresh → needRefresh=true)
  useEffect(() => {
    setNewVersionAvailable(needRefresh);
  }, [needRefresh, setNewVersionAvailable]);

  // 헤더 pill이 실제로 업데이트를 적용할 수 있도록 updateServiceWorker를 uiStore에 등록
  // (prompt 모드에서 단순 location.reload()는 waiting SW를 활성화하지 못한다)
  // ⚠ updateServiceWorker를 effect deps에 직접 넣지 말 것 — 개발 모드(devOptions 미설정)에서 이 값이
  // 매 렌더 새 참조로 나와 setApplyPwaUpdate→리렌더→effect 재실행이 무한 반복되며 앱이 크래시했다
  // (AppErrorBoundary로 확인). ref로 최신값만 추적하고 effect는 마운트 1회만 실행한다.
  const updateServiceWorkerRef = useRef(updateServiceWorker);
  updateServiceWorkerRef.current = updateServiceWorker;
  useEffect(() => {
    setApplyPwaUpdate(() => updateServiceWorkerRef.current(true));
    return () => setApplyPwaUpdate(null);
  }, [setApplyPwaUpdate]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <>
      {offline && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#ef4444",
            color: "#fff",
            padding: "8px 20px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          오프라인 상태입니다
        </div>
      )}
      {needRefresh && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border, #ddd)",
            padding: "12px 16px",
            borderRadius: 10,
            fontSize: 13,
            zIndex: 9999,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>새 버전이 있습니다</span>
          <button
            onClick={() => updateServiceWorker(true)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: "none",
              background: "#0d9488",
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            업데이트
          </button>
          <button
            onClick={() => setNeedRefresh(false)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--border, #ddd)",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            닫기
          </button>
        </div>
      )}
    </>
  );
}
