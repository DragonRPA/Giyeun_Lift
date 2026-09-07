import os
import re

files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def patch_file(filename, old_block_regex, new_block):
    filepath = os.path.join(files_dir, filename)
    if not os.path.exists(filepath):
        print(f"File not found: {filename}")
        return False
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    new_content = re.sub(old_block_regex, new_block, content, flags=re.MULTILINE)
    
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Successfully patched {filename}")
        
        # Verify syntax
        import subprocess
        res = subprocess.run(["npx", "tsc", "--noEmit", filepath], shell=True, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"Syntax error in {filename}: {res.stdout[:500]}")
        return True
    else:
        print(f"No changes made to {filename}")
        return False

# 1. Assets.tsx
patch_file("Assets.tsx", 
    r"const data = filtered\.map\(a => \{[\s\S]*?return \{[\s\S]*?\};\s*\}\);",
    """const data = filtered.map(a => {
      return {
        'No': filtered.indexOf(a) + 1,
        '관리번호': a.assetNo || '-',
        '모델명': a.modelName || '-',
        '제조사': a.manufacturer || '-',
        '제조번호(S/N)': a.serialNo || '-',
        '제조년도': a.manufactureYear || '-',
        '소유': a.ownerType === 'OWNED' ? '당사' : a.ownerType === 'LEASED' ? '임차' : a.ownerType === 'SUBLEASE' ? '재임대' : a.ownerType,
        '상태': statusLabel(a.status),
        '현재 고객사': getCustomerName(a.currentCustomerId),
        '현재 현장': getSiteName(a.currentSiteId),
        '계약번호': a.contractNumber || '-',
        '계약시작일': a.contractStartDate || '-',
        '계약종료일': a.contractEndDate || '-',
        '청구마감일': a.billingCloseDay ? \`\${a.billingCloseDay}일\` : '-',
        '월대여료': a.monthlyRentalFee || 0,
        '일대여료': a.dailyRentalFee || 0,
        '취득일자': a.acquisitionDate ? a.acquisitionDate.slice(0, 10) : '-',
        '취득금액': a.acquisitionPrice || 0,
        '구입처': a.purchaseSource || '-',
        '상각개월수': a.depreciationMonths || 0,
        '잔존가치율': a.residualValueRate || 0,
        '장부가치': a.bookValue ?? (a.acquisitionPrice || 0),
        '기여액(누적)': a.cumRentalFee || 0,
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
    });"""
)

# 2. BankMatching.tsx
patch_file("BankMatching.tsx",
    r"const excelData = filteredTransactions\.map\(\(t, idx\) => \{[\s\S]*?return \{[\s\S]*?\};\s*\}\);",
    """const excelData = filteredTransactions.map((t, idx) => {
      const infoParts = [];
      if (t.matchedBillingId) {
        if (t.matchedCustomerName) infoParts.push(t.matchedCustomerName);
        if (t.matchedSiteName) infoParts.push(t.matchedSiteName);
      }
      const remBal = getDepositBalance(t.id);
      const isFull = t.depositAmount > 0 && remBal <= 0;
      const isPartial = t.depositAmount > 0 && remBal > 0 && remBal < t.depositAmount;

      return {
        'No': idx + 1,
        '수납/지급 대사': isFull ? '수납완료' : isPartial ? '부분수납' : t.matchedBillingId ? '지급완료' : '미확인',
        '은행명': t.bankName || '미지정',
        '거래일시': t.transactionDate,
        '적요': t.summary || '-',
        '기재내용': t.counterparty || t.senderName || '-',
        '입금액 대비 수납결과': t.depositAmount > 0 ? `입금 ${t.depositAmount.toLocaleString()}원 (잔여 ${remBal.toLocaleString()}원)` : '-',
        '출금액 대비 정산결과': t.withdrawAmount > 0 ? `출금 ${t.withdrawAmount.toLocaleString()}원` : '-',
        '거래후 잔액': t.balance ? `${t.balance.toLocaleString()}원` : '-',
        '취급/거래점': t.branchName || '-',
        '매칭 정보': infoParts.length > 0 ? infoParts.join(', ') : '-',
        '메모': t.memo || '-'
      };
    });"""
)

# 3. Customers.tsx
patch_file("Customers.tsx",
    r"const excelData = filteredCustomers\.map\(\(c, idx\) => \(\{[\s\S]*?\}\)\);",
    """const excelData = filteredCustomers.map((c, idx) => ({
      'No': idx + 1,
      '고객명': c.name,
      '대표자': c.ceoName || '-',
      '업태': c.businessType || '-',
      '종목': c.businessItem || '-',
      '대표 연락처': c.phone || '-',
      '대표 이메일': c.email || '-',
      '사업자등록번호': c.businessRegistrationNumber || '-',
      '본사 주소': c.address || '-',
      '영업 상태': c.salesStatus || '-',
      '사용 여부': c.isActive === false ? '비활성' : '활성'
    }));"""
)

# 4. Consumables.tsx
patch_file("Consumables.tsx",
    r"const excelData = filteredStats\.map\(\(stat, idx\) => \(\{[\s\S]*?\}\)\);",
    """const excelData = filteredStats.map((stat, idx) => {
      const isEmergency = stat.totalStock < 10;
      return {
        'No': idx + 1,
        '자재 품목명': stat.itemName,
        '본사 중앙재고': stat.hqStock,
        '차량 이동재고': stat.truckStock,
        '전사 총재고': stat.totalStock,
        '단위': stat.unit || '개',
        '단가': `${(stat.unitPrice || 0).toLocaleString()}원`,
        '본사 평가금액': `${((stat.hqStock || 0) * (stat.unitPrice || 0)).toLocaleString()}원`,
        '최근 구입처': stat.lastVendorName || '-',
        '상태': isEmergency ? '재고긴급' : '적정'
      };
    });"""
)
