# e-Bro Lift ERP — WTT DB 스키마 명세서 (`WTT_DB스키마.md`)

> **작성일**: 2026-08-23  
> **목적**: 대규모 Work-Through Test (WTT) 시나리오 수행을 위한 전체 테이블 스키마, 외래키 관계, 상태 전이 규칙 정의

---

## 1. 전사 테이블 및 식별자(ID) 채번 체계

| 번호 | 테이블명 (Supabase / LocalDB) | 한국어 명칭 | 기본키(PK) 형식 | 주요 외래키(FK) |
|------|------------------------------|-------------|-----------------|-----------------|
| 1 | `departments` | 부서 마스터 | `DEPT-0000001` | - |
| 2 | `users` | 사용자/직원 | `usr-001` / `usr-tester-...` | `departmentId` ➔ `departments.id` |
| 3 | `permissions` | 메뉴별 접근 권한 | `PERM-0000001` | `userId` ➔ `users.id` |
| 4 | `products` | 장비 모델(제품) | `PROD-0000001` | - |
| 5 | `assets` | 보유/임차 자산 | `ASSET-0000001` | `vendorId` ➔ `vendors.id`, `currentCustomerId` ➔ `customers.id` |
| 6 | `customers` | 고객사 (거래처) | `CUST-0000001` | - |
| 7 | `contacts` | 고객사 담당자 | `CONT-0000001` | `customerId` ➔ `customers.id` |
| 8 | `sites` | 고객사 현장 | `SITE-0000001` | `customerId` ➔ `customers.id` |
| 9 | `vendors` | 매입/임차 거래처 | `VEND-0000001` | - |
| 10 | `transportCompanies` | 운송 거래처 | `TC-001` | - |
| 11 | `transportDrivers` | 운송 기사 | `TD-001` | `companyId` ➔ `transportCompanies.id` |
| 12 | `contracts` | 렌탈 계약 | `CONT-260101-0001` | `customerId`, `siteId`, `contactId`, `salespersonId` |
| 13 | `contractAssets` | 계약별 투입 자산 슬롯 | `CA-0000001` | `contractId` ➔ `contracts.id`, `assetId` ➔ `assets.id` |
| 14 | `contractHistory` | 계약 변경/이력 | `CH-0000001` | `contractId` ➔ `contracts.id` |
| 15 | `deliveries` | 배차 대장 | `DELIV-0000001` | `contractId`, `transportCompanyId`, `transportDriverId` |
| 16 | `outboundInspections` | 출고 검수 대장 | `INSP-OUT-0000001` | `contractId`, `assetId`, `deliveryId` |
| 17 | `billings` | 월별 매출 청구서 | `BILL-2601-0001` | `customerId`, `contractId` |
| 18 | `billingDetails` | 청구 세부 라인 | `BD-0000001` | `billingId` ➔ `billings.id`, `assetId` ➔ `assets.id` |
| 19 | `payments` | 수납 내역 | `PAY-0000001` | `billingId` ➔ `billings.id`, `customerId` ➔ `customers.id` |
| 20 | `paymentDepositLinks` | 통장입금-수납 분할링크 | `PDL-0000001` | `bankTransactionId`, `billingId`, `paymentId` |
| 21 | `bankTransactions` | 통장 거래내역 | `TX-0000001` | `matchedBillingId` ➔ `billings.id` |
| 22 | `prepaidTransactions` | 선수금(예치금) 입출금 | `PREPAY-0000001` | `customerId`, `billingId` |
| 23 | `delinquencyActionLogs` | 연체 독촉 조치/약속 | `DAL-0000001` | `customerId`, `billingId` |
| 24 | `repairs` | 정비/수리 대장 | `REP-0000001` | `assetId`, `billingId`, `mechanicId` |
| 25 | `repairConsumables` | 정비 소모품 사용 | `RC-0000001` | `repairId`, `consumableId` |
| 26 | `consumables` | 소모품 품목 마스터 | `CON-0000001` | - |
| 27 | `consumableLogs` | 소모품 입출고 수불 | `CLOG-0000001` | `consumableId`, `targetAssetId`, `userId` |
| 28 | `consumablePurchases` | 소모품 구매신청 | `CPUR-0000001` | `vendorId`, `consumableId`, `requestedBy` |
| 29 | `purchaseSettlements` | 월말 매입 정산 헤더 | `PST-2601-0001` | `vendorId` ➔ `transportCompanies.id` / `vendors.id` |
| 30 | `purchaseSettlementItems` | 매입 정산 원천 항목 | `PSI-0000001` | `settlementId`, `sourceId` |
| 31 | `settlementPaymentLogs` | 매입 대금 지급 이력 | `SPL-2601-0001` | `settlementId`, `bankTransactionId` |
| 32 | `externalLeases` | 전대(임차) 계약 대장 | `LEASE-0000001` | `vendorId`, `contractId`, `contractAssetId` |
| 33 | `depreciationLogs` | 월말 감가상각 결산로그 | `DEPN-2026-01` | `executedBy` ➔ `users.id` |
| 34 | `assetInOutLogs` | 자산 출입고/정비 이력 | `INOUT-0000001` | `assetId`, `contractId`, `deliveryId` |
| 35 | `todos` | 업무 피드 (ToDo) | `TODO-0000001` | `assignedUserId`, `relatedContractId` |

---

## 2. 핵심 엔티티 세부 필드 정의 및 타입 스키마

### 2.1 자산 (`assets`)
```sql
CREATE TABLE assets (
    id VARCHAR(50) PRIMARY KEY,                  -- ASSET-0000001
    "assetNo" VARCHAR(50) UNIQUE NOT NULL,       -- 관리번호 (예: K10001, G13004)
    "modelName" VARCHAR(100) NOT NULL,           -- 제품 모델명
    "serialNo" VARCHAR(100),                     -- 시리얼 번호
    manufacturer VARCHAR(100),                   -- 제조사 (Genie, SKYJACK, JLG, SINOBOOM 등)
    "manufactureYear" VARCHAR(20),               -- 제조년도 (예: 2022년)
    "ownerType" VARCHAR(20) NOT NULL,            -- 'OWNED' (자사보유) | 'RENTED' (외부임차/전대)
    status VARCHAR(30) NOT NULL,                 -- 'AVAILABLE' | 'RENTED' | 'REPAIRING' | 'DISPOSED' | 'ASSIGNED'
    "acquisitionDate" DATE,                      -- 취득일자 (2010-01-01 ~ 2025-12-31)
    "acquisitionPrice" NUMERIC(15, 2) DEFAULT 0, -- 취득가액 (원)
    "depreciationMonths" INT DEFAULT 96,         -- 내용연수 (개월수, 기본 8년=96개월)
    "residualValueRate" NUMERIC(5, 2) DEFAULT 10,-- 잔존가치율 (기본 10%)
    "accumDepreciation" NUMERIC(15, 2) DEFAULT 0,-- 감가상각누계액
    "bookValue" NUMERIC(15, 2) DEFAULT 0,        -- 장부가액 (취득가 - 누적상각액)
    "vendorId" VARCHAR(50),                      -- 임차 자산인 경우 공급처(Vendor) ID
    "currentCustomerId" VARCHAR(50),             -- 현재 대여 중인 고객사 ID
    "currentSiteId" VARCHAR(50),                 -- 현재 투입된 현장 ID
    "contractStart" DATE,                        -- 대여 시작일
    "contractEnd" DATE,                          -- 대여 종료일
    "monthlyRentFee" NUMERIC(15, 2) DEFAULT 0,   -- 외부 임차 시 월 임차료
    "dailyRentFee" NUMERIC(15, 2) DEFAULT 0,     -- 외부 임차 시 일 임차료
    "actualRentReturnDate" DATE,                 -- 외부 임차 장비 반납일
    "maintenanceScore" INT DEFAULT 0,            -- 정비 누적 점수
    "cumRentalFee" NUMERIC(15, 2) DEFAULT 0,     -- 누적 매출 기여액 (Revenue Contribution)
    "cumRepairCost" NUMERIC(15, 2) DEFAULT 0,    -- 누적 정비 수리비용
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 계약 (`contracts`) & 계약자산 슬롯 (`contractAssets`)
```sql
CREATE TABLE contracts (
    id VARCHAR(50) PRIMARY KEY,                  -- CONT-260101-0001
    "contractNo" VARCHAR(50) UNIQUE NOT NULL,    -- 계약번호 (C2601-0001)
    "customerId" VARCHAR(50) NOT NULL,           -- 고객사 FK
    "contactId" VARCHAR(50),                     -- 고객 담당자 FK
    "siteId" VARCHAR(50),                        -- 현장 FK
    "salespersonId" VARCHAR(50),                 -- 영업담당자 FK
    "startDate" DATE NOT NULL,                   -- 계약 개시일
    "endDate" VARCHAR(20) NOT NULL,              -- 계약 종료일 (YYYY-MM-DD 또는 '미정')
    "billingDay" INT DEFAULT 30,                 -- 청구일 (20, 25, 30)
    "statementClosingDay" INT DEFAULT 30,        -- 거래명세서 마감일
    status VARCHAR(30) NOT NULL,                 -- 'ACTIVE' | 'EXTENDED' | 'SUCCEEDED' | 'COMPLETED'
    "parentContractId" VARCHAR(50),              -- 승계 계약인 경우 원 계약 ID
    "succeededContractId" VARCHAR(50),           -- 승계 완료된 신규 계약 ID
    memo TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "contractAssets" (
    id VARCHAR(50) PRIMARY KEY,                  -- CA-0000001
    "contractId" VARCHAR(50) NOT NULL,           -- 계약 FK
    "assetId" VARCHAR(50),                       -- 실물 자산 FK (미할당 시 NULL)
    "expectedModel" VARCHAR(100),                -- 요구 모델명
    "monthlyRentalFee" NUMERIC(15, 2) NOT NULL,  -- 대당 월 렌탈료 (300,000 ~ 600,000)
    "dailyRentalFee" NUMERIC(15, 2) NOT NULL,    -- 대당 일 렌탈료 (월단가 / 30)
    "startDate" DATE NOT NULL,                   -- 투입일
    "endDate" VARCHAR(20) NOT NULL,              -- 종료일
    status VARCHAR(30) DEFAULT 'ACTIVE',         -- 'ACTIVE' | 'RETURNED'
    "actualReturnDate" DATE,                     -- 실제 회수일
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.3 배차 대장 (`deliveries`) & 출고 검수 (`outboundInspections`)
```sql
CREATE TABLE deliveries (
    id VARCHAR(50) PRIMARY KEY,                  -- DELIV-0000001
    "contractId" VARCHAR(50) NOT NULL,           -- 계약 FK
    type VARCHAR(30) NOT NULL,                   -- 'OUTBOUND' (출고) | 'INBOUND' (회수) | 'EXCHANGE' (교환)
    "dispatchCategory" VARCHAR(50) NOT NULL,     -- '출고' | '회수' | '교환'
    status VARCHAR(30) NOT NULL,                 -- 'REQUESTED' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED'
    "requestDate" DATE NOT NULL,                 -- 배차 요청일
    "scheduledDate" DATE,                        -- 배차 예정일
    "loadingDate" DATE,                          -- 상차일
    "unloadingDate" DATE,                        -- 하차일
    "transportCompanyId" VARCHAR(50),            -- 운송사 FK
    "transportDriverId" VARCHAR(50),             -- 운송기사 FK
    "vehicleType" VARCHAR(50),                   -- 차량 톤수 (5톤 셀프로더, 1톤 등)
    "deliveryCost" NUMERIC(15, 2) DEFAULT 0,     -- 배차 운송료
    "deliveryCostConfirmed" NUMERIC(15, 2) DEFAULT 0, -- 대사 확정 운송료
    "reconciliationStatus" VARCHAR(30) DEFAULT 'NONE',-- 'NONE' | 'MATCHED' | 'RECONCILED' | 'PAYMENT_REQUESTED' | 'PAID'
    "isCostSettled" BOOLEAN DEFAULT FALSE,
    "purchaseSettlementId" VARCHAR(50),          -- 월말 매입 정산 FK
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "outboundInspections" (
    id VARCHAR(50) PRIMARY KEY,                  -- INSP-OUT-0000001
    "contractId" VARCHAR(50) NOT NULL,
    "assetId" VARCHAR(50) NOT NULL,
    "deliveryId" VARCHAR(50),
    "inspectionDate" DATE NOT NULL,
    "inspectorId" VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL,                 -- 'PENDING' | 'APPROVED' | 'REJECTED'
    "rejectionReason" TEXT,                      -- 반려 사유 (누유, 배터리 불량 등)
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4 청구 (`billings`), 수납 (`payments`), 통장 대사 (`bankTransactions`)
```sql
CREATE TABLE billings (
    id VARCHAR(50) PRIMARY KEY,                  -- BILL-2601-0001
    "customerId" VARCHAR(50) NOT NULL,           -- 고객사 FK
    "contractId" VARCHAR(50),                    -- 주 계약 FK
    "billingYm" VARCHAR(10) NOT NULL,            -- 청구 연월 (YYYY-MM)
    "billingDate" DATE NOT NULL,                 -- 청구서 발행일 (20, 25, 30일)
    "dueDate" DATE NOT NULL,                     -- 입금 마감일
    "totalAmount" NUMERIC(15, 2) NOT NULL,       -- 총 청구액 (공급가액 + 부가세 + 추가항목)
    "paidAmount" NUMERIC(15, 2) DEFAULT 0,       -- 기 수납액
    status VARCHAR(30) NOT NULL,                 -- 'ISSUED' | 'PARTIAL' | 'PAID' | 'CANCELLED'
    "recipientEmail" VARCHAR(100) NOT NULL,      -- 발송 이메일 (77.victor.lee@gmail.com)
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "billingDetails" (
    id VARCHAR(50) PRIMARY KEY,                  -- BD-0000001
    "billingId" VARCHAR(50) NOT NULL,            -- 청구서 FK
    "assetId" VARCHAR(50),                       -- 자산 FK (추가항목인 경우 NULL 가능)
    "itemType" VARCHAR(30) DEFAULT 'RENTAL',     -- 'RENTAL' | 'REPAIR' | 'TRANSPORT' | 'OTHER'
    description VARCHAR(200) NOT NULL,           -- 항목 내역
    quantity INT DEFAULT 1,                      -- 수량 또는 가동일수
    "unitPrice" NUMERIC(15, 2) NOT NULL,         -- 단가
    amount NUMERIC(15, 2) NOT NULL,              -- 청구 금액
    "repairId" VARCHAR(50),                      -- 연동 수리비 ID
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payments (
    id VARCHAR(50) PRIMARY KEY,                  -- PAY-0000001
    "billingId" VARCHAR(50) NOT NULL,            -- 청구서 FK
    "customerId" VARCHAR(50) NOT NULL,
    "paymentDate" DATE NOT NULL,                 -- 수납일
    amount NUMERIC(15, 2) NOT NULL,              -- 수납 금액
    method VARCHAR(30) NOT NULL,                 -- 'BANK_TRANSFER' | 'PREPAID' | 'CARD'
    "bankTransactionId" VARCHAR(50),             -- 통장 입금 거래 FK
    memo TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "bankTransactions" (
    id VARCHAR(50) PRIMARY KEY,                  -- TX-0000001
    "bankName" VARCHAR(50) NOT NULL,             -- '우리은행' | '신한은행'
    "accountNumber" VARCHAR(50),
    "transactionDate" TIMESTAMPTZ NOT NULL,
    summary VARCHAR(100),                        -- 적요
    "senderName" VARCHAR(100) NOT NULL,          -- 입금자명 / 거래처명
    "depositAmount" NUMERIC(15, 2) DEFAULT 0,    -- 입금액
    "withdrawAmount" NUMERIC(15, 2) DEFAULT 0,   -- 출금액
    balance NUMERIC(15, 2) DEFAULT 0,            -- 거래 후 잔액
    "matchedBillingId" VARCHAR(50),              -- 매칭된 청구서 FK
    "customerId" VARCHAR(50),
    "isDeposit" BOOLEAN DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "paymentDepositLinks" (
    id VARCHAR(50) PRIMARY KEY,                  -- PDL-0000001
    "bankTransactionId" VARCHAR(50) NOT NULL,
    "billingId" VARCHAR(50) NOT NULL,
    "paymentId" VARCHAR(50),
    amount NUMERIC(15, 2) NOT NULL,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.5 전대(임차) 계약 (`externalLeases`) & 월말 매입 정산 (`purchaseSettlements`)
```sql
CREATE TABLE "externalLeases" (
    id VARCHAR(50) PRIMARY KEY,                  -- LEASE-0000001
    "vendorId" VARCHAR(50) NOT NULL,             -- 임차 거래처 FK (Vendor[RENTAL])
    "contractId" VARCHAR(50) NOT NULL,           -- 연결 고객 계약 FK
    "contractAssetId" VARCHAR(50),               -- 연결 계약 슬롯 FK
    "assetDescription" VARCHAR(150) NOT NULL,    -- 임차 장비 사양/모델명
    "monthlyRentFee" NUMERIC(15, 2) NOT NULL,    -- 월 임차료
    "dailyRentFee" NUMERIC(15, 2) NOT NULL,      -- 일 임차료 (월임차료 / 30)
    "leaseStartDate" DATE NOT NULL,              -- 전대 시작일 (출고 완료일)
    "leaseEndDate" DATE,                         -- 전대 종료일 (반납 완료일)
    status VARCHAR(30) NOT NULL,                 -- 'ACTIVE' | 'RETURNED'
    "statementFileUrl" TEXT,
    memo TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "purchaseSettlements" (
    id VARCHAR(50) PRIMARY KEY,                  -- PST-2601-0001
    "settlementYm" VARCHAR(10) NOT NULL,         -- 정산 연월 (YYYY-MM)
    "settlementType" VARCHAR(30) NOT NULL,       -- 'TRANSPORT' | 'CONSUMABLE' | 'EQUIPMENT_LEASE' | 'EXTERNAL_REPAIR'
    "vendorId" VARCHAR(50) NOT NULL,             -- 매입처 FK (TransportCompany.id or Vendor.id)
    "vendorName" VARCHAR(100) NOT NULL,          -- 매입처명
    "totalAmount" NUMERIC(15, 2) NOT NULL,       -- 총 청구/정산액
    "paidAmount" NUMERIC(15, 2) DEFAULT 0,       -- 지급 완료액
    status VARCHAR(30) NOT NULL,                 -- 'PENDING' | 'CONFIRMED' | 'PAID'
    "paymentDate" DATE,                          -- 지급 완료일
    "bankAccount" VARCHAR(100),
    "confirmedAt" TIMESTAMPTZ,
    "confirmedBy" VARCHAR(100),
    "itemCount" INT DEFAULT 0,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "purchaseSettlementItems" (
    id VARCHAR(50) PRIMARY KEY,                  -- PSI-0000001
    "settlementId" VARCHAR(50) NOT NULL,         -- 매입정산 FK
    "sourceType" VARCHAR(30) NOT NULL,           -- 'DELIVERY' | 'CONSUMABLE_PURCHASE' | 'EQUIPMENT_LEASE' | 'REPAIR'
    "sourceId" VARCHAR(50) NOT NULL,             -- 원천 데이터 ID (배차ID, 구매신청ID, 전대계약ID)
    "itemDescription" VARCHAR(200) NOT NULL,     -- 내역 설명
    quantity INT DEFAULT 1,                      -- 수량 or 가동일수
    "unitPrice" NUMERIC(15, 2) NOT NULL,         -- 단가
    amount NUMERIC(15, 2) NOT NULL,              -- 정산 금액
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "settlementPaymentLogs" (
    id VARCHAR(50) PRIMARY KEY,                  -- SPL-2601-0001
    "settlementId" VARCHAR(50) NOT NULL,
    "bankTransactionId" VARCHAR(50),
    "paidAmount" NUMERIC(15, 2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "paymentMethod" VARCHAR(50) DEFAULT '계좌이체',
    memo TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.6 소모품 마스터, 수불 및 구매신청 (`consumables`, `consumableLogs`, `consumablePurchases`)
```sql
CREATE TABLE consumables (
    id VARCHAR(50) PRIMARY KEY,                  -- CON-0000001
    name VARCHAR(100) NOT NULL,                  -- 품목명 (배터리액, 유압유, 조이스틱 등)
    spec VARCHAR(100),
    unit VARCHAR(20) DEFAULT 'EA',
    "unitPrice" NUMERIC(15, 2) NOT NULL,         -- 매입 단가
    "stockQty" INT DEFAULT 0,                    -- 현재 재고 수량
    "safetyStock" INT DEFAULT 10,                -- 안전 재고량
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "consumableLogs" (
    id VARCHAR(50) PRIMARY KEY,                  -- CLOG-0000001
    "consumableId" VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,                   -- 'INBOUND' (입고) | 'OUTBOUND' (출고/정비사용)
    quantity INT NOT NULL,
    "unitPrice" NUMERIC(15, 2) NOT NULL,
    "targetAssetId" VARCHAR(50),                 -- 정비 사용 시 대상 자산 ID
    "userId" VARCHAR(50),                        -- 처리자 ID
    "actionDate" DATE NOT NULL,
    description TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE "consumablePurchases" (
    id VARCHAR(50) PRIMARY KEY,                  -- CPUR-0000001
    "consumableId" VARCHAR(50) NOT NULL,
    "vendorId" VARCHAR(50),                      -- 소모품 공급처 FK
    quantity INT NOT NULL,
    "unitPrice" NUMERIC(15, 2) NOT NULL,
    "totalCost" NUMERIC(15, 2) NOT NULL,
    status VARCHAR(30) NOT NULL,                 -- 'REQUESTED' | 'APPROVED' | 'INBOUND_COMPLETED'
    "requestDate" DATE NOT NULL,
    "inboundDate" DATE,
    "requestedBy" VARCHAR(50),
    "purchaseSettlementId" VARCHAR(50),
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 3. 엔티티 간 라이프사이클 상태 전이표 (State Machine)

| 도메인 | 상태 전이 경로 (Life-Cycle) | 전이 트리거 이벤트 |
|--------|-----------------------------|--------------------|
| **자산 (`assets`)** | `AVAILABLE` ➔ `ASSIGNED` ➔ `RENTED` ➔ `AVAILABLE` / `REPAIRING` | 장비할당 ➔ 출고검수 승인 ➔ 입고검수 완료 |
| **계약 (`contracts`)** | `ACTIVE` ➔ `EXTENDED` ➔ `SUCCEEDED` / `COMPLETED` | 기간연장 ➔ 계약승계 / 전 자산 회수 완료 |
| **배차 (`deliveries`)** | `REQUESTED` ➔ `DISPATCHED` ➔ `COMPLETED` ➔ `RECONCILED` ➔ `PAID` | 기사배정 ➔ 운송완료 ➔ 엑셀대사 ➔ 매입정산지급 |
| **청구 (`billings`)** | `ISSUED` ➔ `PARTIAL` ➔ `PAID` | 청구발행 ➔ 일부입금 ➔ 전액수납(통장대사) |
| **매입정산 (`purchaseSettlements`)** | `PENDING` ➔ `CONFIRMED` ➔ `PAID` | 원천집계 ➔ 정산확정 ➔ 대금지급완료 |
| **전단계약 (`externalLeases`)** | `ACTIVE` ➔ `RETURNED` | 전대출고 ➔ 고객현장 반납완료 |
