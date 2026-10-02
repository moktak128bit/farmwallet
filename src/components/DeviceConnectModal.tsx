import React, { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";
import { getGistId, getGistToken } from "../services/gistSync";
import { buildConnectUrl } from "../services/deviceConnect";
import { qrPathData } from "../utils/qrPath";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface QrState {
  size: number;
  path: string;
}

/** 다른 기기 연결 — 토큰·Gist ID가 담긴 QR/링크를 보여준다. ⚠ 토큰 로그 출력 금지. */
export const DeviceConnectModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
  const isTopModal = useModalStackEntry(isOpen);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState<QrState | null>(null);

  // 열릴 때 URL 생성 + QR 인코딩(uqr 동적 import)
  useEffect(() => {
    if (!isOpen) {
      setUrl("");
      setQr(null);
      return;
    }
    let cancelled = false;
    const next = buildConnectUrl({ token: getGistToken(), gistId: getGistId() });
    setUrl(next);
    setQr(null);
    import("uqr")
      .then(({ encode }) => {
        if (cancelled) return;
        const modules = encode(next, { ecc: "M", border: 2 }).data;
        setQr({ size: modules.length, path: qrPathData(modules) });
      })
      .catch(() => {
        if (!cancelled) toast.error("QR을 만들지 못했어요. 링크 복사를 이용하세요.");
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  // ESC = 닫기 (최상위 모달만)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopModal()) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, isTopModal]);

  if (!isOpen) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("연결 링크를 복사했어요. 다른 사람에게 보내지 마세요.");
    } catch {
      toast.error("복사에 실패했어요. QR을 이용하세요.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-connect-title"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--overlay-bg)",
        zIndex: "var(--z-modal)" as unknown as number,
        padding: "var(--space-8)",
      }}
    >
      <div
        ref={trapRef}
        className="card"
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          padding: "var(--space-8)",
          textAlign: "center",
        }}
      >
        <h3 id="device-connect-title" style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>다른 기기 연결</h3>
        <p style={{ marginTop: 0, fontSize: 13, color: "var(--text-muted)" }}>
          폰 카메라로 찍으면 FarmWallet이 열리고 연결 확인 창이 떠요.
        </p>
        <div style={{ display: "flex", justifyContent: "center", minHeight: 240, alignItems: "center", margin: "var(--space-4) 0" }}>
          {qr ? (
            <svg
              className="qr-code"
              viewBox={`0 0 ${qr.size} ${qr.size}`}
              width={240}
              height={240}
              role="img"
              aria-label="기기 연결 QR 코드"
              shapeRendering="crispEdges"
            >
              <path d={qr.path} />
            </svg>
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>QR 만드는 중...</span>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--warning)" }}>
          이 QR·링크에는 토큰이 들어 있어요. 다른 사람에게 보여주거나 보내지 마세요.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
          <button type="button" className="secondary" disabled={!url} onClick={() => void copy()}>링크 복사</button>
          <button type="button" className="primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
};
