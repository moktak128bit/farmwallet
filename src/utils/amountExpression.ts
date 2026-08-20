/**
 * 금액 계산식 — 안전한 재귀 하강 파서 (eval 금지). "12000+3500*2/3", "(12000+3500)/2" 등.
 *  - 허용: 숫자(콤마·소수점 포함), + - * / × ÷, 괄호, 공백, 단항 마이너스
 *  - 결과: KRW=정수 반올림, USD(allowDecimal)=소수 2자리 반올림. 0 이하·비유한·0 나누기·문법 오류 → null
 * 가계부 금액란(LedgerEntryForm)과 validateLedgerForm이 공유한다.
 */

const OPERATOR_RE = /[+\-*/×÷()]/;
/** 계산식으로 취급할 입력 — 연산자·괄호가 하나라도 있으면 (콤마·숫자만인 일반 금액은 제외) */
export function isAmountExpression(input: string | null | undefined): boolean {
  if (!input) return false;
  return OPERATOR_RE.test(input);
}

/** 금액란 onChange용 — 계산식 모드에서 허용 문자만 남긴다 (전각 숫자는 반각으로) */
export function sanitizeAmountExpressionInput(input: string): string {
  return (input || "")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[^\d.,+\-*/×÷()\s]/g, "");
}

interface EvalOptions {
  /** USD 등 소수 허용 — 소수 2자리 반올림. 기본 false(정수 반올림) */
  allowDecimal?: boolean;
}

type Token = { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "("; v: "(" } | { t: ")"; v: ")" };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const s = src.replace(/×/g, "*").replace(/÷/g, "/");
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t") { i += 1; continue; }
    if (ch === "(" ) { tokens.push({ t: "(", v: "(" }); i += 1; continue; }
    if (ch === ")" ) { tokens.push({ t: ")", v: ")" }); i += 1; continue; }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") { tokens.push({ t: "op", v: ch }); i += 1; continue; }
    if ((ch >= "0" && ch <= "9") || ch === "." || ch === ",") {
      let j = i;
      let text = "";
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === "." || s[j] === ",")) {
        if (s[j] !== ",") text += s[j];
        j += 1;
      }
      if (!text || text === "." || (text.match(/\./g) || []).length > 1) return null;
      const v = Number(text);
      if (!Number.isFinite(v)) return null;
      tokens.push({ t: "num", v });
      i = j;
      continue;
    }
    return null; // 허용되지 않는 문자
  }
  return tokens;
}

/** 재귀 하강: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-' unary | primary ; primary := num | '(' expr ')' */
function parseTokens(tokens: Token[]): number | null {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const primary = (): number | null => {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === "num") { next(); return tk.v; }
    if (tk.t === "(") {
      next();
      const v = expr();
      if (v === null) return null;
      const close = next();
      if (!close || close.t !== ")") return null;
      return v;
    }
    return null;
  };
  const unary = (): number | null => {
    const tk = peek();
    if (tk && tk.t === "op" && tk.v === "-") { next(); const v = unary(); return v === null ? null : -v; }
    if (tk && tk.t === "op" && tk.v === "+") { next(); return unary(); }
    return primary();
  };
  const term = (): number | null => {
    let left = unary();
    if (left === null) return null;
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== "op" || (tk.v !== "*" && tk.v !== "/")) return left;
      next();
      const right = unary();
      if (right === null) return null;
      if (tk.v === "/") {
        if (right === 0) return null; // 0 나누기
        left = left / right;
      } else {
        left = left * right;
      }
    }
  };
  const expr = (): number | null => {
    let left = term();
    if (left === null) return null;
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== "op" || (tk.v !== "+" && tk.v !== "-")) return left;
      next();
      const right = term();
      if (right === null) return null;
      left = tk.v === "+" ? left + right : left - right;
    }
  };

  const result = expr();
  if (result === null || pos !== tokens.length) return null;
  return result;
}

/**
 * 계산식 평가. 유효하지 않거나(문법 오류·0 나누기·음수·0) 결과가 비유한이면 null → 호출 측은 입력을 그대로 두고 검증 에러로 안내.
 */
export function evaluateAmountExpression(input: string | null | undefined, options: EvalOptions = {}): number | null {
  if (!input || !input.trim()) return null;
  const tokens = tokenize(input.trim());
  if (!tokens || tokens.length === 0) return null;
  const raw = parseTokens(tokens);
  if (raw === null || !Number.isFinite(raw)) return null;
  const rounded = options.allowDecimal ? Math.round(raw * 100) / 100 : Math.round(raw);
  if (!(rounded > 0)) return null;
  return rounded;
}

/** 더치페이 — 금액을 N명으로 나눈 1인분 (KRW 정수 반올림 / USD 소수 2자리). N<2 또는 금액≤0이면 null */
export function splitAmountByPeople(amount: number, people: number, options: EvalOptions = {}): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isInteger(people) || people < 2) return null;
  const v = amount / people;
  const rounded = options.allowDecimal ? Math.round(v * 100) / 100 : Math.round(v);
  return rounded > 0 ? rounded : null;
}
