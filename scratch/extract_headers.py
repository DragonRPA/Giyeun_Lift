import re
import os

files = ["asset_history.tsx", "Billings.tsx", "Contracts.tsx", "Deliveries.tsx", 
         "Products.tsx", "rent_assets.tsx", "Repairs.tsx", "Vendors.tsx"]
folder = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

for f in files:
    path = os.path.join(folder, f)
    if not os.path.exists(path): continue
    with open(path, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # extract th
    ths = re.findall(r'<th[^>]*>(.*?)</th>', content, re.DOTALL)
    ths_clean = [re.sub(r'<[^>]+>', '', th).strip() for th in ths]
    ths_clean = [th.replace('\n', '').strip() for th in ths_clean if th.strip()]
    
    # extract return keys in map
    returns = re.findall(r'return\s*\{([^}]+)\}', content)
    keys = []
    if returns:
        for r in returns:
            k = re.findall(r'[\'"]?([a-zA-Z0-9_가-힣\/\(\)\s]+)[\'"]?\s*:', r)
            keys.extend([x.strip() for x in k if x.strip()])
            
    print(f"--- {f} ---")
    print("UI TH:", ths_clean)
    print("EXCEL KEYS:", list(set(keys)))
