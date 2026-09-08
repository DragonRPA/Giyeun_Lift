// src/services/permissionMigrationService.ts
import { supabase, db, MenuPermission, User, Department, createMenuPermission } from './db';
import { getAllSystemMenuIds, normalizeMenuId } from '../config/menu_config';
import { getRoleTemplatePermission } from '../config/role_templates';

export interface UserPermissionSummary {
  userId: string;
  loginId: string;
  name: string;
  departmentName: string;
  role: string;
  totalPerms: number;
  viewPermsCount: number;
  savePermsCount: number;
  sampleAllowedMenus: string[];
}

export interface ParsedPermissionData {
  metadata?: {
    system?: string;
    title?: string;
    exportedAt?: string;
    exportedDateText?: string;
    totalUsers?: number;
    totalPermissions?: number;
    description?: string;
  };
  totalPermissions: number;
  matchedUsersCount: number;
  unmatchedRecordsCount: number;
  unmatchedUsers: string[];
  userSummaries: UserPermissionSummary[];
  validPermissions: MenuPermission[];
}

/**
 * 권한 JSON 텍스트를 파싱하여 현재 시스템 사용자(users)와 정확히 1:1 매핑
 * - 임의 추정/기본값 덮어쓰기 전면 배제
 * - 파일에 명시된 canView, canSave 값을 100% 무결하게 보존
 */
export function parsePermissionJson(rawJsonText: string, currentUsers: User[], currentDepartments: Department[] = []): ParsedPermissionData {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch (err: any) {
    throw new Error(`JSON 파싱 오류: 올바른 JSON 형식이 아닙니다. (${err.message})`);
  }

  // 부서 맵 생성
  const deptMap = new Map<string, string>();
  if (currentDepartments && currentDepartments.length > 0) {
    currentDepartments.forEach(d => deptMap.set(d.id, d.name));
  }
  // 파일 내부에 departments가 명시되어 있다면 보강
  if (parsed.departments && Array.isArray(parsed.departments)) {
    parsed.departments.forEach((d: any) => {
      if (d && d.id && d.name && !deptMap.has(d.id)) {
        deptMap.set(d.id, d.name);
      }
    });
  }

  // 사용자 색인 (id, loginId, name)
  const userById = new Map<string, User>();
  const userByLoginId = new Map<string, User>();
  const userByName = new Map<string, User>();

  currentUsers.forEach(u => {
    if (u.id) userById.set(u.id, u);
    if (u.loginId) userByLoginId.set(u.loginId, u);
    if (u.name) userByName.set(u.name, u);
  });

  const matchedUserIds = new Set<string>();
  const unmatchedUsersList: string[] = [];
  let unmatchedRecordsCount = 0;
  const permissionMap = new Map<string, MenuPermission>(); // key: `${userId}__${menuId}`

  const nowIso = new Date().toISOString();

  // 케이스 1: 구조화된 format ({ metadata, users: [ { userId, name, permissions: [...] } ], rawPermissions })
  if (parsed.users && Array.isArray(parsed.users) && parsed.users.length > 0 && parsed.users[0].permissions) {
    for (const uItem of parsed.users) {
      // 1. 매칭 시도: userId -> loginId -> name 순
      const matched = userById.get(uItem.userId) ||
                      (uItem.loginId ? userByLoginId.get(uItem.loginId) : undefined) ||
                      (uItem.name ? userByName.get(uItem.name) : undefined);

      if (!matched) {
        unmatchedUsersList.push(uItem.name || uItem.loginId || uItem.userId || '미상');
        unmatchedRecordsCount += (uItem.permissions?.length || 0);
        continue;
      }

      matchedUserIds.add(matched.id);

      if (Array.isArray(uItem.permissions)) {
        for (const p of uItem.permissions) {
          if (!p.menuId) continue;
          const key = `${matched.id}__${p.menuId}`;
          const permId = p.id || `perm-${matched.id}-${p.menuId}`;
          permissionMap.set(key, {
            id: permId,
            userId: matched.id,
            menuId: String(p.menuId).trim(),
            canView: Boolean(p.canView),
            canSave: Boolean(p.canSave),
            createdAt: p.createdAt || nowIso,
            updatedAt: nowIso
          });
        }
      }
    }
  } else {
    // 케이스 2: rawPermissions 단일 배열 또는 최상위 배열 또는 { permissions: [...] }
    let rawList: any[] = [];
    if (Array.isArray(parsed)) {
      rawList = parsed;
    } else if (Array.isArray(parsed.rawPermissions)) {
      rawList = parsed.rawPermissions;
    } else if (Array.isArray(parsed.permissions)) {
      rawList = parsed.permissions;
    }

    for (const p of rawList) {
      if (!p || !p.menuId) continue;
      const uid = p.userId || p.user_id;
      const matched = uid ? (userById.get(uid) || userByLoginId.get(uid) || userByName.get(uid)) : undefined;

      if (!matched) {
        unmatchedRecordsCount++;
        continue;
      }

      matchedUserIds.add(matched.id);
      const key = `${matched.id}__${p.menuId}`;
      const permId = p.id || `perm-${matched.id}-${p.menuId}`;
      permissionMap.set(key, {
        id: permId,
        userId: matched.id,
        menuId: String(p.menuId).trim(),
        canView: Boolean(p.canView),
        canSave: Boolean(p.canSave),
        createdAt: p.createdAt || nowIso,
        updatedAt: nowIso
      });
    }
  }

  const validPermissions = Array.from(permissionMap.values());

  // 사용자별 요약 통계 집계
  const userSummaries: UserPermissionSummary[] = [];
  matchedUserIds.forEach(uid => {
    const user = userById.get(uid);
    if (!user) return;

    const userPerms = validPermissions.filter(p => p.userId === uid);
    const viewPerms = userPerms.filter(p => p.canView);
    const savePerms = userPerms.filter(p => p.canSave);
    const deptName = (user.departmentId ? deptMap.get(user.departmentId) : '') || user.department || '-';

    userSummaries.push({
      userId: user.id,
      loginId: user.loginId || user.id,
      name: user.name,
      departmentName: deptName,
      role: user.role,
      totalPerms: userPerms.length,
      viewPermsCount: viewPerms.length,
      savePermsCount: savePerms.length,
      sampleAllowedMenus: viewPerms.slice(0, 5).map(p => p.menuId)
    });
  });

  // 이름순 정렬
  userSummaries.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return {
    metadata: parsed.metadata,
    totalPermissions: validPermissions.length,
    matchedUsersCount: matchedUserIds.size,
    unmatchedRecordsCount,
    unmatchedUsers: Array.from(new Set(unmatchedUsersList)),
    userSummaries,
    validPermissions
  };
}

/**
 * 파싱된 권한 데이터를 Supabase와 로컬 DB에 일괄 정확 동기화
 */
export async function ingestPermissionsToDatabase(
  parsedData: ParsedPermissionData,
  onProgress?: (step: number, total: number, message: string) => void
): Promise<{ success: boolean; count: number; userCount: number; message: string }> {
  const { validPermissions, matchedUsersCount } = parsedData;

  if (!validPermissions || validPermissions.length === 0) {
    throw new Error('적재할 유효한 권한 데이터가 없습니다.');
  }

  const total = validPermissions.length;
  onProgress?.(0, total, `권한 데이터 일괄 적재 시작 (총 ${total}건, 대상 ${matchedUsersCount}명)...`);

  // 1. Supabase 업서트 (배치 100건씩 분할 전송)
  if (supabase) {
    const BATCH_SIZE = 100;
    const nowIso = new Date().toISOString();

    for (let i = 0; i < validPermissions.length; i += BATCH_SIZE) {
      const chunk = validPermissions.slice(i, i + BATCH_SIZE).map(p => ({
        id: p.id,
        userId: p.userId,
        menuId: p.menuId,
        canView: p.canView,
        canSave: p.canSave,
        role: (p as any).role || 'USER',
        createdAt: p.createdAt || nowIso,
        updatedAt: nowIso
      }));

      onProgress?.(i, total, `Supabase 권한 적재 중 (${i + 1} ~ ${Math.min(i + BATCH_SIZE, total)} / ${total}건)...`);

      const { error } = await supabase.from('permissions').upsert(chunk, { onConflict: 'id' });
      if (error) {
        throw new Error(`Supabase permissions 업서트 실패: ${error.message} (코드: ${error.code})`);
      }
    }
  }

  // 2. 로컬 메모리/IndexedDB 동기화
  onProgress?.(total, total, '로컬 DB 캐시 동기화 및 무결성 검증 중...');

  // 기존 db.permissions에서 이번에 갱신된 대상 외 권한 유지하며 병합
  const existingMap = new Map<string, MenuPermission>();
  (db.permissions || []).forEach(p => {
    existingMap.set(`${p.userId}__${p.menuId}`, p);
  });

  validPermissions.forEach(p => {
    existingMap.set(`${p.userId}__${p.menuId}`, p);
  });

  db.permissions = Array.from(existingMap.values());
  await db.awaitPendingWrites();

  const successMessage = `임직원 ${matchedUsersCount}명 총 ${total}건의 권한 데이터가 정확하게 동기화되었습니다.`;

  return {
    success: true,
    count: total,
    userCount: matchedUsersCount,
    message: successMessage
  };
}

/**
 * 현재 시스템의 모든 임직원 권한 데이터를 표준 JSON 포맷으로 생성
 */
export function generatePermissionExportPayload(
  currentPermissions: MenuPermission[],
  currentUsers: User[],
  currentDepartments: Department[] = []
): object {
  const deptMap = new Map<string, string>();
  currentDepartments.forEach(d => deptMap.set(d.id, d.name));

  const userPermMap = new Map<string, MenuPermission[]>();
  currentPermissions.forEach(p => {
    if (!userPermMap.has(p.userId)) {
      userPermMap.set(p.userId, []);
    }
    userPermMap.get(p.userId)!.push(p);
  });

  const structuredUsers = currentUsers.map(u => {
    const uPerms = userPermMap.get(u.id) || [];
    uPerms.sort((a, b) => a.menuId.localeCompare(b.menuId));

    return {
      userId: u.id,
      loginId: u.loginId || u.id,
      name: u.name,
      role: u.role,
      departmentId: u.departmentId || '',
      departmentName: (u.departmentId ? deptMap.get(u.departmentId) : '') || u.department || '',
      permissionsCount: uPerms.length,
      permissions: uPerms.map(p => ({
        id: p.id,
        menuId: p.menuId,
        canView: p.canView,
        canSave: p.canSave,
        role: (p as any).role || u.role || 'USER',
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    };
  });

  return {
    metadata: {
      system: '기연리프트 ERP 시스템',
      title: '임직원 권한 마스터 데이터',
      exportedAt: new Date().toISOString(),
      exportedDateText: new Date().toISOString().slice(0, 10),
      totalUsers: currentUsers.length,
      totalDepartments: currentDepartments.length,
      totalPermissions: currentPermissions.length,
      description: '임직원별 메뉴 조회(canView) 및 저장(canSave) 권한 정밀 스냅샷'
    },
    departments: currentDepartments.map(d => ({
      id: d.id,
      name: d.name,
      parentDepartmentId: d.parentDepartmentId || null
    })),
    users: structuredUsers,
    rawPermissions: currentPermissions
  };
}

// ────────────────────────────────────────────────────────────
// 직무 템플릿 기반 전 임직원 권한 일괄 자동 생성 (신규 시스템 초기 세팅용)
// ────────────────────────────────────────────────────────────

export interface GenerateDefaultPermsResult {
  success: boolean;
  count: number;
  userCount: number;
  message: string;
}

/**
 * 현재 DB의 전 임직원을 직무 템플릿(role_templates.ts)으로 순회하여
 * 모든 SYSTEM_MENU_CONFIG 메뉴 ID에 대한 기본 권한을 일괄 생성 후 DB에 적재.
 * - 이미 개인 오버라이드가 있는 항목은 덮어쓰지 않음 (merge 방식).
 * - agent_badge 포함 신규 추가된 menuId도 자동 반영됨 (SYSTEM_MENU_CONFIG SSOT 기반).
 */
export async function generateDefaultPermissionsForAllUsers(
  onProgress?: (step: number, total: number, message: string) => void
): Promise<GenerateDefaultPermsResult> {
  const currentUsers: User[] = db.users || [];
  if (currentUsers.length === 0) {
    throw new Error('생성할 임직원 데이터가 없습니다. 먼저 사용자 데이터를 업로드하세요.');
  }

  const allMenuIds = getAllSystemMenuIds();
  const nowIso = new Date().toISOString();
  const total = currentUsers.length * allMenuIds.length;
  let step = 0;

  onProgress?.(0, total, `전 임직원 ${currentUsers.length}명 × ${allMenuIds.length}개 메뉴 권한 자동 생성 시작...`);

  // 기존 개인 오버라이드 보존을 위한 맵
  const existingMap = new Map<string, MenuPermission>();
  (db.permissions || []).forEach(p => {
    existingMap.set(`${p.userId}__${normalizeMenuId(p.menuId)}`, p);
  });

  const generatedPerms: MenuPermission[] = [];

  for (const user of currentUsers) {
    const isAdmin = user.role === 'ADMIN' || user.loginId === 'admin';
    const dept = user.departmentId || user.department || '';

    for (const menuId of allMenuIds) {
      step++;
      const normId = normalizeMenuId(menuId);
      const key = `${user.id}__${normId}`;

      // 이미 개인 오버라이드가 있으면 건너뜀 (기존 설정 존중)
      if (existingMap.has(key)) {
        generatedPerms.push(existingMap.get(key)!);
        continue;
      }

      const canView = isAdmin ? true : (getRoleTemplatePermission(user.role, dept, normId, 'view') ?? false);
      const canSave  = isAdmin ? true : (getRoleTemplatePermission(user.role, dept, normId, 'save') ?? false);

      const perm = createMenuPermission(user.id, normId, canView, canSave);
      generatedPerms.push({ ...perm, createdAt: nowIso, updatedAt: nowIso });
      existingMap.set(key, generatedPerms[generatedPerms.length - 1]);

      if (step % 50 === 0) {
        onProgress?.(step, total, `권한 생성 중 (${step}/${total})...`);
      }
    }
  }

  onProgress?.(total, total, 'Supabase 업서트 및 로컬 DB 동기화 중...');

  // Supabase 업서트
  if (supabase) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < generatedPerms.length; i += BATCH_SIZE) {
      const chunk = generatedPerms.slice(i, i + BATCH_SIZE).map(p => ({
        id: p.id,
        userId: p.userId,
        menuId: p.menuId,
        canView: p.canView,
        canSave: p.canSave,
        role: (p as any).role || 'USER',
        createdAt: p.createdAt || nowIso,
        updatedAt: nowIso
      }));
      const { error } = await supabase.from('permissions').upsert(chunk, { onConflict: 'id' });
      if (error) throw new Error(`Supabase 권한 업서트 실패: ${error.message}`);
    }
  }

  // 로컬 DB 동기화
  db.permissions = generatedPerms;
  await db.awaitPendingWrites();

  const msg = `임직원 ${currentUsers.length}명의 전체 메뉴(${allMenuIds.length}개) 권한을 직무 템플릿 기준으로 자동 생성 완료 (총 ${generatedPerms.length}건).`;
  return { success: true, count: generatedPerms.length, userCount: currentUsers.length, message: msg };
}
