import os

engine_path = r'd:\01.AntiGravity\Giyuen_Lift\src\services\migrationEngine.ts'
with open(engine_path, 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace("const wsMain = wb.Sheets['202608'];", "const wsMain = wb.Sheets['계약현황'] || wb.Sheets['202608'];")
c = c.replace("202608 시트 기반", "계약현황(202608) 시트 기반")

with open(engine_path, 'w', encoding='utf-8') as f:
    f.write(c)

ui_path = r'd:\01.AntiGravity\Giyuen_Lift\src\pages\InitialDbUploader.tsx'
with open(ui_path, 'r', encoding='utf-8') as f:
    c2 = f.read()

c2 = c2.replace("5개 시트(보유자산현황, 26.08, 거래처정보현황, 업체별마감일자, 202608)가 포함된", "5개 시트(보유자산현황, 보유장비 임대현황, 거래처정보현황, 업체별마감일자, 계약현황)가 포함된")
c2 = c2.replace("보유자산현황, 26.08, 거래처정보현황, 업체별마감일자, 202608", "보유자산현황, 보유장비 임대현황, 거래처정보현황, 업체별마감일자, 계약현황")

with open(ui_path, 'w', encoding='utf-8') as f:
    f.write(c2)

print("Sheet names patched.")
