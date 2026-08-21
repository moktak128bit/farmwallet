/**
 * 카드 명세 CSV/TSV/붙여넣기 파서 — 순수 모듈 (React 의존 없음).
 *
 * 탭/콤마/세미콜론 구분자를 자동 감지하고 BOM·RFC4180 따옴표(내부 개행·구분자·"" escape)를 처리한다.
 * 헤더 행에서 날짜/금액/가맹점 등 열을 자동 인식하고, 은행 명세(입금액/출금액/거래후잔액 열이 있고
 * 가맹점 열이 없음)는 '출금→expense' 일괄 매핑이 카드결제이체·저축/투자이체 transfer 체계와 충돌해
 * 지출·재테크 집계를 부풀리므로 감지해 차단한다(1차 범위: 카드 계좌 명세만).
 */
import { parseIsoLocal, getTodayKST } from "../date";
import { parseAmount } from "../parseAmount";

type Delimiter = "," | "\t" | ";";

interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
}

const DELIMS: Delimiter[] = [",", "\t", ";"];

function detectDelimiter(sampleLine: string): Delimiter {
  let best: Delimiter = ",";
  let bestCount = -1;
  for (const d of DELIMS) {
    const count = sampleLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** RFC4180 호환 필드/행 분해 — 따옴표 내부 개행·구분자, ""로 escape된 따옴표 지원. CRLF/LF 모두 허용. */
function tokenize(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  // 마지막 행(트레일링 개행 없음)만 flush — 개행으로 끝났으면 이미 다 push됐으니 빈 행을 추가하지 않음
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** raw 텍스트 → 헤더/데이터 행. 구분자 자동 감지, BOM 제거, 완전히 빈 행 제외. */
export function parseDelimited(raw: string): ParsedTable {
  const src = raw ?? "";
  // Excel/Windows가 붙이는 UTF-8 BOM(U+FEFF) 제거 — charCodeAt 비교로 소스에 리터럴 BOM을 두지 않음
  const text = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const delimiter = detectDelimiter(firstLine);
  const allRows = tokenize(text, delimiter).filter((r) => r.some((c) => c.trim().length > 0));
  if (allRows.length === 0) return { headers: [], rows: [], delimiter };
  const headers = allRows[0].map((h) => h.trim());
  return { headers, rows: allRows.slice(1), delimiter };
}

export interface ColumnMapping {
  dateCol: number;
  amountCol: number;
  merchantCol: number;
  installmentCol?: number;
  statusCol?: number;
  currencyCol?: number;
}

interface DetectedColumns extends Partial<ColumnMapping> {
  /** 입금액/출금액/거래후잔액 등 은행 명세 특유 열이 있는데 가맹점 열이 없음 — 카드 명세로 보지 않음 */
  isBankStatement: boolean;
}

const DATE_HEADER_RE = /(이용일|거래일|승인일|사용일|일자|날짜)/;
const AMOUNT_HEADER_RE = /(이용금액|승인금액|결제금액|청구금액|매출금액|금액)/;
const MERCHANT_HEADER_RE = /(가맹점|사용처|거래내용|상호|가게|내용)/;
const INSTALLMENT_HEADER_RE = /할부/;
const STATUS_HEADER_RE = /(취소|환불|승인구분|거래구분|구분|상태)/;
const CURRENCY_HEADER_RE = /(통화|해외|달러|USD)/i;
/** 은행 명세 특유 열 — 카드 명세에는 보통 없음 */
const BANK_ONLY_HEADER_RE = /(입금액|출금액|거래후\s*잔액|잔액)/;

/** 명세 감지 차단 안내 문구 — UI가 isBankStatement일 때 그대로 노출 */
export const BANK_STATEMENT_BLOCK_MESSAGE =
  "은행 명세로 보입니다. 1차 범위는 카드 계좌 명세만 지원합니다 " +
  "(은행 명세의 '출금→지출' 일괄 매핑은 카드결제이체·저축/투자이체 이체 체계와 충돌해 집계가 부풀 수 있어 제외했습니다).";

function findCol(headers: string[], re: RegExp): number | undefined {
  const idx = headers.findIndex((h) => re.test(h));
  return idx >= 0 ? idx : undefined;
}

/** 헤더 행에서 날짜/금액/가맹점 등 열 인덱스 자동 감지 + 은행 명세 여부 판정. */
export function detectColumnMapping(headers: string[]): DetectedColumns {
  const merchantCol = findCol(headers, MERCHANT_HEADER_RE);
  const hasBankOnlyHeader = headers.some((h) => BANK_ONLY_HEADER_RE.test(h));
  const isBankStatement = hasBankOnlyHeader && merchantCol === undefined;
  return {
    dateCol: findCol(headers, DATE_HEADER_RE),
    amountCol: findCol(headers, AMOUNT_HEADER_RE),
    merchantCol,
    installmentCol: findCol(headers, INSTALLMENT_HEADER_RE),
    statusCol: findCol(headers, STATUS_HEADER_RE),
    currencyCol: findCol(headers, CURRENCY_HEADER_RE),
    isBankStatement,
  };
}

/**
 * 명세 날짜 열 → "YYYY-MM-DD"(KST 로컬, parseIsoLocal 검증 통과).
 * 지원 형식: "YYYY.MM.DD"/"YYYY-MM-DD"/"YYYY/MM/DD", "MM/DD"·"MM.DD"(연도 없음 — today 기준 추론,
 * 추론한 날짜가 today보다 미래면 전년으로 보정 — 연말 즈음 발급된 명세의 "12/30" 같은 행 오탐 방지).
 * 인식 실패 시 null.
 */
export function parseStatementDate(raw: string, today: string = getTodayKST()): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return parseIsoLocal(iso) ? iso : null;
  }

  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
  if (m) {
    const [, mo, d] = m;
    const year = Number(today.slice(0, 4));
    if (!Number.isFinite(year)) return null;
    const mkIso = (y: number) => `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    let iso = mkIso(year);
    if (!parseIsoLocal(iso)) return null;
    if (iso > today) iso = mkIso(year - 1);
    return parseIsoLocal(iso) ? iso : null;
  }

  return null;
}

/**
 * 명세 금액 열 파싱 — 콤마·원 표기는 공용 parseAmount로 제거하고, 음수 표기
 * ("-15,000", "15,000-", "(15,000)")는 취소/환불 신호로 별도 감지해 반환한다
 * (parseAmount 자체는 부호를 버리는 정책 — CLAUDE.md 부호 있는 금액 입력 규칙).
 */
export function parseStatementAmount(
  raw: string,
  options?: { allowDecimal?: boolean }
): { amount: number; isNegative: boolean } {
  const s = (raw ?? "").trim();
  const isNegative = /^-/.test(s) || /-$/.test(s) || /^\(.*\)$/.test(s);
  const amount = parseAmount(s, options);
  return { amount, isNegative };
}
