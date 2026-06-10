/**
 * 가격 API 카드 — 외부 API 주식 가격 배치 갱신 토글. SettingsPage에서 분리.
 * priceApiEnabled 토글 상태는 이 컴포넌트가 소유 — 백업 탭 진입(마운트) 시
 * localStorage에서 다시 읽는다 (기존 탭 전환 effect와 동일 동작).
 * React.memo로 감싸며 props가 없어 부모 재렌더 영향을 받지 않는다.
 */
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import { STORAGE_KEYS } from "../../constants/config";

export const PriceApiCard: React.FC = React.memo(function PriceApiCard() {
  const [priceApiEnabled, setPriceApiEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true";
  });

  return (
    <div className="card">
      <div className="card-title">가격 API</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={priceApiEnabled}
          onChange={(e) => {
            const v = e.target.checked;
            setPriceApiEnabled(v);
            if (typeof window !== "undefined") {
              localStorage.setItem(STORAGE_KEYS.PRICE_API_ENABLED, v ? "true" : "false");
              toast.success(v ? "가격 API 사용을 켰습니다." : "가격 API 사용을 껐습니다.");
            }
          }}
        />
        <span>가격 API 사용 (외부 API로 주식 가격 배치 갱신)</span>
      </label>
      <p className="hint" style={{ marginTop: 4 }}>
        켜면 주식 탭에서 보유 종목 가격을 30분마다 자동으로 배치 갱신합니다 (탭이 보일 때만 동작).
      </p>
    </div>
  );
});
