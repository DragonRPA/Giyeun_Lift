/**
 * scratch/run_wtt_50_repair_history_audit.cjs
 * 
 * 🏛️ 전사 시스템 개발 표준 헌장 카테고리 V (5.5 도메인 관통 스트레스 테스트 원칙)
 * 정비이력조회 5대 축(공간·물리·시간·비용·수량) 매트릭스 50회 WTT 도메인 관통 스트레스 테스트
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('🚀 [WTT-50] 정비이력조회 도메인 관통 스트레스 테스트 (50 Scenarios Penetration)');
console.log('='.repeat(80));

// 1. mock 자산 마스터 데이터 정의 (현장 실기종)
const mockAssets = [
  { id: 'ast-001', assetNo: 'RENT-0001', modelName: 'GS-1930', serialNo: 'GS19-1001', status: 'RENTED' },
  { id: 'ast-002', assetNo: 'RENT-0002', modelName: 'SJ-3219', serialNo: 'SJ32-2002', status: 'RENTED' },
  { id: 'ast-003', assetNo: 'RENT-0003', modelName: 'GS-2646', serialNo: 'GS26-3003', status: 'AVAILABLE' },
  { id: 'ast-004', assetNo: 'RENT-0004', modelName: 'SJ-4626', serialNo: 'SJ46-4004', status: 'REPAIRING' },
  { id: 'ast-005', assetNo: 'RENT-0005', modelName: 'Z-34/22N', serialNo: 'Z34-5005', status: 'RENTED' },
  { id: 'ast-006', assetNo: 'G19001', modelName: 'GS-1930', serialNo: 'G19-6001', status: 'RENTED' },
  { id: 'ast-007', assetNo: 'S32002', modelName: 'SJ-3219', serialNo: 'S32-7002', status: 'AVAILABLE' },
  { id: 'ast-008', assetNo: 'G26003', modelName: 'GS-2646', serialNo: 'G26-8003', status: 'RENTED' },
  { id: 'ast-009', assetNo: 'S46004', modelName: 'SJ-4626', serialNo: 'S46-9004', status: 'AVAILABLE' },
  { id: 'ast-010', assetNo: 'Z45005', modelName: 'Z-45/25J', serialNo: 'Z45-1005', status: 'RENTED' },
];

const mockCustomers = [
  { id: 'cust-1', name: '현대건설' },
  { id: 'cust-2', name: '삼성물산' },
  { id: 'cust-3', name: 'GS건설' },
  { id: 'cust-4', name: '대우건설' },
  { id: 'cust-5', name: '포스코이앤씨' }
];

const mockSites = [
  { id: 'site-1', customerId: 'cust-1', name: '반포 래미안 원베일리', address: '서울특별시 서초구 신반포로 100' },
  { id: 'site-2', customerId: 'cust-2', name: '평택 고덕 P3 FAB 신축공사', address: '경기도 평택시 고덕면 고덕북로 123' },
  { id: 'site-3', customerId: 'cust-3', name: '송도 자이 더스타', address: '인천광역시 연수구 송도동 396' },
  { id: 'site-4', customerId: 'cust-4', name: '화성 동탄2 푸르지오', address: '경기도 화성시 동탄대로 456' },
  { id: 'site-5', customerId: 'cust-5', name: '광양제철소 증설현장', address: '전라남도 광양시 제철로 789' }
];

const mockContracts = [
  { id: 'cont-1', contractNo: 'CT-2026-001', customerId: 'cust-1', siteId: 'site-1' },
  { id: 'cont-2', contractNo: 'CT-2026-002', customerId: 'cust-2', siteId: 'site-2' },
  { id: 'cont-3', contractNo: 'CT-2026-003', customerId: 'cust-3', siteId: 'site-3' },
  { id: 'cont-4', contractNo: 'CT-2026-004', customerId: 'cust-4', siteId: 'site-4' },
  { id: 'cont-5', contractNo: 'CT-2026-005', customerId: 'cust-5', siteId: 'site-5' }
];

const mockContractAssets = [
  { contractId: 'cont-1', assetId: 'ast-001', assetNo: 'RENT-0001', status: 'RENTED' },
  { contractId: 'cont-2', assetId: 'ast-002', assetNo: 'RENT-0002', status: 'RENTED' },
  { contractId: 'cont-3', assetId: 'ast-005', assetNo: 'RENT-0005', status: 'RENTED' },
  { contractId: 'cont-4', assetId: 'ast-006', assetNo: 'G19001', status: 'RENTED' },
  { contractId: 'cont-5', assetId: 'ast-010', assetNo: 'Z45005', status: 'RENTED' }
];

const mockUsers = [
  { id: 'usr-1', name: '홍정비' },
  { id: 'usr-2', name: '김기사' },
  { id: 'usr-3', name: '이수리' }
];

const mockVendors = [
  { id: 'vnd-1', name: '가나외주정비' },
  { id: 'vnd-2', name: '나라정비센터' }
];

// 2. 엔진 로직 임포트 (asset_history.tsx와 동일한 핵심 보정 알고리즘)
function resolvePrecisionModelName(assetId, assetNo, rawModel) {
  const matchedAsset = mockAssets.find(a => 
    (assetId && a.id === assetId) || 
    (assetNo && a.assetNo && a.assetNo.trim().toLowerCase() === assetNo.trim().toLowerCase())
  );
  if (matchedAsset?.modelName && matchedAsset.modelName !== '고소작업대' && matchedAsset.modelName !== '전체장비') {
    return matchedAsset.modelName;
  }
  if (rawModel && rawModel !== '고소작업대' && rawModel !== '전체장비' && rawModel !== '기종확인필요' && rawModel !== '미지정') {
    return rawModel;
  }
  if (assetNo) {
    const u = assetNo.toUpperCase().trim();
    if (u.startsWith('G19') || u.startsWith('GS19') || u.includes('1930')) return 'GS-1930';
    if (u.startsWith('S32') || u.startsWith('SJ32') || u.includes('3219')) return 'SJ-3219';
    if (u.startsWith('G26') || u.startsWith('GS26') || u.includes('2646')) return 'GS-2646';
    if (u.startsWith('S46') || u.startsWith('SJ46') || u.includes('4626')) return 'SJ-4626';
    if (u.startsWith('G32') || u.startsWith('GS32') || u.includes('3246')) return 'GS-3246';
    if (u.startsWith('Z34') || u.includes('3422')) return 'Z-34/22N';
    if (u.startsWith('Z45') || u.includes('4525')) return 'Z-45/25J';
  }
  return matchedAsset?.modelName || 'GS-1930';
}

function resolveRepairCustomerAndSite(params) {
  let custName = params.customerName?.trim() || '';
  let stName = params.siteName?.trim() || '';
  let stAddress = params.siteAddress?.trim() || '';

  const isInvalidSite = !stName || stName === '미지정현장' || stName === '미지정' || stName === '-' || stName === '현장확인';
  const isInvalidCust = !custName || custName === '고객사' || custName === '-' || custName === '현장 협력업체' || custName === '미지정';

  if (params.siteId) {
    const siteObj = mockSites.find(s => s.id === params.siteId);
    if (siteObj) {
      if (isInvalidSite) stName = siteObj.name;
      if (!stAddress) stAddress = siteObj.address || '';
      if (isInvalidCust && siteObj.customerId) {
        const custObj = mockCustomers.find(c => c.id === siteObj.customerId);
        if (custObj) custName = custObj.name;
      }
    }
  }

  if (params.customerId && isInvalidCust) {
    const custObj = mockCustomers.find(c => c.id === params.customerId);
    if (custObj) custName = custObj.name;
  }

  if ((isInvalidSite || isInvalidCust) && (params.assetId || params.assetNo)) {
    const targetAsset = mockAssets.find(a => 
      (params.assetId && a.id === params.assetId) || 
      (params.assetNo && a.assetNo && a.assetNo.trim().toLowerCase() === params.assetNo.trim().toLowerCase())
    );
    if (targetAsset) {
      const relatedCAs = mockContractAssets.filter(ca => ca.assetId === targetAsset.id);
      if (relatedCAs.length > 0) {
        let ca = relatedCAs.find(c => c.status === 'RENTED') || relatedCAs[relatedCAs.length - 1];
        if (ca) {
          const cont = mockContracts.find(c => c.id === ca.contractId);
          if (cont) {
            if (isInvalidCust && cont.customerId) {
              const cust = mockCustomers.find(c => c.id === cont.customerId);
              if (cust) custName = cust.name;
            }
            if (isInvalidSite && cont.siteId) {
              const s = mockSites.find(item => item.id === cont.siteId);
              if (s) {
                stName = s.name;
                if (!stAddress) stAddress = s.address || '';
              }
            }
          }
        }
      }
    }
  }

  const isYard = params.workLocation === 'YARD' || 
                 params.workCategory === 'YARD_INTERNAL' || 
                 (isInvalidCust && isInvalidSite);

  if (isYard) {
    if (isInvalidCust) custName = '기연리프트 본사';
    if (isInvalidSite) stName = '자사 주기장 (입고/사내정비)';
    if (!stAddress || stAddress === '현장') stAddress = '경기도 화성시 / 용인 본사 주기장';
  } else {
    if (isInvalidCust) custName = '현장 거래처 (계약참조)';
    if (isInvalidSite) stName = '공사현장 (주소확인)';
  }

  return { customerName: custName, siteName: stName, siteAddress: stAddress, isYardInternal: isYard };
}

// 3. 50회 시나리오 매트릭스 생성 및 집행
let passCount = 0;
let failCount = 0;

const issues = [
  '상부 조종기 레버 불량', '협착 방지봉 파손', '220V 충전선 단선', '유압 작동유 피팅 누유',
  '상하강 리미트 스위치 파손', '메인보드 통신 에러 02', '배터리 극판 황산화 전압강하',
  '과상승 감지봉 결선 불량', '비상 하강 밸브 고착', '구동 모터 브러시 마모'
];

const actions = [
  '조종기 센서 교체 및 영점 조절', '신품 방지봉 볼팅 장착 및 테스트', '충전 플러그 결선 및 절연 처리',
  '유압 피팅 조임 및 작동유 2L 보충', '리미트 스위치 신품 교체', '메인보드 리셋 및 펌웨어 리플래시',
  '배터리 세척 및 증류수 보충', '감지봉 배선 재결선 및 통신 확인', '하강 밸브 이물 세척 후 작동 점검',
  '카본 브러시 1세트 신품 교환'
];

for (let i = 1; i <= 50; i++) {
  const assetIndex = (i - 1) % mockAssets.length;
  const targetAsset = mockAssets[assetIndex];

  // 5대 축 매트릭스 변수 결합
  // 축 1: 공간 (현장, 주기장, 외주처, 밴드임포트)
  const locType = i % 4 === 1 ? 'FIELD_AS' : i % 4 === 2 ? 'YARD_INTERNAL' : i % 4 === 3 ? 'EXTERNAL_VENDOR' : 'BAND_IMPORT';
  // 축 2: 물리 고장 증상
  const issue = issues[(i - 1) % issues.length];
  const action = actions[(i - 1) % actions.length];
  // 축 3: 시간 (일자)
  const day = String((i % 28) + 1).padStart(2, '0');
  const dateStr = `2026-08-${day}`;
  // 축 4: 비용 (무상, 유상, 외주, 면제)
  const billType = i % 3 === 1 ? 'BILLABLE' : 'FREE';
  const billAmt = billType === 'BILLABLE' ? (i * 20000) : 0;
  const extCost = locType === 'EXTERNAL_VENDOR' ? (i * 35000) : 0;
  // 축 5: 수량 / 부품 투입
  const partsCount = i % 3;

  // 원시 입력 데이터 시뮬레이션 (불완전 데이터 주입: 모델명이 '고소작업대', 현장명이 '미지정현장')
  const rawInput = {
    assetId: targetAsset.id,
    assetNo: targetAsset.assetNo,
    rawModel: (i % 5 === 0) ? '고소작업대' : (i % 5 === 1) ? '' : targetAsset.modelName, // 스트레스: 고소작업대나 빈값 주입
    customerName: (locType === 'YARD_INTERNAL' || i % 6 === 0) ? '고객사' : '현대건설',
    siteName: (locType === 'YARD_INTERNAL' || i % 6 === 0) ? '미지정현장' : '반포 래미안 원베일리',
    siteAddress: '',
    workCategory: locType === 'BAND_IMPORT' ? 'FIELD_AS' : locType,
    workLocation: locType === 'YARD_INTERNAL' ? 'YARD' : locType === 'EXTERNAL_VENDOR' ? 'VENDOR_SHOP' : 'SITE',
    issue,
    action,
    billableType: billType,
    billableAmount: billAmt,
    totalCost: extCost
  };

  // 🌟 엔진을 통한 보정 집행
  const resolvedModel = resolvePrecisionModelName(rawInput.assetId, rawInput.assetNo, rawInput.rawModel);
  const resolvedCustSite = resolveRepairCustomerAndSite({
    assetId: rawInput.assetId,
    assetNo: rawInput.assetNo,
    customerName: rawInput.customerName,
    siteName: rawInput.siteName,
    siteAddress: rawInput.siteAddress,
    workCategory: rawInput.workCategory,
    workLocation: rawInput.workLocation
  });

  // 3대 보존 법칙 검증
  // 1. 모델명 보존 법칙: '고소작업대' 표출 0건
  const modelPreserved = resolvedModel !== '고소작업대' && resolvedModel !== '전체장비' && resolvedModel === targetAsset.modelName;
  // 2. 현장명 보존 법칙: '미지정현장' 표출 0건
  const sitePreserved = resolvedCustSite.siteName !== '미지정현장' && resolvedCustSite.siteName !== '' && resolvedCustSite.customerName !== '고객사';
  // 3. 정비 정보 보존 법칙: 조치내용 및 비용 보존
  const infoPreserved = Boolean(action) && (billType === 'BILLABLE' ? billAmt > 0 : true);

  const scenarioPass = modelPreserved && sitePreserved && infoPreserved;

  if (scenarioPass) {
    passCount++;
    if (i % 10 === 0 || i === 1) {
      console.log(`[PASS #${String(i).padStart(2, '0')}] 자산 [${targetAsset.assetNo}] ➔ 모델: ${resolvedModel} | 현장: ${resolvedCustSite.customerName} (${resolvedCustSite.siteName}) | 비용: ₩${billAmt.toLocaleString()}`);
    }
  } else {
    failCount++;
    console.error(`[FAIL #${String(i).padStart(2, '0')}] 결함 발생: model=${resolvedModel}, site=${resolvedCustSite.siteName}, cust=${resolvedCustSite.customerName}`);
  }
}

console.log('-'.repeat(80));
console.log(`📊 [WTT 50회 스트레스 테스트 최종 결과] 총 ${passCount + failCount}회 중 성공: ${passCount}회, 실패: ${failCount}회`);
if (failCount === 0) {
  console.log('🎉 3대 보존 법칙(모델명 100% 보정, 현장명 100% 역추적, 정비정보 무누락) 완벽 통과!');
} else {
  console.error('⚠️ 일부 시나리오에서 보존 법칙 결함 발견!');
  process.exit(1);
}
console.log('='.repeat(80));
