import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { countDigitsBefore, caretAfterDigits } from "../utils/caret";
import { formatKRW, formatUSD, formatQuantity, formatNumber } from "../utils/formatter";
import { MoneyField } from "../components/ui/fields";

describe("커서 위치 계산", () => {
  it("커서 앞의 숫자 개수를 센다 (콤마는 세지 않는다)", () => {
    expect(countDigitsBefore("1,234,567", 5)).toBe(4); // "1,234" → 1234
    expect(countDigitsBefore("1,234,567", 0)).toBe(0);
    expect(countDigitsBefore("1,234,567", 99)).toBe(7);
  });

  it("숫자 N개를 지난 위치를 찾는다", () => {
    expect(caretAfterDigits("1,234,567", 4)).toBe(5); // "1,234|,567"
    expect(caretAfterDigits("1,234,567", 7)).toBe(9);
    expect(caretAfterDigits("1,234", 0)).toBe(0);
  });

  it("음수는 부호 뒤에서 시작한다", () => {
    expect(caretAfterDigits("-1,234", 0)).toBe(1);
    expect(caretAfterDigits("-1,234", 1)).toBe(2);
  });

  it("숫자가 모자라면 끝을 반환한다", () => {
    expect(caretAfterDigits("12", 5)).toBe(2);
  });
});

const Harness: React.FC = () => {
  const [value, setValue] = useState("1234567");
  return <MoneyField label="금액" value={value} onChange={setValue} />;
};

describe("MoneyField 커서 유지", () => {
  it("금액 중간을 고쳐도 커서가 맨 뒤로 튀지 않는다", () => {
    render(<Harness />);
    const input = screen.getByLabelText(/금액/) as HTMLInputElement;
    input.focus();

    // "1234567"에서 4번째 숫자 뒤를 편집 중인 상황
    fireEvent.change(input, { target: { value: "1234567", selectionStart: 4 } });

    expect(input.value).toBe("1,234,567");
    // 숫자 4개("1234")를 지난 위치 = "1,234|,567"
    expect(input.selectionStart).toBe(5);
  });
});

describe("표시 정밀도", () => {
  it("집계는 반올림이 기본 (기존 동작 유지)", () => {
    expect(formatKRW(1234.56)).toBe("1,235 원");
    expect(formatNumber(1234.56)).toBe("1,235");
  });

  it("exact면 입력한 소수를 그대로 보여준다", () => {
    // 회귀: 수수료 212.25원을 입력받아 놓고 목록에서 212원으로 보이던 문제
    expect(formatKRW(212.25, { exact: true })).toBe("212.25 원");
    expect(formatKRW(1234, { exact: true })).toBe("1,234 원");
    expect(formatKRW(1234.5, { exact: true })).toBe("1,234.5 원"); // 뒤따르는 0 제거
  });

  it("exact는 자릿수 상한을 지킨다", () => {
    expect(formatKRW(0.3612, { exact: true, maxDecimals: 4 })).toBe("0.3612 원");
    expect(formatKRW(0.3612, { exact: true })).toBe("0.36 원");
  });

  it("USD도 exact면 유효 자릿수만", () => {
    expect(formatUSD(1234.5)).toBe("$1,234.500");
    expect(formatUSD(1234.5, { exact: true })).toBe("$1,234.5");
    expect(formatUSD(0.0001, { exact: true })).toBe("$0.0001");
  });

  it("수량은 코인 8자리까지 살리고 뒤따르는 0은 지운다", () => {
    expect(formatQuantity(0.00382828)).toBe("0.00382828");
    expect(formatQuantity(0.5)).toBe("0.5");
    expect(formatQuantity(1234)).toBe("1,234");
  });

  it("음수도 콤마와 부호를 유지한다", () => {
    expect(formatKRW(-1234.5, { exact: true })).toBe("-1,234.5 원");
  });
});
