import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.31 (2026-09-01 21:54)\n"
        "- **정책변경**: 마이그레이션 시 계약기간 만료 자산 처리 원칙 변경.\n"
        "  - 변경 전: 종료일이 2026-08-01 이전이면 자동으로 COMPLETED/AVAILABLE 처리.\n"
        "  - 변경 후: 엑셀 Col[8](계약구분)에 '종료'로 명시된 경우에만 COMPLETED 처리.\n"
        "  - 근거: 계약기간이 만료되었더라도 연장/반납 여부 미결 상태이므로 RENTED + 현장 바인딩 유지.\n"
        "  - 영향: isCompleted 판별, 계약 status, 자산 status 및 currentCustomerId/currentSiteId 모두 적용.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: 계약기간 만료 자산도 연장/반납 미결 상태로 RENTED 유지 - 종료 명시 시에만 COMPLETED (Build.31)"')
os.system('git push origin main')
