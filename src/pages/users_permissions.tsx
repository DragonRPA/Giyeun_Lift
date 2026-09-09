// src/pages/users_permissions.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Shield, Check, Lock, Save, FolderKanban, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { MenuPermission, User, createMenuPermission, db, Department } from '../services/db';
import { exportToExcel } from '../services/excel';

import { SYSTEM_MENU_CONFIG, getAllSystemMenuIds, MenuGroupConfig, normalizeMenuId } from '../config/menu_config';
import { getRoleTemplatePermission } from '../config/role_templates';

export type MenuCategoryGroup = MenuGroupConfig;
export const MENU_CATEGORIES = SYSTEM_MENU_CONFIG;

export const UsersPermissions: React.FC = () => {
  const { users, permissions, updatePermissions, saveUser, currentUser, hasPermission, showErrorModal } = useApp();

  const isSuperAdmin = currentUser?.id === 'u-1' || currentUser?.id === 'sys-admin';
  const canSave = hasPermission('permission', 'save');

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [localUsers, setLocalUsers] = useState<User[]>([]);
  const [localPermissions, setLocalPermissions] = useState<MenuPermission[]>([]);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // 🏢 부서 및 팀 정보 캐시 로드 & 자동 동기화 (SSOT)
  const [departments, setDepartments] = useState<Department[]>(() => {
    try {
      const saved = localStorage.getItem('erp_departments');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return db.departments || [];
  });

  useEffect(() => {
    const syncDepts = async () => {
      try {
        if (db.isSupabaseConnected()) {
          const remote = await db.pullTableFromSupabase('departments');
          if (remote && Array.isArray(remote) && remote.length > 0) {
            setDepartments(remote);
            return;
          }
        }
      } catch (e) {}
      if (db.departments && db.departments.length > 0) {
        setDepartments(db.departments);
      }
    };
    syncDepts();
  }, []);

  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    departments.forEach(d => {
      if (d.id && d.name) map.set(d.id, d.name);
    });
    return map;
  }, [departments]);

  // 🏷️ 임직원별 소속 팀명 정밀 판정 헬퍼 (oo팀 이름 형식 SSOT)
  const getDeptName = (u: User): string => {
    // 1. departmentId 기반 부서 마스터 매핑
    if (u.departmentId && departmentMap.has(u.departmentId)) {
      const name = departmentMap.get(u.departmentId);
      if (name && name.trim()) return name.trim();
    }
    // 2. u.department 속성 확인
    if (u.department && u.department.trim()) {
      return u.department.trim();
    }
    // 3. 표준 부서 ID 매핑 (role_templates SSOT)
    if (u.departmentId) {
      const dId = u.departmentId.toUpperCase();
      if (dId === 'DEPT-0000001' || dId === 'DEPT-1') return '경영진';
      if (dId === 'DEPT-0000002' || dId === 'DEPT-2') return '관리부';
      if (dId === 'DEPT-0000003' || dId === 'DEPT-3') return '영업팀';
      if (dId === 'DEPT-0000004' || dId === 'DEPT-4') return '출고팀';
      if (dId === 'DEPT-0000005' || dId === 'DEPT-5') return 'AS팀';
    }
    // 4. Role 및 테스트/관리 계정 식별
    const r = (u.role || '').toUpperCase();
    const login = (u.loginId || '').toLowerCase();

    if (u.id === 'usr-tester-dispatch' || login.includes('dispatch')) return '출고팀';
    if (u.id === 'usr-tester-mechanic' || login.includes('mechanic')) return 'AS팀';
    if (r === 'ADMIN' || login === 'admin' || u.id === 'sys-admin' || u.id === 'u-1') return '경영지원';

    // 5. 직무 템플릿의 Role 기반 부서 추론
    if (r.includes('ACCOUNT') || r.includes('PURCHASE')) return '관리부';
    if (r.includes('SALE')) return '영업팀';
    if (r.includes('LOGISTIC') || r.includes('DELIVERY') || r.includes('DISPATCH')) return '출고팀';
    if (r.includes('MECHANIC') || r.includes('REPAIR')) return 'AS팀';

    return '미배정';
  };

  // 상위 카테고리 접힘/펼침 상태
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    setLocalUsers([...users]);
  }, [users]);

  useEffect(() => {
    if (users.length > 0 && !selectedUserId) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId]);

  useEffect(() => {
    // 모든 시스템 메뉴 ID 스캔 및 누락된 권한 항목 자가 복구 (Auto Backfill - 직무 템플릿 상속 보존)
    const allMenuIds = getAllSystemMenuIds();
    const merged = [...permissions];
    let addedCount = 0;

    users.forEach(u => {
      const dept = u.departmentId || u.department;
      allMenuIds.forEach(menuId => {
        const normId = normalizeMenuId(menuId);
        const exists = merged.some(p => p.userId === u.id && normalizeMenuId(p.menuId) === normId);
        if (!exists) {
          const isAdmin = u.role === 'ADMIN' || u.id === 'u-1' || u.id === 'sys-admin' || u.id === 'USR-0000002';
          // 직무 템플릿 표준 기본값 상속 (false 하드코딩으로 직무 권한을 파괴하던 결함 해결)
          const templateView = isAdmin ? true : (getRoleTemplatePermission(u.role, dept, normId, 'view') ?? false);
          const templateSave = isAdmin ? true : (getRoleTemplatePermission(u.role, dept, normId, 'save') ?? false);
          merged.push(createMenuPermission(u.id, normId, templateView, templateSave));
          addedCount++;
        }
      });
    });

    setLocalPermissions(merged);
    setIsDirty(false);
  }, [permissions, users]);

  const selectedUser = localUsers.find(u => u.id === selectedUserId);

  const toggleGroupCollapse = (grpId: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [grpId]: !prev[grpId]
    }));
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!canSave) return;
    
    if (userId === 'u-1' || userId === 'sys-admin') {
      showToast('최고관리자 계정의 시스템 등급은 변경할 수 없습니다.', 'error');
      return;
    }

    if (newRole === 'ADMIN' && !isSuperAdmin) {
      showToast('ADMIN(최고관리자) 등급은 오직 최고관리자(sys-admin) 계정만 승인 권한이 있습니다.', 'error');
      return;
    }

    const targetUser = localUsers.find(u => u.id === userId);
    if (!targetUser) return;

    if (targetUser.role === 'ADMIN' && newRole !== 'ADMIN' && !isSuperAdmin) {
      showToast('ADMIN 권한 박탈은 오직 최고관리자(sys-admin)만 가능합니다.', 'error');
      return;
    }

    const updatedUser: User = {
      ...targetUser,
      role: newRole as 'ADMIN' | 'MANAGER' | 'USER'
    };

    await saveUser(updatedUser);
    await db.awaitPendingWrites();
    setLocalUsers(prev => prev.map(u => u.id === userId ? updatedUser : u));
    showToast(`${targetUser.name} 님의 등급이 [${newRole}] (으)로 변경되었습니다.`);
  };

  const handlePermissionToggle = (menuId: string, type: 'view' | 'save') => {
    if (!canSave || !selectedUserId) return;
    
    const targetUser = localUsers.find(u => u.id === selectedUserId);
    // 절대 대표이사 및 슈퍼 관리자 계정은 권한 회수 불가
    if (targetUser?.id === 'u-1' || targetUser?.id === 'sys-admin' || targetUser?.loginId === 'admin' || targetUser?.id === 'USR-0000002' || targetUser?.loginId === '이수용') {
      showToast('대표이사 및 시스템 최고관리자 계정의 메뉴 권한은 변경할 수 없습니다.', 'error');
      return;
    }

    // 사용자 권한 설정(permission) 메뉴는 오직 ADMIN 등급에게만 부여 가능
    if (menuId === 'permission' && targetUser?.role !== 'ADMIN') {
      showToast('사용자 권한 설정 메뉴는 오직 최고관리자(ADMIN) 등급에게만 부여할 수 있습니다.', 'error');
      return;
    }


    setLocalPermissions(prev => {
      const index = prev.findIndex(p => p.userId === selectedUserId && p.menuId === menuId);
      let updatedList = [...prev];
      
      if (index > -1) {
        const current = updatedList[index];
        let nextView = current.canView;
        let nextSave = current.canSave;

        if (type === 'view') {
          nextView = !current.canView;
          if (!nextView) nextSave = false;
        } else {
          nextSave = !current.canSave;
          if (nextSave) nextView = true;
        }

        updatedList[index] = { ...current, canView: nextView, canSave: nextSave };
      } else {
        updatedList.push({
          id: `perm-${selectedUserId}-${menuId}`,
          userId: selectedUserId,
          menuId: menuId,
          canView: type === 'view' ? true : true,
          canSave: type === 'save' ? true : false,
          createdAt: new Date().toISOString()
        });
      }

      setIsDirty(true);
      return updatedList;
    });
  };

  // 상위 그룹 전체 일괄 권한 설정 (조회/저장)
  const handleToggleCategoryGroup = (grp: MenuCategoryGroup, type: 'view' | 'save') => {
    if (!canSave || !selectedUserId) return;
    const targetUser = localUsers.find(u => u.id === selectedUserId);
    // 절대 슈퍼 관리자 계정은 권한 회수 불가
    if (targetUser?.id === 'u-1' || targetUser?.id === 'sys-admin' || targetUser?.loginId === 'admin') {
      showToast('시스템 최고관리자 계정의 메뉴 권한은 변경할 수 없습니다.', 'error');
      return;
    }

    // 그룹 내 메뉴 항목들의 현재 권한 상태 검사 (모두 true이면 전체 false로, 아니면 전체 true로)
    const allChecked = grp.items.every(item => {
      const perm = localPermissions.find(p => p.userId === selectedUserId && p.menuId === item.id);
      return type === 'view' ? perm?.canView : perm?.canSave;
    });

    const targetVal = !allChecked;

    setLocalPermissions(prev => {
      let updatedList = [...prev];

      grp.items.forEach(item => {
        if (item.id === 'payroll' && targetVal) {
          // 급여 정산 일괄 승인 시 보안 체크
          const existingPayrollHolder = updatedList.find(p => {
            if (p.menuId !== 'payroll' || p.userId === selectedUserId) return false;
            const u = localUsers.find(user => user.id === p.userId);
            return u && u.role !== 'ADMIN' && (p.canView || p.canSave);
          });
          if (existingPayrollHolder) return; // 기존 보유자 있을 경우 스킵
        }

        const idx = updatedList.findIndex(p => p.userId === selectedUserId && p.menuId === item.id);
        if (idx > -1) {
          const cur = updatedList[idx];
          if (type === 'view') {
            const nextView = targetVal;
            const nextSave = nextView ? cur.canSave : false;
            updatedList[idx] = { ...cur, canView: nextView, canSave: nextSave };
          } else {
            const nextSave = targetVal;
            const nextView = nextSave ? true : cur.canView;
            updatedList[idx] = { ...cur, canView: nextView, canSave: nextSave };
          }
        } else {
          updatedList.push({
            id: `perm-${selectedUserId}-${item.id}`,
            userId: selectedUserId,
            menuId: item.id,
            canView: type === 'view' ? targetVal : targetVal,
            canSave: type === 'save' ? targetVal : false,
            createdAt: new Date().toISOString()
          });
        }
      });

      setIsDirty(true);
      return updatedList;
    });
  };

  // 모든 카테고리 전체 메뉴 최상위 일괄 권한 설정 (조회/저장)
  const handleToggleAllMenus = (type: 'view' | 'save') => {
    if (!canSave || !selectedUserId) return;
    const targetUser = localUsers.find(u => u.id === selectedUserId);
    if (targetUser?.id === 'u-1' || targetUser?.id === 'sys-admin' || targetUser?.loginId === 'admin') {
      showToast('시스템 최고관리자 계정의 메뉴 권한은 변경할 수 없습니다.', 'error');
      return;
    }

    const allItems = MENU_CATEGORIES.flatMap(grp => grp.items);
    const allChecked = allItems.every(item => {
      const perm = localPermissions.find(p => p.userId === selectedUserId && p.menuId === item.id);
      return type === 'view' ? perm?.canView : perm?.canSave;
    });

    const targetVal = !allChecked;

    setLocalPermissions(prev => {
      let updatedList = [...prev];

      allItems.forEach(item => {
        if (item.id === 'payroll' && targetVal) {
          const existingPayrollHolder = updatedList.find(p => {
            if (p.menuId !== 'payroll' || p.userId === selectedUserId) return false;
            const u = localUsers.find(user => user.id === p.userId);
            return u && u.role !== 'ADMIN' && (p.canView || p.canSave);
          });
          if (existingPayrollHolder) return;
        }

        const idx = updatedList.findIndex(p => p.userId === selectedUserId && p.menuId === item.id);
        if (idx > -1) {
          const cur = updatedList[idx];
          if (type === 'view') {
            const nextView = targetVal;
            const nextSave = nextView ? cur.canSave : false;
            updatedList[idx] = { ...cur, canView: nextView, canSave: nextSave };
          } else {
            const nextSave = targetVal;
            const nextView = nextSave ? true : cur.canView;
            updatedList[idx] = { ...cur, canView: nextView, canSave: nextSave };
          }
        } else {
          updatedList.push({
            id: `perm-${selectedUserId}-${item.id}`,
            userId: selectedUserId,
            menuId: item.id,
            canView: type === 'view' ? targetVal : targetVal,
            canSave: type === 'save' ? targetVal : false,
            createdAt: new Date().toISOString()
          });
        }
      });

      setIsDirty(true);
      return updatedList;
    });
  };

  // 고스트/무효 권한 진단 모달 상태
  const [showGhostModal, setShowGhostModal] = useState<boolean>(false);

  // 🔍 기 저장된 무효(FK 위반) 권한 데이터 진단 헬퍼
  const validUserIds = useMemo(() => new Set(localUsers.map(u => u.id)), [localUsers]);

  // 조직도 부서 배치 순서 기준 정렬 맵 (조직/인사 관리 화면 조직도와 동일 순서)
  const DEPT_ORDER_MAP: Record<string, number> = {
    'DEPT-0000001': 0, 'DEPT-1': 0,  // 기연리프트 (경영진)
    'DEPT-0000002': 1, 'DEPT-2': 1,  // 관리부
    'DEPT-0000003': 2, 'DEPT-3': 2,  // 영업부
    'DEPT-0000004': 3, 'DEPT-4': 3,  // 출고팀
    'DEPT-0000005': 4, 'DEPT-5': 4,  // AS팀
  };

  const getDeptOrder = (u: User): number => {
    if (u.id === 'u-1' || u.id === 'sys-admin' || u.role === 'ADMIN') return -1; // ADMIN 최상단
    if (u.departmentId) {
      const order = DEPT_ORDER_MAP[u.departmentId] ?? DEPT_ORDER_MAP[u.departmentId.toUpperCase()];
      if (order !== undefined) return order;
    }
    // 부서명 기반 fallback
    const deptName = getDeptName(u);
    if (deptName === '경영진' || deptName === '경영지원') return 0;
    if (deptName === '관리부') return 1;
    if (deptName === '영업부' || deptName === '영업팀') return 2;
    if (deptName === '출고팀') return 3;
    if (deptName === 'AS팀') return 4;
    return 99; // 미배정 맨 뒤
  };

  // 조직도 순서 + 동일 부서 내 이름순 정렬
  const sortedUsers = useMemo(() => {
    return [...localUsers].sort((a, b) => {
      const orderA = getDeptOrder(a);
      const orderB = getDeptOrder(b);
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }, [localUsers, departmentMap]);


  const ghostPermissions = useMemo(() => {
    return localPermissions.filter((p: MenuPermission) => !validUserIds.has(p.userId));
  }, [localPermissions, validUserIds]);

  const invalidUserIdsList = useMemo(() => {
    return Array.from(new Set(ghostPermissions.map((p: MenuPermission) => p.userId)));
  }, [ghostPermissions]);

  // 💳 급여 관리 권한 소유 임직원 현황 (1인 강제 제한 제거 및 시각적 현황 노출)
  const payrollHolders = useMemo(() => {
    const holderUserIds = new Set(
      localPermissions
        .filter((p: MenuPermission) => (p.menuId === 'payroll' || p.menuId === 'payroll_settlements') && (p.canView || p.canSave))
        .map((p: MenuPermission) => p.userId)
    );
    return localUsers.filter(u => holderUserIds.has(u.id));
  }, [localPermissions, localUsers]);

  // 1-Click 고스트 권한 자동 정돈 및 정상 데이터 재저장
  const handleCleanGhostPermissions = async () => {
    if (ghostPermissions.length === 0) {
      showToast('현재 무효(고스트) 권한 데이터가 없습니다. 모든 데이터가 정상입니다.');
      setShowGhostModal(false);
      return;
    }

    try {
      const cleanList = localPermissions.filter(p => validUserIds.has(p.userId));
      await updatePermissions(cleanList);
      await db.awaitPendingWrites();
      setLocalPermissions(cleanList);
      setIsDirty(false);
      setShowGhostModal(false);
      showToast(`무효 고스트 권한 ${ghostPermissions.length}건 정돈 완료 (정상 권한 ${cleanList.length}건 보존)`);
    } catch (err: any) {
      console.error('Clean ghost permissions error:', err);
      showErrorModal(`⚠️ 고스트 권한 정돈 저장 중 오류가 발생했습니다:\n\n${err?.message || err}`);
    }
  };

  // ─── [Gutenberg Z-패턴 4단계 최하단 임직원 권한 대차대조식 검증] ───
  const permissionAuditSummary = useMemo(() => {
    const totalUsers = localUsers.length;
    const adminCount = localUsers.filter(u => u.role === 'ADMIN').length;
    const managerCount = localUsers.filter(u => u.role === 'MANAGER').length;
    const userCount = localUsers.filter(u => u.role !== 'ADMIN' && u.role !== 'MANAGER').length;
    const totalPermCount = localPermissions.length;
    const ghostCount = ghostPermissions.length;

    return { totalUsers, adminCount, managerCount, userCount, totalPermCount, ghostCount };
  }, [localUsers, localPermissions, ghostPermissions]);

  const handleSavePermissions = async () => {
    if (!canSave) return;

    // 🛡️ [저장 전 예방 팝업] 참조키(FK) 위반 사전 실시간 파악 및 저장 차단
    if (ghostPermissions.length > 0) {
      const warningMsg = 
        `⚠️ [참조키(FK) 위반 위험 감지 - 저장 사전 차단]\n\n` +
        `현재 저장하려는 권한 목록에 DB 임직원 마스터(users)에 존재하지 않는 무효 유저 ID가 포함되어 있습니다.\n\n` +
        `■ 발견된 무효 유저 ID 목록 (${invalidUserIdsList.length}개): [${invalidUserIdsList.join(', ')}]\n` +
        `■ 무효 고스트 권한 데이터 건수: 총 ${ghostPermissions.length}건\n\n` +
        `💡 원천 해결: 상단의 [🔍 고스트 권한 진단 및 정돈] 버튼을 누르시면 무효 데이터만 자동으로 깔끔히 정리하여 안전하게 저장할 수 있습니다.`;
      
      showErrorModal(warningMsg, '저장 사전 차단 - 참조키(FK) 위반 방지');
      setShowGhostModal(true); // 자동 팝업 가이드 오픈
      return;
    }

    try {
      await updatePermissions(localPermissions);
      await db.awaitPendingWrites();
      setIsDirty(false);
      showToast('메뉴 권한 설정이 성공적으로 저장되었습니다.');
    } catch (err: any) {
      console.error('Save permissions error:', err);
      showErrorModal(`⚠️ 메뉴 권한 설정 저장 중 오류가 발생했습니다:\n\n${err?.message || err}`);
    }
  };

  // 사용자 권한 대장 엑셀 내보내기
  const handleExportPermissionsExcel = () => {
    if (localUsers.length === 0) {
      showToast('내보낼 사용자 데이터가 없습니다.', 'error');
      return;
    }
    const rows = localUsers.map((u, idx) => {
      const userPerms = localPermissions.filter(p => p.userId === u.id);
      const viewCount = userPerms.filter(p => p.canView).length;
      const saveCount = userPerms.filter(p => p.canSave).length;
      const hasPayroll = userPerms.some(p => p.menuId === 'payroll' && p.canView);
      const deptName = getDeptName(u);

      return {
        'No': idx + 1,
        '사용자ID': u.id,
        '로그인ID': u.loginId || '-',
        '성명': u.name,
        '소속부서': deptName,
        '직급': u.position || '-',
        '시스템역할': u.role || 'USER',
        '조회권한수': viewCount,
        '저장권한수': saveCount,
        '급여열람권한': hasPayroll ? '보유' : '미보유',
        '관리자여부': u.role === 'ADMIN' ? '관리자' : '일반',
        '상태': u.status === 'ACTIVE' ? '재직' : u.status === 'RETIRED' ? '퇴사' : '휴직'
      };
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    exportToExcel(rows, `사용자권한대장_${todayStr}`, '사용자권한');
    showToast(`사용자 권한 대장 ${rows.length}건 엑셀 내보내기 완료`);
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* 🔔 인앱 토스트 알림 (헌장 5.2) */}
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
          fontWeight: 600,
          fontSize: '13px'
        }}>
          {toastMessage.text}
        </div>
      )}
      <div className="card-header" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield className="text-primary" /> 사용자 및 메뉴 권한 통합 관리
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            사이드바 계층 구조(상위-하위)에 따라 직원별 조회 및 저장(수정/삭제) 권한을 정밀 통제합니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className={ghostPermissions.length > 0 ? 'btn-danger' : 'btn-secondary'}
            onClick={() => setShowGhostModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px',
              backgroundColor: ghostPermissions.length > 0 ? 'rgba(239, 68, 68, 0.15)' : undefined,
              color: ghostPermissions.length > 0 ? '#ef4444' : undefined,
              borderColor: ghostPermissions.length > 0 ? 'rgba(239, 68, 68, 0.4)' : undefined,
              fontWeight: ghostPermissions.length > 0 ? 'bold' : 'normal'
            }}
          >
            🔍 고스트 권한 진단 {ghostPermissions.length > 0 && `(${ghostPermissions.length}건 발각)`}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportPermissionsExcel}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', whiteSpace: 'nowrap' }}
          >
            <Download size={14} /> 엑셀 내보내기
          </button>
          {canSave && (
            <button 
              className={`btn-${isDirty ? 'primary' : 'secondary'}`} 
              onClick={handleSavePermissions}
              disabled={!isDirty}
              style={{ 
                display: 'flex', alignItems: 'center', gap: '6px',
                boxShadow: isDirty ? '0 0 12px rgba(59, 130, 246, 0.5)' : 'none',
                transition: 'all 0.3s ease'
              }}
            >
              <Save size={16} /> {isDirty ? '변경사항 저장 적용' : '저장 완료'}
            </button>
          )}
        </div>
      </div>

      {/* 📊 사용자 및 권한 현황 실시간 요약 바 */}
      {(() => {
        const adminCount = users.filter(u => u.role === 'ADMIN' || u.id === 'u-1' || u.id === 'sys-admin').length;
        const totalPermRecords = localPermissions.length;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 시스템 사용자</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{users.length}명</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>시스템 관리자(ADMIN)</span>
              <strong style={{ fontSize: '15px', color: '#16a34a' }}>{adminCount}명</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>메뉴 권한 레코드</span>
              <strong style={{ fontSize: '15px', color: '#0070C0' }}>{totalPermRecords}건</strong>
            </div>
          </div>
        );
      })()}

      {/* 💳 급여 관리 권한 소유 임직원 현황 시각화 배너 (1인 강제 제한 제거 & 현황 투명 노출) */}
      <div style={{
        marginBottom: '16px', padding: '10px 16px', backgroundColor: 'var(--bg-card)',
        borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', fontSize: '13px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>💳 급여 관리 권한 소유 임직원:</span>
          <span>
            {payrollHolders.length > 0
              ? payrollHolders.map(u => `${u.name}(${u.position || u.role})`).join(', ')
              : '현재 권한 소유자 없음'}
          </span>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
          총 <strong style={{ color: 'var(--primary)' }}>{payrollHolders.length}</strong> 명 보유 중 (자유롭게 조정 가능)
        </div>
      </div>

      {/* ⚠️ 고스트/무효 권한 진단 및 1-Click 자동 정돈 모달 팝업 */}
      {showGhostModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="card" style={{
            width: '100%', maxWidth: '560px', padding: '24px', backgroundColor: 'var(--bg-card)',
            borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontWeight: '800', fontSize: '16px', color: ghostPermissions.length > 0 ? 'var(--danger)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={18} />
                {ghostPermissions.length > 0 ? '기 저장된 무효(FK 위반) 고스트 권한 데이터 발각' : '권한 데이터 정합성 정상 검증 완료'}
              </h3>
              <button type="button" onClick={() => setShowGhostModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
            </div>

            {ghostPermissions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)', fontSize: '13px', lineHeight: '1.6' }}>
                  ⚠️ DB 임직원 마스터(`users`)에서 이미 삭제되었거나 존재하지 않는 무효 유저 ID의 권한 찌꺼기 레코드가 발각되었습니다. 이 데이터가 포함되어 있으면 저장 시 Supabase FK 참조키 오류(`23503`)가 발생할 수 있습니다.
                </div>

                <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div><strong>발각된 무효 유저 ID 목록 ({invalidUserIdsList.length}개):</strong></div>
                  <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--danger)', wordBreak: 'break-all' }}>
                    {invalidUserIdsList.join(', ')}
                  </div>
                  <div><strong>무효 권한 데이터 총 건수:</strong> <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>{ghostPermissions.length} 건</span> (전체 {localPermissions.length}건 중)</div>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowGhostModal(false)} style={{ padding: '8px 14px', fontSize: '13px' }}>닫기</button>
                  {canSave && (
                    <button type="button" className="btn-danger" onClick={handleCleanGhostPermissions} style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Check size={16} /> 🧹 고스트 권한 정돈 & 정상 데이터 저장
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: '14px', color: 'var(--success)', fontWeight: 'bold' }}>
                  ✅ 현재 권한 목록에 무효(고스트) 유저 데이터가 존재하지 않습니다!
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                  모든 권한 레코드({localPermissions.length}건)가 임직원 마스터(`users`)와 100% 안전하게 연결되어 있으며, 저장 시 FK 참조키 위반 오류가 발생하지 않습니다.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
                  <button type="button" className="btn-primary" onClick={() => setShowGhostModal(false)} style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 'bold' }}>확인</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>
        
        {/* 사용자 리스트 (좌측 패널) */}
        <div className="card" style={{ margin: 0, height: '700px', display: 'flex', flexDirection: 'column', padding: '16px' }}>
          <div className="card-header" style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginBottom: '12px' }}>
            <h3 className="card-title" style={{ fontSize: '15px' }}>등록 임직원 리스트</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>직원 선택 후 권한 설정</span>
          </div>

          <div className="table-container" style={{ flex: 1, overflowY: 'auto', border: 'none' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>임직원명</th>
                  <th>등급</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map(u => {
                  const isSelected = selectedUserId === u.id;
                  const deptName = getDeptName(u);
                  return (
                    <tr 
                      key={u.id} 
                      onClick={() => setSelectedUserId(u.id)}
                      style={{ 
                        cursor: 'pointer', 
                        backgroundColor: isSelected ? 'var(--primary-light)' : 'transparent',
                        borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid transparent'
                      }}
                    >
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: '800',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.18)' : 'rgba(100, 116, 139, 0.12)',
                            color: isSelected ? 'var(--primary)' : (deptName === '미배정' ? 'var(--text-muted)' : 'var(--text-secondary)'),
                            border: isSelected ? '1px solid rgba(37, 99, 235, 0.35)' : '1px solid var(--border-color)',
                            flexShrink: 0
                          }}>
                            {deptName}
                          </span>
                          <strong style={{ color: isSelected ? 'var(--primary)' : 'var(--text-primary)', fontSize: '13px' }}>
                            {u.name}
                          </strong>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          ({u.loginId || '미등록'}){u.position ? ` · ${u.position}` : ''}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select 
                          value={u.role || 'USER'}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          disabled={!canSave || u.id === 'sys-admin'}
                          style={{
                            padding: '3px 6px', fontSize: '11.5px', borderRadius: '4px',
                            border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)',
                            fontWeight: 'bold',
                            color: u.role === 'ADMIN' ? 'var(--danger)' : u.role === 'MANAGER' ? 'var(--success)' : 'var(--info)'
                          }}
                        >
                          {isSuperAdmin && <option value="ADMIN">ADMIN</option>}
                          {(!isSuperAdmin && u.role === 'ADMIN') && <option value="ADMIN" disabled>ADMIN</option>}
                          <option value="MANAGER">MANAGER</option>
                          <option value="USER">USER</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 계층형 메뉴 권한 매트릭스 (우측 패널) */}
        <div className="card" style={{ margin: 0, height: '700px', display: 'flex', flexDirection: 'column', padding: '16px' }}>
          <div className="card-header" style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 className="card-title" style={{ fontSize: '15px' }}>
                상위-하위 계층 메뉴 권한 매트릭스
                {selectedUser && (
                  <span style={{ marginLeft: '10px', fontSize: '14px', color: 'var(--primary)' }}>
                    [{getDeptName(selectedUser)} {selectedUser.name} {selectedUser.role}]
                  </span>
                )}
              </h3>
            </div>
            {selectedUser?.role === 'ADMIN' && (
              <span style={{ fontSize: '12px', color: 'var(--danger)', fontWeight: 'bold' }}>* ADMIN 등급은 전권 자동 소유</span>
            )}
          </div>

          <div className="table-container" style={{ flex: 1, overflowY: 'auto', border: 'none', boxShadow: 'none' }}>
            <table style={{ width: '100%', margin: 0 }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                  <th style={{ padding: '10px 14px', verticalAlign: 'middle' }}>상위 카테고리 및 하위 메뉴명</th>
                  <th style={{ width: '135px', textAlign: 'center', padding: '8px 4px' }}>
                    {(() => {
                      const isSuperAdminUser = selectedUser?.id === 'u-1' || selectedUser?.id === 'sys-admin' || selectedUser?.loginId === 'admin';
                      const allItems = MENU_CATEGORIES.flatMap(g => g.items);
                      const isAllGlobalViewChecked = allItems.length > 0 && allItems.every(item => {
                        const p = localPermissions.find(x => x.userId === selectedUserId && x.menuId === item.id);
                        return isSuperAdminUser ? true : (p?.canView ?? false);
                      });
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '13px' }}>조회 (VIEW)</span>
                          <button
                            type="button"
                            disabled={!canSave || isSuperAdminUser}
                            onClick={() => handleToggleAllMenus('view')}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: isAllGlobalViewChecked ? 'var(--primary)' : 'var(--bg-card)',
                              color: isAllGlobalViewChecked ? '#fff' : 'var(--text-secondary)',
                              cursor: canSave && !isSuperAdminUser ? 'pointer' : 'default',
                              fontWeight: '700'
                            }}
                          >
                            {isAllGlobalViewChecked ? '전체해제' : '전체선택'}
                          </button>
                        </div>
                      );
                    })()}
                  </th>
                  <th style={{ width: '135px', textAlign: 'center', padding: '8px 4px' }}>
                    {(() => {
                      const isSuperAdminUser = selectedUser?.id === 'u-1' || selectedUser?.id === 'sys-admin' || selectedUser?.loginId === 'admin';
                      const allItems = MENU_CATEGORIES.flatMap(g => g.items);
                      const isAllGlobalSaveChecked = allItems.length > 0 && allItems.every(item => {
                        const p = localPermissions.find(x => x.userId === selectedUserId && x.menuId === item.id);
                        return isSuperAdminUser ? true : (p?.canSave ?? false);
                      });
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '13px' }}>저장 (SAVE)</span>
                          <button
                            type="button"
                            disabled={!canSave || isSuperAdminUser}
                            onClick={() => handleToggleAllMenus('save')}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: isAllGlobalSaveChecked ? 'var(--success)' : 'var(--bg-card)',
                              color: isAllGlobalSaveChecked ? '#fff' : 'var(--text-secondary)',
                              cursor: canSave && !isSuperAdminUser ? 'pointer' : 'default',
                              fontWeight: '700'
                            }}
                          >
                            {isAllGlobalSaveChecked ? '전체해제' : '전체선택'}
                          </button>
                        </div>
                      );
                    })()}
                  </th>
                </tr>
              </thead>
              <tbody>
                {MENU_CATEGORIES.map(grp => {
                  const isCollapsed = collapsedGroups[grp.id] === true;
                  const isAdmin = selectedUser?.role === 'ADMIN';
                  const isSuperAdminUser = selectedUser?.id === 'u-1' || selectedUser?.id === 'sys-admin' || selectedUser?.loginId === 'admin';

                  // 상위 그룹의 전체 선택 상태 파악
                  const allViewChecked = grp.items.every(item => {
                    const p = localPermissions.find(x => x.userId === selectedUserId && x.menuId === item.id);
                    return isSuperAdminUser ? true : (p?.canView ?? false);
                  });
                  const allSaveChecked = grp.items.every(item => {
                    const p = localPermissions.find(x => x.userId === selectedUserId && x.menuId === item.id);
                    return isSuperAdminUser ? true : (p?.canSave ?? false);
                  });

                  return (
                    <React.Fragment key={grp.id}>
                      {/* 상위 메뉴 카테고리 헤더 행 */}
                      <tr style={{ backgroundColor: 'var(--bg-app)', borderTop: '2px solid var(--border-color)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: '700', color: 'var(--primary)', cursor: 'pointer' }} onClick={() => toggleGroupCollapse(grp.id)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13.5px' }}>
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            <FolderKanban size={16} />
                            <span>{grp.name}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: '6px' }}>
                              ({grp.items.length}개 메뉴)
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '6px' }}>
                          <button
                            type="button"
                            disabled={!canSave || isSuperAdminUser}
                            onClick={() => handleToggleCategoryGroup(grp, 'view')}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: allViewChecked ? 'var(--primary)' : 'var(--bg-card)',
                              color: allViewChecked ? '#fff' : 'var(--text-secondary)',
                              cursor: canSave && !isSuperAdminUser ? 'pointer' : 'default',
                              fontWeight: '600'
                            }}
                          >
                            {allViewChecked ? '조회 전체해제' : '조회 전체선택'}
                          </button>
                        </td>
                        <td style={{ textAlign: 'center', padding: '6px' }}>
                          <button
                            type="button"
                            disabled={!canSave || isSuperAdminUser}
                            onClick={() => handleToggleCategoryGroup(grp, 'save')}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: allSaveChecked ? 'var(--success)' : 'var(--bg-card)',
                              color: allSaveChecked ? '#fff' : 'var(--text-secondary)',
                              cursor: canSave && !isSuperAdminUser ? 'pointer' : 'default',
                              fontWeight: '600'
                            }}
                          >
                            {allSaveChecked ? '저장 전체해제' : '저장 전체선택'}
                          </button>
                        </td>
                      </tr>

                      {/* 하위 메뉴 행들 */}
                      {!isCollapsed && grp.items.map(menu => {
                        const perm = localPermissions.find(p => p.userId === selectedUserId && p.menuId === menu.id) || { canView: isSuperAdminUser, canSave: isSuperAdminUser };
                        const canView = isSuperAdminUser || perm.canView;
                        const canSaveVal = isSuperAdminUser || perm.canSave;

                        return (
                          <tr key={menu.id} style={{ borderBottom: '1px dashed var(--border-color)' }}>
                            <td style={{ paddingLeft: '32px', fontSize: '13px' }}>
                              <span>• {menu.name}</span>
                            </td>

                            {/* 조회 권한 */}
                            <td style={{ textAlign: 'center' }}>
                              {isSuperAdminUser ? (
                                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}><Lock size={12} /> 허용</span>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={canView}
                                  onChange={() => handlePermissionToggle(menu.id, 'view')}
                                  disabled={!canSave}
                                  style={{ cursor: canSave ? 'pointer' : 'default' }}
                                />
                              )}
                            </td>

                            {/* 저장 권한 */}
                            <td style={{ textAlign: 'center' }}>
                              {isSuperAdminUser ? (
                                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}><Lock size={12} /> 허용</span>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={canSaveVal}
                                  onChange={() => handlePermissionToggle(menu.id, 'save')}
                                  disabled={!canSave || !canView}
                                  style={{ cursor: canSave && canView ? 'pointer' : 'default' }}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 임직원 권한 대차대조식 검증 바 (헌장 3.5) */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 'var(--sidebar-width, 240px)',
        right: 0,
        height: '42px',
        backgroundColor: 'var(--bg-card)',
        borderTop: '2px solid var(--primary)',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 99,
        fontSize: '11.5px',
        fontWeight: 600
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <span>👥 <strong>전체임직원:</strong> {permissionAuditSummary.totalUsers}명</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>👑 <strong>최고관리자:</strong> {permissionAuditSummary.adminCount}명</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>💼 <strong>매니저/실무:</strong> {permissionAuditSummary.managerCount + permissionAuditSummary.userCount}명</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--primary)' }}>📑 <strong>권한매핑총수:</strong> {permissionAuditSummary.totalPermCount}건</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: permissionAuditSummary.ghostCount === 0 ? 'var(--success-light)' : 'rgba(239,68,68,0.15)',
            color: permissionAuditSummary.ghostCount === 0 ? 'var(--success)' : 'var(--danger)',
            fontWeight: 700,
            fontSize: '11px'
          }}>
            {permissionAuditSummary.ghostCount === 0 ? '⚖️ 대차 정상 (무효 고스트 권한 0건 무결)' : `⚠️ 고스트 권한 ${permissionAuditSummary.ghostCount}건 감지`}
          </span>
        </div>
      </div>
      <div style={{ height: '50px' }} aria-hidden="true" />
    </div>
  );
};
