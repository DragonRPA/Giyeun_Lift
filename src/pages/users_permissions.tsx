// src/pages/users_permissions.tsx
// 권한 관리 체계: 관리자 정의 권한 명칭(CustomRole) 생성 및 직원 권한 자동 상속 스튜디오
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Shield, Check, Lock, Save, FolderKanban, ChevronDown, ChevronRight, 
  Download, Plus, Trash2, Key, Users, CheckSquare, Square, Eye, Edit3, AlertCircle, Info
} from 'lucide-react';
import { MenuPermission, User, CustomRole, RolePermission, createMenuPermission, db, Department } from '../services/db';
import { exportToExcel } from '../services/excel';
import { SYSTEM_MENU_CONFIG, getAllSystemMenuIds, MenuGroupConfig, normalizeMenuId } from '../config/menu_config';

export type MenuCategoryGroup = MenuGroupConfig;
export const MENU_CATEGORIES = SYSTEM_MENU_CONFIG;

export const UsersPermissions: React.FC = () => {
  const { 
    users, permissions, updatePermissions, saveUser, currentUser, hasPermission, showErrorModal,
    customRoles, rolePermissions, saveCustomRole, deleteCustomRole, saveRolePermissions, assignUserRole 
  } = useApp();

  const isSuperAdmin = currentUser?.id === 'u-1' || currentUser?.id === 'sys-admin';
  const canSave = hasPermission('permission', 'save');

  // 상단 메인 탭 ('ROLES': 권한 명칭 정의 마스터 | 'USERS': 직원 권한 상속 배정)
  const [activeTab, setActiveTab] = useState<'ROLES' | 'USERS'>('ROLES');

  // 🔔 인앱 토스트 알림
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ─── [탭 1: 권한 명칭 관리 (CustomRole Master)] 상태 ───
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [workingRolePerms, setWorkingRolePerms] = useState<Record<string, { canView: boolean; canSave: boolean }>>({});
  const [isRoleDirty, setIsRoleDirty] = useState(false);
  const [collapsedRoleGroups, setCollapsedRoleGroups] = useState<Record<string, boolean>>({});

  // ─── [탭 2: 직원 권한 상속 배정 (User Mapping)] 상태 ───
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterRole, setFilterRole] = useState('ALL');
  const [previewUser, setPreviewUser] = useState<User | null>(null);
  const [showGhostModal, setShowGhostModal] = useState(false);

  // 기본 권한 선택
  useEffect(() => {
    if (customRoles.length > 0 && !selectedRoleId) {
      setSelectedRoleId(customRoles[0].id);
    }
  }, [customRoles, selectedRoleId]);

  // 선택된 권한 변경 시 작업용 권한 맵 동기화
  useEffect(() => {
    if (!selectedRoleId) return;
    const map: Record<string, { canView: boolean; canSave: boolean }> = {};
    const allMenuIds = getAllSystemMenuIds();
    
    // 전체 메뉴 기본 false 초기화
    allMenuIds.forEach(mId => {
      const norm = normalizeMenuId(mId);
      map[norm] = { canView: false, canSave: false };
    });

    // DB에 등록된 해당 role의 permissions 덮어쓰기
    rolePermissions
      .filter(p => p.roleId === selectedRoleId)
      .forEach(p => {
        const norm = normalizeMenuId(p.menuId);
        map[norm] = { canView: Boolean(p.canView), canSave: Boolean(p.canSave) };
      });

    // 기본 공통 메뉴는 상시 조회 허용
    map['dashboard'] = { canView: true, canSave: false };
    map['leave_application'] = { canView: true, canSave: true };
    map['vehicle_log'] = { canView: true, canSave: true };

    setWorkingRolePerms(map);
    setIsRoleDirty(false);
  }, [selectedRoleId, rolePermissions]);

  // 임직원 소속 부서 매핑
  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    (db.departments || []).forEach(d => {
      if (d.id && d.name) map.set(d.id, d.name);
    });
    return map;
  }, []);

  const getDeptName = (u: User): string => {
    if (u.departmentId && departmentMap.has(u.departmentId)) {
      return departmentMap.get(u.departmentId)!;
    }
    if (u.department && u.department.trim()) return u.department.trim();
    if (u.departmentId) {
      const dId = u.departmentId.toUpperCase();
      if (dId.includes('0000001') || dId === 'DEPT-1') return '경영진';
      if (dId.includes('0000002') || dId === 'DEPT-2') return '관리부';
      if (dId.includes('0000003') || dId === 'DEPT-3') return '영업팀';
      if (dId.includes('0000004') || dId === 'DEPT-4') return '출고팀';
      if (dId.includes('0000005') || dId === 'DEPT-5') return 'AS팀';
    }
    return '미배정';
  };

  // 테스터 제외 실사용자 목록
  const activeUsers = useMemo(() => {
    return users.filter(u => 
      !u.id?.startsWith('usr-tester') &&
      !u.name?.includes('테스터') &&
      !u.loginId?.includes('tester')
    );
  }, [users]);

  // 권한별 상속 인원 수 집계
  const roleUserCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    customRoles.forEach(r => { map[r.id] = 0; });
    activeUsers.forEach(u => {
      if (u.customRoleId && map[u.customRoleId] !== undefined) {
        map[u.customRoleId]++;
      }
    });
    return map;
  }, [customRoles, activeUsers]);

  const selectedRole = useMemo(() => {
    return customRoles.find(r => r.id === selectedRoleId) || customRoles[0];
  }, [customRoles, selectedRoleId]);

  // ── [액션 1: 신규 권한 명칭 추가] ──
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const name = newRoleName.trim();
    if (!name) {
      showToast('권한 명칭을 입력해 주십시오.', 'error');
      return;
    }
    // 중복 체크
    if (customRoles.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      showToast('이미 동일한 이름의 권한 명칭이 존재합니다.', 'error');
      return;
    }

    const newId = `role_${Date.now()}`;
    const newRole: CustomRole = {
      id: newId,
      name,
      description: newRoleDesc.trim() || undefined,
      isSystem: false,
      createdAt: new Date().toISOString()
    };

    try {
      await saveCustomRole(newRole);
      // 기본 공통 메뉴 권한 자동 주입
      await saveRolePermissions(newId, [
        { menuId: 'dashboard', canView: true, canSave: false },
        { menuId: 'leave_application', canView: true, canSave: true },
        { menuId: 'vehicle_log', canView: true, canSave: true }
      ]);
      setNewRoleName('');
      setNewRoleDesc('');
      setSelectedRoleId(newId);
      showToast(`신규 권한 [${name}] 등록이 완료되었습니다.`);
    } catch (err: any) {
      showErrorModal(`권한 등록 실패: ${err?.message || err}`);
    }
  };

  // ── [액션 2: 권한 명칭 삭제] ──
  const handleDeleteRole = async (role: CustomRole) => {
    if (!canSave) return;
    if (role.isSystem) {
      showToast('시스템 기본 권한은 삭제할 수 없습니다.', 'error');
      return;
    }
    const count = roleUserCountMap[role.id] || 0;
    if (count > 0) {
      showToast(`해당 권한을 상속받은 직원이 ${count}명 존재합니다. 직원들의 권한을 먼저 변경해 주십시오.`, 'error');
      return;
    }

    try {
      await deleteCustomRole(role.id);
      if (selectedRoleId === role.id) {
        setSelectedRoleId(customRoles.find(r => r.id !== role.id)?.id || '');
      }
      showToast(`[${role.name}] 권한이 삭제되었습니다.`);
    } catch (err: any) {
      showErrorModal(`권한 삭제 실패: ${err?.message || err}`);
    }
  };

  // ── [액션 3: 단일 메뉴 권한 토글 (선택된 권한)] ──
  const handleRolePermToggle = (menuId: string, type: 'view' | 'save') => {
    if (!canSave || !selectedRoleId) return;
    const norm = normalizeMenuId(menuId);

    // 공통 연차신청은 필수
    if (norm === 'leave_application') {
      showToast('연차신청은 모든 임직원의 기본 공통 기능으로 항상 활성화됩니다.');
      return;
    }

    setWorkingRolePerms(prev => {
      const cur = prev[norm] || { canView: false, canSave: false };
      let nextView = cur.canView;
      let nextSave = cur.canSave;

      if (type === 'view') {
        nextView = !cur.canView;
        if (!nextView) nextSave = false; // 조회 끄면 저장도 자동 OFF
      } else {
        nextSave = !cur.canSave;
        if (nextSave) nextView = true;  // 저장 켜면 조회도 자동 ON
      }

      const updated = { ...prev, [norm]: { canView: nextView, canSave: nextSave } };

      // 급여 정산(payroll) 토글 시 연차관리(leave_management) 자동 동기화
      if (norm === 'payroll') {
        updated['leave_management'] = { canView: nextView, canSave: nextSave };
      }

      return updated;
    });
    setIsRoleDirty(true);
  };

  // ── [액션 4: 카테고리 일괄 토글 (선택된 권한)] ──
  const handleCategoryBulkToggle = (grp: MenuCategoryGroup, type: 'view' | 'save') => {
    if (!canSave || !selectedRoleId) return;

    const allChecked = grp.items.every(item => {
      const norm = normalizeMenuId(item.id);
      const perm = workingRolePerms[norm];
      return type === 'view' ? perm?.canView : perm?.canSave;
    });

    const targetVal = !allChecked;

    setWorkingRolePerms(prev => {
      const updated = { ...prev };
      grp.items.forEach(item => {
        const norm = normalizeMenuId(item.id);
        if (norm === 'leave_application') {
          updated[norm] = { canView: true, canSave: true };
          return;
        }
        const cur = prev[norm] || { canView: false, canSave: false };
        if (type === 'view') {
          const nextView = targetVal;
          const nextSave = nextView ? cur.canSave : false;
          updated[norm] = { canView: nextView, canSave: nextSave };
        } else {
          const nextSave = targetVal;
          const nextView = nextSave ? true : cur.canView;
          updated[norm] = { canView: nextView, canSave: nextSave };
        }

        if (norm === 'payroll') {
          updated['leave_management'] = updated[norm];
        }
      });
      return updated;
    });
    setIsRoleDirty(true);
  };

  // ── [액션 5: 전체 메뉴 일괄 토글 (선택된 권한)] ──
  const handleAllMenusBulkToggle = (type: 'view' | 'save' | 'off') => {
    if (!canSave || !selectedRoleId) return;
    const allItems = MENU_CATEGORIES.flatMap(g => g.items);

    setWorkingRolePerms(prev => {
      const updated = { ...prev };
      allItems.forEach(item => {
        const norm = normalizeMenuId(item.id);
        if (norm === 'leave_application') {
          updated[norm] = { canView: true, canSave: true };
          return;
        }
        if (type === 'off') {
          updated[norm] = { canView: false, canSave: false };
        } else if (type === 'view') {
          updated[norm] = { canView: true, canSave: prev[norm]?.canSave || false };
        } else if (type === 'save') {
          updated[norm] = { canView: true, canSave: true };
        }
      });
      return updated;
    });
    setIsRoleDirty(true);
  };

  // ── [액션 6: 권한 설정 저장 (역할별 권한 확정 및 전 직원 실시간 상속)] ──
  const handleSaveRolePermissions = async () => {
    if (!canSave || !selectedRoleId) return;
    const permsArray = Object.entries(workingRolePerms).map(([menuId, p]) => ({
      menuId,
      canView: p.canView,
      canSave: p.canSave
    }));

    try {
      await saveRolePermissions(selectedRoleId, permsArray);
      setIsRoleDirty(false);
      const inheritedCount = roleUserCountMap[selectedRoleId] || 0;
      showToast(`[${selectedRole?.name || '권한'}] 설정 저장 완료 (상속 직원 ${inheritedCount}명 실시간 적용)`);
    } catch (err: any) {
      showErrorModal(`권한 저장 실패: ${err?.message || err}`);
    }
  };

  // ── [액션 7: 직원에게 권한 명칭 상속 배정 (Tab 2)] ──
  const handleAssignUserRole = async (userId: string, roleId: string) => {
    if (!canSave) return;
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) return;

    if (userId === 'u-1' || userId === 'sys-admin') {
      showToast('개발자 계정의 권한은 변경할 수 없습니다.', 'error');
      return;
    }

    try {
      await assignUserRole(userId, roleId || null);
      const roleName = customRoles.find(r => r.id === roleId)?.name || '권한 미지정';
      showToast(`${targetUser.name} 님에게 [${roleName}] 권한이 상속 배정되었습니다.`);
    } catch (err: any) {
      showErrorModal(`권한 상속 배정 실패: ${err?.message || err}`);
    }
  };

  // ── [액션 8: 직원 시스템 등급(Role) 변경 (ADMIN / USER)] ──
  const handleUserGradeChange = async (userId: string, newRole: string) => {
    if (!canSave) return;
    if (userId === 'u-1' || userId === 'sys-admin') {
      showToast('개발자 계정의 시스템 등급은 변경할 수 없습니다.', 'error');
      return;
    }
    if (newRole === 'ADMIN' && !isSuperAdmin) {
      showToast('ADMIN 등급 승인은 최고관리자 계정만 가능합니다.', 'error');
      return;
    }
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) return;

    try {
      await saveUser({ ...targetUser, role: newRole as any });
      await db.awaitPendingWrites();
      showToast(`${targetUser.name} 님의 시스템 등급이 [${newRole}] (으)로 변경되었습니다.`);
    } catch (err: any) {
      showErrorModal(`등급 변경 실패: ${err?.message || err}`);
    }
  };

  // 직원 목록 필터링
  const filteredUsers = useMemo(() => {
    return activeUsers.filter(u => {
      const matchText = !searchTerm || 
        u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.loginId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.position?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getDeptName(u).toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchText) return false;

      if (filterDept !== 'ALL') {
        const dName = getDeptName(u);
        if (dName !== filterDept) return false;
      }

      if (filterRole !== 'ALL') {
        if (filterRole === 'NONE' && u.customRoleId) return false;
        if (filterRole !== 'NONE' && u.customRoleId !== filterRole) return false;
      }

      return true;
    });
  }, [activeUsers, searchTerm, filterDept, filterRole, departmentMap]);

  // 상속된 권한 메뉴 요약 헬퍼
  const getUserInheritedMenus = (u: User) => {
    if (u.role === 'ADMIN') return { total: '전체 (관리자)', preview: '전 메뉴 허용' };
    if (!u.customRoleId) return { total: '0개', preview: '권한 미지정' };
    const perms = rolePermissions.filter(p => p.roleId === u.customRoleId && (p.canView || p.canSave));
    const allItems = MENU_CATEGORIES.flatMap(g => g.items);
    const names = perms.map(p => allItems.find(i => normalizeMenuId(i.id) === normalizeMenuId(p.menuId))?.name || p.menuId);
    return {
      total: `${perms.length}개 메뉴`,
      preview: names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}개` : '')
    };
  };

  // 엑셀 내보내기
  const handleExportExcel = () => {
    const rows = filteredUsers.map((u, idx) => {
      const roleObj = customRoles.find(r => r.id === u.customRoleId);
      const summary = getUserInheritedMenus(u);
      return {
        'NO': idx + 1,
        '사번/ID': u.loginId || u.id,
        '성명': u.name,
        '소속부서': getDeptName(u),
        '직급': u.position || '-',
        '시스템등급': u.role,
        '상속권한명칭': roleObj?.name || '미지정',
        '허용메뉴수': summary.total,
        '주요허용메뉴': summary.preview
      };
    });
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    exportToExcel(rows, `임직원_권한_상속대장_${dateStr}`, '권한대장');
  };

  return (
    <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 🔔 인앱 토스트 */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          padding: '10px 18px',
          borderRadius: '6px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : '#10b981',
          color: '#ffffff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          fontWeight: 700,
          fontSize: '13px'
        }}>
          {toastMessage.text}
        </div>
      )}

      {/* ─── 최상단: 타이틀 & 탭 전환 바 ─── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        paddingBottom: '12px',
        borderBottom: '1px solid var(--border-color, #e2e8f0)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '8px',
            backgroundColor: 'var(--primary, #4f46e5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff'
          }}>
            <Shield size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
              권한 관리
            </h1>
            <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>
              권한 명칭 정의 및 직원 권한 자동 상속 스튜디오
            </span>
          </div>
        </div>

        {/* 2대 탭 세그먼트 버튼 */}
        <div style={{
          display: 'flex',
          backgroundColor: 'var(--bg-secondary, #f1f5f9)',
          borderRadius: '8px',
          padding: '4px',
          gap: '4px'
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('ROLES')}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: activeTab === 'ROLES' ? 700 : 500,
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'ROLES' ? 'var(--bg-card, #ffffff)' : 'transparent',
              color: activeTab === 'ROLES' ? 'var(--primary, #4f46e5)' : 'var(--text-secondary, #475569)',
              boxShadow: activeTab === 'ROLES' ? '0 1px 3px rgba(0, 0, 0, 0.1)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap'
            }}
          >
            <Key size={15} />
            권한 명칭 관리 (역할 정의)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('USERS')}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: activeTab === 'USERS' ? 700 : 500,
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'USERS' ? 'var(--bg-card, #ffffff)' : 'transparent',
              color: activeTab === 'USERS' ? 'var(--primary, #4f46e5)' : 'var(--text-secondary, #475569)',
              boxShadow: activeTab === 'USERS' ? '0 1px 3px rgba(0, 0, 0, 0.1)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap'
            }}
          >
            <Users size={15} />
            직원 권한 상속 배정
          </button>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════
          탭 1: 권한 명칭 관리 (Master Studio)
          ═════════════════════════════════════════════════════════════════ */}
      {activeTab === 'ROLES' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '16px', alignItems: 'start' }}>
          {/* 좌측 패널: 권한 명칭 생성 및 목록 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* 신규 권한 등록 폼 */}
            {canSave && (
              <form onSubmit={handleCreateRole} style={{
                backgroundColor: 'var(--bg-card, #ffffff)',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main, #0f172a)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={15} color="var(--primary, #4f46e5)" />
                  신규 권한 명칭 등록
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                    권한 명칭 (자유입력)
                  </label>
                  <input
                    type="text"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="예: 영업팀장, 현장출고원, 자산경리"
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      backgroundColor: 'var(--bg-card, #ffffff)',
                      color: 'var(--text-main, #0f172a)',
                      outline: 'none'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                    권한 설명 (선택)
                  </label>
                  <input
                    type="text"
                    value={newRoleDesc}
                    onChange={(e) => setNewRoleDesc(e.target.value)}
                    placeholder="예: 영업 계약 및 고객 관리 총괄"
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      backgroundColor: 'var(--bg-card, #ffffff)',
                      color: 'var(--text-main, #0f172a)',
                      outline: 'none'
                    }}
                  />
                </div>
                <button
                  type="submit"
                  style={{
                    marginTop: '2px',
                    padding: '7px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'var(--primary, #4f46e5)',
                    color: '#ffffff',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  권한 명칭 생성
                </button>
              </form>
            )}

            {/* 권한 명칭 목록 카드 리스트 */}
            <div style={{
              backgroundColor: 'var(--bg-card, #ffffff)',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #cbd5e1)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-secondary, #f8fafc)',
                borderBottom: '1px solid var(--border-color, #e2e8f0)',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--text-secondary, #475569)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>등록된 권한 명칭 ({customRoles.length})</span>
              </div>

              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {customRoles.map(role => {
                  const isSelected = role.id === selectedRoleId;
                  const count = roleUserCountMap[role.id] || 0;
                  return (
                    <div
                      key={role.id}
                      onClick={() => setSelectedRoleId(role.id)}
                      style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--border-color, #f1f5f9)',
                        backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                        borderLeft: isSelected ? '4px solid var(--primary, #4f46e5)' : '4px solid transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <strong style={{ fontSize: '13px', color: isSelected ? 'var(--primary, #4f46e5)' : 'var(--text-main, #0f172a)' }}>
                          {role.name}
                        </strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            padding: '1px 6px',
                            borderRadius: '10px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: count > 0 ? '#dbeafe' : '#f1f5f9',
                            color: count > 0 ? '#1d4ed8' : '#64748b'
                          }}>
                            {count}명 상속
                          </span>
                          {!role.isSystem && canSave && count === 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRole(role);
                              }}
                              title="권한 삭제"
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '2px',
                                color: '#ef4444'
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      {role.description && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted, #64748b)' }}>
                          {role.description}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 우측 패널: 선택된 권한의 메뉴별 권한 설정 매트릭스 */}
          <div style={{
            backgroundColor: 'var(--bg-card, #ffffff)',
            borderRadius: '8px',
            border: '1px solid var(--border-color, #cbd5e1)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* 권한 헤더 & 일괄 설정 바 */}
            <div style={{
              padding: '12px 18px',
              backgroundColor: 'var(--bg-secondary, #f8fafc)',
              borderBottom: '1px solid var(--border-color, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Key size={16} color="var(--primary, #4f46e5)" />
                <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
                  [{selectedRole?.name}] 메뉴 권한 매트릭스
                </h2>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  backgroundColor: '#e0e7ff',
                  color: '#4338ca'
                }}>
                  상속 직원: {roleUserCountMap[selectedRoleId] || 0}명
                </span>
                {isRoleDirty && (
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 800,
                    backgroundColor: '#fee2e2',
                    color: '#b91c1c'
                  }}>
                    미저장 변경사항 있음
                  </span>
                )}
              </div>

              {/* 일괄 액션 버튼군 */}
              {canSave && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleAllMenusBulkToggle('view')}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      backgroundColor: 'var(--bg-card, #ffffff)',
                      color: 'var(--text-main, #0f172a)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    전체 조회 ON
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAllMenusBulkToggle('save')}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      backgroundColor: 'var(--bg-card, #ffffff)',
                      color: 'var(--text-main, #0f172a)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    전체 저장 ON
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAllMenusBulkToggle('off')}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      backgroundColor: 'var(--bg-card, #ffffff)',
                      color: 'var(--text-secondary, #475569)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    전체 OFF
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRolePermissions}
                    disabled={!isRoleDirty}
                    style={{
                      padding: '5px 14px',
                      fontSize: '12px',
                      fontWeight: 700,
                      borderRadius: '5px',
                      border: 'none',
                      backgroundColor: isRoleDirty ? 'var(--primary, #4f46e5)' : '#94a3b8',
                      color: '#ffffff',
                      cursor: isRoleDirty ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: isRoleDirty ? '0 2px 4px rgba(79, 70, 229, 0.3)' : 'none',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Save size={13} />
                    {isRoleDirty ? '권한 설정 저장' : '저장 완료'}
                  </button>
                </div>
              )}
            </div>

            {/* 고밀도 카테고리별 아코디언 메뉴 테이블 */}
            <div style={{ maxHeight: '680px', overflowY: 'auto' }}>
              {MENU_CATEGORIES.map(grp => {
                const isCollapsed = collapsedRoleGroups[grp.id];
                const allViewsChecked = grp.items.every(i => workingRolePerms[normalizeMenuId(i.id)]?.canView);
                const allSavesChecked = grp.items.every(i => workingRolePerms[normalizeMenuId(i.id)]?.canSave);

                return (
                  <div key={grp.id} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                    {/* 카테고리 헤더 행 */}
                    <div style={{
                      padding: '8px 18px',
                      backgroundColor: 'var(--bg-secondary, #f1f5f9)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      userSelect: 'none'
                    }}>
                      <div
                        onClick={() => setCollapsedRoleGroups(p => ({ ...p, [grp.id]: !p[grp.id] }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '12.5px', color: 'var(--text-main, #0f172a)' }}
                      >
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <span>{grp.name}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted, #64748b)', fontWeight: 500 }}>
                          ({grp.items.length}개 메뉴)
                        </span>
                      </div>

                      {canSave && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                          <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary, #475569)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={allViewsChecked}
                              onChange={() => handleCategoryBulkToggle(grp, 'view')}
                              style={{ cursor: 'pointer' }}
                            />
                            조회 일괄
                          </label>
                          <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary, #475569)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={allSavesChecked}
                              onChange={() => handleCategoryBulkToggle(grp, 'save')}
                              style={{ cursor: 'pointer' }}
                            />
                            저장 일괄
                          </label>
                        </div>
                      )}
                    </div>

                    {/* 카테고리 세부 메뉴 항목들 */}
                    {!isCollapsed && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <tbody>
                          {grp.items.map(item => {
                            const norm = normalizeMenuId(item.id);
                            const perm = workingRolePerms[norm] || { canView: false, canSave: false };
                            const isLeaveApp = norm === 'leave_application';

                            return (
                              <tr
                                key={item.id}
                                style={{
                                  borderBottom: '1px solid var(--border-color, #f8fafc)',
                                  backgroundColor: perm.canView ? 'transparent' : 'rgba(0,0,0,0.015)'
                                }}
                              >
                                <td style={{ padding: '8px 18px 8px 36px', color: perm.canView ? 'var(--text-main, #0f172a)' : 'var(--text-muted, #94a3b8)', fontWeight: perm.canView ? 600 : 400 }}>
                                  {item.name}
                                  {isLeaveApp && (
                                    <span style={{ marginLeft: '6px', fontSize: '10.5px', color: '#10b981', fontWeight: 700 }}>(전원 기본)</span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 18px', width: '100px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: isLeaveApp ? 'not-allowed' : 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={perm.canView}
                                      disabled={!canSave || isLeaveApp}
                                      onChange={() => handleRolePermToggle(item.id, 'view')}
                                      style={{ cursor: isLeaveApp ? 'not-allowed' : 'pointer' }}
                                    />
                                    <span style={{ color: perm.canView ? '#2563eb' : 'var(--text-muted, #94a3b8)', fontWeight: perm.canView ? 700 : 400 }}>
                                      조회
                                    </span>
                                  </label>
                                </td>
                                <td style={{ padding: '8px 18px', width: '100px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: isLeaveApp ? 'not-allowed' : 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={perm.canSave}
                                      disabled={!canSave || isLeaveApp}
                                      onChange={() => handleRolePermToggle(item.id, 'save')}
                                      style={{ cursor: isLeaveApp ? 'not-allowed' : 'pointer' }}
                                    />
                                    <span style={{ color: perm.canSave ? '#16a34a' : 'var(--text-muted, #94a3b8)', fontWeight: perm.canSave ? 700 : 400 }}>
                                      저장/수정
                                    </span>
                                  </label>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════
          탭 2: 직원 권한 상속 배정 (User Mapping)
          ═════════════════════════════════════════════════════════════════ */}
      {activeTab === 'USERS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 상단 컨트롤 바 (필터, 검색, 통계, 엑셀 내보내기) */}
          <div style={{
            backgroundColor: 'var(--bg-card, #ffffff)',
            borderRadius: '8px',
            border: '1px solid var(--border-color, #cbd5e1)',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            {/* 좌측 필터군 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="성명, 사번, 직급, 부서 검색"
                style={{
                  width: '200px',
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              />

              <select
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              >
                <option value="ALL">전체 부서</option>
                <option value="경영진">경영진</option>
                <option value="관리부">관리부</option>
                <option value="영업팀">영업팀</option>
                <option value="출고팀">출고팀</option>
                <option value="AS팀">AS팀</option>
              </select>

              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              >
                <option value="ALL">전체 권한 명칭</option>
                <option value="NONE">[권한 미지정]</option>
                {customRoles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            {/* 우측 통계 및 엑셀 다운로드 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #475569)' }}>
                총 <strong>{filteredUsers.length}</strong>명 / 상속 완료 <strong>{activeUsers.filter(u => u.customRoleId).length}</strong>명
              </span>
              <button
                type="button"
                onClick={handleExportExcel}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-secondary, #f8fafc)',
                  color: 'var(--text-main, #0f172a)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Download size={13} color="#059669" />
                엑셀 내보내기
              </button>
            </div>
          </div>

          {/* 고밀도 직원 목록 및 권한 상속 테이블 */}
          <div style={{
            backgroundColor: 'var(--bg-card, #ffffff)',
            borderRadius: '8px',
            border: '1px solid var(--border-color, #cbd5e1)',
            overflow: 'auto'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{
                  backgroundColor: 'var(--bg-secondary, #f8fafc)',
                  borderBottom: '1px solid var(--border-color, #e2e8f0)',
                  color: 'var(--text-secondary, #475569)',
                  fontWeight: 700,
                  whiteSpace: 'nowrap'
                }}>
                  <th style={{ padding: '8px 12px', textAlign: 'center', width: '45px' }}>NO</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '110px' }}>사번 / ID</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '90px' }}>성명</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '100px' }}>소속 부서</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '70px' }}>직급</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', width: '90px' }}>시스템 등급</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '220px' }}>상속 권한 명칭 (핵심)</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>상속 권한 메뉴 요약</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', width: '80px' }}>상세 확인</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                      조회된 임직원이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user, idx) => {
                    const deptName = getDeptName(user);
                    const isDev = user.id === 'u-1' || user.id === 'sys-admin';
                    const summary = getUserInheritedMenus(user);
                    const currentRole = customRoles.find(r => r.id === user.customRoleId);

                    return (
                      <tr
                        key={user.id}
                        style={{
                          borderBottom: '1px solid var(--border-color, #f1f5f9)',
                          backgroundColor: idx % 2 === 1 ? 'var(--bg-secondary, #f8fafc)' : 'transparent',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <td style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontFamily: 'monospace' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text-secondary, #475569)' }}>
                          {user.loginId || user.id}
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
                          {user.name}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary, #475569)' }}>
                          {deptName}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted, #64748b)' }}>
                          {user.position || '-'}
                        </td>
                        {/* 시스템 등급 (ADMIN / USER) */}
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {isDev ? (
                            <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, backgroundColor: '#fef3c7', color: '#b45309' }}>
                              개발자
                            </span>
                          ) : (
                            <select
                              value={user.role || 'USER'}
                              disabled={!canSave || !isSuperAdmin}
                              onChange={(e) => handleUserGradeChange(user.id, e.target.value)}
                              style={{
                                padding: '3px 6px',
                                fontSize: '11px',
                                fontWeight: user.role === 'ADMIN' ? 700 : 500,
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #cbd5e1)',
                                backgroundColor: user.role === 'ADMIN' ? '#dcfce7' : 'var(--bg-card, #ffffff)',
                                color: user.role === 'ADMIN' ? '#166534' : 'var(--text-main, #0f172a)',
                                outline: 'none',
                                cursor: isSuperAdmin ? 'pointer' : 'not-allowed'
                              }}
                            >
                              <option value="USER">USER</option>
                              <option value="ADMIN">ADMIN</option>
                            </select>
                          )}
                        </td>

                        {/* 상속 권한 명칭 셀렉트박스 (핵심!) */}
                        <td style={{ padding: '8px 12px' }}>
                          {user.role === 'ADMIN' ? (
                            <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 700 }}>
                              전체 마스터 권한 (자동 승계)
                            </span>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <select
                                value={user.customRoleId || ''}
                                disabled={!canSave}
                                onChange={(e) => handleAssignUserRole(user.id, e.target.value)}
                                style={{
                                  width: '100%',
                                  maxWidth: '200px',
                                  padding: '4px 8px',
                                  fontSize: '11.5px',
                                  fontWeight: user.customRoleId ? 600 : 400,
                                  borderRadius: '5px',
                                  border: user.customRoleId ? '1px solid #6366f1' : '1px solid #f59e0b',
                                  backgroundColor: user.customRoleId ? '#eef2ff' : '#fffbeb',
                                  color: user.customRoleId ? '#3730a3' : '#b45309',
                                  outline: 'none',
                                  cursor: canSave ? 'pointer' : 'not-allowed'
                                }}
                              >
                                <option value="">[권한 명칭 미지정]</option>
                                {customRoles.map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </td>

                        {/* 상속 권한 메뉴 요약 */}
                        <td style={{ padding: '8px 12px', fontSize: '11.5px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-main, #0f172a)' }}>
                            {summary.total}
                          </span>
                          <span style={{ marginLeft: '8px', color: 'var(--text-muted, #64748b)' }}>
                            ({summary.preview})
                          </span>
                        </td>

                        {/* 상세 보기 액션 */}
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => setPreviewUser(user)}
                            style={{
                              padding: '3px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '4px',
                              border: '1px solid var(--border-color, #cbd5e1)',
                              backgroundColor: 'var(--bg-card, #ffffff)',
                              color: 'var(--primary, #4f46e5)',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            상세
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 직원 권한 상세 미리보기 모달 ─── */}
      {previewUser && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 10001,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '680px',
            maxHeight: '85vh',
            backgroundColor: 'var(--bg-card, #ffffff)',
            borderRadius: '12px',
            border: '1px solid var(--border-color, #cbd5e1)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '14px 20px',
              backgroundColor: 'var(--bg-secondary, #f8fafc)',
              borderBottom: '1px solid var(--border-color, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
                  [{previewUser.name}] 임직원 상속 권한 명세
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>
                  상속 권한: {customRoles.find(r => r.id === previewUser.customRoleId)?.name || '권한 미지정'} (소속: {getDeptName(previewUser)})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewUser(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #64748b)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {previewUser.role === 'ADMIN' ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#16a34a', fontWeight: 700 }}>
                  최고 관리자(ADMIN) 등급으로 전사 모든 메뉴에 대해 조회 및 저장 권한이 상시 허용되어 있습니다.
                </div>
              ) : !previewUser.customRoleId ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#b45309' }}>
                  현재 상속된 권한 명칭이 없습니다. [직원 권한 상속 배정]에서 권한을 지정해 주십시오.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {MENU_CATEGORIES.map(grp => {
                    const permittedItems = grp.items.filter(item => {
                      const perm = rolePermissions.find(p => p.roleId === previewUser.customRoleId && normalizeMenuId(p.menuId) === normalizeMenuId(item.id));
                      return perm?.canView || perm?.canSave || normalizeMenuId(item.id) === 'leave_application';
                    });

                    if (permittedItems.length === 0) return null;

                    return (
                      <div key={grp.id} style={{ border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '6px', overflow: 'hidden' }}>
                        <div style={{ padding: '6px 12px', backgroundColor: 'var(--bg-secondary, #f1f5f9)', fontSize: '12px', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
                          {grp.name} ({permittedItems.length}개)
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
                          <tbody>
                            {permittedItems.map(item => {
                              const perm = rolePermissions.find(p => p.roleId === previewUser.customRoleId && normalizeMenuId(p.menuId) === normalizeMenuId(item.id));
                              const canView = perm?.canView || normalizeMenuId(item.id) === 'leave_application';
                              const canSave = perm?.canSave || normalizeMenuId(item.id) === 'leave_application';

                              return (
                                <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                                  <td style={{ padding: '6px 12px', fontWeight: 600 }}>{item.name}</td>
                                  <td style={{ padding: '6px 12px', width: '80px', textAlign: 'center' }}>
                                    {canView ? <span style={{ color: '#2563eb', fontWeight: 700 }}>조회 허용</span> : '-'}
                                  </td>
                                  <td style={{ padding: '6px 12px', width: '80px', textAlign: 'center' }}>
                                    {canSave ? <span style={{ color: '#16a34a', fontWeight: 700 }}>저장 허용</span> : '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: '12px 20px', backgroundColor: 'var(--bg-secondary, #f8fafc)', borderTop: '1px solid var(--border-color, #e2e8f0)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setPreviewUser(null)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  backgroundColor: 'var(--primary, #4f46e5)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
