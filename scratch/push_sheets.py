import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write("\n### v0.7.1.Build.23 (2026-09-01 20:11)\n- **기능개선**: 초기DB 업로드 시 매월 변경되던 엑셀 시트명(예: 202608, 26.08) 대신 고정된 시트명('계약현황', '보유장비 임대현황')을 자동 파싱하도록 마이그레이션 엔진 정규화.\n")

os.system('git add -A')
os.system('git commit -m "feat: 마이그레이션 대상 엑셀 시트명 정규화 (계약현황, 보유장비 임대현황)"')
os.system('git push origin main')
