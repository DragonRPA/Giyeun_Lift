import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.30 (2026-09-01 21:44)\n"
        "- **기능개선**: 초기DB 업로드 화면에 소급 청구서 기간 선택 기능 추가.\n"
        "  - 기본값: 소급 청구서 미생성 (체크박스 OFF). 담당자가 명시적으로 기간을 지정해야만 생성.\n"
        "  - 활성화 시: 시작 월 ~ 종료 월 입력란이 표시되며, 지정 기간 내에만 계약별 월별 소급 청구서 생성.\n"
        "  - 계약 최초개시월보다 늦은 시작월을 설정해도 정상 처리 (max 기준 자동 적용).\n"
        "  - migrationEngine.ts: parseInitialExcelWorkbook에 histBillingRange 옵션 파라미터 추가.\n"
    )

os.system('git add -A')
os.system('git commit -m "feat: 초기DB 업로드 소급 청구서 기간 선택 UI 추가 - 기본 미생성, 범위 지정 시 선택 생성 (Build.30)"')
os.system('git push origin main')
