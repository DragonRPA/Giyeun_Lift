/**
 * scripts/backup_permissions.mjs
 * Supabase에서 최신 권한/사용자/부서 데이터를 직접 풀해서
 * scripts/backup/사용자권한_마스터_YYYYMMDD.json 으로 저장하는 스크립트.
 *
 * 실행: node scripts/backup_permissions.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://wywgkikkjgbnlljkkmnz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d2draWtramdibmxsamtrbW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjcxMzgsImV4cCI6MjA5OTk0MzEzOH0.gSftxhQjFmWUQzikx-Q5UsdgNKSZISZqJvUGeLBOCqU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function fetchAll(table) {
  let allRows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`[${table}] fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function main() {
  console.log('📡 Supabase에서 권한/사용자/부서 데이터 풀 중...');

  const [permissions, users, departments] = await Promise.all([
    fetchAll('permissions'),
    fetchAll('users'),
    fetchAll('departments'),
  ]);

  console.log(`✅ permissions: ${permissions.length}건, users: ${users.length}명, departments: ${departments.length}개`);

  const now = new Date();
  const exportedAt = now.toISOString();
  const dateText = exportedAt.slice(0, 10);
  const dateStamp = dateText.replace(/-/g, '');

  const deptList = departments.map(d => ({ id: d.id, name: d.name }));

  const permsByUser = {};
  for (const p of permissions) {
    if (!permsByUser[p.userId]) permsByUser[p.userId] = [];
    permsByUser[p.userId].push({ menuId: p.menuId, canView: p.canView, canSave: p.canSave });
  }

  const DEPT_ORDER = {
    'DEPT-0000001': 0, 'DEPT-0000002': 1, 'DEPT-0000003': 2,
    'DEPT-0000004': 3, 'DEPT-0000005': 4,
  };

  const sortedUsers = [...users].sort((a, b) => {
    const oa = DEPT_ORDER[a.departmentId] ?? 99;
    const ob = DEPT_ORDER[b.departmentId] ?? 99;
    if (oa !== ob) return oa - ob;
    return (a.name || '').localeCompare(b.name || '', 'ko');
  });

  const usersWithPerms = sortedUsers.map(u => ({
    userId: u.id,
    loginId: u.loginId,
    name: u.name,
    role: u.role,
    departmentId: u.departmentId || null,
    department: u.department || null,
    position: u.position || null,
    permissions: (permsByUser[u.id] || []).sort((a, b) => a.menuId.localeCompare(b.menuId)),
  }));

  const payload = {
    metadata: {
      system: '기연리프트 ERP 시스템',
      title: '임직원 권한 마스터 데이터',
      exportedAt,
      exportedDateText: dateText,
      totalUsers: users.length,
      totalDepartments: departments.length,
      totalPermissions: permissions.length,
      description: `조정 완료된 ${users.length}명 임직원의 메뉴별 조회(canView) 및 저장(canSave) 권한 정밀 스냅샷`,
    },
    departments: deptList,
    users: usersWithPerms,
  };

  const fileName = `사용자권한_마스터_${dateStamp}.json`;
  const backupDir = path.join(__dirname, 'backup');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const outPath = path.join(backupDir, fileName);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`\n💾 백업 저장 완료: scripts/backup/${fileName}`);
  console.log(`   - 임직원: ${users.length}명`);
  console.log(`   - 권한 레코드: ${permissions.length}건`);
  console.log(`   - 부서: ${departments.length}개`);
  console.log(`   - 시각: ${exportedAt}`);
}

main().catch(err => {
  console.error('❌ 오류 발생:', err);
  process.exit(1);
});

