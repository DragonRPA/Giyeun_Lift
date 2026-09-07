import os

path = r'd:\01.AntiGravity\Giyuen_Lift\src\services\migrationEngine.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

old1 = "const ownAssetNo = getCol(r, mainHeaderMap, ['당사장비', '자산번호', '장비번호'], 13) ? String(getCol(r, mainHeaderMap, ['당사장비', '자산번호', '장비번호'], 13)).trim().toUpperCase() : '';"
new1 = "const ownAssetNo = getCol(r, mainHeaderMap, ['당사장비', '자산번호', '장비번호', '관리번호'], 10) ? String(getCol(r, mainHeaderMap, ['당사장비', '자산번호', '장비번호', '관리번호'], 10)).trim().toUpperCase() : '';"

old2 = "const leaseAssetNo = getCol(r, mainHeaderMap, ['전대장비', '임차장비'], 14) ? String(getCol(r, mainHeaderMap, ['전대장비', '임차장비'], 14)).trim().toUpperCase() : '';"
new2 = "const leaseAssetNo = getCol(r, mainHeaderMap, ['전대장비', '임차장비'], 13) ? String(getCol(r, mainHeaderMap, ['전대장비', '임차장비'], 13)).trim().toUpperCase() : '';"

c = c.replace(old1, new1)
c = c.replace(old2, new2)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Fixed")
