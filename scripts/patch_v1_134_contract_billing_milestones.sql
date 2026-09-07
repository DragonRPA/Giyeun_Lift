-- ====================================================================
-- Giyeun Lift ERP - DB Schema Patch v1.134.0 (v0.5.3.Build.36)
-- 계약 테이블(contracts) 직전 청구 마일스톤 메타데이터 컬럼 추가
-- ====================================================================

-- 1. contracts 테이블에 신규 마일스톤 컬럼 추가 (멱등성 보장)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBillingDate" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBilledPeriodStart" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBilledPeriodEnd" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "lastBilledYm" TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "billingCount" INTEGER NOT NULL DEFAULT 0;

-- 2. 컬럼 코멘트 추가
COMMENT ON COLUMN contracts."lastBillingDate" IS '최근 렌탈료 청구 발행일 (YYYY-MM-DD)';
COMMENT ON COLUMN contracts."lastBilledPeriodStart" IS '최근 청구 시작일 (YYYY-MM-DD)';
COMMENT ON COLUMN contracts."lastBilledPeriodEnd" IS '최근 청구 종료일 (YYYY-MM-DD)';
COMMENT ON COLUMN contracts."lastBilledYm" IS '최근 청구 귀속월 (YYYY-MM)';
COMMENT ON COLUMN contracts."billingCount" IS '누적 발행 청구 건수';
