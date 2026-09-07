import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.38 (2026-09-02 18:32)\n"
        "- **기능 확장**: 배차 이력 업로드 시 2026년 이후 거래 운송사 마스터(transport_companies) 자동 선제 등록 연동.\n"
        "  - 대상: 2026년 시트(26년1월~26년9월)에 등장하는 고유 운송사 11개 사(경기, 엘제이, 자인일반, 자인셀프, 동방, 김수흥, 태현물류, 정익균, 자인 등).\n"
        "  - 동작: 배차 엑셀 파싱 시 2026년 운송사 목록을 자동 추출하여 프리뷰 카드에 표시하고, 배차 적재 1단계에서 transport_companies 테이블에 선제 batchUpsert 처리.\n"
        "  - 초기화 연동: resetAllDatabaseTables DELETION_ORDER에 transport_companies 추가.\n"
    )

os.system('git add -A')
os.system('git commit -m "feat: 배차 이력 업로드 시 2026년 거래 운송사 마스터(transport_companies) 자동 선제 등록 연동 (Build.38)"')
os.system('git push origin main')
