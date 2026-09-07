# e-Bro Lift ERP — WTT 업무 분장 명세서 (`WTT_업무분장.md`)

> **작성일**: 2026-08-23  
> **목적**: 대규모 Work-Through Test (WTT) 시나리오 수행을 위한 테스터 직원별 역할, 소속 부서, 권한 매핑 및 직무별 책임/업무 프로세스(R&R) 정의

---

## 1. 테스터 직원 및 부서/권한 매핑 대장

기존 조직도(5개 부서)를 유지하고, 각 테스터 직원에게 직무별 단일 책임을 부여합니다.

| 사용자 ID | 직원명 (아이디) | 소속 부서 (부서ID) | 직급/역할 | 직무 책임 범위 (R&R) | 허용 메뉴 권한 (Permission) |
|-----------|----------------|-------------------|-----------|----------------------|------------------------------|
| `usr-tester-admin` | `테스터(총괄관리)` (`admin_tester`) | `기연리프트` (`DEPT-0000001`) | 대표이사 / 총괄 | 전사 모든 메뉴 및 결산 승인, 마스터 관리 | 전 메뉴 `read, save, delete` 100% |
| `usr-tester-sales` | `테스터(계약관리)` (`sales_tester`) | `영업부` (`DEPT-0000003`) | 팀장 / 영업책임 | 고객/현장 관리, 견적/계약 체결, 계약승계, 대차의뢰, 스마트출고 | `customer`, `contract`, `smart_dispatch`, `quote`, `todos` |
| `usr-tester-billing` | `테스터(청구수납)` (`billing_tester`) | `관리부` (`DEPT-0000002`) | 과장 / 청구수납 | 월별 청구서 발행, 이메일 발송, 통장입금 대사, 수납/선수금 상계, 연체채권 관리 | `billing`, `bank_matching`, `delinquency`, `revenue_summary` |
| `usr-tester-purchase`| `테스터(매입급여)` (`purchase_tester`) | `관리부` (`DEPT-0000002`) | 대리 / 매입정산 | 운송비/소모품/임차료 매입 정산, 대금 지급, 급여 결산, 월말 감가상각 결산 | `purchase_settlement`, `payroll`, `depreciation_execution`, `cash_flow` |
| `usr-tester-dispatch`| `테스터(배차출고)` (`dispatch_tester`) | `출고팀` (`DEPT-0000004`) | 주임 / 배차출고 | 운송사/기사 배정, 배차 대사, 출고/회수/대차 배차 지시, 출고 장비할당, 출고검수 | `delivery`, `asset_assignment`, `outbound_inspections`, `transport_company` |
| `usr-tester-mechanic`| `테스터(정비관리)` (`mechanic_tester`) | `AS팀` (`DEPT-0000005`) | 기사 / 정비책임 | 스마트반납 입고검수, 정비/수리 등록, 소모품 구매신청 및 수불 관리, 장비 가용 복귀 | `smart_return`, `repair`, `consumable`, `asset_history`, `checklist` |

---

## 2. 직무별 엔드-투-엔드 업무 흐름도 및 책임 범위

### 2.1 [영업부] 테스터(계약관리)
```
[신규 고객 발굴 / 기존 거래처]
       │
       ▼
1. 고객사 & 현장 등록 (customers, contacts, sites)
       │ (이메일: 77.victor.lee@gmail.com 통일)
       ▼
2. 렌탈 계약 체결 (contracts, contractAssets)
       │ • 기간: 1~12개월 / 수량: 10~15대 / 월단가: 30~60만원
       │ • 슬롯 미할당 상태로 출고팀에 의뢰
       ▼
3. 라이프사이클 이벤트 대응:
       ├─ [대차 요구 발생 시] 'EXCHANGE' 단일 왕복 배차 의뢰 발행 (헌장 2.3)
       └─ [계약 승계 발생 시] 기존 계약 SUCCEEDED 마감 및 신규 승계 계약 발행
```

### 2.2 [출고팀] 테스터(배차출고)
```
[계약 접수 (미할당 슬롯)]
       │
       ▼
1. 장비 매핑 및 할당 (asset_assignment)
       │ • 60% 자사 보유 장비 (정비 점수 낮은 우량 자산 우선 배정)
       │ • 40% 외부 전대 장비 (Vendor 임차 자산 매핑)
       ▼
2. 배차 지시 (deliveries: OUTBOUND)
       │ • 운송사 6개사 및 기사 24명 중 최적 배차 배정
       ▼
3. 현장 출고 검수 (outboundInspections)
       │ • 매월 1건 의도적 REJECTED (정비팀 자동 입고 및 대체 장비 교체)
       │ • 나머지 건 APPROVED ➔ 자산 상태 RENTED 전환 (헌장 1.3)
       ▼
4. 배차 운송비 대사 관리 (TruckDispatch)
       │ • 운송사 엑셀 대사 ➔ 1:1 금액 일치 시 RECONCILED 확정
       │ • 월말 매입정산 대장으로 1-클릭 일괄 이관
```

### 2.3 [AS팀] 테스터(정비관리)
```
[현장 반납 의뢰 / 고장 접수]
       │
       ▼
1. 스마트 반납 및 입고 검수 (smart_return ➔ completeInboundDelivery)
       │ • 외관/작동 상태 점검 ➔ 정상 건 AVAILABLE 가용 복귀
       │ • 고객 과실 파손 건 ➔ REPAIRING 전환 및 고객부담 수리비 등록
       ▼
2. 정비 및 소모품 수불 (registerRepair, consumableLogs)
       │ • 소모품 재고 실시간 차감
       │ • 정비 완료(COMPLETED) 시 자산 AVAILABLE 복귀 및 정비점수 초기화
       ▼
3. 소모품 수급 관리 (consumablePurchases)
       │ • 월 3천만원 수준 소모품 구매신청 및 지연 없는 입고(INBOUND)
```

### 2.4 [관리부] 테스터(청구수납) & 테스터(매입급여)
```
[월말 정기 결산 및 자금 흐름]
       │
       ▼
1. 청구서 일괄 발행 (generateBillingsForMonth / Billings.tsx)
       │ • 매월 20일, 25일, 30일 청구서 자동 생성 (이메일: 77.victor.lee@gmail.com)
       │ • 고객 과실 수리비(repairs) 및 편도운송료 추가 청구 항목(30%) 자동 연동
       ▼
2. 통장 거래내역 대사 및 수납 완결 (BankMatching.tsx / receivePayment)
       │ • 통장 입금 내역 엑셀 업로드 ➔ 청구서 1:1 / 1:N 분할 수납 매칭
       │ • 선수금(예치금) 상계 수납(applyPrepaidBalanceForBilling) 처리
       │ • 연체 없는 100% 정상 수납 마감
       ▼
3. 3대 매입 정산 및 대금 지급 (PurchaseSettlementPage.tsx)
       │ • [1] 운송비 매입 정산 (이관된 배차건 100% 지급)
       │ • [2] 소모품 매입 정산 (월 3천만원 구매건 100% 지급)
       │ • [3] 전대(임차) 장비 임차료 정산 (외부 렌탈사 100% 지급)
       ▼
4. 월말 회계 마감 (depreciation_execution.tsx, PayrollPage.tsx)
       │ • 자산별 정액법 감가상각 결산 마감 및 장부가액 확정
       │ • 직원 급여 계산 및 결산 확정
```

---

## 3. 부서 간 상호 검증 및 원칙 준수 헌장 준수표

1. **영업부 vs 출고/자산 부서 R&R 엄격 분리 (헌장 2.1)**:
   - 영업사원은 대차/출고 '의뢰'만 생성하며, 개별 자산번호는 출고팀에서만 배정함.
2. **출고 검수 승인 시점에만 RENTED 전환 (헌장 1.3)**:
   - 배차 담당자의 배차 조작으로 자산 상태가 변경되지 않으며, 출고검수 승인 시 완결됨.
3. **대차/교체 단일 EXCHANGE 발행 (헌장 2.3)**:
   - 출고/입고 2건으로 파편화하지 않고 1건의 왕복 배차로 운송비 정산 및 이력 연결.
4. **매출 기여액 1원 오차 없는 정밀 일할 집계 (헌장 4.1)**:
   - 전자산(회수일 전일) + 후장비(교체 당일~) 일할 합산 = 계약 전체 렌탈료 100% 일치.
