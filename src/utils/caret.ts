/**
 * 숫자 입력에서 콤마를 다시 붙일 때 커서를 제자리에 두기 위한 계산.
 *
 * 문제: "1,234,567" 중간에서 숫자를 지우면 값이 "123,456"으로 다시 포맷되는데,
 * controlled input은 value가 바뀔 때 커서를 문자열 끝으로 보낸다.
 * 금액 중간을 고칠 때마다 커서가 맨 뒤로 튀어 다시 클릭해야 했다.
 *
 * 해결: 커서 앞의 "숫자 문자 개수"는 포맷 전후로 보존된다는 성질을 이용해
 * 새 문자열에서 같은 개수의 숫자가 지나간 지점을 찾는다.
 */

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

/** 문자열 앞부분(0..caret)에 있는 숫자 문자 개수 */
export function countDigitsBefore(text: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < Math.min(caret, text.length); i++) {
    if (isDigit(text[i])) count++;
  }
  return count;
}

/**
 * 숫자 digitCount개를 지난 직후의 커서 위치.
 * 소수점·마이너스 같은 비숫자는 건너뛰며 세고, 숫자가 부족하면 문자열 끝을 돌려준다.
 */
export function caretAfterDigits(text: string, digitCount: number): number {
  if (digitCount <= 0) {
    // 맨 앞 — 부호(-)가 있으면 그 뒤로
    return text.startsWith("-") ? 1 : 0;
  }
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (isDigit(text[i])) {
      seen++;
      if (seen === digitCount) return i + 1;
    }
  }
  return text.length;
}
