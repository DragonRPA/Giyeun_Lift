const X  = require('D:/01.AntiGravity/Giyuen_Lift/node_modules/xlsx/xlsx.js');
const fs = require('fs');

const EXCEL_PATH = 'D:\\OneDrive\\Desktop\\기연리프트자료_\\자동업로드\\초기DB현황1.xlsx';

try {
  const wb = X.read(fs.readFileSync(EXCEL_PATH));
  console.log('✅ xlsx 파싱 성공');
  console.log('시트 목록:', wb.SheetNames);
  for (const name of wb.SheetNames) {
    const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
    console.log(`  ${name}: ${rows.length}행`);
  }
} catch(e) {
  console.log('❌ 파싱 실패:', e.message);
}
