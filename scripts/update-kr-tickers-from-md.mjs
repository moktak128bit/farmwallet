#!/usr/bin/env node
/**
 * data/ticker.md → data/ticker.json의 KR 배열 업데이트
 * 탭으로 구분된 ticker.md에서 한국 티커(6자리 숫자)만 추출하여 ticker.json 업데이트
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mdPath = path.join(root, "data", "ticker.md");
const tickerJsonPath = path.join(root, "data", "ticker.json");

try {
  console.log("ticker.md 읽는 중...");
  const mdContent = fs.readFileSync(mdPath, "utf-8");
  const lines = mdContent.split("\n").filter((line) => line.trim());

  // 헤더 스킵
  const dataLines = lines.slice(1);

  const krTickers = [];
  const usTickers = [];

  // 깨진 문자 수정 함수
  function fixBrokenName(name) {
    if (!name) return name;
    
    // 깨진 문자 제거 (유니코드 대체 문자 및 기타 제어 문자)
    let fixed = name.replace(/[\uFFFD\uFFFE\uFFFF\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, "");
    
    // 반복되는 한글 문자 제거 (예: "글글글" → "글", "터터터" → "터")
    fixed = fixed.replace(/([가-힣])\1+/g, "$1");
    
    // 일반적인 깨진 패턴 수정
    fixed = fixed.replace(/차이나창판/g, "차이나과창판");
    fixed = fixed.replace(/ACE국과창판/g, "ACE 중국과창판");
    fixed = fixed.replace(/에너나닥/g, "에너지나스닥");
    fixed = fixed.replace(/에너나스닥/g, "에너지나스닥");
    fixed = fixed.replace(/2차지/g, "2차전지");
    fixed = fixed.replace(/로벌워/g, "글로벌워터");
    fixed = fixed.replace(/글로벌워/g, "글로벌워터");
    fixed = fixed.replace(/글로벌워런/g, "글로벌워터");
    fixed = fixed.replace(/레리지\(성/g, "레버리지(합성");
    fixed = fixed.replace(/레버리지\(성/g, "레버리지(합성");
    fixed = fixed.replace(/에플러스/g, "에셋플러스");
    fixed = fixed.replace(/에바이오텍/g, "에셋바이오텍");
    fixed = fixed.replace(/에바이오/g, "에셋바이오");
    
    // "대장이" → "대장장이" (대장장이가 깨진 경우)
    fixed = fixed.replace(/대장이액티브/g, "대장장이액티브");
    fixed = fixed.replace(/대장이/g, "대장장이");
    
    // "글로벌워터" 패턴 수정 (글로벌워터가 깨진 경우)
    if (fixed.includes("글로벌") && fixed.includes("워터") && !fixed.includes("글로벌워터")) {
      fixed = fixed.replace(/글로벌[^워]*워터/g, "글로벌워터");
    }
    
    // "글로벌워"만 있고 "터"가 없는 경우
    if (fixed.includes("글로벌워") && !fixed.includes("글로벌워터") && !fixed.includes("글로벌워런")) {
      fixed = fixed.replace(/글로벌워([^터런])/g, "글로벌워터$1");
      fixed = fixed.replace(/글로벌워$/g, "글로벌워터");
    }
    
    // 연속된 공백 정리
    fixed = fixed.replace(/\s+/g, " ").trim();
    
    return fixed;
  }

  for (const line of dataLines) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const ticker = parts[0].trim();
    let name = parts[1].trim();

    if (!ticker || !name) continue;
    
    // 줄바꿈 문자 제거 (CRLF 등)
    name = name.replace(/\r\n|\r|\n/g, "");
    
    // 깨진 문자 수정
    name = fixBrokenName(name);
    
    // 424460 특수 처리 (글로벌워터가 깨진 경우)
    if (ticker === "424460" && name.includes("글로벌") && name.includes("워터")) {
      name = "HANARO 글로벌워터MSCI(합성)";
    }

    // 한국 티커: 6자리 숫자로 시작 (예: 005930, 000660)
    // 또는 6자리 알파벳+숫자 조합 (예: 0000H0, 0053L0)
    if (/^[0-9A-Z]{6}$/.test(ticker) && /[0-9]/.test(ticker)) {
      krTickers.push({ ticker, name });
    } else if (/^[A-Z]{1,5}$/.test(ticker) || /^[A-Z]+\.[A-Z]$/.test(ticker)) {
      // 미국 티커: 알파벳만 또는 BRK.A 형식
      usTickers.push({ ticker, name });
    }
  }

  console.log(`한국 티커: ${krTickers.length}개`);
  console.log(`미국 티커: ${usTickers.length}개`);

  // ticker.json 읽기 (US는 유지하기 위해)
  console.log("ticker.json 읽기 중...");
  let tickerData = { KR: [], US: [] };
  try {
    const tickerJsonRaw = fs.readFileSync(tickerJsonPath, "utf-8");
    const parsed = JSON.parse(tickerJsonRaw);
    // US만 유지 (KR은 ticker.md에서 새로 가져온 것으로 교체)
    tickerData.US = parsed.US || [];
    console.log(`기존 US 티커: ${tickerData.US.length}개 유지`);
  } catch (err) {
    console.warn("ticker.json 읽기 실패, 새로 생성합니다:", err.message);
  }

  // KR 배열을 ticker.md에서 새로 가져온 것으로 완전히 교체
  tickerData.KR = krTickers;
  // US도 업데이트 (선택사항 - 원하면 주석 해제)
  // tickerData.US = usTickers;

  console.log("ticker.json 저장 중...");
  fs.writeFileSync(tickerJsonPath, JSON.stringify(tickerData, null, 2), "utf-8");

  console.log(
    `✅ 완료! ticker.json의 KR 배열이 ${krTickers.length}개로 업데이트되었습니다.`
  );
  console.log(`다음 단계: npm run apply-ticker`);
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
