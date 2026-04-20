import React, { useState } from "react";

export interface OcrResult {
  rawText: string;
  merchant?: string;
  amount?: number;
  date?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onParsed: (result: OcrResult) => void;
}

const parseAmountFromOcrText = (text: string): number | undefined => {
  const candidates: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d{3,8})\s*원?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 100 && n < 10_000_000) candidates.push(n);
  }
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates);
};

const parseDateFromOcrText = (text: string): string | undefined => {
  const m1 = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (m1) {
    const [, y, mo, d] = m1;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return undefined;
};

const parseMerchantFromOcrText = (text: string): string | undefined => {
  const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  return lines.find((line) => /[가-힣A-Za-z]{2,}/.test(line) && !/\d{4}/.test(line));
};

export const ReceiptScanner: React.FC<Props> = ({ open, onClose, onParsed }) => {
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  if (!open) return null;

  const onFile = async (file: File) => {
    setError(null);
    setProgress(0);
    setStatus("loading");
    setPreview(URL.createObjectURL(file));
    try {
      const tesseractUrl = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm";
      const Tesseract: any = await import(/* @vite-ignore */ tesseractUrl);
      setStatus("processing");
      const { data: { text } } = await Tesseract.recognize(file, "kor+eng", {
        logger: (m: { status: string; progress: number }) => {
          if (m.progress) setProgress(Math.round(m.progress * 100));
        }
      });
      const result: OcrResult = {
        rawText: text,
        merchant: parseMerchantFromOcrText(text),
        amount: parseAmountFromOcrText(text),
        date: parseDateFromOcrText(text)
      };
      onParsed(result);
      setStatus("idle");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCR 처리 중 오류가 발생했습니다.");
      setStatus("error");
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface)", padding: 16, borderRadius: 12,
        width: "min(480px, 92vw)", border: "1px solid var(--border)"
      }}>
        <h3 style={{ marginTop: 0 }}>영수증 스캔</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          영수증 사진을 선택하면 가맹점·금액·날짜를 자동으로 인식해 가계부 입력 폼을 채웁니다.
          (Tesseract.js를 CDN에서 한 번만 로드합니다 — 약 3MB)
        </p>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          disabled={status === "loading" || status === "processing"}
        />
        {preview && (
          <img src={preview} alt="영수증 미리보기" style={{ maxWidth: "100%", marginTop: 12, borderRadius: 6 }} />
        )}
        {(status === "loading" || status === "processing") && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
            {status === "loading" ? "OCR 엔진 로딩 중..." : `텍스트 인식 중... ${progress}%`}
          </p>
        )}
        {error && (
          <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{error}</p>
        )}
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
};
