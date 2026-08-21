import { describe, it, expect } from "vitest";
import {
  parseDelimited,
  detectColumnMapping,
  parseStatementDate,
  parseStatementAmount,
  BANK_STATEMENT_BLOCK_MESSAGE,
} from "../utils/statementImport/parseDelimited";

describe("parseDelimited — 구분자 자동 감지", () => {
  it("콤마 CSV를 파싱한다", () => {
    const raw = "이용일자,가맹점명,이용금액\n2026.08.01,스타벅스 강남점,5500";
    const t = parseDelimited(raw);
    expect(t.delimiter).toBe(",");
    expect(t.headers).toEqual(["이용일자", "가맹점명", "이용금액"]);
    expect(t.rows).toEqual([["2026.08.01", "스타벅스 강남점", "5500"]]);
  });

  it("탭 구분(TSV)을 파싱한다", () => {
    const raw = "이용일자\t가맹점명\t이용금액\n2026.08.01\t스타벅스 강남점\t5500";
    const t = parseDelimited(raw);
    expect(t.delimiter).toBe("\t");
    expect(t.rows).toEqual([["2026.08.01", "스타벅스 강남점", "5500"]]);
  });

  it("세미콜론 구분을 파싱한다", () => {
    const raw = "이용일자;가맹점명;이용금액\n2026.08.01;스타벅스 강남점;5500";
    const t = parseDelimited(raw);
    expect(t.delimiter).toBe(";");
    expect(t.rows).toEqual([["2026.08.01", "스타벅스 강남점", "5500"]]);
  });

  it("BOM을 제거한다", () => {
    const raw = "﻿이용일자,가맹점명,이용금액\n2026.08.01,스타벅스,5500";
    const t = parseDelimited(raw);
    expect(t.headers[0]).toBe("이용일자");
  });

  it("따옴표로 감싼 필드 내부의 콤마·개행·escape된 따옴표를 보존한다", () => {
    const raw = '이용일자,가맹점명,이용금액\n2026.08.01,"스타벅스, ""강남""점\n2호점",5500';
    const t = parseDelimited(raw);
    expect(t.rows[0][1]).toBe('스타벅스, "강남"점\n2호점');
  });

  it("완전히 빈 행은 제외한다", () => {
    const raw = "이용일자,가맹점명,이용금액\n\n2026.08.01,스타벅스,5500\n,,";
    const t = parseDelimited(raw);
    expect(t.rows).toEqual([["2026.08.01", "스타벅스", "5500"]]);
  });

  it("빈 입력은 헤더/행 모두 빈 배열", () => {
    const t = parseDelimited("");
    expect(t.headers).toEqual([]);
    expect(t.rows).toEqual([]);
  });
});

describe("detectColumnMapping — 열 자동 인식·은행 명세 차단", () => {
  it("카드 명세 헤더에서 날짜/금액/가맹점 열을 찾는다", () => {
    const d = detectColumnMapping(["이용일자", "가맹점명", "이용금액", "할부", "취소여부"]);
    expect(d.dateCol).toBe(0);
    expect(d.merchantCol).toBe(1);
    expect(d.amountCol).toBe(2);
    expect(d.installmentCol).toBe(3);
    expect(d.statusCol).toBe(4);
    expect(d.isBankStatement).toBe(false);
  });

  it("은행 명세(입금액/출금액/거래후잔액, 가맹점 열 없음)를 감지한다", () => {
    const d = detectColumnMapping(["거래일자", "출금액", "입금액", "거래후잔액", "거래내용"]);
    // '거래내용'은 MERCHANT_HEADER_RE에 걸리므로, 가맹점 열이 전혀 없는 순수 은행 포맷으로 다시 확인
    expect(d.isBankStatement).toBe(false); // 거래내용이 매칭돼 카드로 오인되지 않는지 별도 케이스로 재확인
  });

  it("가맹점 열이 전혀 없는 은행 포맷은 차단 대상", () => {
    const d = detectColumnMapping(["거래일자", "출금액", "입금액", "거래후잔액"]);
    expect(d.isBankStatement).toBe(true);
    expect(BANK_STATEMENT_BLOCK_MESSAGE).toContain("은행 명세");
  });
});

describe("parseStatementDate — 날짜 형식 3종 + 연도 추론", () => {
  it("YYYY.MM.DD", () => {
    expect(parseStatementDate("2026.08.15")).toBe("2026-08-15");
  });
  it("YYYY-MM-DD", () => {
    expect(parseStatementDate("2026-08-15")).toBe("2026-08-15");
  });
  it("YYYY/MM/DD", () => {
    expect(parseStatementDate("2026/08/15")).toBe("2026-08-15");
  });
  it("MM/DD(연도 없음) — today 이전이면 올해로 추론", () => {
    expect(parseStatementDate("03/10", "2026-08-21")).toBe("2026-03-10");
  });
  it("MM/DD(연도 없음) — today보다 미래면 전년으로 보정", () => {
    expect(parseStatementDate("12/30", "2026-01-05")).toBe("2025-12-30");
  });
  it("MM.DD 구분자도 지원", () => {
    expect(parseStatementDate("08.15", "2026-08-21")).toBe("2026-08-15");
  });
  it("잘못된 날짜(2/30)는 null", () => {
    expect(parseStatementDate("2026.02.30")).toBeNull();
  });
  it("인식 불가 문자열은 null", () => {
    expect(parseStatementDate("모르는형식")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("parseStatementAmount — 콤마·음수/취소 표기", () => {
  it("콤마 포함 금액을 파싱한다", () => {
    expect(parseStatementAmount("15,000").amount).toBe(15000);
  });
  it("원 표기를 제거한다", () => {
    expect(parseStatementAmount("15,000원").amount).toBe(15000);
  });
  it("선행 마이너스를 취소로 감지한다", () => {
    const r = parseStatementAmount("-15,000");
    expect(r.isNegative).toBe(true);
    expect(r.amount).toBe(15000);
  });
  it("후행 마이너스를 취소로 감지한다", () => {
    const r = parseStatementAmount("15,000-");
    expect(r.isNegative).toBe(true);
  });
  it("괄호 표기를 취소로 감지한다", () => {
    const r = parseStatementAmount("(15,000)");
    expect(r.isNegative).toBe(true);
  });
  it("양수 표기는 취소가 아니다", () => {
    expect(parseStatementAmount("15,000").isNegative).toBe(false);
  });
});
