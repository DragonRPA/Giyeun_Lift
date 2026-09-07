import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Repairs.tsx",
  """    const excelData = filteredRepairs.map((r, idx) => ({
      'No': idx + 1,
      '정비일자(의뢰일)': r.requestDate,
      '관리번호': r.assetNo,
      '정비 구분': r.repairType,
      '고객사(현장)': r.destination || '-',
      '담당 기사': r.technicianName || '-',
      '정비 비용': r.totalCost || 0,
      '상태': r.status === 'COMPLETED' ? '완료' : r.status === 'IN_PROGRESS' ? '진행중' : '대기중'
    }));""",
  """    const excelData = filteredRepairs.map((r, idx) => {
      const parts = r.partsUsed || [];
      const partsTotal = parts.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0);
      const isOutsourced = r.repairType === 'OUTSOURCED';
      const labor = isOutsourced ? (r.laborCost || 0) : 0;
      const totalRepCost = partsTotal + labor;
      return {
        'No': idx + 1,
        '정비구분': r.repairType === 'INTERNAL' ? '자체정비' : '외주정비',
        '정비장비': r.assetNo,
        '고객사 / 현장': r.destination || '-',
        '방문/의뢰일': r.requestDate,
        '완료일': r.completionDate || '-',
        '정비 내용': r.description || '-',
        '총 수리비': totalRepCost,
        '청구 구분': r.billingType === 'CUSTOMER' ? '고객청구' : '자체손실',
        '담당 정비사': r.technicianName || '-',
        '상태': r.status === 'COMPLETED' ? '완료' : r.status === 'IN_PROGRESS' ? '진행중' : '대기중'
      };
    });""")
print("Repairs patched")
