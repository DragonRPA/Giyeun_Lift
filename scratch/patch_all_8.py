import os
import re

files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"
def patch_file(filename, old_block_regex, new_block):
    filepath = os.path.join(files_dir, filename)
    if not os.path.exists(filepath): return
    with open(filepath, 'r', encoding='utf-8') as f: content = f.read()
    new_content = re.sub(old_block_regex, new_block, content, flags=re.MULTILINE)
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f: f.write(new_content)
        print(f"Patched {filename}")
    else:
        print(f"No changes {filename}")

# 1. asset_history.tsx
patch_file("asset_history.tsx",
r"const excelData = filteredTabLogs\.map\(\(log, idx\) => \(\{[\s\S]*?\}\)\);",
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
    });""")

# 2. Billings.tsx
patch_file("Billings.tsx",
r"const excelData = filteredBillings\.map\(\(b, idx\) => \{[\s\S]*?return \{[\s\S]*?\};\s*\}\);",
"""const excelData = filteredBillings.map((b, idx) => {
        const supply = b.totalAmount || 0;
        const grand = supply + Math.round(supply * 0.1);
        const isPaid = b.status === 'PAID';
        const actualPaid = isPaid ? grand : (b.paidAmount || 0);
        const unpaid = isPaid ? 0 : Math.max(0, grand - actualPaid);
        return {
          '청구월': b.billingYm,
          '고객사': getCustName(b.customerId),
          '공급가액': `${supply.toLocaleString()}원`,
          '청구합계(VAT포함)': `${grand.toLocaleString()}원`,
          '미납액': `${unpaid.toLocaleString()}원`,
          '상태': b.status === 'UNPAID'     ? '미발행' :
                  b.status === 'REQUESTED' ? '발송완료(미납)' :
                  b.status === 'REJECTED'  ? '이의제기(취소)' :
                  b.status === 'PAID'      ? '완납' :
                  b.status === 'PARTIAL'   ? '일부수납' : b.status
        };
    });""")

# 3. Deliveries.tsx
patch_file("Deliveries.tsx",
r"return \{[\s\S]*?'No': idx \+ 1,[\s\S]*?\};\s*\}\);",
"""return {
          '번호': idx + 1,
          '구분': d.type === 'OUTBOUND' ? '출고' : '회수',
          '계약번호 / 의뢰메모': `${getContractNo(d.contractId)} / ${d.memo}`,
          '고객사명 / 회수지': displayName,
          '운송 차량': vehiclesSummary,
          '담당기사/연락처': d.driverContact || '-',
          '운송비(임시)': d.deliveryCost ? `${d.deliveryCost.toLocaleString()}원` : '0원',
          '운송비(확정)': d.deliveryCostConfirmed ? `${d.deliveryCostConfirmed.toLocaleString()}원` : '0원',
          '배송상태': d.status === 'REQUESTED' ? '의뢰됨' :
                     d.status === 'DISPATCHED' ? '배차완료' : '완료',
          '용역 정산': d.isCostSettled ? '정산완료' : '미정산'
        };
      });""")

# 4. Products.tsx
patch_file("Products.tsx",
r"const excelData = filteredProducts\.map\(\(p, idx\) => \(\{[\s\S]*?\}\)\);",
"""const excelData = filteredProducts.map((p, idx) => {
      const typeStr = p.powerType === 'BATTERY' ? '배터리' : p.powerType === 'ENGINE' ? '엔진' : '하이브리드';
      return {
        'NO': idx + 1,
        '모델명': p.modelName,
        '피트 (FEET)': p.feet ? `${p.feet}ft` : '-',
        '자산현황 (당사/임차)': `${p.totalAssetCount || 0}대 (${p.ownedAssetCount || 0} / ${p.leasedAssetCount || 0})`,
        '클라우드 문서 (R2)': p.documentationUrl ? '문서있음' : '없음',
        '동력': typeStr,
        '작업높이': p.workHeight ? `${p.workHeight}m` : '-',
        '발판높이': p.platformHeight ? `${p.platformHeight}m` : '-',
        '장비중량': p.equipmentWeight ? `${p.equipmentWeight}kg` : '-',
        '적재중량': p.loadCapacity ? `${p.loadCapacity}kg` : '-',
        '장비크기': (p.sizeL || p.sizeW || p.sizeH) ? `${p.sizeL || 0}x${p.sizeW || 0}x${p.sizeH || 0} (m)` : '-',
        '주행속도': p.speed ? `${p.speed}km/h` : '-',
        '제조사': p.manufacturer || '-',
        '사용 여부': p.isActive ? '사용' : '미사용',
        '등록일': p.createdAt ? p.createdAt.slice(0, 10) : '-'
      };
    });""")

# 5. Repairs.tsx
patch_file("Repairs.tsx",
r"const excelData = filteredRepairs\.map\(\(r, idx\) => \{[\s\S]*?return \{[\s\S]*?\};\s*\}\);",
"""const excelData = filteredRepairs.map((r, idx) => {
        const cost = calculateRepairCost(r);
        return {
          '정비구분': r.repairType,
          '정비장비': r.assetNo ? `${r.modelName} [${r.assetNo}]` : (r.modelName || '-'),
          '고객사 / 현장': `${getCustomerName(r.customerId)} / ${getSiteName(r.siteId)}`,
          '방문/의뢰일': r.requestDate || '-',
          '완료일': r.completionDate || '-',
          '정비 내용': r.description || '-',
          '총 수리비': `${cost.toLocaleString()}원`,
          '청구 구분': r.isBillable ? (r.billingStatus === 'BILLED' ? '청구완료' : '청구예정(미발행)') : '무상/내부',
          '담당 정비사': getMechanicName(r.mechanicId),
          '상태': r.status === 'REQUESTED' ? '접수/요청' :
                 r.status === 'IN_PROGRESS' ? '진행중' :
                 r.status === 'COMPLETED' ? '완료' : '취소'
        };
    });""")

# 6. Vendors.tsx
patch_file("Vendors.tsx",
r"const data = filtered\.map\(v => \{[\s\S]*?return \{[\s\S]*?\};\s*\}\);",
"""const data = filtered.map(v => {
        const vTypes = getVendorTypes(v);
        const typeLabels = vTypes.map(t => VENDOR_TYPE_CONFIG[t]?.label || t).join(', ');
        return {
          '상호명 (매입처명)': v.name,
          '매입/거래 속성 (다중)': typeLabels,
          '사업자등록번호': v.bizRegNo || '-',
          '대표자명': v.representative || '-',
          '담당자': v.contactName || '-',
          '연락처': v.contact || '-',
          '주소': v.address || '-',
          '이메일': v.email || '-',
          '상태': v.isActive ? '정상(활성)' : '비활성',
        };
    });""")
