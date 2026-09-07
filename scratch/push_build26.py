import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.26 (2026-09-01 20:49)\n"
        "- **버그수정(치명)**: 마이그레이션 엔진의 중복 헤더로 인한 전대 장비 파싱 오류 3종 일괄 수정.\n"
        "  1. rawModel: 전대 장비만 있는 행에서 Col[9](당사 장비명=빈값) getCol 실패 → fallback Col[3](최초개시일=날짜시리얼)\n"
        "     을 읽어 모델명이 45845, 46119 같은 날짜 숫자로 들어가는 버그 → Col[9]||Col[12] 직접 인덱스 분리로 수정.\n"
        "  2. rawHeight: 동일 패턴으로 날짜시리얼이 장비 높이값으로 오파싱되던 버그 → 모델명 기반 추론으로 전환.\n"
        "  3. contractStatusStr: '상태' 헤더 없음 → fallback Col[10](관리번호) 읽던 버그(Build.25에서 이미 수정).\n"
        "- 이로써 전대 장비(G8344, G8152, G8143 등)의 모델명이 GS1930 등 정확한 이름으로 저장됨.\n"
        "- 장비 할당 화면의 모델명 46261 등 숫자 오표시 완전 해소.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: 중복 헤더 컬럼 전대장비 파싱 오류 전수 수정 - 모델명 날짜시리얼 버그 해소 (Build.26)"')
os.system('git push origin main')
