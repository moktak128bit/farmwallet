/**
 * 테스트 전용 최소 IndexedDB 인메모리 스텁 (fake-indexeddb 미설치 환경).
 * services/backupStore.ts가 쓰는 표면만 구현한다:
 *   indexedDB.open → onupgradeneeded/onsuccess/onerror, db.objectStoreNames.contains, db.createObjectStore(keyPath),
 *   db.transaction(names, mode).objectStore(name).{put,get,getAll,delete,clear}, tx.oncomplete/onerror/onabort, db.close
 * 요청은 마이크로태스크로 비동기 완료되며, readwrite 트랜잭션은 복사본 위에서 작업하고 완료 시 커밋(원자적)한다.
 * `failWrites`를 켜면 put/delete가 실패해 트랜잭션이 abort된다(quota 등 쓰기 실패 시뮬레이션).
 */

type Handler = ((ev: unknown) => void) | null;

function clone<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

class FakeRequest<T = unknown> {
  result: T | undefined = undefined;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
}

interface StoreDef {
  keyPath: string;
  rows: Map<string, unknown>;
}

interface DBState {
  name: string;
  version: number;
  stores: Map<string, StoreDef>;
}

class FakeStringList {
  constructor(private names: () => string[]) {}
  contains(name: string): boolean {
    return this.names().includes(name);
  }
  get length(): number {
    return this.names().length;
  }
  item(i: number): string | null {
    return this.names()[i] ?? null;
  }
}

class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: Error | null = null;
  private pending = 0;
  private finished = false;
  private aborted = false;
  /** readwrite 작업용 복사본 */
  private working: Map<string, Map<string, unknown>>;

  constructor(
    private state: DBState,
    private names: string[],
    private mode: IDBTransactionMode,
    private opts: MemoryIDBOptions
  ) {
    this.working = new Map();
    for (const n of names) {
      const def = state.stores.get(n);
      if (!def) throw new Error(`NotFoundError: store ${n}`);
      this.working.set(n, new Map(def.rows));
    }
    // 요청이 하나도 없어도 완료 이벤트는 발생
    queueMicrotask(() => this.checkComplete());
  }

  objectStore(name: string): FakeObjectStore {
    const rows = this.working.get(name);
    const def = this.state.stores.get(name);
    if (!rows || !def) throw new Error(`NotFoundError: store ${name}`);
    return new FakeObjectStore(this, rows, def.keyPath, this.mode, this.opts);
  }

  abort(): void {
    if (this.finished) return;
    this.aborted = true;
    this.finish();
  }

  /** @internal */
  schedule<T>(req: FakeRequest<T>, run: () => T): void {
    if (this.finished) throw new Error("TransactionInactiveError");
    this.pending += 1;
    queueMicrotask(() => {
      if (this.finished) return;
      try {
        const value = run();
        req.result = value;
        req.onsuccess?.({ target: req });
      } catch (e) {
        req.error = e instanceof Error ? e : new Error(String(e));
        this.error = req.error;
        req.onerror?.({ target: req });
        this.aborted = true;
      } finally {
        this.pending -= 1;
        queueMicrotask(() => this.checkComplete());
      }
    });
  }

  private checkComplete(): void {
    if (this.finished || this.pending > 0) return;
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.aborted) {
      this.onerror?.({ target: this });
      this.onabort?.({ target: this });
      return;
    }
    if (this.mode === "readwrite") {
      for (const [n, rows] of this.working) {
        const def = this.state.stores.get(n);
        if (def) def.rows = rows;
      }
    }
    this.oncomplete?.({ target: this });
  }
}

class FakeObjectStore {
  constructor(
    private tx: FakeTransaction,
    private rows: Map<string, unknown>,
    private keyPath: string,
    private mode: IDBTransactionMode,
    private opts: MemoryIDBOptions
  ) {}

  private assertWrite(): void {
    if (this.mode !== "readwrite") throw new Error("ReadOnlyError");
    if (this.opts.failWrites) throw new Error("QuotaExceededError (simulated)");
  }

  put(value: unknown): FakeRequest<string> {
    const req = new FakeRequest<string>();
    this.tx.schedule(req, () => {
      this.assertWrite();
      const key = (value as Record<string, unknown>)[this.keyPath];
      if (typeof key !== "string") throw new Error("DataError: key");
      this.rows.set(key, clone(value));
      return key;
    });
    return req;
  }

  get(key: string): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    this.tx.schedule(req, () => {
      const v = this.rows.get(key);
      return v === undefined ? undefined : clone(v);
    });
    return req;
  }

  getAll(): FakeRequest<unknown[]> {
    const req = new FakeRequest<unknown[]>();
    this.tx.schedule(req, () => [...this.rows.values()].map((v) => clone(v)));
    return req;
  }

  delete(key: string): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.tx.schedule(req, () => {
      this.assertWrite();
      this.rows.delete(key);
      return undefined;
    });
    return req;
  }

  clear(): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.tx.schedule(req, () => {
      this.assertWrite();
      this.rows.clear();
      return undefined;
    });
    return req;
  }
}

class FakeDB {
  onversionchange: Handler = null;
  closed = false;
  readonly objectStoreNames: FakeStringList;
  constructor(private state: DBState, private opts: MemoryIDBOptions) {
    this.objectStoreNames = new FakeStringList(() => [...state.stores.keys()]);
  }
  get name(): string {
    return this.state.name;
  }
  get version(): number {
    return this.state.version;
  }
  createObjectStore(name: string, params?: { keyPath?: string }): FakeObjectStore {
    const def: StoreDef = { keyPath: params?.keyPath ?? "id", rows: new Map() };
    this.state.stores.set(name, def);
    const tx = new FakeTransaction(this.state, [name], "readwrite", this.opts);
    return tx.objectStore(name);
  }
  transaction(names: string | string[], mode: IDBTransactionMode = "readonly"): FakeTransaction {
    if (this.closed) throw new Error("InvalidStateError: closed");
    return new FakeTransaction(this.state, Array.isArray(names) ? names : [names], mode, this.opts);
  }
  close(): void {
    this.closed = true;
  }
}

class FakeOpenRequest extends FakeRequest<FakeDB> {
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

export interface MemoryIDBOptions {
  /** true면 put/delete/clear가 실패해 readwrite 트랜잭션이 abort된다 */
  failWrites?: boolean;
  /** true면 open 자체가 onerror로 실패한다 */
  failOpen?: boolean;
}

export interface MemoryIndexedDB {
  readonly options: MemoryIDBOptions;
  /** 스토어 내용(복사본) — 단언용 */
  rows(dbName: string, storeName: string): unknown[];
  /** 설치 해제 (window.indexedDB 원복) */
  uninstall(): void;
}

/** window.indexedDB를 인메모리 스텁으로 교체. 반환 핸들로 내용 확인·옵션 변경·해제. */
export function installMemoryIndexedDB(options: MemoryIDBOptions = {}): MemoryIndexedDB {
  const dbs = new Map<string, DBState>();
  const opts: MemoryIDBOptions = { ...options };

  const factory = {
    open(name: string, version = 1): FakeOpenRequest {
      const req = new FakeOpenRequest();
      queueMicrotask(() => {
        if (opts.failOpen) {
          req.error = new Error("open failed (simulated)");
          req.onerror?.({ target: req });
          return;
        }
        let state = dbs.get(name);
        let upgrade = false;
        if (!state) {
          state = { name, version: 0, stores: new Map() };
          dbs.set(name, state);
        }
        if (version > state.version) {
          state.version = version;
          upgrade = true;
        }
        const db = new FakeDB(state, opts);
        req.result = db;
        if (upgrade) req.onupgradeneeded?.({ target: req, oldVersion: 0, newVersion: version });
        queueMicrotask(() => req.onsuccess?.({ target: req }));
      });
      return req;
    },
    deleteDatabase(name: string): FakeRequest<undefined> {
      const req = new FakeRequest<undefined>();
      queueMicrotask(() => {
        dbs.delete(name);
        req.onsuccess?.({ target: req });
      });
      return req;
    }
  };

  const target = window as unknown as { indexedDB?: unknown };
  const hadOwn = Object.prototype.hasOwnProperty.call(target, "indexedDB");
  const previous = target.indexedDB;
  Object.defineProperty(target, "indexedDB", { value: factory, configurable: true, writable: true });

  return {
    options: opts,
    rows(dbName, storeName) {
      const def = dbs.get(dbName)?.stores.get(storeName);
      return def ? [...def.rows.values()].map((v) => clone(v)) : [];
    },
    uninstall() {
      if (hadOwn) {
        Object.defineProperty(target, "indexedDB", { value: previous, configurable: true, writable: true });
      } else {
        delete target.indexedDB;
      }
    }
  };
}
