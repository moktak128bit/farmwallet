import { describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoneyField, QuantityField, DateField } from "../components/ui/fields";
import { parseAmount, formatAmount } from "../utils/parseAmount";

/** 실제 사용처처럼 상태를 물고 도는 래퍼 — 컨트롤드 입력의 포맷 결과를 확인 */
const MoneyHarness: React.FC<{
  currency?: "KRW" | "USD";
  allowDecimal?: boolean;
  initial?: string;
}> = ({ currency = "KRW", allowDecimal, initial = "" }) => {
  const [value, setValue] = useState(initial);
  return (
    <MoneyField
      label="금액"
      currency={currency}
      allowDecimal={allowDecimal}
      value={value}
      onChange={setValue}
    />
  );
};

const QuantityHarness: React.FC<{ maxDecimals: number }> = ({ maxDecimals }) => {
  const [value, setValue] = useState("");
  return (
    <QuantityField label="수량" value={value} onChange={setValue} maxDecimals={maxDecimals} />
  );
};

describe("MoneyField", () => {
  it("원화 입력에 천 단위 콤마를 넣는다", () => {
    render(<MoneyHarness />);
    const input = screen.getByLabelText(/금액/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "110890000" } });
    expect(input.value).toBe("110,890,000");
  });

  it("숫자가 아닌 입력은 흘려보낸다", () => {
    render(<MoneyHarness />);
    const input = screen.getByLabelText(/금액/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1a2b3c" } });
    expect(input.value).toBe("123");
  });

  it("회귀: 원화라도 allowDecimal이면 212.25를 그대로 받는다", () => {
    // type="number" + step="1" 시절에는 브라우저가 "유효한 값을 입력하세요"로 저장을 막았다
    render(<MoneyHarness allowDecimal />);
    const input = screen.getByLabelText(/금액/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "212.25" } });
    expect(input.value).toBe("212.25");
    expect(parseAmount(input.value, { allowDecimal: true })).toBe(212.25);
  });

  it("원화 기본값은 정수 — 소수점을 붙여도 정수만 남는다", () => {
    render(<MoneyHarness />);
    const input = screen.getByLabelText(/금액/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1234.56" } });
    expect(input.value).toBe("123,456");
  });

  it("USD는 기본으로 소수 2자리까지", () => {
    render(<MoneyHarness currency="USD" />);
    const input = screen.getByLabelText(/금액/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1234.5678" } });
    expect(input.value).toBe("1,234.56");
  });

  it("스크롤 휠로 값이 바뀌지 않도록 number 타입을 쓰지 않는다", () => {
    render(<MoneyHarness />);
    const input = screen.getByLabelText(/금액/) as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("numeric");
  });
});

describe("QuantityField", () => {
  it("코인 수량은 소수점 8자리를 유지한다", () => {
    render(<QuantityHarness maxDecimals={8} />);
    const input = screen.getByLabelText(/수량/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.00382828" } });
    expect(input.value).toBe("0.00382828");
  });

  it("국내주식(정수)에서는 소수점을 버린다", () => {
    render(<QuantityHarness maxDecimals={0} />);
    const input = screen.getByLabelText(/수량/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "10.5" } });
    expect(input.value).toBe("105");
  });
});

describe("DateField", () => {
  it("오늘 버튼이 yyyy-mm-dd를 채운다", () => {
    const onChange = vi.fn();
    render(<DateField label="거래일" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatAmount / parseAmount", () => {
  it("입력 중인 소수점('1234.')을 지우지 않는다", () => {
    expect(formatAmount("1234.", { allowDecimal: true })).toBe("1,234.");
  });

  it("maxDecimals로 자릿수를 제한한다", () => {
    expect(formatAmount("1.123456789", { allowDecimal: true, maxDecimals: 8 })).toBe("1.12345678");
    expect(parseAmount("1.123456789", { allowDecimal: true, maxDecimals: 8 })).toBeCloseTo(1.12345678, 8);
  });

  it("소수점이 여러 개여도 첫 점만 남긴다", () => {
    expect(formatAmount("1.2.3", { allowDecimal: true })).toBe("1.23");
  });
});

describe('음수 허용 (부채·현금 조정)', () => {
  it('allowNegative면 -100,000을 유지한다', () => {
    expect(formatAmount('-100000', { allowNegative: true })).toBe('-100,000');
    expect(parseAmount('-100,000', { allowNegative: true })).toBe(-100000);
  });

  it("타이핑 중인 마이너스 하나만 친 상태도 지우지 않는다", () => {
    expect(formatAmount('-', { allowNegative: true })).toBe('-');
  });

  it('기본값은 여전히 양수만 (가계부 금액은 kind로 방향을 정한다)', () => {
    expect(formatAmount('-5000')).toBe('5,000');
    expect(parseAmount('-5000')).toBe(5000);
  });

  it('맨 앞이 아닌 마이너스는 부호가 아니다', () => {
    expect(parseAmount('10-5', { allowNegative: true })).toBe(105);
  });
});
