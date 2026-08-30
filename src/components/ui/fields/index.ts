/**
 * 입력 킷 — 금액·수량·날짜·계좌처럼 앱 전체에서 반복되는 입력의 규칙을 한곳에 모은 컴포넌트들.
 *
 * 규칙(숫자 입력은 type="number" 금지, 천단위 콤마, 통화별 소수 자릿수, 라벨·에러 모양)을
 * 여기서만 정의한다. 페이지에서 <input>을 직접 쓰면 화면마다 규칙이 갈라진다.
 */
export { Field } from "./Field";
export { NumericInput } from "./NumericInput";
export { MoneyField, type FieldCurrency } from "./MoneyField";
export { QuantityField } from "./QuantityField";
export { DateField } from "./DateField";
export { AccountSelect } from "./AccountSelect";
