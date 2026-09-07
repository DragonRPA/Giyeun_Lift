import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Products.tsx",
  """    const excelData = filteredProducts.map((p, idx) => ({
      'No': idx + 1,
      '모델명': p.modelName,
      '총 보유 대수': p.totalStock,
      '당사 자산': p.ownedStock,
      '임차 자산': p.leasedStock,
      '제조사': p.manufacturer || '-',
      '분류': p.category,
      '등록일': p.createdAt
    }));""",
  """    const excelData = filteredProducts.map((p, idx) => ({
      'NO': idx + 1,
      '모델명': p.modelName,
      '피트 (FEET)': p.category,
      '자산현황 (당사/임차)': `${p.totalStock}대 (${p.ownedStock} / ${p.leasedStock})`,
      '클라우드 문서 (R2)': (p as any).documentUrl ? 'O' : 'X',
      '동력': (p as any).powerType || '-',
      '작업높이': (p as any).workingHeight ? `${(p as any).workingHeight}m` : '-',
      '발판높이': (p as any).platformHeight ? `${(p as any).platformHeight}m` : '-',
      '장비중량': (p as any).weight ? `${(p as any).weight}kg` : '-',
      '적재중량': (p as any).capacity ? `${(p as any).capacity}kg` : '-',
      '장비크기': (p as any).dimensions || '-',
      '주행속도': (p as any).speed || '-',
      '제조사': p.manufacturer || '-',
      '사용 여부': (p as any).isActive !== false ? '사용' : '미사용',
      '등록일': p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '-'
    }));""")
print("Products patched")
