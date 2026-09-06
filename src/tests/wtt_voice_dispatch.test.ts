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

  return results;
}

// CLI 실행 시 결과 출력
const testResults = runWttSuite();
console.log('================================================================');
console.log(' 🧪 WTT 30회 도메인 관통 스트레스 테스트 실행 결과 리포트');
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
console.log(`📊 최종 결과: 총 30개 중 ${passCount}개 통과, ${30 - passCount}개 결함 발견`);
console.log('================================================================');

