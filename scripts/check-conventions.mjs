#!/usr/bin/env node
/**
 * check-conventions — CLAUDE.md 필수 컨벤션 grep 게이트 (베이스라인 방식)
 *
 *   node scripts/check-conventions.mjs                   # 베이스라인 대비 '새 위반'만 실패(exit 1)
 *   node scripts/check-conventions.mjs --update-baseline # 현재 위반을 scripts/conventions-baseline.json 에 박제
 *   node scripts/check-conventions.mjs --list            # 현재 위반 전체 출력(베이스라인 포함)
 *
 * 규칙(rule id):
 *   utc-date          `toISOString().slice(0,10)` / `new Date("YYYY-MM-DD")` — KST 유틸(getTodayKST/parseIsoLocal) 대신 UTC 사용
 *   inline-hex        JSX style={{…}} / fill= / stroke= / color= 등 CSS 컨텍스트의 hex 리터럴 — CSS 변수(var(--…)) 사용
 *   chart-animation   recharts 시리즈(<Line|Bar|Area|Pie|Scatter|Radar|RadialBar|Funnel>)에 isAnimationActive 누락
 *   category-match    `includes("배당")` / `includes("이자")` 직접 사용 — utils/categoryMatch.ts 단일 진입점 사용
 *   date-now-id       `Date.now()` 를 문자열 템플릿/연결로 id 조합 — utils/id.ts newIdWithPrefix 사용
 *   raw-keydown       window/document.addEventListener("keydown") 를 useModalStackEntry 없이 사용 — shortcutManager/useFocusTrap 사용
 *
 * 서명은 `file|rule|snippet`(줄 번호 제외) + 횟수 기반이라 위/아래 줄 편집으로 깨지지 않는다.
 * 같은 서명의 횟수가 베이스라인보다 늘어날 때만 새 위반으로 본다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const baselinePath = path.join(__dirname, "conventions-baseline.json");
const args = process.argv.slice(2);
const updateBaseline = args.includes("--update-baseline");
const listAll = args.includes("--list");

const scanRoot = path.join(rootDir, "src");
const codeExtensions = new Set([".ts", ".tsx"]);
const excludeDirs = new Set(["node_modules", ".git", "dist", "__tests__", "data"]);

/** 규칙별 제외 파일(정당한 단일 소스/레지스트리). 경로는 src/ 기준 슬래시 구분. */
const ruleExcludes = {
  "inline-hex": [
    "components/ThemeCustomizer.tsx", // 테마 프리셋 hex 정의 자체가 목적
    "features/workout/constants.ts", // 운동 파트별 고정 팔레트 상수
  ],
  "category-match": ["utils/categoryMatch.ts"],
  "date-now-id": ["utils/id.ts"],
  "raw-keydown": ["hooks/useFocusTrap.ts", "hooks/useKeyboardShortcuts.ts", "utils/shortcuts.ts"],
  "utc-date": ["utils/date.ts"],
};

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!codeExtensions.has(ext)) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    out.push(path.join(dir, entry.name));
  }
}

function clip(text) {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
}

/** 한 줄에서 // 주석과 /* … *\/ 블록 주석(라인 내·라인 걸침)을 공백으로 치환. 문자열 안 `//`(URL 등)는 보존. */
function stripComments(lines) {
  const out = [];
  let inBlock = false;
  for (const raw of lines) {
    let s = "";
    let i = 0;
    let quote = null;
    while (i < raw.length) {
      const ch = raw[i];
      const next = raw[i + 1];
      if (inBlock) {
        if (ch === "*" && next === "/") { inBlock = false; i += 2; s += "  "; continue; }
        i += 1; s += " "; continue;
      }
      if (quote) {
        if (ch === "\\") { s += ch + (next ?? ""); i += 2; continue; }
        if (ch === quote) quote = null;
        s += ch; i += 1; continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; s += ch; i += 1; continue; }
      if (ch === "/" && next === "/") { break; }
      if (ch === "/" && next === "*") { inBlock = true; i += 2; s += "  "; continue; }
      s += ch; i += 1;
    }
    out.push(s);
  }
  return out;
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const CSS_CONTEXT_RE = /\b(style|fill|stroke|stopColor|color|background|backgroundColor|border|borderColor|borderTop|borderBottom|borderLeft|borderRight|outline|boxShadow|textShadow|gradient|Color|Colors|COLOR|COLORS|palette|PALETTE)\b/;
const STYLE_OPEN_RE = /style=\{\{/;
const SERIES_OPEN_RE = /<(Line|Bar|Area|Pie|Scatter|Radar|RadialBar|Funnel)(?=[\s/>])/g;

function scanFile(absPath) {
  const rel = normalizePath(path.relative(scanRoot, absPath));
  const file = `src/${rel}`;
  const rawLines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
  const lines = stripComments(rawLines);
  const issues = [];
  const push = (rule, index, snippet) => {
    if ((ruleExcludes[rule] ?? []).includes(rel)) return;
    issues.push({ file, rule, line: index + 1, snippet: clip(snippet ?? rawLines[index]) });
  };

  // ① utc-date
  lines.forEach((line, i) => {
    if (/toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(line)) push("utc-date", i);
    if (/new Date\(\s*["'`]\d{4}-\d{2}-\d{2}["'`]\s*\)/.test(line)) push("utc-date", i);
  });

  // ② inline-hex — style={{ … }} 블록 내부 또는 CSS 컨텍스트 키워드가 있는 줄의 문자열 hex
  if (rel.endsWith(".tsx") || rel.endsWith(".ts")) {
    let styleDepth = 0; // style={{ 이후 중괄호 깊이 (0이면 블록 밖)
    lines.forEach((line, i) => {
      const inStyleBlock = styleDepth > 0;
      const hasContext = inStyleBlock || CSS_CONTEXT_RE.test(line);
      if (hasContext) {
        const hits = line.match(HEX_RE) ?? [];
        // 문자열/템플릿 안의 hex 만 (식별자·URL 해시 등 제외): 앞뒤가 따옴표·공백·쉼표·괄호인 경우
        for (const h of hits) {
          const idx = line.indexOf(h);
          const before = line[idx - 1] ?? "";
          if (!/["'`\s,(:]/.test(before)) continue;
          push("inline-hex", i, line);
          break;
        }
      }
      // style 블록 깊이 추적 (한 줄에 열고 닫히면 0 유지)
      let j = 0;
      while (j < line.length) {
        if (styleDepth === 0) {
          const m = STYLE_OPEN_RE.exec(line.slice(j));
          if (!m) break;
          j += m.index + m[0].length;
          styleDepth = 2;
          continue;
        }
        const ch = line[j];
        if (ch === "{") styleDepth += 1;
        else if (ch === "}") styleDepth -= 1;
        j += 1;
        if (styleDepth <= 0) { styleDepth = 0; }
      }
    });
  }

  // ③ chart-animation — recharts 시리즈 태그(여러 줄 가능)에 isAnimationActive 없음
  if (rel.endsWith(".tsx")) {
    const src = lines.join("\n");
    let m;
    SERIES_OPEN_RE.lastIndex = 0;
    while ((m = SERIES_OPEN_RE.exec(src)) !== null) {
      // 태그 끝(>)까지: 중괄호 깊이 0에서 첫 '>' (화살표 함수 '=>' 는 중괄호 안에 있으므로 제외됨)
      let k = m.index + m[0].length;
      let depth = 0;
      let end = -1;
      while (k < src.length) {
        const ch = src[k];
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        else if (ch === ">" && depth === 0 && src[k - 1] !== "=") { end = k; break; }
        k += 1;
      }
      if (end < 0) break;
      const tag = src.slice(m.index, end + 1);
      if (!/isAnimationActive/.test(tag)) {
        const lineIdx = src.slice(0, m.index).split("\n").length - 1;
        push("chart-animation", lineIdx, `<${m[1]} … ${clip(tag).slice(0, 80)}`);
      }
    }
  }

  // ④ category-match
  lines.forEach((line, i) => {
    if (/\.includes\(\s*["'](배당|이자)["']\s*\)/.test(line)) push("category-match", i);
  });

  // ⑤ date-now-id — `${Date.now()}` 템플릿, 또는 문자열 + Date.now() 연결
  lines.forEach((line, i) => {
    if (/\$\{\s*Date\.now\(\)\s*\}/.test(line) || /["'`][^"'`]*["'`]\s*\+\s*Date\.now\(\)/.test(line) || /Date\.now\(\)\s*\+\s*["'`]/.test(line)) {
      push("date-now-id", i);
    }
  });

  // ⑥ raw-keydown — 파일 단위: keydown 리스너 직접 등록 + useModalStackEntry 미사용
  const joined = lines.join("\n");
  if (/\b(window|document)\s*\.\s*addEventListener\(\s*["']keydown["']/.test(joined) && !/useModalStackEntry/.test(joined)) {
    const idx = lines.findIndex((l) => /addEventListener\(\s*["']keydown["']/.test(l));
    push("raw-keydown", Math.max(0, idx));
  }

  return issues;
}

const files = [];
collectFiles(scanRoot, files);
files.sort();
const allIssues = files.flatMap(scanFile);

const signatureOf = (issue) => `${issue.file}|${issue.rule}|${issue.snippet}`;
const counts = new Map();
for (const issue of allIssues) {
  const sig = signatureOf(issue);
  counts.set(sig, (counts.get(sig) ?? 0) + 1);
}

const byRule = {};
for (const issue of allIssues) byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
const ruleSummary = Object.entries(byRule).map(([r, n]) => `${r}=${n}`).join(", ") || "none";

if (listAll) {
  allIssues.forEach((issue) => console.log(`- ${issue.file}:${issue.line} [${issue.rule}] ${issue.snippet}`));
  console.log(`[check-conventions] total: ${allIssues.length} (${ruleSummary})`);
}

if (updateBaseline) {
  const signatures = {};
  for (const sig of Array.from(counts.keys()).sort()) signatures[sig] = counts.get(sig);
  const payload = { version: 1, generatedAt: new Date().toISOString(), totalIssues: allIssues.length, byRule, signatures };
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[check-conventions] baseline updated: ${normalizePath(path.relative(rootDir, baselinePath))}`);
  console.log(`[check-conventions] tracked issues: ${allIssues.length} (${ruleSummary})`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error("[check-conventions] baseline file is missing.");
  console.error("[check-conventions] run: node scripts/check-conventions.mjs --update-baseline");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const baselineSigs = baseline.signatures && typeof baseline.signatures === "object" ? baseline.signatures : {};

const newIssues = [];
const seen = new Map();
for (const issue of allIssues) {
  const sig = signatureOf(issue);
  const n = (seen.get(sig) ?? 0) + 1;
  seen.set(sig, n);
  if (n > (baselineSigs[sig] ?? 0)) newIssues.push(issue);
}
const staleCount = Object.keys(baselineSigs).filter((sig) => !counts.has(sig)).length;

if (newIssues.length > 0) {
  console.error(`[check-conventions] new convention violations: ${newIssues.length}`);
  newIssues.slice(0, 60).forEach((issue) => {
    console.error(`- ${issue.file}:${issue.line} [${issue.rule}] ${issue.snippet}`);
  });
  if (newIssues.length > 60) console.error(`... and ${newIssues.length - 60} more`);
  console.error("[check-conventions] 규칙 설명은 scripts/check-conventions.mjs 상단 주석 참조. 정당한 예외면 --update-baseline 으로 박제.");
  process.exit(1);
}

console.log(`[check-conventions] ok. scanned files: ${files.length}, tracked issues: ${allIssues.length} (${ruleSummary})${staleCount > 0 ? `, stale baseline entries: ${staleCount} (--update-baseline 권장)` : ""}`);
