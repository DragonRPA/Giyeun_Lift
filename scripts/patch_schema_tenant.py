import re

with open('d:/01.AntiGravity/Giyuen_Lift/schema.sql', 'r', encoding='utf-8') as f:
    content = f.read()

TARGET_TABLES = [
    'departments','users','permissions','annual_leave_quotas','leave_usages','overtime_records','payroll_closings',
    'vendors','customers','customer_contacts','customer_sites','customer_bank_accounts','products','assets',
    'consumables','consumable_purchases','mechanic_consumable_stocks','transport_companies','transport_drivers',
    'contracts','contract_assets','external_leases','contract_history','deliveries','outbound_inspections',
    'inbound_defect_details','asset_inout_logs',
    'repairs','repair_timeline_events','repair_consumables','consumable_logs','standard_options',
    'billings','billing_details','billing_invoices','receivables','payments','bank_transactions',
    'payment_deposit_links','bank_matching_rules','bank_initial_balances','purchase_settlements',
    'purchase_settlement_items','settlement_payment_logs','cash_flow_snapshots','prepaid_transactions',
    'delinquency_action_logs','legal_notice_logs','depreciation_logs',
    'todos','announcements','announcement_reads','work_instructions','collaboration_requests',
    'collaboration_request_history','document_jobs',
    'corporate_vehicles','vehicle_operation_logs','vehicle_fuel_logs',
    'equipment_manuals','print_stations','print_queue',
]

modified = 0
skipped = 0
not_found = []

for table in TARGET_TABLES:
    # 이미 tenant_id 있는지 확인 (CREATE TABLE 블록 내에서)
    # CREATE TABLE table ( ... ); 패턴으로 블록 찾기
    pattern = r'(CREATE TABLE ' + re.escape(table) + r'\s*\()(.*?)(\);)'
    match = re.search(pattern, content, re.DOTALL)
    
    if not match:
        not_found.append(table)
        print(f'  [MISS] {table}')
        continue
    
    body = match.group(2)
    if 'tenant_id' in body:
        print(f'  [SKIP] {table}: 이미 tenant_id 존재')
        skipped += 1
        continue
    
    def replacer(m):
        pre = m.group(1)
        body = m.group(2)
        close = m.group(3)
        lines = body.rstrip('\n').split('\n')
        # 마지막 실제 내용 줄 찾기
        last_idx = len(lines) - 1
        while last_idx >= 0 and not lines[last_idx].strip():
            last_idx -= 1
        if last_idx >= 0:
            ll = lines[last_idx].rstrip()
            if not ll.endswith(','):
                lines[last_idx] = ll + ','
        lines.append("    \"tenant_id\"           TEXT NOT NULL DEFAULT 'giyeun'")
        return pre + '\n'.join(lines) + '\n' + close
    
    new_content, count = re.subn(pattern, replacer, content, flags=re.DOTALL, count=1)
    if count > 0:
        content = new_content
        modified += 1
        print(f'  [OK] {table}')
    else:
        not_found.append(table)
        print(f'  [FAIL] {table}')

print(f'\n=== 결과: 수정 {modified}개 / 스킵 {skipped}개 / 미발견 {len(not_found)}개 ===')
if not_found:
    print('미발견:', not_found)

with open('d:/01.AntiGravity/Giyuen_Lift/schema.sql', 'w', encoding='utf-8') as f:
    f.write(content)
print('schema.sql 저장 완료')
