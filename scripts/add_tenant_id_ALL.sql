-- ============================================================
-- add_tenant_id_ALL.sql
-- 멀티테넌트 전환 준비: 모든 비즈니스 테이블에 tenant_id 컬럼 추가
-- 실행 방법: Supabase Dashboard -> SQL Editor -> 전체 복사 후 Run
-- 멱등성 보장: ADD COLUMN IF NOT EXISTS 사용 (중복 실행 안전)
-- 기본값: 'giyeun' (기연리프트 단일 테넌트 운영 중)
-- ============================================================

-- 도메인 1: 조직/HR
ALTER TABLE "departments"               ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "users"                     ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "permissions"               ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "annual_leave_quotas"       ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "leave_usages"              ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "overtime_records"          ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "payroll_closings"          ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 도메인 2: 기준정보
ALTER TABLE "vendors"                   ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "customers"                 ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "customer_contacts"         ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "customer_sites"            ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "customer_bank_accounts"    ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "products"                  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "assets"                    ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "consumables"               ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "consumable_purchases"      ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "mechanic_consumable_stocks" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "transport_companies"       ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "transport_drivers"         ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 도메인 3: 계약/운영
ALTER TABLE "contracts"                 ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "contract_assets"           ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "external_leases"           ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "contract_history"          ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "deliveries"                ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "outbound_inspections"      ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "inbound_defect_details"    ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "asset_inout_logs"          ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 도메인 4: 정비
ALTER TABLE "repairs"                   ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "repair_timeline_events"    ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "repair_consumables"        ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "consumable_logs"           ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "standard_options"          ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 도메인 5: 회계/청구/금융
ALTER TABLE "billings"                  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "billing_details"           ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "billing_invoices"          ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "receivables"               ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "payments"                  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "bank_transactions"         ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "payment_deposit_links"     ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "bank_matching_rules"       ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "bank_initial_balances"     ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "purchase_settlements"      ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "purchase_settlement_items" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "settlement_payment_logs"   ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "cash_flow_snapshots"       ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "prepaid_transactions"      ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "delinquency_action_logs"   ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "legal_notice_logs"         ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "depreciation_logs"         ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 도메인 6: 협업/시스템
ALTER TABLE "todos"                          ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "announcements"                  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "announcement_reads"             ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "work_instructions"              ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "collaboration_requests"         ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "collaboration_request_history"  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "document_jobs"                  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 도메인 7: 법인차량
ALTER TABLE "corporate_vehicles"       ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "vehicle_operation_logs"   ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "vehicle_fuel_logs"        ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 장비 매뉴얼 / 인쇄 큐
ALTER TABLE "equipment_manuals"        ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "print_stations"           ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
ALTER TABLE "print_queue"              ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';

-- 완료 확인 쿼리 (62행이 나오면 성공)
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'tenant_id'
ORDER BY table_name;
