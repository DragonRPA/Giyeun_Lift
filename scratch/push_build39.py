import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.39 (2026-09-02 18:47)\n"
        "- **UI/UX 간소화**: DB 전체 초기화 시 2차 텍스트 입력 확인 모달 제거.\n"
        "  - 불필요한 '초기화확인' 타이핑 2차 확인 절차를 전면 제거하고, 1차 confirm 즉시 실행으로 초기화 프로세스를 간소화.\n"
        "  - 초기화 실행 중 버튼 상태(로딩 스피너 및 disabled) 실시간 연동.\n"
    )

os.system('git add -A')
os.system('git commit -m "refactor: DB 초기화 2차 텍스트 입력 확인 절차 제거 및 직관화 (Build.39)"')
os.system('git push origin main')
