import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.29 (2026-09-01 21:38)\n"
        "- **버그수정(치명)**: 과거 소급 청구서 12건에서 ~5,507건으로 정정.\n"
        "  - 원인: 소급 청구서 기준일로 Col[4](개시일=당월 기산일, 대부분 2026-08 이후)를 사용 → 소급 대상 4행만 탐지.\n"
        "  - 수정: Col[3](최초개시일=실제 계약 시작일)을 직접 읽어 소급 기준일로 사용.\n"
        "  - 재업로드 후 과거 소급 청구서는 1104행 × 평균 5개월 ≈ 5,507건으로 대폭 증가 예정.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: 소급 청구서 기준일 Col[4]→Col[3](최초개시일)로 수정 - 12건→~5,507건 (Build.29)"')
os.system('git push origin main')
