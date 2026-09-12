import re

with open('d:/01.AntiGravity/Giyuen_Lift/schema.sql', 'r', encoding='utf-8') as f:
    content = f.read()

REMAINING_TABLES = ['standard_options', 'equipment_manuals', 'print_stations', 'print_queue']

modified = 0
for table in REMAINING_TABLES:
    # IF NOT EXISTS 패턴도 처리
    pattern = r'(CREATE TABLE IF NOT EXISTS ' + re.escape(table) + r'\s*\()(.*?)(\);)'
    match = re.search(pattern, content, re.DOTALL)
    
    if not match:
        print(f'  [MISS] {table}')
        continue
    
    body = match.group(2)
    if 'tenant_id' in body:
        print(f'  [SKIP] {table}: 이미 존재')
        continue
    
    def replacer(m):
        pre = m.group(1)
        body = m.group(2)
        close = m.group(3)
        lines = body.rstrip('\n').split('\n')
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

print(f'\n추가 수정: {modified}개')
with open('d:/01.AntiGravity/Giyuen_Lift/schema.sql', 'w', encoding='utf-8') as f:
    f.write(content)
print('schema.sql 최종 저장 완료')
