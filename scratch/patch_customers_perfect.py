import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Customers.tsx",
  """    const excelData = filteredCustomers.map((c, idx) => ({
      'No': idx + 1,
      '고객사명': c.name,
      '대표자명': c.representative || '-',
      '사업자번호': c.businessNumber || '-',
      '담당자': c.contactPerson || '-',
      '연락처': c.contactNumber || '-',
      '이메일': c.email || '-',
      '주소': c.address || '-',
      '비고': c.memo || '-'
    }));""",
  """    const excelData = filteredCustomers.map((c, idx) => ({
      'No': idx + 1,
      '고객사명': c.name,
      '상태': (c as any).isActive === false ? '비활성' : '활성',
      '대표자': c.representative || '-',
      '사업자등록번호': c.businessNumber || '-',
      '종목': (c as any).businessItem || '-',
      '연락처': c.contactNumber || '-',
      '이메일': (c as any).email || '-',
      '주소': c.address || '-',
      '등록 일시': c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'
    }));""")
print("Customers patched")
