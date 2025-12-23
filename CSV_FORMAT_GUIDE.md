# 가계부 CSV 업로드 형식 가이드

## CSV 파일 형식

가계부 데이터를 CSV 파일로 업로드할 때는 다음 형식을 따라주세요.

### 필수 컬럼

| 컬럼명 | 설명 | 예시 | 필수 여부 |
|--------|------|------|----------|
| `date` | 날짜 (YYYY-MM-DD 형식) | 2024-01-15 | 필수 |
| `kind` | 구분 (income/expense/transfer) | expense | 필수 |
| `amount` | 금액 (숫자만, 쉼표 없이) | 12000 | 필수 |
| `category` | 대분류 | 식비 | 필수 |
| `description` | 상세내역 | 점심 식사 | 필수 |

### 선택 컬럼

| 컬럼명 | 설명 | 예시 | 필수 여부 |
|--------|------|------|----------|
| `subCategory` | 세부 항목 | 외식/배달 | 선택 |
| `fromAccountId` | 출금 계좌 ID | CHK_KB | 선택* |
| `toAccountId` | 입금 계좌 ID | SAV_KB | 선택* |
| `note` | 비고 | 회식비 | 선택 |

\* `kind`가 `expense` 또는 `transfer`인 경우 `fromAccountId` 권장
\* `kind`가 `income` 또는 `transfer`인 경우 `toAccountId` 권장

## CSV 예시

### 수입 (income)
```csv
date,kind,amount,category,description,toAccountId
2024-01-15,income,3000000,급여,회사월급입금,CHK_KB
2024-01-20,income,50000,용돈,부모님 용돈,CHK_KB
```

### 지출 (expense)
```csv
date,kind,amount,category,subCategory,description,fromAccountId
2024-01-15,expense,12000,식비,외식/배달,점심 식사,CHK_KB
2024-01-16,expense,50000,의류미용비,의류,옷 구매,CHK_KB
2024-01-17,expense,17000,구독비,넷플릭스,넷플릭스 구독료,CHK_KB
```

### 이체 (transfer)
```csv
date,kind,amount,category,description,fromAccountId,toAccountId
2024-01-15,transfer,500000,저축이체,월 저축,CHK_KB,SAV_KB
2024-01-20,transfer,1000000,계좌이체,증권계좌 입금,CHK_KB,SEC_NH
```

## 주의사항

1. **날짜 형식**: 반드시 `YYYY-MM-DD` 형식으로 작성해주세요 (예: 2024-01-15)
2. **구분 (kind)**: 다음 중 하나만 사용 가능합니다
   - `income`: 수입
   - `expense`: 지출
   - `transfer`: 이체
3. **금액**: 숫자만 입력 (쉼표, 원화 표시 없이)
4. **계좌 ID**: 앱에 등록된 계좌 ID를 정확히 입력해주세요
5. **인코딩**: UTF-8 인코딩으로 저장해주세요
6. **첫 번째 줄**: 헤더(컬럼명)를 포함해주세요

## Excel에서 CSV로 저장하는 방법

1. Excel에서 데이터를 입력합니다
2. "다른 이름으로 저장" 선택
3. 파일 형식을 "CSV UTF-8(쉼표로 분리)(*.csv)" 선택
4. 저장

## 샘플 CSV 파일

다음은 완전한 예시 CSV 파일입니다:

```csv
date,kind,amount,category,subCategory,description,fromAccountId,toAccountId,note
2024-01-15,income,3000000,급여,,회사월급입금,,CHK_KB,
2024-01-15,expense,12000,식비,외식/배달,점심 식사,CHK_KB,,
2024-01-15,expense,50000,의류미용비,의류,옷 구매,CHK_KB,,
2024-01-16,transfer,500000,저축이체,,월 저축,CHK_KB,SAV_KB,
2024-01-17,expense,17000,구독비,넷플릭스,넷플릭스 구독료,CHK_KB,,
2024-01-20,income,50000,용돈,,부모님 용돈,,CHK_KB,
```

