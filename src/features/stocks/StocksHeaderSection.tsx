/**
 * 주식 탭 상단 헤더 — 제목 + USD/KRW 환율 pill + 시세 조회(보유/전체)·종목 불러오기·거래내역 CSV 버튼
 * + 마지막 갱신 시각 라벨.
 * StocksPage에서 분리 — React.memo로 감싸 폼 타이핑 등 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(useCallback 또는 useQuoteRefresh 반환 핸들러)이어야 memo가 효과를 가진다.
 */
import React from "react";
import { formatNumber } from "../../utils/formatter";

interface Props {
  fxRate: number | null;
  fxUpdatedAt: string | null;
  yahooUpdatedAt: string | null;
  isLoadingQuotes: boolean;
  isLoadingTickerDatabase: boolean;
  /** 보유 종목만 시세 갱신 (useQuoteRefresh — 참조 안정) */
  onRefreshHoldings: () => Promise<void>;
  /** ticker.json 전 종목 시세 갱신 (useQuoteRefresh — 참조 안정) */
  onRefreshFull: () => Promise<void>;
  /** 종목 불러오기 (부모 useCallback — 로그 + onLoadInitialTickers) */
  onLoadTickers: () => Promise<void>;
  /** 전체 매매 기록 CSV 내보내기 (부모 useCallback) */
  onExportTradesCsv: () => void;
}

export const StocksHeaderSection: React.FC<Props> = React.memo(function StocksHeaderSection({
  fxRate,
  fxUpdatedAt,
  yahooUpdatedAt,
  isLoadingQuotes,
  isLoadingTickerDatabase,
  onRefreshHoldings,
  onRefreshFull,
  onLoadTickers,
  onExportTradesCsv
}) {
  return (
    <div className="section-header">
      <h2>주식 거래 & 평가</h2>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {fxRate && (
          <span className="pill">
            USD/KRW: {formatNumber(fxRate)} 원
            {fxUpdatedAt && (
              <span className="muted" style={{ marginLeft: 6 }}>
                업데이트:{' '}
                {new Date(fxUpdatedAt).toLocaleString("ko-KR", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </span>
            )}
          </span>
        )}

        <button
          type="button"
          className="secondary"
          onClick={() => void onRefreshHoldings()}
          disabled={isLoadingQuotes}
          title="거래 내역에 있는 티커만 시세 갱신 · prices 및 tickerDatabase 반영"
        >
          {isLoadingQuotes ? "갱신 중..." : "시세 조회 (보유)"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void onRefreshFull()}
          disabled={isLoadingQuotes}
          title="data/ticker.json의 KR+US 전 종목 (개발 서버 필요). prices만 갱신"
        >
          {isLoadingQuotes ? "갱신 중..." : "시세 갱신 (전체)"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void onLoadTickers()}
          disabled={isLoadingTickerDatabase}
        >
          {isLoadingTickerDatabase ? "불러오는 중..." : "종목 불러오기"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onExportTradesCsv}
          title="전체 매매 기록을 CSV로 내보내기"
        >
          거래내역 CSV
        </button>

        {yahooUpdatedAt && (() => {
          const then = new Date(yahooUpdatedAt).getTime();
          const now = Date.now();
          const diffMin = Math.floor((now - then) / 60000);
          const label = diffMin < 1 ? "방금 전" : diffMin < 60 ? `${diffMin}분 전` : `${Math.floor(diffMin / 60)}시간 전`;
          return (
            <span className="hint" title={new Date(yahooUpdatedAt).toLocaleString("ko-KR")}>
              마지막 갱신: {label}
            </span>
          );
        })()}
      </div>
    </div>
  );
});
