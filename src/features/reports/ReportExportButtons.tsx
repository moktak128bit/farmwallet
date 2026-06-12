/**
 * 보고서 내보내기 버튼 — Excel / PDF·인쇄 / CSV. 현재 보고서 타입을 표 블록으로 변환해 내보낸다.
 * ReportPage에서 분리 — React.memo로 감싸 다른 보고서 상태 변경 시 재렌더를 건너뛴다.
 * 받는 props는 모두 부모 소유 데이터(reportWorker 결과·reconciliation/taxSummary memo·상태값)라
 * 참조가 안정적이다 — 여기서 재계산하지 않고 buildReportBlocks에 그대로 넘긴다.
 */
import React from "react";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { downloadAsExcel } from "../../utils/excelExport";
import { openPrintWindow } from "../../utils/pdfExport";
import { blocksToCsv, blocksToSheets, blocksToHtml, hasReportRows } from "../../utils/reportExport";
import { buildReportBlocks, type ReportBlocksInput } from "./buildReportBlocks";

type Props = ReportBlocksInput & {
  /** 워커 재계산 중 — 이전 기간 데이터로 내보내는 것을 막기 위해 버튼 비활성 */
  disabled?: boolean;
};

export const ReportExportButtons: React.FC<Props> = React.memo(function ReportExportButtons({ disabled, ...props }) {
  const exportCurrentCsv = () => {
    const { filename, blocks } = buildReportBlocks(props);
    if (!hasReportRows(blocks)) {
      toast.error(ERROR_MESSAGES.NO_DATA_TO_EXPORT);
      return;
    }
    const blob = new Blob(["\uFEFF" + blocksToCsv(blocks)], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("CSV 내보내기 완료");
  };

  const exportCurrentExcel = () => {
    const { filename, blocks } = buildReportBlocks(props);
    if (!hasReportRows(blocks)) {
      toast.error(ERROR_MESSAGES.NO_DATA_TO_EXPORT);
      return;
    }
    downloadAsExcel(`farmwallet-${filename}`, blocksToSheets(blocks));
    toast.success("Excel 내보내기 완료");
  };

  const exportCurrentPdf = () => {
    const { title, subtitle, blocks } = buildReportBlocks(props);
    if (!hasReportRows(blocks)) {
      toast.error(ERROR_MESSAGES.NO_DATA_TO_EXPORT);
      return;
    }
    openPrintWindow({ title, subtitle, bodyHtml: blocksToHtml(blocks) });
  };

  const disabledTitle = disabled ? "보고서를 재계산하는 중입니다. 잠시 후 다시 시도해주세요." : undefined;

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" onClick={exportCurrentExcel} disabled={disabled} title={disabledTitle}>Excel</button>
      <button type="button" onClick={exportCurrentPdf} disabled={disabled} title={disabledTitle}>PDF/인쇄</button>
      <button type="button" className="primary" onClick={exportCurrentCsv} disabled={disabled} title={disabledTitle}>
        CSV 내보내기
      </button>
    </div>
  );
});
