import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.35 (2026-09-02 18:14)\n"
        "- **버그패치**: 배차 적재 실패 수정 — deliveries 테이블에 존재하지 않는 컬럼 제거.\n"
        "  - 제거: contractAssetId, customerId, specialNotes (Delivery 인터페이스에 없음).\n"
        "  - 추가: isCostSettled=false (NOT NULL 필수 컬럼).\n"
        "  - 고객명/수량 정보는 memo 필드에 '업체: XXX | 수량: N대' 형식으로 텍스트 보존.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: deliveries 존재하지 않는 컬럼 제거(contractAssetId 등), isCostSettled 추가 (Build.35)"')
os.system('git push origin main')
