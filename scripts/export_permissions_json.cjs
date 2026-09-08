/**
 * export_permissions_json.cjs
 * Supabase permissions, users, departments 데이터를 추출하여
 * D:/OneDrive/Desktop/기연리프트자료_/자동업로드/사용자권한_마스터_20260908.json 파일로 저장
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://wywgkikkjgbnlljkkmnz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d2draWtramdibmxsamtrbW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjcxMzgsImV4cCI6MjA5OTk0MzEzOH0.gSftxhQjFmWUQzikx-Q5UsdgNKSZISZqJvUGeLBOCqU';

function fetchTable(table) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      path: '/rest/v1/' + table + '?select=*',
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('1. Supabase 데이터 조회 시작...');
  const [users, departments, permissions] = await Promise.all([
    fetchTable('users'),
    fetchTable('departments'),
    fetchTable('permissions')
  ]);

  console.log('- 사용자(users): ' + users.length + '명');
  console.log('- 부서(departments): ' + departments.length + '개');
  console.log('- 권한(permissions): ' + permissions.length + '건');

  // 부서 맵 생성
  const deptMap = {};
  departments.forEach(d => {
    deptMap[d.id] = d.name;
  });

  // 사용자별 권한 그룹화
  const userPermMap = {};
  permissions.forEach(p => {
    if (!userPermMap[p.userId]) {
      userPermMap[p.userId] = [];
    }
    userPermMap[p.userId].push({
      id: p.id,
      menuId: p.menuId,
      canView: !!p.canView,
      canSave: !!p.canSave,
      role: p.role || undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    });
  });

  // 사용자 정보와 권한을 구조화
  const structuredUsers = users.map(u => {
    const uPerms = userPermMap[u.id] || [];
    uPerms.sort((a, b) => a.menuId.localeCompare(b.menuId));

    return {
      userId: u.id,
      loginId: u.loginId || u.id,
      name: u.name || '',
      role: u.role || 'USER',
      departmentId: u.departmentId || '',
      departmentName: deptMap[u.departmentId] || '',
      permissionsCount: uPerms.length,
      permissions: uPerms
    };
  });

  const exportPayload = {
    metadata: {
      system: '기연리프트 ERP 시스템',
      title: '임직원 권한 마스터 데이터',
      exportedAt: new Date().toISOString(),
      exportedDateText: '2026-09-08',
      totalUsers: users.length,
      totalDepartments: departments.length,
      totalPermissions: permissions.length,
      description: '조정 완료된 20명 임직원의 메뉴별 조회(canView) 및 저장(canSave) 권한 정밀 스냅샷'
    },
    departments: departments.map(d => ({
      id: d.id,
      name: d.name,
      order: d.order
    })),
    users: structuredUsers,
    rawPermissions: permissions
  };

  const targetDir = 'D:/OneDrive/Desktop/기연리프트자료_/자동업로드';
  const targetFile = path.join(targetDir, '사용자권한_마스터_20260908.json');

  console.log('2. 대상 폴더에 JSON 파일 쓰기: ' + targetFile);
  fs.writeFileSync(targetFile, JSON.stringify(exportPayload, null, 2), 'utf8');

  const localBackupDir = path.join(__dirname, 'backup');
  if (!fs.existsSync(localBackupDir)) {
    fs.mkdirSync(localBackupDir, { recursive: true });
  }
  const localBackupFile = path.join(localBackupDir, '사용자권한_마스터_20260908.json');
  fs.writeFileSync(localBackupFile, JSON.stringify(exportPayload, null, 2), 'utf8');

  console.log('✅ 저장 완료!');
  console.log('- 타겟 경로: ' + targetFile + ' (' + (fs.statSync(targetFile).size / 1024).toFixed(1) + ' KB)');
  console.log('- 로컬 백업: ' + localBackupFile);
}

main().catch(err => {
  console.error('오류 발생:', err);
  process.exit(1);
});
