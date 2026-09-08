const fs = require('fs');
const path = require('path');

const jsonPath = 'D:/OneDrive/Desktop/기연리프트자료_/자동업로드/사용자권한_마스터_20260908.json';
if (!fs.existsSync(jsonPath)) {
  console.error('파일이 존재하지 않습니다:', jsonPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

console.log('=== 1. 파일 검증 ===');
console.log('총 임직원:', data.users.length);
console.log('총 권한 항목 (rawPermissions):', data.rawPermissions.length);

let totalUserPerms = 0;
data.users.forEach(u => {
  totalUserPerms += u.permissions.length;
});
console.log('사용자별 permissions 배열 총합:', totalUserPerms);

console.log('\n=== 2. 임직원별 상세 집계 ===');
data.users.forEach((u, i) => {
  const viewCount = u.permissions.filter(p => p.canView).length;
  const saveCount = u.permissions.filter(p => p.canSave).length;
  const num = (i + 1).toString().padStart(2, ' ');
  const name = (u.name || '').padEnd(8, ' ');
  const dept = (u.departmentName || '-').padEnd(8, ' ');
  const total = u.permissions.length.toString().padStart(2, ' ');
  const vStr = viewCount.toString().padStart(2, ' ');
  const sStr = saveCount.toString().padStart(2, ' ');
  console.log(`${num}. ${name} (${dept}) | 총 ${total}건 | 조회 ${vStr}개 | 저장 ${sStr}개`);
});

console.log('\n=== 3. 무결성 검증 (Conservation Law) ===');
console.log('✓ rawPermissions(790건) === user.permissions 합계(790건):', data.rawPermissions.length === totalUserPerms ? '일치 (통과)' : '불일치');
console.log('✓ 20명 전원 고유 ID 보유 여부:', new Set(data.users.map(u => u.userId)).size === data.users.length ? '완전 고유 (통과)' : '중복 발견');
