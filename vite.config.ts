import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
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
      const dataFile = path.join(dataDir, "app-data.json");

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
          let body = "";
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
            body += chunk.toString("utf-8");
          });

          req.on("end", () => {
            if (tooLarge) return;
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
      // App data read/write API (local file)
      server.middlewares.use("/api/data-store", (req: IncomingMessage, res: ServerResponse, next) => {
        try {
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
        } catch {
          // ignore dir creation errors
        }

        if (req.method === "GET") {
          try {
            if (!fs.existsSync(dataFile)) {
              res.setHeader("Content-Type", "application/json");
              res.end("{}");
              return;
            }
            const raw = fs.readFileSync(dataFile, "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(raw);
          } catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to read data" }));
          }
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => (body += chunk.toString()));
          req.on("end", () => {
            try {
              JSON.parse(body);
              if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
              }
              fs.writeFileSync(dataFile, body, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }));
            } catch {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to save data" }));
            }
          });
          return;
        }

        next();
      });

      // 테이블 형태 앱 데이터 백업 (GET/POST) — data/app-data-tables.json
      const tableBackupFile = path.join(dataDir, "app-data-tables.json");
      const MAX_TABLE_BACKUP_BYTES = 25 * 1024 * 1024;

      server.middlewares.use("/api/app-data-tables", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method === "GET") {
          try {
            if (!fs.existsSync(tableBackupFile)) {
              res.setHeader("Content-Type", "application/json");
              res.end("{}");
              return;
            }
            const raw = fs.readFileSync(tableBackupFile, "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(raw);
          } catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to read table backup" }));
          }
          return;
        }

        if (req.method === "POST") {
          let body = "";
          let tbBytes = 0;
          let tbTooLarge = false;
          req.on("data", (chunk: Buffer) => {
            if (tbTooLarge) return;
            tbBytes += chunk.length;
            if (tbBytes > MAX_TABLE_BACKUP_BYTES) {
              tbTooLarge = true;
              res.statusCode = 413;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Table backup payload is too large" }));
              return;
            }
            body += chunk.toString("utf-8");
          });
          req.on("end", () => {
            if (tbTooLarge) return;
            try {
              JSON.parse(body);
              if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
              }
              fs.writeFileSync(tableBackupFile, body, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }));
            } catch {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to save table backup" }));
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
        } catch (e) {
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
        } catch (e) {
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
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
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
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              const { ticker, name, market } = JSON.parse(body);
              
              // Read existing ticker file
              let tickerData: { KR: Array<{ ticker: string; name: string }>; US: Array<{ ticker: string; name: string }> } = { KR: [], US: [] };
              
              if (fs.existsSync(tickerJsonFile)) {
                const fileContent = fs.readFileSync(tickerJsonFile, "utf-8");
                try {
                  tickerData = JSON.parse(fileContent);
                } catch (parseErr) {
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

      // 업데이트 (git pull) — 로컬 개발 전용
      server.middlewares.use("/api/git-pull", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "POST") { next(); return; }
        exec("git pull origin main --no-rebase", { cwd: process.cwd() }, (err, _o, stderr) => {
          res.setHeader("Content-Type", "application/json");
          if (err) { res.statusCode = 500; res.end(JSON.stringify({ error: stderr || err.message })); return; }
          res.end(JSON.stringify({ ok: true }));
        });
      });

      // 배포 (git push) — 로컬 개발 전용
      server.middlewares.use("/api/git-push", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "POST") { next(); return; }
        const cwd = process.cwd();
        const msg = `save: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`;
        exec("git add -A", { cwd }, () => {
          exec(`git commit -m "${msg}" --allow-empty`, { cwd }, () => {
            exec("git push origin main --force", { cwd }, (err, _o, stderr) => {
              res.setHeader("Content-Type", "application/json");
              if (err) { res.statusCode = 500; res.end(JSON.stringify({ error: stderr || err.message })); return; }
              res.end(JSON.stringify({ ok: true }));
            });
          });
        });
      });
    }
  };
}

import packageJson from "./package.json";

export default defineConfig({
  plugins: [react(), backupApiPlugin()],
  base: "/farmwallet/",
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
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

