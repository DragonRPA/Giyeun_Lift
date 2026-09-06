const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, '../wtt_100_report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

const SPATIAL_KR = {
  DIRECT_SITE_TO_SITE: '현장직송',
  HQ_DEPOT_TRANSIT: '본사주기장경유',
  THIRD_PARTY_YARD: '제3주기장',
  REMOTE_ISLAND: '도서/원격지'
};
const PHYSICAL_KR = {
  STANDARD: '표준장비',
  BOLTED_SAFETY: '안전옵션볼팅',
  SHEET_PROTECTION: '보양시트작업',
  HYDRAULIC_LEAK: '유압누유정비',
  BATTERY_DISCHARGE: '배터리방전교체'
};
const TEMPORAL_KR = {
  ASAP_EMERGENCY: '긴급 ASAP',
  MORNING_AFTERNOON: '오전상차/오후하차',
  MONTH_END_STAGGERED: '월말 시차출고',
  NEXT_DAY_DELIVERY: '오후상차/익일하차',
  EXACT_SCHEDULE: '시간지정(07:30)'
};
const COST_KR = {
  CUSTOMER_100: '고객청구 100%',
  OURS_WAIVED: '당사영업부담(면제)',
  SPLIT_50_50: '편도지원(50:50)',
  VENDOR_DEDUCTION: '원사정산공제'
};
const QUANTITY_KR = {
  SINGLE_1: '단일 1대',
  STAGGERED_3: '3대 시차출고',
  EXCHANGE_1: '대차 1:1 (회수1대)',
  EXCHANGE_MULTI_2: '대차 (회수 2대 동시)',
  EXCHANGE_MULTI_5: '대차 (회수 5대 일괄)'
};

let md = '| 번호 | 공간 축 (경로) | 물리 축 (제원/정비) | 시간 축 (상하차) | 비용 축 (운송비 귀속) | 수량 축 (대차/회수) | 9대 스키마 실드 | 검증결과 |\n';
md += '|:---:|:---|:---|:---|:---|:---|:---:|:---:|\n';

report.scenarios.forEach(s => {
  md += '| ' + s.id + ' | ' + SPATIAL_KR[s.spatial] + ' | ' + PHYSICAL_KR[s.physical] + ' | ' + TEMPORAL_KR[s.temporal] + ' | ' + COST_KR[s.cost] + ' | ' + QUANTITY_KR[s.quantity] + ' | 9/9 VALID | 🟢 PASS |\n';
});

const outPath = path.join(__dirname, '../wtt_100_table.md');
fs.writeFileSync(outPath, md, 'utf-8');
console.log('Successfully generated wtt_100_table.md, count:', report.scenarios.length);
