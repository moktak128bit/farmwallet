import{i as E}from"./categoryUtils-xQO3_iW6.js";function o(i){return new Intl.NumberFormat("ko-KR").format(i)+"원"}function g(i,a){if(!a)return"-";const c=i.find(r=>r.id===a);return(c==null?void 0:c.name)??a}function j(i,a){const c=[],r=[],m=[],f=[];for(const t of i)t.kind==="income"?c.push(t):E(t)?m.push(t):t.kind==="transfer"?f.push(t):t.kind==="expense"&&r.push(t);const I=[...i].sort((t,n)=>t.date.localeCompare(n.date));let e=`# 가계부 정리

`;e+=`> 이 문서는 Farm Wallet 앱의 **설정 > 백업/복원 > 정리.md 내보내기**로 생성되었습니다.

`,e+=`생성일: ${new Date().toLocaleString("ko-KR")}

`,e+=`총 ${i.length}건 (수입 ${c.length} / 지출 ${r.length} / 저축성 지출 ${m.length} / 이체 ${f.length})

`,e+=`> 아래 통계는 원장(수입·지출·이체) 합계만 포함합니다. 앱에서 보이는 계좌 잔액·총액과 다를 수 있습니다.

`;const h=c.reduce((t,n)=>t+n.amount,0),y=r.reduce((t,n)=>t+n.amount,0),x=m.reduce((t,n)=>t+n.amount,0),v=f.reduce((t,n)=>t+n.amount,0),b=h-y-x;e+=`## 통계

`,e+=`| 구분 | 금액 |
`,e+=`|------|------|
`,e+=`| 총 수입 | ${o(h)} |
`,e+=`| 총 지출 | ${o(y)} |
`,e+=`| 저축성 지출 | ${o(x)} |
`,e+=`| 이체 | ${o(v)} |
`,e+=`| 순수입 (수입 - 지출 - 저축) | ${o(b)} |

`,e+=`## 계좌별 조정값

`,e+=`| 계좌 | 조정값 |
`,e+=`|------|------|
`;for(const t of a){const n=t.type==="securities"||t.type==="crypto"?t.initialCashBalance??t.initialBalance:t.initialBalance,s=t.cashAdjustment??0,k=t.savings??0,C=n+s+k;e+=`| ${t.name} | ${o(C)} |
`}e+=`
`;const l=new Map;for(const t of I){const n=t.date.slice(0,7);l.has(n)||l.set(n,{income:0,expense:0,savings:0,transfer:0});const s=l.get(n);t.kind==="income"?s.income+=t.amount:E(t)?s.savings+=t.amount:t.kind==="transfer"?s.transfer+=t.amount:s.expense+=t.amount}const w=Array.from(l.entries()).sort((t,n)=>t[0].localeCompare(n[0]));e+=`### 월별 통계

`,e+=`| 월 | 수입 | 지출 | 저축성 지출 | 이체 | 순수입 |
`,e+=`|------|------|------|-------------|------|--------|
`;for(const[t,n]of w){const s=n.income-n.expense-n.savings;e+=`| ${t} | ${o(n.income)} | ${o(n.expense)} | ${o(n.savings)} | ${o(n.transfer)} | ${o(s)} |
`}e+=`
`;const A=new Map;for(const t of r){const n=t.subCategory?`${t.category} > ${t.subCategory}`:t.category;A.set(n,(A.get(n)??0)+t.amount)}const M=Array.from(A.entries()).sort((t,n)=>n[1]-t[1]);e+=`## 지출 카테고리별 (저축성 지출 제외)

`,e+=`| 카테고리 | 금액 |
`,e+=`|----------|------|
`;for(const[t,n]of M)e+=`| ${t} | ${o(n)} |
`;e+=`
`;const $=`| 날짜 | 종류 | 카테고리 | 중분류 | 설명 | 금액 | 계좌 | 비고 |
`,d=`|------|------|----------|----------|------|------|------|------|
`;function u(t,n){const s=t.isFixedExpense?" (고정)":"",k=t.category||"-",C=t.subCategory||"-",B=t.description||"-";let p;t.kind==="income"?p=g(a,t.toAccountId):t.kind==="transfer"&&t.fromAccountId&&t.toAccountId?p=`${g(a,t.fromAccountId)} → ${g(a,t.toAccountId)}`:p=g(a,t.fromAccountId??t.toAccountId);const R=t.note||"-";return`| ${t.date} | ${n}${s} | ${k} | ${C} | ${B} | ${o(t.amount)} | ${p} | ${R} |
`}return e+=`## 수입 내역

`,e+=$+d,c.sort((t,n)=>t.date.localeCompare(n.date)).forEach(t=>e+=u(t,"수입")),e+=`
**${c.length}건, 합계 ${o(h)}**

`,e+=`## 지출 내역

`,e+=$+d,r.sort((t,n)=>t.date.localeCompare(n.date)).forEach(t=>e+=u(t,"지출")),e+=`
**${r.length}건, 합계 ${o(y)}**

`,e+=`## 저축성 지출 내역

`,e+=$+d,m.sort((t,n)=>t.date.localeCompare(n.date)).forEach(t=>e+=u(t,"저축성 지출")),e+=`
**${m.length}건, 합계 ${o(x)}**

`,e+=`## 이체 내역

`,e+=$+d,f.sort((t,n)=>t.date.localeCompare(n.date)).forEach(t=>e+=u(t,"이체")),e+=`
**${f.length}건, 합계 ${o(v)}**

`,e}export{j as generateLedgerMarkdownReport};
