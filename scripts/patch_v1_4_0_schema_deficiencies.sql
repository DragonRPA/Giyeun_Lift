-- ==============================================================================
-- [기연리프트 ERP] 전사 단일 표준 DB 스키마 결손 색출 및 통합 DDL 패치
-- 버전: v1.4.0.Build.167 (2026-09-05 14:15)
-- 대상 DBMS: Supabase PostgreSQL (PostgreSQL 15+)
-- 설계 원칙:
--   1. 전사 시스템 개발 표준 헌장 카테고리 I (3대 핵심 가치) & 카테고리 V (검증 및 정합성) 준수
--   2. 완전한 멱등성(Idempotency) 보장: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS
--   3. 제약조건 안전 교체: DROP CONSTRAINT IF EXISTS 선행 후 ADD CONSTRAINT
--   4. RLS 비활성화 및 anon/authenticated 전면 접근성 보장 (헌장 5.3)
-- ==============================================================================

-- ==============================================================================
-- 1. 신규/누락 테이블 생성 (6개 테이블 멱등 생성)
-- ==============================================================================

-- 1-1. 전대/외부 임차 장비 계약 대장 (external_leases)
CREATE TABLE IF NOT EXISTS external_leases (
    id                    TEXT PRIMARY KEY,
    "vendorId"            TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    "contractId"          TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    "contractAssetId"     TEXT REFERENCES contract_assets(id) ON DELETE SET NULL,
    "assetDescription"    TEXT NOT NULL,
    "monthlyRentFee"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyRentFee"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaseStartDate"      TEXT NOT NULL,
    "leaseEndDate"        TEXT,
    status                TEXT CHECK (status IN ('ACTIVE', 'RETURNED')) NOT NULL DEFAULT 'ACTIVE',
    "statementFileUrl"    TEXT,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    contract_id           TEXT
);

-- 1-2. 소모품 구매 요청 및 입고 관리 (consumable_purchases)
CREATE TABLE IF NOT EXISTS consumable_purchases (
    id                    TEXT PRIMARY KEY,
    "consumableId"        TEXT REFERENCES consumables(id) ON DELETE SET NULL,
    "modelName"           TEXT NOT NULL,
    "requestedQty"        INTEGER NOT NULL DEFAULT 1,
    "unitPrice"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellerName"          TEXT NOT NULL,
    status                TEXT CHECK (status IN ('REQUESTED', 'ACCEPTED', 'COMPLETED', 'CANCELLED')) NOT NULL DEFAULT 'REQUESTED',
    "requesterId"         TEXT NOT NULL,
    "requesterName"       TEXT NOT NULL,
    "accepterId"          TEXT,
    "accepterName"        TEXT,
    "inbounderName"       TEXT,
    "receivedQty"         INTEGER NOT NULL DEFAULT 0,
    "statementFileUrl"    TEXT,
    "requestDate"         TEXT NOT NULL,
    "acceptedDate"        TEXT,
    "completedDate"       TEXT,
    "actualReturnDate"    TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL
);

-- 1-3. 장비 입출고/정비/교체 통합 이력 (asset_inout_logs)
CREATE TABLE IF NOT EXISTS asset_inout_logs (
    id                    TEXT PRIMARY KEY,
    "assetId"             TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    "assetNo"             TEXT NOT NULL,
    "modelName"           TEXT NOT NULL,
    type                  TEXT NOT NULL, -- ACQUISITION, OUTBOUND, INBOUND, INBOUND_CANCEL, REPAIR, DISPOSAL, EXCHANGE_OUT, EXCHANGE_IN
    "inboundNo"           TEXT,
    "customerId"          TEXT REFERENCES customers(id) ON DELETE SET NULL,
    "customerName"        TEXT,
    "siteId"              TEXT REFERENCES customer_sites(id) ON DELETE SET NULL,
    "siteName"            TEXT,
    "deliveryId"          TEXT REFERENCES deliveries(id) ON DELETE SET NULL,
    "repairId"            TEXT,
    "maintenanceScore"    INTEGER DEFAULT 0,
    "defectsJson"         TEXT,
    "eventDate"           TEXT NOT NULL,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT
);

-- 1-4. 통장 기초 시작 잔액 (bank_initial_balances)
CREATE TABLE IF NOT EXISTS bank_initial_balances (
    id                    TEXT PRIMARY KEY,
    "bankName"            TEXT NOT NULL,
    "accountNumber"       TEXT,
    "initialBalance"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "asOfDate"            TEXT,
    "createdAt"           TEXT,
    "updatedAt"           TEXT NOT NULL
);

-- 1-5. 법적 최고/내용증명 발송 이력 (legal_notice_logs)
CREATE TABLE IF NOT EXISTS legal_notice_logs (
    id                    TEXT PRIMARY KEY,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "customerName"        TEXT NOT NULL,
    representative        TEXT NOT NULL,
    "bizRegNo"            TEXT,
    address               TEXT NOT NULL,
    "overdueAmount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overdueDays"         INTEGER NOT NULL DEFAULT 0,
    "noticeTitle"         TEXT NOT NULL,
    "noticeContent"       TEXT NOT NULL,
    "deadlineDays"        INTEGER NOT NULL DEFAULT 14,
    "sentDate"            TEXT NOT NULL,
    "sentByUserId"        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    "sentByName"          TEXT NOT NULL,
    "postalTrackingNo"    TEXT,
    status                TEXT DEFAULT 'SENT',
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT
);

-- 1-6. 내용증명 법적 서식 템플릿 (legal_notice_templates)
CREATE TABLE IF NOT EXISTS legal_notice_templates (
    id                    TEXT PRIMARY KEY,
    title                 TEXT NOT NULL,
    content               TEXT NOT NULL,
    "deadlineDays"        INTEGER NOT NULL DEFAULT 14,
    "isDefault"           BOOLEAN DEFAULT FALSE,
    "createdAt"           TEXT,
    "updatedAt"           TEXT NOT NULL
);

-- 1-7. 법인 차량 마스터 (corporate_vehicles)
CREATE TABLE IF NOT EXISTS corporate_vehicles (
    id                    TEXT PRIMARY KEY,
    "vehicleNo"           TEXT NOT NULL UNIQUE,
    "modelName"           TEXT NOT NULL,
    "vehicleType"         TEXT DEFAULT '승합차',
    "ownershipType"       TEXT DEFAULT 'OWNED',
    "fuelType"            TEXT DEFAULT 'DIESEL',
    "assignedDepartment"  TEXT DEFAULT '관리부',
    "primaryDriverId"     TEXT,
    "primaryDriverName"   TEXT,
    "initialMileage"      INTEGER NOT NULL DEFAULT 0,
    "currentMileage"      INTEGER NOT NULL DEFAULT 0,
    "insuranceExpiryDate" TEXT,
    "inspectionExpiryDate" TEXT,
    "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL
);

-- 1-8. 차량운행일지 (vehicle_operation_logs)
CREATE TABLE IF NOT EXISTS vehicle_operation_logs (
    id                    TEXT PRIMARY KEY,
    "vehicleId"           TEXT NOT NULL,
    "vehicleNo"           TEXT NOT NULL,
    "driverId"            TEXT NOT NULL,
    "driverName"          TEXT NOT NULL,
    "driverDept"          TEXT,
    "operationDate"       TEXT NOT NULL,
    "purposeType"         TEXT NOT NULL DEFAULT 'BUSINESS_GENERAL',
    "purposeDetail"       TEXT,
    "departureLocation"   TEXT NOT NULL,
    "arrivalLocation"     TEXT NOT NULL,
    "departureMileage"    INTEGER NOT NULL,
    "arrivalMileage"      INTEGER NOT NULL,
    "driveDistance"       INTEGER NOT NULL,
    "businessDistance"    INTEGER NOT NULL,
    "commuteDistance"     INTEGER NOT NULL DEFAULT 0,
    "dashboardPhotoStart" TEXT,
    "dashboardPhotoEnd"   TEXT,
    memo                  TEXT,
    status                TEXT NOT NULL DEFAULT 'SUBMITTED',
    "confirmedBy"         TEXT,
    "confirmedAt"         TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL
);

-- 1-9. 차량 주유 및 충전 영수증 기록부 (vehicle_fuel_logs)
CREATE TABLE IF NOT EXISTS vehicle_fuel_logs (
    id                    TEXT PRIMARY KEY,
    "vehicleId"           TEXT NOT NULL,
    "vehicleNo"           TEXT NOT NULL,
    "driverId"            TEXT NOT NULL,
    "driverName"          TEXT NOT NULL,
    "fuelDate"            TEXT NOT NULL,
    "fuelType"            TEXT NOT NULL,
    "fuelVolume"          DOUBLE PRECISION NOT NULL,
    "fuelAmount"          DOUBLE PRECISION NOT NULL,
    "fuelUnitPrice"       DOUBLE PRECISION,
    "currentMileage"      INTEGER NOT NULL,
    "dashboardPhotoUrl"   TEXT,
    "receiptPhotoUrl"     TEXT NOT NULL,
    "gasStationName"      TEXT,
    "paymentMethod"       TEXT DEFAULT 'CORPORATE_CARD',
    "cardLast4"           TEXT,
    "fuelEfficiency"      DOUBLE PRECISION,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vlog_vehicle_date ON vehicle_operation_logs("vehicleId", "operationDate");
CREATE INDEX IF NOT EXISTS idx_vlog_driver ON vehicle_operation_logs("driverId");
CREATE INDEX IF NOT EXISTS idx_vfuel_vehicle_date ON vehicle_fuel_logs("vehicleId", "fuelDate");
CREATE INDEX IF NOT EXISTS idx_vfuel_driver ON vehicle_fuel_logs("driverId");


-- ==============================================================================
-- 2. 기존 테이블 20개 컬럼 결손 보강 (ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
-- ==============================================================================

-- 2-1. 임직원 마스터 (users)
ALTER TABLE users ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "baseSalary" DOUBLE PRECISION DEFAULT 0;

-- 2-2. 고객사 마스터 (customers)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "bizType" TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "bizItem" TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "transactionStatus" TEXT DEFAULT 'ALLOWED';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "defaultPaidOptions" TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "defaultProtection" TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "defaultCheckedSpecs" JSONB DEFAULT '{}'::jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "specialNotes" TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "paymentDueDay" INTEGER DEFAULT 25;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "paymentTermDays" INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "bankAccounts" JSONB DEFAULT '[]'::jsonb;

-- 2-3. 고객사 담당자 (customer_contacts)
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT TRUE;

-- 2-4. 고객사 현장 (customer_sites)
ALTER TABLE customer_sites ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT TRUE;
ALTER TABLE customer_sites ADD COLUMN IF NOT EXISTS "paidOptions" TEXT;
ALTER TABLE customer_sites ADD COLUMN IF NOT EXISTS "protection" TEXT;
ALTER TABLE customer_sites ADD COLUMN IF NOT EXISTS "checkedSpecs" JSONB DEFAULT '{}'::jsonb;

-- 2-5. 자산 마스터 (assets)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "maintenanceScore" INTEGER DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "billingDay" INTEGER;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "monthlyRentalFee" DOUBLE PRECISION;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "dailyRentalFee" DOUBLE PRECISION;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "renter" TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "disposalDate" TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "disposalPrice" DOUBLE PRECISION;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "buyer" TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "memo1" TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "memo2" TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "safetyInspectionUrl" TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "preDeliveryChecklistUrl" TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "fullDefectSummary" TEXT;

-- 2-6. 소모품 마스터 (consumables)
ALTER TABLE consumables ADD COLUMN IF NOT EXISTS "supplier" TEXT;

-- 2-7. 소모품 입출고/이동 이력 (consumable_logs)
ALTER TABLE consumable_logs ADD COLUMN IF NOT EXISTS "supplier" TEXT;
ALTER TABLE consumable_logs ADD COLUMN IF NOT EXISTS "mechanicId" TEXT;
ALTER TABLE consumable_logs ADD COLUMN IF NOT EXISTS "fromLocation" TEXT;
ALTER TABLE consumable_logs ADD COLUMN IF NOT EXISTS "toLocation" TEXT;
ALTER TABLE consumable_logs ADD COLUMN IF NOT EXISTS "targetAssetId" TEXT;

-- 2-8. 계약 마스터 (contracts)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "statementClosingDay" INTEGER;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "salespersonName" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBillingDate" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBilledPeriodStart" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBilledPeriodEnd" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBilledYm" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "billingCount" INTEGER DEFAULT 0;

-- 2-9. 계약 투입 자산 슬롯 (contract_assets)
ALTER TABLE contract_assets ADD COLUMN IF NOT EXISTS "actualReturnDate" TEXT;
ALTER TABLE contract_assets ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'RENTED';

-- 2-10. 배차 및 운송 대장 (deliveries)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "scheduledDate" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "costAdjustmentReason" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "reconciliationStatus" TEXT DEFAULT 'PENDING';
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "reconciledAt" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "paymentRequestedAt" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "paymentCompletedAt" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "statementFileUrl" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "billableToCustomer" BOOLEAN DEFAULT FALSE;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "billableCustomerId" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "vehicleRequirements" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "cargoItems" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "vehicles" TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "assignedVehicles" JSONB DEFAULT '[]'::jsonb;

-- 2-11. 매출 청구 대장 (billings)
ALTER TABLE billings ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;
ALTER TABLE billings ADD COLUMN IF NOT EXISTS "details" JSONB;

-- 2-12. 연차 쿼터 대장 (annual_leave_quotas)
ALTER TABLE annual_leave_quotas ADD COLUMN IF NOT EXISTS "periodStart" TEXT;
ALTER TABLE annual_leave_quotas ADD COLUMN IF NOT EXISTS "periodEnd" TEXT;
ALTER TABLE annual_leave_quotas ADD COLUMN IF NOT EXISTS "grantedDays" DOUBLE PRECISION DEFAULT 15;

-- 2-13. 연장/휴일 근로 기록 (overtime_records)
ALTER TABLE overtime_records ADD COLUMN IF NOT EXISTS "startDateTime" TEXT;
ALTER TABLE overtime_records ADD COLUMN IF NOT EXISTS "hours" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE overtime_records ADD COLUMN IF NOT EXISTS "workDetail" TEXT;

-- 2-14. 월별 급여 대장 (payroll_closings)
ALTER TABLE payroll_closings ADD COLUMN IF NOT EXISTS "month" TEXT;
ALTER TABLE payroll_closings ADD COLUMN IF NOT EXISTS "approvedAt" TEXT;
ALTER TABLE payroll_closings ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;

-- 2-15. 정비 및 현장 AS 대장 (repairs)
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "targetAssetStatus" TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "siteAddress" TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "inspectionItemCode" TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "degradationScore" INTEGER DEFAULT 0;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "consumables" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "timelineEvents" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "evidenceImages" TEXT[];

-- 2-16. 통장 거래내역 (bank_transactions)
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "accountNumber" TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "counterparty" TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "balance" DOUBLE PRECISION;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "branchName" TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS "isDeposit" BOOLEAN DEFAULT TRUE;

-- 2-17. 클라우드 및 구글 연동 설정 (google_configs)
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "currentInsuranceStartDate" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "currentInsuranceEndDate" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "nextInsuranceCertUrl" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "nextInsuranceStartDate" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "nextInsuranceEndDate" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "mirrorRecursive" BOOLEAN DEFAULT TRUE;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "r2AccountId" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "r2BucketName" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "r2AccessKeyId" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "r2SecretAccessKey" TEXT;
ALTER TABLE google_configs ADD COLUMN IF NOT EXISTS "r2PublicDomain" TEXT;

-- 2-18. 출고 전 장비 검수 대장 (outbound_inspections)
ALTER TABLE outbound_inspections ADD COLUMN IF NOT EXISTS "deliveryId" TEXT REFERENCES deliveries(id) ON DELETE SET NULL;
ALTER TABLE outbound_inspections ADD COLUMN IF NOT EXISTS "approvedAt" TEXT;

-- 2-19. 월말 매입 정산 마스터 (purchase_settlements)
ALTER TABLE purchase_settlements ADD COLUMN IF NOT EXISTS "itemCount" INTEGER DEFAULT 0;
ALTER TABLE purchase_settlements ADD COLUMN IF NOT EXISTS "bankTransactionId" TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL;

-- 2-20. 선수금 거래 내역 (prepaid_transactions)
ALTER TABLE prepaid_transactions ADD COLUMN IF NOT EXISTS "billingId" TEXT REFERENCES billings(id) ON DELETE SET NULL;
ALTER TABLE prepaid_transactions ADD COLUMN IF NOT EXISTS "paymentId" TEXT REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE prepaid_transactions ADD COLUMN IF NOT EXISTS "bankTransactionId" TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL;
ALTER TABLE prepaid_transactions ADD COLUMN IF NOT EXISTS "memo" TEXT;

-- 2-21. 연체 채권 조치 이력 (delinquency_action_logs)
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "actionDetails" TEXT;
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "proofFileName" TEXT;
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "recordedBy" TEXT;
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "mandateType" TEXT DEFAULT 'CEO_AUTO_MANDATE';
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "promiseDate" TEXT;
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "promiseAmount" DOUBLE PRECISION;
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "promiseStatus" TEXT DEFAULT 'PENDING';
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "promiseContactPerson" TEXT;
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "directiveTargetUserId" TEXT;
ALTER TABLE delinquency_action_logs ADD COLUMN IF NOT EXISTS "directiveDueDate" TEXT;

-- 2-22. 자산 입출고 이력 (asset_inout_logs)
ALTER TABLE asset_inout_logs ADD COLUMN IF NOT EXISTS "inboundNo" TEXT;
ALTER TABLE asset_inout_logs ADD COLUMN IF NOT EXISTS "maintenanceScore" INTEGER DEFAULT 0;
ALTER TABLE asset_inout_logs ADD COLUMN IF NOT EXISTS "defectsJson" TEXT;



-- 코드 사용 편의 확장 컬럼 (호환성 보장)
ALTER TABLE contract_assets ADD COLUMN IF NOT EXISTS "contractStart" TEXT;
ALTER TABLE contract_assets ADD COLUMN IF NOT EXISTS "contractEnd" TEXT;
ALTER TABLE contract_assets ADD COLUMN IF NOT EXISTS "currentCustomerId" TEXT;
ALTER TABLE contract_assets ADD COLUMN IF NOT EXISTS "currentSiteId" TEXT;
ALTER TABLE asset_inout_logs ADD COLUMN IF NOT EXISTS date TEXT;
ALTER TABLE asset_inout_logs ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS "resolvedSiteAddress" TEXT;

-- ==============================================================================
-- 3. CHECK 제약조건 안전 재설정 (DROP CONSTRAINT IF EXISTS -> ADD CONSTRAINT)
-- ==============================================================================

-- 3-1. 배차 구분 제약조건 ('교환' 정식 포함 - 헌장 2.3)
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_dispatchCategory_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_dispatchCategory_check CHECK ("dispatchCategory" IN ('출고', '입고', '반납', '정비', '이동', '교환'));

-- 3-2. 배차 운송비 대사 상태 제약조건
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_reconciliationStatus_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_reconciliationStatus_check CHECK ("reconciliationStatus" IN ('PENDING', 'MATCHED', 'MISMATCH', 'RECONCILED', 'PAYMENT_REQUESTED', 'PAID'));

-- 3-3. 고객사 거래상태 제약조건 (출고제한 BLOCKED)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_transactionStatus_check;
ALTER TABLE customers ADD CONSTRAINT customers_transactionStatus_check CHECK ("transactionStatus" IN ('ALLOWED', 'BLOCKED'));

-- 3-4. 선수금 거래구분 제약조건
ALTER TABLE prepaid_transactions DROP CONSTRAINT IF EXISTS prepaid_transactions_type_check;
ALTER TABLE prepaid_transactions ADD CONSTRAINT prepaid_transactions_type_check CHECK (type IN ('DEPOSIT', 'DEDUCTION', 'REFUND', 'CHARGE', 'USE_FOR_BILLING'));

-- 3-5. 연체 조치 유형 제약조건
ALTER TABLE delinquency_action_logs DROP CONSTRAINT IF EXISTS delinquency_action_logs_actionType_check;
ALTER TABLE delinquency_action_logs ADD CONSTRAINT delinquency_action_logs_actionType_check CHECK ("actionType" IN ('CALL', 'SMS', 'VISIT', 'LEGAL_NOTICE', 'DEVICE_LOCK', 'NOTICE_SENT', 'LEGAL', 'DIRECTIVE'));

-- 3-6. 자산 입출고 타입 제약조건 해제 (INBOUND_CANCEL 및 EXCHANGE 등 허용)
ALTER TABLE asset_inout_logs DROP CONSTRAINT IF EXISTS asset_inout_logs_type_check;


-- ==============================================================================
-- 4. 레거시 테이블 명칭 호환 및 데이터 보존 (VIEW & SYNC)
-- ==============================================================================

-- 4-1. bank_initial_balances 데이터 보존
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bank_account_initial_balances') THEN
        INSERT INTO bank_initial_balances (id, "bankName", "accountNumber", "initialBalance", "asOfDate", "createdAt", "updatedAt")
        SELECT id, "bankName", "accountNumber", "initialBalance", "asOfDate", "createdAt", "updatedAt"
        FROM bank_account_initial_balances
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- 4-2. asset_in_out_logs 호환 뷰 생성 (하위 호환성)
CREATE OR REPLACE VIEW asset_in_out_logs AS SELECT * FROM asset_inout_logs;


-- ==============================================================================
-- 5. RLS (Row Level Security) 비활성화 및 완전 무제한 정책 설정 (헌장 5.3)
-- ==============================================================================

DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', tbl);
    END LOOP;
END $$;

-- ==============================================================================
-- [패치 완료] Giyeun Lift ERP DB 스키마 v1.4.0.Build.167 적용 완료
-- ==============================================================================
