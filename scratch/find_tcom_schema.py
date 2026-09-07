import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'd:\01.AntiGravity\Giyuen_Lift\schema.sql', 'r', encoding='utf-8', errors='replace') as f:
    text = f.read()

import re
m = re.search(r'CREATE TABLE\s+(?:IF NOT EXISTS\s+)?transport_companies\s*\([^;]+\);', text, re.IGNORECASE)
if m:
    print(m.group(0))
else:
    print("Not found in schema.sql")
