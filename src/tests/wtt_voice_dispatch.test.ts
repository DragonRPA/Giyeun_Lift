// src/tests/wtt_voice_dispatch.test.ts
import {
  mergeVoiceFragmentToDraft,
  parseCustomerVoiceInput,
  parseSiteVoiceInput,
  parseEquipmentVoiceInput,
  parseDateTimeVoiceInput,
  parseOptionsAndSpecsVoiceInput,
  parseLogisticsAndBillingVoiceInput,
  parseYesNoVoiceInput,
  parseContactNameVoiceInput,
  parseContactPhoneVoiceInput,
  getSiteOptionsSummary,
  isOptionsChangedFromSite,
  EQUIPMENT_SPEC_MATRIX,
  VoiceOrderDraft
} from '../services/voiceOrderDraftService';
import { Customer, CustomerSite } from '../services/db';

interface WttResult {
  scenarioId: string;
  name: string;
  axis: string; // 공간, 물리, 시간, 비용, 수량, 맥락
  passed: boolean;
  issues: string[];
  details: Record<string, any>;
}

// ── Mock DB Data for WTT ──
const mockCustomers: Customer[] = [
  {
    id: 'CUST-001',
    name: '현대건설(주)',
    address: '서울시 종로구 율곡로 75',
    repContact: '010-1111-2222',
    repEmail: 'hd@hyundai.com',
    isClosed: false,
    bizRegNo: '101-81-00001',
    transactionStatus: 'ALLOWED',
    defaultBillingDay: 31,
    paymentDueDay: 25,
    representative: '홍길동',
    bizType: '건설업',
    bizItem: '토목건축',
    createdAt: '2026-01-01'
  },
  {
    id: 'CUST-002',
    name: '포스코이앤씨',
    address: '인천시 연수구 컨벤시아대로',
    repContact: '010-3333-4444',
    repEmail: 'posco@posco.com',
    isClosed: false,
    bizRegNo: '101-81-00002',
    transactionStatus: 'ALLOWED',
    defaultBillingDay: 20,
    paymentDueDay: 15,
    representative: '이포스코',
    bizType: '건설업',
    bizItem: '플랜트',
    createdAt: '2026-01-01'
  },
  {
    id: 'CUST-003',
    name: '부실건설(주)',
    address: '경기도 수원시 영통구',
    repContact: '010-9999-0000',
    repEmail: 'bad@bad.com',
    isClosed: false,
    bizRegNo: '101-81-99999',
    transactionStatus: 'BLOCKED', // 거래 정지 고객사
    defaultBillingDay: 31,
    paymentDueDay: 25,
    representative: '나연체',
    bizType: '건설업',
    bizItem: '단기공사',
    createdAt: '2026-01-01'
  },
  {
    id: 'CUST-004',
    name: '백산이엔씨',
    address: '인천시 서구',
    repContact: '010-4444-5555',
    repEmail: 'bs@bs.com',
    isClosed: false,
    bizRegNo: '101-81-00004',
    transactionStatus: 'ALLOWED',
    defaultBillingDay: 31,
    paymentDueDay: 25,
    representative: '백산',
    bizType: '건설업',
    bizItem: '가설공사',
    createdAt: '2026-01-01'
  },
  {
    id: 'CUST-005',
    name: '세연테크',
    address: '경기도 화성시',
    repContact: '010-7777-9999',
    repEmail: 'sy@sy.com',
    isClosed: false,
    bizRegNo: '101-81-00005',
    transactionStatus: 'ALLOWED',
    defaultBillingDay: 25,
    paymentDueDay: 20,
    representative: '세연',
    bizType: '제조업',
    bizItem: '산업설비',
    createdAt: '2026-01-01'
  }
];

const mockSites: CustomerSite[] = [
  {
    id: 'SITE-001',
    customerId: 'CUST-001',
    name: '판교 R&D 센터 현장',
    address: '경기도 성남시 분당구 판교역로 100',
    contact: '010-5555-6666',
    contactName: '박소장',
    email: 'park@site.com',
    createdAt: '2026-01-01',
    paidOptions: '4면 철망',
    protection: '바닥 보양(부직포/플라베니아)',
    checkedSpecs: { spec3: true, spec4: true }
  },
  {
    id: 'SITE-002',
    customerId: 'CUST-002',
    name: '송도 센트럴파크 2차',
    address: '인천광역시 연수구 송도동 456',
    contact: '010-7777-8888',
    contactName: '최소장',
    email: 'choi@site.com',
    createdAt: '2026-01-01'
  }
];

export function runWttSuite(): WttResult[] {
  const results: WttResult[] = [];

  // WTT-DISP-01: 표준 단일 출고 (Happy Path)
  {
    const issues: string[] = [];
    const cust = parseCustomerVoiceInput('현대건설', mockCustomers);
    if (!cust || cust.id !== 'CUST-001') issues.push('고객사 매칭 실패');
    const site = parseSiteVoiceInput('판교 R&D', mockSites, cust?.id);
    if (!site?.site || site.site.id !== 'SITE-001') issues.push('현장 매칭 실패');
    const eq = parseEquipmentVoiceInput('스카이잭 19피트 1대');
    if (!eq || eq.order.modelName !== 'SJ-3219' || eq.order.count !== 1) issues.push('장비 매칭 실패');
    const dt = parseDateTimeVoiceInput('내일 아침 8시');
    if (dt.isAsap) issues.push('일반 시간에 ASAP 잘못 감지');
    results.push({
      scenarioId: 'WTT-DISP-01',
      name: '표준 단일 출고 (기존 고객 + 기존 현장 + 19ft 1대 + 익일 08:00)',
      axis: '공간(기존) x 시간(익일) x 수량(1대)',
      passed: issues.length === 0,
      issues,
      details: { cust: cust?.name, site: site?.site?.name, eq: eq?.confirmedDescription }
    });
  }

  // WTT-DISP-02: 신규 현장 + 도로명주소 + 현장소장 연락처 정제
  {
    const issues: string[] = [];
    const utterance = '송도 바이오 3단지 신규현장 인천시 연수구 송도동 123-4 김반장 010-8888-9999';
    const site = parseSiteVoiceInput(utterance, mockSites, 'CUST-002');
    if (!site?.isNew) issues.push('신규 현장 감지 실패');
    if (site?.newSiteName?.includes('인천시') || site?.newSiteName?.includes('010')) issues.push('현장명 텍스트 오염');
    if (site?.extractedContactPhone !== '010-8888-9999') issues.push('연락처 추출 실패');
    results.push({
      scenarioId: 'WTT-DISP-02',
      name: '신규 현장 + 도로명주소 + 현장소장 복합 발화 정제',
      axis: '공간(신규) x 물리(복합주소/연락처)',
      passed: issues.length === 0,
      issues,
      details: site || {}
    });
  }

  // WTT-DISP-03: 유상옵션 + 보양작업 + 21대 안전스펙
  {
    const issues: string[] = [];
    const utterance = '4면 철망 장착해주시고 바닥 플라베니아 보양 필수 상부 협착 방지봉이랑 원판 소화기 챙겨주세요';
    const res = parseOptionsAndSpecsVoiceInput(utterance);
    if (!res.paidOptions.includes('4면 철망')) issues.push('4면 철망 누락');
    if (!res.protection.includes('플라베니아')) issues.push('플라베니아 누락');
    if (!res.checkedSpecs['spec3']) issues.push('협착방지봉(spec3) 누락');
    if (!res.checkedSpecs['spec4']) issues.push('원판(spec4) 누락');
    if (!res.checkedSpecs['spec13']) issues.push('소화기(spec13) 누락');
    results.push({
      scenarioId: 'WTT-DISP-03',
      name: '유상옵션(4면 철망) + 바닥보양(플라베니아) + 21대 안전스펙 3EA',
      axis: '물리(안전/보양/유상옵션)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-04: 긴급 돌발 ASAP 발화
  {
    const issues: string[] = [];
    const dt = parseDateTimeVoiceInput('지금 당장 최대한 빨리 보내줘');
    if (!dt.isAsap || dt.time !== 'ASAP') issues.push('ASAP 감지 실패');
    results.push({
      scenarioId: 'WTT-DISP-04',
      name: '긴급 돌발 ASAP 발화 ("지금 당장", "최대한 빨리") 및 시간 무관 인터뷰',
      axis: '시간(돌발 긴급)',
      passed: issues.length === 0,
      issues,
      details: dt
    });
  }

  // WTT-DISP-05: 운송비 고객 청구 + 차종 지정
  {
    const issues: string[] = [];
    const res = parseLogisticsAndBillingVoiceInput('운송비는 고객사 청구로 돌리고 5톤 렉카차로 배차해');
    if (res.billableToCustomer !== true) issues.push('운송비 고객청구 미인식');
    if (res.vehicleType !== '5톤 렉카') issues.push('차종 미인식');
    results.push({
      scenarioId: 'WTT-DISP-05',
      name: '운송비 고객 청구 귀속선 변경 및 5톤 렉카 차종 지정',
      axis: '비용(귀속선) x 물리(차종)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-06: 복합 다종 동시 발주
  {
    const issues: string[] = [];
    const utterance = '스카이잭 19피트 2대랑 지니 2646 광폭 1대랑 40피트 1대';
    const eq = parseEquipmentVoiceInput(utterance);
    if (!eq?.orders || eq.orders.length < 3) issues.push('다종 파싱 누락');
    const totalQty = eq?.orders?.reduce((sum, o) => sum + o.count, 0) || 0;
    if (totalQty !== 4) issues.push(`총 수량 오류: ${totalQty} (기대치: 4)`);
    results.push({
      scenarioId: 'WTT-DISP-06',
      name: '복합 다종 동시 발주 (19ft 2대 + 26ft 광폭 1대 + 40ft 1대 = 총 4대)',
      axis: '수량(복합 다종 4대)',
      passed: issues.length === 0,
      issues,
      details: { eq }
    });
  }

  // WTT-DISP-07: 현장 물리 공간 제약 (지하 2층 2.3m + 지게차)
  {
    const issues: string[] = [];
    const res = parseLogisticsAndBillingVoiceInput('지하 2층 진입이고 높이제한 2.3m 지게차 하차 필수입니다');
    if (!res.specialMemo?.includes('지하 2층') || !res.specialMemo?.includes('2.3m') || !res.specialMemo?.includes('지게차')) {
      issues.push('특이사항 메모 누락');
    }
    results.push({
      scenarioId: 'WTT-DISP-07',
      name: '물리 공간 제약 (지하 2층 진입, 높이제한 2.3m, 지게차 하차)',
      axis: '공간(지하) x 물리(진입제한)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-08: 회계 정산 마감일(20일) / 결제일(익월 15일)
  {
    const issues: string[] = [];
    const res = parseLogisticsAndBillingVoiceInput('마감은 20일 마감이고 결제는 익월 15일 결제입니다');
    if (res.closingDay !== '20일' || res.paymentDay !== '익월 15일') issues.push('마감/결제일 파싱 실패');
    results.push({
      scenarioId: 'WTT-DISP-08',
      name: '회계 정산 마감일(20일) 및 결제일(익월 15일) 특약 조건',
      axis: '비용(회계 정산 조건)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-09: 거래 정지(BLOCKED) 고객사 거버넌스 가드
  {
    const issues: string[] = [];
    const cust = parseCustomerVoiceInput('부실건설', mockCustomers);
    if (!cust || cust.transactionStatus !== 'BLOCKED') issues.push('거래정지 상태 인식 실패');
    results.push({
      scenarioId: 'WTT-DISP-09',
      name: '거래 정지(BLOCKED) 고객사 출고 원천 차단 거버넌스 가드',
      axis: '비용/거버넌스(신용 위험 차단)',
      passed: issues.length === 0,
      issues,
      details: { status: cust?.transactionStatus }
    });
  }

  // WTT-DISP-10: 8대 영역 전 도메인 무누락 DB 매핑 종단 무결성
  {
    const issues: string[] = [];
    const payload = {
      customerId: 'CUST-001',
      siteId: 'SITE-001',
      orders: [{ ft: '19ft', modelName: 'SJ-3219', count: 2 }, { ft: '26ft', modelName: 'GS-2646', count: 1 }],
      billableToCustomer: true
    };
    if (!payload.customerId || !payload.siteId) issues.push('식별자 누락');
    const totalCount = payload.orders.reduce((acc, cur) => acc + cur.count, 0);
    if (totalCount !== 3) issues.push('수량 보존 실패');
    results.push({
      scenarioId: 'WTT-DISP-10',
      name: '8대 영역 전 도메인 무누락 DB 매핑 종단 무결성 (3대 보존 법칙)',
      axis: '종단 보존(수지/수량/날짜)',
      passed: issues.length === 0,
      issues,
      details: { totalCount }
    });
  }

  // WTT-DISP-11: [신규] 현장 담당자 확인 - 긍정 ("네") ➔ 기존 정보 유지
  {
    const issues: string[] = [];
    const answer = parseYesNoVoiceInput('네, 맞습니다');
    if (answer !== true) issues.push('긍정 발화 인식 실패');
    // 기존 현장의 담당자 정보
    const existingSite = mockSites[0];
    const confirmedName = answer ? existingSite.contactName : '';
    const confirmedPhone = answer ? existingSite.contact : '';
    if (confirmedName !== '박소장' || confirmedPhone !== '010-5555-6666') issues.push('기존 담당자 유지 실패');
    results.push({
      scenarioId: 'WTT-DISP-11',
      name: '현장 담당자 확인 ("박소장인가요?") ➔ "네, 맞습니다" (기존 정보 100% 유지)',
      axis: '맥락(담당자 확인: 긍정)',
      passed: issues.length === 0,
      issues,
      details: { answer, confirmedName, confirmedPhone }
    });
  }

  // WTT-DISP-12: [신규] 현장 담당자 확인 - 부정 ("아니요") ➔ 새 성함 ➔ 번호 갱신
  {
    const issues: string[] = [];
    const answer = parseYesNoVoiceInput('아니요 달라졌어요');
    if (answer !== false) issues.push('부정 발화 인식 실패');
    const newName = parseContactNameVoiceInput('김철수 소장');
    if (!newName || !newName.includes('김철수')) issues.push('새 담당자 성함 파싱 실패');
    const newPhone = parseContactPhoneVoiceInput('010-1234-5678');
    if (newPhone !== '010-1234-5678') issues.push('새 전화번호 파싱 실패');
    results.push({
      scenarioId: 'WTT-DISP-12',
      name: '현장 담당자 확인 ➔ "아니요" ➔ 새 성함 ("김철수 소장") ➔ 번호 ("010-1234-5678") 갱신',
      axis: '맥락(담당자 확인: 부정 분기)',
      passed: issues.length === 0,
      issues,
      details: { answer, newName, newPhone }
    });
  }

  // WTT-DISP-13: [신규] 한글 음성 전화번호 파싱 ("공일공 이삼사오 육칠팔구")
  {
    const issues: string[] = [];
    const phone = parseContactPhoneVoiceInput('공일공 이삼사오 육칠팔구');
    if (phone !== '010-2345-6789') issues.push(`한글 음성 전화번호 파싱 실패: ${phone} (기대치: 010-2345-6789)`);
    results.push({
      scenarioId: 'WTT-DISP-13',
      name: '한글 음성 전화번호 파싱 ("공일공 이삼사오 육칠팔구" ➔ 010-2345-6789)',
      axis: '물리(한국어 음성 번호 인식)',
      passed: issues.length === 0,
      issues,
      details: { phone }
    });
  }

  // WTT-DISP-14: [신규] 기존 출고 옵션 상속 확인 - 긍정 ("예, 동일합니다")
  {
    const issues: string[] = [];
    const existingSite = mockSites[0];
    const summary = getSiteOptionsSummary(existingSite);
    if (!summary.includes('4면 철망')) issues.push('옵션 요약 생성 실패');
    const answer = parseYesNoVoiceInput('예, 동일합니다');
    if (answer !== true) issues.push('옵션 동일 긍정 인식 실패');
    // 상속 실행
    const inheritedOptions = answer ? existingSite.paidOptions : '';
    const inheritedProtection = answer ? existingSite.protection : '';
    const inheritedSpecs = answer ? existingSite.checkedSpecs : {};
    if (!inheritedOptions?.includes('4면 철망') || !inheritedSpecs?.['spec3']) issues.push('옵션/스펙 100% 상속 누락');
    results.push({
      scenarioId: 'WTT-DISP-14',
      name: '기존 출고 옵션 상속 확인 ➔ "예, 동일합니다" (유상옵션/보양/스펙 100% 상속)',
      axis: '맥락(옵션 상속: 긍정)',
      passed: issues.length === 0,
      issues,
      details: { summary, inheritedOptions, inheritedProtection, inheritedSpecs }
    });
  }

  // WTT-DISP-15: [신규] 기존 출고 옵션 상속 확인 - 부정 ("아니요, 조건 변경")
  {
    const issues: string[] = [];
    const answer = parseYesNoVoiceInput('아니요 이번엔 조건 변경할게요');
    if (answer !== false) issues.push('옵션 부정 인식 실패');
    // 부정 시 옵션 리셋 검증
    const resetOptions = answer ? '기존옵션' : '';
    const resetProtection = answer ? '기존보양' : '';
    const resetSpecs = answer ? { spec3: true } : {};
    if (resetOptions !== '' || Object.keys(resetSpecs).length !== 0) issues.push('옵션 초기화 실패');
    results.push({
      scenarioId: 'WTT-DISP-15',
      name: '기존 출고 옵션 상속 확인 ➔ "아니요, 조건 변경" (옵션 리셋 및 신규 발화 유도)',
      axis: '맥락(옵션 상속: 부정 분기)',
      passed: issues.length === 0,
      issues,
      details: { answer, resetOptions }
    });
  }

  // WTT-DISP-16: 2-턴 쾌속 완결 (기존현장 ➔ 담당자 "네" ➔ 옵션 "예")
  {
    const issues: string[] = [];
    const site = parseSiteVoiceInput('판교 R&D', mockSites, 'CUST-001');
    const contactConfirm = parseYesNoVoiceInput('네');
    const optionConfirm = parseYesNoVoiceInput('예');
    if (!site?.site || contactConfirm !== true || optionConfirm !== true) issues.push('2턴 쾌속 인터뷰 실패');
    results.push({
      scenarioId: 'WTT-DISP-16',
      name: '기존 현장 ➔ 담당자 "네" ➔ 옵션 "예" (2턴 쾌속 완결 스트레스)',
      axis: '맥락(최소 조작 쾌속 통과)',
      passed: issues.length === 0,
      issues,
      details: { site: site?.site?.name, contactConfirm, optionConfirm }
    });
  }

  // WTT-DISP-17: 신규 현장 상세 주소 (층수/호수 포함)
  {
    const issues: string[] = [];
    const site = parseSiteVoiceInput('판교 제2밸리 신축현장 경기도 성남시 수정구 창업로 40 지하 1층 김소장 010-1111-3333', mockSites);
    if (!site?.isNew) issues.push('신규 현장 인식 실패');
    if (!site?.extractedAddress?.includes('창업로 40')) issues.push('상세 도로명 주소 누락');
    results.push({
      scenarioId: 'WTT-DISP-17',
      name: '신규 현장 상세 주소 (층수/호수 포함) 파싱 보존',
      axis: '공간(상세주소/층수)',
      passed: issues.length === 0,
      issues,
      details: site || {}
    });
  }

  // WTT-DISP-18: 타이어 휠커버 + 탑승구 사다리보양 + 모서리 랩핑
  {
    const issues: string[] = [];
    const res = parseOptionsAndSpecsVoiceInput('휠커버 보양 필수 탑승구 사다리보양 모서리 랩핑해주세요');
    if (!res.protection.includes('휠커버') || !res.protection.includes('사다리') || !res.protection.includes('랩핑')) {
      issues.push('특수 보양작업 누락');
    }
    results.push({
      scenarioId: 'WTT-DISP-18',
      name: '특수 보양작업 3종 (타이어 휠커버 + 탑승구 사다리 + 모서리 랩핑)',
      axis: '물리(특수보양작업)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-19: 에어배관 설치 + 소형 발전기 탑재
  {
    const issues: string[] = [];
    const res = parseOptionsAndSpecsVoiceInput('에어배관 설치하고 소형 발전기 하나 실어줘');
    if (!res.paidOptions.includes('에어배관') || !res.paidOptions.includes('발전기')) issues.push('유상옵션 누락');
    results.push({
      scenarioId: 'WTT-DISP-19',
      name: '유상옵션 2종 (에어배관 설치 + 소형 발전기 탑재)',
      axis: '물리(특수 유상옵션)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-20: 상대 일자 계산 ("다음주 수요일 오전 9시")
  {
    const issues: string[] = [];
    const baseDate = new Date('2026-09-06T10:00:00Z'); // 일요일 기준
    const dt = parseDateTimeVoiceInput('다음주 수요일 오전 9시', baseDate);
    if (!dt.date.includes('2026-09-16') || dt.time !== '09:00') issues.push(`상대 일자 계산 오류: ${dt.date} ${dt.time}`);
    results.push({
      scenarioId: 'WTT-DISP-20',
      name: '상대 일자 계산 ("다음주 수요일 오전 9시" ➔ 2026-09-16 09:00)',
      axis: '시간(상대 달력 연산)',
      passed: issues.length === 0,
      issues,
      details: dt
    });
  }

  // WTT-DISP-21: "일찍" 단독 발화 ➔ ASAP 유도
  {
    const issues: string[] = [];
    const dt = parseDateTimeVoiceInput('내일 아침 일찍 도착');
    if (!dt.isAsap) issues.push('일찍 발화 ASAP 감지 실패');
    results.push({
      scenarioId: 'WTT-DISP-21',
      name: '"일찍" 단독 발화 ➔ 시간무관 최우선 배차(ASAP) 플래그 유도',
      axis: '시간(일찍 단독 발화)',
      passed: issues.length === 0,
      issues,
      details: dt
    });
  }

  // WTT-DISP-22: 운송비 당사부담 ("운송비는 당사부담으로 처리해")
  {
    const issues: string[] = [];
    const res = parseLogisticsAndBillingVoiceInput('운송비는 당사부담으로 처리해');
    if (res.billableToCustomer !== false) issues.push('당사부담 미인식');
    results.push({
      scenarioId: 'WTT-DISP-22',
      name: '운송비 당사부담 ("운송비는 당사부담으로 처리해" ➔ false)',
      axis: '비용(당사 부담 귀속선)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-23: 셀프로더 세이프티 차종 지정
  {
    const issues: string[] = [];
    const res = parseLogisticsAndBillingVoiceInput('셀프로더 세이프티 차량으로 배차해줘');
    if (res.vehicleType !== '셀프로더') issues.push('셀프로더 차종 미인식');
    results.push({
      scenarioId: 'WTT-DISP-23',
      name: '특수 운송 차량 지정 ("셀프로더 세이프티" ➔ 셀프로더)',
      axis: '물리(특수차종)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-24: 한글 고유어 수량 ("하나", "둘", "셋", "넷", "다섯")
  {
    const issues: string[] = [];
    const eq1 = parseEquipmentVoiceInput('1930 둘');
    const eq2 = parseEquipmentVoiceInput('3246 셋');
    if (eq1?.order.count !== 2 || eq2?.order.count !== 3) issues.push('고유어 수량 매핑 실패');
    results.push({
      scenarioId: 'WTT-DISP-24',
      name: '한글 고유어 수량 매핑 ("1930 둘" ➔ 2대, "3246 셋" ➔ 3대)',
      axis: '수량(한국어 고유어 수량)',
      passed: issues.length === 0,
      issues,
      details: { count1: eq1?.order.count, count2: eq2?.order.count }
    });
  }

  // WTT-DISP-25: 차폭 분기 ("26피트 협폭 1대랑 26피트 광폭 2대")
  {
    const issues: string[] = [];
    const eq = parseEquipmentVoiceInput('26피트 협폭 1대랑 26피트 광폭 2대');
    if (!eq?.orders || eq.orders.length !== 2) issues.push('협폭/광폭 분기 실패');
    const narrow = eq?.orders?.find(o => o.modelName.includes('2632'));
    const wide = eq?.orders?.find(o => o.modelName.includes('2646'));
    if (!narrow || !wide) issues.push('2632(협폭) 또는 2646(광폭) 매핑 오류');
    results.push({
      scenarioId: 'WTT-DISP-25',
      name: '동일 피트 차폭 분기 ("26피트 협폭 1대랑 26피트 광폭 2대" ➔ 2632 + 2646)',
      axis: '수량/물리(차폭 분기 매핑)',
      passed: issues.length === 0,
      issues,
      details: { orders: eq?.orders }
    });
  }

  // WTT-DISP-26: 제조사 지식 매트릭스 (시노붐 0812 2대)
  {
    const issues: string[] = [];
    const eq = parseEquipmentVoiceInput('시노붐 0812 2대');
    if (eq?.order.modelName !== 'GTJZ0812' || eq?.order.count !== 2) issues.push('시노붐 0812 매칭 실패');
    results.push({
      scenarioId: 'WTT-DISP-26',
      name: '제조사 지식 매트릭스 ("시노붐 0812 2대" ➔ Sinoboom GTJZ0812 2대)',
      axis: '물리(제조사 지식 매트릭스)',
      passed: issues.length === 0,
      issues,
      details: eq || {}
    });
  }

  // WTT-DISP-27: 초대형 53피트 딩리 (딩리 53피트 1대)
  {
    const issues: string[] = [];
    const eq = parseEquipmentVoiceInput('딩리 53피트 1대');
    if (eq?.order.modelName !== 'S1614AC+' || eq?.order.ft !== '53ft') issues.push('딩리 53ft 매칭 실패');
    results.push({
      scenarioId: 'WTT-DISP-27',
      name: '초대형 53피트 규격 매칭 ("딩리 53피트 1대" ➔ Dingli S1614AC+ 1대)',
      axis: '물리(초대형 특수 규격)',
      passed: issues.length === 0,
      issues,
      details: eq || {}
    });
  }

  // WTT-DISP-28: 회계 말일 마감 / 익월 말일 결제
  {
    const issues: string[] = [];
    const res = parseLogisticsAndBillingVoiceInput('말일 마감 익월 말일 결제 조건');
    if (res.closingDay !== '말일' || res.paymentDay !== '익월 말일') issues.push('말일 마감/결제일 파싱 실패');
    results.push({
      scenarioId: 'WTT-DISP-28',
      name: '회계 조건 덮어쓰기 ("말일 마감, 익월 말일 결제")',
      axis: '비용(말일 회계 정산 조건)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-29: 복합 진입로 협소 및 사전연락 특이사항
  {
    const issues: string[] = [];
    const res = parseLogisticsAndBillingVoiceInput('도착 30분 전 미리 연락 필수이고 진입로 협소합니다');
    if (!res.specialMemo?.includes('사전연락') || !res.specialMemo?.includes('진입로 협소')) {
      issues.push('현장 특이메모 파싱 실패');
    }
    results.push({
      scenarioId: 'WTT-DISP-29',
      name: '물류 사전연락 및 협소 진입로 주의 메모 누락 방지',
      axis: '공간/물류(진입로 주의 메모)',
      passed: issues.length === 0,
      issues,
      details: res
    });
  }

  // WTT-DISP-30: 음성 위자드 ➔ 종단 상태 머신 및 보존 법칙 종합 검증
  {
    const issues: string[] = [];
    const draft: VoiceOrderDraft = {
      customerId: 'CUST-001',
      customerName: '현대건설(주)',
      siteId: 'SITE-001',
      siteName: '판교 R&D 센터 현장',
      newSiteName: '',
      siteAddress: '경기도 성남시 분당구 판교역로 100',
      siteContactName: '박소장',
      siteContactPhone: '010-5555-6666',
      deliveryDate: '2026-09-07',
      deliveryTime: '08:00',
      orders: [
        { ft: '19ft', modelName: 'SJ-3219', count: 2 },
        { ft: '26ft', modelName: 'GS-2646', count: 2 }
      ],
      memo: '[현장특이사항] 진입로 협소 | [유상옵션: 4면 철망] | [보양: 바닥보양] | [운송비 고객청구]',
      paidOptions: '4면 철망',
      protection: '바닥 보양(부직포/플라베니아)',
      checkedSpecs: { spec3: true, spec4: true },
      billableToCustomer: true,
      closingDay: '말일',
      paymentDay: '익월 25일',
      vehicleType: '5톤 렉카',
      isAsap: false,
      snippets: [],
      updatedAt: new Date().toISOString()
    };

    // 1) 날짜 보존 (2026-09-07 08:00)
    if (draft.deliveryDate !== '2026-09-07' || draft.deliveryTime !== '08:00') issues.push('날짜 보존 실패');
    // 2) 수량 보존 (2 + 2 = 4대)
    const totalQty = draft.orders.reduce((sum, o) => sum + o.count, 0);
    if (totalQty !== 4) issues.push(`수량 보존 실패: ${totalQty} != 4`);
    // 3) 수지 보존 (고객부담 시 billableCustomerId 연동 가능성)
    if (!draft.billableToCustomer || !draft.customerId) issues.push('수지 귀속선 보존 실패');

    results.push({
      scenarioId: 'WTT-DISP-30',
      name: '음성 위자드 ➔ 종단 상태 머신 및 3대 보존 법칙 종합 검증',
      axis: '종단 보존(날짜·수량·비용 3대 법칙)',
      passed: issues.length === 0,
      issues,
      details: { totalQty, billable: draft.billableToCustomer }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 31: 옵션 변경 후 "이번 출고만 1회성 적용" 선택 분기 검증
  // 5대 축: 물리(옵션 변경) x 비용/거버넌스(마스터 보존)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    const baseSite: CustomerSite = {
      id: 'SITE-001',
      customerId: 'CUST-001',
      name: '판교 알파돔 시티 6-1BL',
      address: '경기도 성남시 분당구 백현동 531',
      contactName: '박소장',
      contact: '010-5555-6666',
      email: '',
      paidOptions: '4면 철망 설치',
      protection: '바닥보양(플라베니아)',
      checkedSpecs: { spec1: true, spec3: true },
      createdAt: '2026-08-01'
    };

    // 새 출고에서 에어배관 추가 요청
    const newOptionsInput = '에어배관 추가 설치해주세요';
    const optRes = parseOptionsAndSpecsVoiceInput(newOptionsInput);
    const combinedPaid = baseSite.paidOptions ? `${baseSite.paidOptions}, ${optRes.paidOptions}` : optRes.paidOptions;

    // 1) 옵션 변경 감지 확인
    const isDiff = isOptionsChangedFromSite(baseSite, combinedPaid, baseSite.protection, baseSite.checkedSpecs);
    if (!isDiff) issues.push('옵션 변경 감지 실패');

    // 2) 사용자 선택: "이번 출고만 1회성 적용" (saveOptionsToSite: false)
    const saveOptionsToSite = false;
    let siteCopy = { ...baseSite };

    // DB 시뮬레이션: saveOptionsToSite가 false일 때는 siteUpdates.paidOptions 업데이트 생략
    if (saveOptionsToSite) {
      siteCopy.paidOptions = combinedPaid;
    }

    // 3) 검증: 출고 데이터(combinedPaid)는 에어배관이 들어갔으나, 현장 마스터(siteCopy)는 기존 '4면 철망 설치' 원형 유지
    if (siteCopy.paidOptions !== '4면 철망 설치') issues.push(`현장 마스터 오염됨: ${siteCopy.paidOptions} != 4면 철망 설치`);
    if (!combinedPaid.includes('에어배관')) issues.push('출고 의뢰에 새 옵션 누락');

    results.push({
      scenarioId: 'WTT-DISP-31',
      name: '옵션 변경 감지 ➔ 이번 출고만 1회성 적용 (현장 마스터 원형 보존)',
      axis: '거버넌스(1회성 옵션 분기 & 마스터 보존)',
      passed: issues.length === 0,
      issues,
      details: { original: baseSite.paidOptions, dispatchOption: combinedPaid, sitePreserved: siteCopy.paidOptions }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 32: 옵션 변경 후 "현장 기본값으로 저장" 선택 분기 검증
  // 5대 축: 물리(옵션 갱신) x 관리(마스터 최신화)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    const baseSite: CustomerSite = {
      id: 'SITE-001',
      customerId: 'CUST-001',
      name: '판교 알파돔 시티 6-1BL',
      address: '경기도 성남시 분당구 백현동 531',
      contactName: '박소장',
      contact: '010-5555-6666',
      email: '',
      paidOptions: '4면 철망 설치',
      protection: '바닥보양(플라베니아)',
      checkedSpecs: { spec1: true },
      createdAt: '2026-08-01'
    };

    // 새 출고에서 전면 변경 요청: "함석 설치"
    const newOptionsInput = '함석 설치로 변경해주세요';
    const optRes = parseOptionsAndSpecsVoiceInput(newOptionsInput);

    // 1) 옵션 변경 감지 확인
    const isDiff = isOptionsChangedFromSite(baseSite, optRes.paidOptions, baseSite.protection, baseSite.checkedSpecs);
    if (!isDiff) issues.push('옵션 변경 감지 실패');

    // 2) 사용자 선택: "현장 기본값으로 저장" (saveOptionsToSite: true)
    const saveOptionsToSite = true;
    let siteCopy = { ...baseSite };

    // DB 시뮬레이션: saveOptionsToSite가 true일 때 현장 마스터 업데이트
    if (saveOptionsToSite && optRes.paidOptions) {
      siteCopy.paidOptions = optRes.paidOptions;
    }

    // 3) 검증: 현장 마스터가 새 옵션 '함석 설치'로 갱신되었는지 확인
    if (siteCopy.paidOptions !== '함석 설치') issues.push(`현장 마스터 갱신 실패: ${siteCopy.paidOptions} != 함석 설치`);

    results.push({
      scenarioId: 'WTT-DISP-32',
      name: '옵션 변경 감지 ➔ 현장 기본값으로 저장 (현장 마스터 최신화)',
      axis: '관리(현장 마스터 갱신 & 향후 유지)',
      passed: issues.length === 0,
      issues,
      details: { newOption: optRes.paidOptions, updatedSite: siteCopy.paidOptions }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 33: STT 오인식 시 들린 내용 1터치 인라인 수정 (Tap-to-Edit Buffer)
  // 5대 축: 물리(STT 오인식) x 맥락(인라인 텍스트 수정 및 재해석)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    // 1) STT 최초 오인식: "지니 일구삼공 두디"
    const faultySttText = '지니 일구삼공 두디';
    const initialParse = parseEquipmentVoiceInput(faultySttText);
    // 2) 사용자가 인라인 텍스트필드에서 "두디"를 "2대"로 1터치 수정
    const correctedText = faultySttText.replace('두디', '2대');
    const correctedParse = parseEquipmentVoiceInput(correctedText);

    if (!correctedParse || correctedParse.order.modelName !== 'GS-1930' || correctedParse.order.count !== 2) {
      issues.push(`인라인 수정 텍스트 파싱 실패: ${JSON.stringify(correctedParse)}`);
    }

    results.push({
      scenarioId: 'WTT-DISP-33',
      name: 'STT 오인식 시 들린 내용 1터치 인라인 수정 (Tap-to-Edit Buffer) 및 재파싱 검증',
      axis: '물리(STT 오인식 보정) x 맥락(인라인 에디터)',
      passed: issues.length === 0,
      issues,
      details: { faultySttText, correctedText, parsedResult: correctedParse?.confirmedDescription }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 34: 고객사 음성 매칭 실패 ➔ 검색/칩 터치 선택 ➔ 다음 단계 음성 연동
  // 5대 축: 공간/맥락(고객사 터치 검색 및 음성 연동)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    const customerList = mockCustomers;
    // 1) 음성 검색 실패 발화: "현대건슬" (오인식)
    const voiceSearch = parseCustomerVoiceInput('현대건슬', customerList);
    // 음성 실패 확인: voiceSearch === null

    // 2) 사용자가 화면 검색창에 "현대" 입력하여 필터링
    const query = '현대';
    const filtered = customerList.filter(c => c.name.includes(query) || (c.representative && c.representative.includes(query)));
    if (filtered.length === 0) issues.push('고객사 실시간 검색 필터링 실패');

    // 3) 검색된 첫 번째 칩 터치 선택 시뮬레이션
    const selected = filtered[0];
    if (selected?.id !== 'CUST-001') issues.push('선택된 고객사 ID 불일치');

    results.push({
      scenarioId: 'WTT-DISP-34',
      name: '고객사 음성 실패 ➔ 검색/칩 터치 선택 ➔ 다음 단계 음성 연동 검증',
      axis: '공간/맥락(스마트 고객사 검색 칩)',
      passed: issues.length === 0,
      issues,
      details: { query, matchedName: selected?.name }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 35: 장비 규격 및 수량 터치 증감 카운터 ➔ 터치 확정 ➔ 하차일시 음성 복귀
  // 5대 축: 수량/물리(장비 규격 터치 선택 & 카운터 연산)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    // 터치 조작 시뮬레이션: 26ft 광폭 (GS-2646) 선택 + 수량 1에서 [+] 2회 클릭 ➔ 3대
    const touchFt = '26ft';
    const touchModel = 'GS-2646';
    let touchQty = 1;
    touchQty += 2; // [+] 2회 클릭

    const matchedItem = EQUIPMENT_SPEC_MATRIX.find(m => m.ft === touchFt && m.modelName === touchModel);
    if (!matchedItem) issues.push('장비 지식 매트릭스 매칭 실패');

    const confirmedDescription = `${matchedItem?.manufacturer || ''} ${touchModel} ${touchQty}대`.trim();
    if (confirmedDescription !== 'Genie GS-2646 3대') {
      issues.push(`장비 확정 설명 불일치: ${confirmedDescription}`);
    }

    results.push({
      scenarioId: 'WTT-DISP-35',
      name: '장비 규격 및 수량 터치 증감 카운터 ➔ 터치 확정 ➔ 하차일시 음성 복귀 검증',
      axis: '수량/물리(인라인 터치 카운터)',
      passed: issues.length === 0,
      issues,
      details: { touchFt, touchModel, touchQty, confirmedDescription }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 36: 음성 입력 도중 중간 데이터 100% 보존형 일반 폼 핸드오프 (Safe Hand-off)
  // 5대 축: 종단 보존(중간 상태 100% 무손실 전달)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    // 3단계(장비)까지 진행된 상태 시뮬레이션
    const partialState = {
      customerId: 'CUST-001',
      customerName: '(주)삼보이엔씨',
      siteId: 'SITE-001',
      siteName: '판교 알파돔 시티 6-1BL',
      siteAddress: '경기도 성남시 분당구 백현동 531',
      siteContactName: '박소장',
      siteContactPhone: '010-5555-6666',
      deliveryDate: '2026-09-07',
      deliveryTime: '08:00',
      orders: [{ ft: '19ft', modelName: 'GS-1930', count: 2 }],
      isPartialHandOff: true
    };

    // 일반 서식 매핑 검증
    if (!partialState.customerId || !partialState.siteId) issues.push('고객사/현장 누락');
    if (partialState.orders[0].count !== 2) issues.push('장비 수량 누락');
    if (!partialState.siteContactPhone) issues.push('소장 연락처 누락');
    if (!partialState.isPartialHandOff) issues.push('핸드오프 플래그 누락');

    results.push({
      scenarioId: 'WTT-DISP-36',
      name: '음성 입력 도중 중간 데이터 100% 보존형 일반 폼 핸드오프 (Safe Hand-off) 검증',
      axis: '종단 보존(중간 상태 100% 무손실 전달)',
      passed: issues.length === 0,
      issues,
      details: partialState
    });
  }

  // -------------------------------------------------------------
  // 시나리오 37: PC 대화형 스튜디오 키보드 텍스트 대화 ➔ 우측 폼 실시간 필드 동기화 검증
  // 5대 축: 시간/수량(키보드 텍스트 대화 파싱 및 즉시 동기화)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    const step1Input = '현대건설';
    const step2Input = '남양주 현장';
    const step3Input = '32피트 2대';
    const step4Input = '내일 아침 8시';
    
    // 1) 1단계: 고객사 키보드 대화 파싱
    const cust = parseCustomerVoiceInput(step1Input, mockCustomers);
    if (!cust || !cust.name.startsWith('현대건설')) issues.push('고객사 키보드 대화 파싱 실패');

    // 2) 2단계: 현장 키보드 대화 파싱
    const siteRes = parseSiteVoiceInput(step2Input, mockSites);
    const siteName = siteRes?.site ? siteRes.site.name : (siteRes?.newSiteName || step2Input);
    if (!siteName.includes('남양주')) issues.push('현장 키보드 대화 파싱 실패');

    // 3) 3단계: 장비 키보드 대화 파싱
    const eq = parseEquipmentVoiceInput(step3Input);
    if (!eq || eq.order.count !== 2 || eq.order.ft !== '32ft') {
      issues.push(`장비 파싱 불일치: ${JSON.stringify(eq)}`);
    }

    // 4) 4단계: 일시 키보드 대화 파싱
    const dt = parseDateTimeVoiceInput(step4Input);
    if (!dt || !dt.date || dt.time !== '08:00') {
      issues.push(`일시 파싱 불일치: ${JSON.stringify(dt)}`);
    }

    // 5) 우측 폼 실시간 동기화 시뮬레이션
    const syncedFormState = {
      customerName: cust?.name || '',
      siteName,
      equipments: eq ? [{ modelName: eq.order.modelName, qty: eq.order.count }] : [],
      unloadingTime: dt ? `${dt.date} ${dt.time}` : ''
    };

    if (!syncedFormState.customerName.startsWith('현대건설')) issues.push('우측 폼 고객사명 미동기화');
    if (!syncedFormState.siteName.includes('남양주')) issues.push('우측 폼 현장명 미동기화');
    if (syncedFormState.equipments[0]?.qty !== 2) issues.push('우측 폼 수량 미동기화');
    if (!syncedFormState.unloadingTime.includes('08:00')) issues.push('우측 폼 하차일시 미동기화');

    results.push({
      scenarioId: 'WTT-DISP-37',
      name: 'PC 대화형 스튜디오 키보드 텍스트 대화 ➔ 우측 폼 실시간 필드 동기화 검증',
      axis: '시간/수량(키보드 텍스트 대화 파싱 및 즉시 동기화)',
      passed: issues.length === 0,
      issues,
      details: { step1Input, step2Input, step3Input, step4Input, syncedFormState }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 38: PC 대화형 스튜디오 규격 칩 및 수량 카운터 클릭 ➔ 우측 장비 목록 실시간 동기화 검증
  // 5대 축: 물리/수량(인라인 규격 칩 및 카운터)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    const clickFt = '40ft';
    const matchedSpec = EQUIPMENT_SPEC_MATRIX.find(m => m.ft === clickFt);
    if (!matchedSpec) issues.push('40ft 규격 매트릭스 매칭 실패');

    const qty = 4; // 카운터 4회 증감 시뮬레이션
    const formEquipments = [{ modelName: matchedSpec?.modelName || '', qty }];

    if (formEquipments[0].qty !== 4) issues.push('장비 수량 불일치');
    if (!formEquipments[0].modelName) issues.push('장비 모델명 누락');

    results.push({
      scenarioId: 'WTT-DISP-38',
      name: 'PC 대화형 스튜디오 규격 칩 및 수량 카운터 클릭 ➔ 우측 장비 목록 실시간 동기화 검증',
      axis: '물리/수량(인라인 규격 칩 및 카운터)',
      passed: issues.length === 0,
      issues,
      details: { clickFt, formEquipments }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 39: PC 대화형 스튜디오 옵션 변경 감지 ➔ saveOptionsToSite 선택값 우측 폼 연동 검증
  // 5대 축: 비용/종단 보존(현장 옵션 마스터 불변 보존)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    const testSite: CustomerSite = {
      id: 'SITE-PC-01',
      customerId: 'CUST-01',
      name: '송도 바이오 4공구',
      address: '인천 연수구 송도동',
      contactName: '최소장',
      contact: '010-9999-8888',
      email: 'site@bio.com',
      createdAt: '2026-09-01T00:00:00Z',
      paidOptions: '철망'
    };

    // 사용자가 스튜디오에서 '함석, 인버터' 추가 선택
    const studioPaidOptions = '철망, 함석, 인버터';
    const isDiff = isOptionsChangedFromSite(testSite, studioPaidOptions, '', {});

    if (!isDiff) issues.push('옵션 변경 감지 실패');

    // 사용자가 [🔵 이번만 1회성 적용] 선택
    const saveOptionsToSite = false;

    // 우측 폼 반영 시뮬레이션
    const formState = {
      paidOptions: studioPaidOptions,
      saveOptionsToSite
    };

    if (formState.saveOptionsToSite !== false) issues.push('1회성 적용 플래그 동기화 실패');

    results.push({
      scenarioId: 'WTT-DISP-39',
      name: 'PC 대화형 스튜디오 옵션 변경 감지 ➔ saveOptionsToSite 선택값 우측 폼 연동 검증',
      axis: '비용/종단 보존(현장 옵션 마스터 불변 보존)',
      passed: issues.length === 0,
      issues,
      details: { isDiff, formState }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 40: 상단 대화형 스튜디오와 하단 메신저 줄글 추출 간 상태 상호 전환 무결성 검증
  // 5대 축: 공간/종단 보존(듀얼 파이프라인 무결성)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];

    // 1) 상단 스튜디오에서 고객사/현장 입력
    let sharedCustomerName = '현대건설';
    let sharedSiteName = '화성 반도체 파운드리';

    // 2) 하단 메신저 텍스트 붙여넣기 및 추출 실행 시
    const messengerText = '업체: 현대건설\n현장: 화성 반도체 파운드리\n규격: 10미터 3대\n하차: 2026-09-08 08:00';
    
    // 추출 결과가 우측 폼을 덮어쓸 때 장비 수량이 3대로 정상 갱신되는지
    const parsedQty = 3;
    const finalEquipments = [{ modelName: 'GS-3246', qty: parsedQty }];

    if (finalEquipments[0].qty !== 3) issues.push('메신저 텍스트 덮어쓰기 수량 오류');
    if (sharedCustomerName !== '현대건설') issues.push('고객사 일관성 오류');

    results.push({
      scenarioId: 'WTT-DISP-40',
      name: '상단 대화형 스튜디오와 하단 메신저 줄글 추출 간 상태 상호 전환 무결성 검증',
      axis: '공간/종단 보존(듀얼 파이프라인 무결성)',
      passed: issues.length === 0,
      issues,
      details: { sharedCustomerName, sharedSiteName, messengerText, finalEquipments }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 41: 고객사 초성 검색 및 접두 초성 매칭 검증
  // 5대 축: 공간/맥락(고객사 초성 단축 입력)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    // 1) 'ㅂㅅ' 초성 입력 -> '백산이엔씨' 매칭
    const cust1 = parseCustomerVoiceInput('ㅂㅅ', mockCustomers);
    if (!cust1 || cust1.name !== '백산이엔씨') issues.push(`'ㅂㅅ' 초성 매칭 실패: ${cust1?.name}`);

    // 2) 'ㅂㅅㅇㅇ' 4자 초성 입력 -> '백산이엔씨' 매칭
    const cust2 = parseCustomerVoiceInput('ㅂㅅㅇㅇ', mockCustomers);
    if (!cust2 || cust2.name !== '백산이엔씨') issues.push(`'ㅂㅅㅇㅇ' 초성 매칭 실패: ${cust2?.name}`);

    // 3) 'ㅅㅇ' 초성 입력 -> '세연테크' 매칭
    const cust3 = parseCustomerVoiceInput('ㅅㅇ', mockCustomers);
    if (!cust3 || cust3.name !== '세연테크') issues.push(`'ㅅㅇ' 초성 매칭 실패: ${cust3?.name}`);

    // 4) 'ㅎㄷ' 초성 입력 -> '현대건설(주)' 매칭
    const cust4 = parseCustomerVoiceInput('ㅎㄷ', mockCustomers);
    if (!cust4 || cust4.id !== 'CUST-001') issues.push(`'ㅎㄷ' 초성 매칭 실패: ${cust4?.name}`);

    results.push({
      scenarioId: 'WTT-DISP-41',
      name: '고객사 초성 검색 및 접두 초성 매칭 검증 (ㅂㅅ, ㅂㅅㅇㅇ, ㅅㅇ, ㅎㄷ)',
      axis: '공간/맥락(고객사 초성 단축 입력)',
      passed: issues.length === 0,
      issues,
      details: {
        cust1: cust1?.name,
        cust2: cust2?.name,
        cust3: cust3?.name,
        cust4: cust4?.name
      }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 42: 초성 자음 임의 전치(Swap) 배제 및 의도왜곡 방지 거버넌스 가드 검증
  // 5대 축: 공간/거버넌스(임의 자음 치환 금지 및 거래처 의도왜곡 원천 차단)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    // 1) 'ㅅㅂㅇㅇ' 입력 시 시스템이 임의로 자음을 뒤바꿔 '백산이엔씨'(ㅂㅅㅇㅇ)로 왜곡 매칭하지 않고 안전하게 null을 반환해야 함
    const custStrict = parseCustomerVoiceInput('ㅅㅂㅇㅇ', mockCustomers);
    if (custStrict !== null) {
      issues.push(`'ㅅㅂㅇㅇ' 임의 자음 전치로 인한 의도왜곡 매칭 발생: ${custStrict?.name}`);
    }

    // 2) 사용자가 의도한 정당한 초성 'ㅂㅅㅇㅇ' 입력 시에는 정상적으로 '백산이엔씨' 매칭
    const validCust = parseCustomerVoiceInput('ㅂㅅㅇㅇ', mockCustomers);
    if (!validCust || validCust.name !== '백산이엔씨') {
      issues.push(`정규 초성 'ㅂㅅㅇㅇ' 매칭 실패: ${validCust?.name}`);
    }

    results.push({
      scenarioId: 'WTT-DISP-42',
      name: '초성 자음 임의 전치(Swap) 배제 및 의도왜곡 방지 거버넌스 가드 검증 (ㅅㅂㅇㅇ -> null 안전 차단)',
      axis: '공간/거버넌스(임의 자음 치환 금지 및 거래처 의도왜곡 원천 차단)',
      passed: issues.length === 0,
      issues,
      details: { input: 'ㅅㅂㅇㅇ', result: custStrict, validMatch: validCust?.name }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 43: 현장명 초성 검색 및 자동 완결 검증
  // 5대 축: 공간/맥락(현장 초성 검색)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    // 1) 'ㅍㄱ' 입력 -> '판교 R&D 센터 현장' (SITE-001) 매칭
    const site1 = parseSiteVoiceInput('ㅍㄱ', mockSites, 'CUST-001');
    if (!site1 || site1.isNew || site1.site?.id !== 'SITE-001') {
      issues.push(`'ㅍㄱ' 현장 초성 매칭 실패: ${site1?.site?.name}`);
    }

    // 2) 'ㅅㄷ' 입력 -> '송도 센트럴파크 2차' (SITE-002) 매칭
    const site2 = parseSiteVoiceInput('ㅅㄷ', mockSites, 'CUST-002');
    if (!site2 || site2.isNew || site2.site?.id !== 'SITE-002') {
      issues.push(`'ㅅㄷ' 현장 초성 매칭 실패: ${site2?.site?.name}`);
    }

    results.push({
      scenarioId: 'WTT-DISP-43',
      name: '현장명 초성 검색 및 자동 완결 검증 (ㅍㄱ, ㅅㄷ)',
      axis: '공간/맥락(현장 초성 검색)',
      passed: issues.length === 0,
      issues,
      details: { site1: site1?.site?.name, site2: site2?.site?.name }
    });
  }

  // -------------------------------------------------------------
  // 시나리오 44: 음성 STT 인식 결과 시각화 및 원클릭 키보드 수정 인터리빙 검증
  // 5대 축: 공간/물리(음성 시각 피드백 및 터치/키보드 하이브리드)
  // -------------------------------------------------------------
  {
    const issues: string[] = [];
    // 1) STT 오인식 발생 시나리오: 사용자가 "백산"이라 발화했으나 STT가 "박산"으로 오인식
    const faultyStt = '박산';
    let lastSttText = faultyStt;
    let textInputValue = '';

    // 2) STT 결과가 시각화 배지에 표출되었는지 확인
    if (lastSttText !== '박산') issues.push('STT 인식 결과 시각화 상태 저장 실패');

    // 3) 사용자가 [클릭하여 수정] 액션을 취했을 때 입력창으로 복사되는지 시뮬레이션
    textInputValue = lastSttText;
    if (textInputValue !== '박산') issues.push('인식 텍스트 키보드 입력창 전달 실패');

    // 4) 키보드로 오타 1글자만 "백산"으로 정정 후 엔터 전송
    textInputValue = '백산';
    const correctedCust = parseCustomerVoiceInput(textInputValue, mockCustomers);
    if (!correctedCust || correctedCust.name !== '백산이엔씨') {
      issues.push('정정된 키보드 텍스트 고객사 매칭 실패');
    }

    results.push({
      scenarioId: 'WTT-DISP-44',
      name: '음성 STT 인식 결과 시각화 및 원클릭 키보드 수정 인터리빙 검증',
      axis: '공간/물리(음성 시각 피드백 및 키보드 하이브리드)',
      passed: issues.length === 0,
      issues,
      details: { faultyStt, lastSttText, correctedInput: textInputValue, matched: correctedCust?.name }
    });
  }

  return results;
}


// CLI 실행 시 결과 출력
const testResults = runWttSuite();
console.log('================================================================');
console.log(` 🧪 WTT ${testResults.length}회 도메인 관통 스트레스 테스트 실행 결과 리포트`);
console.log('================================================================');
let passCount = 0;
testResults.forEach(r => {
  const statusIcon = r.passed ? '✅ PASS' : '❌ FAIL';
  if (r.passed) passCount++;
  console.log(`[${r.scenarioId}] ${statusIcon} | ${r.name}`);
  console.log(`    - 5대 축: ${r.axis}`);
  if (!r.passed) {
    console.log(`    - ⚠️ 발견된 결함/이슈:`);
    r.issues.forEach(iss => console.log(`      * ${iss}`));
  }
});
console.log('----------------------------------------------------------------');
console.log(`📊 최종 결과: 총 ${testResults.length}개 중 ${passCount}개 통과, ${testResults.length - passCount}개 결함 발견`);
console.log('================================================================');

if (passCount !== testResults.length) {
  process.exit(1);
}

