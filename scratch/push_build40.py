import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.40 (2026-09-02 18:53)\n"
        "- **기능 추가**: 과거 소급 청구서 독립 선택 생성 및 전용 실행 버튼 탑재.\n"
        "  - 목적: 초기 DB 전체 엑셀 업로드와 무관하게, 의도할 때만 원하는 기간(예: 2024-01 ~ 2026-07)의 소급 청구서를 독립적으로 계산·적재하여 기능 테스트 가능.\n"
        "  - UI: '과거 소급 청구서 생성 (선택 실행)' 카드 내에 [소급 청구서 생성 및 적재 시작] 전용 버튼 및 실시간 진행 상태 연동.\n"
        "  - 로직: DB에 등록된 계약/자산/고객 마스터를 읽어 지정 기간의 월별 청구서(billings)와 청구 상세(billing_details)를 자동 일할 계산 후 batchUpsert 적재.\n"
    )

os.system('git add -A')
os.system('git commit -m "feat: 과거 소급 청구서 독립 선택 생성 및 전용 실행 버튼 추가 (Build.40)"')
os.system('git push origin main')
