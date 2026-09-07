import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

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
      const l = log as any;
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
print("asset_history patched")
