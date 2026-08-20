/**
 * 환율 밴드(G2) 표시 공용 — 훅(useFxBand) + 한 줄 힌트 컴포넌트(FxBandHint).
 * 읽기 전용: historicalDailyFx + marketEnvSnapshots 이력(useAppStore 직접 구독)과 현재 환율로
 * utils/fxBand.buildFxBand를 계산한다. 주식 탭 환율 pill 툴팁·환전 폼·USD 매수 폼에서 사용.
 */
import React, { useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import { buildFxHistory } from "../../utils/portfolioHistory";
import { buildFxBand, describeFxBand, fxBandToneColor, type FxBandLabel, type FxBandResult } from "../../utils/fxBand";
import { getTodayKST } from "../../utils/date";
import { formatNumber } from "../../utils/formatter";

interface FxBandView {
  result: FxBandResult;
  /** 현재 환율의 위치 라벨 — band 없음/환율 미로드면 null */
  label: FxBandLabel | null;
  /** 툴팁용 여러 줄 상세(범위·분위·MA·표본). band 없으면 사유 한 줄 */
  detail: string;
}

/**
 * @param current 화면이 쓰는 현재 환율(보통 StocksPage의 fxRate prop) — pill 숫자와 같은 값으로 백분위를 계산
 */
export function useFxBand(current: number | null): FxBandView {
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const today = getTodayKST();
  return useMemo(() => {
    const result = buildFxBand(buildFxHistory(historicalDailyFx, marketEnvSnapshots), current, today);
    const label = describeFxBand(result.band);
    const b = result.band;
    const detail = b
      ? [
          label?.text,
          `최근 ${b.windowDays >= 360 ? "1년" : `${b.windowDays}일`} 범위 ${formatNumber(Math.round(b.min))}~${formatNumber(Math.round(b.max))}원 · 중앙값 ${formatNumber(Math.round(b.p50))} (p25 ${formatNumber(Math.round(b.p25))} / p75 ${formatNumber(Math.round(b.p75))})`,
          `MA20 ${b.ma20 != null ? formatNumber(Math.round(b.ma20)) : "-"} · MA60 ${b.ma60 != null ? formatNumber(Math.round(b.ma60)) : "-"}`,
          `표본 ${b.sampleDays}일 · 커버리지 ${Math.round(b.coverage * 100)}% (압축 구간은 일수 가중)`,
        ]
          .filter(Boolean)
          .join("\n")
      : `환율 밴드 없음 — ${result.reason ?? "이력 부족"}`;
    return { result, label, detail };
  }, [historicalDailyFx, marketEnvSnapshots, current, today]);
}

interface FxBandHintProps {
  current: number | null;
  /** 앞에 붙일 문맥 문구 (예: "USD 매수 참고:") */
  prefix?: string;
  style?: React.CSSProperties;
}

/** 한 줄 힌트 — band가 없으면 렌더하지 않는다(빈 줄 차지 안 함) */
export const FxBandHint: React.FC<FxBandHintProps> = ({ current, prefix, style }) => {
  const { result, label, detail } = useFxBand(current);
  const b = result.band;
  if (!b || !label) return null;
  return (
    <p className="hint" style={{ fontSize: 12, margin: 0, ...style }} title={detail}>
      {prefix ? `${prefix} ` : ""}
      환율 <strong style={{ color: fxBandToneColor(label.tone) }}>{label.text}</strong>
      <span className="muted" style={{ marginLeft: 6 }}>
        ({b.windowDays >= 360 ? "1년" : `${b.windowDays}일`} {formatNumber(Math.round(b.min))}~{formatNumber(Math.round(b.max))} · 중앙 {formatNumber(Math.round(b.p50))}
        {b.ma20 != null ? ` · MA20 ${formatNumber(Math.round(b.ma20))}` : ""})
      </span>
    </p>
  );
};
