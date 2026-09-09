import React, { useState, useEffect, useRef } from 'react';
import { 
  Network, Plus, Trash2, Edit2, AlertCircle, GripVertical, ChevronRight, 
  ChevronDown, CheckCircle, Upload, Save, X, User as UserIcon, Calendar, 
  MapPin, Phone, Mail, Download 
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db } from '../services/db';
import { exportToExcel } from '../services/excel';

// --- Type Definitions ---
interface Department {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  managerId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface UserNode {
  id: string;
  name: string;
  departmentId: string | null;
  department?: string;
  position: string;
  status: 'ACTIVE' | 'LEAVE_OF_ABSENCE' | 'RETIRED';
  role: string;
  loginId?: string;
  passwordHash?: string;
  birthDate?: string;
  joinDate?: string;
  baseSalary?: number; // 기본급 (원) - 급여 정산 권한자 전용
  address?: string;
  phone?: string;
  email?: string;
  profileImageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

const INITIAL_DEPTS: Department[] = [];

const INITIAL_USERS: UserNode[] = [];

export const OrganizationSettings: React.FC = () => {
  const { currentUser, saveUser, refreshAllData, showErrorModal, hasPermission } = useApp();
  const isSuperAdmin = currentUser?.loginId === 'admin';
  const canEdit = currentUser?.role === 'ADMIN' || hasPermission('organization', 'save');
  const canViewPayroll = hasPermission('payroll', 'view'); // 급여 정산 권한자 여부
  
  // --- States ---
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<UserNode[]>([]);

// Enforce manager policies across departments
const enforceManagerPolicies = (usersList: UserNode[], deptList: Department[]) => {
  let updated = [...usersList];
  deptList.forEach(dept => {
    const deptUsers = updated.filter(u => u.departmentId === dept.id);
    if (deptUsers.length === 0) return;
    const managers = deptUsers.filter(u => u.role === 'MANAGER');
    const isTop = dept.parentDepartmentId === null;
    if (isTop) {
      if (managers.length > 0) {
        const first = managers[0];
        updated = updated.map(u => {
          if (u.id === first.id) return { ...u, role: 'ADMIN' };
          if (u.role === 'MANAGER' && u.departmentId === dept.id) return { ...u, role: 'USER' };
          return u;
        });
      } else if (deptUsers.length === 1) {
        const sole = deptUsers[0];
        updated = updated.map(u => u.id === sole.id ? { ...u, role: 'ADMIN' } : u);
      }
    } else {
      if (managers.length > 1) {
        const first = managers[0];
        updated = updated.map(u => {
          if (u.id === first.id) return u;
          if (u.role === 'MANAGER' && u.departmentId === dept.id) return { ...u, role: 'USER' };
          return u;
        });
      } else if (managers.length === 0 && deptUsers.length === 1) {
        const sole = deptUsers[0];
        updated = updated.map(u => u.id === sole.id ? { ...u, role: 'MANAGER' } : u);
      }
    }
  });
  return updated;
};
  
  // Selection States
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [draggedUserId, setDraggedUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'DEPT' | 'UNASSIGNED'>('DEPT');
  
  // Editing Dept States
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editingDeptName, setEditingDeptName] = useState<string>('');
  
  // Profile Modal State (Slide-out)
  const [selectedProfile, setSelectedProfile] = useState<UserNode | null>(null);
  
  // Handoff Modal State
  const [showHandoffModal, setShowHandoffModal] = useState<UserNode | null>(null);

  // 부서 삭제 확인 모달 상태 (헌장 5.2: 브라우저 confirm 퇴출)
  const [deptToDelete, setDeptToDelete] = useState<Department | null>(null);

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Hidden File Input Ref for photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data load status
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // 전사 조직 및 구성원 현황 대차대조 집계 (헌장 3.5 & 5.5)
  const totalUsersCount = users.length;
  const activeUsersCount = users.filter(u => u.status === 'ACTIVE').length;
  const leaveUsersCount = users.filter(u => u.status === 'LEAVE_OF_ABSENCE').length;
  const retiredUsersCount = users.filter(u => u.status === 'RETIRED').length;
  const assignedUsersCount = users.filter(u => u.departmentId !== null).length;
  const unassignedUsersCount = users.filter(u => u.departmentId === null).length;
  const totalDeptsCount = departments.length;
  const userStatusSum = activeUsersCount + leaveUsersCount + retiredUsersCount;
  const userBalanceDiff = Math.abs(totalUsersCount - userStatusSum);

  // --- Persistence Load ---
  useEffect(() => {
    const savedDepts = localStorage.getItem('erp_departments');
    const savedUsers = localStorage.getItem('erp_users');
    
    let loadedDepts: Department[] = INITIAL_DEPTS;
    let loadedUsers: UserNode[] = INITIAL_USERS;

    if (savedDepts) {
      try {
        loadedDepts = JSON.parse(savedDepts);
      } catch (e) {
        loadedDepts = (db.departments && db.departments.length > 0) ? db.departments : INITIAL_DEPTS;
      }
    } else if (db.departments && db.departments.length > 0) {
      loadedDepts = db.departments;
    }

    if (savedUsers) {
      try {
        loadedUsers = JSON.parse(savedUsers);
      } catch (e) {
        loadedUsers = (db.users && db.users.length > 0) ? (db.users as any) : INITIAL_USERS;
      }
    } else if (db.users && db.users.length > 0) {
      loadedUsers = db.users as any;
    }

    // 🛡️ [테스터 영구 배제] 로컬스토리지나 DB 캐시에 잔존하는 테스터 계정 원천 차단
    const isTester = (u: any) =>
      u.id?.startsWith('usr-tester') ||
      u.name?.includes('테스터') ||
      u.loginId?.includes('tester');
    loadedUsers = loadedUsers.filter(u => !isTester(u));

    // 로컬 스토리지에 잔류할 수 있는 오염 필드(modelName, supplier 등) 원천 제거
    loadedDepts = loadedDepts.map(d => {
      const { modelName, supplier, ...rest } = (d as any);
      return rest as Department;
    });
    loadedUsers = loadedUsers.map(u => {
      const { modelName, supplier, ...rest } = (u as any);
      return rest as UserNode;
    });

    // 고아(Orphan) 직원 구출: 현재 존재하지 않는 부서 ID를 가진 직원은 '미배정(null)'으로 강제 이동
    const validDeptIds = new Set(loadedDepts.map(d => d.id));
    loadedUsers = loadedUsers.map(u => 
      u.departmentId && !validDeptIds.has(u.departmentId) 
        ? { ...u, departmentId: null } 
        : u
    );

    // 로컬스토리지 erp_users에서도 테스터 계정을 즉시 정화
    if (savedUsers) {
      localStorage.setItem('erp_users', JSON.stringify(loadedUsers));
    }

    setDepartments(loadedDepts);
    setUsers(loadedUsers);
    
    setIsLoaded(true);
  }, []);

  // --- Track Changes for Dirty State ---
  useEffect(() => {
    if (isLoaded) {
      setIsDirty(true);
    }
  }, [departments, users, isLoaded]);

  // --- Unload Warning ---
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = ''; // 브라우저 표준 경고창 유발
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // --- Manual Save (Batch to Supabase/DB) ---
  const handleSaveAll = async () => {
    try {
      // 로컬 스토리지 및 캐시 오염 필드(modelName, supplier 등) 정화
      const cleanDepts = departments.map(d => {
        const { modelName, supplier, ...rest } = (d as any);
        return rest as Department;
      });
      // 🛡️ [테스터 영구 배제] 테스터 계정이 DB로 유입되는 것을 원천 차단
      const isTester = (u: any) =>
        u.id?.startsWith('usr-tester') ||
        u.name?.includes('테스터') ||
        u.loginId?.includes('tester');
      const cleanUsers = users
        .filter(u => !isTester(u))
        .map(u => {
          const { modelName, supplier, ...rest } = (u as any);
          const dept = cleanDepts.find(d => d.id === u.departmentId);
          return {
            ...rest,
            department: dept ? dept.name : (rest.department || '')
          } as UserNode;
        });

      // 실제 DB (또는 로컬 백그라운드 큐)에 일괄 업데이트
      await db.saveOrganizationBatch(cleanDepts, cleanUsers as any);
      await db.awaitPendingWrites();
      
      // 상태 초기화
      setIsDirty(false);
      setDepartments(cleanDepts);
      setUsers(cleanUsers);
      
      // 혹시 모를 로컬스토리지 찌꺼기 덮어쓰기 (강제 동기화)
      localStorage.setItem('erp_departments', JSON.stringify(cleanDepts));
      localStorage.setItem('erp_users', JSON.stringify(cleanUsers));
      
      if (refreshAllData) {
        await refreshAllData();
      }
      
      showToast('조직도 및 구성원 마스터 데이터가 데이터베이스에 성공적으로 저장되었습니다.');
    } catch (err: any) {
      console.error('Organization batch save error:', err);
      showErrorModal(`⚠️ 조직도 및 구성원 저장 중 DB 동기화 오류가 발생했습니다:\n${err.message || err.details || JSON.stringify(err)}`, '조직도 DB 저장 오류');
    }
  };

  // --- Action Handlers ---
  const handleAddDept = () => {
    if (!canEdit) return;
    const nowIso = new Date().toISOString();
    const newDept: Department = {
      id: db.generateNextId('departments', departments),
      name: '',
      parentDepartmentId: selectedDeptId || null,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    setDepartments([...departments, newDept]);
    setEditingDeptId(newDept.id);
    setEditingDeptName('');
  };

  const handleDeleteDept = (e: React.MouseEvent, deptId: string) => {
    e.stopPropagation();
    if (!canEdit) return;
    const targetDept = departments.find(d => d.id === deptId);
    if (!targetDept) return;

    const hasChildren = departments.some(d => d.parentDepartmentId === deptId);
    const hasUsers = users.some(u => u.departmentId === deptId);
    if (hasChildren || hasUsers) {
      showErrorModal(
        `소속된 하위 부서나 직원이 존재하여 부서 [${targetDept.name || targetDept.id}]을(를) 삭제할 수 없습니다.\n` +
        `소속 직원을 먼저 인사이동하거나 하위 부서를 먼저 정리해 주십시오.`,
        '부서 삭제 불가'
      );
      return;
    }
    setDeptToDelete(targetDept);
  };

  const confirmDeleteDept = () => {
    if (!deptToDelete) return;
    const deptId = deptToDelete.id;
    setDepartments(prev => prev.filter(d => d.id !== deptId));
    if (selectedDeptId === deptId) {
      setSelectedDeptId(null);
      setActiveTab('UNASSIGNED');
    }
    showToast(`부서 [${deptToDelete.name || deptToDelete.id}]이(가) 정상 삭제되었습니다.`);
    setDeptToDelete(null);
  };

  const handleAddUser = () => {
    if (!canEdit) return;
    const nowIso = new Date().toISOString();
    const newUser: UserNode = {
      id: db.generateNextId('users', users.map(u => ({ id: u.id }))),
      name: '',
      departmentId: null, // 무조건 미배정으로 생성
      position: '',
      status: 'ACTIVE',
      role: 'USER',
      loginId: '',
      passwordHash: '',
      createdAt: nowIso,
      updatedAt: nowIso
    };
    let updated = [...users, newUser];
    updated = enforceManagerPolicies(updated, departments);
    setUsers(updated);
    setActiveTab('UNASSIGNED');
    setSelectedProfile(newUser);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && selectedProfile) {
      const file = e.target.files[0];
      const imageUrl = URL.createObjectURL(file);
      setSelectedProfile({ ...selectedProfile, profileImageUrl: imageUrl });
    }
  };

  // --- Drag & Drop Handlers ---
  const handleDragStart = (e: React.DragEvent, userId: string) => {
    if (!canEdit) return;
    setDraggedUserId(userId);
    e.dataTransfer.setData('text/plain', userId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropToDept = (e: React.DragEvent, targetDeptId: string) => {
    e.preventDefault();
    if (!canEdit || !draggedUserId) return;
    
    const targetDept = departments.find(d => d.id === targetDeptId);
    let updated = users.map(u => 
      u.id === draggedUserId ? { ...u, departmentId: targetDeptId, department: targetDept?.name || '' } : u
    );
    updated = enforceManagerPolicies(updated, departments);
    setUsers(updated);
    setDraggedUserId(null);
  };

  const handleDropToPool = (e: React.DragEvent) => {
    e.preventDefault();
    if (!canEdit || !draggedUserId) return;
    
    let updated = users.map(u => 
      u.id === draggedUserId ? { ...u, departmentId: null, department: '' } : u
    );
    updated = enforceManagerPolicies(updated, departments);
    setUsers(updated);
    setDraggedUserId(null);
  };

  // --- Department Edit Handlers ---
  const startEditDept = (e: React.MouseEvent, dept: Department) => {
    e.stopPropagation();
    if (!canEdit) return;
    setEditingDeptId(dept.id);
    setEditingDeptName(dept.name);
  };

  const commitEditDept = () => {
    if (editingDeptName.trim()) {
      setDepartments(prev => prev.map(d => 
        d.id === editingDeptId ? { ...d, name: editingDeptName.trim() } : d
      ));
    }
    setEditingDeptId(null);
  };

  const handleDeptKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEditDept();
    if (e.key === 'Escape') setEditingDeptId(null);
  };

  // --- Profile Handlers ---
  const handleStatusChange = async (userId: string, newStatus: UserNode['status']) => {
    const targetUser = users.find(u => u.id === userId);
    if (targetUser && (targetUser.loginId === 'admin' || targetUser.id === 'u-1' || targetUser.id === 'sys-admin')) {
      showErrorModal('최고관리자(시스템관리자/admin) 계정은 재직 상태를 변경(퇴사/휴직 처리)할 수 없습니다.', '상태 변경 불가');
      return;
    }
    
    if (newStatus === 'RETIRED') {
      if (targetUser) setShowHandoffModal(targetUser);
    } else {
      const updatedUser = targetUser ? { ...targetUser, status: newStatus } : null;
      if (updatedUser) {
        saveUser(updatedUser);
        await db.awaitPendingWrites();
      }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
      if (selectedProfile && selectedProfile.id === userId) {
        setSelectedProfile({ ...selectedProfile, status: newStatus });
      }
      showToast(`재직 상태가 [${newStatus === 'ACTIVE' ? '재직' : newStatus === 'LEAVE_OF_ABSENCE' ? '휴직' : '퇴사'}] (으)로 변경되었습니다.`);
    }
  };

  const confirmRetirement = async () => {
    if (showHandoffModal) {
      if (showHandoffModal.loginId === 'admin' || showHandoffModal.id === 'u-1' || showHandoffModal.id === 'sys-admin') {
        showErrorModal('최고관리자 계정은 퇴사 처리가 불가능합니다.', '퇴사 처리 불가');
        setShowHandoffModal(null);
        return;
      }
      const retiredUser: UserNode = { ...showHandoffModal, status: 'RETIRED' };
      saveUser(retiredUser);
      await db.awaitPendingWrites();

      setUsers(prev => prev.map(u => u.id === showHandoffModal.id ? retiredUser : u));
      if (selectedProfile?.id === showHandoffModal.id) {
        setSelectedProfile(prev => prev ? { ...prev, status: 'RETIRED' } : null);
      }
      showToast(`${showHandoffModal.name} 직원의 퇴사 및 업무 이관 처리가 완료되었습니다.`);
      setShowHandoffModal(null);
    }
  };

  const applyProfileChanges = async () => {
    if (selectedProfile) {
      if (!selectedProfile.name || !selectedProfile.name.trim()) {
        showErrorModal('임직원 성명을 입력해 주십시오.', '필수값 누락');
        return;
      }
      if ((selectedProfile.id === 'sys-admin' || selectedProfile.id === 'u-1' || selectedProfile.loginId === 'admin') && selectedProfile.role !== 'ADMIN') {
        showErrorModal('시스템 최고관리자의 시스템 역할은 변경할 수 없습니다.', '역할 변경 불가');
        return;
      }
      if (selectedProfile.role === 'ADMIN' && !isSuperAdmin) {
        showErrorModal('ADMIN 시스템 역할은 최고관리자(admin) 계정만 부여할 수 있습니다.', '권한 부여 제한');
        return;
      }
      let updated = users.map(u => u.id === selectedProfile.id ? selectedProfile : u);
      updated = enforceManagerPolicies(updated, departments);
      
      // DB 및 AppContext 데이터 저장 전파
      updated.forEach(u => {
        saveUser(u);
      });
      await db.awaitPendingWrites();
      
      setUsers(updated);
      setSelectedProfile(null);
      showToast('임직원 프로필 및 시스템 역할(role) 설정이 성공적으로 저장되었습니다.');
    }
  };

  // 임직원 대장 엑셀 내보내기
  const handleExportOrgExcel = () => {
    if (users.length === 0) {
      showToast('내보낼 임직원 데이터가 없습니다.', 'error');
      return;
    }
    const deptMap = new Map(departments.map(d => [d.id, d.name]));
    const rows = users.map((u, idx) => {
      const deptName = u.departmentId ? (deptMap.get(u.departmentId) || u.department || '미지정') : (u.department || '미배치');
      const statusLabel = u.status === 'ACTIVE' ? '재직' : u.status === 'RETIRED' ? '퇴사' : '휴직';
      const row: any = {
        'No': idx + 1,
        '성명': u.name || '-',
        '아이디': u.loginId || '-',
        '소속부서': deptName,
        '직급': u.position || '-',
        '역할/권한': u.role || 'USER',
        '재직상태': statusLabel,
        '입사일': u.joinDate || '-',
        '생년월일': u.birthDate || '-',
        '연락처': u.phone || '-',
        '이메일': u.email || '-',
        '주소': u.address || '-'
      };
      if (canViewPayroll) {
        row['기본급(원)'] = u.baseSalary || 0;
      }
      return row;
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    exportToExcel(rows, `임직원대장_${todayStr}`, '임직원');
    showToast(`임직원 대장 ${rows.length}명 엑셀 내보내기 완료`);
  };

  // --- Renders ---
  const renderDeptTree = (parentId: string | null, depth: number = 0) => {
    const children = departments.filter(d => d.parentDepartmentId === parentId);
    if (children.length === 0) return null;

    return (
      <div style={{ marginLeft: depth > 0 ? '20px' : '0' }}>
        {children.map(dept => {
          const isSelected = selectedDeptId === dept.id;
          const userCount = users.filter(u => u.departmentId === dept.id).length;
          
          return (
            <div key={dept.id}>
              <div 
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropToDept(e, dept.id)}
                onClick={() => {
                  if (editingDeptId !== dept.id) {
                    setSelectedDeptId(dept.id);
                    setActiveTab('DEPT');
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 12px',
                  margin: '4px 0',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isSelected ? 'var(--primary-light)' : 'transparent',
                  color: isSelected ? 'var(--primary)' : 'var(--text-main)',
                  border: isSelected ? '1px solid var(--primary-border)' : '1px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  borderStyle: draggedUserId ? 'dashed' : 'solid'
                }}
                className={draggedUserId ? 'drop-target-active' : ''}
              >
                {departments.some(d => d.parentDepartmentId === dept.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                
                {editingDeptId === dept.id ? (
                  <input 
                    type="text"
                    placeholder="부서명 입력 (예: 영남영업소)"
                    value={editingDeptName}
                    onChange={(e) => setEditingDeptName(e.target.value)}
                    onBlur={commitEditDept}
                    onKeyDown={handleDeptKeyDown}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, padding: '2px 6px', fontSize: '14px', height: 'auto' }}
                  />
                ) : (
                  <>
                    <span style={{ fontWeight: isSelected ? '600' : '400', flex: 1, color: dept.name ? 'inherit' : 'var(--text-muted)' }}>
                      {dept.name || '새 부서(명칭 미입력)'}
                    </span>
                    <span style={{ fontSize: '11px', padding: '2px 6px', backgroundColor: 'var(--bg-card)', borderRadius: '10px', color: 'var(--text-secondary)' }}>
                      {userCount}명
                    </span>
                    {canEdit && isSelected && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={(e) => startEditDept(e, dept)} style={{ padding: '4px', background: 'transparent', color: 'var(--text-muted)' }} title="부서명 수정">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={(e) => handleDeleteDept(e, dept.id)} style={{ padding: '4px', background: 'transparent', color: 'var(--danger)' }} title="부서 삭제">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              {renderDeptTree(dept.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderUserCard = (user: UserNode) => (
    <div 
      key={user.id}
      draggable={canEdit}
      onDragStart={(e) => handleDragStart(e, user.id)}
      onDoubleClick={() => setSelectedProfile(user)}
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
        backgroundColor: 'var(--bg-card)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        cursor: canEdit ? 'grab' : 'pointer',
        opacity: draggedUserId === user.id ? 0.5 : 1,
        position: 'relative',
        transition: 'all 0.2s ease'
      }}
      title="더블클릭하여 상세 프로필 수정"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        {canEdit && <GripVertical size={16} color="var(--text-muted)" style={{ cursor: 'grab', marginTop: '4px' }} />}
        
        {/* Avatar */}
        <div style={{
          width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--primary-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)',
          backgroundImage: user.profileImageUrl ? `url(${user.profileImageUrl})` : 'none',
          backgroundSize: 'cover', backgroundPosition: 'center', flexShrink: 0
        }}>
          {!user.profileImageUrl && (user.name ? user.name.substring(0, 1) : '신')}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: '700', fontSize: '15px', color: user.name ? 'var(--text-main)' : 'var(--text-muted)' }}>
              {user.name || '신규직원(이름 미입력)'}
            </div>
            <span style={{ 
              fontSize: '11px', padding: '2px 8px', borderRadius: '12px', fontWeight: '600',
              backgroundColor: user.status === 'ACTIVE' ? 'var(--success-light)' : user.status === 'RETIRED' ? 'var(--danger-light)' : 'var(--warning-light)',
              color: user.status === 'ACTIVE' ? 'var(--success)' : user.status === 'RETIRED' ? 'var(--danger)' : 'var(--warning)'
            }}>
              {user.status === 'ACTIVE' ? '재직' : user.status === 'RETIRED' ? '퇴사' : '휴직'}
            </span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {user.position || '직급 미지정'} | {user.role}
          </div>
          {user.phone && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>📞 {user.phone}</div>}
        </div>
      </div>
    </div>
  );

  const displayedUsers = activeTab === 'DEPT' 
    ? users.filter(u => u.departmentId === selectedDeptId)
    : users.filter(u => u.departmentId === null);

  const unassignedCount = users.filter(u => u.departmentId === null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative', minHeight: '900px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Network size={24} color="var(--primary)" />
            인사 및 조직도 마스터 설정
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            전사 임직원의 상세 프로필과 부서 배치, 입/퇴사 이력을 통합 관리합니다.
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportOrgExcel}
            style={{ padding: '9px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <Download size={15} /> 엑셀 내보내기
          </button>
          {/* Global Save Button */}
          {canEdit && (
            <button 
              className={`btn-primary ${isDirty ? 'pulse-animation' : ''}`} 
              onClick={handleSaveAll} 
              style={{ 
                padding: '10px 20px', 
                backgroundColor: isDirty ? 'var(--danger)' : 'var(--primary)',
                boxShadow: isDirty ? '0 0 10px rgba(239, 68, 68, 0.5)' : 'none',
                transition: 'all 0.3s ease'
              }}
            >
              <Save size={16} /> {isDirty ? '전체 저장 (변경됨)' : '전체 저장'}
            </button>
          )}
        </div>
      </div>

      {/* 📊 조직 및 임직원 현황 실시간 요약 바 */}
      {(() => {
        const activeUsersCount = users.filter(u => u.status === 'ACTIVE').length;
        const leaveCount = users.filter(u => u.status === 'LEAVE_OF_ABSENCE').length;
        const retiredCount = users.filter(u => u.status === 'RETIRED').length;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 조직 부서</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{departments.length}개 부서</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>재직 임직원</span>
              <strong style={{ fontSize: '15px', color: '#16a34a' }}>{activeUsersCount}명</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>부서 미배치 / 휴·퇴사</span>
              <strong style={{ fontSize: '15px', color: (unassignedCount + leaveCount + retiredCount) > 0 ? '#d97706' : 'var(--text-muted)' }}>{unassignedCount + leaveCount + retiredCount}명</strong>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        
        {/* 좌측: 조직 트리 */}
        <div className="card" style={{ width: '280px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700' }}>조직 구조도</h3>
            {canEdit && (
              <button onClick={handleAddDept} style={{ background: 'transparent', padding: '4px', color: 'var(--primary)' }} title="선택된 부서 아래에 하위 부서 추가">
                <Plus size={18} />
              </button>
            )}
          </div>
          <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
            {renderDeptTree(null)}
          </div>
          
          {/* 미배정 임직원 풀 버튼 */}
          <div 
            onClick={() => setActiveTab('UNASSIGNED')}
            onDragOver={handleDragOver}
            onDrop={handleDropToPool}
            style={{
              marginTop: '12px', padding: '10px 12px', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)',
              backgroundColor: activeTab === 'UNASSIGNED' ? 'var(--primary-light)' : 'var(--bg-app)',
              color: activeTab === 'UNASSIGNED' ? 'var(--primary)' : 'var(--text-secondary)',
              cursor: 'pointer', textAlign: 'center', fontWeight: '600', fontSize: '13.5px',
              transition: 'all 0.2s ease', borderStyle: draggedUserId ? 'solid' : 'dashed', borderColor: draggedUserId ? 'var(--primary)' : 'var(--border-color)'
            }}
            className={draggedUserId ? 'drop-target-active' : ''}
          >
            미배정 인력 풀 (Pool)
            <div style={{ fontSize: '11.5px', color: 'var(--danger)', marginTop: '2px' }}>{unassignedCount}명 대기 중</div>
          </div>
        </div>

        {/* 중앙: 직원 리스트 뷰 */}
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700' }}>
              {activeTab === 'DEPT' 
                ? `${departments.find(d => d.id === selectedDeptId)?.name || '선택된 부서'} 소속원 (${displayedUsers.length}명)`
                : `미배정 대기 임직원 (${displayedUsers.length}명)`}
            </h3>
            {canEdit && (
              <button className="btn-secondary" onClick={handleAddUser} style={{ padding: '6px 12px', fontSize: '13px' }}>
                <Plus size={14} style={{ marginRight: '4px' }} /> 신규 직원 등록
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', alignContent: 'start', overflowY: 'auto', flex: 1, padding: '4px' }}>
            {displayedUsers.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                이 목록에 직원이 없습니다.
              </div>
            ) : (
              displayedUsers.map(user => renderUserCard(user))
            )}
          </div>
        </div>
      </div>

      {/* 우측: Slide-out 상세 프로필 모달 */}
      {selectedProfile && (
        <>
          {/* Backdrop */}
          <div 
            onClick={() => setSelectedProfile(null)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 40 }}
          />
          
          {/* Panel */}
          <div className="card slide-in-right" style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: '340px', margin: 0, borderRadius: 0,
            boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', zIndex: 50, display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid var(--border-color)', padding: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '700' }}>상세 프로필</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {canEdit && (
                  <>
                    <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => setSelectedProfile(null)}>
                      취소
                    </button>
                    <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={applyProfileChanges}>
                      <CheckCircle size={13} style={{ marginRight: '3px' }} /> 저장 (적용)
                    </button>
                  </>
                )}
                <button onClick={() => setSelectedProfile(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', padding: '4px', cursor: 'pointer' }} title="닫기">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
              {/* Profile Image Upload Area */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'var(--primary-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: 'var(--primary)',
                  backgroundImage: selectedProfile.profileImageUrl ? `url(${selectedProfile.profileImageUrl})` : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center', marginBottom: '4px', border: '2px solid var(--border-color)'
                }}>
                  {!selectedProfile.profileImageUrl && (selectedProfile.name ? selectedProfile.name.substring(0, 1) : '신')}
                </div>
                {canEdit && (
                  <>
                    <input 
                      type="file" 
                      accept="image/*" 
                      ref={fileInputRef} 
                      onChange={handlePhotoUpload} 
                      style={{ display: 'none' }} 
                    />
                    <button className="btn-secondary" onClick={() => fileInputRef.current?.click()} style={{ fontSize: '11px', padding: '3px 8px' }}>
                      <Upload size={12} style={{ marginRight: '4px' }} /> 사진 변경
                    </button>
                  </>
                )}
              </div>

              {/* Form Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div>
                    <label style={{ marginBottom: '2px', color: 'var(--primary)', fontWeight: 'bold', fontSize: '12px' }}>로그인 아이디 (ID)</label>
                    <input type="text" style={{ padding: '4px 8px', fontSize: '12px' }} placeholder="시스템 로그인 ID" value={selectedProfile.loginId || ''} onChange={e => setSelectedProfile({...selectedProfile, loginId: e.target.value})} disabled={!canEdit} />
                  </div>
                  <div>
                    <label style={{ marginBottom: '2px', color: 'var(--primary)', fontWeight: 'bold', fontSize: '12px' }}>초기 비밀번호</label>
                    <input type="password" style={{ padding: '4px 8px', fontSize: '12px' }} placeholder="비밀번호" value={selectedProfile.passwordHash || ''} onChange={e => setSelectedProfile({...selectedProfile, passwordHash: e.target.value})} disabled={!canEdit} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div>
                    <label style={{ marginBottom: '2px', fontSize: '12px' }}>이름</label>
                    <input 
                      type="text" 
                      style={{ padding: '4px 8px', fontSize: '12px' }} 
                      placeholder="이름 입력 (예: 홍길동)"
                      value={selectedProfile.name} 
                      onChange={e => setSelectedProfile({...selectedProfile, name: e.target.value})} 
                      disabled={!canEdit} 
                    />
                  </div>
                  <div>
                    <label style={{ marginBottom: '2px', fontSize: '12px' }}>상태</label>
                    <select 
                      value={selectedProfile.status} 
                      onChange={e => handleStatusChange(selectedProfile.id, e.target.value as UserNode['status'])}
                      disabled={!canEdit}
                      style={{ 
                        padding: '4px 8px', fontSize: '12px',
                        color: selectedProfile.status === 'ACTIVE' ? 'var(--success)' : selectedProfile.status === 'RETIRED' ? 'var(--danger)' : 'var(--warning)',
                        fontWeight: 'bold'
                      }}
                    >
                      <option value="ACTIVE">재직</option>
                      <option value="LEAVE_OF_ABSENCE">휴직</option>
                      <option value="RETIRED">퇴사 처리</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div>
                    <label style={{ marginBottom: '2px', fontSize: '12px' }}>직급</label>
                    <input 
                      type="text" 
                      style={{ padding: '4px 8px', fontSize: '12px' }} 
                      placeholder="직급 입력 (예: 사원/대리)"
                      value={selectedProfile.position} 
                      onChange={e => setSelectedProfile({...selectedProfile, position: e.target.value})} 
                      disabled={!canEdit} 
                    />
                  </div>
                  <div>
                    <label style={{ marginBottom: '2px', fontSize: '12px' }}>시스템 역할</label>
                    <select 
                      value={selectedProfile.role} 
                      style={{ padding: '4px 8px', fontSize: '12px' }} 
                      onChange={e => setSelectedProfile({...selectedProfile, role: e.target.value})} 
                      disabled={!canEdit || selectedProfile.id === 'sys-admin'}
                    >
                      {isSuperAdmin && <option value="ADMIN">ADMIN</option>}
                      <option value="MANAGER">MANAGER</option>
                      <option value="USER">USER</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ marginBottom: '2px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-main)' }}>소속 부서 (부서 이동)</label>
                  <select
                    value={selectedProfile.departmentId || ''}
                    style={{ padding: '4px 8px', fontSize: '12px', width: '100%', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                    onChange={e => {
                      const newDeptId = e.target.value || null;
                      const targetDept = departments.find(d => d.id === newDeptId);
                      setSelectedProfile({ ...selectedProfile, departmentId: newDeptId, department: targetDept?.name || '' });
                      let updated = users.map(u => u.id === selectedProfile.id ? { ...u, departmentId: newDeptId, department: targetDept?.name || '' } : u);
                      updated = enforceManagerPolicies(updated, departments);
                      setUsers(updated);
                      setIsDirty(true);
                      showToast(`소속 부서가 [${targetDept?.name || '미배정'}] (으)로 변경되었습니다. 상단 저장을 눌러 확정하세요.`, 'warning');
                    }}
                    disabled={!canEdit}
                  >
                    <option value="">(미배정 인재풀)</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ marginBottom: '2px', fontSize: '12px' }}><Phone size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> 휴대전화</label>
                  <input type="text" style={{ padding: '4px 8px', fontSize: '12px' }} placeholder="010-0000-0000" value={selectedProfile.phone || ''} onChange={e => setSelectedProfile({...selectedProfile, phone: e.target.value})} disabled={!canEdit} />
                </div>
                
                <div>
                  <label style={{ marginBottom: '2px', fontSize: '12px' }}><Mail size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> 이메일</label>
                  <input type="email" style={{ padding: '4px 8px', fontSize: '12px' }} placeholder="example@giyeun.com" value={selectedProfile.email || ''} onChange={e => setSelectedProfile({...selectedProfile, email: e.target.value})} disabled={!canEdit} />
                </div>

                <div>
                  <label style={{ marginBottom: '2px', fontSize: '12px' }}><Calendar size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> 생년월일</label>
                  <input type="date" style={{ padding: '4px 8px', fontSize: '12px' }} value={selectedProfile.birthDate || ''} onChange={e => setSelectedProfile({...selectedProfile, birthDate: e.target.value})} disabled={!canEdit} />
                </div>

                <div>
                  <label style={{ marginBottom: '2px', fontSize: '12px' }}><MapPin size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> 자택 주소</label>
                  <input type="text" style={{ padding: '4px 8px', fontSize: '12px' }} placeholder="자택 주소 입력" value={selectedProfile.address || ''} onChange={e => setSelectedProfile({...selectedProfile, address: e.target.value})} disabled={!canEdit} />
                </div>

                {/* 급여 정산 권한자 전용 계약 기본급 설정 */}
                {canViewPayroll && (
                  <div style={{ marginTop: '6px', padding: '10px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <label style={{ marginBottom: '4px', fontSize: '12px', fontWeight: 'bold', color: 'var(--primary)', display: 'block' }}>
                      💰 계약 기본급 (원) [급여 권한자 전용]
                    </label>
                    <input
                      type="number"
                      step="10000"
                      min="0"
                      style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 'bold' }}
                      placeholder="기본급 입력 (예: 3500000)"
                      value={selectedProfile.baseSalary || ''}
                      onChange={e => setSelectedProfile({...selectedProfile, baseSalary: parseInt(e.target.value) || 0})}
                      disabled={!canEdit}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                      * 통상시급: 약 {Math.round((selectedProfile.baseSalary || 3000000) / 209).toLocaleString()}원/시간 (209h 기준)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Hand-off Alert Modal for Retirement */}
      {showHandoffModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div className="card" style={{ width: '450px', padding: '24px' }}>
            <div style={{ display: 'flex', gap: '12px', color: 'var(--danger)', marginBottom: '16px' }}>
              <AlertCircle size={28} />
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginTop: '2px' }}>퇴사 처리 및 업무 이관 (Hand-off)</h3>
            </div>
            
            <p style={{ fontSize: '14px', color: 'var(--text-main)', lineHeight: '1.5' }}>
              <strong>{showHandoffModal.name}</strong> 직원을 '퇴사' 상태로 변경하시겠습니까?<br/><br/>
              현재 이 직원이 담당하고 있는 <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>진행 중인 미결 업무가 발견</span>되었습니다.<br/>
              퇴사 처리 시 해당 미결 업무는 직속 상급자(부서장)에게 강제 이관됩니다.
            </p>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn-secondary" onClick={() => setShowHandoffModal(null)}>취소</button>
              <button className="btn-primary" style={{ backgroundColor: 'var(--danger)' }} onClick={confirmRetirement}>
                확인 및 이관 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 부서 삭제 확인 모달 (헌장 5.2: 브라우저 confirm 전면 퇴출) */}
      {deptToDelete && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div className="card" style={{ width: '420px', padding: '24px' }}>
            <div style={{ display: 'flex', gap: '12px', color: 'var(--danger)', marginBottom: '16px' }}>
              <AlertCircle size={28} />
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginTop: '2px' }}>부서 삭제 확인</h3>
            </div>
            
            <p style={{ fontSize: '14px', color: 'var(--text-main)', lineHeight: '1.5' }}>
              부서 <strong>[{deptToDelete.name || deptToDelete.id}]</strong>을(를) 정말 삭제하시겠습니까?<br/>
              현재 소속된 직원 및 하위 부서가 없으므로 안전하게 삭제됩니다.
            </p>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn-secondary" onClick={() => setDeptToDelete(null)}>취소</button>
              <button className="btn-primary" style={{ backgroundColor: 'var(--danger)' }} onClick={confirmDeleteDept}>
                부서 삭제 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚖️ 헌장 3.5 Gutenberg Z-패턴 4단계 조직/인사 대차대조 검증 바 */}
      <div style={{
        marginTop: '16px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '12px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.03)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>
            조직 및 인사 대차대조 검증:
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            총 임직원 <strong style={{ color: 'var(--text-main)' }}>{totalUsersCount}명</strong>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>=</span>
          <span style={{ fontSize: '12px', color: '#10b981' }}>
            재직 <strong>{activeUsersCount}명</strong>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>+</span>
          <span style={{ fontSize: '12px', color: '#f59e0b' }}>
            휴직 <strong>{leaveUsersCount}명</strong>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>+</span>
          <span style={{ fontSize: '12px', color: '#ef4444' }}>
            퇴사 <strong>{retiredUsersCount}명</strong>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>|</span>
          <span style={{ fontSize: '12px', color: 'var(--primary)' }}>
            부서 {totalDeptsCount}개 (배정 {assignedUsersCount}명 / 미배정 {unassignedUsersCount}명)
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
          <span style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '6px',
            fontWeight: 'bold',
            backgroundColor: userBalanceDiff === 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            color: userBalanceDiff === 0 ? '#10b981' : '#ef4444'
          }}>
            대차 차액 {userBalanceDiff}명 {userBalanceDiff === 0 ? '(정합)' : '(불일치)'}
          </span>
        </div>
      </div>

      {/* 토스트 알림 팝업 (헌장 5.2) */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          padding: '12px 20px',
          borderRadius: '8px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : toastMessage.type === 'warning' ? '#f59e0b' : '#10b981',
          color: '#fff',
          fontWeight: 700,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {toastMessage.text}
        </div>
      )}

    </div>
  );
};
