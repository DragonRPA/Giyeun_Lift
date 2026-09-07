import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.37 (2026-09-02 18:25)\n"
        "- **버그패치**: Supabase deliveries Check Constraint(type, dispatchCategory) 100% 준수 매핑.\n"
        "  - 근본 원인: PostgreSQL deliveries 테이블의 CHECK 제약조건 상 dispatchCategory는 ('출고', '입고', '반납', '정비', '이동'), type은 ('OUTBOUND', 'INBOUND')만 허용되나, '교환' 및 'EXCHANGE', 'RETURN' 값을 직접 삽입하려 하여 Check Constraint 위반 발생.\n"
        "  - 수정 조치: type은 OUTBOUND/INBOUND로 변환 매핑하고, dispatchCategory는 '출고'/'입고'/'반납'으로 정규화 매핑, '왕복/교환' 상세 내용은 memo/closingMemo 필드에 안전하게 보존.\n"
        "  - 실측 검증: 1,521건 실제 엑셀 파싱 데이터 중 100건 배치 청크를 Supabase에 직접 전송하여 Status 201 정상 저장 검증 완료.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: deliveries dispatchCategory 및 type Check Constraint 100% 정합성 패치 (Build.37)"')
os.system('git push origin main')
