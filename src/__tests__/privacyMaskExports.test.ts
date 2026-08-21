import { describe, it, expect, afterEach } from "vitest";
import { setAmountMask } from "../utils/formatter";
import { blocksToCsv, blocksToHtml, type ReportBlock } from "../utils/reportExport";

/**
 * 프라이버시 블러(5-1) 회귀 테스트 — 내보내기(csvExport/excelExport/pdfExport/reportExport/
 * unifiedCsvExport/ledgerMarkdownReport)는 utils/formatter를 참조하지 않으므로 setAmountMask(true)여도
 * 영향받지 않아야 한다. reportExport.blocksToCsv/blocksToHtml(순수 함수)로 직접 검증한다.
 */
describe("프라이버시 블러 — 내보내기 경로 미영향", () => {
  afterEach(() => {
    setAmountMask(false);
  });

  const blocks: ReportBlock[] = [
    { title: "가계부", head: ["날짜", "금액"], rows: [["2026-08-21", 1234567]] }
  ];

  it("마스킹 on이어도 blocksToCsv는 raw 숫자를 그대로 출력", () => {
    setAmountMask(true);
    const csv = blocksToCsv(blocks);
    expect(csv).toContain("1234567");
    expect(csv).not.toContain("••••");
  });

  it("마스킹 on이어도 blocksToHtml은 raw 숫자를 그대로 출력", () => {
    setAmountMask(true);
    const html = blocksToHtml(blocks);
    expect(html).toContain("1,234,567"); // blocksToHtml 자체 toLocaleString (formatter 미경유)
    expect(html).not.toContain("••••");
  });
});
