import os
import re

filepath = r"d:\01.AntiGravity\Giyuen_Lift\src\pages\Assets.tsx"
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old_mapping = r"const data = filtered\.map\(a => \{[\s\S]*?return \{[\s\S]*?\};\s*\}\);"
new_mapping = """const data = filtered.map(a => {
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
          '계약번호': a.contractNo || '-',
          '계약시작일': a.contractStart || '-',
          '계약종료일': a.contractEnd || '-',
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
          '임차개시일': a.rentStart || '-',
          '임차만료일': a.rentEnd || '-',
          '월임차료': a.monthlyRentFee || 0,
          '일임차료': a.dailyRentFee || 0,
          '실제반납일': a.actualRentReturnDate || '-',
          '매각일자': a.disposalDate || '-',
          '매각가격': a.disposalPrice || 0,
          '매각처': a.buyer || '-',
          '정비점수': a.maintenanceScore || 0,
          '비고1': a.memo1 || '-',
          '비고2': a.memo2 || '-'
        };
      });"""

new_content = re.sub(old_mapping, new_mapping, content)
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(new_content)
print("Assets.tsx fixed!")
