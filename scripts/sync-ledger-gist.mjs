import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { contentHash, mergeLedgerAdditions } from "./lib/ledger-gist-merge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(name) { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; }
const gistId = option("--gist");
const owner = option("--owner");
const transactionsPath = option("--transactions");
const localPath = path.resolve(option("--data-file") ?? path.join(root, "data/farmwallet-data.json"));
const apply = args.includes("--apply");

async function main() {
  if (!gistId || !/^[a-f0-9]{20,}$/i.test(gistId) || !owner || !/^[\w-]+$/.test(owner) || !transactionsPath) {
    throw new Error("--gist ID --owner GitHub계정 --transactions 거래JSON [--data-file 장부JSON] [--apply]가 필요합니다.");
  }
  const constants = fs.readFileSync(path.join(root, "src/constants/config.ts"), "utf8");
  const schema = Number(constants.match(/DATA_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
  if (!schema) throw new Error("앱 데이터 버전을 확인하지 못했습니다.");
  // OS 자격 증명 저장소의 GitHub 로그인 사용. 토큰은 출력하거나 파일에 쓰지 않는다.
  const token = execFileSync("gh", ["auth", "token", "--hostname", "github.com", "--user", owner], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const env = { ...process.env, GH_TOKEN: token };
  function api(rest) {
    const text = execFileSync("gh", ["api", ...rest], { encoding: "utf8", env, maxBuffer: 30 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(text);
  }
  function readGist() {
    const envelope = api([`gists/${gistId}`]);
    if (envelope.owner?.login?.toLowerCase() !== owner.toLowerCase() || envelope.public !== false) throw new Error("대상 계정의 비공개 Gist가 아닙니다.");
    const remoteSchema = Number(envelope.description?.match(/schema v(\d+)/)?.[1] ?? 0);
    if (remoteSchema > schema) throw new Error("원격 장부 버전이 더 새롭습니다. 앱을 업데이트하세요.");
    const file = envelope.files?.["farmwallet-data.json"];
    if (!file || file.truncated || typeof file.content !== "string") throw new Error("원격 장부 전체를 읽지 못했습니다. 업로드하지 않습니다.");
    if (!envelope.history?.[0]?.version) throw new Error("원격 버전을 확인하지 못했습니다.");
    return { envelope, content: file.content, data: JSON.parse(file.content), version: envelope.history[0].version };
  }
  const initialLocal = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf8") : null;
  const before = readGist();
  const source = JSON.parse(fs.readFileSync(path.resolve(transactionsPath), "utf8"));
  const result = mergeLedgerAdditions(before.data, Array.isArray(source) ? source : source.ledger);
  const { prices: _prices, tickerDatabase: _tickers, historicalDailyCloses: _closes, _exportedAt, ...userData } = result.data;
  const payload = JSON.stringify(userData);
  const summary = { gistId, beforeCount: before.data.ledger.length, afterCount: userData.ledger.length, added: result.added.length, skipped: result.skipped.length };
  if (!apply) { process.stdout.write(JSON.stringify({ status: "preview", ...summary }) + "\n"); return; }
  const archiveDir = path.join(path.dirname(localPath), "old");
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date()).replace(/[^0-9]/g, "") + `-${process.pid}`;
  const prefix = path.join(archiveDir, `gist-ledger-sync-${stamp}`);
  fs.writeFileSync(`${prefix}.remote-before.json`, JSON.stringify(before.envelope, null, 2), { flag: "wx" });
  if (initialLocal !== null) fs.writeFileSync(`${prefix}.local-before.json`, initialLocal, { flag: "wx" });
  const requestPath = `${prefix}.request.json`;
  fs.writeFileSync(requestPath, JSON.stringify({ description: `FarmWallet 데이터 백업 (schema v${schema})`, files: { "farmwallet-data.json": { content: payload } } }), { flag: "wx" });
  const receiptPath = `${prefix}.receipt.json`;
  const receipt = { status: "prepared", ...summary, baseVersion: before.version, addedIds: result.added.map((row) => row.id), payloadHash: contentHash(payload), localUpdated: false };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx" });
  const latest = readGist();
  if (latest.version !== before.version || latest.content !== before.content) throw new Error("확인 중 다른 기기에서 장부가 바뀌었습니다. 최신 장부로 다시 실행하세요.");
  if (payload !== before.content) api(["--method", "PATCH", `gists/${gistId}`, "--input", requestPath]);
  const verified = readGist();
  if (verified.content !== payload) throw new Error("Gist 재조회 결과가 입력 장부와 다릅니다. 완료로 처리하지 않습니다.");
  receipt.status = "verified";
  receipt.remoteVersion = verified.version;
  receipt.verifiedAt = new Date().toISOString();
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  // 업로드가 검증된 뒤에만 PC 파일도 갱신한다. 그 사이 PC 파일이 바뀌면 보존한다.
  const currentLocal = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf8") : null;
  if (currentLocal === initialLocal) {
    const staged = `${prefix}.verified-local.json`;
    fs.writeFileSync(staged, JSON.stringify({ ...userData, _exportedAt: receipt.verifiedAt }, null, 2), { flag: "wx" });
    fs.renameSync(staged, localPath);
    receipt.localUpdated = true;
  }
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  process.stdout.write(JSON.stringify({ ...receipt, receiptPath }) + "\n");
}

main().catch((error) => {
  // CLI 자격 증명/하위 프로세스의 원문 stderr를 출력하지 않는다.
  process.stderr.write(`가계부 Gist 동기화 실패: ${error?.status != null ? "GitHub 인증 또는 API 요청을 확인하세요." : error instanceof Error ? error.message : "알 수 없는 오류"}\n`);
  process.exitCode = 1;
});
