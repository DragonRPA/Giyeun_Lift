import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.32 (2026-09-02 18:03)\n"
        "- **기능추가**: 초기DB 업로드 화면에 '배차 이력 업로드' 섹션 ③ 추가.\n"
        "  - 대상 파일: 배차현황 엑셀 (18개 시트, 2025-04 ~ 2026-09, 총 1,684건).\n"
        "  - 연도 파싱: 시트명 '26년X월' → 2026년, 'X월' → 2025년 자동 판별.\n"
        "  - 배차 유형 결정: 비고에 '왕복'/'왕복건' 포함 → EXCHANGE, 출고→OUTBOUND, 입고→INBOUND, 반납→RETURN.\n"
        "  - 수량 처리: 수량 > 1이어도 delivery 레코드 1건, specialNotes에 '수량: N대' 기록.\n"
        "  - 운반비 단위: 만원 단위 숫자 × 10,000 → 원 단위 자동 변환.\n"
        "  - 고객 자동 매핑: normalizeCustomerName 기준, 실패 시 customerId=null 저장.\n"
        "  - 계약 자동 매핑: 고객+모델명 3중 조건, 실패 시 null 저장.\n"
        "  - 파싱 미리보기: 총 건수 / 완료 / EXCHANGE / 고객미매핑 / 계약미매핑 통계 표출.\n"
        "  - migrationEngine.ts: parseDispatchExcelWorkbook, ingestDispatchData 신규 함수 추가.\n"
    )

os.system('git add -A')
os.system('git commit -m "feat: 초기DB 업로드에 배차이력 엑셀 업로드 기능 추가 - 18개 시트 1684건 파싱/적재 (Build.32)"')
os.system('git push origin main')
