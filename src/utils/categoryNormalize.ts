/**
 * 카테고리/세부분류 정규화 유틸
 * dataService, AdvancedSearch 등에서 공통 사용
 */

const CATEGORY_MAP: Record<string, string> = {
  "유류통": "유류교통비",
  "데이비": "데이트비",
  "이비": "데이트비",
  "식이건": "식비",
  "식": "식비",
  "장/마트": "시장/마트",
  "시장/미트": "시장/마트",
  "저축성지출출": "저축성지출",
  "경조사회비": "경조사비",
  "입": "수입"
};

const SUB_CATEGORY_MAP: Record<string, string> = {
  "데이비": "데이트비",
  "이비": "데이트비",
  "식": "식비",
  "장/마트": "시장/마트",
  "시장/미트": "시장/마트",
  "건": "물건",
  "유트브": "유튜브"
};

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /^유류.*통/, replacement: "유류교통비" },
  { pattern: /^데이트|^데이.*비$|^이비$/, replacement: "데이트비" },
  { pattern: /^식비$|^식$/, replacement: "식비" },
  { pattern: /^시장.*마트$|^시장.*미트$|^장.*마트$/, replacement: "시장/마트" },
  { pattern: /^저축성.*출/, replacement: "저축성지출" },
  { pattern: /^경조사/, replacement: "경조사비" },
  { pattern: /^수입$|^입$/, replacement: "수입" }
];

const SUB_CATEGORY_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /^데이트|^데이.*비$|^이비$/, replacement: "데이트비" },
  { pattern: /^식비$|^식$/, replacement: "식비" },
  { pattern: /^시장.*마트$|^시장.*미트$|^장.*마트$/, replacement: "시장/마트" },
  { pattern: /^물건$|^건$/, replacement: "물건" },
  { pattern: /^유류.*통/, replacement: "유류교통비" },
  { pattern: /^유튜브|^유트/, replacement: "유튜브" }
];

/**
 * 깨진 문자 제거 (한글·영문·숫자·슬래시만 유지)
 */
function clean(str: string): string {
  return str.replace(/[^\w가-힣/]/g, "");
}

/**
 * 대분류(카테고리) 정규화
 */
export function normalizeCategory(cat: string): string {
  if (!cat) return cat;
  const cleanCat = clean(cat);

  if (CATEGORY_MAP[cat]) return CATEGORY_MAP[cat];
  if (CATEGORY_MAP[cleanCat]) return CATEGORY_MAP[cleanCat];

  for (const { pattern, replacement } of CATEGORY_PATTERNS) {
    if (pattern.test(cat) || pattern.test(cleanCat)) return replacement;
  }

  if (cleanCat === "식" || (cleanCat.length === 1 && cat.includes("식"))) return "식비";
  if (cleanCat === "입" || (cleanCat.length === 1 && cat.includes("입"))) return "수입";
  if (cleanCat === "이비" || (cleanCat.length === 2 && cleanCat.includes("이") && cleanCat.includes("비"))) return "데이트비";

  return cat;
}

/**
 * 세부분류 정규화
 */
export function normalizeSubCategory(sub: string): string {
  if (!sub) return sub;
  const cleanSub = clean(sub);

  if (SUB_CATEGORY_MAP[sub]) return SUB_CATEGORY_MAP[sub];
  if (SUB_CATEGORY_MAP[cleanSub]) return SUB_CATEGORY_MAP[cleanSub];

  for (const { pattern, replacement } of SUB_CATEGORY_PATTERNS) {
    if (pattern.test(sub) || pattern.test(cleanSub)) return replacement;
  }

  if (cleanSub === "건" || (cleanSub.length === 1 && sub.includes("건"))) return "물건";
  if (cleanSub === "장/마트" || (cleanSub.includes("장") && cleanSub.includes("마트"))) return "시장/마트";
  if (cleanSub === "이비" || (cleanSub.length === 2 && cleanSub.includes("이") && cleanSub.includes("비"))) return "데이트비";

  return sub;
}
