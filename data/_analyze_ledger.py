import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta

with open(r'/c/Users/Atom/farmwallet/data/ledger.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Total entries: {len(data)}")
print()

# ============================================================
# 1. GAS STATION entries
# ============================================================
gas_keywords = ['주유', '셀프', '충전', '가득', 'GS', 'SK', 'S-OIL', '현대오일', '알뜰']
print("=" * 90)
print("1. GAS STATION / 주유 ENTRIES (ALL, flagging > 100,000)")
print("=" * 90)
gas_entries = []
for e in data:
    desc = (e.get('description') or '')
    cat = (e.get('category') or '')
    subcat = (e.get('subCategory') or '')
    combined = desc + ' ' + cat + ' ' + subcat
    combined_lower = combined.lower()
    if any(kw.lower() in combined_lower for kw in gas_keywords):
        gas_entries.append(e)

gas_entries.sort(key=lambda x: x.get('date', ''))
for e in gas_entries:
    flag = " *** OVER 100K ***" if e['amount'] > 100000 else ""
    print(f"  {e['date']} | {e['amount']:>10,} | {e.get('kind','?'):>8} | {e.get('category','')} > {e.get('subCategory','')} | {e.get('description','')}{flag}")

if not gas_entries:
    print("  (none found)")
print()

# ============================================================
# 2. DUPLICATE ENTRIES
# ============================================================
print("=" * 90)
print("2. DUPLICATE ENTRIES (same date + amount + description)")
print("=" * 90)
dup_key = defaultdict(list)
for e in data:
    key = (e.get('date',''), e.get('amount',0), e.get('description',''))
    dup_key[key].append(e)

dup_count = 0
for key, entries in sorted(dup_key.items()):
    if len(entries) > 1:
        dup_count += 1
        print(f"  [{len(entries)}x] {key[0]} | {key[1]:>10,} | {key[2]}")
        for e in entries:
            print(f"       id={e['id']} kind={e.get('kind','')} cat={e.get('category','')} > {e.get('subCategory','')} from={e.get('fromAccountId','')} to={e.get('toAccountId','')}")
        print()

if dup_count == 0:
    print("  (none found)")
print()

# ============================================================
# 3. SUSPICIOUSLY ROUND AMOUNTS
# ============================================================
print("=" * 90)
print("3. SUSPICIOUSLY ROUND AMOUNTS (exactly 100K, 200K, 300K, 500K, 1M)")
print("   in variable-spending categories")
print("=" * 90)
variable_cats = ['식비', '교통', '카페', '주유', '생활', '문화', '쇼핑', '의류', '미용', '건강', '반려동물', '취미']
round_amounts = [100000, 200000, 300000, 500000, 1000000]
round_entries = []
for e in data:
    cat = e.get('category', '')
    if any(vc in cat for vc in variable_cats) and e.get('amount', 0) in round_amounts:
        round_entries.append(e)

round_entries.sort(key=lambda x: (x.get('date',''), x.get('amount',0)))
for e in round_entries:
    print(f"  {e['date']} | {e['amount']:>10,} | {e.get('kind','?'):>8} | {e.get('category','')} > {e.get('subCategory','')} | {e.get('description','')}")

if not round_entries:
    print("  (none found)")
print()

# ============================================================
# 4. NEGATIVE OR ZERO AMOUNTS
# ============================================================
print("=" * 90)
print("4. NEGATIVE OR ZERO AMOUNTS")
print("=" * 90)
neg_zero = [e for e in data if e.get('amount', 0) <= 0]
neg_zero.sort(key=lambda x: x.get('date',''))
for e in neg_zero:
    print(f"  {e['date']} | {e['amount']:>10,} | {e.get('kind','?'):>8} | {e.get('category','')} > {e.get('subCategory','')} | {e.get('description','')}")

if not neg_zero:
    print("  (none found)")
print()

# ============================================================
# 5. VERY LARGE AMOUNTS in typically small categories
# ============================================================
print("=" * 90)
print("5. LARGE AMOUNTS (>500K) IN TYPICALLY SMALL CATEGORIES")
print("=" * 90)
small_cats = ['식비', '교통', '카페', '주유', '생활', '문화', '의류', '미용', '건강', '반려동물']
large_in_small = []
for e in data:
    cat = e.get('category', '')
    if any(sc in cat for sc in small_cats) and e.get('amount', 0) > 500000:
        large_in_small.append(e)

large_in_small.sort(key=lambda x: (x.get('date',''), x.get('amount',0)))
for e in large_in_small:
    print(f"  {e['date']} | {e['amount']:>10,} | {e.get('kind','?'):>8} | {e.get('category','')} > {e.get('subCategory','')} | {e.get('description','')}")

if not large_in_small:
    print("  (none found)")
print()

# ============================================================
# 6. REFUND-LIKE PATTERNS
# ============================================================
print("=" * 90)
print("6. REFUND-LIKE PATTERNS (expense + income, same amount & desc, within 3 days)")
print("=" * 90)
expenses = [e for e in data if e.get('kind') == 'expense']
incomes = [e for e in data if e.get('kind') == 'income']

refund_pairs = []
for exp in expenses:
    for inc in incomes:
        if (exp['amount'] == inc['amount'] and
            exp.get('description','') == inc.get('description','') and
            exp.get('description','')):
            try:
                d_exp = datetime.strptime(exp['date'], '%Y-%m-%d')
                d_inc = datetime.strptime(inc['date'], '%Y-%m-%d')
                diff = (d_inc - d_exp).days
                if 0 <= diff <= 3:
                    refund_pairs.append((exp, inc, diff))
            except:
                pass

refund_pairs.sort(key=lambda x: x[0].get('date',''))
seen_pairs = set()
for exp, inc, diff in refund_pairs:
    pair_key = (exp['id'], inc['id'])
    if pair_key not in seen_pairs:
        seen_pairs.add(pair_key)
        print(f"  EXPENSE: {exp['date']} | {exp['amount']:>10,} | {exp.get('category','')} | {exp.get('description','')}")
        print(f"  INCOME:  {inc['date']} | {inc['amount']:>10,} | {inc.get('category','')} | {inc.get('description','')}  (diff: {diff} days)")
        print()

if not refund_pairs:
    print("  (none found)")

# Also check same-amount expense pairs on same day (possible double-charge)
print("-" * 90)
print("6b. SAME-AMOUNT EXPENSES on same day with similar descriptions (possible double-charge)")
print("-" * 90)
from itertools import combinations
exp_by_date = defaultdict(list)
for e in expenses:
    exp_by_date[e.get('date','')].append(e)

double_charge_count = 0
for date, exps in sorted(exp_by_date.items()):
    if len(exps) < 2:
        continue
    for a, b in combinations(exps, 2):
        if a['amount'] == b['amount'] and a['amount'] > 5000:
            # Check if descriptions are similar or same
            desc_a = a.get('description','')
            desc_b = b.get('description','')
            if desc_a == desc_b or (desc_a and desc_b and (desc_a in desc_b or desc_b in desc_a)):
                double_charge_count += 1
                print(f"  {date} | {a['amount']:>10,} | {desc_a} vs {desc_b}")
                print(f"       A: id={a['id']} cat={a.get('category','')} from={a.get('fromAccountId','')}")
                print(f"       B: id={b['id']} cat={b.get('category','')} from={b.get('fromAccountId','')}")
                print()

if double_charge_count == 0:
    print("  (none found)")
print()

# ============================================================
# 7. CANCELLATION / REFUND KEYWORDS
# ============================================================
print("=" * 90)
print("7. ENTRIES WITH CANCELLATION/REFUND KEYWORDS (취소, 환불, 반품)")
print("=" * 90)
cancel_kw = ['취소', '환불', '반품']
cancel_entries = []
for e in data:
    desc = e.get('description', '') or ''
    note = e.get('note', '') or ''
    combined = desc + ' ' + note
    if any(kw in combined for kw in cancel_kw):
        cancel_entries.append(e)

cancel_entries.sort(key=lambda x: x.get('date',''))
for e in cancel_entries:
    print(f"  {e['date']} | {e['amount']:>10,} | {e.get('kind','?'):>8} | {e.get('category','')} > {e.get('subCategory','')} | {e.get('description','')}")
    if e.get('note'):
        print(f"       note: {e['note']}")

if not cancel_entries:
    print("  (none found)")
print()

# ============================================================
# BONUS: Amount = 1 (pre-auth test)
# ============================================================
print("=" * 90)
print("BONUS: ENTRIES WITH AMOUNT EXACTLY 1 (common pre-auth test)")
print("=" * 90)
one_entries = [e for e in data if e.get('amount') == 1]
for e in one_entries:
    print(f"  {e['date']} | {e['amount']:>10,} | {e.get('kind','?'):>8} | {e.get('category','')} > {e.get('subCategory','')} | {e.get('description','')}")
if not one_entries:
    print("  (none found)")
print()

# ============================================================
# BONUS 2: Amounts that are unusually large for their category
# (top 5 by category, showing outliers)
# ============================================================
print("=" * 90)
print("BONUS 2: POTENTIAL OUTLIERS - Top 3 largest per category (expense only, small cats)")
print("=" * 90)
cat_amounts = defaultdict(list)
for e in data:
    if e.get('kind') == 'expense':
        cat = e.get('category', '')
        if any(sc in cat for sc in small_cats):
            cat_amounts[cat].append(e)

for cat in sorted(cat_amounts.keys()):
    entries = cat_amounts[cat]
    entries.sort(key=lambda x: -x.get('amount', 0))
    top3 = entries[:3]
    avg = sum(e['amount'] for e in entries) / len(entries) if entries else 0
    print(f"  [{cat}] avg={avg:,.0f} | count={len(entries)}")
    for e in top3:
        flag = " *** >3x avg ***" if e['amount'] > avg * 3 else ""
        print(f"    {e['date']} | {e['amount']:>10,} | {e.get('description','')}{flag}")
    print()

# ============================================================
# SUMMARY STATS
# ============================================================
print("=" * 90)
print("SUMMARY STATISTICS")
print("=" * 90)
cats = defaultdict(int)
kinds = defaultdict(int)
for e in data:
    cats[e.get('category','')] += 1
    kinds[e.get('kind','')] += 1

print(f"  Total entries: {len(data)}")
dates = [e.get('date','') for e in data if e.get('date')]
print(f"  Date range: {min(dates)} to {max(dates)}")
print(f"\n  By kind:")
for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
    print(f"    {k:>10}: {v}")
print(f"\n  Top 20 categories:")
for k, v in sorted(cats.items(), key=lambda x: -x[1])[:20]:
    print(f"    {k:>12}: {v}")
