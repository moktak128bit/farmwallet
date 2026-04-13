/**
 * 의존성 없는 PDF 내보내기.
 * window.print를 활용한 인쇄용 뷰 생성 — 사용자가 "PDF로 저장"을 선택해 저장.
 */

export interface PrintOptions {
  title: string;
  subtitle?: string;
  bodyHtml: string;
}

export function openPrintWindow({ title, subtitle, bodyHtml }: PrintOptions): void {
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=900");
  if (!win) {
    alert("팝업이 차단되었습니다. 브라우저 설정을 확인해주세요.");
    return;
  }
  const generatedAt = new Date().toLocaleString("ko-KR");
  win.document.open();
  win.document.write(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<style>
  @media print { @page { margin: 16mm; } }
  body { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 32px; color: #999; font-size: 11px; text-align: right; }
</style></head>
<body>
<h1>FarmWallet · ${title}</h1>
${subtitle ? `<div class="subtitle">${subtitle}</div>` : ""}
${bodyHtml}
<div class="footer">생성: ${generatedAt}</div>
${"<script>"}setTimeout(function(){window.print();}, 200);${"<" + "/script>"}
</body></html>`);
  win.document.close();
}
