import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Contracts.tsx",
  """    const excelData = filteredContracts.map((c, idx) => ({
      'No': idx + 1,
      '계약번호': c.contractNo,
      '고객사명': getCustomerName(c.customerId),
      '현장명': getSiteName(c.siteId),
      '시작일': c.startDate,
      '종료일': c.endDate || '미정',
      '청구 건수': c.billingCount,
      '영업담당': c.salespersonId || '-',
      '상태': c.status === 'ACTIVE' ? '진행중' : c.status === 'COMPLETED' ? '종료됨' : '대기중'
    }));""",
  """    const excelData = filteredContracts.map((c, idx) => {
      const getDDay = (endDate: string) => {
        const end = new Date(endDate);
        end.setHours(0,0,0,0);
        const today = new Date();
        today.setHours(0,0,0,0);
        return Math.floor((end.getTime() - today.getTime()) / (1000*60*60*24));
      };
      const cAssets = contractAssets.filter(ca => ca.contractId === c.id);
      const totalMonthlyRent = cAssets.reduce((sum, a) => sum + (a.monthlyFee || 0), 0);
      return {
        'No': idx + 1,
        '계약번호': c.contractNo,
        '고객사명': getCustomerName(c.customerId),
        '현장명': getSiteName(c.siteId),
        '월 렌탈료': totalMonthlyRent,
        '계약 기간': `${c.startDate} ~ ${c.endDate || ''}`,
        '최근 청구 기간': '-',
        '청구 건수': c.billingCount,
        '만료 D-Day': c.endDate ? (() => { const d = getDDay(c.endDate); return d < 0 ? `D+${Math.abs(d)}` : `D-${d}`; })() : '-',
        '청구 마감일': c.billingDay ? `매월 ${c.billingDay}일` : '-',
        '영업담당': c.salespersonId || '-',
        '상태': c.status === 'ACTIVE' ? '진행중' : c.status === 'COMPLETED' ? '종료됨' : '대기중'
      };
    });""")
print("Contracts patched")
