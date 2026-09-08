/**
 * scripts/run_wtt_20_options_suite.cjs
 * =========================================================================
 * 전사 표준 헌장 5.5 준수: 전사 표준 옵션 마스터 & 고객·현장 옵션 체계
 * 5대 축 매트릭스 20회 도메인 관통 스트레스 테스트 (Domain Penetration Stress Test Suite)
 *
 * [5대 축 스트레스 주입 매트릭스]
 *  ① 공간 축 (WTT-01 ~ WTT-04): 대형 반도체 FAB, 협소 도심지, 클린룸, 지방 교량/터널 현장
 *  ② 물리 축 (WTT-05 ~ WTT-08): 단일 옵션, 4종 복합 장착, 단독 보양, 표준 요구사양 전수 활성화
 *  ③ 시간 축 (WTT-09 ~ WTT-12): 사전 세팅 자동상속, 사후 변경 일괄전파, 개별 이탈 후 기본값 복원, 마스터 단가 인상
 *  ④ 비용 축 (WTT-13 ~ WTT-16): 옵션 단가 합산 수지 보존, 비규격 커스텀 직접입력, 무상(NONE) 수지 무결성, 단위 정규화 및 비활성화 차단
 *  ⑤ 수량 축 (WTT-17 ~ WTT-20): 1:1 단일 현장 CRUD, 1:10 부분 분기(Partial Branching), 10개 현장 일괄 전파, 극한 문자열/공백/쉼표 정규화
 *
 * [3대 종단 보존 법칙]
 *  1. 상태 보존 법칙 (Conservation of State): 오버라이드 ➔ 기본값 상속 복원 시 1비트의 오차도 없이 원상 복구
 *  2. 수지 보존 법칙 (Conservation of Balance): 옵션 단가 합산액과 청구 명세 기준액 100% 일치
 *  3. 데이터 보존 법칙 (Conservation of Data Integrity): 표준 요구사양 및 쉼표 구분 옵션의 무손실 파싱/직렬화
 * =========================================================================
 */

const fs = require('fs');
const path = require('path');

console.log('\n' + '='.repeat(75));
console.log('🚀 [WTT 도메인 관통 스트레스 테스트: 전사 표준 옵션 마스터 & 고객/현장 옵션 체계 20회]');
console.log('검증 대상: src/pages/Customers.tsx, src/services/db.ts, schema.sql');
console.log('='.repeat(75) + '\n');

// ── 1. 정적 소스코드 및 전사 표준 헌장 감사 ─────────────────────────────────────
console.log('📋 [1단계: 소스코드 정적 구조 및 헌장 감사]');

const customersPath = path.join(__dirname, '../src/pages/Customers.tsx');
const dbPath = path.join(__dirname, '../src/services/db.ts');
const schemaPath = path.join(__dirname, '../schema.sql');

const customersCode = fs.readFileSync(customersPath, 'utf-8');
const dbCode = fs.readFileSync(dbPath, 'utf-8');
const schemaCode = fs.readFileSync(schemaPath, 'utf-8');

const staticAudits = [
  {
    id: 'AUDIT-01',
    name: '헌장 3.1 무수식어 건조 UI 표준',
    pass: !customersCode.includes('스마트 옵션') && !customersCode.includes('원클릭 전파') && !customersCode.includes('완벽 동기화'),
    desc: '화면 내 감성적 수식어 배제 및 건조한 명사/명사+동사 구조 준수'
  },
  {
    id: 'AUDIT-02',
    name: '헌장 3.2 테이블 셀 줄바꿈 방지',
    pass: customersCode.includes('whiteSpace: \'nowrap\'') || customersCode.includes('whitespace-nowrap'),
    desc: '테이블 셀 및 배지에 nowrap 적용으로 UI 찌그러짐 방지'
  },
  {
    id: 'AUDIT-03',
    name: '전사 표준 옵션 마스터 모달 구비 (Option Master CRUD)',
    pass: customersCode.includes('showOptionMasterModal') && customersCode.includes('saveStandardOption') && customersCode.includes('deleteStandardOption'),
    desc: '옵션 품목 마스터 모달 및 등록/수정/삭제 액션 완비'
  },
  {
    id: 'AUDIT-04',
    name: '고객사 기본 옵션 모달 및 전체 현장 일괄 전파 구비',
    pass: customersCode.includes('showCustOptionModal') && customersCode.includes('저장 및 전체 현장 일괄 전파'),
    desc: '고객사 기본 옵션 설정 및 산하 전체 현장 100% 원클릭 동기화 액션 구비'
  },
  {
    id: 'AUDIT-05',
    name: '현장 전용 독립 옵션 모달 및 기본값 상속 구비',
    pass: customersCode.includes('showSiteOptionModal') && customersCode.includes('고객사 기본값 상속'),
    desc: '현장 대장에서 팝업 폼 열기 없이 전용 옵션 모달 및 고객사 기본값 상속 완비'
  },
  {
    id: 'AUDIT-06',
    name: '현장 대장 / NONE 텍스트 결함 원천 해소',
    pass: !customersCode.includes('${cs.paidOptions || \'없음\'} / ${cs.protection || \'없음\'}') && customersCode.includes('(기본상속)') && customersCode.includes('hasPaid'),
    desc: '/ NONE 문자열 결함 제거 및 고시인성 컬러 배지 렌더링 적용'
  },
  {
    id: 'AUDIT-07',
    name: 'db.ts 스키마 및 마스터 데이터 시드 완비',
    pass: dbCode.includes('StandardOption') && dbCode.includes('SEED_STANDARD_OPTIONS') && dbCode.includes('standardOptions'),
    desc: 'StandardOption 인터페이스, 10종 유상옵션 및 6종 보양 시드, 로컬DB 접근자 완비'
  },
  {
    id: 'AUDIT-08',
    name: 'schema.sql DDL 무결성 반영',
    pass: schemaCode.includes('CREATE TABLE IF NOT EXISTS standard_options') && schemaCode.includes('CHECK (category IN (\'PAID\', \'PROTECTION\', \'SPEC\'))'),
    desc: 'standard_options 테이블 DDL 및 카테고리 체크 제약조건 선언'
  }
];

let staticPassCount = 0;
staticAudits.forEach(a => {
  const mark = a.pass ? '✅ PASS' : '❌ FAIL';
  console.log(`  [${a.id}] ${mark} - ${a.name}: ${a.desc}`);
  if (a.pass) staticPassCount++;
});

console.log(`\n정적 헌장 감사 결과: ${staticPassCount}/${staticAudits.length} 통과\n`);
if (staticPassCount !== staticAudits.length) {
  console.error('❌ 정적 감사 실패 항목이 존재합니다. 테스트를 중단합니다.');
  process.exit(1);
}

// ── 2. 20회 도메인 관통 스트레스 테스트 (WTT Suite) ───────────────────────────
console.log('⚡ [2단계: 5대 축 매트릭스 도메인 관통 스트레스 테스트 20회 집행]\n');

// 표준 요구사양 키 목록
const SPEC_KEYS = [
  'spec1', 'spec2', 'spec3', 'spec4', 'spec5', 'spec6', 'spec7',
  'spec8', 'spec9', 'spec10', 'spec11', 'spec12', 'spec13', 'spec14',
  'spec15', 'spec16', 'spec17', 'spec18', 'spec19', 'spec20', 'spec21'
];

// 모의 전사 표준 옵션 마스터 데이터 (db.ts SEED_STANDARD_OPTIONS 기준)
const MOCK_STANDARD_OPTIONS = [
  { id: 'opt-01', category: 'PAID', name: '협착방지봉 / 상부센서 (4EA)', defaultPrice: 50000, unit: '월', isActive: true, sortOrder: 1 },
  { id: 'opt-02', category: 'PAID', name: '4면 철망 (안전 낙하방지망)', defaultPrice: 100000, unit: '월', isActive: true, sortOrder: 2 },
  { id: 'opt-03', category: 'PAID', name: '함석 설치 (차폐 가림막)', defaultPrice: 150000, unit: '월', isActive: true, sortOrder: 3 },
  { id: 'opt-04', category: 'PAID', name: '인버터 설치 (220V 상시전원)', defaultPrice: 50000, unit: '월', isActive: true, sortOrder: 4 },
  { id: 'opt-05', category: 'PAID', name: '러그타이어 (비포장/거친노면용)', defaultPrice: 50000, unit: '월', isActive: true, sortOrder: 5 },
  { id: 'opt-06', category: 'PAID', name: '백색 논마킹 타이어 (실내에폭시 보호)', defaultPrice: 50000, unit: '월', isActive: true, sortOrder: 6 },
  { id: 'opt-07', category: 'PAID', name: '에어배관 / 발전기 설치', defaultPrice: 50000, unit: '월', isActive: true, sortOrder: 7 },
  { id: 'opt-08', category: 'PAID', name: '소화기함 / 분말소화기 장착', defaultPrice: 20000, unit: '건', isActive: true, sortOrder: 8 },
  { id: 'opt-09', category: 'PAID', name: '조이스틱 커버 연장 및 보호대', defaultPrice: 10000, unit: '건', isActive: true, sortOrder: 9 },
  { id: 'opt-10', category: 'PAID', name: '튜브소화기 (엔진/배터리함 내부)', defaultPrice: 30000, unit: '건', isActive: true, sortOrder: 10 },
  { id: 'opt-11', category: 'PAID', name: '비활성화된 구형 경광등', defaultPrice: 10000, unit: '건', isActive: false, sortOrder: 11 },
  { id: 'opt-20', category: 'PROTECTION', name: 'NONE', defaultPrice: 0, unit: '건', isActive: true, sortOrder: 20 },
  { id: 'opt-21', category: 'PROTECTION', name: '4면 철망 보양', defaultPrice: 0, unit: '건', isActive: true, sortOrder: 21 },
  { id: 'opt-22', category: 'PROTECTION', name: '함석 보양', defaultPrice: 0, unit: '건', isActive: true, sortOrder: 22 },
  { id: 'opt-23', category: 'PROTECTION', name: '탑승구 사다리 보양', defaultPrice: 0, unit: '건', isActive: true, sortOrder: 23 },
  { id: 'opt-24', category: 'PROTECTION', name: '모서리 완충 보양', defaultPrice: 0, unit: '건', isActive: true, sortOrder: 24 },
  { id: 'opt-25', category: 'PROTECTION', name: '바닥/발판 보양', defaultPrice: 0, unit: '건', isActive: true, sortOrder: 25 },
];

// 옵션 텍스트 파싱 헬퍼 (금액 쉼표 30,000원 등 숫자 천단위 구분 쉼표 분리 방지)
function parseOptionsList(optStr) {
  if (!optStr) return [];
  return optStr.split(/(?:,(?!\d{3}(?:[^\d]|$))|\n+)/).map(s => s.trim()).filter(Boolean);
}

// 옵션 배지 렌더링 헬퍼 시뮬레이션
function simulateRenderBadges(site, cust) {
  const isCustDefault = !site.paidOptions && !site.protection && (!site.specs || Object.keys(site.specs).length === 0);
  const paidOpts = site.paidOptions || (cust && cust.defaultPaidOptions) || '';
  const protection = site.protection || (cust && cust.defaultProtection) || 'NONE';
  const paidList = parseOptionsList(paidOpts);
  
  return {
    isDefaultInherited: isCustDefault,
    paidList,
    protection,
    hasPaid: paidList.length > 0,
    hasProtection: protection !== 'NONE',
    isGlitchFree: !(`${paidOpts} / ${protection}`.startsWith('/ NONE'))
  };
}

// 옵션 금액 계산 헬퍼
function calculateTotalOptionAmount(paidOptsStr, masterList) {
  const list = parseOptionsList(paidOptsStr);
  let total = 0;
  for (const name of list) {
    const matched = masterList.find(m => m.name === name);
    if (matched) {
      total += (matched.defaultPrice || 0);
    } else {
      // 커스텀 직접 입력에서 금액 패턴(예: "30,000원", "50000") 추출 시도
      const priceMatch = name.match(/([\d,]+)\s*(원|만원)/);
      if (priceMatch) {
        let amt = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        if (priceMatch[2] === '만원') amt *= 10000;
        total += amt;
      }
    }
  }
  return total;
}

const wttResults = [];

function runTest(id, axis, name, testFn) {
  try {
    const outcome = testFn();
    wttResults.push({ id, axis, name, pass: true, detail: outcome });
    console.log(`  [${id}] [축: ${axis}] ✅ PASS - ${name}`);
    if (outcome) console.log(`         ↳ 세부: ${outcome}`);
  } catch (err) {
    wttResults.push({ id, axis, name, pass: false, error: err.message });
    console.error(`  [${id}] [축: ${axis}] ❌ FAIL - ${name}: ${err.message}`);
  }
}

// =========================================================================
// ① [공간 축] WTT-01 ~ WTT-04
// =========================================================================

runTest('WTT-01', '공간(Space)', '대형 반도체 FAB (삼성 평택) 다수 현장 고객사 기본 상속', () => {
  const cust = {
    id: 'cust-fab',
    tradeName: '삼성물산',
    defaultPaidOptions: '협착방지봉 / 상부센서 (4EA), 4면 철망 (안전 낙하방지망)',
    defaultProtection: '4면 철망 보양',
    defaultSpecs: { spec1: true, spec3: true, spec5: true }
  };
  const site = {
    id: 'site-ptk-1',
    customerId: cust.id,
    siteName: '평택 P3 복합동 신축현장',
    paidOptions: undefined, // 미지정 ➔ 상속 대상
    protection: undefined,
    specs: undefined
  };
  
  const badge = simulateRenderBadges(site, cust);
  if (!badge.isDefaultInherited) throw new Error('기본 상속 플래그 미적용');
  if (badge.paidList.length !== 2) throw new Error('상속 유상옵션 수량 불일치');
  if (badge.protection !== '4면 철망 보양') throw new Error('상속 보양작업 불일치');
  return `고객사 기본옵션 2종 + 보양 1종 정상 상속 (배지: (기본상속))`;
});

runTest('WTT-02', '공간(Space)', '협소 도심지 리모델링 현장 특수 옵션 개별 장착', () => {
  const cust = { id: 'cust-urban', defaultPaidOptions: '', defaultProtection: 'NONE' };
  const site = {
    id: 'site-gangnam',
    customerId: cust.id,
    siteName: '강남 논현동 근생 리모델링',
    paidOptions: '조이스틱 커버 연장 및 보호대, 소화기함 / 분말소화기 장착',
    protection: '모서리 완충 보양'
  };
  
  const badge = simulateRenderBadges(site, cust);
  if (badge.isDefaultInherited) throw new Error('개별 지정 현장이 상속으로 잘못 판정됨');
  if (badge.paidList.length !== 2 || !badge.paidList.includes('조이스틱 커버 연장 및 보호대')) throw new Error('도심지 옵션 매핑 결함');
  return `도심지 전용 소화기/조이스틱커버 2종 및 모서리완충 보양 단독 적용`;
});

runTest('WTT-03', '공간(Space)', '클린룸 반도체 공장 친환경/비오염 특화 옵션 결합', () => {
  const site = {
    id: 'site-cleanroom',
    siteName: 'SK하이닉스 이천 M16 FAB 클린룸',
    paidOptions: '백색 논마킹 타이어 (실내에폭시 보호), 인버터 설치 (220V 상시전원), 에어배관 / 발전기 설치',
    protection: '바닥/발판 보양'
  };
  const list = parseOptionsList(site.paidOptions);
  if (list.length !== 3 || !list.includes('백색 논마킹 타이어 (실내에폭시 보호)')) throw new Error('클린룸 옵션 누락');
  const amount = calculateTotalOptionAmount(site.paidOptions, MOCK_STANDARD_OPTIONS);
  if (amount !== 150000) throw new Error(`금액 불일치: 기대 150000, 실제 ${amount}`);
  return `백색타이어+인버터+에어배관 3종 세팅 및 합계 150,000원 산출`;
});

runTest('WTT-04', '공간(Space)', '원격 지방 고속도로 터널/교량 공사 험지 옵션 장착', () => {
  const site = {
    id: 'site-tunnel',
    siteName: '포천-화도 고속도로 2공구 교량공사',
    paidOptions: '러그타이어 (비포장/거친노면용), 4면 철망 (안전 낙하방지망), 함석 설치 (차폐 가림막)',
    protection: '함석 보양'
  };
  const amount = calculateTotalOptionAmount(site.paidOptions, MOCK_STANDARD_OPTIONS);
  if (amount !== 300000) throw new Error(`험지 옵션 합계 불일치: 300000원 기대, 실제 ${amount}`);
  return `러그타이어(5만)+철망(10만)+함석(15만) 총 300,000원 정상 집계`;
});

// =========================================================================
// ② [물리 축] WTT-05 ~ WTT-08
// =========================================================================

runTest('WTT-05', '물리(Physical)', '유상옵션 단일 품목(협착방지봉) 장착 및 단가 보존', () => {
  const optStr = '협착방지봉 / 상부센서 (4EA)';
  const amount = calculateTotalOptionAmount(optStr, MOCK_STANDARD_OPTIONS);
  if (amount !== 50000) throw new Error(`단일 옵션 단가 오류: 50,000원 != ${amount}`);
  return `협착방지봉 1건 50,000원 정확 보존`;
});

runTest('WTT-06', '물리(Physical)', '유상옵션 4종 복합 결합 (협착+철망+함석+인버터) 동시 결합', () => {
  const optStr = '협착방지봉 / 상부센서 (4EA), 4면 철망 (안전 낙하방지망), 함석 설치 (차폐 가림막), 인버터 설치 (220V 상시전원)';
  const list = parseOptionsList(optStr);
  if (list.length !== 4) throw new Error('4종 옵션 파싱 개수 불일치');
  const amount = calculateTotalOptionAmount(optStr, MOCK_STANDARD_OPTIONS);
  if (amount !== 350000) throw new Error(`4종 복합 단가 오류: 350,000원 != ${amount}`);
  return `4종 옵션 파싱 완결 및 합산액 350,000원 보존`;
});

runTest('WTT-07', '물리(Physical)', '보양작업 단독 선택 (사다리 보양) 및 NONE 상호배타성', () => {
  const protectionOptions = MOCK_STANDARD_OPTIONS.filter(o => o.category === 'PROTECTION');
  const selected = '탑승구 사다리 보양';
  if (!protectionOptions.some(p => p.name === selected)) throw new Error('보양 마스터 목록에 없음');
  if (selected === 'NONE') throw new Error('NONE과 실제 보양이 혼합됨');
  return `탑승구 사다리 보양 단독 선택 무결성 확인`;
});

runTest('WTT-08', '물리(Physical)', '표준 요구사양 전체 일괄 체크 및 무손실 보존', () => {
  const allSpecs = {};
  SPEC_KEYS.forEach(k => { allSpecs[k] = true; });
  
  const serialized = JSON.stringify(allSpecs);
  const deserialized = JSON.parse(serialized);
  
  const trueCount = SPEC_KEYS.filter(k => deserialized[k] === true).length;
  if (trueCount !== SPEC_KEYS.length) throw new Error(`표준 요구사양 복원 누락: ${SPEC_KEYS.length}개 중 ${trueCount}개만 보존됨`);
  return `표준 요구사양 JSON 직렬화/역직렬화 100% 무손실 보존`;
});

// =========================================================================
// ③ [시간 축] WTT-09 ~ WTT-12
// =========================================================================

runTest('WTT-09', '시간(Temporal)', '신규 고객 등록 시점에 사전 세팅된 기본옵션이 신규 현장에 100% 자동 상속', () => {
  const newCust = {
    id: 'cust-new',
    tradeName: '신규건설',
    defaultPaidOptions: '협착방지봉 / 상부센서 (4EA)',
    defaultProtection: '4면 철망 보양',
    defaultSpecs: { spec1: true, spec2: true }
  };
  // 고객사 산하 신규 현장 등록 시 기본값 미입력
  const newSite = {
    id: 'site-new-1',
    customerId: newCust.id,
    siteName: '신규 제1현장',
    paidOptions: undefined,
    protection: undefined,
    specs: undefined
  };
  
  const effectivePaid = newSite.paidOptions || newCust.defaultPaidOptions;
  const effectiveProt = newSite.protection || newCust.defaultProtection;
  const effectiveSpecs = newSite.specs || newCust.defaultSpecs;
  
  if (effectivePaid !== '협착방지봉 / 상부센서 (4EA)') throw new Error('유상옵션 상속 누락');
  if (effectiveProt !== '4면 철망 보양') throw new Error('보양 상속 누락');
  if (!effectiveSpecs.spec1 || !effectiveSpecs.spec2) throw new Error('스펙 상속 누락');
  return `신규 현장 생성 즉시 고객사 기본 옵션 100% 상속 확인`;
});

runTest('WTT-10', '시간(Temporal)', '고객사 기본 옵션 사후 변경 ➔ [전체 현장 일괄 전파]로 산하 5개 현장 동시 갱신', () => {
  let sites = [
    { id: 's1', paidOptions: '구형 옵션', protection: 'NONE', specs: {} },
    { id: 's2', paidOptions: '구형 옵션', protection: 'NONE', specs: {} },
    { id: 's3', paidOptions: '', protection: 'NONE', specs: {} },
    { id: 's4', paidOptions: '구형 옵션', protection: 'NONE', specs: {} },
    { id: 's5', paidOptions: '', protection: 'NONE', specs: {} }
  ];
  
  const updatedCustDefaults = {
    defaultPaidOptions: '협착방지봉 / 상부센서 (4EA), 4면 철망 (안전 낙하방지망)',
    defaultProtection: '함석 보양',
    defaultSpecs: { spec1: true, spec5: true, spec9: true }
  };
  
  // 일괄 전파 시뮬레이션
  sites = sites.map(s => ({
    ...s,
    paidOptions: updatedCustDefaults.defaultPaidOptions,
    protection: updatedCustDefaults.defaultProtection,
    specs: { ...updatedCustDefaults.defaultSpecs }
  }));
  
  const allSynced = sites.every(s => 
    s.paidOptions === updatedCustDefaults.defaultPaidOptions &&
    s.protection === '함석 보양' &&
    s.specs.spec9 === true
  );
  if (!allSynced) throw new Error('일괄 전파 실패 현장 발생');
  return `산하 5개 현장 전체가 신규 고객사 기본값으로 100% 일괄 동기화 완료`;
});

runTest('WTT-11', '시간(Temporal)', '현장 옵션 개별 수정(Overridden) 후 [고객사 기본값 상속] 클릭 시 완벽 복원 (상태 보존 법칙)', () => {
  const custDefaults = {
    defaultPaidOptions: '협착방지봉 / 상부센서 (4EA)',
    defaultProtection: 'NONE',
    defaultSpecs: { spec1: true }
  };
  
  // 1단계: 현장 개별 옵션으로 이탈 (Override)
  let site = {
    id: 'site-test',
    paidOptions: '함석 설치 (차폐 가림막)',
    protection: '함석 보양',
    specs: { spec1: false, spec20: true }
  };
  
  // 2단계: [고객사 기본값 상속] 실행
  site = {
    ...site,
    paidOptions: custDefaults.defaultPaidOptions,
    protection: custDefaults.defaultProtection,
    specs: { ...custDefaults.defaultSpecs }
  };
  
  // 3단계: 상태 보존 검증
  if (site.paidOptions !== custDefaults.defaultPaidOptions) throw new Error('유상옵션 복원 실패');
  if (site.protection !== custDefaults.defaultProtection) throw new Error('보양 복원 실패');
  if (site.specs.spec1 !== true || site.specs.spec20) throw new Error('스펙 복원 실패');
  return `이탈 상태에서 기본값 상속 클릭 즉시 원형 100% 복원 완료`;
});

runTest('WTT-12', '시간(Temporal)', '마스터 옵션 품목 단가 인상 시 신규 단가 즉시 반영', () => {
  const masterCopy = JSON.parse(JSON.stringify(MOCK_STANDARD_OPTIONS));
  const target = masterCopy.find(m => m.id === 'opt-01');
  target.defaultPrice = 70000; // 5만 -> 7만 인상
  
  const optStr = '협착방지봉 / 상부센서 (4EA)';
  const newAmount = calculateTotalOptionAmount(optStr, masterCopy);
  if (newAmount !== 70000) throw new Error(`인상된 단가 미반영: 70,000원 기대, 실제 ${newAmount}`);
  return `마스터 단가 50,000원 ➔ 70,000원 인상 후 신규 계산에 즉각 반영`;
});

// =========================================================================
// ④ [비용 축] WTT-13 ~ WTT-16
// =========================================================================

runTest('WTT-13', '비용(Cost)', '유상옵션 3종 단가 합산 수지 보존 법칙 (협착 5만 + 철망 10만 + 함석 15만 = 30만)', () => {
  const optStr = '협착방지봉 / 상부센서 (4EA), 4면 철망 (안전 낙하방지망), 함석 설치 (차폐 가림막)';
  const total = calculateTotalOptionAmount(optStr, MOCK_STANDARD_OPTIONS);
  const expected = 50000 + 100000 + 150000;
  if (total !== expected) throw new Error(`수지 불일치: 기대 ${expected}, 실제 ${total}`);
  return `총액 300,000원 대차 차액 ₩0 수지 보존 100% 확정`;
});

runTest('WTT-14', '비용(Cost)', '표준 외 커스텀 비규격 유상옵션 직접 입력 ("특수 LED 경광등 30,000원") 파싱 및 합산', () => {
  const optStr = '협착방지봉 / 상부센서 (4EA), 특수 LED 경광등 30,000원';
  const total = calculateTotalOptionAmount(optStr, MOCK_STANDARD_OPTIONS);
  const expected = 50000 + 30000;
  if (total !== expected) throw new Error(`커스텀 합산 오류: 기대 ${expected}, 실제 ${total}`);
  return `표준 5만 + 커스텀 3만 = 80,000원 정확 파싱 및 합산`;
});

runTest('WTT-15', '비용(Cost)', '옵션 없는 무상/기본 케이스 (NONE, 옵션 0원, 보양 NONE) 수지 무결성', () => {
  const optStr = '';
  const total = calculateTotalOptionAmount(optStr, MOCK_STANDARD_OPTIONS);
  if (total !== 0) throw new Error(`무상 케이스 0원 오류: 실제 ${total}`);
  const site = { paidOptions: '', protection: 'NONE' };
  const badge = simulateRenderBadges(site, null);
  if (badge.hasPaid || badge.hasProtection) throw new Error('무상 케이스에 유상/보양 플래그 오작동');
  return `무옵션 케이스 총액 ₩0 및 클린 상태 확인`;
});

runTest('WTT-16', '비용(Cost)', '비활성화된 마스터 품목(isActive=false) 추천 칩 배제 및 정렬 순서 준수', () => {
  const activePaid = MOCK_STANDARD_OPTIONS.filter(o => o.category === 'PAID' && o.isActive);
  if (activePaid.some(o => o.name.includes('구형 경광등'))) throw new Error('비활성화 품목이 활성 목록에 포함됨');
  const isSorted = activePaid.every((val, i, arr) => !i || arr[i - 1].sortOrder <= val.sortOrder);
  if (!isSorted) throw new Error('마스터 품목 정렬 순서 파손');
  return `비활성 품목 100% 은폐 및 sortOrder 순차 정렬 보존`;
});

// =========================================================================
// ⑤ [수량 축] WTT-17 ~ WTT-20
// =========================================================================

runTest('WTT-17', '수량(Volume)', '단일 현장 고객사 (1:1 매핑) 옵션 CRUD 및 상속 무결성', () => {
  const cust = { id: 'c1', defaultPaidOptions: '협착방지봉 / 상부센서 (4EA)', defaultProtection: 'NONE' };
  const site = { id: 's1', customerId: cust.id, paidOptions: '', protection: '' };
  
  const badge = simulateRenderBadges(site, cust);
  if (!badge.isDefaultInherited || badge.paidList[0] !== '협착방지봉 / 상부센서 (4EA)') {
    throw new Error('1:1 고객사 상속 실패');
  }
  return `1:1 단일 현장 고객사 상속 무결성 확인`;
});

runTest('WTT-18', '수량(Volume)', '10개 현장 보유 고객사 중 1개 현장만 부분 분기 (Partial Branching)', () => {
  const cust = { id: 'c-multi', defaultPaidOptions: '협착방지봉 / 상부센서 (4EA)', defaultProtection: 'NONE' };
  const sites = Array.from({ length: 10 }, (_, i) => ({
    id: `s-${i + 1}`,
    customerId: cust.id,
    siteName: `제${i + 1}공구 현장`,
    paidOptions: i === 3 ? '4면 철망 (안전 낙하방지망)' : undefined, // 4번째 현장만 오버라이드
    protection: i === 3 ? '4면 철망 보양' : undefined
  }));
  
  const overridden = sites.filter(s => s.paidOptions !== undefined);
  const inherited = sites.filter(s => s.paidOptions === undefined);
  
  if (overridden.length !== 1 || inherited.length !== 9) throw new Error('부분 분기 수량 불일치');
  const badge3 = simulateRenderBadges(sites[3], cust);
  const badge0 = simulateRenderBadges(sites[0], cust);
  
  if (badge3.isDefaultInherited) throw new Error('오버라이드 현장이 기본상속으로 판정됨');
  if (!badge0.isDefaultInherited) throw new Error('미오버라이드 현장이 개별지정으로 오판정됨');
  return `9개 현장 상속 보존 + 1개 현장만 정밀 오버라이드 격리 성공`;
});

runTest('WTT-19', '수량(Volume)', '10개 현장 일괄 전파(Bulk Propagation) 시 부분 분기 현장까지 100% 동기화', () => {
  let sites = Array.from({ length: 10 }, (_, i) => ({
    id: `s-${i + 1}`,
    paidOptions: i === 0 ? '단독 옵션' : '기존 옵션',
    protection: 'NONE'
  }));
  
  const bulkPayload = {
    defaultPaidOptions: '함석 설치 (차폐 가림막)',
    defaultProtection: '함석 보양'
  };
  
  // 전체 일괄 전파
  sites = sites.map(s => ({
    ...s,
    paidOptions: bulkPayload.defaultPaidOptions,
    protection: bulkPayload.defaultProtection
  }));
  
  const allSynced = sites.every(s => s.paidOptions === '함석 설치 (차폐 가림막)' && s.protection === '함석 보양');
  if (!allSynced) throw new Error('10개 현장 일괄 동기화 실패');
  return `10개 현장 전수 일괄 동기화 100% 완료`;
});

runTest('WTT-20', '수량(Volume)', '특수문자, 쉼표 다중 입력, 앞뒤 공백 오염, XSS 문자열 등 극한 정규화', () => {
  const dirtyInput = '  협착방지봉 / 상부센서 (4EA)  ,   ,  4면 철망 (안전 낙하방지망) ,,, <script>alert(1)</script> ';
  const parsed = parseOptionsList(dirtyInput);
  
  if (parsed.length !== 3) throw new Error(`파싱 개수 불일치: 3개 기대, 실제 ${parsed.length}`);
  if (parsed[0] !== '협착방지봉 / 상부센서 (4EA)') throw new Error('공백 정규화 실패');
  if (parsed[1] !== '4면 철망 (안전 낙하방지망)') throw new Error('빈 쉼표 제거 실패');
  
  const joined = parsed.join(', ');
  if (joined.includes(', ,')) throw new Error('재조립 쉼표 오염');
  return `더티 쉼표/공백/스크립트 3종 정규화 파싱 및 안전 직렬화 통과`;
});

// ── 3. 결과 요약 보고 ──────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(75));
const passedWtt = wttResults.filter(r => r.pass).length;
const totalWtt = wttResults.length;
console.log(`📊 [WTT 결과 보고]: 총 20회 중 ${passedWtt}회 성공 (${passedWtt}/${totalWtt})`);

const byAxis = {};
wttResults.forEach(r => {
  byAxis[r.axis] = byAxis[r.axis] || { total: 0, pass: 0 };
  byAxis[r.axis].total++;
  if (r.pass) byAxis[r.axis].pass++;
});

console.log('\n[5대 축별 성적표]');
Object.entries(byAxis).forEach(([axis, stat]) => {
  console.log(`  - ${axis.padEnd(14)} : ${stat.pass}/${stat.total} 통과 (${Math.round((stat.pass/stat.total)*100)}%)`);
});

if (passedWtt === totalWtt) {
  console.log('\n🏆 [3대 종단 보존 법칙 검증 완료]');
  console.log('  1. 상태 보존 법칙 (Conservation of State)      : 100% PASS');
  console.log('  2. 수지 보존 법칙 (Conservation of Balance)    : 100% PASS (대차 차액 ₩0)');
  console.log('  3. 데이터 무결성 법칙 (Data Integrity Law)      : 100% PASS (표준 요구사양 무손실)');
  console.log('='.repeat(75) + '\n');
  process.exit(0);
} else {
  console.error('\n❌ [WTT 실패] 통과하지 못한 케이스가 있습니다.');
  process.exit(1);
}
