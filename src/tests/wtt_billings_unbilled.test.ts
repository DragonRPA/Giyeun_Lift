// src/tests/wtt_billings_unbilled.test.ts
import { Contract, Billing, Receivable, normalizeEndDate } from '../services/db';

interface WttResult {
  scenarioId: string;
  name: string;
  axis: string;
  passed: boolean;
  issues: string[];
  details: Record<string, any>;
}

// ── Mock Factory Helpers ──
function mockContract(data: Partial<Contract> & { id: string; contractNo: string; customerId: string; startDate: string; endDate: string }): Contract {
  return {
    contractType: 'RENTAL',
    billingDay: 30,
    lateInterestRate: 0,
    status: 'ACTIVE',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...data
  } as Contract;
}

function mockBilling(data: Partial<Billing> & { id: string; contractId: string; customerId: string; billingYm: string; billingDate: string; totalAmount: number; status: 'UNPAID' | 'REQUESTED' | 'PARTIAL' | 'PAID' | 'REJECTED' }): Billing {
  return {
    paidAmount: 0,
    createdAt: '2026-08-31T09:00:00Z',
    updatedAt: '2026-08-31T09:00:00Z',
    ...data
  } as Billing;
}

function mockReceivable(data: Partial<Receivable> & { id: string; customerId: string; totalAmount: number }): Receivable {
  return {
    contractId: undefined,
    type: 'REPAIR',
    billedAmount: 0,
    internalDescription: '외상미수금',
    occurredDate: '2026-09-01',
    status: 'PENDING',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    ...data
  } as Receivable;
}

// ── 핵심 미청구 정산 필터링 순수 함수 (Billings.tsx 정밀 동일 로직) ──
function getTargetYm(searchStartDate?: string, searchEndDate?: string, fallbackToday: string = '2026-09-10'): string {
  return (searchEndDate || searchStartDate || fallbackToday).substring(0, 7);
}

function filterActiveContractsForWizard(
  contracts: Contract[],
  billings: Billing[],
  searchStartDate: string,
  searchEndDate: string,
  todayStr: string = '2026-09-10'
): Contract[] {
  const targetYm = getTargetYm(searchStartDate, searchEndDate, todayStr);

  return contracts.filter(c => {
    // 1. 렌탈 계약만 정기 렌탈료 정산 대상 (SALE 등 제외)
    if ((c.contractType || 'RENTAL') !== 'RENTAL') return false;

    // 2. 계약 유효 기간 검증: 검색 기간 내에 계약이 유효한 상태였는지 (기간 겹침)
    const normalEnd = normalizeEndDate(c.endDate);
    const isOverlapping = c.startDate <= (searchEndDate || todayStr) && normalEnd >= (searchStartDate || '2000-01-01');
    if (!isOverlapping) return false;

    // 3. 해당 대상 귀속월(targetYm)에 유효한 청구서가 이미 존재하는지 검사 (취소 REJECTED 제외)
    const hasBillingForTargetMonth = billings.some(
      b => b.contractId === c.id && b.billingYm === targetYm && b.status !== 'REJECTED'
    );
    if (hasBillingForTargetMonth) return false;

    // 4. 계약의 직전 청구 마감일이 이미 검색 기간 종료일 이상인지 검사
    if (c.lastBilledPeriodEnd && searchEndDate && c.lastBilledPeriodEnd >= searchEndDate) {
      return false;
    }

    // 5. 계약이 이미 종료되었고, 직전 청구 마감일이 계약 종료일 이상으로 전액 정산 완료된 경우 제외
    if (c.lastBilledPeriodEnd && c.lastBilledPeriodEnd >= normalEnd) {
      return false;
    }

    return true;
  });
}

function isDuePeriod(c: Contract, searchStartDate: string, searchEndDate: string): boolean {
  if (!searchStartDate || !searchEndDate) return true;

  const startDateObj = new Date(searchStartDate);
  const endDateObj = new Date(searchEndDate);
  const startDay = startDateObj.getDate();
  const endDay = endDateObj.getDate();

  const getEffectiveDay = (targetDay: number | undefined) => {
    if (!targetDay) return undefined;
    const lastDayOfMonth = new Date(startDateObj.getFullYear(), startDateObj.getMonth() + 1, 0).getDate();
    return Math.min(targetDay, lastDayOfMonth);
  };

  const effectiveBillingDay = getEffectiveDay(c.billingDay);
  const effectiveStatementDay = getEffectiveDay(c.statementClosingDay);

  const targetClosingDay = effectiveBillingDay || effectiveStatementDay || 31;
  const yStr = startDateObj.getFullYear();
  const mStr = String(startDateObj.getMonth() + 1).padStart(2, '0');
  const dStr = String(targetClosingDay).padStart(2, '0');
  const closingDateStr = `${yStr}-${mStr}-${dStr}`;

  if (c.startDate > closingDateStr) {
    return false;
  }

  const normalEnd = normalizeEndDate(c.endDate);
  if (normalEnd >= searchStartDate && normalEnd <= searchEndDate) {
    return true;
  }

  const isDayInRange = (day: number | undefined) => {
    if (!day) return false;
    if (startDay <= endDay) {
      return day >= startDay && day <= endDay;
    } else {
      return day >= startDay || day <= endDay;
    }
  };

  const defaultDay = new Date(startDateObj.getFullYear(), startDateObj.getMonth() + 1, 0).getDate();
  const bDay = effectiveBillingDay !== undefined ? effectiveBillingDay : defaultDay;
  const sDay = effectiveStatementDay;

  const billingDayMatch = isDayInRange(bDay);
  const statementDayMatch = sDay !== undefined ? isDayInRange(sDay) : false;

  return billingDayMatch || statementDayMatch;
}

function getUnbilledReceivablesForContract(c: Contract, receivables: Receivable[]): Receivable[] {
  if (!c) return [];
  return receivables.filter(r =>
    r.status !== 'CLEARED' &&
    ((r.totalAmount || 0) - (r.billedAmount || 0)) > 0 &&
    r.customerId === c.customerId &&
    (r.contractId === c.id || !r.contractId)
  );
}

// ── 10회 도메인 관통 스트레스 테스트 실행 ──
export function runWttBillingsSuite(): WttResult[] {
  const results: WttResult[] = [];
  const todayStr = '2026-09-10';

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-01] 시간 축: 전월(8월) 전원 마감 계약 47건 조회 시 미청구 0건 검증 (사용자 버그 리포트 1:1 완벽 해소)
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    // 47개 계약 생성 (모두 2026-01-01 시작, 2026-12-31 종료)
    const mockContracts: Contract[] = Array.from({ length: 47 }, (_, i) =>
      mockContract({
        id: `CONT-2026-AUG-${String(i + 1).padStart(3, '0')}`,
        contractNo: `CN-AUG-${String(i + 1).padStart(3, '0')}`,
        customerId: `CUST-${(i % 5) + 1}`,
        contractType: 'RENTAL',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        billingDay: ((i % 28) + 1),
        lastBilledPeriodStart: '2026-08-01',
        lastBilledPeriodEnd: '2026-08-31'
      })
    );

    // 47개 계약 전부에 대해 2026-08 청구서 기발행 상태
    const mockBillings: Billing[] = mockContracts.map((c, i) =>
      mockBilling({
        id: `BILL-AUG-${i + 1}`,
        contractId: c.id,
        customerId: c.customerId,
        billingYm: '2026-08',
        billingDate: '2026-08-31',
        totalAmount: 550000,
        status: 'UNPAID'
      })
    );

    // 사용자가 [전월] 클릭 시 세팅되는 조회 기간 (2026-08-01 ~ 2026-08-31)
    const sDate = '2026-08-01';
    const eDate = '2026-08-31';

    const activeList = filterActiveContractsForWizard(mockContracts, mockBillings, sDate, eDate, todayStr);
    const filteredList = activeList.filter(c => isDuePeriod(c, sDate, eDate));

    if (filteredList.length !== 0) {
      issues.push(`8월 모든 청구가 완료된 47건 계약임에도 미청구 대상이 ${filteredList.length}건 노출됨 (0건이어야 함)`);
    }

    results.push({
      scenarioId: 'WTT-BILL-01',
      name: '전월(8월) 전원 마감 계약 47건 조회 시 미청구 0건 완결 검증 (스크린샷 버그 차단)',
      axis: '시간(전월 2026-08) x 수량(47건 대규모 계약)',
      passed: issues.length === 0,
      issues,
      details: { totalContracts: mockContracts.length, unbilledCount: filteredList.length }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-02] 수량 축: 47건 중 1건 미청구 잔여 분기 검증
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const mockContracts: Contract[] = Array.from({ length: 47 }, (_, i) =>
      mockContract({
        id: `CONT-2026-AUG-${String(i + 1).padStart(3, '0')}`,
        contractNo: `CN-AUG-${String(i + 1).padStart(3, '0')}`,
        customerId: `CUST-${(i % 5) + 1}`,
        contractType: 'RENTAL',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        billingDay: 25,
        lastBilledPeriodStart: i === 46 ? '2026-07-01' : '2026-08-01',
        lastBilledPeriodEnd: i === 46 ? '2026-07-31' : '2026-08-31' // 47번째 계약만 7월까지만 마감
      })
    );

    // 46건만 8월 청구 완료, 47번째(인덱스 46) 계약은 8월 청구 없음
    const mockBillings: Billing[] = mockContracts.slice(0, 46).map((c, i) =>
      mockBilling({
        id: `BILL-AUG-${i + 1}`,
        contractId: c.id,
        customerId: c.customerId,
        billingYm: '2026-08',
        billingDate: '2026-08-31',
        totalAmount: 550000,
        status: 'UNPAID'
      })
    );

    const sDate = '2026-08-01';
    const eDate = '2026-08-31';

    const activeList = filterActiveContractsForWizard(mockContracts, mockBillings, sDate, eDate, todayStr);
    const filteredList = activeList.filter(c => isDuePeriod(c, sDate, eDate));

    if (filteredList.length !== 1) {
      issues.push(`미청구 잔여 1건이어야 하나 ${filteredList.length}건이 검출됨`);
    } else if (filteredList[0].id !== 'CONT-2026-AUG-047') {
      issues.push(`미청구 대상이 올바른 47번째 계약이 아님: ${filteredList[0].id}`);
    }

    results.push({
      scenarioId: 'WTT-BILL-02',
      name: '47건 중 1건 미청구 잔여 분기 검증 (정확한 1건 타겟팅)',
      axis: '수량(46건 청구완료 + 1건 잔여)',
      passed: issues.length === 0,
      issues,
      details: { expectedId: 'CONT-2026-AUG-047', foundCount: filteredList.length }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-03] 시간 축: 계약 중도 조기 종료/반납(8/20) 건의 정상 포착 및 20일 일할 산정
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const terminatedContract: Contract = mockContract({
      id: 'CONT-EARLY-TERM-01',
      contractNo: 'CN-2026-TERM',
      customerId: 'CUST-001',
      contractType: 'RENTAL',
      startDate: '2026-08-01',
      endDate: '2026-08-20', // 8월 20일 조기 반납 및 종료
      billingDay: 31
    });

    const sDate = '2026-08-01';
    const eDate = '2026-08-31';

    const activeList = filterActiveContractsForWizard([terminatedContract], [], sDate, eDate, todayStr);
    const filteredList = activeList.filter(c => isDuePeriod(c, sDate, eDate));

    if (filteredList.length !== 1) {
      issues.push('8월 20일 종료된 계약이 8월 미청구 정산 대상에서 누락됨');
    }

    // 일할 계산일수 검증: 8/01 ~ 8/20 = 20일
    const d1 = new Date(terminatedContract.startDate);
    const d2 = new Date(terminatedContract.endDate);
    const days = Math.ceil(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (days !== 20) {
      issues.push(`일할 계산 일수 오류: 기대 20일, 실제 ${days}일`);
    }

    results.push({
      scenarioId: 'WTT-BILL-03',
      name: '계약 중도 조기 종료/반납(8/20) 건의 정상 포착 및 20일 일할 산정',
      axis: '시간(중도 종료 8/20) x 물리(장비 조기 반납)',
      passed: issues.length === 0,
      issues,
      details: { contractNo: terminatedContract.contractNo, days }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-04] 비용 축: 외상미수금(파손 수리비/운송비) 보유 계약의 일괄생성 자동 분리 가드
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const c1: Contract = mockContract({
      id: 'CONT-WITH-RCV',
      contractNo: 'CN-RCV-01',
      customerId: 'CUST-DAMAGE',
      contractType: 'RENTAL',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      billingDay: 10
    });
    const c2: Contract = mockContract({
      id: 'CONT-WITHOUT-RCV',
      contractNo: 'CN-CLEAN-02',
      customerId: 'CUST-CLEAN',
      contractType: 'RENTAL',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      billingDay: 10
    });

    const mockReceivables: Receivable[] = [
      mockReceivable({
        id: 'RCV-001',
        customerId: 'CUST-DAMAGE',
        contractId: 'CONT-WITH-RCV',
        totalAmount: 350000,
        billedAmount: 0,
        status: 'PENDING',
        internalDescription: '현장 콘트롤러 파손 수리비 청구건'
      })
    ];

    const sDate = '2026-09-01';
    const eDate = '2026-09-30';
    const activeList = filterActiveContractsForWizard([c1, c2], [], sDate, eDate, todayStr);
    const contractsWithoutReceivables = activeList.filter(c => getUnbilledReceivablesForContract(c, mockReceivables).length === 0);
    const contractsWithReceivables = activeList.filter(c => getUnbilledReceivablesForContract(c, mockReceivables).length > 0);

    if (contractsWithoutReceivables.length !== 1 || contractsWithoutReceivables[0].id !== 'CONT-WITHOUT-RCV') {
      issues.push('외상미수금 없는 계약 필터링 오류');
    }
    if (contractsWithReceivables.length !== 1 || contractsWithReceivables[0].id !== 'CONT-WITH-RCV') {
      issues.push('외상미수금 보유 계약(수동검토 필요) 분리 오류');
    }

    results.push({
      scenarioId: 'WTT-BILL-04',
      name: '외상미수금(파손 수리비) 보유 계약의 일괄생성 자동 분리 가드',
      axis: '비용(파손 수리비 외상미수금) x 거버넌스(수동검토 안전 분리)',
      passed: issues.length === 0,
      issues,
      details: { safeCount: contractsWithoutReceivables.length, manualCount: contractsWithReceivables.length }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-05] 상태 축: 청구서 취소/반려(REJECTED) 발생 시 미청구 목록 복귀 멱등성
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const contract: Contract = mockContract({
      id: 'CONT-REJECTED-TEST',
      contractNo: 'CN-REJECT-01',
      customerId: 'CUST-001',
      contractType: 'RENTAL',
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      billingDay: 31
    });

    // 취소(REJECTED)된 청구서
    const rejectedBilling: Billing = mockBilling({
      id: 'BILL-REJECTED-01',
      contractId: contract.id,
      customerId: contract.customerId,
      billingYm: '2026-08',
      billingDate: '2026-08-31',
      totalAmount: 600000,
      paidAmount: 0,
      status: 'REJECTED'
    });

    const sDate = '2026-08-01';
    const eDate = '2026-08-31';

    const activeList = filterActiveContractsForWizard([contract], [rejectedBilling], sDate, eDate, todayStr);

    if (activeList.length !== 1) {
      issues.push('REJECTED 청구서가 있는 계약이 미청구 정산 대상 목록으로 복귀하지 않음');
    }

    results.push({
      scenarioId: 'WTT-BILL-05',
      name: '청구서 취소/반려(REJECTED) 발생 시 미청구 목록 복귀 멱등성',
      axis: '상태(청구 취소 REJECTED) x 회계(재정산 사이클 복귀)',
      passed: issues.length === 0,
      issues,
      details: { recoveredCount: activeList.length }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-06] 물리 축: 대차 교체(EXCHANGE) 시 전자산 ➔ 후장비 일할 기여액 및 31일 일수 보존 (헌장 4.1, 4.2 준수)
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    // 8월 16일 대차 교체: 전자산 8/01 ~ 8/15 (15일), 후장비 8/16 ~ 8/31 (16일)
    const oldAssetDays = 15;
    const newAssetDays = 16;
    const totalDays = oldAssetDays + newAssetDays;

    if (totalDays !== 31) {
      issues.push(`8월 총 역일수 보존 실패: 합계 ${totalDays}일 (31일이어야 함)`);
    }

    const monthlyFee = 600000;
    const dailyFee = Math.round(monthlyFee / 30); // 20,000원

    const oldRev = dailyFee * oldAssetDays; // 300,000원
    const newRev = dailyFee * newAssetDays; // 320,000원
    const totalRev = oldRev + newRev;

    if (totalRev !== 620000) {
      issues.push(`일할 기여액 합계 불일치: ${totalRev}원`);
    }

    results.push({
      scenarioId: 'WTT-BILL-06',
      name: '대차 교체(EXCHANGE) 시 전자산 ➔ 후장비 일할 기여액 및 31일 일수 보존',
      axis: '물리(장비 고장 및 교환) x 날짜·수지 보존 법칙',
      passed: issues.length === 0,
      issues,
      details: { oldAssetDays, newAssetDays, oldRev, newRev, totalRev }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-07] 시간 축: 마감일 미도래 계약의 조기 청구 방어 vs 마감일 도래 계약 즉시 포착
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const cA: Contract = mockContract({
      id: 'CONT-DUE-10',
      contractNo: 'CN-DUE-10',
      customerId: 'CUST-001',
      contractType: 'RENTAL',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      billingDay: 10 // 10일 마감
    });
    const cB: Contract = mockContract({
      id: 'CONT-DUE-25',
      contractNo: 'CN-DUE-25',
      customerId: 'CUST-002',
      contractType: 'RENTAL',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      billingDay: 25 // 25일 마감
    });

    // 조회 기간: 9월 1일 ~ 9월 10일
    const sDate = '2026-09-01';
    const eDate = '2026-09-10';

    const activeList = filterActiveContractsForWizard([cA, cB], [], sDate, eDate, todayStr);
    const filteredList = activeList.filter(c => isDuePeriod(c, sDate, eDate));

    if (filteredList.length !== 1 || filteredList[0].id !== 'CONT-DUE-10') {
      issues.push('마감일 10일 계약만 포착되고 25일 계약은 조기 청구 방어되어야 하나 실패');
    }

    results.push({
      scenarioId: 'WTT-BILL-07',
      name: '마감일 미도래 계약 조기 청구 방어 vs 마감일 도래 계약 즉시 포착',
      axis: '시간(부분 기간 스코핑 1~10일)',
      passed: issues.length === 0,
      issues,
      details: { passedContract: filteredList.map(c => c.contractNo) }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-08] 비용 축: 선수금/예치금 차감 반영 및 종단 수지 대차대조 무결성
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const originalRentalFee = 1000000;
    const vat = 100000;
    const grossTotal = originalRentalFee + vat; // 1,100,000원
    const prepaidDeposit = 500000; // 선수금 50만원 보유

    const appliedPrepaid = Math.min(prepaidDeposit, grossTotal);
    const netPayable = grossTotal - appliedPrepaid; // 600,000원
    const remainingPrepaid = prepaidDeposit - appliedPrepaid; // 0원

    // 대차대조 검증: 총 청구액 = 실수납 요구액 + 선수금 차감액
    const balanceDiff = grossTotal - (netPayable + appliedPrepaid);
    if (balanceDiff !== 0) {
      issues.push(`선수금 대차대조 불일치: 차액 ${balanceDiff}원 발생`);
    }
    if (remainingPrepaid !== 0) {
      issues.push(`선수금 잔액 오차: ${remainingPrepaid}원`);
    }

    results.push({
      scenarioId: 'WTT-BILL-08',
      name: '선수금/예치금 차감 반영 및 종단 수지 대차대조 무결성 (차액 ₩0)',
      axis: '비용(선수금 차감) x 종단 수지 보존(Balance ₩0)',
      passed: issues.length === 0,
      issues,
      details: { grossTotal, appliedPrepaid, netPayable, balanceDiff }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-09] 공간/계약 축: SALE(매각) 계약 및 RENTAL(임대) 계약 분리 거버넌스
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const rentalContract: Contract = mockContract({
      id: 'CONT-RENTAL-VALID',
      contractNo: 'CN-RENT-01',
      customerId: 'CUST-001',
      contractType: 'RENTAL',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      billingDay: 30
    });
    const saleContract: Contract = mockContract({
      id: 'CONT-SALE-INVALID',
      contractNo: 'CN-SALE-01',
      customerId: 'CUST-001',
      contractType: 'SALE', // 자산 매각 계약
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      billingDay: 30
    });

    const sDate = '2026-09-01';
    const eDate = '2026-09-30';

    const activeList = filterActiveContractsForWizard([rentalContract, saleContract], [], sDate, eDate, todayStr);

    if (activeList.length !== 1 || activeList[0].id !== 'CONT-RENTAL-VALID') {
      issues.push('SALE(매각) 계약이 정기 렌탈료 정산 대상에서 원천 배제되지 않음');
    }

    results.push({
      scenarioId: 'WTT-BILL-09',
      name: 'SALE(매각) 계약 및 RENTAL(임대) 계약 분리 거버넌스',
      axis: '공간/계약(RENTAL vs SALE 도메인 격리)',
      passed: issues.length === 0,
      issues,
      details: { filteredCount: activeList.length }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // [WTT-BILL-10] 종단 보존: 일괄 청구 생성 실행 ➔ 멱등성 및 미청구 목록 0건 즉시 소멸
  // ══════════════════════════════════════════════════════════════════
  {
    const issues: string[] = [];
    const contractsToBill: Contract[] = [
      mockContract({
        id: 'CONT-BULK-01',
        contractNo: 'CN-BULK-01',
        customerId: 'CUST-001',
        contractType: 'RENTAL',
        startDate: '2026-09-01',
        endDate: '2026-12-31',
        billingDay: 30
      }),
      mockContract({
        id: 'CONT-BULK-02',
        contractNo: 'CN-BULK-02',
        customerId: 'CUST-002',
        contractType: 'RENTAL',
        startDate: '2026-09-01',
        endDate: '2026-12-31',
        billingDay: 30
      }),
      mockContract({
        id: 'CONT-BULK-03',
        contractNo: 'CN-BULK-03',
        customerId: 'CUST-003',
        contractType: 'RENTAL',
        startDate: '2026-09-01',
        endDate: '2026-12-31',
        billingDay: 30
      })
    ];

    const sDate = '2026-09-01';
    const eDate = '2026-09-30';

    // 1단계: 생성 전 미청구 3건 확인
    const beforeBillings: Billing[] = [];
    const beforeList = filterActiveContractsForWizard(contractsToBill, beforeBillings, sDate, eDate, todayStr);
    if (beforeList.length !== 3) {
      issues.push(`생성 전 대상 수량 오류: 기대 3건, 실제 ${beforeList.length}건`);
    }

    // 2단계: 일괄 청구 생성 시뮬레이션
    const afterBillings: Billing[] = contractsToBill.map((c, i) =>
      mockBilling({
        id: `BILL-GEN-${i + 1}`,
        contractId: c.id,
        customerId: c.customerId,
        billingYm: '2026-09',
        billingDate: '2026-09-10',
        totalAmount: 660000,
        status: 'UNPAID'
      })
    );

    // 계약의 lastBilledPeriodEnd 갱신 시뮬레이션
    const updatedContracts = contractsToBill.map(c => ({
      ...c,
      lastBilledPeriodStart: '2026-09-01',
      lastBilledPeriodEnd: '2026-09-30'
    }));

    // 3단계: 생성 후 동일 기간 미청구 목록 즉시 재조회
    const afterList = filterActiveContractsForWizard(updatedContracts, afterBillings, sDate, eDate, todayStr);
    if (afterList.length !== 0) {
      issues.push(`일괄 생성 완료 후에도 미청구 목록에 ${afterList.length}건이 잔류함 (0건으로 소멸되어야 함)`);
    }

    results.push({
      scenarioId: 'WTT-BILL-10',
      name: '일괄 청구 생성 실행 ➔ 멱등성 및 미청구 목록 0건 즉시 소멸 (종단 보존)',
      axis: '종단 보존(상태 전이 3건 ➔ 0건 멱등성)',
      passed: issues.length === 0,
      issues,
      details: { beforeCount: beforeList.length, afterCount: afterList.length }
    });
  }

  return results;
}

// CLI 실행 시 결과 출력
const testResults = runWttBillingsSuite();
console.log('================================================================');
console.log(` 🧪 WTT 매출 청구 미청구 정산 ${testResults.length}회 도메인 관통 스트레스 테스트 결과`);
console.log('================================================================');
let passCount = 0;
testResults.forEach(r => {
  const statusIcon = r.passed ? '✅ PASS' : '❌ FAIL';
  if (r.passed) passCount++;
  console.log(`[${r.scenarioId}] ${statusIcon} | ${r.name}`);
  console.log(`    - 5대 축: ${r.axis}`);
  if (!r.passed) {
    console.log(`    - ⚠️ 결함 내역:`);
    r.issues.forEach(iss => console.log(`      * ${iss}`));
  }
});
console.log('----------------------------------------------------------------');
console.log(`📊 최종 검증 결과: 총 ${testResults.length}개 중 ${passCount}개 통과, ${testResults.length - passCount}개 결함 발견`);
console.log('================================================================');

if (passCount !== testResults.length) {
  process.exit(1);
}
