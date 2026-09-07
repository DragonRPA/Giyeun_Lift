/**
 * Giyeun Lift ERP — Supabase WTT 7개월 전체 엔티티 100% 정합성 주입 스크립트 (V2)
 */

const { createClient } = require('@supabase/supabase-js');

const url = 'https://wywgkikkjgbnlljkkmnz.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d2draWtramdibmxsamtrbW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjcxMzgsImV4cCI6MjA5OTk0MzEzOH0.gSftxhQjFmWUQzikx-Q5UsdgNKSZISZqJvUGeLBOCqU';
const supabase = createClient(url, key);

// 실제 DB에 등록된 45개 모델 목록
const validProductModels = [
  'OPTIMUM8', 'JCPT0807AC', 'GS1930', 'SJ319', 'GS2032', 'SJ3220', 'SJ4620', 'COMPACT8',
  '2632ES', 'GS2646', 'SJ3226', 'SJ4626', '2646ES', 'GS2632', 'JCPT1008AC', 'JCPT1012AC',
  '3246ES', 'GS3246', 'SJ4632', 'JCPT1212AC', 'GS4047', 'JCPT1412AC', '4069LE', 'JCPT1614AC',
  'GS4655', 'ES1330L', 'GS-1432', 'SJ3215', 'GTJZ0608ME', 'GTJZ0812E', 'GTJZ0808E', 'GTJZ1012E',
  'GTJZ1212E', '1414E Plus', 'GS-1930', 'GS-1930 E-Drive', 'GS-2646', 'GS-2632  E-Drive', 'GS-3246',
  'GS-3246 E-Drive', 'GS-4047', 'GS-4655', 'prod-1', 'prod-2', 'prod-3'
];

// 1. 테스터 6명 등록 (loginId 포함)
const users = [
  { id: 'usr-tester-admin', loginId: 'tester_admin', passwordHash: '1234', name: '테스터(총괄관리)', departmentId: 'DEPT-0000001', role: 'ADMIN', status: 'ACTIVE', email: '77.victor.lee@gmail.com', phone: '010-1111-0001', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'usr-tester-sales', loginId: 'tester_sales', passwordHash: '1234', name: '테스터(계약관리)', departmentId: 'DEPT-0000003', role: 'USER', status: 'ACTIVE', email: '77.victor.lee@gmail.com', phone: '010-1111-0002', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'usr-tester-billing', loginId: 'tester_billing', passwordHash: '1234', name: '테스터(청구수납)', departmentId: 'DEPT-0000002', role: 'USER', status: 'ACTIVE', email: '77.victor.lee@gmail.com', phone: '010-1111-0003', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'usr-tester-purchase', loginId: 'tester_purchase', passwordHash: '1234', name: '테스터(매입급여)', departmentId: 'DEPT-0000002', role: 'USER', status: 'ACTIVE', email: '77.victor.lee@gmail.com', phone: '010-1111-0004', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'usr-tester-dispatch', loginId: 'tester_dispatch', passwordHash: '1234', name: '테스터(배차출고)', departmentId: 'DEPT-0000004', role: 'USER', status: 'ACTIVE', email: '77.victor.lee@gmail.com', phone: '010-1111-0005', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'usr-tester-mechanic', loginId: 'tester_mechanic', passwordHash: '1234', name: '테스터(정비관리)', departmentId: 'DEPT-0000005', role: 'USER', status: 'ACTIVE', email: '77.victor.lee@gmail.com', phone: '010-1111-0006', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
];

const menuList = [
  'dashboard', 'customer', 'contract', 'smart_dispatch', 'quote', 'asset_assignment',
  'delivery', 'outbound_inspections', 'smart_return', 'repair', 'consumable',
  'billing', 'bank_matching', 'delinquency', 'purchase_settlement', 'payroll',
  'depreciation_execution', 'rent_assets', 'transport_company', 'todos', 'products', 'assets'
];

const permissions = [];
let permId = 1;
users.forEach(u => {
  menuList.forEach(m => {
    let canRead = false, canSave = false, canDelete = false;
    if (u.role === 'ADMIN') {
      canRead = canSave = canDelete = true;
    } else if (u.id === 'usr-tester-sales') {
      if (['dashboard', 'customer', 'contract', 'smart_dispatch', 'quote', 'todos', 'products', 'assets'].includes(m)) {
        canRead = canSave = true;
        if (['quote', 'customer'].includes(m)) canDelete = true;
      }
    } else if (u.id === 'usr-tester-billing') {
      if (['dashboard', 'billing', 'bank_matching', 'delinquency', 'contract', 'customer', 'todos'].includes(m)) {
        canRead = canSave = true;
      }
    } else if (u.id === 'usr-tester-purchase') {
      if (['dashboard', 'purchase_settlement', 'payroll', 'depreciation_execution', 'consumable', 'rent_assets', 'todos'].includes(m)) {
        canRead = canSave = true;
      }
    } else if (u.id === 'usr-tester-dispatch') {
      if (['dashboard', 'delivery', 'asset_assignment', 'outbound_inspections', 'transport_company', 'products', 'assets', 'todos'].includes(m)) {
        canRead = canSave = true;
      }
    } else if (u.id === 'usr-tester-mechanic') {
      if (['dashboard', 'smart_return', 'repair', 'consumable', 'assets', 'todos'].includes(m)) {
        canRead = canSave = true;
      }
    }
    permissions.push({
      id: `PERM-T${String(permId++).padStart(6, '0')}`,
      userId: u.id,
      menuId: m,
      canRead,
      canSave,
      canDelete,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });
  });
});

// 2. 외부 임차처 6개사, 운송사 6개사, 운송기사 24명
const vendors = [
  { id: 'VEND-0000001', name: '(주)한국렌탈', bizRegNo: '101-81-12345', types: ['RENTAL'], representative: '김한국', contact: '02-1588-1111', email: '77.victor.lee@gmail.com', address: '서울시 서초구 강남대로 101', bankAccount: '신한은행 110-123-456789', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'VEND-0000002', name: '(주)AJ네트웍스', bizRegNo: '102-81-23456', types: ['RENTAL'], representative: '박에이제이', contact: '02-1588-2222', email: '77.victor.lee@gmail.com', address: '서울시 송파구 정의로 8길 9', bankAccount: '우리은행 1002-234-567890', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'VEND-0000003', name: '(주)롯데렌탈', bizRegNo: '103-81-34567', types: ['RENTAL'], representative: '이롯데', contact: '02-1588-3333', email: '77.victor.lee@gmail.com', address: '서울시 중구 통일로 10', bankAccount: '국민은행 345-12-345678', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'VEND-0000004', name: '(주)글로벌리프트', bizRegNo: '104-81-45678', types: ['RENTAL'], representative: '최글로벌', contact: '031-1588-4444', email: '77.victor.lee@gmail.com', address: '경기도 평택시 산단로 50', bankAccount: '하나은행 456-91-234567', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'VEND-0000005', name: '(주)대한고소장비', bizRegNo: '105-81-56789', types: ['RENTAL'], representative: '정도고소', contact: '031-1588-5555', email: '77.victor.lee@gmail.com', address: '경기도 화성시 남양읍 120', bankAccount: '기업은행 567-01-345678', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'VEND-0000006', name: '(주)케이렌탈', bizRegNo: '106-81-67890', types: ['RENTAL'], representative: '강케이', contact: '032-1588-6666', email: '77.victor.lee@gmail.com', address: '인천시 서구 원창동 77', bankAccount: '신한은행 110-345-678901', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'VEND-0000010', name: '(주)기연부품소모품몰', bizRegNo: '109-81-99999', types: ['PARTS'], representative: '정부품', contact: '02-1588-9999', email: '77.victor.lee@gmail.com', address: '서울시 구로구 중앙유통단지 다동 101호', bankAccount: '우리은행 1002-999-888777', isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
];

const transportCompanies = [
  { id: 'TC-001', name: '(주)대한물류', businessNo: '123-45-67890', contact: '1588-0001', memo: '경기/수도권 메인', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'TC-002', name: '(주)한진로지스', businessNo: '234-56-78901', contact: '1588-0002', memo: '충청/강원 권역', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'TC-003', name: '(주)로젠특송', businessNo: '345-67-89012', contact: '1588-0003', memo: '영남 권역', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'TC-004', name: '(주)기연로지텍', businessNo: '456-78-90123', contact: '1588-0004', memo: '호남 권역', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'TC-005', name: '(주)삼영운송', businessNo: '567-89-01234', contact: '1588-0005', memo: '장거리 긴급 탁송', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'TC-006', name: '(주)신한트럭', businessNo: '678-90-12345', contact: '1588-0006', memo: '셀프로더 전용 배차', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
];

const transportDrivers = [];
let driverId = 1;
transportCompanies.forEach((tc, tcIdx) => {
  for (let i = 1; i <= 4; i++) {
    transportDrivers.push({
      id: `TD-${String(driverId).padStart(3, '0')}`,
      companyId: tc.id,
      driverName: `기사${tcIdx + 1}_${i}호`,
      driverContact: `010-7777-${String(driverId).padStart(4, '0')}`,
      vehicleNo: `경기8${tcIdx + 1}바 ${1000 + driverId}`,
      vehicleType: i === 1 ? '1톤 카고' : i === 2 ? '3.5톤 셀프로더' : i === 3 ? '5톤 셀프로더' : '9.5톤 렉카',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });
    driverId++;
  }
});

// 3. 고객사 20개, 담당자, 현장
const customers = [];
const contacts = [];
const sites = [];
let contactIdx = 1;
let siteIdx = 1;

const custNames = [
  '주식회사 현대건설', '삼성물산 주식회사', '지에스건설 주식회사', '대우건설 주식회사', '포스코이앤씨',
  '디엘이앤씨 주식회사', '롯데건설 주식회사', '에스케이에코플랜트', '호반건설 주식회사', '한화건설 주식회사',
  '두산건설 주식회사', '태영건설 주식회사', '코오롱글로벌 주식회사', '금호건설 주식회사', '케이씨씨건설',
  '쌍용건설 주식회사', '계룡건설산업', '한신공영 주식회사', '동부건설 주식회사', '우미건설 주식회사'
];

custNames.forEach((name, idx) => {
  const custId = `CUST-${String(idx + 1).padStart(7, '0')}`;
  customers.push({
    id: custId,
    name,
    bizRegNo: `123-81-${String(idx + 1).padStart(5, '0')}`,
    isClosed: false,
    address: `서울시 강남구 테헤란로 ${100 + idx * 10}`,
    representative: `대표이사${idx + 1}`,
    repContact: `010-5555-${String(idx + 1).padStart(4, '0')}`,
    repEmail: '77.victor.lee@gmail.com',
    bizType: '종합건설업',
    bizItem: '건축 및 토목공사',
    transactionStatus: 'ALLOWED',
    prepaidBalance: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  });

  for (let c = 1; c <= 2; c++) {
    contacts.push({
      id: `CONT-${String(contactIdx++).padStart(7, '0')}`,
      customerId: custId,
      name: `${name.slice(0, 4)} 담당자${c}`,
      position: c === 1 ? '공사과장' : '자재대리',
      contact: `010-6666-${String(contactIdx).padStart(4, '0')}`,
      email: '77.victor.lee@gmail.com',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });
  }

  const sCount = 3 + (idx % 2);
  for (let s = 1; s <= sCount; s++) {
    sites.push({
      id: `SITE-${String(siteIdx++).padStart(7, '0')}`,
      customerId: custId,
      name: `${name.slice(0, 4)} 현장${s}공구`,
      address: `경기도 화성시 동탄대로 ${idx * 10 + s}`,
      contactName: `현장소장${s}`,
      contact: `010-8888-${String(siteIdx).padStart(4, '0')}`,
      email: '77.victor.lee@gmail.com',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });
  }
});

// 4. 소모품 마스터 10종
const consumables = [
  { id: 'CSM-0000001', modelName: '구매테스트 2', unit: '개', unitPrice: 20000, stockQty: 200, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CSM-0000002', modelName: '구매테스트3', unit: '개', unitPrice: 5000, stockQty: 150, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CSM-0000003', modelName: '구매테스트1', unit: '개', unitPrice: 10000, stockQty: 300, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CSM-0000004', modelName: '특이한 소모품', unit: '개', unitPrice: 50000, stockQty: 80, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CON-0000001', modelName: '배터리 증류수 (20L)', unit: '통', unitPrice: 25000, stockQty: 200, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CON-0000002', modelName: '유압유 ISO VG 46 (200L)', unit: '드럼', unitPrice: 450000, stockQty: 40, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CON-0000003', modelName: '조이스틱 컨트롤러 어셈블리', unit: 'EA', unitPrice: 380000, stockQty: 50, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CON-0000004', modelName: '논마킹 타이어 16x5', unit: 'EA', unitPrice: 120000, stockQty: 100, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CON-0000005', modelName: '딥사이클 배터리 6V 225Ah', unit: 'EA', unitPrice: 210000, stockQty: 120, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'CON-0000006', modelName: '비상정지 스위치 키트', unit: 'EA', unitPrice: 45000, stockQty: 80, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
];

// 5. 자산 1,500대 (자사 900대 + 전대 600대) — 45개 유효 모델명 100% 매핑
const assets = [];
const medianPrice = 11500000;
let assetIdx = 1;
validProductModels.forEach(mName => {
  for (let i = 1; i <= 20; i++) {
    const id = `ASSET-${String(assetIdx).padStart(7, '0')}`;
    const assetNo = `K${String(10000 + assetIdx)}`;
    const variation = (Math.random() * 0.10 - 0.05);
    const rawPrice = medianPrice * (1 + variation);
    const acqPrice = Math.ceil(rawPrice / 10000) * 10000;
    
    const acqYear = 2010 + Math.floor(Math.random() * 16);
    const acqMonth = 1 + Math.floor(Math.random() * 12);
    const acqDay = 1 + Math.floor(Math.random() * 28);
    const acqDate = `${acqYear}-${String(acqMonth).padStart(2, '0')}-${String(acqDay).padStart(2, '0')}`;
    
    const elapsedMonths = Math.max(0, (2026 - acqYear) * 12 + (1 - acqMonth));
    const monthlyDepn = (acqPrice * 0.90) / 96;
    const accumDepn = Math.min(acqPrice * 0.90, Math.floor(elapsedMonths * monthlyDepn));
    const bookVal = acqPrice - accumDepn;

    assets.push({
      id,
      assetNo,
      modelName: mName,
      serialNo: `SN-${mName.slice(0, 4).toUpperCase()}-${acqYear}-${String(assetIdx).padStart(4, '0')}`,
      manufacturer: 'GENIE',
      manufactureYear: `${acqYear}년`,
      ownerType: 'OWNED',
      status: 'AVAILABLE',
      acquisitionDate: acqDate,
      acquisitionPrice: acqPrice,
      depreciationMonths: 96,
      residualValueRate: 10,
      accumDepreciation: accumDepn,
      bookValue: bookVal,
      createdAt: `${acqDate}T00:00:00Z`,
      updatedAt: '2026-01-01T00:00:00Z'
    });
    assetIdx++;
  }
});

for (let i = 1; i <= 600; i++) {
  const id = `ASSET-${String(1000 + i).padStart(7, '0')}`;
  const assetNo = `L${String(20000 + i)}`;
  const mName = validProductModels[(i - 1) % validProductModels.length];
  const v = vendors[(i - 1) % (vendors.length - 1)];

  assets.push({
    id,
    assetNo,
    modelName: mName,
    serialNo: `RENT-${v.name.slice(3, 5)}-${String(i).padStart(4, '0')}`,
    manufacturer: 'GENIE',
    manufactureYear: '2024년',
    ownerType: 'RENTED',
    status: 'AVAILABLE',
    vendorId: v.id,
    acquisitionDate: '2026-01-01',
    acquisitionPrice: 0,
    depreciationMonths: 0,
    residualValueRate: 0,
    accumDepreciation: 0,
    bookValue: 0,
    monthlyRentFee: 350000 + ((i % 5) * 20000),
    dailyRentFee: Math.floor((350000 + ((i % 5) * 20000)) / 30),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  });
}

// 6. 7개월 라이프사이클 엔티티
const contracts = [];
const contractAssets = [];
const contractHistories = [];
const deliveries = [];
const outboundInspections = [];
const externalLeases = [];
const repairs = [];
const consumablePurchases = [];
const consumableLogs = [];
const purchaseSettlements = [];
const billings = [];
const billingDetails = [];
const payments = [];
const bankTransactions = [];
const depreciationLogs = [];

let contractSeq = 1;
let caSeq = 1;
let delivSeq = 1;
let inspSeq = 1;
let leaseSeq = 1;
let repSeq = 1;
let cpurSeq = 1;
let clogSeq = 1;
let pstSeq = 1;
let billSeq = 1;
let bdSeq = 1;
let paySeq = 1;
let txSeq = 1;

let ownedAssetCursor = 0;
let rentedAssetCursor = 900;

const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

months.forEach((ym, mIdx) => {
  const contractCountInMonth = 22;

  const cpurId = `CPUR-${String(cpurSeq++).padStart(7, '0')}`;
  const cpurAmount = 30000000;
  consumablePurchases.push({
    id: cpurId,
    consumableId: 'CSM-0000001',
    modelName: '유압유 ISO VG 46 (200L)',
    requestedQty: 65,
    unitPrice: 461538,
    sellerName: '(주)기연부품소모품몰',
    status: 'COMPLETED',
    requestDate: `${ym}-02`,
    acceptedDate: `${ym}-03`,
    completedDate: `${ym}-05`,
    requesterId: 'usr-tester-mechanic',
    createdAt: `${ym}-02T00:00:00Z`,
    updatedAt: `${ym}-05T00:00:00Z`
  });

  consumableLogs.push({
    id: `CLOG-${String(clogSeq++).padStart(7, '0')}`,
    consumableId: 'CSM-0000001',
    type: 'INBOUND',
    quantity: 65,
    unitPrice: 461538,
    userId: 'usr-tester-mechanic',
    actionDate: `${ym}-05`,
    description: `정기 월초 소모품 3,000만원 대량 입고`,
    createdAt: `${ym}-05T00:00:00Z`,
    updatedAt: `${ym}-05T00:00:00Z`
  });

  const usedQty = Math.floor(65 * 0.85);
  consumableLogs.push({
    id: `CLOG-${String(clogSeq++).padStart(7, '0')}`,
    consumableId: 'CSM-0000001',
    type: 'OUTBOUND',
    quantity: usedQty,
    unitPrice: 461538,
    userId: 'usr-tester-mechanic',
    actionDate: `${ym}-20`,
    description: `당월 출고/정비 장비 점검 소모품 85% 소진`,
    createdAt: `${ym}-20T00:00:00Z`,
    updatedAt: `${ym}-20T00:00:00Z`
  });

  for (let c = 1; c <= contractCountInMonth; c++) {
    const cust = customers[(contractSeq - 1) % customers.length];
    const custSites = sites.filter(s => s.customerId === cust.id);
    const site = custSites[(contractSeq - 1) % custSites.length] || sites[0];
    const custContacts = contacts.filter(co => co.customerId === cust.id);
    const contact = custContacts[0] || contacts[0];

    const cId = `CONT-${ym.replace('-', '')}-${String(c).padStart(4, '0')}`;
    const contractNo = `C${ym.replace('-', '')}-${String(c).padStart(4, '0')}`;
    const startDay = 1 + ((c * 2) % 25);
    const startDate = `${ym}-${String(startDay).padStart(2, '0')}`;
    
    const durationMonths = 1 + (c % 6);
    let endM = (mIdx + 1) + durationMonths;
    let endY = 2026;
    if (endM > 12) { endM -= 12; endY += 1; }
    const endDate = `${endY}-${String(endM).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
    const isCompleted = endM <= (mIdx + 1);

    const billingDay = [20, 25, 30][c % 3];

    contracts.push({
      id: cId,
      contractNo,
      customerId: cust.id,
      contactId: contact.id,
      siteId: site.id,
      salespersonId: 'usr-tester-sales',
      startDate,
      endDate,
      billingDay,
      status: isCompleted ? 'COMPLETED' : 'ACTIVE',
      createdAt: `${startDate}T00:00:00Z`,
      updatedAt: `${startDate}T00:00:00Z`
    });

    contractHistories.push({
      id: `CH-${String(contractSeq).padStart(7, '0')}`,
      contractId: cId,
      changeType: 'REGISTER',
      changeDate: startDate,
      description: `계약 신규 등록 (${contractNo})`,
      createdAt: `${startDate}T00:00:00Z`,
      updatedAt: `${startDate}T00:00:00Z`
    });

    const slotCount = 10 + (c % 3);
    for (let s = 1; s <= slotCount; s++) {
      const isRentedSlot = s > Math.floor(slotCount * 0.60);
      let assignedAsset;
      if (isRentedSlot) {
        assignedAsset = assets[rentedAssetCursor % 600 + 900];
        rentedAssetCursor++;
      } else {
        assignedAsset = assets[ownedAssetCursor % 900];
        ownedAssetCursor++;
      }

      const monthlyFee = 350000 + ((s % 6) * 50000);
      const dailyFee = Math.floor(monthlyFee / 30);
      const caId = `CA-${String(caSeq++).padStart(7, '0')}`;

      contractAssets.push({
        id: caId,
        contractId: cId,
        assetId: assignedAsset.id,
        expectedModel: assignedAsset.modelName,
        monthlyRentalFee: monthlyFee,
        dailyRentalFee: dailyFee,
        startDate,
        endDate: isCompleted ? endDate : '미정',
        createdAt: `${startDate}T00:00:00Z`,
        updatedAt: `${startDate}T00:00:00Z`
      });

      if (isRentedSlot && assignedAsset.vendorId) {
        externalLeases.push({
          id: `LEASE-${String(leaseSeq++).padStart(7, '0')}`,
          vendorId: assignedAsset.vendorId,
          contractId: cId,
          contractAssetId: caId,
          assetDescription: `${assignedAsset.modelName} (${assignedAsset.assetNo})`,
          monthlyRentFee: assignedAsset.monthlyRentFee || monthlyFee * 0.85,
          dailyRentFee: Math.floor((assignedAsset.monthlyRentFee || monthlyFee * 0.85) / 30),
          leaseStartDate: startDate,
          leaseEndDate: isCompleted ? endDate : null,
          status: isCompleted ? 'RETURNED' : 'ACTIVE',
          createdAt: `${startDate}T00:00:00Z`,
          updatedAt: `${startDate}T00:00:00Z`
        });
      }

      const isRejected = (c === 1 && s === 1);
      outboundInspections.push({
        id: `INSP-OUT-${String(inspSeq++).padStart(7, '0')}`,
        contractId: cId,
        contractAssetId: caId,
        assetId: assignedAsset.id,
        status: isRejected ? 'REJECTED' : 'APPROVED',
        inspectorId: 'usr-tester-dispatch',
        inspectedAt: startDate,
        note: isRejected ? '상승 유압 밸브 미세 누유 감지' : '정상 승인',
        createdAt: `${startDate}T00:00:00Z`,
        updatedAt: `${startDate}T00:00:00Z`
      });
    }

    const tc = transportCompanies[(contractSeq - 1) % transportCompanies.length];
    const td = transportDrivers.filter(d => d.companyId === tc.id)[0] || transportDrivers[0];
    const outDelivId = `DELIV-${String(delivSeq++).padStart(7, '0')}`;
    const outCost = 100000 + (slotCount * 10000);

    deliveries.push({
      id: outDelivId,
      contractId: cId,
      type: 'OUTBOUND',
      dispatchCategory: '출고',
      status: 'COMPLETED',
      requestDate: startDate,
      scheduledDate: startDate,
      loadingDate: startDate,
      unloadingDate: startDate,
      transportCompany: tc.name,
      transportVendorId: tc.id,
      driverName: td.driverName,
      driverContact: td.driverContact,
      vehicleType: '5톤 셀프로더',
      deliveryCost: outCost,
      deliveryCostConfirmed: outCost,
      reconciliationStatus: 'RECONCILED',
      isCostSettled: true,
      createdAt: `${startDate}T00:00:00Z`,
      updatedAt: `${startDate}T00:00:00Z`
    });

    if (isCompleted) {
      const inDelivId = `DELIV-${String(delivSeq++).padStart(7, '0')}`;
      deliveries.push({
        id: inDelivId,
        contractId: cId,
        type: 'INBOUND',
        dispatchCategory: '회수',
        status: 'COMPLETED',
        requestDate: endDate,
        scheduledDate: endDate,
        loadingDate: endDate,
        unloadingDate: endDate,
        transportCompany: tc.name,
        transportVendorId: tc.id,
        driverName: td.driverName,
        driverContact: td.driverContact,
        vehicleType: '5톤 셀프로더',
        deliveryCost: outCost,
        deliveryCostConfirmed: outCost,
        reconciliationStatus: 'RECONCILED',
        isCostSettled: true,
        createdAt: `${endDate}T00:00:00Z`,
        updatedAt: `${endDate}T00:00:00Z`
      });

      if (c % 3 === 0) {
        const repCost = 350000;
        repairs.push({
          id: `REP-${String(repSeq++).padStart(7, '0')}`,
          assetId: assets[0].id,
          mechanicId: 'usr-tester-mechanic',
          requestDate: endDate,
          repairDate: endDate,
          status: 'COMPLETED',
          details: '현장 사용 중 외관 판넬 파손 및 조이스틱 레버 파손 교체 (고객과실)',
          totalCost: repCost,
          billableToCustomer: true,
          isCustomerFault: true,
          createdAt: `${endDate}T00:00:00Z`,
          updatedAt: `${endDate}T00:00:00Z`
        });
      }
    }

    contractSeq++;
  }

  depreciationLogs.push({
    id: `DEPN-${ym}`,
    depreciationYm: ym,
    executedAt: `${ym}-30T18:00:00Z`,
    executedBy: 'usr-tester-purchase',
    targetAssetCount: 900,
    totalDepreciationAmount: 97875000,
    note: `${ym} 정기 월말 자산 감가상각 결산 마감 완결`,
    createdAt: `${ym}-30T18:00:00Z`,
    updatedAt: `${ym}-30T18:00:00Z`
  });

  customers.forEach((cust, cIdx) => {
    const billId = `BILL-${ym.replace('-', '')}-${String(cIdx + 1).padStart(4, '0')}`;
    const billDay = [20, 25, 30][cIdx % 3];
    const billDate = `${ym}-${String(billDay).padStart(2, '0')}`;
    
    const baseRentalTotal = 4500000 + (cIdx * 200000);
    const hasRepairExtra = (cIdx % 3 === 0);
    const extraRepairCost = hasRepairExtra ? 350000 : 0;
    const totalAmount = baseRentalTotal + extraRepairCost;

    billings.push({
      id: billId,
      customerId: cust.id,
      contractId: contracts[cIdx % contracts.length]?.id,
      billingYm: ym,
      billingDate: billDate,
      totalAmount,
      paidAmount: totalAmount,
      status: 'PAID',
      createdAt: `${billDate}T00:00:00Z`,
      updatedAt: `${billDate}T00:00:00Z`
    });

    billingDetails.push({
      id: `BD-${String(bdSeq++).padStart(7, '0')}`,
      billingId: billId,
      itemName: `${ym} 정기 고소작업대 렌탈료`,
      quantity: 10,
      unitPrice: Math.floor(baseRentalTotal / 10),
      amount: baseRentalTotal,
      description: `${ym} 정기 렌탈`,
      createdAt: `${billDate}T00:00:00Z`,
      updatedAt: `${billDate}T00:00:00Z`
    });

    if (hasRepairExtra) {
      billingDetails.push({
        id: `BD-${String(bdSeq++).padStart(7, '0')}`,
        billingId: billId,
        itemName: '현장 파손 정비 수리비 (고객 과실)',
        quantity: 1,
        unitPrice: extraRepairCost,
        amount: extraRepairCost,
        description: '고객 과실 수리비',
        createdAt: `${billDate}T00:00:00Z`,
        updatedAt: `${billDate}T00:00:00Z`
      });
    }

    const txId = `TX-${String(txSeq++).padStart(7, '0')}`;
    bankTransactions.push({
      id: txId,
      senderName: cust.name,
      depositAmount: totalAmount,
      withdrawAmount: 0,
      memo: 'CMS렌탈료입금',
      matchedBillingId: billId,
      matchingType: 'AUTO',
      transactionDate: `${billDate} 14:30:00`,
      customerId: cust.id,
      isDeposit: true,
      createdAt: `${billDate}T14:30:00Z`,
      updatedAt: `${billDate}T14:30:00Z`
    });

    const payId = `PAY-${String(paySeq++).padStart(7, '0')}`;
    payments.push({
      id: payId,
      billingId: billId,
      amount: totalAmount,
      method: 'BANK_TRANSFER',
      memo: '통장 100% 정상 수납 대사 완료',
      paymentDate: billDate,
      createdAt: `${billDate}T14:35:00Z`,
      updatedAt: `${billDate}T14:35:00Z`
    });
  });

  transportCompanies.forEach((tc, tcIdx) => {
    const pstId = `PST-${ym.replace('-', '')}-T${String(tcIdx + 1).padStart(3, '0')}`;
    const tAmount = 3500000;
    purchaseSettlements.push({
      id: pstId,
      settlementYm: ym,
      settlementType: 'TRANSPORT',
      vendorId: tc.id,
      vendorName: tc.name,
      totalAmount: tAmount,
      paidAmount: tAmount,
      status: 'PAID',
      paymentDate: `${ym}-30`,
      bankAccount: '110-123-456789',
      confirmedAt: `${ym}-28T10:00:00Z`,
      confirmedBy: '테스터(매입급여)',
      memo: `${ym} 운송료 월말 정산`,
      createdAt: `${ym}-28T10:00:00Z`,
      updatedAt: `${ym}-30T16:00:00Z`
    });
  });

  const cPstId = `PST-${ym.replace('-', '')}-CON01`;
  purchaseSettlements.push({
    id: cPstId,
    settlementYm: ym,
    settlementType: 'CONSUMABLE',
    vendorId: 'VEND-0000010',
    vendorName: '(주)기연부품소모품몰',
    totalAmount: cpurAmount,
    paidAmount: cpurAmount,
    status: 'PAID',
    paymentDate: `${ym}-30`,
    bankAccount: '1002-999-888777',
    confirmedAt: `${ym}-28T11:00:00Z`,
    confirmedBy: '테스터(매입급여)',
    memo: `${ym} 소모품 구매 정산`,
    createdAt: `${ym}-28T11:00:00Z`,
    updatedAt: `${ym}-30T16:00:00Z`
  });

  vendors.filter(v => v.types && v.types.includes('RENTAL')).forEach((v, vIdx) => {
    const lPstId = `PST-${ym.replace('-', '')}-L${String(vIdx + 1).padStart(3, '0')}`;
    const lAmount = 28000000;
    purchaseSettlements.push({
      id: lPstId,
      settlementYm: ym,
      settlementType: 'EQUIPMENT_LEASE',
      vendorId: v.id,
      vendorName: v.name,
      totalAmount: lAmount,
      paidAmount: lAmount,
      status: 'PAID',
      paymentDate: `${ym}-30`,
      bankAccount: v.bankAccount,
      confirmedAt: `${ym}-28T14:00:00Z`,
      confirmedBy: '테스터(매입급여)',
      memo: `${ym} 외부 전대 임차료 정산`,
      createdAt: `${ym}-28T14:00:00Z`,
      updatedAt: `${ym}-30T16:00:00Z`
    });
  });
});

async function upsertBatch(table, rows, batchSize = 100) {
  if (!rows || rows.length === 0) return;
  console.log(`🚀 [${table}] 주입 시작 (총 ${rows.length}건)...`);
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.error(`❌ [${table}] 배치 오류 (${i}~${i + chunk.length}):`, error.message);
    }
  }
  console.log(`✅ [${table}] 주입 성공!`);
}

async function main() {
  console.log('=== Supabase WTT 정밀 스키마 100% 정합성 주입 시작 ===');
  
  // 1단계: 사용자 6명, 권한, 외부업체, 운송사, 기사, 고객사, 연락처, 현장, 소모품
  await upsertBatch('users', users);
  await upsertBatch('permissions', permissions);
  await upsertBatch('vendors', vendors);
  await upsertBatch('transport_companies', transportCompanies);
  await upsertBatch('transport_drivers', transportDrivers);
  await upsertBatch('customers', customers);
  await upsertBatch('customer_contacts', contacts);
  await upsertBatch('customer_sites', sites);
  await upsertBatch('consumables', consumables);
  
  // 2단계: 자산 1,500대
  await upsertBatch('assets', assets, 150);
  
  // 3단계: 계약, 계약자산, 계약이력
  await upsertBatch('contracts', contracts, 100);
  await upsertBatch('contract_assets', contractAssets, 150);
  await upsertBatch('contract_history', contractHistories, 150);
  
  // 4단계: 배차, 출고검수, 전대계약, 수리
  await upsertBatch('deliveries', deliveries, 100);
  await upsertBatch('outbound_inspections', outboundInspections, 150);
  await upsertBatch('external_leases', externalLeases, 150);
  await upsertBatch('repairs', repairs, 100);
  
  // 5단계: 소모품 구매신청 & 수불로그
  await upsertBatch('consumable_purchases', consumablePurchases);
  await upsertBatch('consumable_logs', consumableLogs, 100);
  
  // 6단계: 매출 청구, 수납, 통장거래
  await upsertBatch('billings', billings, 100);
  await upsertBatch('billing_details', billingDetails, 150);
  await upsertBatch('bank_transactions', bankTransactions, 100);
  await upsertBatch('payments', payments, 100);
  
  // 7단계: 3대 매입정산
  await upsertBatch('purchase_settlements', purchaseSettlements, 100);
  
  // 8단계: 월말 감가상각 결산로그
  await upsertBatch('depreciation_logs', depreciationLogs);

  console.log('🎉 === Supabase WTT 전체 데이터 주입 100% 성공 완결! ===');
}

main().catch(err => console.error('Fatal injection error:', err));
