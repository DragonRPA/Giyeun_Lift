import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Assets.tsx",
  """const data = filtered.map(a => {
      const contract = contracts.find(c => c.id === a.contractId);
      const ca = contractAssets.find(x => x.contractId === a.contractId && x.assetId === a.id);
      const lease = externalLeases.find(l => l.id === a.leaseId);
      return {
        'No': filtered.indexOf(a) + 1,
        '관리번호': a.assetNo,
        '모델명': a.modelName,
        '제조사': a.manufacturer || '-',
        '제조번호(S/N)': a.serialNo || '-',
        '제조년도': a.manufactureYear || '-',
        '소유': a.ownerType === 'OWNED' ? '당사' : '임차',
        '상태': statusLabel(a.status),
        '현재 고객사': getCustomerName(a.currentCustomerId),
        '현재 현장': getSiteName(a.currentSiteId),
        '계약번호': contract ? contract.contractNo : '-',
        '계약시작일': contract ? contract.startDate : '-',
        '계약종료일': contract ? (contract.endDate || '-') : '-',
        '청구마감일': contract ? `${contract.billingDay}일` : '-',
        '월대여료': ca ? ca.monthlyFee : 0,
        '일대여료': ca ? ca.dailyFee : 0,
        '취득일자': a.acquisitionDate ? a.acquisitionDate.slice(0, 10) : '-',
        '취득금액': a.acquisitionPrice || 0,
        '구입처': a.supplier || '-',
        '감가상각개월수': a.depreciationMonths || 0,
        '감가상각누계액': calculateAssetDepreciation(a).accumDepreciation || 0,
        '잔존가치율': a.residualValueRate != null ? `${a.residualValueRate}%` : '-',
        '장부가치': a.bookValue ?? (a.acquisitionPrice || 0),
        '누적렌탈수익': a.cumRentalFee || 0,
        '누적수리비': a.cumRepairCost || 0,
        '임차처': lease ? getVendorName(lease.vendorId) : '-',
        '임차개시일': lease ? lease.startDate : '-',
        '임차만료일': lease ? (lease.endDate || '-') : '-',
        '월임차료': lease ? lease.monthlyFee : 0,
        '일임차료': lease ? lease.dailyFee : 0,
        '실제반납일': lease ? (lease.actualReturnDate || '-') : '-',
        '매각일자': a.disposalDate || '-',
        '매각가격': a.disposalPrice || 0,
        '매각처': a.buyer || '-',
        '정비점수': a.maintenanceScore || 0,
        '비고1': a.memo1 || '-',
        '비고2': a.memo2 || '-'
      };
    });""",
  """const data = filtered.map(a => {
      const ci = getAssetContractInfo(a.id);
      return {
        'No': filtered.indexOf(a) + 1,
        '관리번호': a.assetNo || '-',
        '모델명': a.modelName || '-',
        '제조사': a.manufacturer || '-',
        '제조번호(S/N)': a.serialNo || '-',
        '제조년도': a.manufactureYear || '-',
        '소유': a.ownerType === 'OWNED' ? '당사' : '임차',
        '상태': statusLabel(a.status),
        '현재 고객사': getCustomerName(a.currentCustomerId),
        '현재 현장': getSiteName(a.currentSiteId),
        '계약번호': ci ? ci.contractNo : '-',
        '계약시작일': a.contractStart ? a.contractStart.slice(0, 10) : '-',
        '계약종료일': a.contractEnd ? a.contractEnd.slice(0, 10) : '-',
        '청구마감일': a.billingDay ? `${a.billingDay}일` : '-',
        '월대여료': a.monthlyRentalFee || 0,
        '일대여료': a.dailyRentalFee || 0,
        '취득일자': a.acquisitionDate ? a.acquisitionDate.slice(0, 10) : '-',
        '취득금액': a.acquisitionPrice || 0,
        '구입처': a.supplier || '-',
        '감가상각개월수': a.depreciationMonths || 0,
        '감가상각누계액': calculateAssetDepreciation(a).accumDepreciation || 0,
        '잔존가치율': a.residualValueRate != null ? `${a.residualValueRate}%` : '-',
        '장부가치': a.bookValue ?? (a.acquisitionPrice || 0),
        '누적렌탈수익': a.cumRentalFee || 0,
        '누적수리비': a.cumRepairCost || 0,
        '임차처': a.renter || '-',
        '임차개시일': a.rentStart ? a.rentStart.slice(0, 10) : '-',
        '임차만료일': a.rentEnd ? a.rentEnd.slice(0, 10) : '-',
        '월임차료': a.monthlyRentFee || 0,
        '일임차료': a.dailyRentFee || 0,
        '실제반납일': a.actualRentReturnDate ? a.actualRentReturnDate.slice(0, 10) : '-',
        '매각일자': a.disposalDate ? a.disposalDate.slice(0, 10) : '-',
        '매각가격': a.disposalPrice || 0,
        '매각처': a.buyer || '-',
        '정비점수': a.maintenanceScore || 0,
        '비고1': a.memo1 || '-',
        '비고2': a.memo2 || '-'
      };
    });""")
print("Assets patched successfully.")
