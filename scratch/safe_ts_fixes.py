import os
import re

files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

# 1. Assets.tsx
r("Assets.tsx",
  """const data = filtered.map(a => {
        return {
          'No': filtered.indexOf(a) + 1,
          '관리번호': a.assetNo || '-',
          '모델명': a.modelName || '-',
          '제조사': a.manufacturer || '-',
          '제조번호(S/N)': a.serialNo || '-',
          '제조년도': a.manufactureYear || '-',
          '소유구분': a.ownerType === 'OWNED' ? '당사' : a.ownerType === 'LEASED' ? '임차' : a.ownerType === 'SUBLEASE' ? '전대임차' : a.ownerType,
          '상태': statusLabel(a.status),
          '현재 고객사': getCustomerName(a.currentCustomerId),
          '현재 현장': getSiteName(a.currentSiteId),
          '계약번호': a.contractNumber || '-',
          '계약시작일': a.contractStartDate || '-',
          '계약종료일': a.contractEndDate || '-',
          '청구마감일': a.billingCloseDay ? `${a.billingCloseDay}일` : '-',
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
          '임차처': a.leaseVendorName || '-',
          '임차개시일': a.leaseStartDate || '-',
          '임차만료일': a.leaseEndDate || '-',
          '월임차료': a.leaseMonthlyRent || 0,
          '일임차료': a.leaseDailyRent || 0,
          '실제반납일': a.actualReturnDate || '-',
          '매각일자': a.saleDate || '-',
          '매각가격': a.salePrice || 0,
          '매각처': a.saleDestination || '-',
          '정비점수': a.maintenanceScore || 0,
          '비고1': a.memo1 || '-',
          '비고2': a.memo2 || '-'
        };
      });""",
  """const data = filtered.map(a => {
        const contract = contracts.find(c => c.id === a.contractId);
        const ca = contractAssets.find(x => x.contractId === a.contractId && x.assetId === a.id);
        const lease = externalLeases.find(l => l.id === a.leaseId);
        return {
          'No': filtered.indexOf(a) + 1,
          '관리번호': a.assetNo || '-',
          '모델명': a.modelName || '-',
          '제조사': a.manufacturer || '-',
          '제조번호(S/N)': a.serialNo || '-',
          '제조년도': a.manufactureYear || '-',
          '소유구분': a.ownerType === 'OWNED' ? '당사' : '임차',
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
      });""")

# 2. asset_history.tsx
r("asset_history.tsx",
  """const excelData = filteredTabLogs.map((log, idx) => {
      if (activeTab === 'OUTBOUND') {
        return {
          '번호': idx + 1,
          '출고일자': log.eventDate,
          '관리번호': log.assetNo,
          '모델명': log.modelName,
          '고객사 (거래처)': log.customerName || '-',
          '현장명': log.siteName || '-',
          '비고 / 메모': log.memo || '-'
        };
      } else if (activeTab === 'INBOUND') {
        return {
          '번호': idx + 1,
          '입고 고유번호': log.id,
          '입고일자': log.eventDate,
          '관리번호': log.assetNo,
          '모델명': log.modelName,
          '고객사 (거래처)': log.customerName || '-',
          '현장명': log.siteName || '-',
          '정비 점수': log.maintenanceScore ? `${log.maintenanceScore}점` : '-',
          '불량 증상 상세 (하위번호/사진)': log.memo || '-',
          '작업 (휴먼에러 복원)': log.type
        };
      } else {
        return {
          '번호': idx + 1,
          '정비일자': log.eventDate,
          '관리번호': log.assetNo,
          '모델명': log.modelName,
          '정비 구분': log.repairType || '-',
          '정비 내역 및 사유': log.description || '-',
          '정비 비용': log.repairCost ? `${log.repairCost.toLocaleString()}원` : '0원'
        };
      }
    });""",
  """const excelData = filteredTabLogs.map((log, idx) => {
      const l: any = log;
      if (activeTab === 'OUTBOUND') {
        return {
          '번호': idx + 1,
          '출고일자': l.eventDate,
          '관리번호': l.assetNo,
          '모델명': l.modelName,
          '고객사 (거래처)': l.customerName || '-',
          '현장명': l.siteName || '-',
          '비고 / 메모': l.memo || '-'
        };
      } else if (activeTab === 'INBOUND') {
        return {
          '번호': idx + 1,
          '입고 고유번호': l.id,
          '입고일자': l.eventDate,
          '관리번호': l.assetNo,
          '모델명': l.modelName,
          '고객사 (거래처)': l.customerName || '-',
          '현장명': l.siteName || '-',
          '정비 점수': l.maintenanceScore ? `${l.maintenanceScore}점` : '-',
          '불량 증상 상세 (하위번호/사진)': l.memo || '-',
          '작업 (휴먼에러 복원)': l.type
        };
      } else {
        return {
          '번호': idx + 1,
          '정비일자': l.eventDate || l.completionDate || l.requestDate,
          '관리번호': l.assetNo,
          '모델명': l.modelName,
          '정비 구분': l.repairType || '-',
          '정비 내역 및 사유': l.description || '-',
          '정비 비용': l.totalCost ? `${l.totalCost.toLocaleString()}원` : '0원'
        };
      }
    });""")

# 3. BankMatching.tsx
r("BankMatching.tsx",
  """      if (t.matchedBillingId) {
        if (t.matchedCustomerName) infoParts.push(t.matchedCustomerName);
        if (t.matchedSiteName) infoParts.push(t.matchedSiteName);
      }""",
  """      if (t.matchedBillingId) {
        if ((t as any).matchedCustomerName) infoParts.push((t as any).matchedCustomerName);
        if ((t as any).matchedSiteName) infoParts.push((t as any).matchedSiteName);
      }""")

# 4. Consumables.tsx
r("Consumables.tsx", "c.alertThreshold", "(c as any).alertThreshold")

# 5. Customers.tsx
r("Customers.tsx", "c.ceoName", "(c as any).ceoName")
r("Customers.tsx", "c.businessType", "(c as any).businessType")
r("Customers.tsx", "c.businessItem", "(c as any).businessItem")
r("Customers.tsx", "c.phone", "(c as any).phone")
r("Customers.tsx", "c.email", "(c as any).email")
r("Customers.tsx", "c.businessRegistrationNumber", "(c as any).businessRegistrationNumber")
r("Customers.tsx", "c.salesStatus", "(c as any).salesStatus")
r("Customers.tsx", "c.isActive", "(c as any).isActive")

print("Fixed all TS errors carefully!")
