#!/usr/bin/env node
/**
 * package.json의 모든 스크립트를 표 형식으로 정리
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const packageJsonPath = path.join(root, "package.json");

try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const scripts = packageJson.scripts || {};
  
  // 카테고리별로 분류
  const categories = {
    "티커 관리": [],
    "데이터 수정": [],
    "데이터 검사": [],
    "데이터 내보내기": [],
    "기타": []
  };
  
  Object.entries(scripts).forEach(([name, cmd]) => {
    if (name.includes("ticker") || name.includes("Ticker")) {
      categories["티커 관리"].push({ name, cmd });
    } else if (name.includes("fix") || name.includes("sync") || name.includes("apply")) {
      categories["데이터 수정"].push({ name, cmd });
    } else if (name.includes("find") || name.includes("check") || name.includes("scan") || name.includes("verify")) {
      categories["데이터 검사"].push({ name, cmd });
    } else if (name.includes("export") || name.includes("ledger")) {
      categories["데이터 내보내기"].push({ name, cmd });
    } else {
      categories["기타"].push({ name, cmd });
    }
  });
  
  console.log("# 사용 가능한 스크립트 목록\n");
  
  Object.entries(categories).forEach(([category, items]) => {
    if (items.length === 0) return;
    
    console.log(`## ${category}\n`);
    console.log("| 스크립트 이름 | 명령어 | 설명 |");
    console.log("|--------------|--------|------|");
    
    items.forEach(({ name, cmd }) => {
      const description = getDescription(name, cmd);
      const cmdShort = cmd.length > 50 ? cmd.substring(0, 47) + "..." : cmd;
      console.log(`| \`${name}\` | \`${cmdShort}\` | ${description} |`);
    });
    
    console.log();
  });
  
  console.log("## 사용법\n");
  console.log("```bash");
  console.log("npm run <스크립트-이름>");
  console.log("```\n");
  
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}

function getDescription(name, cmd) {
  if (name.includes("sync-ticker-names")) return "app-data.json의 티커 이름을 ticker.json 기준으로 동기화";
  if (name.includes("sync-backup-ticker-names")) return "모든 백업 JSON의 티커 이름을 ticker.json 기준으로 동기화";
  if (name.includes("scan-broken-tickers")) return "깨진 티커를 표 형식으로 검사";
  if (name.includes("apply-ticker")) return "ticker.json을 app-data.json에 전체 적용";
  if (name.includes("fix-all-tickers")) return "ticker.md 기준으로 모든 티커 이름 수정";
  if (name.includes("find-replacement-char")) return "대체 문자() 검색";
  if (name.includes("fix-replacement-char")) return "대체 문자() 수정";
  if (name.includes("export-ledger")) return "가계부를 정리.md로 내보내기";
  if (name.includes("fix-categories")) return "깨진 카테고리 이름 수정";
  if (name.includes("fix-text")) return "깨진 텍스트 수정";
  return "자세한 내용은 스크립트 파일 참조";
}
