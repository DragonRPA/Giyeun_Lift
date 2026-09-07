import os
import re

filepath = r"d:\01.AntiGravity\Giyuen_Lift\src\pages\asset_history.tsx"
with open(filepath, 'r', encoding='utf-8') as f: content = f.read()

old_mapping = r"const excelData = filteredTabLogs\.map\(\(log, idx\) => \{[\s\S]*?return \{[\s\S]*?\};\s*\}\s*\}\);"
new_mapping = """const excelData = filteredTabLogs.map((log, idx) => {
      if (activeTab === 'OUTBOUND') {
        const o = log as AssetInOutLog;
        return {
          '번호': idx + 1,
          '출고일자': o.eventDate,
          '관리번호': o.assetNo,
          '모델명': o.modelName,
          '고객사 (거래처)': o.customerName || '-',
          '현장명': o.siteName || '-',
          '비고 / 메모': o.memo || '-'
        };
      } else if (activeTab === 'INBOUND') {
        const i = log as AssetInOutLog;
        return {
          '번호': idx + 1,
          '입고 고유번호': i.id,
          '입고일자': i.eventDate,
          '관리번호': i.assetNo,
          '모델명': i.modelName,
          '고객사 (거래처)': i.customerName || '-',
          '현장명': i.siteName || '-',
          '정비 점수': i.maintenanceScore ? `${i.maintenanceScore}점` : '-',
          '불량 증상 상세 (하위번호/사진)': i.memo || '-',
          '작업 (휴먼에러 복원)': i.type
        };
      } else {
        const r = log as unknown as Repair;
        return {
          '번호': idx + 1,
          '정비일자': r.completionDate || r.requestDate || '-',
          '관리번호': r.assetNo,
          '모델명': r.modelName,
          '정비 구분': r.repairType || '-',
          '정비 내역 및 사유': r.description || '-',
          '정비 비용': r.totalCost ? `${r.totalCost.toLocaleString()}원` : '0원'
        };
      }
    });"""

new_content = re.sub(old_mapping, new_mapping, content)
with open(filepath, 'w', encoding='utf-8') as f: f.write(new_content)
print("asset_history fixed")
