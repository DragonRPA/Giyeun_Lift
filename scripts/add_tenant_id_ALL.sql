-- ============================================================
-- add_tenant_id_ALL.sql  (v2 - 테이블 미존재 자동 스킵)
-- 멀티테넌트 전환 준비: 모든 비즈니스 테이블에 tenant_id 컬럼 추가
-- 실행 방법: Supabase Dashboard -> SQL Editor -> 전체 복사 후 Run
-- 멱등성 보장: 이미 tenant_id 있거나 테이블 없으면 자동 스킵
-- ============================================================

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    -- 도메인 1: 조직/HR
    'departments','users','permissions','annual_leave_quotas',
    'leave_usages','overtime_records','payroll_closings',
    -- 도메인 2: 기준정보
    'vendors','customers','customer_contacts','customer_sites',
    'customer_bank_accounts','products','assets','consumables',
    'consumable_purchases','mechanic_consumable_stocks',
    'transport_companies','transport_drivers',
    -- 도메인 3: 계약/운영
    'contracts','contract_assets','external_leases','contract_history',
    'deliveries','outbound_inspections','inbound_defect_details','asset_inout_logs',
    -- 도메인 4: 정비
    'repairs','repair_timeline_events','repair_consumables',
    'consumable_logs','standard_options',
    -- 도메인 5: 회계/청구/금융
    'billings','billing_details','billing_invoices','receivables','payments',
    'bank_transactions','payment_deposit_links','bank_matching_rules',
    'bank_initial_balances','purchase_settlements','purchase_settlement_items',
    'settlement_payment_logs','cash_flow_snapshots','prepaid_transactions',
    'delinquency_action_logs','legal_notice_logs','depreciation_logs',
    -- 도메인 6: 협업/시스템
    'todos','announcements','announcement_reads','work_instructions',
    'collaboration_requests','collaboration_request_history','document_jobs',
    -- 도메인 7: 법인차량
    'corporate_vehicles','vehicle_operation_logs','vehicle_fuel_logs',
    -- 기타
    'equipment_manuals','print_stations','print_queue'
  ];
  t TEXT;
  col_exists BOOLEAN;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      -- 테이블 존재 여부 확인
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = t
      ) THEN
        RAISE NOTICE '[SKIP - 테이블 없음] %', t;
        CONTINUE;
      END IF;

      -- 컬럼 이미 존재하는지 확인
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
      ) INTO col_exists;

      IF col_exists THEN
        RAISE NOTICE '[SKIP - 이미 존재] %', t;
      ELSE
        EXECUTE format('ALTER TABLE %I ADD COLUMN "tenant_id" TEXT NOT NULL DEFAULT ''giyeun''', t);
        RAISE NOTICE '[OK] % - tenant_id 추가 완료', t;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[ERROR] % - %', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- 완료 확인 (추가된 테이블 수 확인)
SELECT table_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'tenant_id'
ORDER BY table_name;
