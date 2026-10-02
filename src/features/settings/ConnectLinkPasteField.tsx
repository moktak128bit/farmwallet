import React, { useState } from "react";
import { toast } from "react-hot-toast";
import { decodeConnectPayload } from "../../services/deviceConnect";
import { useUIStore } from "../../store/uiStore";

/** 연결 링크 붙여넣기 — 디코드 성공 시 pendingConnect만 설정(실제 연결은 확인 모달이 수행). 토큰은 출력하지 않는다. */
export const ConnectLinkPasteField: React.FC = () => {
  const [text, setText] = useState("");
  const setPendingConnect = useUIStore((s) => s.setPendingConnect);

  const submit = () => {
    const payload = decodeConnectPayload(text);
    if (!payload) {
      toast.error("연결 링크가 올바르지 않아요");
      return;
    }
    setPendingConnect(payload);
    setText("");
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="password"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        placeholder="연결 링크 붙여넣기"
        aria-label="연결 링크"
        autoComplete="off"
        spellCheck={false}
        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}
      />
      <button type="button" className="secondary" disabled={!text.trim()} onClick={submit}>
        연결
      </button>
    </div>
  );
};
