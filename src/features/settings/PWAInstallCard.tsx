/**
 * 앱처럼 사용하기(PWA 설치) 카드 — SettingsPage에서 분리.
 * usePWAInstall 훅 상태를 이 컴포넌트가 소유한다 (부모는 설치 여부를 쓰지 않음).
 * React.memo로 감싸며 props가 없어 부모 재렌더 영향을 받지 않는다.
 */
import React from "react";
import { toast } from "react-hot-toast";
import { usePWAInstall } from "../../hooks/usePWAInstall";

export const PWAInstallCard: React.FC = React.memo(function PWAInstallCard() {
  const { canInstall, isStandalone, install: installPWA } = usePWAInstall();

  if (!canInstall && !isStandalone) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">앱처럼 사용하기</div>
      {isStandalone ? (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          홈 화면에서 실행 중입니다. 오프라인에서도 캐시된 화면을 볼 수 있습니다.
        </p>
      ) : canInstall ? (
        <p style={{ margin: "0 0 12px 0", color: "var(--text-muted)" }}>
          홈 화면에 추가하면 앱처럼 실행하고, 오프라인에서도 사용할 수 있습니다.
        </p>
      ) : null}
      {canInstall && (
        <button type="button" className="primary" onClick={async () => {
          const ok = await installPWA();
          if (ok) toast.success("홈 화면에 추가되었습니다.");
        }}>
          홈 화면에 추가
        </button>
      )}
    </div>
  );
});
