# 토스증권 거래내역 전체 재구축

## 목적
앱(FarmWallet)의 토스 계좌 기록이 절반 이상 누락되어, 앱 스크린샷에서 전체 거래를 복원한다.

## 파일
- `tx.tsv` — 원장 (탭 구분). 스크린샷에서 읽은 그대로.

## 컬럼
date · time · kind · ticker · name · qty · amount · balance · src
- kind: buy | sell | fx_in | fx_out | dividend | interest | lending_fee | event_in | lend_out | lend_in | deposit
- amount: 부호 있는 달러 (구매 −, 판매/입금 +). 수량만 있는 건(출석체크·대차)은 공란
- balance: 그 거래 직후 달러 잔액 ← **중복 제거 키 + 누락 검증 키**

## 중복 제거 · 검증 규칙
1. (date, time, ticker, qty, amount, balance)가 같으면 같은 거래 → 1건으로
2. 시간 역순 정렬 시 `balance[i] - amount[i] == balance[i+1]` 이어야 함
   → 안 맞으면 그 사이에 누락된 기록이 있다 (스크린샷 추가 필요)
3. 잔액이 안 찍힌 행(출석체크입고·대차거래)은 체인 검증에서 제외
