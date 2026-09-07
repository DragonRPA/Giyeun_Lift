import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.25 (2026-09-01 20:31)\n"
        "- **버그수정**: migrationEngine.ts 내 getCol() 호출 13건 전수 감사 완료.\n"
        "  - 12건 정상 확인.\n"
        "  - 1건 오류 수정: contractStatusStr이 '상태'/'결재상태' 키 매칭 실패로 fallback Col[10](관리번호)를\n"
        "    읽는 버그 → Col[8](계약구분: '연장','종료','가상' 등)을 직접 인덱스로 읽도록 수정.\n"
        "    이로 인해 '종료' 계약 판별이 정상화됨.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: getCol 전수 감사 - contractStatusStr Col[8] 직접 읽기로 수정 (Build.25)"')
os.system('git push origin main')
