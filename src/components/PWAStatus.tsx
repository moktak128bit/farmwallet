import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export function PWAStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
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
