import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Billings.tsx",
  """    const excelData = filteredBillings.map(b => ({
      '청구년월': b.billingMonth,
      '고객사': customers.find(c => c.id === b.customerId)?.name || '-',
      '청구 금액(VAT포함)': b.totalAmount,
      '미납 금액': b.unpaidAmount,
      '결제 상태': b.status === 'PAID' ? '수납완료' : b.status === 'PARTIAL_PAID' ? '부분수납' : '미납',
      '비고': b.memo || '-'
    }));""",
  """    const excelData = filteredBillings.map(b => ({
      '청구월': b.billingMonth,
      '고객사': customers.find(c => c.id === b.customerId)?.name || '-',
      '공급가액': b.totalAmount ? Math.round(b.totalAmount / 1.1) : 0,
      '청구합계(VAT포함)': b.totalAmount || 0,
      '미납액': b.unpaidAmount || 0,
      '상태': b.status === 'PAID' ? '수납완료' : b.status === 'PARTIAL_PAID' ? '부분수납' : '미납',
      '비고': b.memo || '-'
    }));""")
print("Billings patched")
