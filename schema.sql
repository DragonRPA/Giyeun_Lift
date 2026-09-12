-- ==============================================================================
-- [기연리프트 ERP] 전사 단일 표준 통합 데이터베이스 DDL 스키마 (SSOT)
-- 대상 DBMS: Supabase PostgreSQL (PostgreSQL 15+)
-- 설계 원칙:
--   1. [카테고리 I] 3대 핵심 가치 (자산 운용, 무누락 DB 이력, 임직원 최소 조작)
--   2. [논리적 컬럼 6단계 배치 표준]:
--      ① 식별자/PK ➔ ② 핵심 본질 속성 ➔ ③ 관계/외래키(FK) ➔ ④ 일정/수량/금액 ➔ ⑤ 상태/메모/비고 ➔ ⑥ 감사 추적(Audit)
--   3. 중복 정의 제거 및 RLS 보안 정책 멱등성 100% 보장
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 기존 테이블 일괄 정리 (FK 역순 CASCADE)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS settlement_payment_logs CASCADE;
DROP TABLE IF EXISTS purchase_settlement_items CASCADE;
DROP TABLE IF EXISTS purchase_settlements CASCADE;
DROP TABLE IF EXISTS payment_deposit_links CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS receivables CASCADE;
DROP TABLE IF EXISTS billing_details CASCADE;
DROP TABLE IF EXISTS billing_invoices CASCADE;
DROP TABLE IF EXISTS billings CASCADE;
DROP TABLE IF EXISTS bank_matching_rules CASCADE;
DROP TABLE IF EXISTS bank_transactions CASCADE;
DROP TABLE IF EXISTS bank_account_initial_balances CASCADE;
DROP TABLE IF EXISTS cash_flow_snapshots CASCADE;
DROP TABLE IF EXISTS prepaid_transactions CASCADE;
DROP TABLE IF EXISTS legal_notice_templates CASCADE;
DROP TABLE IF EXISTS legal_notice_logs CASCADE;
DROP TABLE IF EXISTS external_leases CASCADE;
DROP TABLE IF EXISTS bank_initial_balances CASCADE;
DROP TABLE IF EXISTS asset_inout_logs CASCADE;
DROP TABLE IF EXISTS delinquency_action_logs CASCADE;
DROP TABLE IF EXISTS depreciation_logs CASCADE;
DROP TABLE IF EXISTS outbound_inspections CASCADE;
DROP TABLE IF EXISTS inbound_defect_details CASCADE;
DROP TABLE IF EXISTS asset_in_out_logs CASCADE;
DROP TABLE IF EXISTS repair_timeline_events CASCADE;
DROP TABLE IF EXISTS repair_consumables CASCADE;
DROP TABLE IF EXISTS repairs CASCADE;
DROP TABLE IF EXISTS inspection_checklist_items CASCADE;
DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS transport_drivers CASCADE;
DROP TABLE IF EXISTS transport_companies CASCADE;
DROP TABLE IF EXISTS contract_history CASCADE;
DROP TABLE IF EXISTS contract_assets CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS mechanic_consumable_stocks CASCADE;
DROP TABLE IF EXISTS consumable_logs CASCADE;
DROP TABLE IF EXISTS consumable_purchase_items CASCADE;
DROP TABLE IF EXISTS consumable_purchase_requests CASCADE;
DROP TABLE IF EXISTS consumable_purchases CASCADE;
DROP TABLE IF EXISTS consumables CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS customer_bank_accounts CASCADE;
DROP TABLE IF EXISTS customer_sites CASCADE;
DROP TABLE IF EXISTS customer_contacts CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS vendors CASCADE;
DROP TABLE IF EXISTS payroll_closings CASCADE;
DROP TABLE IF EXISTS overtime_records CASCADE;
DROP TABLE IF EXISTS leave_usages CASCADE;
DROP TABLE IF EXISTS annual_leave_quotas CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS collaboration_request_history CASCADE;
DROP TABLE IF EXISTS collaboration_requests CASCADE;
DROP TABLE IF EXISTS work_instructions CASCADE;
DROP TABLE IF EXISTS announcement_reads CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS todos CASCADE;
DROP TABLE IF EXISTS document_jobs CASCADE;
DROP TABLE IF EXISTS agent_registry CASCADE;
DROP TABLE IF EXISTS google_configs CASCADE;


-- ==============================================================================
-- 🏛️ [도메인 1] 조직, 계정 및 인사노무 (Org, Users & HR)
-- ==============================================================================

-- 1-1. 부서 마스터 (departments)
CREATE TABLE departments (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL UNIQUE,
    "parentDepartmentId"  TEXT REFERENCES departments(id) ON DELETE SET NULL,
    "managerId"           TEXT, -- 부서장 users.id
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 1-2. 사용자 및 임직원 마스터 (users)
CREATE TABLE users (
    id                    TEXT PRIMARY KEY,
    "loginId"             TEXT NOT NULL UNIQUE,
    "passwordHash"        TEXT NOT NULL,
    name                  TEXT NOT NULL,
    "departmentId"        TEXT REFERENCES departments(id) ON DELETE SET NULL,
    position              TEXT, -- 직급 (사원, 대리, 과장, 차장, 부장, 이사, 대표이사)
    "managerId"           TEXT REFERENCES users(id) ON DELETE SET NULL, -- 직속 상급자
    role                  TEXT CHECK (role IN ('ADMIN', 'MANAGER', 'USER', 'MECHANIC')) NOT NULL DEFAULT 'USER',
    status                TEXT CHECK (status IN ('ACTIVE', 'LEAVE_OF_ABSENCE', 'RETIRED')) NOT NULL DEFAULT 'ACTIVE',
    department            TEXT, -- 부서명 (레거시/표시용)
    "baseSalary"          DOUBLE PRECISION NOT NULL DEFAULT 0, -- 기본급 (급여 정산 권한자 전용)
    phone                 TEXT,
    email                 TEXT,
    address               TEXT,
    "birthDate"           TEXT,
    "joinDate"            TEXT,
    "retireDate"          TEXT,
    "profileImageUrl"     TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 1-3. 메뉴별 권한 마스터 (permissions)
CREATE TABLE permissions (
    id                    TEXT PRIMARY KEY,
    "userId"              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "menuId"              TEXT NOT NULL,
    role                  TEXT DEFAULT 'USER',
    "canView"             BOOLEAN NOT NULL DEFAULT FALSE,
    "canSave"             BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt"           TEXT,
    "updatedAt"           TEXT,
    UNIQUE("userId", "menuId"),
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 1-4. 연차 생성 쿼터 (annual_leave_quotas)
CREATE TABLE annual_leave_quotas (
    id                    TEXT PRIMARY KEY,
    "userId"              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year                  INTEGER NOT NULL,
    "baseDays"            DOUBLE PRECISION NOT NULL DEFAULT 15,
    "bonusDays"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDays"           DOUBLE PRECISION NOT NULL DEFAULT 15,
    "usedDays"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingDays"       DOUBLE PRECISION NOT NULL DEFAULT 15,
    "periodStart"         TEXT, -- YYYY-MM-DD (갱신 주기 시작)
    "periodEnd"           TEXT, -- YYYY-MM-DD (갱신 주기 종료)
    "grantedDays"         DOUBLE PRECISION NOT NULL DEFAULT 15, -- 부여 연차 일수
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    UNIQUE("userId", year),
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 1-5. 휴가 사용 내역 (leave_usages)
CREATE TABLE leave_usages (
    id                    TEXT PRIMARY KEY,
    "userId"              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "leaveType"           TEXT CHECK ("leaveType" IN ('ANNUAL', 'HALF_AM', 'HALF_PM', 'SPECIAL', 'SICK', 'OFFICIAL', 'UNPAID')) NOT NULL,
    "startDate"           TEXT NOT NULL,
    "endDate"             TEXT NOT NULL,
    "usedDays"            DOUBLE PRECISION NOT NULL,
    reason                TEXT,
    status                TEXT CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')) NOT NULL DEFAULT 'PENDING',
    "approverId"          TEXT REFERENCES users(id) ON DELETE SET NULL,
    "approvedAt"          TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 1-6. 연장/휴일 근로 기록 (overtime_records)
CREATE TABLE overtime_records (
    id                    TEXT PRIMARY KEY,
    "userId"              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "workDate"            TEXT NOT NULL,
    "overtimeType"        TEXT CHECK ("overtimeType" IN ('OVERTIME', 'NIGHT', 'HOLIDAY')) NOT NULL,
    "startTime"           TEXT NOT NULL,
    "endTime"             TEXT NOT NULL,
    "hoursWorked"         DOUBLE PRECISION NOT NULL,
    "startDateTime"       TEXT, -- YYYY-MM-DD HH:mm (시작 일시)
    hours                 DOUBLE PRECISION NOT NULL DEFAULT 0, -- 연장근로 시간
    "workDetail"          TEXT, -- 연장근무 내용
    reason                TEXT NOT NULL,
    status                TEXT CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) NOT NULL DEFAULT 'PENDING',
    "approverId"          TEXT REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 1-7. 월별 급여 대장 (payroll_closings)
CREATE TABLE payroll_closings (
    id                    TEXT PRIMARY KEY,
    "payrollYm"           TEXT NOT NULL, -- YYYY-MM
    month                 TEXT, -- YYYY-MM 별칭
    "approvedAt"          TEXT,
    "approvedBy"          TEXT,
    "userId"              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "baseSalary"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimePay"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusPay"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherAllowance"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalGross"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "incomeTax"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "residentTax"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nationalPension"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "healthInsurance"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "careInsurance"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employmentInsurance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDeductions"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netSalary"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    status                TEXT CHECK (status IN ('DRAFT', 'CONFIRMED', 'PAID')) NOT NULL DEFAULT 'DRAFT',
    "paymentDate"         TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    UNIQUE("payrollYm", "userId"),
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);


-- ==============================================================================
-- 🏢 [도메인 2] 기준 정보 (Master Data - 거래처, 제품, 자산, 부품)
-- ==============================================================================

-- 2-1. 매입 거래처 마스터 (vendors)
CREATE TABLE vendors (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    type                  TEXT CHECK (type IN ('TRANSPORT', 'RENTAL', 'REPAIR', 'PURCHASE', 'OTHER')) NOT NULL,
    types                 TEXT, -- 다중 업종 콤마 구분
    "bizRegNo"            TEXT,
    representative        TEXT,
    "contactName"         TEXT,
    contact               TEXT,
    email                 TEXT,
    address               TEXT,
    "bankAccount"         TEXT,
    "bankName"            TEXT,
    "accountNumber"       TEXT,
    "accountHolder"       TEXT,
    "passbookFileUrl"     TEXT,
    "passbookFileName"    TEXT,
    "businessCertFileUrl" TEXT,
    "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
    memo                  TEXT,
    "firstTradeDate"       TEXT, -- 최초 거래개시일 (YYYY-MM-DD)
    "lastTradeDate"        TEXT, -- 최근 거래일 (YYYY-MM-DD)
    "totalPurchaseAmount"  BIGINT DEFAULT 0, -- 누적 거래액 (원, 매입거래 누계액)
    "taxType"             TEXT,
    "businessStatus"      TEXT DEFAULT 'ACTIVE',
    "closedDate"          TEXT,
    "lastStatusCheckDate" TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-2. 고객사 마스터 (customers)
CREATE TABLE customers (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    "bizRegNo"            TEXT,
    representative        TEXT,
    "repContact"          TEXT,
    "repEmail"            TEXT,
    address               TEXT,
    "bizType"             TEXT, -- 업태 (예: 건설업, 도소매업)
    "bizItem"             TEXT, -- 종목 (예: 고소작업대임대, 가설재)
    "transactionStatus"   TEXT CHECK ("transactionStatus" IN ('ALLOWED', 'BLOCKED')) NOT NULL DEFAULT 'ALLOWED', -- ALLOWED: 정상거래, BLOCKED: 신규계약/출고제한
    "defaultBillingDay"   INTEGER DEFAULT 30,
    "defaultStatementClosingDay" INTEGER DEFAULT 25,
    "paymentDueDay"       INTEGER,
    "paymentTermDays"     INTEGER,
    "prepaidBalance"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defaultPaidOptions"  TEXT, -- 고객사 기본 유상옵션
    "defaultProtection"   TEXT, -- 고객사 기본 보양작업
    "defaultCheckedSpecs" JSONB, -- 고객사 기본 요구사양 체크 상태
    "bankAccounts"        JSONB, -- 고객사 환불/거래 계좌 목록
    "driveFolderId"       TEXT,
    "openingDate"         TEXT, -- 개업연월일
    "taxOffice"           TEXT, -- 관할 세무서
    "headOfficeAddress"   TEXT, -- 본점 소재지
    "businessCertFileUrl" TEXT, -- 사업자등록증 URL
    "passbookFileUrl"     TEXT, -- 통장사본 URL
    "passbookFileName"    TEXT, -- 통장사본 파일명
    "taxType"             TEXT, -- 국세청 과세유형
    "taxTypeCd"           TEXT, -- 국세청 과세유형 코드
    "businessStatus"      TEXT DEFAULT 'ACTIVE', -- 사업자 상태
    "closedDate"          TEXT, -- 폐업일자
    "lastStatusCheckDate" TEXT, -- 최근 국세청 조회일시
    "isClosed"            BOOLEAN NOT NULL DEFAULT FALSE,
    "specialNotes"        TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-3. 고객사 담당자 (customer_contacts)
CREATE TABLE customer_contacts (
    id                    TEXT PRIMARY KEY,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    position              TEXT,
    contact               TEXT,
    email                 TEXT,
    "isPrimary"           BOOLEAN NOT NULL DEFAULT FALSE,
    "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-4. 고객사 현장 (customer_sites)
CREATE TABLE customer_sites (
    id                    TEXT PRIMARY KEY,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    address               TEXT,
    "contactName"         TEXT,
    contact               TEXT,
    email                 TEXT,
    "paidOptions"         TEXT, -- 현장별 유상옵션
    "protection"          TEXT, -- 현장별 보양작업
    "checkedSpecs"        JSONB, -- 현장별 요구사양 체크 상태
    "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-5. 고객사 계좌 (customer_bank_accounts)
CREATE TABLE customer_bank_accounts (
    id                    TEXT PRIMARY KEY,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "bankName"            TEXT NOT NULL,
    "accountNumber"       TEXT NOT NULL,
    "accountHolder"       TEXT NOT NULL,
    "isPrimary"           BOOLEAN DEFAULT FALSE,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-6. 제품 카탈로그 및 표준 제원 (products)
CREATE TABLE products (
    id                    TEXT PRIMARY KEY,
    "modelName"           TEXT NOT NULL UNIQUE,
    feet                  DOUBLE PRECISION NOT NULL,
    manufacturer          TEXT,
    spec                  TEXT,
    weight                TEXT,
    speed                 TEXT,
    "maxHeightCapacity"   TEXT,
    "powerSource"         TEXT,
    "workingHeight"       TEXT,
    "platformHeight"      TEXT,
    "machineDimensions"   TEXT,
    "platformDimensions"  TEXT,
    "gradeability"        TEXT,
    "capacityPreExt"      TEXT,
    "capacityPostExtMain" TEXT,
    "capacityPostExtDeck" TEXT,
    "maxWindSpeed"        TEXT DEFAULT '12.5 m/s 이내',
    "asContact"           TEXT DEFAULT '031-334-5296',
    "safetyCertDate"      TEXT,
    "safetyCertUrl"       TEXT,
    "specSheetUrl"        TEXT,
    "emergencyGuideUrl"   TEXT,
    "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-7. 자산 마스터 (assets) - 논리적 6단계 완전 정돈
CREATE TABLE assets (
    -- ① 식별자
    id                    TEXT PRIMARY KEY,
    "assetNo"             TEXT NOT NULL UNIQUE,
    "vendorAssetNo"       TEXT, -- 원사(타사) 실물 원래 관리번호
    "serialNo"            TEXT,

    -- ② 장비 제원 및 소유 속성
    "modelName"           TEXT NOT NULL REFERENCES products("modelName") ON UPDATE CASCADE,
    manufacturer          TEXT,
    "manufactureYear"     TEXT,
    "ownerType"           TEXT CHECK ("ownerType" IN ('OWNED', 'RENTED')) NOT NULL,

    -- ③ 임차 및 매입처 연동
    "vendorId"            TEXT REFERENCES vendors(id) ON DELETE SET NULL,
    supplier              TEXT,

    -- ④ 임차 기간 및 원가 단가
    "rentStart"           TEXT,
    "rentEnd"             TEXT,
    "actualRentReturnDate" TEXT,
    "monthlyRentFee"      DOUBLE PRECISION DEFAULT 0,
    "dailyRentFee"        DOUBLE PRECISION DEFAULT 0,
    "maintenanceScore"    INTEGER NOT NULL DEFAULT 0, -- 정비점수 (0~10)
    "billingDay"          INTEGER, -- 청구 마감일
    "monthlyRentalFee"    DOUBLE PRECISION, -- 약정 월 대여료
    "dailyRentalFee"      DOUBLE PRECISION, -- 약정 일 대여료
    renter                TEXT, -- 임차처 (타사 전대 시)
    "disposalDate"        TEXT, -- 매각일자
    "disposalPrice"       DOUBLE PRECISION, -- 매각금액
    buyer                 TEXT, -- 매각처
    memo1                 TEXT, -- 상세 비고 1
    memo2                 TEXT, -- 상세 비고 2
    "safetyInspectionUrl" TEXT, -- 안전검사증 URL
    "preDeliveryChecklistUrl" TEXT, -- 출고전점검표 URL
    "fullDefectSummary"   TEXT, -- 전수 결함 요약

    -- ⑤ 현재 가동 현장 및 계약 속성 (실시간 라이프사이클)
    "currentCustomerId"   TEXT REFERENCES customers(id) ON DELETE SET NULL,
    "currentSiteId"       TEXT REFERENCES customer_sites(id) ON DELETE SET NULL,
    "contractStart"       TEXT,
    "contractEnd"         TEXT,

    -- ⑥ 자산 회계 및 손익 원장
    "acquisitionDate"     TEXT,
    "acquisitionPrice"    DOUBLE PRECISION DEFAULT 0,
    "depreciationMonths"  INTEGER DEFAULT 60,
    "residualValueRate"   DOUBLE PRECISION DEFAULT 0,
    "accumDepreciation"   DOUBLE PRECISION DEFAULT 0,
    "bookValue"           DOUBLE PRECISION DEFAULT 0,
    "cumRentalFee"        DOUBLE PRECISION DEFAULT 0,
    "cumRepairCost"       DOUBLE PRECISION DEFAULT 0,

    -- ⑦ 업무 상태 및 감사
    status                TEXT CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'RENTED', 'REPAIRING', 'RENTED_RETURNED', 'SOLD')) NOT NULL DEFAULT 'AVAILABLE',
    memo                  TEXT,
    note                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-8. 소모품/부품 카탈로그 (consumables)
CREATE TABLE consumables (
    id                    TEXT PRIMARY KEY,
    "modelName"           TEXT NOT NULL UNIQUE,
    unit                  TEXT NOT NULL,
    "unitPrice"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockQty"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    supplier              TEXT, -- 구입처/공급업체
    "vendorId"            TEXT REFERENCES vendors(id) ON DELETE SET NULL,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-8-1. 소모품 구매 요청 및 입고 관리 (consumable_purchases)
CREATE TABLE consumable_purchases (
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
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-9. 정비사 차량별 적재 부품 재고 (mechanic_consumable_stocks)
CREATE TABLE mechanic_consumable_stocks (
    id                    TEXT PRIMARY KEY,
    "mechanicId"          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "consumableId"        TEXT NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
    "stockQty"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt"           TEXT,
    "updatedAt"           TEXT NOT NULL,
    UNIQUE("mechanicId", "consumableId"),
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-10. 운송 거래처 (transport_companies)
CREATE TABLE transport_companies (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    "businessNo"          TEXT,
    contact               TEXT,
    "bankName"            TEXT,
    "bankAccount"         TEXT,
    "bankHolder"          TEXT,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 2-11. 운송 기사 (transport_drivers)
CREATE TABLE transport_drivers (
    id                    TEXT PRIMARY KEY,
    "companyId"           TEXT REFERENCES transport_companies(id) ON DELETE SET NULL,
    "driverName"          TEXT NOT NULL,
    "driverContact"       TEXT,
    "vehicleNo"           TEXT,
    "vehicleType"         TEXT,
    "vehicleColor"        TEXT,
    "birthDate"           TEXT,
    "idNo"                TEXT,
    address               TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);


-- ==============================================================================
-- 📜 [도메인 3] 계약, 배차 및 출고/입고 (Operations)
-- ==============================================================================

-- 3-1. 임대 계약 마스터 (contracts)
CREATE TABLE contracts (
    id                    TEXT PRIMARY KEY,
    "contractNo"          TEXT NOT NULL UNIQUE,
    "contractType"        TEXT CHECK ("contractType" IN ('RENTAL', 'SALE')) NOT NULL DEFAULT 'RENTAL',
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "salespersonId"       TEXT REFERENCES users(id) ON DELETE SET NULL,
    "contactId"           TEXT REFERENCES customer_contacts(id) ON DELETE SET NULL,
    "siteId"              TEXT REFERENCES customer_sites(id) ON DELETE SET NULL,
    "startDate"           TEXT NOT NULL,
    "endDate"             TEXT NOT NULL,
    "billingDay"          INTEGER NOT NULL DEFAULT 30,
    "statementClosingDay" INTEGER, -- 거래명세서 마감일
    "customerName"        TEXT,
    "salespersonName"     TEXT,
    "paymentDueDay"       INTEGER,
    "lateInterestRate"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    status                TEXT CHECK (status IN ('ACTIVE', 'EXTENDED', 'SHORTENED', 'SUCCEEDED', 'COMPLETED')) NOT NULL DEFAULT 'ACTIVE',
    "predecessorContractId" TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "predecessorContractNo" TEXT,
    "predecessorCustomerId" TEXT REFERENCES customers(id) ON DELETE SET NULL,
    "predecessorCustomerName" TEXT,
    "successorContractId" TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "driveFolderId"       TEXT,
    "lastBillingDate"     TEXT,
    "lastBilledPeriodStart" TEXT,
    "lastBilledPeriodEnd" TEXT,
    "lastBilledYm"        TEXT,
    "billingCount"        INTEGER NOT NULL DEFAULT 0,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 3-2. 체결 자산 목록 (contract_assets)
CREATE TABLE contract_assets (
    id                    TEXT PRIMARY KEY,
    "contractId"          TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    "assetId"             TEXT REFERENCES assets(id) ON DELETE SET NULL,
    "expectedModel"       TEXT,
    "monthlyRentalFee"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyRentalFee"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salePrice"           DOUBLE PRECISION DEFAULT 0,
    "startDate"           TEXT NOT NULL,
    "endDate"             TEXT NOT NULL,
    status                TEXT DEFAULT 'ASSIGNED',
    "contractStart"       TEXT,
    "contractEnd"         TEXT,
    "currentCustomerId"   TEXT,
    "currentSiteId"       TEXT,
    "actualReturnDate"    TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 3-2-1. 전대/외부 임차 장비 계약 대장 (external_leases)
CREATE TABLE external_leases (
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
    contract_id           TEXT,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 3-3. 계약 변경 이력 및 타임라인 (contract_history)
CREATE TABLE contract_history (
    id                    TEXT PRIMARY KEY,
    "contractId"          TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    "changeType"          TEXT CHECK ("changeType" IN ('REGISTER', 'EXTEND', 'SHORTEN', 'SUCCEED', 'TERMINATE', 'EXCHANGE', 'FEE_CHANGE', 'AS_SERVICE', 'BILLING_CREATED', 'BILLING_SENT', 'BILLING_CANCELLED', 'BILLING_REGENERATED', 'PAYMENT_RECEIVED', 'PAYMENT_CANCELLED', 'DOCUMENT_SENT', 'ASSET_SOLD')) NOT NULL,
    "prevEndDate"         TEXT,
    "newEndDate"          TEXT,
    description           TEXT,
    "changeDate"          TEXT NOT NULL,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 3-4. 배차 및 화물 운송 대장 (deliveries) - 논리적 6단계 완전 정돈
CREATE TABLE deliveries (
    -- ① 식별 및 계약
    id                    TEXT PRIMARY KEY,
    "contractId"          TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "assetIds"            TEXT,
    type                  TEXT CHECK (type IN ('OUTBOUND', 'INBOUND', 'EXCHANGE', 'MOVEMENT', 'RETURN')) NOT NULL,
    "dispatchCategory"    TEXT CHECK ("dispatchCategory" IN ('출고', '입고', '반납', '정비', '이동', '교환')) DEFAULT '출고',

    -- ② 운송사 및 배정 기사
    "transportVendorId"   TEXT REFERENCES vendors(id) ON DELETE SET NULL,
    "transportCompany"    TEXT,
    "driverName"          TEXT,
    "driverContact"       TEXT,
    "vehicleNo"           TEXT,
    "vehicleType"         TEXT,
    "assignedVehicles"    JSONB DEFAULT '[]'::jsonb,

    -- ③ 상차지 (출발)
    "pickupType"          TEXT CHECK ("pickupType" IN ('HQ_YARD', 'VENDOR_YARD', 'CUSTOMER_SITE', 'YARD', 'VENDOR')) DEFAULT 'HQ_YARD',
    "pickupVendorName"    TEXT,
    "originAddress"       TEXT,
    "loadingDate"         TEXT,
    "loadingTimeSlot"     TEXT DEFAULT '오전',
    "loadingTime"         TEXT,

    -- ④ 하차지 (경유 및 도착)
    "dropoffType"         TEXT CHECK ("dropoffType" IN ('SINGLE', 'MULTI_STOP')) DEFAULT 'SINGLE',
    "viaDropoffName"      TEXT,
    "viaDropoffAddress"   TEXT,
    "destinationAddress"  TEXT,
    "unloadingDate"       TEXT,
    "unloadingTimeSlot"   TEXT DEFAULT '오전',
    "unloadingTime"       TEXT,

    -- ⑤ 운송비 및 정산
    "expectedCost"        DOUBLE PRECISION DEFAULT 0,
    "deliveryCost"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalCost"           DOUBLE PRECISION DEFAULT 0,
    "deliveryCostConfirmed" DOUBLE PRECISION DEFAULT 0,
    "costAdjustmentReason" TEXT,
    "reconciliationStatus" TEXT CHECK ("reconciliationStatus" IN ('PENDING', 'MATCHED', 'MISMATCH', 'RECONCILED', 'PAYMENT_REQUESTED', 'PAID')) NOT NULL DEFAULT 'PENDING',
    "reconciledAt"        TEXT,
    "paymentRequestedAt"  TEXT,
    "paymentCompletedAt"  TEXT,
    "statementFileUrl"    TEXT,
    "billableToCustomer"  BOOLEAN NOT NULL DEFAULT FALSE,
    "billableCustomerId"  TEXT,
    "billableAmount"      DOUBLE PRECISION DEFAULT 0,
    "billingId"           TEXT,
    "isWaived"            BOOLEAN NOT NULL DEFAULT FALSE,
    "waivedAmount"        DOUBLE PRECISION DEFAULT 0,
    "waivedBy"            TEXT,
    "waivedReason"        TEXT,
    "waivedAt"            TEXT,
    "vehicleRequirements" TEXT,
    "cargoItems"          TEXT,
    vehicles              TEXT,
    "scheduledDate"       TEXT,
    "purchaseBillId"      TEXT,
    "isCostSettled"       BOOLEAN DEFAULT FALSE,

    -- ⑥ 상태 및 업무 감사
    status                TEXT CHECK (status IN ('PENDING', 'REQUESTED', 'DISPATCHED', 'DELIVERED', 'COMPLETED', 'CANCELLED')) NOT NULL DEFAULT 'PENDING',
    "requestDate"         TEXT NOT NULL,
    "rawText"             TEXT,
    memo                  TEXT,
    "closingMemo"         TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 3-5. 출고 검수 승인 대장 (outbound_inspections)
CREATE TABLE outbound_inspections (
    id                    TEXT PRIMARY KEY,
    "contractId"          TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "contractAssetId"     TEXT REFERENCES contract_assets(id) ON DELETE SET NULL,
    "assetId"             TEXT REFERENCES assets(id) ON DELETE SET NULL,
    status                TEXT CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED')) NOT NULL DEFAULT 'PENDING',
    "specsJson"           TEXT,
    "deliveryId"          TEXT REFERENCES deliveries(id) ON DELETE SET NULL,
    "inspectorId"         TEXT REFERENCES users(id) ON DELETE SET NULL,
    "inspectedAt"         TEXT,
    "approvedAt"          TEXT,
    "rejectReason"        TEXT,
    "repairId"            TEXT REFERENCES repairs(id) ON DELETE SET NULL,
    note                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE INDEX IF NOT EXISTS idx_outbound_inspections_contract_id ON outbound_inspections("contractId");
CREATE INDEX IF NOT EXISTS idx_outbound_inspections_asset_id ON outbound_inspections("assetId");
CREATE INDEX IF NOT EXISTS idx_outbound_inspections_status ON outbound_inspections(status);
CREATE INDEX IF NOT EXISTS idx_outbound_inspections_delivery_id ON outbound_inspections("deliveryId");

-- 3-6. 입고 하자 상세 (inbound_defect_details)
CREATE TABLE inbound_defect_details (
    id                    TEXT PRIMARY KEY,
    "inboundNo"           TEXT NOT NULL,
    "assetId"             TEXT REFERENCES assets(id) ON DELETE SET NULL,
    "defectCategory"      TEXT NOT NULL,
    "defectDescription"   TEXT NOT NULL,
    "isCustomerFault"     BOOLEAN NOT NULL DEFAULT FALSE,
    "estimatedRepairCost" DOUBLE PRECISION DEFAULT 0,
    "photoUrls"           TEXT[],
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 3-7. 자산 입출고/정비 이력 (asset_in_out_logs)
CREATE TABLE asset_inout_logs (
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
    note                  TEXT,
    date                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 하위 호환성 뷰
CREATE OR REPLACE VIEW asset_in_out_logs AS SELECT * FROM asset_inout_logs;


-- ==============================================================================
-- 🔧 [도메인 4] 정비 및 현장 AS (Repairs & Field Services)
-- ==============================================================================

-- 4-0. 정비 점검 항목 마스터 (inspection_checklist_items)
CREATE TABLE inspection_checklist_items (
    id                    TEXT PRIMARY KEY,
    code                  TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    category              TEXT NOT NULL,
    score                 INTEGER NOT NULL DEFAULT 5,
    "standardManHours"    DOUBLE PRECISION DEFAULT 0.5,
    "recommendedConsumableIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actionGuide"         TEXT,
    description           TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT
);

CREATE INDEX IF NOT EXISTS idx_inspection_checklist_items_code ON inspection_checklist_items(code);
CREATE INDEX IF NOT EXISTS idx_inspection_checklist_items_category ON inspection_checklist_items(category);

-- 4-1. 정비 및 현장 AS 대장 (repairs) - 단일 물리 통합 마스터
CREATE TABLE repairs (
    -- ① 식별 및 분류
    id                    TEXT PRIMARY KEY,
    "ticketNo"            TEXT,
    "workCategory"        TEXT DEFAULT 'FIELD_AS', -- FIELD_AS, INSHOP_MAINTENANCE, PERIODIC_CHECK
    "workLocation"        TEXT DEFAULT 'SITE',
    "stockSource"         TEXT DEFAULT 'VEHICLE_VAN',
    source                TEXT DEFAULT 'DIRECT_INTAKE',
    "repairType"          TEXT NOT NULL DEFAULT 'INTERNAL',
    "maintenanceType"     TEXT,
    priority              TEXT DEFAULT 'NORMAL',

    -- ② 대상 자산 & 현장
    "assetId"             TEXT REFERENCES assets(id) ON DELETE SET NULL,
    "assetNo"             TEXT,
    "modelName"           TEXT,
    "contractId"          TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "targetContractStatus" TEXT,
    "targetAssetStatus"   TEXT,
    "customerId"          TEXT REFERENCES customers(id) ON DELETE SET NULL,
    "customerName"        TEXT,
    "siteId"              TEXT REFERENCES customer_sites(id) ON DELETE SET NULL,
    "siteName"            TEXT,
    "siteAddress"         TEXT,
    "locationDetail"      TEXT,

    -- ③ 접수자 & 고장 내용
    "reporterName"        TEXT,
    "reporterContact"     TEXT,
    "issueCategory"       TEXT,
    "inspectionItemCode"  TEXT,
    "inspectionItemId"    TEXT REFERENCES inspection_checklist_items(id) ON DELETE SET NULL,
    "degradationScore"    INTEGER NOT NULL DEFAULT 0,
    "issueDescription"    TEXT,
    details               TEXT,
    "errorCode"           TEXT,

    -- ④ 배정 정비사 & 외주 거래처
    "mechanicId"          TEXT REFERENCES users(id) ON DELETE SET NULL,
    "assignedMechanicId"  TEXT,
    "mechanicName"        TEXT,
    "vendorId"            TEXT REFERENCES vendors(id) ON DELETE SET NULL,
    "preferredNavApp"     TEXT DEFAULT 'TMAP',

    -- ⑤ 일정
    "requestDate"         TEXT NOT NULL,
    "scheduleDate"        TEXT,
    "visitDate"           TEXT,
    "repairDate"          TEXT,
    "completedDate"       TEXT,
    "outboundDate"        TEXT,

    -- ⑥ 조치 결과 & 부품
    status                TEXT NOT NULL DEFAULT 'REQUESTED',
    "resolutionType"      TEXT,
    "unresolvedReason"    TEXT,
    "nextAction"          TEXT,
    "actionTaken"         TEXT,
    "partsUsed"           JSONB DEFAULT '[]'::jsonb,
    "collectedParts"      JSONB DEFAULT '[]'::jsonb,
    consumables           JSONB DEFAULT '[]'::jsonb,
    "timelineLogs"        JSONB DEFAULT '[]'::jsonb,
    "timelineEvents"      JSONB DEFAULT '[]'::jsonb,
    "resolvedSiteAddress" TEXT,

    -- ⑦ 유상 청구 및 원가
    "billableType"        TEXT DEFAULT 'FREE',
    "billableAmount"      DOUBLE PRECISION DEFAULT 0,
    "billableToCustomer"  BOOLEAN NOT NULL DEFAULT FALSE,
    "totalCost"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costTotal"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billingAmount"       DOUBLE PRECISION,
    "laborHours"          DOUBLE PRECISION,
    "isCustomerFault"     BOOLEAN NOT NULL DEFAULT FALSE,
    "isWaived"            BOOLEAN NOT NULL DEFAULT FALSE,
    "waivedAmount"        DOUBLE PRECISION DEFAULT 0,
    "waivedBy"            TEXT,
    "waivedReason"        TEXT,
    "waivedAt"            TEXT,

    -- ⑧ 증빙 사진 및 서명
    "faultImageUrl"       TEXT,
    "evidenceImages"      TEXT[],
    "beforeImage"         TEXT,
    "afterImage"          TEXT,
    "estimateFileUrl"     TEXT,
    "customerSignature"   TEXT,
    "customerConfirmName" TEXT,

    -- ⑨ 재방문 및 대차 연계
    "parentRepairId"      TEXT,
    "parentTicketId"      TEXT,
    "revisitRepairId"     TEXT,
    "revisitTicketId"     TEXT,
    "revisitDate"         TEXT,
    "revisitReason"       TEXT,
    "exchangeSuggested"   BOOLEAN DEFAULT FALSE,
    "inboundNo"           TEXT,
    "defectsJson"         TEXT,
    "billingId"           TEXT,
    "purchaseBillId"      TEXT,

    -- ⑩ 비고 및 감사
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 4-2. AS 실시간 이벤트 타임라인 로그 (repair_timeline_events)
CREATE TABLE repair_timeline_events (
    id                    TEXT PRIMARY KEY,
    "repairId"            TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    "eventType"           TEXT NOT NULL, -- CALL_MADE, TRANSIT_START, ARRIVED, COMPLETED, REVISIT_SET
    "eventTitle"          TEXT NOT NULL,
    "eventDescription"    TEXT,
    "eventMeta"           JSONB,
    "actorId"             TEXT,
    "actorName"           TEXT,
    "occurredAt"          TEXT NOT NULL,
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 4-3. 수리 투입 자재 (repair_consumables)
CREATE TABLE repair_consumables (
    id                    TEXT PRIMARY KEY,
    "repairId"            TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    "consumableId"        TEXT NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
    quantity              DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost                  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 4-4. 소모품 수불 로그 (consumable_logs)
CREATE TABLE consumable_logs (
    id                    TEXT PRIMARY KEY,
    "consumableId"        TEXT NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
    type                  TEXT CHECK (type IN ('INBOUND', 'OUTBOUND', 'ADJUST', 'TRANSFER_TO_VEHICLE', 'RETURN_TO_HQ')) NOT NULL,
    quantity              DOUBLE PRECISION NOT NULL,
    "unitPrice"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    supplier              TEXT,
    "vendorId"            TEXT REFERENCES vendors(id) ON DELETE SET NULL,
    "userId"              TEXT REFERENCES users(id) ON DELETE SET NULL,
    "mechanicId"          TEXT REFERENCES users(id) ON DELETE SET NULL,
    "fromLocation"        TEXT,
    "toLocation"          TEXT,
    "targetAssetId"       TEXT REFERENCES assets(id) ON DELETE SET NULL,
    "evidenceFileUrl"     TEXT,
    description           TEXT,
    "actionDate"          TEXT NOT NULL,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 4-5. 검수 체크리스트 항목 (inspection_checklist_items)
CREATE TABLE inspection_checklist_items (
    id                    TEXT PRIMARY KEY,
    category              TEXT NOT NULL,
    code                  TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    score                 INTEGER NOT NULL DEFAULT 0,
    description           TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT
);

-- 4-8. 전사 표준 옵션 마스터 (standard_options)
CREATE TABLE IF NOT EXISTS standard_options (
    id                    TEXT PRIMARY KEY,
    category              TEXT NOT NULL CHECK (category IN ('PAID', 'PROTECTION', 'SPEC')),
    name                  TEXT NOT NULL,
    "defaultPrice"        DOUBLE PRECISION DEFAULT 0,
    unit                  TEXT DEFAULT '월',
    description           TEXT,
    "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
    "sortOrder"           INTEGER DEFAULT 0,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);


-- ==============================================================================
-- 💰 [도메인 5] 회계, 청구, 매입정산 및 금융 (Accounting, Billing & Finance)
-- ==============================================================================

-- 5-1. 매출 청구 마스터 (billings) - 고객 대상
CREATE TABLE billings (
    id                    TEXT PRIMARY KEY,
    "billingType"         TEXT CHECK ("billingType" IN ('RENTAL', 'REPAIR', 'TRANSPORT', 'ASSET_SALE')) NOT NULL DEFAULT 'RENTAL',
    "billingYm"           TEXT NOT NULL, -- YYYY-MM
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "contractId"          TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "invoiceId"           TEXT REFERENCES billing_invoices(id) ON DELETE SET NULL,
    "billingDate"         TEXT NOT NULL,
    "totalAmount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    status                TEXT CHECK (status IN ('UNPAID', 'PARTIAL', 'PAID', 'REQUESTED', 'REJECTED')) NOT NULL DEFAULT 'UNPAID',
    "rejectReason"        TEXT,
    details               JSONB,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-2. 매출 청구 상세 (billing_details)
CREATE TABLE billing_details (
    id                    TEXT PRIMARY KEY,
    "billingId"           TEXT NOT NULL REFERENCES billings(id) ON DELETE CASCADE,
    "contractAssetId"     TEXT REFERENCES contract_assets(id) ON DELETE SET NULL,
    "assetId"             TEXT REFERENCES assets(id) ON DELETE SET NULL,
    "receivableId"        TEXT, -- 외상미수금 연동
    "itemName"            TEXT NOT NULL,
    "displayName"         TEXT,
    "internalDescription" TEXT,
    quantity              DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    amount                DOUBLE PRECISION NOT NULL DEFAULT 0,
    description           TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-3. 통합 청구 인보이스 마스터 (billing_invoices)
CREATE TABLE billing_invoices (
    id                    TEXT PRIMARY KEY,
    "customId"            TEXT,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "billingYm"           TEXT NOT NULL, -- YYYY-MM
    "siteId"              TEXT REFERENCES customer_sites(id) ON DELETE SET NULL,
    "totalAmount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatAmount"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    status                TEXT CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'PARTIAL', 'CANCELLED')) NOT NULL DEFAULT 'DRAFT',
    "dueDate"             TEXT,
    "issuedAt"            TEXT,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-4. 외상미수금 대장 (receivables) - 타사 구상채권(VENDOR_CLAIM) 통합
CREATE TABLE receivables (
    id                    TEXT PRIMARY KEY,
    "contractId"          TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "customerId"          TEXT REFERENCES customers(id) ON DELETE SET NULL,
    "vendorName"          TEXT, -- 타사 구상처 원사명
    "assetNo"             TEXT, -- 구상 원인 대상 장비번호
    type                  TEXT CHECK (type IN ('TRANSPORT', 'REPAIR', 'CLEANING', 'OTHER', 'VENDOR_CLAIM')) NOT NULL,
    "occurredDate"        TEXT NOT NULL,
    "internalDescription" TEXT NOT NULL,
    "displayName"         TEXT,
    "totalAmount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billedAmount"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    status                TEXT CHECK (status IN ('PENDING', 'PARTIAL', 'CLEARED')) NOT NULL DEFAULT 'PENDING',
    "repairId"            TEXT REFERENCES repairs(id) ON DELETE SET NULL,
    CONSTRAINT chk_billed_lte_total CHECK ("billedAmount" <= "totalAmount"),
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-5. 매출 수납 테이블 (payments)
CREATE TABLE payments (
    id                    TEXT PRIMARY KEY,
    "billingId"           TEXT NOT NULL REFERENCES billings(id) ON DELETE CASCADE,
    "paymentDate"         TEXT NOT NULL,
    amount                DOUBLE PRECISION NOT NULL,
    method                TEXT NOT NULL,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-6. 은행 입출금 거래 내역 (bank_transactions)
CREATE TABLE bank_transactions (
    id                    TEXT PRIMARY KEY,
    "bankName"            TEXT,
    "accountNumber"       TEXT,
    "transactionDate"     TEXT NOT NULL,
    summary               TEXT,
    counterparty          TEXT,
    "senderName"          TEXT NOT NULL,
    "senderAccount"       TEXT,
    "depositAmount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "withdrawAmount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    balance               DOUBLE PRECISION,
    "branchName"          TEXT,
    "customerId"          TEXT REFERENCES customers(id) ON DELETE SET NULL,
    "matchedBillingId"    TEXT REFERENCES billings(id) ON DELETE SET NULL,
    "matchingType"        TEXT CHECK ("matchingType" IN ('AUTO', 'MANUAL')),
    "isDeposit"           BOOLEAN NOT NULL DEFAULT TRUE,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-7. 수납-통장입금 N:N 매핑 링크 (payment_deposit_links)
CREATE TABLE payment_deposit_links (
    id                    TEXT PRIMARY KEY,
    "paymentId"           TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    "bankTransactionId"   TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
    "usedAmount"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-8. 통장 대사 룰 매핑 (bank_matching_rules)
CREATE TABLE bank_matching_rules (
    id                    TEXT PRIMARY KEY,
    "senderName"          TEXT NOT NULL UNIQUE,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-9. 통장 기초 잔액 (bank_account_initial_balances)
CREATE TABLE bank_initial_balances (
    id                    TEXT PRIMARY KEY,
    "bankName"            TEXT NOT NULL,
    "accountNumber"       TEXT,
    "initialBalance"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "asOfDate"            TEXT,
    "createdAt"           TEXT,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 하위 호환성 뷰
CREATE OR REPLACE VIEW bank_account_initial_balances AS SELECT * FROM bank_initial_balances;

-- 5-10. 월말 매입 정산 마스터 (purchase_settlements)
CREATE TABLE purchase_settlements (
    id                    TEXT PRIMARY KEY,
    "settlementYm"        TEXT NOT NULL,
    "settlementType"      TEXT NOT NULL, -- TRANSPORT, EQUIPMENT_LEASE, REPAIR, CONSUMABLE
    "vendorId"            TEXT REFERENCES vendors(id) ON DELETE SET NULL,
    "vendorName"          TEXT NOT NULL,
    "totalAmount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    status                TEXT CHECK (status IN ('PENDING', 'APPROVED', 'CONFIRMED', 'PAID', 'REJECTED')) NOT NULL DEFAULT 'PENDING',
    "paymentDate"         TEXT,
    "paymentMethod"       TEXT,
    "bankAccount"         TEXT,
    "bankTransactionId"   TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL,
    "confirmedAt"         TEXT,
    "confirmedBy"         TEXT,
    "itemCount"           INTEGER NOT NULL DEFAULT 0,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-11. 월말 매입 정산 상세 (purchase_settlement_items)
CREATE TABLE purchase_settlement_items (
    id                    TEXT PRIMARY KEY,
    "settlementId"        TEXT NOT NULL REFERENCES purchase_settlements(id) ON DELETE CASCADE,
    "sourceType"          TEXT NOT NULL, -- DELIVERY, CONSUMABLE_PURCHASE, EQUIPMENT_LEASE, REPAIR
    "sourceId"            TEXT NOT NULL,
    "itemDescription"     TEXT NOT NULL,
    quantity              DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    amount                DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceFileUrl"     TEXT,
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-12. 정산 지급 분할 이력 레코드 (settlement_payment_logs)
CREATE TABLE settlement_payment_logs (
    id                    TEXT PRIMARY KEY,
    "settlementId"        TEXT NOT NULL REFERENCES purchase_settlements(id) ON DELETE CASCADE,
    "bankTransactionId"   TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL,
    "paidAmount"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentDate"         TEXT NOT NULL,
    "paymentMethod"       TEXT,
    "bankAccount"         TEXT,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-13. 자금 흐름 스냅샷 (cash_flow_snapshots)
CREATE TABLE cash_flow_snapshots (
    id                    TEXT PRIMARY KEY,
    "snapshotDate"        TEXT NOT NULL,
    "startingBalance"     BIGINT NOT NULL DEFAULT 0,
    "projectedInflow"     BIGINT NOT NULL DEFAULT 0,
    "projectedOpex"       BIGINT NOT NULL DEFAULT 0,
    "projectedCapex"      BIGINT NOT NULL DEFAULT 0,
    "projectedFinalBalance" BIGINT NOT NULL DEFAULT 0,
    notes                 TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-14. 선급금 원장 (prepaid_transactions)
CREATE TABLE prepaid_transactions (
    id                    TEXT PRIMARY KEY,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "transactionDate"     TEXT,
    type                  TEXT CHECK (type IN ('DEPOSIT', 'DEDUCTION', 'REFUND', 'CHARGE', 'USE_FOR_BILLING')) NOT NULL,
    amount                DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceAfter"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billingId"           TEXT REFERENCES billings(id) ON DELETE SET NULL,
    "paymentId"           TEXT REFERENCES payments(id) ON DELETE SET NULL,
    "bankTransactionId"   TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL,
    "relatedBillingId"    TEXT REFERENCES billings(id) ON DELETE SET NULL,
    description           TEXT,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-15. 연체 채권 독촉 이력 (delinquency_action_logs)
CREATE TABLE delinquency_action_logs (
    id                    TEXT PRIMARY KEY,
    "customerId"          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    "actionDate"          TEXT,
    "actionType"          TEXT CHECK ("actionType" IN ('CALL', 'SMS', 'VISIT', 'LEGAL_NOTICE', 'DEVICE_LOCK', 'NOTICE_SENT', 'LEGAL', 'DIRECTIVE')) NOT NULL,
    "actionDetails"       TEXT,
    "proofFileName"       TEXT,
    "recordedBy"          TEXT,
    "mandateType"         TEXT NOT NULL DEFAULT 'CEO_AUTO_MANDATE',
    "promiseDate"         TEXT,
    "promiseAmount"       DOUBLE PRECISION,
    "promiseStatus"       TEXT DEFAULT 'PENDING',
    "promiseContactPerson" TEXT,
    "directiveTargetUserId" TEXT,
    "directiveDueDate"    TEXT,
    "actorId"             TEXT REFERENCES users(id) ON DELETE SET NULL,
    "contactPerson"       TEXT,
    "contactPhone"        TEXT,
    content               TEXT,
    "promisedDate"        TEXT,
    "promisedAmount"      DOUBLE PRECISION,
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-16. 법적 최고/내용증명 발송 이력 (legal_notice_logs)
CREATE TABLE legal_notice_logs (
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
    "updatedAt"           TEXT,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 5-17. 내용증명 법적 서식 템플릿 (legal_notice_templates)
CREATE TABLE legal_notice_templates (
    id                    TEXT PRIMARY KEY,
    title                 TEXT NOT NULL,
    content               TEXT NOT NULL,
    "deadlineDays"        INTEGER NOT NULL DEFAULT 14,
    "isDefault"           BOOLEAN DEFAULT FALSE,
    "createdAt"           TEXT,
    "updatedAt"           TEXT NOT NULL
);

-- 5-16. 월별 감가상각 마감 이력 (depreciation_logs)
CREATE TABLE depreciation_logs (
    id                    TEXT PRIMARY KEY,
    "depreciationYm"      TEXT NOT NULL UNIQUE,
    "executedAt"          TEXT NOT NULL,
    "executedBy"          TEXT,
    "targetAssetCount"    INTEGER NOT NULL DEFAULT 0,
    "totalDepreciationAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    note                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);


-- ==============================================================================
-- 🤝 [도메인 6] 협업, ToDo, 문서작업 및 시스템 (System & Collaboration)
-- ==============================================================================

-- 6-1. 사용자 맞춤형 ToDo 피드 (todos)
CREATE TABLE todos (
    id                    TEXT PRIMARY KEY,
    "userId"              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "assignedUserId"      TEXT REFERENCES users(id) ON DELETE SET NULL,
    "targetDept"          TEXT,
    "targetRole"          TEXT,
    "taskCategory"        TEXT NOT NULL DEFAULT 'GENERAL',
    type                  TEXT NOT NULL DEFAULT 'GENERAL',
    title                 TEXT NOT NULL,
    content               TEXT NOT NULL,
    priority              TEXT NOT NULL DEFAULT 'NORMAL',
    "dueDate"             TEXT,
    "actionUrl"           TEXT NOT NULL DEFAULT '/',
    "entityType"          TEXT,
    "entityId"            TEXT,
    "targetType"          TEXT,
    "isCompleted"         BOOLEAN NOT NULL DEFAULT FALSE,
    "relatedEntityId"     TEXT,
    "senderId"            TEXT REFERENCES users(id) ON DELETE SET NULL,
    "senderName"          TEXT,
    "resolutionNote"      TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "completedAt"         TEXT,
    "completedByUserId"   TEXT REFERENCES users(id) ON DELETE SET NULL,
    "completedByName"     TEXT,
    "completionAction"    TEXT,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 6-2. 사내 공지사항 (announcements & reads)
CREATE TABLE announcements (
    id                    TEXT PRIMARY KEY,
    "authorId"            TEXT REFERENCES users(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    content               TEXT NOT NULL,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE TABLE announcement_reads (
    id                    TEXT PRIMARY KEY,
    "announcementId"      TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    "userId"              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "readAt"              TEXT NOT NULL,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    UNIQUE("announcementId", "userId"),
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 6-3. 작업 지시 (work_instructions)
CREATE TABLE work_instructions (
    id                    TEXT PRIMARY KEY,
    "managerId"           TEXT REFERENCES users(id) ON DELETE SET NULL,
    "assigneeId"          TEXT REFERENCES users(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    content               TEXT,
    "reportType"          TEXT CHECK ("reportType" IN ('FILE', 'TEXT', 'VERBAL')) NOT NULL,
    status                TEXT CHECK (status IN ('PENDING', 'REPORTED', 'APPROVED', 'NEEDS_WORK')) NOT NULL DEFAULT 'PENDING',
    "reportContent"       TEXT,
    "reportFileUrl"       TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 6-4. 협업 요청 (collaboration_requests & history)
CREATE TABLE collaboration_requests (
    id                    TEXT PRIMARY KEY,
    "requesterId"         TEXT REFERENCES users(id) ON DELETE SET NULL,
    "targetUserId"        TEXT REFERENCES users(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    content               TEXT,
    status                TEXT CHECK (status IN ('REQUESTED', 'NEGOTIATING', 'AGREED', 'REJECTED', 'ESCALATED')) NOT NULL DEFAULT 'REQUESTED',
    "negotiationCount"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE TABLE collaboration_request_history (
    id                    TEXT PRIMARY KEY,
    "requestId"           TEXT NOT NULL REFERENCES collaboration_requests(id) ON DELETE CASCADE,
    "writerId"            TEXT REFERENCES users(id) ON DELETE SET NULL,
    content               TEXT NOT NULL,
    action                TEXT CHECK (action IN ('NEGOTIATE', 'AGREE', 'REJECT', 'ESCALATE')) NOT NULL,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 6-5. 로컬 에이전트 레지스트리 (agent_registry)
CREATE TABLE agent_registry (
    callsign              TEXT PRIMARY KEY,
    "userId"              TEXT REFERENCES users(id) ON DELETE SET NULL,
    "machineName"         TEXT,
    "isMaster"            BOOLEAN DEFAULT FALSE,
    status                TEXT CHECK (status IN ('ONLINE', 'BUSY', 'OFFLINE')) NOT NULL DEFAULT 'ONLINE',
    "lastHeartbeat"       TIMESTAMPTZ NOT NULL,
    "createdAt"           TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt"           TIMESTAMPTZ DEFAULT NOW()
);

-- 6-6. 문서 생산 백그라운드 작업 큐 (document_jobs)
CREATE TABLE document_jobs (
    id                    TEXT PRIMARY KEY,
    "jobType"             TEXT NOT NULL,
    "contractId"          TEXT REFERENCES contracts(id) ON DELETE SET NULL,
    "targetCallsign"      TEXT,
    "assignedCallsign"    TEXT REFERENCES agent_registry(callsign) ON DELETE SET NULL,
    status                TEXT CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')) NOT NULL DEFAULT 'PENDING',
    payload               JSONB NOT NULL,
    "resultUrl"           TEXT,
    "localFilePath"       TEXT,
    "errorMessage"        TEXT,
    "createdAt"           TIMESTAMPTZ DEFAULT NOW(),
    "lockedAt"            TIMESTAMPTZ,
    "completedAt"         TIMESTAMPTZ,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 6-7. 클라우드 및 구글 연동 설정 (google_configs)
CREATE TABLE google_configs (
    id                    TEXT PRIMARY KEY,
    "googleEmail"         TEXT NOT NULL,
    "googlePassword"      TEXT,
    "gmailAppPassword"    TEXT,
    "contractFolder"      TEXT NOT NULL,
    "consumableFolder"    TEXT NOT NULL,
    "deliveryFolder"      TEXT NOT NULL,
    "maintenanceFolder"   TEXT NOT NULL,
    "isDevMode"           BOOLEAN NOT NULL DEFAULT TRUE,
    "quotationTemplateUrl" TEXT,
    "contractTemplateUrl" TEXT,
    "safetyInspectionTemplateUrl" TEXT,
    "preDeliveryChecklistTemplateUrl" TEXT,
    "bizRegCertUrl"       TEXT,
    "bankbookCopyUrl"     TEXT,
    "transactionStatementTemplateUrl" TEXT,
    "defaultRootFolderId" TEXT,
    "currentInsuranceStartDate" TEXT,
    "currentInsuranceEndDate"   TEXT,
    "nextInsuranceCertUrl"     TEXT,
    "nextInsuranceStartDate"   TEXT,
    "nextInsuranceEndDate"     TEXT,
    "mirrorRecursive"          BOOLEAN NOT NULL DEFAULT TRUE,
    "r2AccountId"              TEXT,
    "r2BucketName"        TEXT,
    "r2AccessKeyId"       TEXT,
    "r2SecretAccessKey"   TEXT,
    "r2PublicDomain"      TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL
);


-- ==============================================================================
-- 7. 법인 차량 및 차량운행일지/주유기록 관리 (corporate_vehicles, vehicle_operation_logs, vehicle_fuel_logs)
-- ==============================================================================

-- 7-1. 법인 차량 마스터 (corporate_vehicles)
CREATE TABLE corporate_vehicles (
    id                    TEXT PRIMARY KEY,
    "vehicleNo"           TEXT NOT NULL UNIQUE,
    "modelName"           TEXT NOT NULL,
    "vehicleType"         TEXT DEFAULT '승합차', -- 승용차, 화물/탑차, 승합차, 전기차
    "ownershipType"       TEXT CHECK ("ownershipType" IN ('OWNED', 'LEASE', 'RENTAL')) DEFAULT 'OWNED',
    "fuelType"            TEXT CHECK ("fuelType" IN ('DIESEL', 'GASOLINE', 'LPG', 'HYBRID', 'ELECTRIC')) DEFAULT 'DIESEL',
    "assignedDepartment"  TEXT DEFAULT '관리부',
    "primaryDriverId"     TEXT REFERENCES users(id) ON DELETE SET NULL,
    "primaryDriverName"   TEXT,
    "initialMileage"      INTEGER NOT NULL DEFAULT 0,
    "currentMileage"      INTEGER NOT NULL DEFAULT 0,
    "insuranceExpiryDate" TEXT,
    "inspectionExpiryDate" TEXT,
    "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 7-2. 차량운행일지 (vehicle_operation_logs - 국세청 업무용승용차 운행기록부 법정서식 연동)
CREATE TABLE vehicle_operation_logs (
    id                    TEXT PRIMARY KEY,
    "vehicleId"           TEXT NOT NULL REFERENCES corporate_vehicles(id) ON DELETE CASCADE,
    "vehicleNo"           TEXT NOT NULL,
    "driverId"            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    "driverName"          TEXT NOT NULL,
    "driverDept"          TEXT,
    "operationDate"       TEXT NOT NULL, -- YYYY-MM-DD
    "purposeType"         TEXT CHECK ("purposeType" IN ('COMMUTE', 'BUSINESS_GENERAL', 'CLIENT_MEETING', 'SITE_AS', 'LOGISTICS_DELIVERY', 'OTHER')) NOT NULL DEFAULT 'BUSINESS_GENERAL',
    "purposeDetail"       TEXT,
    "departureLocation"   TEXT NOT NULL,
    "arrivalLocation"     TEXT NOT NULL,
    "departureMileage"    INTEGER NOT NULL,
    "arrivalMileage"      INTEGER NOT NULL,
    "driveDistance"       INTEGER NOT NULL, -- arrivalMileage - departureMileage
    "businessDistance"    INTEGER NOT NULL, -- 업무용 사용거리
    "commuteDistance"     INTEGER NOT NULL DEFAULT 0, -- 출퇴근거리
    "dashboardPhotoStart" TEXT, -- 출발 시 계기판 사진 URL / Base64
    "dashboardPhotoEnd"   TEXT, -- 도착 시 계기판 사진 URL / Base64
    memo                  TEXT,
    status                TEXT CHECK (status IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')) NOT NULL DEFAULT 'SUBMITTED',
    "confirmedBy"         TEXT,
    "confirmedAt"         TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

-- 7-3. 차량 주유 및 충전 영수증 기록부 (vehicle_fuel_logs)
CREATE TABLE vehicle_fuel_logs (
    id                    TEXT PRIMARY KEY,
    "vehicleId"           TEXT NOT NULL REFERENCES corporate_vehicles(id) ON DELETE CASCADE,
    "vehicleNo"           TEXT NOT NULL,
    "driverId"            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    "driverName"          TEXT NOT NULL,
    "fuelDate"            TEXT NOT NULL, -- YYYY-MM-DD HH:mm
    "fuelType"            TEXT NOT NULL, -- DIESEL, GASOLINE, LPG, ELECTRIC
    "fuelVolume"          DOUBLE PRECISION NOT NULL, -- 주유량 (리터 L)
    "fuelAmount"          DOUBLE PRECISION NOT NULL, -- 주유금액 (원 ₩)
    "fuelUnitPrice"       DOUBLE PRECISION, -- 리터당 단가
    "currentMileage"      INTEGER NOT NULL, -- 주유 시점 계기판 주행거리 (km)
    "dashboardPhotoUrl"   TEXT, -- 주유 시 계기판 사진
    "receiptPhotoUrl"     TEXT NOT NULL, -- 주유 영수증 사진
    "gasStationName"      TEXT, -- 주유소 상호
    "paymentMethod"       TEXT DEFAULT 'CORPORATE_CARD', -- CORPORATE_CARD, PERSONAL_EXPENSE
    "cardLast4"           TEXT,
    "fuelEfficiency"      DOUBLE PRECISION, -- 직전 대비 계산된 연비 (km/L)
    memo                  TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE INDEX IF NOT EXISTS idx_vlog_vehicle_date ON vehicle_operation_logs("vehicleId", "operationDate");
CREATE INDEX IF NOT EXISTS idx_vlog_driver ON vehicle_operation_logs("driverId");
CREATE INDEX IF NOT EXISTS idx_vfuel_vehicle_date ON vehicle_fuel_logs("vehicleId", "fuelDate");
CREATE INDEX IF NOT EXISTS idx_vfuel_driver ON vehicle_fuel_logs("driverId");

-- 4-8. 장비 기술 매뉴얼 라이브러리 (equipment_manuals)
CREATE TABLE IF NOT EXISTS equipment_manuals (
    id                    TEXT PRIMARY KEY,
    "modelName"           TEXT NOT NULL,
    manufacturer          TEXT NOT NULL,
    "targetSpecFt"        INTEGER,
    category              TEXT NOT NULL CHECK (category IN ('PARTS_BOOK', 'ERROR_CODE', 'WIRING_DIAGRAM', 'OPERATOR_MANUAL')),
    title                 TEXT NOT NULL,
    "fileUrl"             TEXT NOT NULL,
    "fileName"            TEXT NOT NULL,
    "fileSize"            BIGINT NOT NULL DEFAULT 0,
    "fileSizeLabel"       TEXT,
    version               TEXT DEFAULT 'Rev. 1.0',
    "uploadDate"          TEXT NOT NULL DEFAULT CURRENT_DATE::TEXT,
    "uploadedBy"          TEXT NOT NULL,
    memo                  TEXT,
    "inspectionItemCodes" JSONB DEFAULT '[]'::jsonb,
    media_type            TEXT DEFAULT 'PDF' CHECK (media_type IN ('PDF', 'YOUTUBE', 'WEB_LINK')),
    "externalUrl"         TEXT,
    "youtubeVideoId"      TEXT,
    "durationMinutes"     INTEGER,
    "aiProcessed"         BOOLEAN DEFAULT FALSE,
    "aiProcessedAt"       TEXT,
    keywords              JSONB DEFAULT '[]'::jsonb,
    "errorCodes"          JSONB DEFAULT '[]'::jsonb,
    "majorParts"          JSONB DEFAULT '[]'::jsonb,
    symptoms              JSONB DEFAULT '[]'::jsonb,
    "aiSummary"           TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE INDEX IF NOT EXISTS idx_manuals_model ON equipment_manuals("modelName");
CREATE INDEX IF NOT EXISTS idx_manuals_category ON equipment_manuals(category);
CREATE INDEX IF NOT EXISTS idx_manuals_keywords ON equipment_manuals USING gin (keywords);

-- ==============================================================================
-- 7. 분산 인쇄 큐 시스템 (print_stations & print_queue)
-- ==============================================================================
-- 7-1. 분산 인쇄 스테이션 (print_stations)
CREATE TABLE IF NOT EXISTS print_stations (
    id                    TEXT PRIMARY KEY,
    "stationName"         TEXT NOT NULL,
    "machineName"         TEXT,
    "localPrinterName"    TEXT NOT NULL,
    "docTypeDefault"      TEXT CHECK ("docTypeDefault" IN ('DISPATCH_ORDER', 'RETURN_ORDER', 'ALL')) DEFAULT 'ALL',
    description           TEXT,
    status                TEXT CHECK (status IN ('ONLINE', 'OFFLINE')) NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeat"       TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE INDEX IF NOT EXISTS idx_print_stations_status ON print_stations(status);

-- 7-2. 분산 문서 출력 대기열 및 실행 감사 이력 (print_queue)
CREATE TABLE IF NOT EXISTS print_queue (
    id                    TEXT PRIMARY KEY,
    "stationId"           TEXT NOT NULL REFERENCES print_stations(id) ON DELETE CASCADE,
    "stationName"         TEXT NOT NULL,
    "docType"             TEXT CHECK ("docType" IN ('DISPATCH_ORDER', 'RETURN_ORDER')) NOT NULL,
    "docNo"               TEXT,
    title                 TEXT NOT NULL,
    "documentHtml"        TEXT NOT NULL,
    status                TEXT CHECK (status IN ('PENDING', 'PRINTING', 'COMPLETED', 'FAILED', 'CANCELED')) NOT NULL DEFAULT 'PENDING',
    "errorMessage"        TEXT,
    "requestedById"       TEXT REFERENCES users(id) ON DELETE SET NULL,
    "requestedByName"     TEXT,
    "requestedAt"         TEXT NOT NULL,
    "printedAt"           TEXT,
    "retryCount"          INTEGER NOT NULL DEFAULT 0,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE INDEX IF NOT EXISTS idx_print_queue_station_status ON print_queue("stationId", status);
CREATE INDEX IF NOT EXISTS idx_print_queue_requested_at ON print_queue("requestedAt");

-- ==============================================================================
-- 🛡️ [도메인 7] 개인정보 보호 및 접속 감사 기록 (Privacy & Audit Logs)
-- 대한민국 개인정보 보호법 제29조 및 개인정보의 안전성 확보조치 기준 제8조 준수
-- ==============================================================================
CREATE TABLE IF NOT EXISTS privacy_access_logs (
    id                    TEXT PRIMARY KEY,
    "userId"              TEXT NOT NULL,
    "userName"            TEXT NOT NULL,
    "ipAddress"           TEXT,
    "actionType"          TEXT NOT NULL, -- LOGIN, LOGOUT, VIEW, CREATE, UPDATE, DELETE, EXCEL_DOWNLOAD, UNMASK_VIEW
    "targetMenu"          TEXT NOT NULL,
    "targetSubjectId"     TEXT,
    "targetSubjectName"   TEXT,
    "actionDetail"        TEXT,
    "isMasked"            BOOLEAN DEFAULT TRUE,
    "createdAt"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL DEFAULT 'giyeun'
);

CREATE INDEX IF NOT EXISTS idx_privacy_access_logs_created ON privacy_access_logs("createdAt");
CREATE INDEX IF NOT EXISTS idx_privacy_access_logs_user ON privacy_access_logs("userId");
CREATE INDEX IF NOT EXISTS idx_privacy_access_logs_action ON privacy_access_logs("actionType");

-- ==============================================================================
-- 🔒 전 테이블 Row Level Security (RLS) 및 권한 일괄 활성화
-- ==============================================================================
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "allow_anon_all" ON %I;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "allow_auth_all" ON %I;', tbl);
        EXECUTE format('CREATE POLICY "allow_anon_all" ON %I FOR ALL TO anon USING (true) WITH CHECK (true);', tbl);
        EXECUTE format('CREATE POLICY "allow_auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true);', tbl);
    END LOOP;
END $$;

-- 🌟 정비점검항목 마스터 테이블은 삭제/수정 무음 실패 방지를 위해 RLS 완전 비활성화 및 전 권한 부여
ALTER TABLE inspection_checklist_items DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE inspection_checklist_items TO anon, authenticated, service_role;

