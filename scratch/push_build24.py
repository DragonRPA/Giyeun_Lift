import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.24 (2026-09-01 20:25)\n"
        "- **버그수정(치명)**: 초기DB 업로드 시 당사 자산 '관리번호'가 항상 '미지정'으로 저장되는 근본 원인 수정.\n"
        "  - 원인: 엑셀 계약현황 시트에 '관리번호' 컬럼이 Col[10](당사)와 Col[13](전대) 두 곳에 중복 존재하나,\n"
        "    buildHeaderMap()이 첫 번째(Col[10])만 Map에 등록. getCol() 헤더 검색 실패 시 fallback 인덱스를\n"
        "    ownAssetNo와 leaseAssetNo 모두 13으로 동일하게 참조하여 당사 자산이 전대 관리번호칸(빈값)을 읽음.\n"
        "  - 해결: ownAssetNo는 r[10], leaseAssetNo는 r[13]을 직접 인덱스로 읽도록 hardfix.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: 당사/전대 자산 관리번호 컬럼 인덱스 혼용 버그 근본 수정 (Build.24)"')
os.system('git push origin main')
