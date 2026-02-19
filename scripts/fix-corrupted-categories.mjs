#!/usr/bin/env node
/**
 * data/app-data.json의 깨진 카테고리 이름 수정
 * dataService.ts의 fixCorruptedCategoryNames와 동일 로직
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");

// 깨진 카테고리 이름 수정 함수 (dataService.ts와 동일)
function fixCorruptedCategoryNames(ledger) {
  const categoryMap = {
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

  const subCategoryMap = {
    "데이비": "데이트비",
    "이비": "데이트비",
    "식": "식비",
    "장/마트": "시장/마트",
    "시장/미트": "시장/마트",
    "건": "물건",
    "유트브": "유튜브"
  };

  const categoryPatterns = [
    { pattern: /^유류.*통/, replacement: "유류교통비" },
    { pattern: /^데이트|^데이.*비$|^이비$/, replacement: "데이트비" },
    { pattern: /^식비$|^식$/, replacement: "식비" },
    { pattern: /^시장.*마트$|^시장.*미트$|^장.*마트$/, replacement: "시장/마트" },
    { pattern: /^저축성.*출/, replacement: "저축성지출" },
    { pattern: /^경조사/, replacement: "경조사비" },
    { pattern: /^수입$|^입$/, replacement: "수입" }
  ];

  const subCategoryPatterns = [
    { pattern: /^데이트|^데이.*비$|^이비$/, replacement: "데이트비" },
    { pattern: /^식비$|^식$/, replacement: "식비" },
    { pattern: /^시장.*마트$|^시장.*미트$|^장.*마트$/, replacement: "시장/마트" },
    { pattern: /^물건$|^건$/, replacement: "물건" },
    { pattern: /^유류.*통/, replacement: "유류교통비" },
    { pattern: /^유튜브|^유트/, replacement: "유튜브" }
  ];

  function normalizeCategory(cat) {
    if (!cat) return cat;
    const cleanCat = cat.replace(/[^\w가-힣/]/g, "");

    if (categoryMap[cat]) return categoryMap[cat];
    if (categoryMap[cleanCat]) return categoryMap[cleanCat];

    for (const { pattern, replacement } of categoryPatterns) {
      if (pattern.test(cat)) return replacement;
    }
    for (const { pattern, replacement } of categoryPatterns) {
      if (pattern.test(cleanCat)) return replacement;
    }

    if (cleanCat === "식" || (cleanCat.length === 1 && cat.includes("식"))) return "식비";
    if (cleanCat === "입" || (cleanCat.length === 1 && cat.includes("입"))) return "수입";
    if (cleanCat === "이비" || (cleanCat.length === 2 && cleanCat.includes("이") && cleanCat.includes("비"))) return "데이트비";

    return cat;
  }

  function normalizeSubCategory(sub) {
    if (!sub) return sub;
    const cleanSub = sub.replace(/[^\w가-힣/]/g, "");

    if (subCategoryMap[sub]) return subCategoryMap[sub];
    if (subCategoryMap[cleanSub]) return subCategoryMap[cleanSub];

    for (const { pattern, replacement } of subCategoryPatterns) {
      if (pattern.test(sub)) return replacement;
    }
    for (const { pattern, replacement } of subCategoryPatterns) {
      if (pattern.test(cleanSub)) return replacement;
    }

    if (cleanSub === "건" || (cleanSub.length === 1 && sub.includes("건"))) return "물건";
    if (cleanSub === "장/마트" || (cleanSub.includes("장") && cleanSub.includes("마트"))) return "시장/마트";
    if (cleanSub === "이비" || (cleanSub.length === 2 && cleanSub.includes("이") && cleanSub.includes("비"))) return "데이트비";

    return sub;
  }

  let fixedCount = 0;
  const fixed = ledger.map((entry) => {
    const fixedCategory = entry.category ? normalizeCategory(entry.category) : entry.category;
    const fixedSubCategory = entry.subCategory ? normalizeSubCategory(entry.subCategory) : entry.subCategory;

    if (fixedCategory !== entry.category || fixedSubCategory !== entry.subCategory) {
      fixedCount++;
      return {
        ...entry,
        category: fixedCategory,
        subCategory: fixedSubCategory
      };
    }

    return entry;
  });

  return { fixed, fixedCount };
}

try {
  console.log("app-data.json 읽는 중...");
  const appDataRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appDataRaw);

  if (!appData.ledger || !Array.isArray(appData.ledger)) {
    console.log("❌ ledger 데이터가 없습니다.");
    process.exit(1);
  }

  console.log(`원본 ledger 항목: ${appData.ledger.length}개`);

  const { fixed, fixedCount } = fixCorruptedCategoryNames(appData.ledger);
  appData.ledger = fixed;

  console.log(`수정된 항목: ${fixedCount}개`);

  console.log("app-data.json 저장 중...");
  fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");

  console.log(`✅ 완료! ${fixedCount}개 항목의 깨진 카테고리 이름이 수정되었습니다.`);
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
