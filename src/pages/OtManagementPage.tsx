import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import { Clock, Trash2, Download, Search, CheckCircle2, Plus, Minus, RotateCcw, ChevronLeft, ChevronRight, Calendar, List, X, Printer } from 'lucide-react';
import { User as UserType, Department, db } from '../services/db';
import { OtApprovalDocumentModal } from '../components/OtApprovalDocumentModal';

const getDayOfWeekKr = (dateStr: string) => {
  if (!dateStr) return '';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3) return '';
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return days[dt.getDay()] || '';
};

const getTodayYmd = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getYesterdayYmd = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const OT_REASON_PRESETS = [
  '특근',
  '야간 출고·상하차',
  '긴급 현장 AS',
  '주말 장비정비',
  '긴급 배차·회수',
  '재고 실사'
];

// 표준 부서 순서 폴백 (DB 부서 미로딩 시 대비)
const DEPT_FALLBACK_ORDER: Record<string, number> = {
  'DEPT-0000001': 0, 'DEPT-1': 0,  // 기연리프트 (경영진)
  'DEPT-0000002': 1, 'DEPT-2': 1,  // 관리부
  'DEPT-0000003': 2, 'DEPT-3': 2,  // 영업부
  'DEPT-0000004': 3, 'DEPT-4': 3,  // 출고팀
  'DEPT-0000005': 4, 'DEPT-5': 4,  // AS팀
  'DEPT-0000006': 5, 'DEPT-6': 5,  // 외국인
};

// 표준 부서명 매핑 폴백
const DEPT_FALLBACK_NAMES: Record<string, string> = {
  'DEPT-0000001': '기연리프트', 'DEPT-1': '기연리프트',
  'DEPT-0000002': '관리부', 'DEPT-2': '관리부',
  'DEPT-0000003': '영업부', 'DEPT-3': '영업부',
  'DEPT-0000004': '출고팀', 'DEPT-4': '출고팀',
  'DEPT-0000005': 'AS팀', 'DEPT-5': 'AS팀',
  'DEPT-0000006': '외국인', 'DEPT-6': '외국인',
};

// 직급 서열 가중치 (사장/대표 -> 부사장 -> 전무 -> 상무 -> 부장 -> 차장 -> 팀장 -> 과장 -> 대리 -> 주임 -> 사원)
const POSITION_RANK: Record<string, number> = {
  '대표': 1, '대표이사': 1, '사장': 1,
  '부사장': 2,
  '전무': 3, '전무이사': 3,
  '상무': 4, '상무이사': 4,
  '이사': 5,
  '본부장': 6,
  '부장': 7,
  '차장': 8,
  '팀장': 9, '실장': 9,
  '과장': 10,
  '대리': 11,
  '주임': 12, '계장': 12,
  '사원': 13,
  'D.RPA': 20
};

export const OtManagementPage: React.FC = () => {
  const {
    users,
    overtimeRecords,
    currentUser,
    hasPermission,
    showErrorModal,
    addOvertimeRecord,
    deleteOvertimeRecord,
    loadTablesForMenu
  } = useApp();

  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [isApprovalDocModalOpen, setIsApprovalDocModalOpen] = useState<boolean>(false);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 최신 부서 및 OT 데이터 동기화
  useEffect(() => {
    if (loadTablesForMenu) {
      loadTablesForMenu('ot_management');
    }
  }, []);

  // 조직도 부서 로딩 및 맵 생성 (DB 최신화 연동)
  const departments: Department[] = useMemo(() => {
    if (db.departments && db.departments.length > 0) {
      return db.departments;
    }
    const local = localStorage.getItem('erp_departments');
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    return [];
  }, [users, overtimeRecords]);

  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    departments.forEach(d => map.set(d.id, d.name));
    return map;
  }, [departments]);

  // 조직도 트리 깊이 우선 탐색(DFS) 순서 배열 (조직도 화면과 100% 동일 배치)
  const orderedDeptIds = useMemo(() => {
    const ordered: string[] = [];
    const traverse = (parentId: string | null) => {
      departments
        .filter(d => d.parentDepartmentId === parentId)
        .forEach(d => {
          ordered.push(d.id);
          traverse(d.id);
        });
    };
    traverse(null);
    return ordered;
  }, [departments]);

  const getDeptOrder = (deptId?: string | null): number => {
    if (!deptId) return 9999;
    const idx = orderedDeptIds.indexOf(deptId);
    if (idx !== -1) return idx;
    const fallback = DEPT_FALLBACK_ORDER[deptId] ?? DEPT_FALLBACK_ORDER[deptId.toUpperCase()];
    if (fallback !== undefined) return fallback;
    return 9999;
  };

  const getPositionRank = (pos?: string): number => {
    if (!pos) return 50;
    return POSITION_RANK[pos] || 30;
  };

  const isTester = (u: any) =>
    u.id?.startsWith('usr-tester') ||
    u.name?.includes('테스터') ||
    u.loginId?.includes('tester');

  // 🏛️ 조직도의 부서 및 직급 배치 순서대로 정렬된 임직원 목록
  const sortedUsers = useMemo(() => {
    const nonTesters = users.filter(u => !isTester(u));
    return [...nonTesters].sort((a, b) => {
      // 1. 조직도 부서 배치 순서 (기연리프트 -> 관리부 -> 영업부 -> 출고팀 -> AS팀 -> 외국인)
      const deptA = getDeptOrder(a.departmentId);
      const deptB = getDeptOrder(b.departmentId);
      if (deptA !== deptB) return deptA - deptB;

      // 2. 부서 내 직급 서열 (사장 -> 부사장 -> 상무 -> 부장 -> 차장 -> 팀장 -> 과장 -> 대리 -> 주임 -> 사원)
      const posA = getPositionRank(a.position);
      const posB = getPositionRank(b.position);
      if (posA !== posB) return posA - posB;

      // 3. 역할 가중치 (ADMIN > MANAGER > USER)
      const roleWeightA = a.role === 'ADMIN' ? 0 : a.role === 'MANAGER' ? 1 : 2;
      const roleWeightB = b.role === 'ADMIN' ? 0 : b.role === 'MANAGER' ? 1 : 2;
      if (roleWeightA !== roleWeightB) return roleWeightA - roleWeightB;

      // 4. 성명 가나다순
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }, [users, orderedDeptIds]);

  // 🔍 다계층 임직원 검색 헬퍼 (대소문자, loginId, 성명, 최고관리자 Fallback 완벽 지원)
  const findUser = (userId?: string): UserType | undefined => {
    if (!userId) return undefined;
    const cleanId = String(userId).trim();
    // 1. sortedUsers / users 에서 id 일치 (엄격 + 대소문자 무시)
    let found = sortedUsers.find(u => u.id === cleanId || u.id?.toLowerCase() === cleanId.toLowerCase())
             || users.find(u => u.id === cleanId || u.id?.toLowerCase() === cleanId.toLowerCase());
    if (found) return found;

    // 2. loginId 일치 (대소문자 무시)
    found = sortedUsers.find(u => u.loginId === cleanId || u.loginId?.toLowerCase() === cleanId.toLowerCase())
         || users.find(u => u.loginId === cleanId || u.loginId?.toLowerCase() === cleanId.toLowerCase());
    if (found) return found;

    // 3. 성명(name) 일치
    found = sortedUsers.find(u => u.name === cleanId)
         || users.find(u => u.name === cleanId);
    if (found) return found;

    // 4. sys-admin 및 admin 계정 Fallback
    if (cleanId === 'sys-admin' || cleanId.toLowerCase() === 'admin') {
      return {
        id: cleanId,
        loginId: 'admin',
        name: '최고관리자',
        department: '시스템',
        role: 'ADMIN'
      } as UserType;
    }

    return undefined;
  };

  const getEmployeeDeptName = (u?: UserType): string => {
    if (!u) return '';
    if (u.departmentId) {
      if (departmentMap.has(u.departmentId)) {
        return departmentMap.get(u.departmentId)!;
      }
      const fb = DEPT_FALLBACK_NAMES[u.departmentId] || DEPT_FALLBACK_NAMES[u.departmentId.toUpperCase()];
      if (fb) return fb;
    }
    return u.department || '미지정';
  };

  // OT 관리는 권한관리에서 통제 (ot_management view/save)
  const canSave = hasPermission('ot_management', 'save');
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  // 뷰 모드 ('LIST' 목록 | 'CALENDAR' 캘린더) 및 등록창 접기 상태
  const [viewMode, setViewMode] = useState<'LIST' | 'CALENDAR'>('LIST');
  const [isFormCollapsed, setIsFormCollapsed] = useState<boolean>(false);

  // 캘린더 연/월 및 선택 일자 상태
  const now = new Date();
  const [calYear, setCalYear] = useState<number>(now.getFullYear());
  const [calMonth, setCalMonth] = useState<number>(now.getMonth() + 1);
  const [selectedCalDate, setSelectedCalDate] = useState<string>(getTodayYmd());

  // 캘린더 일자 클릭 시 상세 내역 모달 상태
  const [isDateDetailModalOpen, setIsDateDetailModalOpen] = useState<boolean>(false);
  const [activeDetailDate, setActiveDetailDate] = useState<string>(getTodayYmd());

  // 캘린더 날짜 클릭 핸들러 (선택 및 상세 모달 즉시 호출)
  const handleDayClick = (dateStr: string) => {
    setSelectedCalDate(dateStr);
    setActiveDetailDate(dateStr);
    setOtDate(dateStr);
    setIsDateDetailModalOpen(true);
  };

  // 상세 모달 내 일자 하루 단위 이동 (-1일 / +1일)
  const handleShiftModalDate = (deltaDays: number) => {
    const base = activeDetailDate || selectedCalDate || getTodayYmd();
    const parts = base.split('-').map(Number);
    if (parts.length < 3) return;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setDate(date.getDate() + deltaDays);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    const nextDateStr = `${ny}-${nm}-${nd}`;
    setActiveDetailDate(nextDateStr);
    setSelectedCalDate(nextDateStr);
    setOtDate(nextDateStr);
  };

  const handlePrevCalMonth = () => {
    if (calMonth === 1) {
      setCalYear(y => y - 1);
      setCalMonth(12);
    } else {
      setCalMonth(m => m - 1);
    }
  };

  const handleNextCalMonth = () => {
    if (calMonth === 12) {
      setCalYear(y => y + 1);
      setCalMonth(1);
    } else {
      setCalMonth(m => m + 1);
    }
  };

  const handleTodayCalMonth = () => {
    const cur = new Date();
    setCalYear(cur.getFullYear());
    setCalMonth(cur.getMonth() + 1);
    const tYmd = getTodayYmd();
    setSelectedCalDate(tYmd);
    setOtDate(tYmd);
  };

  // OT 연장근무 등록 폼 상태 (자유로운 다중/단일 원클릭 토글 지원)
  const [otDate, setOtDate] = useState<string>(getTodayYmd());
  const [otUserIds, setOtUserIds] = useState<string[]>([]);
  const [otStartTime, setOtStartTime] = useState('17:00');
  const [otHours, setOtHours] = useState<number>(1.0);
  const [otWorkDetail, setOtWorkDetail] = useState('');
  const [otMealYn, setOtMealYn] = useState<'Y' | 'N'>('N');

  // 유효한 임직원 목록에 없는 유령 ID 자동 정제
  useEffect(() => {
    if (sortedUsers.length === 0 || otUserIds.length === 0) return;
    const filtered = otUserIds.filter(id => sortedUsers.some(u => u.id === id));
    if (filtered.length !== otUserIds.length) {
      setOtUserIds(filtered);
    }
  }, [sortedUsers]);

  // 임직원 칩 자유 토글 핸들러 (원클릭으로 자유롭게 선택/해제)
  const handleToggleUser = (userId: string) => {
    setOtUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleRemoveUser = (userId: string) => {
    setOtUserIds(prev => prev.filter(id => id !== userId));
  };

  const handleSelectAllUsers = () => {
    setOtUserIds(sortedUsers.map(u => u.id));
  };

  const handleClearAllUsers = () => {
    setOtUserIds([]);
  };

  const handleSelectDeptUsers = (deptId: string | null) => {
    const deptUserIds = sortedUsers
      .filter(u => u.departmentId === deptId)
      .map(u => u.id);
    if (deptUserIds.length === 0) return;
    const allDeptSelected = deptUserIds.every(id => otUserIds.includes(id));
    if (allDeptSelected) {
      setOtUserIds(prev => prev.filter(id => !deptUserIds.includes(id)));
    } else {
      setOtUserIds(prev => Array.from(new Set([...prev, ...deptUserIds])));
    }
  };

  // 1. 날짜 하루 단위 가감 (-1일 / +1일)
  const handleDateShift = (deltaDays: number) => {
    const base = otDate || getTodayYmd();
    const [y, m, d] = base.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + deltaDays);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    setOtDate(`${ny}-${nm}-${nd}`);
  };

  // 날짜 표시 (요일 및 오늘 여부)
  const getDateDisplayInfo = (ymd: string) => {
    if (!ymd) return { label: '', isToday: false };
    const [y, m, d] = ymd.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = days[date.getDay()];
    const isToday = ymd === getTodayYmd();
    return { label: `${ymd} (${dayName})`, isToday };
  };

  // 2. 시작시간 30분 단위 가감 (-30분 / +30분)
  const handleStartTimeShift = (deltaMinutes: number) => {
    const [h, m] = (otStartTime || '17:00').split(':').map(Number);
    let total = h * 60 + m + deltaMinutes;
    if (total < 0) total += 24 * 60;
    total = total % (24 * 60);
    const nh = String(Math.floor(total / 60)).padStart(2, '0');
    const nm = String(total % 60).padStart(2, '0');
    setOtStartTime(`${nh}:${nm}`);
  };

  // 3. 근로시간 30분(0.5h) 단위 가감 (-0.5h / +0.5h, 최소 1.0시간 강제)
  const handleHoursShift = (deltaHours: number) => {
    setOtHours(prev => {
      const next = Math.round((prev + deltaHours) * 10) / 10;
      return Math.max(1.0, Math.min(24, next));
    });
  };

  // 검색 및 필터
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState<string>('ALL');

  // OT 등록 제출
  const handleOvertimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otDate) {
      showErrorModal('근무 일자를 지정해 주십시오.');
      return;
    }
    if (otUserIds.length === 0) {
      showErrorModal('신청 대상 임직원을 최소 1명 이상 선택해 주십시오.');
      return;
    }
    if (!otStartTime) {
      showErrorModal('시작 시간을 지정해 주십시오.');
      return;
    }
    if (!otWorkDetail.trim()) {
      showErrorModal('OT 근무 상세 사유를 선택하거나 기입해 주십시오.');
      return;
    }

    if (otHours < 1.0) {
      showErrorModal('OT 시간은 최소 1.0시간 이상이어야 합니다. (30분은 인정되지 않습니다)');
      return;
    }

    if (otHours > 24) {
      showErrorModal('1일 최대 연장근무 시간은 24시간을 초과할 수 없습니다.');
      return;
    }

    const startDateTime = `${otDate} ${otStartTime}`;

    try {
      for (const uid of otUserIds) {
        await addOvertimeRecord({
          userId: uid,
          startDateTime,
          hours: otHours,
          workDetail: otWorkDetail.trim(),
          mealYn: otMealYn,
          hasMeal: otMealYn === 'Y',
          status: 'APPROVED'
        });
      }

      const selectedNames = otUserIds
        .map(uid => findUser(uid)?.name || uid)
        .filter(Boolean)
        .join(', ');

      setOtWorkDetail('');
      setOtHours(1.0);
      setOtStartTime('17:00');
      setOtMealYn('N');
      showToast(`총 ${otUserIds.length}명 (${selectedNames})의 OT(${otHours}시간, 식사: ${otMealYn}) 내역이 등록되었습니다.`);
    } catch (err: any) {
      showErrorModal(err?.message || 'OT 연장근무 등록 중 오류가 발생했습니다.');
    }
  };

  // OT 삭제 (취소)
  const handleDeleteOt = async (id: string, userName: string, hours: number) => {
    try {
      await deleteOvertimeRecord(id);
      showToast(`${userName} 님의 OT 기록(${hours}시간)이 취소되었습니다.`);
    } catch (err: any) {
      showErrorModal(err?.message || 'OT 내역 취소 중 오류가 발생했습니다.');
    }
  };

  // 엑셀 다운로드
  const handleExportExcel = () => {
    const ymd = new Date().toISOString().substring(0, 10).replace(/-/g, '');

    const data = filteredRecords.map((ot, idx) => {
      const u = findUser(ot.userId);
      const uName = u?.name || ot.userId;
      const uDept = getEmployeeDeptName(u) || '미지정';

      return {
        '번호': idx + 1,
        '성명': uName,
        '부서': uDept,
        '시작 일시': ot.startDateTime,
        'OT 연장근무 시간 (h)': ot.hours,
        '식사여부': (ot.mealYn === 'Y' || ot.hasMeal) ? 'Y' : 'N',
        '근무 상세 내용': ot.workDetail,
        '등록 일시': ot.createdAt?.substring(0, 10)
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'OT 연장근무 이력');
    XLSX.writeFile(wb, `OT_연장근무_이력_${ymd}.xlsx`);
  };

  const totalOtHours = overtimeRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
  const currentMonthPrefix = new Date().toISOString().substring(0, 7); // YYYY-MM
  const thisMonthOtHours = overtimeRecords
    .filter(r => (r.startDateTime || r.createdAt || '').startsWith(currentMonthPrefix))
    .reduce((sum, r) => sum + (r.hours || 0), 0);

  const filteredRecords = overtimeRecords.filter(ot => {
    if (userFilter !== 'ALL' && ot.userId !== userFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const u = findUser(ot.userId);
    const uDept = getEmployeeDeptName(u);
    return (u?.name || ot.userId).toLowerCase().includes(q) || uDept.toLowerCase().includes(q) || (ot.workDetail || '').toLowerCase().includes(q);
  });

  // 📅 캘린더 월간 데이터 계산 (윤달/역법 정합성 준수)
  const daysInMonth = useMemo(() => new Date(calYear, calMonth, 0).getDate(), [calYear, calMonth]);
  const firstDayOfWeek = useMemo(() => new Date(calYear, calMonth - 1, 1).getDay(), [calYear, calMonth]);
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  const calMonthPrefix = useMemo(() => `${calYear}-${String(calMonth).padStart(2, '0')}`, [calYear, calMonth]);
  const calMonthRecords = useMemo(() => {
    return filteredRecords.filter(r => (r.startDateTime || r.createdAt || '').startsWith(calMonthPrefix));
  }, [filteredRecords, calMonthPrefix]);

  const calMonthTotalHours = useMemo(() => {
    return calMonthRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
  }, [calMonthRecords]);

  // 날짜별 레코드 매핑 (YYYY-MM-DD -> records[])
  const recordsByDateMap = useMemo(() => {
    const map = new Map<string, typeof overtimeRecords>();
    filteredRecords.forEach(r => {
      const dStr = (r.startDateTime || (r as any).workDate || r.createdAt || '').substring(0, 10);
      if (!dStr) return;
      const list = map.get(dStr) || [];
      list.push(r);
      map.set(dStr, list);
    });
    return map;
  }, [filteredRecords]);

  // 선택된 상세 일자의 레코드 목록 및 총 시간
  const activeDateRecords = useMemo(() => {
    if (!activeDetailDate) return [];
    return recordsByDateMap.get(activeDetailDate) || [];
  }, [recordsByDateMap, activeDetailDate]);

  const activeDateTotalHours = useMemo(() => {
    return activeDateRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
  }, [activeDateRecords]);

  // ESC 키로 상세 모달 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDateDetailModalOpen) {
        setIsDateDetailModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDateDetailModalOpen]);

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 헤더 타이틀 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={22} style={{ color: 'var(--primary)' }} />
            OT 관리
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap' }}>
          <button
            onClick={() => setIsApprovalDocModalOpen(true)}
            className="btn btn-primary"
            style={{
              fontSize: '13px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 'bold',
              padding: '7px 14px'
            }}
          >
            <Printer size={15} />
            결재 문서 출력
          </button>

          <button
            onClick={handleExportExcel}
            className="btn btn-secondary"
            style={{
              fontSize: '13px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px'
            }}
          >
            <Download size={15} />
            엑셀 다운로드
          </button>
        </div>
      </div>

      {/* 📊 통계 요약 바 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 등록건수</span>
          <strong style={{ fontSize: '15px', color: 'var(--text-main)' }}>{overtimeRecords.length}건</strong>
        </div>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 승인 OT 시간</span>
          <strong style={{ fontSize: '15px', color: '#d97706' }}>{totalOtHours.toFixed(1)}시간</strong>
        </div>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>당월 OT 시간</span>
          <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{thisMonthOtHours.toFixed(1)}시간</strong>
        </div>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>급여 대장 연동</span>
          <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={13} /> 실시간 반영
          </span>
        </div>
      </div>

      {/* 2단 작업대 레이아웃 (좌: 등록 폼 / 우: 대장 그리드 및 월간 캘린더) */}
      <div style={{ display: 'grid', gridTemplateColumns: isFormCollapsed ? '1fr' : '330px 1fr', gap: '20px', transition: 'all 0.2s ease' }}>
        
        {/* 좌측: OT 연장근무 6단계 간편 등록 폼 (헌장 3.4 상하 세로 스택) */}
        {!isFormCollapsed && (
          <div style={{
          backgroundColor: 'var(--bg-surface)',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          height: 'fit-content'
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            OT 등록
          </h3>

          <form onSubmit={handleOvertimeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* 1. 날짜 지정 (오늘 중앙, 좌우 < > 하루씩 이동) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  1. 날짜 지정
                </label>
                {!getDateDisplayInfo(otDate).isToday && (
                  <button
                    type="button"
                    onClick={() => setOtDate(getTodayYmd())}
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--primary)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    오늘로 이동
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleDateShift(-1)}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)'
                  }}
                  title="이전날 (-1일)"
                >
                  <ChevronLeft size={16} />
                </button>
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '7px 10px',
                  position: 'relative'
                }}>
                  <Calendar size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                    {getDateDisplayInfo(otDate).label}
                  </span>
                  {getDateDisplayInfo(otDate).isToday && (
                    <span style={{
                      fontSize: '10.5px',
                      fontWeight: 700,
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#10b981',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap'
                    }}>
                      오늘
                    </span>
                  )}
                  <input
                    type="date"
                    required
                    value={otDate}
                    onChange={(e) => setOtDate(e.target.value)}
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      width: '100%',
                      height: '100%',
                      left: 0,
                      top: 0,
                      cursor: 'pointer'
                    }}
                    title="달력으로 날짜 직접 선택"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleDateShift(1)}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)'
                  }}
                  title="다음날 (+1일)"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* 2. 대상 임직원 지정 (단일 선택 기본 / 다중 선택 지원) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  2. 대상 임직원 지정 <span style={{ color: 'var(--primary)', fontWeight: 800 }}>({otUserIds.length}명 선택됨)</span>
                </label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={handleSelectAllUsers}
                    style={{ fontSize: '11px', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                  >
                    전체선택
                  </button>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>|</span>
                  <button
                    type="button"
                    onClick={handleClearAllUsers}
                    style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                  >
                    선택해제
                  </button>
                </div>
              </div>

              {/* 🌟 선택된 임직원 태그 배지 (누가 선택되어 있는지 100% 한눈에 실시간 확인) */}
              {otUserIds.length > 0 && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                  padding: '6px 8px',
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  borderRadius: '6px',
                  border: '1px solid rgba(59, 130, 246, 0.2)'
                }}>
                  {otUserIds.map(uid => {
                    const u = findUser(uid);
                    return (
                      <span
                        key={uid}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          backgroundColor: 'var(--primary)',
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: 700,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {u?.name || uid}
                        <button
                          type="button"
                          onClick={() => handleRemoveUser(uid)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ffffff',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: 0.8
                          }}
                          title="선택 해제"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* 부서별 일괄 선택 칩 */}
              {departments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '2px' }}>
                  {departments.map(d => {
                    const deptUsers = sortedUsers.filter(u => u.departmentId === d.id);
                    if (deptUsers.length === 0) return null;
                    const isAllDeptSelected = deptUsers.every(u => otUserIds.includes(u.id));
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => handleSelectDeptUsers(d.id)}
                        style={{
                          fontSize: '10.5px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: isAllDeptSelected ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                          backgroundColor: isAllDeptSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-main)',
                          color: isAllDeptSelected ? 'var(--primary)' : 'var(--text-secondary)',
                          fontWeight: isAllDeptSelected ? 700 : 500,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                        title={`${d.name} 소속 ${deptUsers.length}명 일괄 선택/해제`}
                      >
                        {d.name} ({deptUsers.length})
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 임직원 개별 퀵버튼 */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '5px',
                maxHeight: '150px',
                overflowY: 'auto',
                padding: '8px',
                backgroundColor: 'var(--bg-main)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                {sortedUsers.map(u => {
                  const isSelected = otUserIds.includes(u.id);
                  const deptName = getEmployeeDeptName(u);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleToggleUser(u.id)}
                      style={{
                        fontSize: '12px',
                        padding: '5px 9px',
                        borderRadius: '5px',
                        border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: isSelected ? 'var(--primary)' : 'var(--bg-surface)',
                        color: isSelected ? '#ffffff' : 'var(--text-main)',
                        fontWeight: isSelected ? 700 : 500,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {isSelected && <span style={{ fontSize: '11px', fontWeight: 900 }}>✓</span>}
                      <span>{u.name}</span>
                      {deptName && (
                        <span style={{
                          fontSize: '10px',
                          opacity: isSelected ? 0.9 : 0.6,
                          fontWeight: 400
                        }}>
                          ({deptName})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. 시작시간 지정 (기본 17:00, 좌우 < > 30분씩 가감) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  3. 시작시간 지정
                </label>
                {otStartTime !== '17:00' && (
                  <button
                    type="button"
                    onClick={() => setOtStartTime('17:00')}
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    17:00 복귀
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleStartTimeShift(-30)}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)'
                  }}
                  title="30분 빼기 (-30m)"
                >
                  <ChevronLeft size={16} />
                </button>
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '7px 10px',
                  position: 'relative'
                }}>
                  <Clock size={15} style={{ color: 'var(--primary)', marginRight: '8px', flexShrink: 0 }} />
                  <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '1px' }}>
                    {otStartTime}
                  </span>
                  <input
                    type="time"
                    required
                    value={otStartTime}
                    onChange={(e) => setOtStartTime(e.target.value)}
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      width: '100%',
                      height: '100%',
                      left: 0,
                      top: 0,
                      cursor: 'pointer'
                    }}
                    title="시작시간 직접 선택"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleStartTimeShift(30)}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)'
                  }}
                  title="30분 더하기 (+30m)"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* 4. 근로시간 설정 (기본 1.0시간, 좌우 < > 30분단위 가감) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  4. 근로시간 설정
                </label>
                {otHours !== 1.0 && (
                  <button
                    type="button"
                    onClick={() => setOtHours(1.0)}
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    1.0h 복귀
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleHoursShift(-0.5)}
                  disabled={otHours <= 1.0}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    opacity: otHours <= 1.0 ? 0.35 : 1,
                    cursor: otHours <= 1.0 ? 'not-allowed' : 'pointer'
                  }}
                  title="최소 1.0시간 (30분 감산 불가)"
                >
                  <ChevronLeft size={16} />
                </button>
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: '6px',
                  padding: '7px 12px'
                }}>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--primary)', letterSpacing: '0.5px' }}>
                    {otHours.toFixed(1)} 시간
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleHoursShift(0.5)}
                  disabled={otHours >= 24}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    opacity: otHours >= 24 ? 0.35 : 1,
                    cursor: otHours >= 24 ? 'not-allowed' : 'pointer'
                  }}
                  title="0.5시간 더하기 (+30m)"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* 보조 단축 버튼 (+1시간, 1.0h 초기화) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '2px' }}>
                <button
                  type="button"
                  onClick={() => handleHoursShift(1.0)}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '11.5px',
                    padding: '5px 8px',
                    fontWeight: 600,
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    color: '#10b981',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={12} /> +1시간
                </button>
                <button
                  type="button"
                  onClick={() => setOtHours(1.0)}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '11.5px',
                    padding: '5px 8px',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <RotateCcw size={12} /> 초기화 (1.0h)
                </button>
              </div>
            </div>

            {/* 5. OT 사유 선택 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                5. OT 사유 선택
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {OT_REASON_PRESETS.map(reason => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setOtWorkDetail(reason)}
                    className="btn"
                    style={{
                      fontSize: '11px',
                      padding: '4px 7px',
                      borderRadius: '4px',
                      backgroundColor: otWorkDetail === reason ? 'rgba(217, 119, 6, 0.15)' : 'var(--bg-main)',
                      color: otWorkDetail === reason ? '#d97706' : 'var(--text-secondary)',
                      border: otWorkDetail === reason ? '1px solid rgba(217, 119, 6, 0.4)' : '1px solid var(--border-color)',
                      fontWeight: otWorkDetail === reason ? 700 : 500,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <input
                type="text"
                required
                placeholder="사유 선택 또는 직접 입력"
                value={otWorkDetail}
                onChange={(e) => setOtWorkDetail(e.target.value)}
                className="form-control"
                style={{ fontSize: '13px', marginTop: '2px' }}
              />
            </div>

            {/* 6. 식사여부 (Y / N 선택) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  6. 식사여부
                </label>
                <span style={{ fontSize: '11px', color: otMealYn === 'Y' ? '#10b981' : 'var(--text-muted)', fontWeight: 700 }}>
                  {otMealYn === 'Y' ? '식사 제공 (Y)' : '식사 없음 (N)'}
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                backgroundColor: 'var(--bg-main)',
                padding: '4px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                <button
                  type="button"
                  onClick={() => setOtMealYn('Y')}
                  style={{
                    padding: '8px 0',
                    fontSize: '13px',
                    fontWeight: otMealYn === 'Y' ? 800 : 600,
                    borderRadius: '5px',
                    border: otMealYn === 'Y' ? '1.5px solid #10b981' : '1px solid transparent',
                    backgroundColor: otMealYn === 'Y' ? 'rgba(16, 185, 129, 0.18)' : 'transparent',
                    color: otMealYn === 'Y' ? '#10b981' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {otMealYn === 'Y' && <span>✓</span>}
                  <span>Y</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOtMealYn('N')}
                  style={{
                    padding: '8px 0',
                    fontSize: '13px',
                    fontWeight: otMealYn === 'N' ? 800 : 600,
                    borderRadius: '5px',
                    border: otMealYn === 'N' ? '1.5px solid var(--text-muted)' : '1px solid transparent',
                    backgroundColor: otMealYn === 'N' ? 'rgba(148, 163, 184, 0.18)' : 'transparent',
                    color: otMealYn === 'N' ? 'var(--text-main)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {otMealYn === 'N' && <span>✓</span>}
                  <span>N</span>
                </button>
              </div>
            </div>

            {/* 7. 저장 */}
            <button
              type="submit"
              className="btn btn-primary"
              style={{
                fontSize: '13.5px',
                fontWeight: 'bold',
                padding: '10px 14px',
                marginTop: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
              disabled={!canSave || otUserIds.length === 0}
            >
              {otUserIds.length === 0 ? (
                '대상 임직원을 선택해주세요'
              ) : otUserIds.length === 1 ? (
                `OT 등록 (${findUser(otUserIds[0])?.name || '1명'}, ${otHours.toFixed(1)}시간, 식사: ${otMealYn})`
              ) : (
                `OT 등록 (${findUser(otUserIds[0])?.name || ''} 외 ${otUserIds.length - 1}명, 각 ${otHours.toFixed(1)}시간, 식사: ${otMealYn})`
              )}
            </button>
          </form>
        </div>
        )}

        {/* 우측: OT 이력 작업대 (목록 대장 & 월간 캘린더) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* 상단 툴바: 검색, 임직원 필터, 등록창 토글, 뷰 모드(목록/캘린더) 전환 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
              <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '300px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="성명 또는 업무 내용 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="form-control"
                  style={{ paddingLeft: '32px', fontSize: '13px' }}
                />
              </div>

              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="form-control"
                style={{ width: '170px', fontSize: '13px' }}
              >
                <option value="ALL">전체 임직원</option>
                {sortedUsers.map(u => {
                  const deptName = getEmployeeDeptName(u);
                  return (
                    <option key={u.id} value={u.id}>
                      {u.name} {deptName ? `(${deptName})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* 우측: 등록창 토글 & 뷰 모드(목록/캘린더) 세그먼트 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setIsFormCollapsed(prev => !prev)}
                className="btn btn-secondary"
                style={{
                  fontSize: '12px',
                  padding: '6px 11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-secondary)'
                }}
                title={isFormCollapsed ? 'OT 등록창 펼치기' : 'OT 등록창 숨기기'}
              >
                {isFormCollapsed ? (
                  <>
                    <Plus size={13} />
                    <span>등록창 표시</span>
                  </>
                ) : (
                  <>
                    <Minus size={13} />
                    <span>등록창 숨김</span>
                  </>
                )}
              </button>

              <div style={{
                display: 'inline-flex',
                backgroundColor: 'var(--bg-main)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                padding: '2px'
              }}>
                <button
                  type="button"
                  onClick={() => setViewMode('LIST')}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: viewMode === 'LIST' ? 700 : 500,
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: viewMode === 'LIST' ? 'var(--primary)' : 'transparent',
                    color: viewMode === 'LIST' ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <List size={13} />
                  <span>목록</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('CALENDAR')}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: viewMode === 'CALENDAR' ? 700 : 500,
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: viewMode === 'CALENDAR' ? 'var(--primary)' : 'transparent',
                    color: viewMode === 'CALENDAR' ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Calendar size={13} />
                  <span>캘린더</span>
                </button>
              </div>
            </div>
          </div>

          {/* 📋 1. 목록 뷰 */}
          {viewMode === 'LIST' && (
            <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '80px' }}>취소</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>성명</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>부서</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>시작 일시</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>OT 시간</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center', width: '60px' }}>식사</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>근무 상세 내용</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>등록일시</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        조회된 OT 연장근무 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((ot) => {
                      const u = findUser(ot.userId);
                      const uName = u?.name || ot.userId;
                      const uDept = getEmployeeDeptName(u) || '미지정';
                      const canDelete = ot.userId === currentUser?.id || isAdmin || canSave;

                      return (
                        <tr key={ot.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            {canDelete && (
                              <button
                                onClick={() => handleDeleteOt(ot.id, uName, ot.hours)}
                                className="btn btn-secondary"
                                style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--danger)' }}
                                title="OT 내역 취소"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                            {uName}
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {uDept}
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                            {ot.startDateTime}
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>
                            +{ot.hours} 시간
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                            <span style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '4px',
                              backgroundColor: (ot.mealYn === 'Y' || ot.hasMeal) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.12)',
                              color: (ot.mealYn === 'Y' || ot.hasMeal) ? '#10b981' : 'var(--text-muted)'
                            }}>
                              {(ot.mealYn === 'Y' || ot.hasMeal) ? 'Y' : 'N'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {ot.workDetail}
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '12px' }}>
                            {ot.createdAt?.substring(0, 10)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 📅 2. 캘린더 뷰 */}
          {viewMode === 'CALENDAR' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 캘린더 월간 이동 헤더 바 */}
              <div style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '12px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={18} style={{ color: 'var(--primary)' }} />
                    <span>{calYear}년 {calMonth}월 초과근무 캘린더</span>
                  </h3>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(59, 130, 246, 0.12)',
                    color: 'var(--primary)',
                    whiteSpace: 'nowrap'
                  }}>
                    당월 합계 {calMonthTotalHours.toFixed(1)}시간 ({calMonthRecords.length}건)
                  </span>
                  {userFilter !== 'ALL' && (
                    <span style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(217, 119, 6, 0.12)',
                      color: '#d97706',
                      whiteSpace: 'nowrap'
                    }}>
                      필터: {sortedUsers.find(u => u.id === userFilter)?.name || '직원'}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={handlePrevCalMonth}
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <ChevronLeft size={14} /> 이전달
                  </button>
                  <button
                    type="button"
                    onClick={handleTodayCalMonth}
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700 }}
                  >
                    오늘
                  </button>
                  <button
                    type="button"
                    onClick={handleNextCalMonth}
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    다음달 <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              {/* 월간 캘린더 그리드 */}
              <div style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                overflowX: 'auto'
              }}>
                {/* 요일 헤더 (7열) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(105px, 1fr))',
                  gap: '6px',
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '12px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <div style={{ color: '#ef4444' }}>일</div>
                  <div style={{ color: 'var(--text-secondary)' }}>월</div>
                  <div style={{ color: 'var(--text-secondary)' }}>화</div>
                  <div style={{ color: 'var(--text-secondary)' }}>수</div>
                  <div style={{ color: 'var(--text-secondary)' }}>목</div>
                  <div style={{ color: 'var(--text-secondary)' }}>금</div>
                  <div style={{ color: '#3b82f6' }}>토</div>
                </div>

                {/* 일자별 그리드 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(105px, 1fr))',
                  gap: '6px'
                }}>
                  {/* 시작 요일 전 빈 셀 */}
                  {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                    <div
                      key={`empty-cal-${idx}`}
                      style={{
                        minHeight: '115px',
                        backgroundColor: 'var(--bg-main)',
                        borderRadius: '6px',
                        opacity: 0.3,
                        border: '1px dashed var(--border-color)'
                      }}
                    />
                  ))}

                  {/* 1일 ~ 말일 셀 */}
                  {daysArray.map(day => {
                    const dayStr = String(day).padStart(2, '0');
                    const monthStr = String(calMonth).padStart(2, '0');
                    const dateStr = `${calYear}-${monthStr}-${dayStr}`;
                    const dayRecords = recordsByDateMap.get(dateStr) || [];
                    const dayTotalHours = dayRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
                    const isToday = dateStr === getTodayYmd();
                    const isSelected = selectedCalDate === dateStr || otDate === dateStr;
                    const dayOfWeek = (firstDayOfWeek + day - 1) % 7; // 0: 일, 6: 토

                    return (
                      <div
                        key={dateStr}
                        onClick={() => handleDayClick(dateStr)}
                        title={`${dateStr} (${getDayOfWeekKr(dateStr)}) 클릭 시 상세 내역 조회`}
                        style={{
                          minHeight: '115px',
                          borderRadius: '6px',
                          border: isSelected ? '2px solid var(--primary)' : isToday ? '1.5px solid rgba(59,130,246,0.6)' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : isToday ? 'rgba(59, 130, 246, 0.03)' : 'var(--bg-main)',
                          padding: '6px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          position: 'relative'
                        }}
                      >
                        {/* 셀 상단: 일자 번호 & 일별 합계 배지 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: isToday || isSelected ? 800 : 600,
                            color: isToday ? '#fff' : dayOfWeek === 0 ? '#ef4444' : dayOfWeek === 6 ? '#3b82f6' : 'var(--text-main)',
                            backgroundColor: isToday ? 'var(--primary)' : 'transparent',
                            borderRadius: isToday ? '50%' : '0',
                            width: isToday ? '20px' : 'auto',
                            height: isToday ? '20px' : 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {day}
                          </span>

                          {dayRecords.length > 0 && (
                            <span style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '8px',
                              backgroundColor: 'rgba(217, 119, 6, 0.18)',
                              color: '#d97706',
                              whiteSpace: 'nowrap'
                            }}>
                              +{dayTotalHours.toFixed(1)}h
                            </span>
                          )}
                        </div>

                        {/* 셀 본문: OT 명단 칩 목록 */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, overflowY: 'auto' }}>
                          {dayRecords.slice(0, 3).map(ot => {
                            const u = findUser(ot.userId);
                            const uName = u?.name || ot.userId;
                            const uDept = getEmployeeDeptName(u);
                            const canDelete = ot.userId === currentUser?.id || isAdmin || canSave;

                            return (
                              <div
                                key={ot.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDayClick(dateStr);
                                }}
                                style={{
                                  padding: '3px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: 'var(--bg-surface)',
                                  border: '1px solid var(--border-color)',
                                  fontSize: '10.5px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                  <strong style={{ color: 'var(--text-main)' }}>{uName}</strong>
                                  {uDept && <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>({uDept})</span>}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                                  <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '10px' }}>
                                    +{ot.hours}h
                                  </span>
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteOt(ot.id, uName, ot.hours);
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        padding: '1px',
                                        cursor: 'pointer',
                                        color: 'var(--danger)',
                                        opacity: 0.7,
                                        display: 'flex',
                                        alignItems: 'center'
                                      }}
                                      title="OT 취소"
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {dayRecords.length > 3 && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDayClick(dateStr);
                              }}
                              style={{
                                fontSize: '9.5px',
                                color: 'var(--primary)',
                                textAlign: 'center',
                                paddingTop: '2px',
                                cursor: 'pointer',
                                fontWeight: 700
                              }}
                            >
                              +{dayRecords.length - 3}건 더보기 (상세)
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 📌 선택 날짜 상세 패널 */}
              {selectedCalDate && (
                <div style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '14px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--text-main)' }}>
                        📌 {selectedCalDate} 초과근무 상세 ({(recordsByDateMap.get(selectedCalDate) || []).length}건)
                      </span>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#d97706' }}>
                        합계 +{((recordsByDateMap.get(selectedCalDate) || []).reduce((sum, r) => sum + (r.hours || 0), 0)).toFixed(1)}시간
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setOtDate(selectedCalDate);
                        setIsFormCollapsed(false);
                      }}
                      className="btn btn-secondary"
                      style={{ fontSize: '12px', padding: '5px 12px', color: 'var(--primary)', fontWeight: 700, backgroundColor: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)' }}
                    >
                      + 이 날짜에 OT 추가 등록
                    </button>
                  </div>

                  {(recordsByDateMap.get(selectedCalDate) || []).length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                      선택된 일자에 등록된 OT 내역이 없습니다.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
                      {(recordsByDateMap.get(selectedCalDate) || []).map(ot => {
                        const u = findUser(ot.userId);
                        const uName = u?.name || ot.userId;
                        const uDept = getEmployeeDeptName(u) || '미지정';
                        const canDelete = ot.userId === currentUser?.id || isAdmin || canSave;

                        return (
                          <div
                            key={ot.id}
                            style={{
                              backgroundColor: 'var(--bg-main)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              padding: '10px 12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '10px'
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'hidden' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>{uName}</strong>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({uDept})</span>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--primary)' }}>+{ot.hours}시간</span>
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  backgroundColor: (ot.mealYn === 'Y' || ot.hasMeal) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.12)',
                                  color: (ot.mealYn === 'Y' || ot.hasMeal) ? '#10b981' : 'var(--text-muted)'
                                }}>
                                  식사 {(ot.mealYn === 'Y' || ot.hasMeal) ? 'Y' : 'N'}
                                </span>
                              </div>
                              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {ot.workDetail} ({ot.startDateTime?.split(' ')[1] || '17:00'} 시작)
                              </div>
                            </div>

                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => handleDeleteOt(ot.id, uName, ot.hours)}
                                className="btn btn-secondary"
                                style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--danger)', flexShrink: 0 }}
                                title="OT 취소"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ⚖️ 헌장 3.5 Gutenberg Z-패턴 초과근무 집계 요약 바 */}
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
            초과근무 집계:
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            총 등록건수 <strong style={{ color: 'var(--text-main)' }}>{overtimeRecords.length}건</strong>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>|</span>
          <span style={{ fontSize: '12px', color: 'var(--primary)' }}>
            총 초과근무 시간 <strong>{totalOtHours.toFixed(1)}시간</strong>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
          <span style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '6px',
            fontWeight: 'bold',
            backgroundColor: 'rgba(59, 130, 246, 0.12)',
            color: 'var(--primary)'
          }}>
            급여 대장 연동 대기
          </span>
        </div>
      </div>

      {/* 📌 캘린더 날짜 클릭 시 초과근무 상세 내역 모달 */}
      {isDateDetailModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
          onClick={() => setIsDateDetailModalOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              width: '100%',
              maxWidth: '800px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.35), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더: 날짜 이동 및 요약 배지 */}
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-main)',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => handleShiftModalDate(-1)}
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center' }}
                    title="이전날 (-1일)"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShiftModalDate(1)}
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center' }}
                    title="다음날 (+1일)"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={17} style={{ color: 'var(--primary)' }} />
                  <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                    {activeDetailDate} ({getDayOfWeekKr(activeDetailDate)}) 초과근무 상세
                  </h3>
                </div>

                <span style={{
                  fontSize: '11.5px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                  color: 'var(--primary)',
                  whiteSpace: 'nowrap'
                }}>
                  총 {activeDateRecords.length}건
                </span>

                <span style={{
                  fontSize: '11.5px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(217, 119, 6, 0.12)',
                  color: '#d97706',
                  whiteSpace: 'nowrap'
                }}>
                  합계 +{activeDateTotalHours.toFixed(1)}시간
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsDateDetailModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '4px'
                }}
                title="닫기"
              >
                <X size={18} />
              </button>
            </div>

            {/* 모달 본문: 상세 대장 테이블 (38~42px 행 높이, 헌장 3.2 줄바꿈 방지) */}
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
              {activeDateRecords.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <Calendar size={32} style={{ opacity: 0.3 }} />
                  <span>해당 일자에 등록된 OT 초과근무 내역이 없습니다.</span>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                  <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap', width: '50px' }}>취소</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>성명</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>부서</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>시작 일시</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>OT 시간</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'center', width: '50px' }}>식사</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>근무 상세 내용</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>등록일시</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDateRecords.map(ot => {
                        const u = findUser(ot.userId);
                        const uName = u?.name || ot.userId;
                        const uDept = getEmployeeDeptName(u) || '미지정';
                        const canDelete = ot.userId === currentUser?.id || isAdmin || canSave;

                        return (
                          <tr key={ot.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOt(ot.id, uName, ot.hours)}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '11px', padding: '3px 7px', color: 'var(--danger)' }}
                                  title="OT 내역 취소"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                              {uName}
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                              {uDept}
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                              {ot.startDateTime || '17:00'}
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>
                              +{ot.hours} 시간
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                              <span style={{
                                fontSize: '10.5px',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: (ot.mealYn === 'Y' || ot.hasMeal) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.12)',
                                color: (ot.mealYn === 'Y' || ot.hasMeal) ? '#10b981' : 'var(--text-muted)'
                              }}>
                                {(ot.mealYn === 'Y' || ot.hasMeal) ? 'Y' : 'N'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-main)' }}>
                              {ot.workDetail}
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '11.5px' }}>
                              {ot.createdAt?.substring(0, 10)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 모달 푸터: 등록 폼 바로가기 및 닫기 */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-main)'
            }}>
              <button
                type="button"
                onClick={() => {
                  setOtDate(activeDetailDate);
                  setIsFormCollapsed(false);
                  setIsDateDetailModalOpen(false);
                }}
                className="btn btn-primary"
                style={{ fontSize: '12.5px', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={14} />
                <span>이 날짜에 OT 추가 등록</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDateDetailModalOpen(false)}
                className="btn btn-secondary"
                style={{ fontSize: '12.5px', padding: '7px 16px' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📄 월간 OT 수당지급용 결재 문서 출력 모달 */}
      <OtApprovalDocumentModal
        isOpen={isApprovalDocModalOpen}
        onClose={() => setIsApprovalDocModalOpen(false)}
        initialMonth={calMonthPrefix}
      />

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
