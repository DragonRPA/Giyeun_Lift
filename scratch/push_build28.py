import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.28 (2026-09-01 21:32)\n"
        "- **버그수정**: 외상미수금 운반비 파싱 fallback 인덱스 오류 수정.\n"
        "  - transportFee getCol fallback=20(임차단가 컬럼)이었던 것을 7(운반비 컬럼)으로 수정.\n"
        "  - '운반비' 헤더가 headerMap에 없는 엑셀 파일 업로드 시 임차단가가 운반비로 읽히는 잠재 버그 제거.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: transportFee getCol fallback 20→7 수정 (운반비 Col[7] 정확히 참조) (Build.28)"')
os.system('git push origin main')
