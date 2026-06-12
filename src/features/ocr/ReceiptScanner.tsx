import React, { useEffect, useState } from "react";
import { parseAmount } from "../../utils/parseAmount";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";

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
    const n = parseAmount(m[1]);
    if (n >= 100 && n < 10_000_000) candidates.push(n);
  }
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates);
};

const parseDateFromOcrText = (text: string): string | undefined => {
  const m1 = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (m1) {
    const [, y, mo, d] = m1;
    const yearNum = Number(y);
    const monthNum = Number(mo);
    const dayNum = Number(d);
    // 월/일 범위 검증 — OCR 오인식으로 "2026-99-99" 같은 무효 날짜가 폼에 들어가는 것 방지
    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return undefined;
    // 실제 존재하는 날짜인지 확인 (예: 2월 30일 거부)
    const test = new Date(yearNum, monthNum - 1, dayNum);
    if (test.getMonth() !== monthNum - 1 || test.getDate() !== dayNum) return undefined;
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

  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const isTopModal = useModalStackEntry(open);

  // ESC로 닫기 (모달 중첩 시 최상위만)
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopModal()) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, isTopModal]);

  // objectURL 수명 관리 — 교체/언마운트 시 이전 URL revoke (메모리 누수 방지)
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // 모달이 닫히면 미리보기/상태 초기화 (revoke는 위 effect cleanup이 수행)
  useEffect(() => {
    if (open) return;
    setPreview(null);
    setStatus("idle");
    setProgress(0);
    setError(null);
  }, [open]);

  if (!open) return null;

  const onFile = async (file: File) => {
    setError(null);
    setProgress(0);
    setStatus("loading");
    setPreview(URL.createObjectURL(file));
    try {
      const tesseractUrl = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm";
      const Tesseract: {
        recognize: (
          file: File,
          lang: string,
          options: { logger: (m: { status: string; progress: number }) => void }
        ) => Promise<{ data: { text: string } }>;
      } = await import(/* @vite-ignore */ tesseractUrl);
      setStatus("processing");
      const { data: { text } } = await Tesseract.recognize(file, "kor+eng", {
        logger: (m: { status: string; progress: number }) => {
          // 로딩·초기화 단계의 progress가 섞여 출렁이지 않게, 실제 인식 단계만 반영
          if (m.status === "recognizing text" && m.progress) {
            setProgress(Math.round(m.progress * 100));
          }
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
      role="dialog" aria-modal="true" aria-label="영수증 스캔" onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
      }}
    >
      <div ref={trapRef} onClick={(e) => e.stopPropagation()} style={{
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
