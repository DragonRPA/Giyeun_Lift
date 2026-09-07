import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.36 (2026-09-02 18:20)\n"
        "- **버그패치 & 스키마 전수 정합성 검증**: TABLE_COLUMNS 화이트리스트 전체 Supabase DB 스키마 1:1 동기화.\n"
        "  - 근본 원인 규명: batchUpsertChunked 내부에서 filterRecordBySchema(table, r) 호출 시 TABLE_COLUMNS.deliveries에 requestDate, loadingDate, unloadingDate 등 실제 컬럼이 누락되어 있어 해당 필드들이 전부 필터링(삭제)되었음. 이로 인해 PostgreSQL의 requestDate NOT NULL 제약 위반 발생.\n"
        "  - 조치 1: Supabase REST API를 통해 전체 19개 테이블의 실제 DB 컬럼을 전수 조회/감사.\n"
        "  - 조치 2: TABLE_COLUMNS 내 deliveries, vendors, customers, assets, external_leases 등 전 테이블의 컬럼 화이트리스트를 Supabase 실제 컬럼과 100% 일치하도록 보강.\n"
        "  - 조치 3: 실제 Supabase deliveries 테이블에 테스트 배차 데이터 UPSERT/DELETE 1:1 통신 검증 완료.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: TABLE_COLUMNS 스키마 화이트리스트 전수 동기화 및 deliveries requestDate 누락 원인 해결 (Build.36)"')
os.system('git push origin main')
