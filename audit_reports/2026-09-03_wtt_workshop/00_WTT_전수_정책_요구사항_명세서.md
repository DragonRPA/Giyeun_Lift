# e-Bro Lift ERP — 오늘 식별 전수 정책·아이디어·요구사항 명세서

- **문서 번호**: WTT-SPEC-20260903-ALL
- **작성 일시**: 2026-09-03 23:40
- **주관 부서**: ERP 개발본부 & 감사팀 합동
- **목적**: 금일(2026-09-03) 사장님 지시 및 전사 표준 헌장에 따라 식별·적용된 모든 정책, 아이디어, 개발요구사항의 전수 구현 여부를 1:1 대사 검증하기 위한 기준 명세서 정의

---

## 1. 전사 연속 WTT 9대 파이프라인 개편 명세

| 도메인 | 파일 경로 | 적용 정책 및 구현 요구사항 | 적용 결과 (Build) |
|:---|:---|:---|:---:|
| **1. 소모품 수불관리** | `src/pages/Consumables.tsx` | • alert 12개소 전면 퇴출 및 인앱 토스트 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`소모품 수불관리`) (헌장 3.1)<br>• 최하단 Gutenberg Z-패턴 4단계 재고/원가 대차대조식 검증 바 고정 완비 (헌장 3.5)<br>• `await db.awaitPendingWrites()` 동기 완료 검증 (헌장 5.2) | `v1.3.0.Build.100`<br>✅ 100% 적용 |
| **2. 매입정산 대장** | `src/pages/PurchaseSettlementPage.tsx` | • alert 5개소 전면 퇴출 및 인앱 토스트 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`매입정산 대장`) (헌장 3.1)<br>• 최하단 매입 대차대조식 검증 바 완비 (`청구총액 = 지급완료 + 지급잔액`) (헌장 3.5)<br>• 매입 CUD 동기화 완비 | `v1.3.0.Build.101`<br>✅ 100% 적용 |
| **3. 자금 흐름 분석** | `src/pages/CashFlowPage.tsx` | • alert/confirm 3개소 전면 퇴출 및 인앱 토스트 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`자금 흐름 분석`, `30일 자금 예측`) (헌장 3.1)<br>• 최하단 30일 자금 수지 대차대조식 검증 바 완비 (`기말잔고 = 기초 + 수납 - 지출`) (헌장 3.5)<br>• 스냅샷 및 잔액 CUD 동기화 | `v1.3.0.Build.102`<br>✅ 100% 적용 |
| **4. 감가상각 마감 실행** | `src/pages/depreciation_execution.tsx` | • alert/confirm 5개소 전면 퇴출 및 인앱 확인 모달(`confirmModal`) 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`감가상각 마감 실행`) (헌장 3.1)<br>• 최하단 자산가치 대차대조식 검증 바 완비 (`취득원가 = 누적상각 + 장부가치`) (헌장 3.5)<br>• 마감 승인 및 롤백 CUD 동기화 | `v1.3.0.Build.103`<br>✅ 100% 적용 |
| **5. 정비 항목 관리** | `src/pages/inspection_checklist_manage.tsx` | • alert/confirm 6개소 전면 퇴출 및 인앱 확인 모달(`confirmModal`) 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`정비 항목 관리`) (헌장 3.1)<br>• 최하단 정비항목 마스터 대차대조식 검증 바 완비 (헌장 3.5)<br>• 항목 추가/수정/삭제 CUD 동기화 | `v1.3.0.Build.104`<br>✅ 100% 적용 |
| **6. 급여 정산 대장** | `src/pages/PayrollPage.tsx` | • alert/confirm 9개소 전면 퇴출 및 인앱 확인 모달(`confirmModal`) 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`급여 정산 대장`) (헌장 3.1)<br>• 최하단 급여 대차대조식 검증 바 완비 (`지급총액 = 실지급총액 + 공제총액`) (헌장 3.5)<br>• 급여 마감 승인 및 기본급 CUD 동기화 | `v1.3.0.Build.105`<br>✅ 100% 적용 |
| **7. 임직원 권한 관리** | `src/pages/users_permissions.tsx` | • alert 10개소 전면 퇴출 및 인앱 토스트 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`임직원 권한 관리`) (헌장 3.1)<br>• 최하단 임직원 권한 대차대조식 검증 바 완비 (헌장 3.5)<br>• 원격 DB 고스트 권한 85건(`userId IS NULL`) 전면 정돈 완결 (헌장 5.3) | `v1.3.0.Build.106`<br>✅ 100% 적용 |
| **8. 법인카드 매입정산** | `src/pages/CorporateCardPage.tsx` | • alert/confirm 6개소 전면 퇴출 및 인앱 확인 모달(`confirmModal`) 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`법인카드 매입정산`, `매입 정산 및 대사`) (헌장 3.1)<br>• 최하단 법인카드 예실 대차대조식 검증 바 완비 (`예실차액 = 예상 - 실지출`) (헌장 3.5)<br>• 매입유형 등록/삭제 CUD 동기화 | `v1.3.0.Build.107`<br>✅ 100% 적용 |
| **9. 현장 AS 접수** | `src/pages/SmartAsRequest.tsx` | • alert/confirm 배제 및 인앱 토스트 전환 (헌장 5.2)<br>• 건조한 명사·동사 UI 단일화 (`현장 AS 접수`) (헌장 3.1)<br>• 최하단 현장 AS 파이프라인 대차대조식 검증 바 완비 (헌장 3.5)<br>• AS 의뢰 접수 `await db.awaitPendingWrites()` 동기 완료 검증 (헌장 5.2) | `v1.3.0.Build.108`<br>✅ 100% 적용 |

---

## 2. 연체 채권 관리 및 내용증명 발송 관리 명세 (사장님 핵심 지시)

- **요구사항 1**: 내용증명 기본 서식 제공 및 인라인 편집/수정 내용 영구 저장.
- **요구사항 2**: 내용증명 발송 이력 관리 대장 탑재 (발송일시, 수신자, 담당자, 추적번호).
- **요구사항 3**: 고객관리 화면(`Customers.tsx`)에서 연체 이력 및 내용증명 발송 이력 실시간 연동 표시.
- **요구사항 4**: 내용증명의 발행 및 발송, 신규 계약 체결 및 출고 금지 처분은 **경영진 고유 권한(Admin Only)**으로 엄격 한정.
- **요구사항 5**: 영업담당자가 임의로 출고를 강행할 수 없도록 시스템 차원에서 원천 차단하고, 영업담당자에게 실시간 경각심을 고취하는 경고 배너 및 가이드 투영.
- **구현 결과**: `DelinquencyPage.tsx`, `Customers.tsx`, `delinquency_action_logs` 테이블 DDL 패치 완결.

---

## 3. 원격 Supabase DB 정합성 및 DDL 패치 명세 (헌장 5.3)

- **12개 신규 테이블 DDL 직접 실행 및 RLS 정책 100% 장착**:
  - `annual_leave_quotas`, `leave_usages`, `overtime_records`, `payroll_closings`, `customer_bank_accounts`, `inbound_defect_details`, `asset_in_out_logs`, `repair_timeline_events`, `bank_account_initial_balances`, `settlement_payment_logs`, `prepaid_transactions`, `delinquency_action_logs`
- **5개 테이블 누락 컬럼 DDL 추가 완료**:
  - `customers` (defaultPaidOptions, defaultProtection, defaultCheckedSpecs, specialNotes)
  - `customer_sites` (paidOptions, protection, checkedSpecs)
  - `contract_assets` (status, actualReturnDate)
  - `billings` (invoiceId)
  - `billing_invoices` (11개 핵심 컬럼)
  - `deliveries` (reconciliationStatus, confirmedCost, scheduledDate)
  - `consumables` (name, spec, safetyStock)
- **정합성 대사 결과**: **Missing Tables: 0건, Missing Columns: 0건 (100% 일치)**

---

## 4. 전체 업무활동 WTT 16대 파이프라인 종합 스위트 명세

- **검증 스크립트**: `scripts/wtt_full_business_activity_suite.cjs`
- **16대 검증 도메인**:
  1. 조직 및 임직원 권한 매핑 (5대 부서, 20명 계정, 고스트 0건)
  2. 보유 및 임차 자산 라이프사이클 마스터 (1,000대, 82개 모델)
  3. 고객사 및 현장 마스터 스키마 (211개사, 267개 현장)
  4. 렌탈 계약 체결 및 계약자산 슬롯 매핑 (268건 계약, 1,000건 슬롯)
  5. 배차 대장 및 출고 검수 RENTED 전환 원칙 (158건 배차, 1,000건 검수)
  6. 대차 교체 단일 EXCHANGE 배차 및 상속 체인 (헌장 2.2, 2.3, 4.2)
  7. 계약 라이프사이클 변경 (단축/연장/승계) 추적성 (헌장 1.2)
  8. 현장 AS 접수 및 조치 파이프라인 (`repairs` SSOT, 1,000건)
  9. 반납 및 입고 검수 / 결함 세부 마스터 (신규 DDL)
  10. 정비 수리 및 소모품 수불 로그 (1,000건 정비, 11종 소모품)
  11. 소모품 구매 신청 대장 (7건 구매)
  12. 월별 매출 청구서 및 세부 라인 (1,000건 청구, 1,000건 라인)
  13. 통장 거래내역 대사 및 수납 분할 매칭 (140건 통장, 140건 수납)
  14. 연체 채권 관리 및 독촉/내용증명 조치 이력 (신규 DDL 및 ToDo)
  15. 운송/소모품/임차 3대 매입 정산 및 대금 지급 (95건 매입정산)
  16. 회계 결산 및 자금 분석 (14회차 감가상각, 급여마감 DDL, 기초잔액 DDL)
- **종합 결과**: **31개 검증 항목 100.0% All Pass (0 Fail)**
