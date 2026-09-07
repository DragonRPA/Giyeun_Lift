import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("rent_assets.tsx",
  """    const excelData = currentData.map((l, idx) => ({
      'No': idx + 1,
      '임차처': vendors.find(v => v.id === l.vendorId)?.name || '-',
      '계약 상태': l.status === 'ACTIVE' ? '진행중' : l.status === 'TERMINATED' ? '종료됨' : '대기중',
      '시작일': l.startDate,
      '종료일': l.endDate || '미정',
      '월 임차료': l.monthlyFee,
      '자산 매핑 현황': `${l.mappedCount || 0} / ${l.quantity}`
    }));""",
  """    const excelData = currentData.map((l, idx) => {
      const v = vendors.find(v => v.id === l.vendorId);
      const isReconcile = activeTab === 'RECONCILE';
      if (isReconcile) {
        const vendorBill = (l as any).vendorBillingAmount || 0;
        const internalRent = (l as any).internalRentAmount || 0;
        const diff = vendorBill - internalRent;
        const statusMsg = diff === 0 ? '정상 일치' : diff > 0 ? '과다 청구 의심' : '과소 청구 의심';
        return {
          'No': idx + 1,
          '관리번호 / 시리얼': (l as any).assetNo || '-',
          '모델명': (l as any).modelName || '-',
          '임차처 청구 기간': (l as any).vendorPeriod || '-',
          '자사 등록/반납 기간': (l as any).internalPeriod || '-',
          '임차처 청구금액': vendorBill,
          '자사 약정금액': internalRent,
          '오차 차액': diff,
          '대사 검증 소견': statusMsg
        };
      } else {
        return {
          'No': idx + 1,
          '임차처': v ? v.name : '-',
          '계약 상태': l.status === 'ACTIVE' ? '진행중' : l.status === 'TERMINATED' ? '종료됨' : '대기중',
          '시작일': l.startDate,
          '종료일': l.endDate || '미정',
          '월 임차료': l.monthlyFee,
          '자산 매핑 현황': `${(l as any).mappedCount || 0} / ${l.quantity}`
        };
      }
    });""")
print("rent_assets patched")
