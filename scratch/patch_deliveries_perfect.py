import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("Deliveries.tsx",
  """    const excelData = filteredDeliveries.map((d, idx) => ({
      'No': idx + 1,
      '의뢰일자': d.requestDate,
      '배차 구분': d.type === 'OUTBOUND' ? '출고' : d.type === 'INBOUND' ? '회수' : '교환',
      '고객사/현장': d.destination || '-',
      '운송차량': d.vehicleType || '-',
      '담당기사': d.driverName || '-',
      '운송비(임시)': d.estimatedCost,
      '운송비(확정)': d.actualCost || '-',
      '배송상태': d.status === 'PENDING' ? '대기중' : d.status === 'DISPATCHED' ? '배차완료' : '완료'
    }));""",
  """    const excelData = filteredDeliveries.map((d, idx) => {
      const typeLabel = d.type === 'OUTBOUND' ? '출고' : d.type === 'INBOUND' ? '회수' : d.type === 'EXCHANGE' ? '교환' : '이동';
      const c = getContract(d.contractId);
      const vehicleInfo = d.vehicles ? d.vehicles.map(v => `${v.vendorName} ${v.vehicleNumber} (${v.driverName})`).join(' / ') : '-';
      const driverContact = d.vehicles && d.vehicles.length > 0 ? d.vehicles.map(v => v.driverContact || '-').join(' / ') : '-';
      return {
        'No': idx + 1,
        '구분': typeLabel,
        '계약번호 / 의뢰메모': `${c ? c.contractNo : '-'} / ${d.memo || '-'}`,
        '고객사명 / 회수지': d.destination || '-',
        '운송 차량': vehicleInfo,
        '담당기사/연락처': driverContact,
        '운송비(임시)': d.estimatedCost ? `${d.estimatedCost.toLocaleString()}원` : '-',
        '운송비(확정)': d.actualCost ? `${d.actualCost.toLocaleString()}원` : '-',
        '배송상태': d.status === 'PENDING' ? '대기중' : d.status === 'DISPATCHED' ? '배차완료' : '완료',
        '용역 정산': (d as any).settlementStatus === 'COMPLETED' ? '정산완료' : '미정산'
      };
    });""")
print("Deliveries patched")
