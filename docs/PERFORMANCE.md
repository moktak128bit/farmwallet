# 성능 점검 가이드

앱이 느릴 때 아래 순서로 원인을 좁히면 됩니다.

1. **Chrome DevTools → Performance**: 녹화 후 첫 페인트 전 긴 작업(Long task)이 `loadData`, `JSON.parse`, React 커밋 중 어디인지 확인합니다.
2. **Network**: `USDKRW`·Yahoo 등 동일 요청이 중복되는지 확인합니다. (환율은 `FxRateProvider`에서 단일 조회합니다.)
3. **프로덕션 빌드**: `npm run build` 후 `npm run preview`로 측정합니다. `npm run dev`와 React StrictMode는 개발 전용 오버헤드가 있습니다.
