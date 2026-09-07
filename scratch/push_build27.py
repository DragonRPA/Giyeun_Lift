import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.27 (2026-09-01 20:58)\n"
        "- **버그수정**: 고객 관리 화면에 이름 없는 유령 고객사(114, 115, 189, 190...)가 생성되던 원인 수정.\n"
        "  - 원인: '업체별마감일자' 시트 구조가 Col[0]=순번, Col[1]=업체명인데, getCol fallback=0으로\n"
        "    설정되어 업체명이 비어있는 하단 빈 행에서 Col[0](순번 숫자)이 고객명으로 등록됨.\n"
        "  - 해결: Col[1](업체명)을 직접 인덱스로 읽도록 수정. 업체명이 비어있거나 숫자인 행은 명시적으로 건너뜀.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: 마감일자 시트 파싱 오류 - 유령 고객사(순번숫자 이름) 생성 버그 수정 (Build.27)"')
os.system('git push origin main')
