import os

with open(r'd:\01.AntiGravity\Giyuen_Lift\RELEASE_NOTES.md', 'a', encoding='utf-8') as f:
    f.write(
        "\n### v0.7.1.Build.34 (2026-09-02 18:11)\n"
        "- **버그패치**: 배차 적재 실패 수정 — deliveries 테이블 컬럼명 snake_case → camelCase 전환.\n"
        "  - 원인: DB Delivery 인터페이스가 camelCase(requestDate, loadingDate 등)인데 snake_case로 삽입하여 requestDate NOT NULL 제약 위반.\n"
        "  - 수정: request_date→requestDate, loading_date→loadingDate, customer_id→customerId 등 전 컬럼명 camelCase로 수정.\n"
    )

os.system('git add -A')
os.system('git commit -m "fix: 배차 적재 컬럼명 snake_case→camelCase 수정 (requestDate NOT NULL 위반 해결) (Build.34)"')
os.system('git push origin main')
