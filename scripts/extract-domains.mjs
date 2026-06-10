/**
 * data/farmwallet-data.json을 도메인별 JSON으로 분리 추출.
 * 사용: node scripts/extract-domains.mjs
 * 출력: data/extracted/{accounts,ledger,stocks,budget,workout,misc}.json
 *
 * 주의: ledger/trades는 accountId로 accounts를 참조하므로,
 * 개별 도메인만 다른 앱에 가져갈 때도 accounts.json을 함께 가져가야 한다.
 */
import fs from "node:fs";
import path from "node:path";

const srcFile = path.resolve("data/farmwallet-data.json");
const outDir = path.resolve("data/extracted");

if (!fs.existsSync(srcFile)) {
  console.error("[extract-domains] data/farmwallet-data.json 이 없습니다.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(srcFile, "utf-8"));

/** 도메인 → 포함할 최상위 키 매핑. 여기 없는 키는 misc로 들어간다. */
const DOMAINS = {
  accounts: ["accounts", "loans"],
  ledger: ["ledger", "categoryPresets", "recurringExpenses", "budgetGoals", "ledgerTemplates"],
  stocks: [
    "trades",
    "customSymbols",
    "usTickers",
    "stockPresets",
    "targetPortfolios",
    "isaPortfolio",
    "investmentGoals",
    "dividendTrackingTicker"
  ],
  workout: ["workoutWeeks", "workoutRoutines", "customExercises"],
  snapshots: ["assetSnapshots", "marketEnvSnapshots", "targetNetWorthCurve"]
};

const claimed = new Set(Object.values(DOMAINS).flat());
const miscKeys = Object.keys(data).filter((k) => !claimed.has(k) && k !== "_exportedAt");

fs.mkdirSync(outDir, { recursive: true });

const meta = {
  _source: "farmwallet-data.json",
  _sourceExportedAt: data._exportedAt ?? null,
  _extractedAt: new Date().toISOString()
};

const summary = [];
for (const [domain, keys] of Object.entries({ ...DOMAINS, misc: miscKeys })) {
  const slice = { ...meta };
  for (const k of keys) {
    if (k in data) slice[k] = data[k];
  }
  const file = path.join(outDir, `${domain}.json`);
  fs.writeFileSync(file, JSON.stringify(slice, null, 2), "utf-8");
  const counts = keys
    .filter((k) => k in data)
    .map((k) => `${k}=${Array.isArray(data[k]) ? data[k].length : typeof data[k]}`)
    .join(", ");
  summary.push(`  ${domain}.json  (${counts || "비어 있음"})`);
}

console.log("[extract-domains] 추출 완료 →", outDir);
console.log(summary.join("\n"));
