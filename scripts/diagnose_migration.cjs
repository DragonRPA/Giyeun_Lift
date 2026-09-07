/**
 * diagnose_migration.cjs — 마이그레이션 파싱 결과 진단
 * migrate_run.cjs를 실행하지 않고, 파싱만 수행하여 각 엔티티 수를 출력
 */
const X  = require('D:/01.AntiGravity/Giyuen_Lift/node_modules/xlsx/xlsx.js');
const fs = require('fs');

const EXCEL_PATH = 'D:\\OneDrive\\Desktop\\기연리프트자료_\\자동업로드\\초기DB현황1.xlsx';
const wb = X.read(fs.readFileSync(EXCEL_PATH));

// ── 202608 시트 파싱 → 전대(external_leases) 행 수 확인
const wsMain = wb.Sheets['202608'];
const rawMainRows = X.utils.sheet_to_json(wsMain, { header: 1, defval: null }).slice(3);

let leaseCount = 0;
let ownedCount = 0;
let bothCount  = 0;
let neitherCount = 0;

rawMainRows.forEach(r => {
  if (!r || (!r[0] && !r[2])) return;
  const ownAssetNo  = r[3] ? String(r[3]).trim() : '';  // 자사 자산번호
  const leaseAssetNo = r[4] ? String(r[4]).trim() : ''; // 전대 자산번호

  if (ownAssetNo && leaseAssetNo) bothCount++;
  else if (ownAssetNo)   ownedCount++;
  else if (leaseAssetNo) leaseCount++;
  else neitherCount++;
});

console.log('=== 202608 시트 분석 ===');
console.log(`  전체 데이터 행:    ${rawMainRows.filter(r => r && (r[0] || r[2])).length}건`);
console.log(`  자사 자산번호만:   ${ownedCount}건`);
console.log(`  전대 자산번호만:   ${leaseCount}건  ← external_leases 대상`);
console.log(`  자사+전대 둘 다:   ${bothCount}건`);
console.log(`  둘 다 없음:        ${neitherCount}건`);

// 전대 행 샘플 5개 출력
console.log('\n=== 전대 행 샘플 (r[4]가 있는 첫 5행) ===');
let sample = 0;
rawMainRows.forEach(r => {
  if (!r || !r[4] || sample >= 5) return;
  const leaseNo = String(r[4]).trim();
  const vendor  = r[15] ? String(r[15]).trim() : '(없음)';
  const rent    = r[16] || 0;
  const rentEnd = r[17] || '(없음)';
  console.log(`  [${++sample}] 전대번호: ${leaseNo}, 임차처: ${vendor}, 임차단가: ${rent}, 반납일: ${rentEnd}`);
});

// ── 보유자산현황 시트 자산 수
const wsAsset = wb.Sheets['보유자산현황'];
const rawAssetRows = X.utils.sheet_to_json(wsAsset, { header: 1, defval: null }).slice(4);
const validAssets = rawAssetRows.filter(r => r && (r[1] || r[4]));
console.log(`\n=== 보유자산현황 시트 ===`);
console.log(`  자산 행 수: ${validAssets.length}건`);

// ── 거래처정보현황 시트 고객 수
const wsCust = wb.Sheets['거래처정보현황'];
const rawCustRows = X.utils.sheet_to_json(wsCust, { header: 1, defval: null }).slice(2);
const validCusts = rawCustRows.filter(r => r && r[1]);
console.log(`\n=== 거래처정보현황 시트 ===`);
console.log(`  고객 행 수: ${validCusts.length}건`);

// ── 업체별마감일자 시트 고객 수 (중복 없는 업체명)
const wsClose = wb.Sheets['업체별마감일자'];
const rawCloseRows = X.utils.sheet_to_json(wsClose, { header: 1, defval: null }).slice(2);
const closeNames = new Set(rawCloseRows.filter(r => r && r[0]).map(r => String(r[0]).trim()));
console.log(`\n=== 업체별마감일자 시트 ===`);
console.log(`  고유 업체 수: ${closeNames.size}건`);
