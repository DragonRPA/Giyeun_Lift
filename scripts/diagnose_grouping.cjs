/**
 * diagnose_grouping.cjs — 계약 그룹핑 진단
 * 202608 시트에서 (고객+현장+시작일+종료일) 조합 분포를 분석
 */
const X  = require('D:/01.AntiGravity/Giyuen_Lift/node_modules/xlsx/xlsx.js');
const fs = require('fs');

const EXCEL_PATH = 'D:\\OneDrive\\Desktop\\기연리프트자료_\\자동업로드\\초기DB현황1.xlsx';
const wb = X.read(fs.readFileSync(EXCEL_PATH));

// Excel 날짜 시리얼 → ISO 변환
function excelDateToISO(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const d = new Date(val.trim());
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof val === 'number') {
    // Excel serial date: days since 1900-01-01 (with 1900 leap year bug)
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeCustomerName(name) {
  if (!name) return '';
  return String(name)
    .replace(/주식회사|\(주\)|㈜|\(유\)|유한회사|\(합\)|합자회사|사단법인|재단법인/gi, '')
    .replace(/[\s\(\)\[\]._\-]/g, '')
    .toLowerCase();
}

const wsMain = wb.Sheets['202608'];
const rawMainRows = X.utils.sheet_to_json(wsMain, { header: 1, defval: null }).slice(3);

const groupMap   = new Map(); // (custNorm_site_start_end) → count
const singleRows = [];        // 그룹핑 불가 단독 행
let totalValid = 0;

rawMainRows.forEach(r => {
  if (!r || (!r[0] && !r[2])) return;
  totalValid++;

  const custNorm = normalizeCustomerName(r[0]) || '기본고객사';
  const site     = r[1] ? String(r[1]).trim() : '(현장없음)';
  const startISO = excelDateToISO(r[4]) || '2026-08-01';
  const endISO   = excelDateToISO(r[5]) || '9999-12-31';
  const key = `${custNorm}|${site}|${startISO}|${endISO}`;

  groupMap.set(key, (groupMap.get(key) || 0) + 1);
});

// 분포 집계
let groupOf1 = 0, groupOf2 = 0, groupOf3plus = 0;
let maxGroup = 0;
let maxGroupKey = '';

for (const [key, cnt] of groupMap) {
  if (cnt === 1) groupOf1++;
  else if (cnt === 2) groupOf2++;
  else groupOf3plus++;
  if (cnt > maxGroup) { maxGroup = cnt; maxGroupKey = key; }
}

const projectedContracts = groupMap.size;

console.log('=== 계약 그룹핑 진단 ===');
console.log(`  202608 유효 행:         ${totalValid}건`);
console.log(`  예상 계약 수:           ${projectedContracts}건  (그룹핑 후)`);
console.log(`  단독(1자산) 그룹:       ${groupOf1}건`);
console.log(`  2자산 그룹:             ${groupOf2}건`);
console.log(`  3자산+ 그룹:            ${groupOf3plus}건`);
console.log(`  최대 그룹 크기:         ${maxGroup}자산`);
console.log(`  최대 그룹 키:           ${maxGroupKey}`);

console.log('\n=== 종료일(r[5]) 분포 ===');
const endDateDist = new Map();
rawMainRows.forEach(r => {
  if (!r || (!r[0] && !r[2])) return;
  const endISO = excelDateToISO(r[5]) || '9999-12-31(기본값)';
  endDateDist.set(endISO, (endDateDist.get(endISO) || 0) + 1);
});
// 상위 10개만 출력
const topEnds = [...endDateDist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
topEnds.forEach(([d, c]) => console.log(`  ${d}: ${c}건`));

console.log('\n=== 시작일(r[4]) 분포 (상위 10) ===');
const startDateDist = new Map();
rawMainRows.forEach(r => {
  if (!r || (!r[0] && !r[2])) return;
  const startISO = excelDateToISO(r[4]) || '2026-08-01(기본값)';
  startDateDist.set(startISO, (startDateDist.get(startISO) || 0) + 1);
});
const topStarts = [...startDateDist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
topStarts.forEach(([d, c]) => console.log(`  ${d}: ${c}건`));
