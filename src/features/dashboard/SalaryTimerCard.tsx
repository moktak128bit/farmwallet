import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LedgerEntry } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";

interface SalaryTimerSettings {
  /** 월급 받는 날 (1~31). 짧은 달은 말일로 자동 보정 */
  payday: number;
  /** 한 달 월급액 (KRW, 실수령액 권장) */
  monthlySalary: number;
}

interface Props {
  ledger: LedgerEntry[];
}

const MS_PER = { sec: 1000, min: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 } as const;

/** 짧은 달 보정: 요청 payday가 그 달 말일보다 크면 말일로 클램프 */
function clampPayday(year: number, monthIndex: number, payday: number): number {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(payday, 1), lastDay);
}

/** now가 속한 급여 구간 [직전 월급일 → 다음 월급일) 계산 */
function getPayPeriod(payday: number, now: Date): { start: Date; end: Date } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const thisPayday = new Date(y, m, clampPayday(y, m, payday), 0, 0, 0, 0);

  if (now.getTime() >= thisPayday.getTime()) {
    const end = new Date(y, m + 1, 1);
    end.setDate(clampPayday(end.getFullYear(), end.getMonth(), payday));
    return { start: thisPayday, end };
  }
  const start = new Date(y, m - 1, 1);
  start.setDate(clampPayday(start.getFullYear(), start.getMonth(), payday));
  return { start, end: thisPayday };
}

function loadSettings(): SalaryTimerSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.SALARY_TIMER);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SalaryTimerSettings>;
    if (
      typeof parsed.payday === "number" &&
      typeof parsed.monthlySalary === "number" &&
      parsed.payday >= 1 &&
      parsed.payday <= 31 &&
      parsed.monthlySalary > 0
    ) {
      return { payday: parsed.payday, monthlySalary: parsed.monthlySalary };
    }
  } catch {
    /* 무시 — 손상된 값이면 미설정 취급 */
  }
  return null;
}

/** 정수부는 천 단위 콤마 */
const fmtInt = (n: number): string => Math.floor(Math.max(0, n)).toLocaleString("ko-KR");
/** ".XX" 소수부 (2자리) */
const fmtFrac = (n: number): string => (Math.max(0, n) % 1).toFixed(2).slice(1);

/** 단가 표시: 100원 미만이면 소수 2자리, 그 이상은 정수 콤마 */
function fmtRate(n: number): string {
  if (n < 100) return n.toFixed(2);
  return Math.round(n).toLocaleString("ko-KR");
}

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

export const SalaryTimerCard: React.FC<Props> = ({ ledger }) => {
  const [settings, setSettings] = useState<SalaryTimerSettings | null>(() => loadSettings());
  const [editing, setEditing] = useState<boolean>(() => loadSettings() === null);
  const [paydayInput, setPaydayInput] = useState<string>(() => String(loadSettings()?.payday ?? 25));
  const [salaryInput, setSalaryInput] = useState<string>(() => {
    const v = loadSettings()?.monthlySalary;
    return v ? String(v) : "";
  });

  // 실시간 렌더: requestAnimationFrame으로 매 프레임 now 갱신 (숫자가 주르륵 올라감)
  const [now, setNow] = useState<number>(() => Date.now());
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!settings || editing) return;
    const loop = () => {
      setNow(Date.now());
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [settings, editing]);

  /** 가계부의 '급여' 수입 기록에서 월평균 추정 (자동 채우기용) */
  const ledgerSalary = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const e of ledger) {
      if (e.kind !== "income") continue;
      const hay = `${e.category ?? ""} ${e.subCategory ?? ""} ${e.description ?? ""}`;
      if (!hay.includes("급여") && !hay.includes("월급")) continue;
      const month = e.date?.slice(0, 7);
      if (!month) continue;
      byMonth.set(month, (byMonth.get(month) ?? 0) + e.amount);
    }
    if (byMonth.size === 0) return null;
    const values = [...byMonth.values()];
    const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
    return { avg, months: values.length };
  }, [ledger]);

  const handleSave = useCallback(() => {
    const payday = Math.round(Number(paydayInput));
    const monthlySalary = Math.round(Number(salaryInput.replace(/[,\s]/g, "")));
    if (!Number.isFinite(payday) || payday < 1 || payday > 31) return;
    if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) return;
    const next: SalaryTimerSettings = { payday, monthlySalary };
    setSettings(next);
    setEditing(false);
    try {
      window.localStorage.setItem(STORAGE_KEYS.SALARY_TIMER, JSON.stringify(next));
    } catch {
      /* 저장 실패해도 세션 내에서는 동작 */
    }
  }, [paydayInput, salaryInput]);

  // ── 설정 폼 ──────────────────────────────────────────────────────────────
  if (editing || !settings) {
    const paddayNum = Number(paydayInput);
    const salaryNum = Number(salaryInput.replace(/[,\s]/g, ""));
    const valid =
      Number.isFinite(paddayNum) && paddayNum >= 1 && paddayNum <= 31 && Number.isFinite(salaryNum) && salaryNum > 0;
    return (
      <div className="card">
        <div className="card-title" style={{ marginBottom: 4 }}>💰 월급 실시간 타이머</div>
        <div className="hint" style={{ fontSize: 13, marginBottom: 16 }}>
          월급일과 월급액을 입력하면, 다음 월급일까지 1초마다 돈이 쌓이는 모습을 볼 수 있어요.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="hint" style={{ fontSize: 13 }}>월급 받는 날</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                min={1}
                max={31}
                value={paydayInput}
                onChange={(e) => setPaydayInput(e.target.value)}
                style={{ width: 70, padding: "6px 8px" }}
              />
              <span className="hint" style={{ fontSize: 13 }}>일</span>
            </div>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="hint" style={{ fontSize: 13 }}>한 달 월급액 (실수령액)</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="text"
                inputMode="numeric"
                placeholder="예: 3000000"
                value={salaryInput}
                onChange={(e) => setSalaryInput(e.target.value)}
                style={{ width: 160, padding: "6px 8px" }}
              />
              <span className="hint" style={{ fontSize: 13 }}>원</span>
            </div>
          </label>
          <button type="button" className="primary" onClick={handleSave} disabled={!valid} style={{ padding: "7px 16px" }}>
            시작
          </button>
          {settings && (
            <button type="button" onClick={() => setEditing(false)} style={{ padding: "7px 16px" }}>
              취소
            </button>
          )}
        </div>
        {ledgerSalary && (
          <button
            type="button"
            onClick={() => setSalaryInput(String(ledgerSalary.avg))}
            style={{ marginTop: 12, padding: "5px 12px", fontSize: 13 }}
          >
            가계부 급여 기록에서 불러오기 (월평균 {ledgerSalary.avg.toLocaleString("ko-KR")}원 · {ledgerSalary.months}개월)
          </button>
        )}
      </div>
    );
  }

  // ── 실시간 타이머 ─────────────────────────────────────────────────────────
  const nowDate = new Date(now);
  const { start, end } = getPayPeriod(settings.payday, nowDate);
  const periodMs = end.getTime() - start.getTime();
  const elapsedMs = Math.min(Math.max(now - start.getTime(), 0), periodMs);
  const progress = periodMs > 0 ? elapsedMs / periodMs : 0;
  const earned = settings.monthlySalary * progress;

  const perSec = periodMs > 0 ? (settings.monthlySalary / periodMs) * MS_PER.sec : 0;
  const rates: Array<{ label: string; value: number }> = [
    { label: "1초", value: perSec },
    { label: "1분", value: perSec * 60 },
    { label: "1시간", value: perSec * 3600 },
    { label: "하루", value: perSec * 86400 },
    { label: "1주", value: perSec * 604800 },
  ];

  const remainingMs = Math.max(end.getTime() - now, 0);
  const cdDays = Math.floor(remainingMs / MS_PER.day);
  const cdHours = (remainingMs % MS_PER.day) / MS_PER.hour;
  const cdMin = (remainingMs % MS_PER.hour) / MS_PER.min;
  const cdSec = (remainingMs % MS_PER.min) / MS_PER.sec;

  const elapsedDays = Math.floor(elapsedMs / MS_PER.day);
  const totalDays = Math.round(periodMs / MS_PER.day);
  const nextPayLabel = `${end.getMonth() + 1}월 ${end.getDate()}일`;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div className="card-title">💰 월급 실시간 타이머</div>
        <button
          type="button"
          onClick={() => {
            setPaydayInput(String(settings.payday));
            setSalaryInput(String(settings.monthlySalary));
            setEditing(true);
          }}
          style={{ padding: "4px 10px", fontSize: 12 }}
        >
          설정
        </button>
      </div>
      <div className="hint" style={{ fontSize: 13, marginBottom: 12 }}>
        매월 {settings.payday}일 월급 · 다음 월급일 {nextPayLabel}까지 쌓인 돈
      </div>

      {/* 히어로: 실시간 누적 금액 */}
      <div
        style={{
          textAlign: "center",
          padding: "20px 12px",
          background: "var(--surface)",
          borderRadius: 12,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: 40,
            lineHeight: 1.1,
            color: "var(--chart-income)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.5px",
          }}
        >
          {fmtInt(earned)}
          <span style={{ fontSize: 22, opacity: 0.75 }}>{fmtFrac(earned)}</span>
          <span style={{ fontSize: 22, marginLeft: 4 }}>원</span>
        </div>
        <div className="hint" style={{ fontSize: 13, marginTop: 6 }}>
          이번 급여 구간에서 지금까지 번 돈 ({(progress * 100).toFixed(2)}%)
        </div>
      </div>

      {/* 진행 바 */}
      <div style={{ position: "relative", height: 10, background: "var(--border)", borderRadius: 5, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: "var(--chart-income)",
            borderRadius: 5,
          }}
        />
      </div>
      <div className="hint" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6 }}>
        <span>{elapsedDays}일 경과 / 총 {totalDays}일</span>
        <span>
          남은 시간 {cdDays}일 {pad2(cdHours)}:{pad2(cdMin)}:{pad2(cdSec)}
        </span>
      </div>

      {/* 단위별 버는 속도 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
          gap: 8,
          marginTop: 14,
        }}
      >
        {rates.map((r) => (
          <div
            key={r.label}
            style={{ padding: "10px 8px", background: "var(--surface)", borderRadius: 8, textAlign: "center" }}
          >
            <div className="hint" style={{ fontSize: 12 }}>{r.label}</div>
            <div style={{ fontWeight: 700, fontSize: 17, fontVariantNumeric: "tabular-nums" }}>
              {fmtRate(r.value)}
              <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>원</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
