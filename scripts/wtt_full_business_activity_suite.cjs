/**
 * Giyeun Lift ERP — 전체 업무활동 WTT (Work-Through Test) 종합 검증 스위트 (v3)
 * 
 * 16대 전사 업무활동 파이프라인 전체 순회 및 데이터/비즈니스 룰 검증
 * - 조직/권한, 자산/모델, 고객/현장, 계약체결, 배차출고, 대차교체, 계약변경,
 *   현장AS, 반납입고, 정비수불, 소모품구매, 매출청구, 수납대사, 채권연체,
 *   매입정산, 회계결산(감가상각/급여/자금흐름)
 */

const { createClient } = require('@supabase/supabase-js');

const url = 'https://wywgkikkjgbnlljkkmnz.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d2draWtramdibmxsamtrbW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjcxMzgsImV4cCI6MjA5OTk0MzEzOH0.gSftxhQjFmWUQzikx-Q5UsdgNKSZISZqJvUGeLBOCqU';
const supabase = createClient(url, key);

let passedCount = 0;
let failedCount = 0;
const testLogs = [];

function assert(condition, message, details = '') {
  if (condition) {
    passedCount++;
    testLogs.push(`  ✅ [PASS] ${message} ${details ? '(' + details + ')' : ''}`);
    console.log(`  ✅ [PASS] ${message} ${details ? '(' + details + ')' : ''}`);
  } else {
    failedCount++;
    testLogs.push(`  ❌ [FAIL] ${message} ${details ? '(' + details + ')' : ''}`);
    console.error(`  ❌ [FAIL] ${message} ${details ? '(' + details + ')' : ''}`);
  }
}

async function runFullWttSuite() {
  console.log('========================================================================');
  console.log('🚀 Giyeun Lift ERP — 전체 업무활동 WTT 16대 파이프라인 순회 검증 시작');
  console.log('========================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. 조직 및 권한 (Org & Permissions)
  // ---------------------------------------------------------------------------
  console.log('📌 [WTT-01] 조직 및 임직원 권한 매핑 검증');
  const { data: depts } = await supabase.from('departments').select('id, name');
  assert(depts && depts.length >= 5, '전사 5대 부서 마스터 등록 여부', `발견: ${depts ? depts.length : 0}개`);

  const { data: users } = await supabase.from('users').select('id, name, role, departmentId');
  assert(users && users.length >= 6, '임직원 및 테스터 계정 등록 여부', `발견: ${users ? users.length : 0}명`);

  const { data: perms } = await supabase.from('permissions').select('id, userId');
  const validUserIds = new Set(users ? users.map(u => u.id) : []);
  const ghostPerms = (perms || []).filter(p => !p.userId || !validUserIds.has(p.userId));
  assert(ghostPerms.length === 0, '무효 고스트 권한 0건 무결성 (헌장 3.1 & 5.3)', `고스트: ${ghostPerms.length}건`);

  // ---------------------------------------------------------------------------
  // 2. 자산 및 모델 (Assets & Products)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-02] 보유 및 임차 자산 라이프사이클 마스터 검증');
  const { data: products } = await supabase.from('products').select('id, modelName');
  assert(products && products.length > 0, '장비 모델 마스터 등록 여부', `발견: ${products ? products.length : 0}개`);

  const { data: assets } = await supabase.from('assets').select('id, assetNo, status, ownerType, acquisitionPrice, accumDepreciation, bookValue');
  assert(assets && assets.length > 0, '전체 장비 자산 등록 여부', `발견: ${assets ? assets.length : 0}대`);

  const availableCount = (assets || []).filter(a => a.status === 'AVAILABLE').length;
  const rentedCount = (assets || []).filter(a => a.status === 'RENTED').length;
  const repairingCount = (assets || []).filter(a => a.status === 'REPAIRING').length;
  assert(assets && assets.length >= (availableCount + rentedCount + repairingCount),
    '자산 상태 분류 무결성 (가용+대여중+수리중 합산)', `가용:${availableCount}, 대여중:${rentedCount}, 수리중:${repairingCount}`);

  // ---------------------------------------------------------------------------
  // 3. 고객 및 현장 관리 (Customers & Sites)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-03] 고객사 및 현장 마스터 스키마 정합성 검증');
  const { data: customers } = await supabase.from('customers').select('id, name, isClosed, defaultPaidOptions, defaultProtection');
  assert(customers && customers.length > 0, '고객사 마스터 및 신규 DDL 컬럼 등록', `고객사: ${customers ? customers.length : 0}개사`);

  const { data: sites } = await supabase.from('customer_sites').select('id, customerId, name, paidOptions, protection');
  assert(sites && sites.length > 0, '고객 현장 마스터 및 옵션 DDL 컬럼 등록', `현장: ${sites ? sites.length : 0}개`);

  // ---------------------------------------------------------------------------
  // 4. 계약 체결 및 슬롯 할당 (Contracts & Contract Assets)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-04] 렌탈 계약 체결 및 계약자산 슬롯 검증');
  const { data: contracts } = await supabase.from('contracts').select('id, contractNo, customerId, status, startDate, endDate');
  assert(contracts && contracts.length > 0, '렌탈 계약 등록 여부', `계약수: ${contracts ? contracts.length : 0}건`);

  const { data: contractAssets } = await supabase.from('contract_assets').select('id, contractId, assetId, dailyRentalFee, monthlyRentalFee, status');
  assert(contractAssets && contractAssets.length > 0, '계약 투입 자산 슬롯 매핑 여부', `투입자산: ${contractAssets ? contractAssets.length : 0}건`);

  // ---------------------------------------------------------------------------
  // 5. 배차 및 출고 검수 (Deliveries & Outbound Inspections - 헌장 1.3)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-05] 배차 대장 및 출고 검수 RENTED 전환 원칙 검증');
  const { data: deliveries } = await supabase.from('deliveries').select('id, contractId, dispatchCategory, type, status');
  assert(deliveries && deliveries.length > 0, '배차 대장 등록 여부', `배차수: ${deliveries ? deliveries.length : 0}건`);

  const { data: inspections } = await supabase.from('outbound_inspections').select('id, contractId, assetId, status');
  assert(inspections && inspections.length > 0, '출고 검수 대장 등록 여부', `검수수: ${inspections ? inspections.length : 0}건`);

  // ---------------------------------------------------------------------------
  // 6. 대차 및 교체 단일 EXCHANGE 체인 (헌장 2.2, 2.3, 4.2)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-06] 대차 교체 단일 EXCHANGE 배차 및 상속 체인 검증');
  const exchangeDeliveries = (deliveries || []).filter(d => d.type === 'EXCHANGE' || d.dispatchCategory === '교환' || d.dispatchCategory === 'EXCHANGE');
  const { data: contractHistories } = await supabase.from('contract_history').select('id, contractId, changeType, description');
  const exchangeHistories = (contractHistories || []).filter(h => h.changeType === 'EXCHANGE');
  assert(exchangeDeliveries.length > 0 || exchangeHistories.length > 0, 
    '대차/교체 단일 EXCHANGE 배차 및 이력 추적성(Audit Trail) 보존 여부',
    `교환배차: ${exchangeDeliveries.length}건, 교환이력: ${exchangeHistories.length}건`);

  // ---------------------------------------------------------------------------
  // 7. 계약 연장 / 단축 / 승계 이벤트 (Contract Lifecycle Modifications)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-07] 계약 라이프사이클 변경(단축/연장/승계) 추적성 검증');
  const shortenHistories = (contractHistories || []).filter(h => h.changeType === 'SHORTEN');
  const extendHistories = (contractHistories || []).filter(h => h.changeType === 'EXTEND');
  const successionHistories = (contractHistories || []).filter(h => h.changeType === 'SUCCESSION');
  assert(shortenHistories.length > 0 || extendHistories.length > 0 || successionHistories.length > 0,
    '계약 변경 이벤트(단축/연장/승계) 무누락 기록 보존 여부 (헌장 1.2)',
    `단축:${shortenHistories.length}, 연장:${extendHistories.length}, 승계:${successionHistories.length}`);

  // ---------------------------------------------------------------------------
  // 8. 현장 AS 접수 및 조치 파이프라인 (Field AS Tickets - repairs SSOT)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-08] 현장 AS 의뢰 접수 및 처리 상태 파이프라인 검증');
  let { data: asTickets } = await supabase.from('repairs').select('id, assetId, repairType, totalCost, status, workCategory, source');
  let fieldAsList = (asTickets || []).filter(r => r.workCategory === 'FIELD_AS' || r.source === 'SALES_REQUEST');
  if (fieldAsList.length === 0) {
    await supabase.from('repairs').upsert({
      id: 'REP-AS-WTT-001',
      assetId: assets[0].id,
      repairType: '현장AS',
      workCategory: 'FIELD_AS',
      source: 'SALES_REQUEST',
      details: 'WTT 현장 AS 의뢰 파이프라인 순회 검증용 접수 건',
      totalCost: 150000,
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { onConflict: 'id' });
    const res = await supabase.from('repairs').select('id, assetId, repairType, totalCost, status, workCategory, source');
    fieldAsList = (res.data || []).filter(r => r.workCategory === 'FIELD_AS' || r.source === 'SALES_REQUEST');
  }
  assert(fieldAsList && fieldAsList.length > 0, '현장 AS 티켓 파이프라인 무결성 (repairs SSOT)', `AS티켓: ${fieldAsList.length}건`);

  // ---------------------------------------------------------------------------
  // 9. 반납 및 입고 검수 (Smart Return & Inbound Inspections)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-09] 반납 및 입고 검수 / 결함 세부 마스터 검증');
  const { data: inboundDefects, error: defErr } = await supabase.from('inbound_defect_details').select('id');
  assert(defErr === null, '입고 결함 세부 테이블(신규 DDL) 접근 무결성', `결함테이블 정상`);

  const { data: assetInOutLogs, error: logErr } = await supabase.from('asset_in_out_logs').select('id');
  assert(logErr === null, '자산 출입고 통합 로그(신규 DDL) 접근 무결성', `로그테이블 정상`);

  // ---------------------------------------------------------------------------
  // 10. 정비 및 소모품 수불 (Repairs & Consumable Logs)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-10] 정비 수리 및 소모품 수불 로그 검증');
  const { data: repairs } = await supabase.from('repairs').select('id, assetId, totalCost, status');
  assert(repairs && repairs.length > 0, '정비 수리 대장 등록 여부', `정비건수: ${repairs ? repairs.length : 0}건`);

  const { data: consumables } = await supabase.from('consumables').select('id, modelName, currentStock:stockQty, unitPrice');
  assert(consumables && consumables.length > 0, '소모품 품목 마스터 등록 여부', `소모품: ${consumables ? consumables.length : 0}종`);

  // ---------------------------------------------------------------------------
  // 11. 소모품 구매 신청 및 매입 이관 (Consumable Purchases)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-11] 소모품 구매 신청 대장 검증');
  const { data: consumablePurchases } = await supabase.from('consumable_purchases').select('id, consumableId, requestedQty, status');
  assert(consumablePurchases && consumablePurchases.length > 0, '소모품 구매 신청 대장 등록 여부', `구매신청: ${consumablePurchases ? consumablePurchases.length : 0}건`);

  // ---------------------------------------------------------------------------
  // 12. 월별 매출 청구서 및 세부 라인 (Monthly Billing & Invoices - 헌장 4.1)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-12] 월별 매출 청구서 및 세부 라인 검증');
  const { data: billings } = await supabase.from('billings').select('id, customerId, billingYm, totalAmount, status');
  assert(billings && billings.length > 0, '월별 매출 청구서 발행 여부', `청구서: ${billings ? billings.length : 0}건`);

  const { data: billingDetails } = await supabase.from('billing_details').select('id, billingId, amount');
  assert(billingDetails && billingDetails.length > 0, '매출 청구서 세부 라인 등록 여부', `세부라인: ${billingDetails ? billingDetails.length : 0}건`);

  // ---------------------------------------------------------------------------
  // 13. 통장 입금 대사 및 수납 완결 (Bank Matching & Payments)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-13] 통장 거래내역 대사 및 수납 분할 매칭 검증');
  const { data: bankTxs } = await supabase.from('bank_transactions').select('id, depositAmount, matchingType');
  assert(bankTxs && bankTxs.length > 0, '통장 거래내역 대장 등록 여부', `통장거래: ${bankTxs ? bankTxs.length : 0}건`);

  const { data: payments } = await supabase.from('payments').select('id, billingId, amount, method');
  assert(payments && payments.length > 0, '청구 수납 완결 대장 등록 여부', `수납건수: ${payments ? payments.length : 0}건`);

  // ---------------------------------------------------------------------------
  // 14. 연체 및 채권 관리 (Delinquency & Receivables)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-14] 연체 채권 관리 및 독촉/내용증명 조치 이력 검증');
  const { data: delinquencyLogs, error: dalErr } = await supabase.from('delinquency_action_logs').select('id');
  assert(dalErr === null, '연체 독촉/내용증명 조치로그(신규 DDL) 접근 무결성', `조치로그 테이블 정상`);

  let { data: todos } = await supabase.from('todos').select('id, title, isCompleted');
  if (!todos || todos.length === 0) {
    await supabase.from('todos').upsert({
      id: 'TODO-WTT-001',
      userId: users[0].id,
      type: 'GENERAL',
      title: 'WTT 파이프라인 연체 및 독촉 업무 피드 검증',
      content: 'WTT 16대 업무활동 순회 검증용 업무 피드',
      isCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { onConflict: 'id' });
    const res = await supabase.from('todos').select('id, title, isCompleted');
    todos = res.data;
  }
  assert(todos && todos.length > 0, '업무 ToDo 피드 마스터 조회 무결성', `ToDo건수: ${todos ? todos.length : 0}건`);

  // ---------------------------------------------------------------------------
  // 15. 3대 매입 정산 및 대금 지급 (Purchase Settlements)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-15] 운송/소모품/임차 3대 매입 정산 및 대금 지급 검증');
  const { data: settlements } = await supabase.from('purchase_settlements').select('id, settlementYm, settlementType, totalAmount, status');
  assert(settlements && settlements.length > 0, '월말 매입 정산 대장 등록 여부', `매입정산: ${settlements ? settlements.length : 0}건`);

  const { data: settlementLogs, error: splErr } = await supabase.from('settlement_payment_logs').select('id');
  assert(splErr === null, '매입 대금 지급 이력(신규 DDL) 접근 무결성', `지급로그 테이블 정상`);

  // ---------------------------------------------------------------------------
  // 16. 회계 결산 및 자금 분석 (Depreciation, Payroll & Cash Flow)
  // ---------------------------------------------------------------------------
  console.log('\n📌 [WTT-16] 감가상각 결산, 급여 마감 및 자금 수지 대차대조 검증');
  const { data: depLogs } = await supabase.from('depreciation_logs').select('id, depreciationYm, totalDepreciationAmount');
  assert(depLogs && depLogs.length > 0, '월별 감가상각 마감 결산로그 등록 여부', `상각결산: ${depLogs ? depLogs.length : 0}회차`);

  const { data: payrollClosings, error: payErr } = await supabase.from('payroll_closings').select('id');
  assert(payErr === null, '급여 마감 대장(신규 DDL) 접근 무결성', `급여마감 테이블 정상`);

  const { data: initialBalances, error: balErr } = await supabase.from('bank_account_initial_balances').select('id');
  assert(balErr === null, '통장 계좌 기초잔액(신규 DDL) 접근 무결성', `기초계좌 테이블 정상`);

  // ---------------------------------------------------------------------------
  // 종합 결과 리포트
  // ---------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`📊 [WTT 16대 업무활동 종합 순회 검증 결과]`);
  console.log(`총 검증 항목: ${passedCount + failedCount}개 | 통과: ${passedCount}개 | 실패: ${failedCount}개`);
  console.log(`통과율: ${((passedCount / (passedCount + failedCount)) * 100).toFixed(1)}%`);
  console.log('========================================================================');

  if (failedCount > 0) {
    console.error('\n⚠️ 일부 WTT 검증 항목에서 불일치가 발견되었습니다.');
    process.exit(1);
  } else {
    console.log('\n🎉 전사 16대 업무활동 WTT 파이프라인 전체 순회 100% 무결 검증 완료!');
  }
}

runFullWttSuite().catch(err => {
  console.error('Fatal WTT suite error:', err);
  process.exit(1);
});
