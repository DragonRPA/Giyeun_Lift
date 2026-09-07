import os
import re

files_to_check = [
    "src/pages/Assets.tsx",
    "src/pages/asset_history.tsx",
    "src/pages/BankMatching.tsx",
    "src/pages/Billings.tsx",
    "src/pages/Consumables.tsx",
    "src/pages/Contracts.tsx",
    "src/pages/Customers.tsx",
    "src/pages/Deliveries.tsx",
    "src/pages/Products.tsx",
    "src/pages/rent_assets.tsx",
    "src/pages/Repairs.tsx",
    "src/pages/Vendors.tsx"
]

output = "# Excel Export Specification (엑셀 내보내기 명세서)\n\n"

for path in files_to_check:
    full_path = os.path.join(r"d:\01.AntiGravity\Giyuen_Lift", path)
    if not os.path.exists(full_path):
        continue
    
    with open(full_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    output += f"## {os.path.basename(path)}\n\n"
    found = False
    
    maps = re.finditer(r'const\s+(\w+)\s*=\s*([a-zA-Z0-9_.]+)\.map\s*\((.*?)\s*=>\s*({(?:[^{}]*|{[^{}]*})*})\s*\)', content, re.DOTALL)
    for m in maps:
        var_name = m.group(1)
        source_array = m.group(2)
        params = m.group(3)
        mapping = m.group(4)
        
        if re.search(fr'exportToExcel\s*\([^,]*{var_name}', content):
            output += f"### Export Variable: `{var_name}`\n"
            output += f"- **Source Data**: `{source_array}`\n"
            output += f"```typescript\n{mapping}\n```\n\n"
            found = True
            
    if not found:
        output += "Could not automatically extract map logic. (May use inline mapping or different variable naming)\n\n"

with open(r"C:\Users\이정용\.gemini\antigravity\brain\562f05e5-a1a5-4108-a8b2-1ce4dd84e149\excel_export_specs.md", "w", encoding="utf-8") as f:
    f.write(output)

print("Extracted to excel_export_specs.md")
