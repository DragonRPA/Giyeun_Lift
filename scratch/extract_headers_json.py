import re
import os
import json

files = ["asset_history.tsx", "Billings.tsx", "Contracts.tsx", "Deliveries.tsx", 
         "Products.tsx", "rent_assets.tsx", "Repairs.tsx", "Vendors.tsx"]
folder = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

results = {}

for f in files:
    path = os.path.join(folder, f)
    if not os.path.exists(path): continue
    with open(path, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # extract th (dirty but usable)
    ths = re.findall(r'<th[^>]*>(.*?)</th>', content, re.DOTALL)
    ths_clean = [re.sub(r'<[^>]+>', '', th).strip() for th in ths]
    ths_clean = [th.replace('\n', '').strip() for th in ths_clean if th.strip()]
    
    # Check if there is an exportToExcel block
    export_block = re.search(r'const\s+\w+\s*=\s*[a-zA-Z0-9_.]+\.map\(\([^)]+\)\s*=>\s*(\{[\s\S]*?\})\s*\)', content)
    keys = []
    if export_block:
        block_content = export_block.group(1)
        k = re.findall(r'[\'"]([a-zA-Z0-9_가-힣\/\(\)\s]+)[\'"]\s*:', block_content)
        keys = [x.strip() for x in k if x.strip()]
    
    results[f] = {
        "UI": ths_clean,
        "EXCEL": keys
    }

with open("scratch/headers.json", "w", encoding="utf-8") as out:
    json.dump(results, out, ensure_ascii=False, indent=2)
