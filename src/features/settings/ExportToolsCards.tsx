/**
 * 내보내기 도구 카드 3종 — 가계부 정리(정리.md), 가계부·주식 통합 CSV, 앱 로그 내보내기.
 * SettingsPage에서 분리. 무거운 변환 모듈(ledgerMarkdownReport/unifiedCsvExport)은
 * 기존처럼 클릭 시 dynamic import.
 * React.memo로 감싸므로 부모가 넘기는 props는 data 슬라이스(참조 동일성 유지)뿐이다.
 */
import React, { useCallback } from "react";
import { toast } from "react-hot-toast";
import type { Account, CategoryPresets, LedgerEntry, StockTrade } from "../../types";
import { getKoreaTime } from "../../utils/date";
import { useUIStore } from "../../store/uiStore";
import { useAppStore } from "../../store/appStore";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

interface Props {
  ledger: LedgerEntry[];
  accounts: Account[];
  trades: StockTrade[];
  categoryPresets: CategoryPresets;
}

export const ExportToolsCards: React.FC<Props> = React.memo(function ExportToolsCards({
  ledger,
  accounts,
  trades,
  categoryPresets
}) {
  const handleExportAllExcel = useCallback(async () => {
    try {
      const [{ downloadAsExcel }, { buildFullDataSheets }] = await Promise.all([
        import("../../utils/excelExport"),
        import("../../utils/fullDataExport"),
      ]);
      const sheets = buildFullDataSheets(useAppStore.getState().data);
      const k = getKoreaTime();
      const ymd = `${k.getFullYear()}${String(k.getMonth() + 1).padStart(2, "0")}${String(k.getDate()).padStart(2, "0")}`;
      downloadAsExcel(`farmwallet-전체데이터-${ymd}`, sheets);
      toast.success("전체 데이터를 엑셀로 다운로드했습니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("전체 엑셀 내보내기 실패:", err);
      toast.error("엑셀 내보내기 중 오류가 발생했습니다.");
    }
  }, []);

  const handleExportLedgerMd = useCallback(async () => {
    try {
      const { generateLedgerMarkdownReport } = await import("../../utils/ledgerMarkdownReport");
      const md = generateLedgerMarkdownReport(ledger, accounts);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "정리.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("정리.md를 다운로드했습니다. 프로젝트의 정리.md를 덮어쓰면 됩니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("정리.md 내보내기 실패:", err);
      toast.error(ERROR_MESSAGES.EXPORT_MARKDOWN_FAILED);
    }
  }, [ledger, accounts]);

  const handleExportUnifiedCsv = useCallback(async () => {
    try {
      const { buildUnifiedCsv } = await import("../../utils/unifiedCsvExport");
      const csvContent = buildUnifiedCsv(
        ledger,
        trades,
        accounts,
        categoryPresets
      );
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const k = getKoreaTime();
      const y = k.getFullYear();
      const m = String(k.getMonth() + 1).padStart(2, "0");
      const d = String(k.getDate()).padStart(2, "0");
      a.download = `가계부_주식_통합_${y}-${m}-${d}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("가계부·주식 통합 CSV를 다운로드했습니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("통합 CSV 내보내기 실패:", err);
      toast.error("CSV 내보내기 중 오류가 발생했습니다.");
    }
  }, [ledger, trades, accounts, categoryPresets]);

  return (
    <>
      <div className="card">
        <div className="card-title">📊 전체 데이터 한 번에 (엑셀)</div>
        <p>
          가계부·주식거래·보유현황·배당이자·계좌·예산·대출·반복지출을 <strong>시트별로 나눈 엑셀 파일 하나</strong>로
          받습니다. 엑셀·구글시트에서 바로 열어 보고 편집하세요.
          <br />
          <span className="hint">
            ※ 운동 등 나머지 전부를 통째로 백업하려면 아래 "데이터 백업 → 백업 파일 다운로드"(JSON)를 쓰세요.
          </span>
        </p>
        <button type="button" className="primary" onClick={handleExportAllExcel}>
          전체 데이터 엑셀 다운로드
        </button>
      </div>
      <div className="card">
        <div className="card-title">가계부 정리 (정리.md)</div>
        <p>
          수입·지출·저축성 지출·이체 전체가 포함된 마크다운을 <code>정리.md</code>로 다운로드합니다.
          표 스타일로 정리된 문서를 프로젝트에 저장해 두면 됩니다.
        </p>
        <button type="button" className="primary" onClick={handleExportLedgerMd}>
          정리.md 내보내기
        </button>
      </div>
      <div className="card">
        <div className="card-title">가계부·주식 통합 CSV</div>
        <p>
          수입·지출·이체(가계부)와 주식 매수·매도 기록을 <strong>일자순으로 한 CSV 파일</strong>로 내보냅니다.
          데이터구분(가계부/주식), 일자, 구분, 대분류·금액·계좌(가계부), 티커·수량·단가·총액(주식) 등이 포함됩니다.
        </p>
        <button type="button" className="primary" onClick={handleExportUnifiedCsv}>
          통합 CSV 내보내기
        </button>
      </div>
      <div className="card">
        <div className="card-title">앱 로그 내보내기</div>
        <p className="hint" style={{ marginBottom: 12 }}>
          로컬에 보관된 최근 활동 로그(최대 500건)를 JSON 파일로 다운로드합니다. 문제 진단·이슈 보고 시 첨부하세요.
        </p>
        <button
          type="button"
          onClick={() => {
            const logs = useUIStore.getState().appLog;
            const payload = { exportedAt: new Date().toISOString(), count: logs.length, logs };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const today = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `farmwallet-app-log-${today}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`로그 ${logs.length}건 다운로드`);
          }}
          style={{ padding: "8px 16px", fontSize: 13 }}
        >
          📥 로그 JSON 다운로드
        </button>
      </div>
    </>
  );
});
