/**
 * add_tenant_id_columns.cjs
 * 모든 비즈니스 테이블에 tenant_id TEXT NOT NULL DEFAULT 'giyeun' 컬럼 추가
 * (멀티테넌트 전환 준비 — 기능 변화 없음)
 */
const fs = require('fs');
const path = require('path');
const envPath = path.resolve('D:/01.AntiGravity/Giyuen_Lift/.env');
const dotenv = fs.readFileSync(envPath, 'utf-8');
let SUPA_URL = '', SUPA_KEY = '';
dotenv.split('\n').forEach(line => {
  if (line.startsWith('VITE_SUPABASE_URL=')) SUPA_URL = line.split('=')[1].trim();
  if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) SUPA_KEY = line.split('=')[1].trim();
});
const { createClient } = require('d:/01.AntiGravity/Giyuen_Lift/node_modules/@supabase/supabase-js');
const supabase = createClient(SUPA_URL, SUPA_KEY);

// 멀티테넌트 ID를 적용할 테이블 목록 (시스템/공통 마스터 제외)
const TABLES = [
  // 도메인 1: 조직/HR
  'departments',
  'users',
  'permissions',
  'annual_leave_quotas',
  'leave_usages',
  'overtime_records',
  'payroll_closings',

  // 도메인 2: 기준정보
  'vendors',
  'customers',
  'customer_contacts',
  'customer_sites',
  'customer_bank_accounts',
  'products',
  'assets',
  'consumables',
  'consumable_purchases',
  'mechanic_consumable_stocks',
  'transport_companies',
  'transport_drivers',

  // 도메인 3: 계약/운영
  'contracts',
  'contract_assets',
  'external_leases',
  'contract_history',
  'deliveries',
  'outbound_inspections',
  'inbound_defect_details',
  'asset_inout_logs',

  // 도메인 4: 정비
  'repairs',
  'repair_timeline_events',
  'repair_consumables',
  'consumable_logs',
  'standard_options',

  // 도메인 5: 회계/청구/금융
  'billings',
  'billing_details',
  'billing_invoices',
  'receivables',
  'payments',
  'bank_transactions',
  'payment_deposit_links',
  'bank_matching_rules',
  'bank_initial_balances',
  'purchase_settlements',
  'purchase_settlement_items',
  'settlement_payment_logs',
  'cash_flow_snapshots',
  'prepaid_transactions',
  'delinquency_action_logs',
  'legal_notice_logs',
  'depreciation_logs',

  // 도메인 6: 협업/시스템
  'todos',
  'announcements',
  'announcement_reads',
  'work_instructions',
  'collaboration_requests',
  'collaboration_request_history',
  'document_jobs',

  // 도메인 7: 법인차량
  'corporate_vehicles',
  'vehicle_operation_logs',
  'vehicle_fuel_logs',

  // 장비 매뉴얼 / 인쇄 큐
  'equipment_manuals',
  'print_stations',
  'print_queue',
];

async function addTenantIdColumns() {
  console.log(`\n🚀 tenant_id 컬럼 추가 시작 (${TABLES.length}개 테이블)\n`);
  const results = { success: [], skipped: [], failed: [] };

  for (const table of TABLES) {
    // 1) 컬럼 존재 여부 확인
    const checkSql = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = '${table}' 
        AND column_name = 'tenant_id'
    `;
    const { data: existing, error: checkErr } = await supabase.rpc('dev_exec_ddl', { sql: checkSql }).single();
    
    // dev_exec_ddl 는 DDL 전용이므로 SELECT는 직접 확인
    // 대신: ALTER TABLE IF NOT EXISTS 방식으로 멱등성 확보
    const sql = `
      ALTER TABLE "${table}" 
      ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'giyeun';
    `;

    const { error } = await supabase.rpc('dev_exec_ddl', { sql });

    if (error) {
      // 컬럼이 이미 존재하면 무시
      if (error.message && (
        error.message.includes('already exists') ||
        error.message.includes('duplicate column')
      )) {
        console.log(`  ⏭️  ${table}: 이미 존재 (스킵)`);
        results.skipped.push(table);
      } else {
        console.error(`  ❌ ${table}: ${error.message}`);
        results.failed.push({ table, error: error.message });
      }
    } else {
      console.log(`  ✅ ${table}: tenant_id 추가 완료`);
      results.success.push(table);
    }
  }

  console.log('\n=== 결과 요약 ===');
  console.log(`✅ 성공: ${results.success.length}개`);
  console.log(`⏭️  스킵: ${results.skipped.length}개`);
  console.log(`❌ 실패: ${results.failed.length}개`);
  
  if (results.failed.length > 0) {
    console.log('\n실패 목록:');
    results.failed.forEach(({ table, error }) => console.log(`  - ${table}: ${error}`));
  }

  return results;
}

addTenantIdColumns().catch(console.error);
