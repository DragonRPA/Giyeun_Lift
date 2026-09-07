import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Consumables.tsx",
  """    const excelData = filteredConsumables.map((c, idx) => ({
      'No': idx + 1,
      '재고 품목명': c.name,
      '본사(중앙) 재고': c.stockMain,
      '차량 이동 재고': c.stockVehicles,
      '회사 총재고': c.stockMain + c.stockVehicles,
      '단위': c.unit,
      '단가': c.unitPrice,
      '총 재고 금액': (c.stockMain + c.stockVehicles) * c.unitPrice,
      '최근 구입일': c.lastPurchaseDate || '-',
      '상태': c.stockMain <= c.alertThreshold ? '재고긴급' : '적정',
      '비고': c.memo || '-'
    }));""",
  """    const excelData = filteredConsumables.map((c, idx) => {
      const isUrgent = c.stockMain <= ((c as any).alertThreshold || 0);
      return {
        'No': idx + 1,
        '재고 품목명': c.name,
        '본사 중앙창고': c.stockMain,
        '차량 이동창고': c.stockVehicles,
        '회사 총재고': c.stockMain + c.stockVehicles,
        '단위': c.unit,
        '단가': c.unitPrice,
        '본사 재고금액': c.stockMain * c.unitPrice,
        '최근 구입일': c.lastPurchaseDate || '-',
        '상태': isUrgent ? '재고긴급' : '적정',
        '비고': c.memo || '-'
      };
    });""")
print("Consumables patched")
