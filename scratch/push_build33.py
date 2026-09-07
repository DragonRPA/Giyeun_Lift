import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.33 (2026-09-02 18:09)\n"
        "- **버그패치**: 배차 이력 파싱 이상치 2종 방어 로직 추가.\n"
        "  - 메모/합계 행 스킵: Col[4]가 '('로 시작하거나 4자리 이상 숫자인 행 건너뜀 (예: '(부가세별도)', '4510000').\n"
        "  - 운반비 상한 캡: 원본 값 200 초과(만원 단위 기준 200만원 초과)는 0으로 처리 — 합계금액 오인 방어.\n"
        "  - 배차유무 오타 허용: '완려' 등 '완'으로 시작하는 값 → COMPLETED 처리.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: 배차 파싱 이상치 방어 - 메모행 스킵, 운반비 캡, 배차유무 오타 허용 (Build.33)"')
os.system('git push origin main')
