#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const baselinePath = path.join(__dirname, "text-integrity-baseline.json");
const reportPath = path.join(__dirname, "text-integrity-report.json");
const updateBaseline = process.argv.includes("--update-baseline");
const writeReport = process.argv.includes("--report");

const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".css",
  ".html",
  ".md"
]);

const excludeDirs = new Set(["node_modules", ".git", "dist", "backups"]);
const excludeFiles = new Set(["data/ticker-backup.json", "data/app-data-tables.json", "data/farmwallet-data.json"]);
const scanTargets = ["src", "public", "data", "index.html", "vite.config.ts"];

const suspiciousPatterns = [
  { reason: "replacement-char", regex: /\uFFFD/u },
  { reason: "compatibility-ideograph", regex: /[\uF900-\uFAFF]/u },
  { reason: "han-hangul-adjacent", regex: /[\u4E00-\u9FFF][\uAC00-\uD7A3]|[\uAC00-\uD7A3][\u4E00-\u9FFF]/u }
];

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function collectFiles(targetPath, files) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    const ext = path.extname(targetPath).toLowerCase();
    const rel = normalizePath(path.relative(rootDir, targetPath));
    if (excludeFiles.has(rel)) return;
    if (textExtensions.has(ext) || path.basename(targetPath) === "index.html") {
      files.push(targetPath);
    }
    return;
  }

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && excludeDirs.has(entry.name)) continue;
    collectFiles(path.join(targetPath, entry.name), files);
  }
}

function clipLine(text) {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length > 200 ? `${compact.slice(0, 200)}...` : compact;
}

function makeSignature(issue) {
  return `${issue.file}|${issue.line}|${issue.reason}|${issue.snippet}`;
}

function scanFile(absPath) {
  const buffer = fs.readFileSync(absPath);
  const file = normalizePath(path.relative(rootDir, absPath));
  const issues = [];

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    issues.push({ file, line: 1, reason: "utf8-bom", snippet: "[BOM]" });
  }

  const content = buffer.toString("utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const pattern of suspiciousPatterns) {
      if (!pattern.regex.test(line)) continue;
      issues.push({
        file,
        line: index + 1,
        reason: pattern.reason,
        snippet: clipLine(line)
      });
    }
  });

  return issues;
}

const targetFiles = [];
scanTargets.forEach((target) => collectFiles(path.join(rootDir, target), targetFiles));

const allIssues = targetFiles.flatMap(scanFile);
const signatures = Array.from(new Set(allIssues.map(makeSignature))).sort();

if (writeReport) {
  const report = {
    version: 2,
    generatedAt: new Date().toISOString(),
    scannedFiles: targetFiles.length,
    totalIssues: allIssues.length,
    uniqueSignatures: signatures.length,
    byFile: {},
    byReason: {}
  };
  for (const issue of allIssues) {
    if (!report.byFile[issue.file]) report.byFile[issue.file] = [];
    report.byFile[issue.file].push({
      line: issue.line,
      reason: issue.reason,
      snippet: issue.snippet
    });
    report.byReason[issue.reason] = (report.byReason[issue.reason] || 0) + 1;
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[check-text-integrity] report written: ${normalizePath(path.relative(rootDir, reportPath))}`);
  console.log(`[check-text-integrity] total issues: ${allIssues.length}, files: ${Object.keys(report.byFile).length}`);
}

if (updateBaseline) {
  const payload = { version: 2, generatedAt: new Date().toISOString(), signatures };
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[check-text-integrity] baseline updated: ${normalizePath(path.relative(rootDir, baselinePath))}`);
  console.log(`[check-text-integrity] signatures: ${signatures.length}`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error("[check-text-integrity] baseline file is missing.");
  console.error("[check-text-integrity] run: node scripts/check-text-integrity.mjs --update-baseline");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const baselineSet = new Set(Array.isArray(baseline.signatures) ? baseline.signatures : []);
const newIssues = allIssues.filter((issue) => !baselineSet.has(makeSignature(issue)));

if (newIssues.length > 0) {
  console.error(`[check-text-integrity] new suspicious text issues: ${newIssues.length}`);
  newIssues.slice(0, 50).forEach((issue) => {
    console.error(`- ${issue.file}:${issue.line} [${issue.reason}] ${issue.snippet}`);
  });
  if (newIssues.length > 50) {
    console.error(`... and ${newIssues.length - 50} more`);
  }
  process.exit(1);
}

console.log(`[check-text-integrity] ok. scanned files: ${targetFiles.length}, tracked issues: ${signatures.length}`);
