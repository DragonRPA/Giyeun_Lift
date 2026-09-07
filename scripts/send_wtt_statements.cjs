/**
 * WTT 4건 계약변경 거래명세서 이메일 발송 스크립트
 * - /api/send-email (Vercel Serverless) 를 직접 호출
 * - 수신: 77.victor.lee@gmail.com (개발자)
 * - 발신: Gmail SMTP (77.victor.lee@gmail.com + App Password)
 */

const https = require('https');

const GOOGLE_EMAIL    = '77.victor.lee@gmail.com';
const GMAIL_APP_PASS  = 'hqqgtwtsjimvqmeb';
const RECIPIENT_EMAIL = '77.victor.lee@gmail.com';

// Vercel 배포 URL (prod)
const VERCEL_API_URL = 'https://giyeun-lift.vercel.app/api/send-email';

// ── 4건 거래명세서 내용 정의 ─────────────────────────────────────────
const statements = [
  {
    label: '① 자산교환 (EXCHANGE)',
    contractNo: 'C202603-0005',
    changeType: 'EXCHANGE',
    subject: '[기연리프트 ERP] 거래명세서 — 자산교환 계약변경 C202603-0005 (2026-08-23)',
    body: `안녕하세요. (주)기연리프트 ERP 시스템입니다.

아래 계약에 대해 자산교환(EXCHANGE) 처리가 완료되었습니다.
거래명세서를 안내드립니다.

──────────────────────────────────
■ 거래명세서
──────────────────────────────────
계약번호   : C202603-0005
변경유형   : 자산교환 (EXCHANGE)
처리일자   : 2026-08-23
고객사     : 호반건설 주식회사
현장       : 호반건 현장3공구
청구일     : 매월 30일

■ 변경 내용
─ 전 자산: ASSET-0000304 (JCPT1012AC / K10304)
  → 교환일 2026-08-23 기준 매출기여 마감
─ 후 장비: ASSET-0000850 (JCPT1212AC / K10850)
  → 2026-08-23 부터 동일 렌탈료 조건 승계

■ 렌탈료 조건 (100% 상속)
  월 렌탈료 : 400,000원
  일 렌탈료 : 13,333원
  전대 여부  : 자사 보유 장비

■ 계약이력 변경사유
  현장 가동 중 JCPT1012AC 유압 실린더 성능 저하 발생.
  동급 이상 모델 JCPT1212AC로 대차 교환 완료.

──────────────────────────────────
본 메일은 ERP 시스템에서 자동 발송되었습니다.
문의사항은 담당자에게 연락 주세요.
(주)기연리프트 | 77.victor.lee@gmail.com
──────────────────────────────────`
  },
  {
    label: '② 계약단축 (SHORTEN)',
    contractNo: 'C202604-0004',
    changeType: 'SHORTEN',
    subject: '[기연리프트 ERP] 거래명세서 — 계약단축 C202604-0004 (2026-08-23)',
    body: `안녕하세요. (주)기연리프트 ERP 시스템입니다.

아래 계약에 대해 계약단축(SHORTEN) 처리가 완료되었습니다.
거래명세서를 안내드립니다.

──────────────────────────────────
■ 거래명세서
──────────────────────────────────
계약번호   : C202604-0004
변경유형   : 계약단축 (SHORTEN)
처리일자   : 2026-08-23
고객사     : 한화건설 주식회사
청구일     : 매월 25일

■ 변경 내용
─ 기존 계약 종료일 : 2026-09-09
─ 변경 계약 종료일 : 2026-08-31 (9일 단축)
─ 단축 사유 : 현장 공정 완료 조기 반납 요청

■ 일할 정산 안내
  단축 기간: 2026-09-01 ~ 2026-09-09 (9일)
  해당 기간 렌탈료 청구 취소 예정
  (담당 청구 담당자 확인 후 최종 청구서에 반영)

■ 반납 회수 배차
  회수 예정일  : 2026-08-31
  운송사       : 배차 담당자 별도 발행 예정

──────────────────────────────────
본 메일은 ERP 시스템에서 자동 발송되었습니다.
(주)기연리프트 | 77.victor.lee@gmail.com
──────────────────────────────────`
  },
  {
    label: '③ 계약연장 (EXTEND)',
    contractNo: 'C202604-0016',
    changeType: 'EXTEND',
    subject: '[기연리프트 ERP] 거래명세서 — 계약연장 C202604-0016 (2026-08-23)',
    body: `안녕하세요. (주)기연리프트 ERP 시스템입니다.

아래 계약에 대해 계약연장(EXTEND) 처리가 완료되었습니다.
거래명세서를 안내드립니다.

──────────────────────────────────
■ 거래명세서
──────────────────────────────────
계약번호   : C202604-0016
변경유형   : 계약연장 (EXTEND)
처리일자   : 2026-08-23
고객사     : 삼성물산 주식회사
청구일     : 매월 25일

■ 변경 내용
─ 기존 계약 종료일 : 2026-09-08
─ 연장 계약 종료일 : 2026-12-08 (3개월 연장)
─ 연장 사유 : 현장 공기 연장으로 추가 임차 확정

■ 연장 기간 렌탈료 안내
  연장 기간   : 2026-09-09 ~ 2026-12-08 (91일)
  기존 렌탈료 조건 동일 적용
  청구월      : 2026년 10월 / 11월 / 12월 (25일 마감)

──────────────────────────────────
본 메일은 ERP 시스템에서 자동 발송되었습니다.
(주)기연리프트 | 77.victor.lee@gmail.com
──────────────────────────────────`
  },
  {
    label: '④ 계약승계 (SUCCESSION)',
    contractNo: 'C202605-0003 → C202608-SUCC-0001',
    changeType: 'SUCCESSION',
    subject: '[기연리프트 ERP] 거래명세서 — 계약승계 C202605-0003→C202608-SUCC-0001 (2026-08-23)',
    body: `안녕하세요. (주)기연리프트 ERP 시스템입니다.

아래 계약에 대해 계약승계(SUCCESSION) 처리가 완료되었습니다.
거래명세서를 안내드립니다.

──────────────────────────────────
■ 거래명세서
──────────────────────────────────
원 계약번호  : C202605-0003
신규 계약번호: C202608-SUCC-0001
변경유형     : 계약승계 (SUCCESSION)
처리일자     : 2026-08-23
고객사       : 두산건설 주식회사
승계 청구일  : 원 계약 청구일 동일 (매월 20일)

■ 변경 내용
─ 기존 계약 C202605-0003 계약권리 이전
  (계약기간 2026-05-07 ~ 2026-09-07, 현장 계속 가동)
─ 신규 계약 C202608-SUCC-0001 발효
  (계약기간 2026-08-23 ~ 2027-02-28, 6개월)

■ 승계 조건 100% 상속
  현장        : 동일 현장 (SITE-0000036)
  자산/청구일 : 원 계약 조건 그대로 승계
  담당 영업   : 테스터(계약관리)

■ 월별 렌탈료 청구 안내
  2026년 9월부터 신규 계약번호 C202608-SUCC-0001 기준 청구 발행

──────────────────────────────────
본 메일은 ERP 시스템에서 자동 발송되었습니다.
(주)기연리프트 | 77.victor.lee@gmail.com
──────────────────────────────────`
  }
];

// ── 이메일 발송 함수 ─────────────────────────────────────────────────
function sendEmailViaAPI(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const urlObj = new URL(VERCEL_API_URL);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode === 200 && result.success) {
            resolve(result);
          } else {
            reject(new Error(result.error || `HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`JSON 파싱 실패: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── 메인 실행 ────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  (주)기연리프트 ERP — WTT 계약변경 거래명세서 이메일 발송   ║');
  console.log(`║  수신: ${RECIPIENT_EMAIL.padEnd(49)}║`);
  console.log(`║  발신: ${GOOGLE_EMAIL.padEnd(49)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  let successCount = 0;
  let failCount = 0;

  for (const stmt of statements) {
    console.log(`\n  📨 발송 중: ${stmt.label} (${stmt.contractNo})...`);
    try {
      const result = await sendEmailViaAPI({
        to: RECIPIENT_EMAIL,
        subject: stmt.subject,
        body: stmt.body,
        googleEmail: GOOGLE_EMAIL,
        gmailAppPassword: GMAIL_APP_PASS
      });
      console.log(`  ✅ 발송 성공 | MessageId: ${result.messageId}`);
      successCount++;
    } catch (err) {
      console.error(`  ❌ 발송 실패: ${err.message}`);
      failCount++;
    }

    // 연속 발송 간격 (스팸 방지)
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  📊 발송 결과: ✅ 성공 ${successCount}건 / ❌ 실패 ${failCount}건 / 전체 ${statements.length}건`);
  console.log('──────────────────────────────────────────────────────────────');
}

main().catch(err => console.error('Fatal error:', err));
