import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Vendors.tsx",
  """    const excelData = filteredVendors.map((v, idx) => ({
      'No': idx + 1,
      '매입처명': v.name,
      '대표자': v.representative || '-',
      '사업자번호': v.businessNumber || '-',
      '연락처': v.contactNumber || '-',
      '이메일': v.email || '-',
      '유형': v.type || '-',
      '비고': v.memo || '-'
    }));""",
  """    const excelData = filteredVendors.map((v, idx) => {
      const typeLabels = (v.type || []).map((t: string) => VENDOR_TYPE_CONFIG[t as keyof typeof VENDOR_TYPE_CONFIG]?.label || t).join(', ');
      return {
        'No': idx + 1,
        '상호명 (매입처명)': v.name,
        '매입/거래 속성 (다중)': typeLabels || '-',
        '사업자등록번호': v.businessNumber || '-',
        '대표자명': v.representative || '-',
        '담당자': v.contactPerson || '-',
        '연락처': v.contactNumber || '-',
        '주소': v.address || '-',
        '이메일': v.email || '-',
        '상태': (v as any).isActive !== false ? '거래중' : '거래중지'
      };
    });""")
print("Vendors patched")
