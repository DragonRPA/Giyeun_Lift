import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import { Clock, Trash2, Download, Search, CheckCircle2, Plus, Minus, RotateCcw, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { User as UserType, Department, db } from '../services/db';

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

  // 조직도 부서 로딩 및 맵 생성
  const departments: Department[] = useMemo(() => {
    const local = localStorage.getItem('erp_departments');
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    return db.departments || [];
  }, []);

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

  const getEmployeeDeptName = (u?: UserType): string => {
    if (!u) return '';
    if (u.departmentId && departmentMap.has(u.departmentId)) {
      return departmentMap.get(u.departmentId)!;
    }
    return u.department || '';
  };

  // OT 관리는 권한관리에서 통제 (ot_management view/save)
  const canSave = hasPermission('ot_management', 'save');
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  // OT 연장근무 등록 폼 상태 (기본 시작시간 17:00, 근로시간 1.0시간)
  const [otDate, setOtDate] = useState<string>(getTodayYmd());
  const [otUserId, setOtUserId] = useState(currentUser?.id || '');
  const [otStartTime, setOtStartTime] = useState('17:00');
  const [otHours, setOtHours] = useState<number>(1.0);
  const [otWorkDetail, setOtWorkDetail] = useState('');

  // 로그인 사용자 또는 1순위 임직원으로 초기 선택 안전 보장
  useEffect(() => {
    if (!otUserId && sortedUsers.length > 0) {
      setOtUserId(currentUser?.id || sortedUsers[0].id);
    }
  }, [sortedUsers, otUserId, currentUser]);

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

  // 3. 근로시간 30분(0.5h) 단위 가감 (-0.5h / +0.5h)
  const handleHoursShift = (deltaHours: number) => {
    setOtHours(prev => {
      const next = Math.round((prev + deltaHours) * 10) / 10;
      return Math.max(0.5, Math.min(24, next));
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
    if (!otUserId) {
      showErrorModal('신청 대상 임직원을 선택해 주십시오.');
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

    if (otHours <= 0) {
      showErrorModal('OT 연장근무 시간은 0시간보다 커야 합니다.');
      return;
    }

    if (otHours > 24) {
      showErrorModal('1일 최대 연장근무 시간은 24시간을 초과할 수 없습니다.');
      return;
    }

    const startDateTime = `${otDate} ${otStartTime}`;

    try {
      await addOvertimeRecord({
        userId: otUserId,
        startDateTime,
        hours: otHours,
        workDetail: otWorkDetail.trim(),
        status: 'APPROVED'
      });

      const targetUser = users.find(u => u.id === otUserId);
      setOtWorkDetail('');
      setOtHours(1.0);
      setOtStartTime('17:00');
      showToast(`${targetUser?.name || '임직원'} 님의 OT(${otHours}시간) 내역이 등록되었습니다.`);
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
      const u = sortedUsers.find(user => user.id === ot.userId) || users.find(user => user.id === ot.userId);
      const uName = u?.name || '알 수 없음';
      const uDept = getEmployeeDeptName(u) || '미지정';

      return {
        '번호': idx + 1,
        '성명': uName,
        '부서': uDept,
        '시작 일시': ot.startDateTime,
        'OT 연장근무 시간 (h)': ot.hours,
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
    const u = sortedUsers.find(user => user.id === ot.userId) || users.find(user => user.id === ot.userId);
    const uDept = getEmployeeDeptName(u);
    return (u?.name || '').toLowerCase().includes(q) || uDept.toLowerCase().includes(q) || (ot.workDetail || '').toLowerCase().includes(q);
  });

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

        <button
          onClick={handleExportExcel}
          className="btn btn-secondary"
          style={{ fontSize: '13px', whiteSpace: 'nowrap', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}
        >
          <Download size={14} style={{ marginRight: '6px' }} />
          엑셀 다운로드
        </button>
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

      {/* 2단 작업대 레이아웃 (좌: 등록 폼 / 우: 대장 그리드) */}
      <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: '20px' }}>
        
        {/* 좌측: OT 연장근무 6단계 간편 등록 폼 (헌장 3.4 상하 세로 스택) */}
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

            {/* 2. 대상 임직원 전체 퀵버튼 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  2. 대상 임직원 지정
                </label>
                {otUserId && (
                  <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {sortedUsers.find(u => u.id === otUserId)?.name || users.find(u => u.id === otUserId)?.name} 선택됨
                  </span>
                )}
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '5px',
                maxHeight: '140px',
                overflowY: 'auto',
                padding: '8px',
                backgroundColor: 'var(--bg-main)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                {sortedUsers.map(u => {
                  const isSelected = otUserId === u.id;
                  const deptName = getEmployeeDeptName(u);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setOtUserId(u.id)}
                      style={{
                        fontSize: '12px',
                        padding: '5px 9px',
                        borderRadius: '5px',
                        border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-color)',
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
                  disabled={otHours <= 0.5}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    opacity: otHours <= 0.5 ? 0.35 : 1,
                    cursor: otHours <= 0.5 ? 'not-allowed' : 'pointer'
                  }}
                  title="0.5시간 빼기 (-30m)"
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

            {/* 6. 저장 */}
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
              disabled={!canSave}
            >
              OT 등록 ({otHours.toFixed(1)}시간)
            </button>
          </form>
        </div>

        {/* 우측: OT 이력 테이블 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* 필터 및 검색 바 */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
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

          <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '80px' }}>취소</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>성명</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>부서</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>시작 일시</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>OT 시간</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>근무 상세 내용</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>등록일시</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      조회된 OT 연장근무 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((ot) => {
                    const u = sortedUsers.find(user => user.id === ot.userId) || users.find(user => user.id === ot.userId);
                    const uName = u?.name || '알 수 없음';
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
