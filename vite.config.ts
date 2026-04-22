import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import fs from "fs";
import path from "path";
import https from "https";
import { exec } from "child_process";
import type { IncomingMessage, ServerResponse } from "http";

function backupApiPlugin(): Plugin {
  return {
    name: "backup-api",
    configureServer(server) {
      const backupsDir = path.join(process.cwd(), "backups");
      const dataDir = path.join(process.cwd(), "data");
      const backupRoot = path.resolve(backupsDir);
      const backupRootPrefix = `${backupRoot.toLowerCase()}${path.sep}`;
      const MAX_BACKUP_BODY_BYTES = 20 * 1024 * 1024;
      const BACKUP_RETENTION_DAY_SLOTS = 4;

      const seoulDayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });

      const seoulDateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });

      function formatSeoulTimestampForFile(nowMs: number): string {
        const parts = seoulDateTimePartsFormatter.formatToParts(new Date(nowMs));
        const y = parts.find((p) => p.type === "year")?.value ?? "1970";
        const m = parts.find((p) => p.type === "month")?.value ?? "01";
        const d = parts.find((p) => p.type === "day")?.value ?? "01";
        const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
        const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
        const ss = parts.find((p) => p.type === "second")?.value ?? "00";
        const ms = String(Math.abs(nowMs) % 1000).padStart(3, "0");
        // 파일명은 ":" "." 를 쓰지 않기 위해 "-"로 대체하고, KST임을 명시
        return `${y}-${m}-${d}T${hh}-${mm}-${ss}-${ms}KST`;
      }

      const resolveSafeBackupPath = (inputPath: string): string | null => {
        const normalized = path.posix.normalize(inputPath.replace(/\\/g, "/")).replace(/^\/+/, "");
        if (!normalized || normalized.startsWith("..")) return null;

        const resolved = path.resolve(backupsDir, normalized);
        const resolvedLower = resolved.toLowerCase();
        if (resolvedLower !== backupRoot.toLowerCase() && !resolvedLower.startsWith(backupRootPrefix)) {
          return null;
        }
        return resolved;
      };

      const parseCreatedAtFromBackupFileName = (fileName: string): string => {
        // Legacy (UTC): backup-2026-03-25T12-49-50-266Z.json
        const utc = /^backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/i.exec(
          fileName
        );
        if (utc) {
          return `${utc[1]}T${utc[2]}:${utc[3]}:${utc[4]}.${utc[5]}Z`;
        }
        // New (KST): backup-2026-03-25T21-49-50-266KST.json
        const kst = /^backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})KST\.json$/i.exec(
          fileName
        );
        if (kst) {
          // Interpret as Asia/Seoul time and convert to UTC ISO for internal sorting.
          // Note: offset is constant +09:00 for KST (no DST).
          const isoLike = `${kst[1]}T${kst[2]}:${kst[3]}:${kst[4]}.${kst[5]}+09:00`;
          const ms = Date.parse(isoLike);
          return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(0).toISOString();
        }
        return new Date(0).toISOString();
      };

      function getSeoulDayKeyFromUtcMs(ms: number): string {
        if (!Number.isFinite(ms)) return "unknown";
        const parts = seoulDayKeyFormatter.formatToParts(new Date(ms));
        const y = parts.find((p) => p.type === "year")?.value;
        const m = parts.find((p) => p.type === "month")?.value;
        const d = parts.find((p) => p.type === "day")?.value;
        if (!y || !m || !d) return "unknown";
        return `${y}-${m}-${d}`;
      }

      type BackupFileRecord = {
        fullPath: string;
        relativePath: string;
        createdAt: string;
        createdAtMs: number;
        dayKey: string;
      };

      async function collectBackupFileRecords(): Promise<BackupFileRecord[]> {
        const records: BackupFileRecord[] = [];
        try {
          await fs.promises.access(backupsDir, fs.constants.F_OK);
        } catch {
          return records;
        }

        const stack: Array<{ dir: string; basePath: string }> = [{ dir: backupsDir, basePath: "" }];

        while (stack.length > 0) {
          const current = stack.pop();
          if (!current) continue;
          const entries = await fs.promises.readdir(current.dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(current.dir, entry.name);
            const relativePath = current.basePath ? `${current.basePath}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
              stack.push({ dir: fullPath, basePath: relativePath });
              continue;
            }
            if (!entry.isFile()) continue;
            if (!entry.name.startsWith("backup-") || !entry.name.endsWith(".json")) continue;

            const createdAt = parseCreatedAtFromBackupFileName(entry.name);
            const createdAtMs = Date.parse(createdAt);
            const dayKey = Number.isFinite(createdAtMs) ? getSeoulDayKeyFromUtcMs(createdAtMs) : "unknown";

            records.push({ fullPath, relativePath, createdAt, createdAtMs, dayKey });
          }
        }
        return records;
      }

      async function removeEmptyDirsUnderBackups(): Promise<void> {
        try {
          await fs.promises.access(backupsDir, fs.constants.F_OK);
        } catch {
          return;
        }

        const tryRemoveIfEmpty = async (dirAbs: string): Promise<void> => {
          let entries: fs.Dirent[];
          try {
            entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
          } catch {
            return;
          }

          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            await tryRemoveIfEmpty(path.join(dirAbs, entry.name));
          }

          let names: string[];
          try {
            names = await fs.promises.readdir(dirAbs);
          } catch {
            return;
          }

          if (names.length === 0 && dirAbs !== backupRoot) {
            try {
              await fs.promises.rmdir(dirAbs);
            } catch {
              // ignore
            }
          }
        };

        await tryRemoveIfEmpty(backupRoot);
      }

      async function pruneBackupFilesToRetentionPolicy(): Promise<void> {
        const records = await collectBackupFileRecords();
        if (records.length === 0) return;

        const bestByDay = new Map<string, BackupFileRecord>();
        for (const rec of records) {
          if (rec.dayKey === "unknown") continue;
          const prev = bestByDay.get(rec.dayKey);
          if (!prev || rec.createdAtMs > prev.createdAtMs) {
            bestByDay.set(rec.dayKey, rec);
          }
        }

        const candidates = [...bestByDay.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
        const keepDayKeys = new Set(candidates.slice(0, BACKUP_RETENTION_DAY_SLOTS).map((c) => c.dayKey));

        const pathsToKeep = new Set<string>();
        for (const dayKey of keepDayKeys) {
          const best = bestByDay.get(dayKey);
          if (best) pathsToKeep.add(best.fullPath);
        }

        for (const rec of records) {
          if (pathsToKeep.has(rec.fullPath)) continue;
          try {
            await fs.promises.unlink(rec.fullPath);
          } catch {
            // ignore
          }
        }

        await removeEmptyDirsUnderBackups();
      }

      server.middlewares.use("/api/backup", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          let bodyBytes = 0;
          let tooLarge = false;

          req.on("data", (chunk: Buffer) => {
            if (tooLarge) return;
            bodyBytes += chunk.length;
            if (bodyBytes > MAX_BACKUP_BODY_BYTES) {
              tooLarge = true;
              res.statusCode = 413;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Backup payload is too large" }));
              return;
            }
            chunks.push(chunk);
          });

          req.on("end", () => {
            if (tooLarge) return;
            const body = Buffer.concat(chunks).toString("utf-8");
            void (async () => {
              try {
                JSON.parse(body);
                const nowMs = Date.now();
                const nowIso = new Date(nowMs).toISOString();
                const dateFolder = getSeoulDayKeyFromUtcMs(nowMs);
                const dateDir = path.join(backupsDir, dateFolder);
                await fs.promises.mkdir(dateDir, { recursive: true });

                const timestamp = formatSeoulTimestampForFile(nowMs);
                const fileName = `backup-${timestamp}.json`;
                const fullPath = path.join(dateDir, fileName);
                const relativePath = `${dateFolder}/${fileName}`;
                await fs.promises.writeFile(fullPath, body, "utf-8");

                try {
                  await pruneBackupFilesToRetentionPolicy();
                } catch (pruneErr) {
                  console.warn("[backup-api] prune failed", pruneErr);
                }

                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ fileName: relativePath, createdAt: nowIso }));
              } catch (error) {
                console.error("[backup-api] POST failed", error);
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Failed to save backup" }));
              }
            })();
          });

          req.on("error", (error) => {
            console.error("[backup-api] POST stream error", error);
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to read backup payload" }));
            }
          });
          return;
        }

        if (req.method === "GET") {
          void (async () => {
            try {
              const url = new URL(req.url ?? "/", "http://localhost");
              const fileNameParam = url.searchParams.get("fileName");

              if (fileNameParam) {
                const safePath = resolveSafeBackupPath(fileNameParam);
                const baseName = path.basename(fileNameParam.replace(/\\/g, "/"));
                if (!safePath || !baseName.startsWith("backup-") || !baseName.endsWith(".json")) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: "Invalid backup path" }));
                  return;
                }

                try {
                  const raw = await fs.promises.readFile(safePath, "utf-8");
                  res.setHeader("Content-Type", "application/json");
                  res.end(raw);
                } catch {
                  res.statusCode = 404;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: "Backup not found" }));
                }
                return;
              }

              try {
                await fs.promises.access(backupsDir, fs.constants.F_OK);
              } catch {
                res.setHeader("Content-Type", "application/json");
                res.end("[]");
                return;
              }

              const list: Array<{ fileName: string; createdAt: string }> = [];
              const stack: Array<{ dir: string; basePath: string }> = [{ dir: backupsDir, basePath: "" }];

              while (stack.length > 0) {
                const current = stack.pop();
                if (!current) continue;
                const entries = await fs.promises.readdir(current.dir, { withFileTypes: true });

                for (const entry of entries) {
                  const fullPath = path.join(current.dir, entry.name);
                  const relativePath = current.basePath
                    ? `${current.basePath}/${entry.name}`
                    : entry.name;

                  if (entry.isDirectory()) {
                    stack.push({ dir: fullPath, basePath: relativePath });
                    continue;
                  }

                  if (!entry.isFile()) continue;
                  if (!entry.name.startsWith("backup-") || !entry.name.endsWith(".json")) continue;

                  list.push({
                    fileName: relativePath,
                    createdAt: parseCreatedAtFromBackupFileName(entry.name)
                  });
                }
              }

              list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(list));
            } catch (error) {
              console.error("[backup-api] GET failed", error);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end("[]");
            }
          })();
          return;
        }

        next();
      });
      // 최신 백업 파일에서 복원 (GET) — localStorage가 비어있을 때 자동 복원용
      server.middlewares.use("/api/restore-latest-backup", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "GET") { next(); return; }
        try {
          if (!fs.existsSync(backupsDir)) {
            res.setHeader("Content-Type", "application/json");
            res.end("null");
            return;
          }
          // 가장 최근 날짜 폴더 → 그 안의 가장 최근 파일
          const dateDirs = fs.readdirSync(backupsDir)
            .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
            .sort()
            .reverse();
          for (const dir of dateDirs) {
            const dirPath = path.join(backupsDir, dir);
            const files = fs.readdirSync(dirPath)
              .filter((f: string) => f.endsWith(".json"))
              .sort()
              .reverse();
            if (files.length > 0) {
              const raw = fs.readFileSync(path.join(dirPath, files[0]), "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(raw);
              return;
            }
          }
          res.setHeader("Content-Type", "application/json");
          res.end("null");
        } catch (e) {
          console.error("[backup-api] restore-latest-backup failed", e);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end("null");
        }
      });

      // 통합 앱 데이터 파일 (GET/POST) — data/farmwallet-data.json
      // 포맷: toUserDataJson()과 동일한 사용자 데이터 JSON (캐시 제외)
      // 최상위에 _exportedAt(ISO 문자열)이 포함되어 저장 시각을 알 수 있음
      const unifiedDataFile = path.join(dataDir, "farmwallet-data.json");
      const MAX_UNIFIED_BYTES = 25 * 1024 * 1024;

      server.middlewares.use("/api/farmwallet-data", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method === "GET") {
          try {
            if (!fs.existsSync(unifiedDataFile)) {
              res.setHeader("Content-Type", "application/json");
              res.end("null");
              return;
            }
            const raw = fs.readFileSync(unifiedDataFile, "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(raw);
          } catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to read farmwallet data" }));
          }
          return;
        }

        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          let bytes = 0;
          let tooLarge = false;
          req.on("data", (chunk: Buffer) => {
            if (tooLarge) return;
            bytes += chunk.length;
            if (bytes > MAX_UNIFIED_BYTES) {
              tooLarge = true;
              res.statusCode = 413;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Payload is too large" }));
              return;
            }
            chunks.push(chunk);
          });
          req.on("end", () => {
            if (tooLarge) return;
            const body = Buffer.concat(chunks).toString("utf-8");
            try {
              // JSON 유효성 검사만 수행 (형식은 클라이언트가 책임)
              JSON.parse(body);
              if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
              }
              // 사람이 읽기 좋게 포맷팅해서 저장 (git diff 가독성)
              const formatted = JSON.stringify(JSON.parse(body), null, 2);
              fs.writeFileSync(unifiedDataFile, formatted, "utf-8");

              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }));
            } catch {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to save farmwallet data" }));
            }
          });
          return;
        }

        next();
      });

      // CORS proxy: server-side fetch for /api/external (Yahoo) and /api/stooq (allorigins 대체)
      server.middlewares.use("/api/external", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "GET" || !req.url) {
          next();
          return;
        }
        try {
          const url = new URL(req.url, "http://localhost");
          const pathSegments = url.pathname.replace(/^\/api\/external\/?/, "").split("/").filter(Boolean);
          const pathType = pathSegments[0] ?? "";
          const innerUrl = url.searchParams.get("url");
          if ((pathType !== "get" && pathType !== "raw") || !innerUrl) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "url query required" }));
            return;
          }
          const decoded = decodeURIComponent(innerUrl);
          if (!decoded.startsWith("https://")) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid url" }));
            return;
          }
          // Simple in-memory cache to reduce Yahoo 429s during dev
          const cacheKey = `${pathType}:${decoded}`;
          const now = Date.now();
          const cacheTTL =
            decoded.includes("finance/quote")
              ? 30_000
              : decoded.includes("finance/chart")
                ? 10_000
                : 15_000;
          const cached = (server as unknown as { __externalCache?: Map<string, { expires: number; status: number; body: string }> })
            .__externalCache;
          if (cached) {
            const hit = cached.get(cacheKey);
            if (hit && hit.expires > now) {
              res.statusCode = hit.status;
              res.setHeader("Content-Type", "application/json");
              res.end(hit.body);
              return;
            }
          }
          https
            .get(decoded, (extRes) => {
              let body = "";
              extRes.on("data", (chunk) => { body += chunk.toString(); });
              extRes.on("end", () => {
                res.statusCode = extRes.statusCode ?? 200;
                res.setHeader("Content-Type", "application/json");
                const responseBody = pathType === "get" ? JSON.stringify({ contents: body }) : body;
                const status = res.statusCode ?? 200;
                // 429/5xx는 캐시하지 않아 다음 요청에서 Yahoo 재시도 가능
                if (status >= 200 && status < 300) {
                  const cacheStore = (server as unknown as { __externalCache?: Map<string, { expires: number; status: number; body: string }> });
                  if (!cacheStore.__externalCache) {
                    cacheStore.__externalCache = new Map();
                  }
                  cacheStore.__externalCache.set(cacheKey, {
                    expires: now + cacheTTL,
                    status,
                    body: responseBody
                  });
                }
                res.end(responseBody);
              });
            })
            .on("error", (err) => {
              console.warn("[api/external] fetch failed", err.message);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Proxy fetch failed" }));
            });
        } catch {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid request" }));
        }
      });

      server.middlewares.use("/api/stooq", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "GET" || !req.url) {
          next();
          return;
        }
        try {
          const url = new URL(req.url, "http://localhost");
          const query = url.searchParams.toString();
          const stooqUrl = `https://stooq.pl/q/l/?${query}`;
          https
            .get(stooqUrl, (extRes) => {
              let body = "";
              extRes.on("data", (chunk) => { body += chunk.toString(); });
              extRes.on("end", () => {
                res.statusCode = extRes.statusCode ?? 200;
                res.setHeader("Content-Type", extRes.headers["content-type"] ?? "application/json");
                res.end(body);
              });
            })
            .on("error", (err) => {
              console.warn("[api/stooq] fetch failed", err.message);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Proxy fetch failed" }));
            });
        } catch {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid request" }));
        }
      });

      // Yahoo Finance proxy (bypass CORS in local dev). 2xx만 캐시. 429 방지를 위해 Yahoo 요청 직렬화 + 최소 2.5초 간격.
      const yahooQuoteCache = new Map<string, { expires: number; status: number; body: string }>();
      const YAHOO_QUOTE_CACHE_TTL_MS = 60_000;
      const YAHOO_MIN_INTERVAL_MS = 2500;
      let lastYahooRequestEnd = 0;
      const yahooQuoteQueue: Array<{
        symbols: string;
        resolve: (body: string, status: number) => void;
      }> = [];
      let yahooQuoteInFlight = false;

      const processYahooQuoteQueue = () => {
        if (yahooQuoteInFlight || yahooQuoteQueue.length === 0) return;
        const job = yahooQuoteQueue.shift()!;
        const wait = Math.max(0, lastYahooRequestEnd + YAHOO_MIN_INTERVAL_MS - Date.now());
        yahooQuoteInFlight = true;
        setTimeout(() => {
          const doRequest = (
            symbols: string,
            onDone: (body: string, status: number) => void,
            isRetry = false
          ) => {
            const yahooUrl = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
            yahooUrl.searchParams.set("symbols", symbols);
            https
              .get(yahooUrl, (yahooRes) => {
                let body = "";
                yahooRes.on("data", (chunk) => {
                  body += chunk.toString();
                });
                yahooRes.on("end", () => {
                  const status = yahooRes.statusCode ?? 200;
                  lastYahooRequestEnd = Date.now();
                  if (status === 429 && !isRetry) {
                    // 429 시 60초 후 한 번만 재시도
                    setTimeout(() => {
                      doRequest(symbols, onDone, true);
                    }, 60_000);
                    return;
                  }
                  yahooQuoteInFlight = false;
                  onDone(body, status);
                });
              })
              .on("error", () => {
                lastYahooRequestEnd = Date.now();
                yahooQuoteInFlight = false;
                onDone(JSON.stringify({ error: "Failed to fetch Yahoo quotes" }), 500);
                processYahooQuoteQueue();
              });
          };
          doRequest(job.symbols, (body, status) => {
            yahooQuoteInFlight = false;
            job.resolve(body, status);
            processYahooQuoteQueue();
          });
        }, wait);
      };

      server.middlewares.use(
        "/api/yahoo-quote",
        (req: IncomingMessage, res: ServerResponse, next) => {
          if (req.method !== "GET" || !req.url) {
            next();
            return;
          }

          (async () => {
            try {
              const url = new URL(req.url!, "http://localhost");
              const symbols = url.searchParams.get("symbols");
              if (!symbols) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "symbols query is required" }));
                return;
              }
              const cacheKey = symbols;
              const now = Date.now();
              const hit = yahooQuoteCache.get(cacheKey);
              if (hit && hit.expires > now) {
                res.statusCode = hit.status;
                res.setHeader("Content-Type", "application/json");
                res.end(hit.body);
                return;
              }

              const { body, status } = await new Promise<{ body: string; status: number }>((resolve) => {
                yahooQuoteQueue.push({
                  symbols,
                  resolve: (b, s) => resolve({ body: b, status: s })
                });
                processYahooQuoteQueue();
              });

              res.statusCode = status;
              res.setHeader("Content-Type", "application/json");
              if (status >= 200 && status < 300) {
                yahooQuoteCache.set(cacheKey, {
                  expires: now + YAHOO_QUOTE_CACHE_TTL_MS,
                  status,
                  body
                });
              }
              res.end(body);
            } catch {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Invalid request" }));
            }
          })();
        }
      );

      // ticker database backup API (GET/POST) — dev에서 SPA fallback 대신 JSON 반환
      const tickerBackupFile = path.join(process.cwd(), "data", "ticker-backup.json");
      server.middlewares.use("/api/ticker-backup", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method === "GET") {
          (async () => {
            try {
              if (!fs.existsSync(tickerBackupFile)) {
                res.setHeader("Content-Type", "application/json");
                res.end("[]");
                return;
              }
              const raw = await fs.promises.readFile(tickerBackupFile, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(raw);
            } catch (err) {
              console.warn("[ticker-backup] GET failed", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end("[]");
            }
          })();
          return;
        }
        if (req.method === "POST") {
          const tbkChunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => { tbkChunks.push(chunk); });
          req.on("end", () => {
            const body = Buffer.concat(tbkChunks).toString("utf-8");
            try {
              const parsed = JSON.parse(body) as { tickers?: unknown[] };
              const tickers = Array.isArray(parsed.tickers) ? parsed.tickers : Array.isArray(parsed) ? parsed : [];
              const dataDir = path.join(process.cwd(), "data");
              if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
              fs.writeFileSync(tickerBackupFile, JSON.stringify(tickers), "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              console.warn("[ticker-backup] POST failed", err);
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Invalid body" }));
            }
          });
          return;
        }
        next();
      });

      // ticker.json update API
      const tickerJsonFile = path.join(process.cwd(), "data", "ticker.json");
      server.middlewares.use("/api/ticker-json", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method === "POST") {
          const tjChunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => {
            tjChunks.push(chunk);
          });
          req.on("end", () => {
            const body = Buffer.concat(tjChunks).toString("utf-8");
            try {
              const { ticker, name, market } = JSON.parse(body);
              
              // Read existing ticker file
              let tickerData: { KR: Array<{ ticker: string; name: string }>; US: Array<{ ticker: string; name: string }> } = { KR: [], US: [] };
              
              if (fs.existsSync(tickerJsonFile)) {
                const fileContent = fs.readFileSync(tickerJsonFile, "utf-8");
                try {
                  tickerData = JSON.parse(fileContent);
                } catch {
                  console.warn("Failed to parse ticker.json, using empty data");
                }
              }
              
              const normalizedTicker = ticker.toUpperCase();
              const targetArray = market === 'KR' ? tickerData.KR : tickerData.US;
              
              // Update existing ticker if found
              const existingIndex = targetArray.findIndex(item => item.ticker.toUpperCase() === normalizedTicker);
              
              if (existingIndex >= 0) {
                // Update name only when changed.
                if (name && targetArray[existingIndex].name !== name) {
                  targetArray[existingIndex].name = name;
                }
              } else {
                // Add ticker if it does not exist
                targetArray.push({
                  ticker: normalizedTicker,
                  name: name || normalizedTicker
                });
              }
              
              // Sort by ticker
              targetArray.sort((a, b) => a.ticker.localeCompare(b.ticker));
              
              const formatted = JSON.stringify(tickerData, null, 2);
              fs.writeFileSync(tickerJsonFile, formatted, "utf-8");
              
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, updated: existingIndex >= 0 }));
            } catch (err) {
              console.error("Failed to update ticker.json:", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to update ticker.json" }));
            }
          });
          return;
        }
        
        if (req.method === "GET") {
          try {
            if (!fs.existsSync(tickerJsonFile)) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ KR: [], US: [] }));
              return;
            }
            const fileContent = fs.readFileSync(tickerJsonFile, "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(fileContent);
          } catch (err) {
            console.error("Failed to read ticker.json:", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to read ticker.json" }));
          }
          return;
        }
        
        next();
      });

      // Naver 금융에서 한국 종목 한글명 조회 — krNames.json/Yahoo에 없는 특수 종목용 fallback.
      // 응답: { name: string | null }. 60초 캐시.
      const naverNameCache = new Map<string, { expires: number; name: string | null }>();
      const NAVER_NAME_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
      server.middlewares.use("/api/naver-name", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "GET" || !req.url) { next(); return; }
        const url = new URL(req.url, "http://localhost");
        const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase();
        if (!ticker || !/^[0-9][0-9A-Z]{5}$/.test(ticker)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Korean 6-char ticker required" }));
          return;
        }
        const now = Date.now();
        const cached = naverNameCache.get(ticker);
        if (cached && cached.expires > now) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ name: cached.name }));
          return;
        }
        const naverUrl = `https://finance.naver.com/item/main.naver?code=${ticker}`;
        https.get(naverUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (naverRes) => {
          const chunks: Buffer[] = [];
          naverRes.on("data", (chunk: Buffer) => chunks.push(chunk));
          naverRes.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            const titleMatch = body.match(/<title>([^<]*?)\s*:\s*[^<]*<\/title>/);
            let name: string | null = null;
            if (titleMatch && titleMatch[1]) {
              const raw = titleMatch[1].trim();
              // 한글 1자 이상 포함하고 ticker 자체가 아니면 유효
              if (/[가-힣]/.test(raw) && raw !== ticker) {
                name = raw;
              }
            }
            naverNameCache.set(ticker, { expires: now + NAVER_NAME_CACHE_TTL_MS, name });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ name }));
          });
        }).on("error", (err) => {
          console.warn("[api/naver-name] fetch failed", err.message);
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Naver fetch failed" }));
        });
      });

      /**
       * child_process.exec를 Promise로 래핑. spawn EPERM 같은 Windows 예외 포함 모든 오류를
       * catch하여 dev 서버 크래시 방지. 성공 시 stdout 반환, 실패 시 stderr 우선 err.message.
       */
      const execAsync = (cmd: string, cwd: string) =>
        new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          try {
            const child = exec(cmd, { cwd }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve({ stdout, stderr });
            });
            // spawn 단계 오류(EPERM, ENOENT 등)는 exec 콜백 err로 전달되지 않고 별도 event로
            // 발생할 수 있어 'error' 리스너로 추가 포획 필요.
            child.on("error", (err) => reject(err));
          } catch (syncErr) {
            reject(syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
          }
        });

      const sendErrorJson = (res: ServerResponse, stage: string, err: unknown) => {
        if (res.writableEnded) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[${stage}] 실패`, msg);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: `${stage} 실패: ${msg}` }));
      };

      // 요청 body 파싱 유틸
      const readJsonBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
        new Promise((resolve) => {
          let raw = "";
          req.on("data", (chunk) => { raw += String(chunk); });
          req.on("end", () => {
            if (!raw) { resolve({}); return; }
            try { resolve(JSON.parse(raw) ?? {}); } catch { resolve({}); }
          });
          req.on("error", () => resolve({}));
        });

      // 최근 커밋 목록 + 현재 HEAD 상태 조회 — 버전 선택 UI용
      server.middlewares.use("/api/git-log", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "GET") { next(); return; }
        const cwd = process.cwd();
        void (async () => {
          try {
            await execAsync("git fetch origin main --quiet", cwd).catch(() => undefined);
            const { stdout: logOut } = await execAsync(
              'git log origin/main --format="%H|%ai|%s" -30 --no-merges',
              cwd
            );
            const commits = logOut
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [hash, date, ...rest] = line.split("|");
                return { hash, date, message: rest.join("|") };
              });
            const { stdout: branchOut } = await execAsync("git rev-parse --abbrev-ref HEAD", cwd);
            const { stdout: headOut } = await execAsync("git rev-parse HEAD", cwd);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              commits,
              currentBranch: branchOut.trim(),
              currentHead: headOut.trim()
            }));
          } catch (err) {
            sendErrorJson(res, "git log", err);
          }
        })();
      });

      // 업데이트 (git pull / 특정 버전 checkout) — 로컬 개발 전용
      //   body { ref?: string }
      //     ref 없음: main 브랜치로 돌아가 최신 pull
      //     ref 있음: restore/<short>-<ts> 브랜치를 만들고 그 커밋으로 checkout (main 영향 없음)
      server.middlewares.use("/api/git-pull", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "POST") { next(); return; }
        const cwd = process.cwd();
        void (async () => {
          const body = await readJsonBody(req);
          const ref = typeof body.ref === "string" ? body.ref.trim() : "";
          try {
            if (!ref) {
              // 최신: main 브랜치로 복귀 후 pull
              await execAsync("git checkout main", cwd);
              await execAsync("git pull origin main --no-rebase", cwd);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, branch: "main" }));
              return;
            }
            // 특정 버전: 원격 가져온 뒤 임시 restore 브랜치로 checkout
            await execAsync("git fetch origin --quiet", cwd);
            const shortHash = ref.slice(0, 7);
            const ts = new Date().toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "-");
            const branchName = `restore/${shortHash}-${ts}`;
            await execAsync(`git checkout -B ${branchName} ${ref}`, cwd);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, branch: branchName, ref }));
          } catch (err) {
            sendErrorJson(res, "git checkout", err);
          }
        })();
      });

      // 배포 (git push) — 로컬 개발 전용
      server.middlewares.use("/api/git-push", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "POST") { next(); return; }
        const cwd = process.cwd();
        const msg = `save: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`;
        void (async () => {
          try {
            await execAsync("git add -A", cwd);
          } catch (err) { return sendErrorJson(res, "git add", err); }
          try {
            // --allow-empty로 staged 변경 없어도 성공. 메시지에 인용부호가 들어가지 않도록 주의.
            await execAsync(`git commit -m "${msg.replace(/"/g, "'")}" --allow-empty`, cwd);
          } catch (err) { return sendErrorJson(res, "git commit", err); }
          try {
            await execAsync("git push origin main --force", cwd);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err) { sendErrorJson(res, "git push", err); }
        })();
      });
    }
  };
}

import { execSync } from "child_process";
import packageJson from "./package.json";

const buildHash = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return Date.now().toString(36);
  }
})();

function buildMetaPlugin(hash: string): Plugin {
  return {
    name: "build-meta",
    writeBundle(options) {
      const outDir = options.dir ?? path.join(process.cwd(), "dist");
      fs.writeFileSync(
        path.join(outDir, "build-meta.json"),
        JSON.stringify({ hash, builtAt: new Date().toISOString() })
      );
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    backupApiPlugin(),
    buildMetaPlugin(buildHash),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "cdn-cache", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "FarmWallet",
        short_name: "FarmWallet",
        description: "자산 · 주식 · 가계부 관리",
        start_url: "/farmwallet/",
        scope: "/farmwallet/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0d9488",
        orientation: "portrait-primary",
        lang: "ko",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
    }),
  ],
  base: "/farmwallet/",
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_HASH__: JSON.stringify(buildHash)
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts")) return "recharts";
          if (id.includes("node_modules/lucide-react")) return "lucide";
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5174
  }
});

