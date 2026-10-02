import React from "react";
import { Smartphone } from "lucide-react";
import { ConnectLinkPasteField } from "../features/settings/ConnectLinkPasteField";

/** 데이터 없는 새 기기 안내 — PC의 QR/연결 링크로 데이터를 가져오도록 유도 */
export const ConnectOnboardingCard: React.FC<{ onGoSettings: () => void }> = ({ onGoSettings }) => (
  <div className="card" style={{ marginBottom: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <Smartphone size={18} aria-hidden="true" />
      <strong style={{ fontSize: 15 }}>이 기기에는 아직 데이터가 없어요</strong>
    </div>
    <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>
      PC의 설정 → 동기화 → '다른 기기 연결'에서 QR을 찍거나, 연결 링크를 붙여넣으세요.
    </p>
    <ConnectLinkPasteField />
    <div style={{ marginTop: 10 }}>
      <button type="button" className="secondary" onClick={onGoSettings}>설정으로</button>
    </div>
  </div>
);
