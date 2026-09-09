import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import { Printer, Download, X, Check, Save, Users, Calendar, CheckSquare, Layers } from 'lucide-react';
import { User as UserType, Department, db } from '../services/db';

export interface ApprovalStep {
  role: string;   // '기안' | '검토' | '확인' | '승인'
  title: string;  // '담당' | '팀장' | '부서장' | '대표이사'
  userId: string; // User ID
}

export interface OtApprovalDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMonth?: string; // YYYY-MM
  defaultDeptId?: string;
}

const DEPT_FALLBACK_ORDER: Record<string, number> = {
  'DEPT-0000001': 0, 'DEPT-1': 0,
  'DEPT-0000002': 1, 'DEPT-2': 1,
  'DEPT-0000003': 2, 'DEPT-3': 2,
  'DEPT-0000004': 3, 'DEPT-4': 3,
  'DEPT-0000005': 4, 'DEPT-5': 4,
  'DEPT-0000006': 5, 'DEPT-6': 5,
};

const DEPT_FALLBACK_NAMES: Record<string, string> = {
  'DEPT-0000001': '기연리프트', 'DEPT-1': '기연리프트',
  'DEPT-0000002': '관리부', 'DEPT-2': '관리부',
  'DEPT-0000003': '영업부', 'DEPT-3': '영업부',
  'DEPT-0000004': '출고팀', 'DEPT-4': '출고팀',
  'DEPT-0000005': 'AS팀', 'DEPT-5': 'AS팀',
  'DEPT-0000006': '외국인', 'DEPT-6': '외국인',
};

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

const getDayOfWeekKr = (dateStr: string) => {
  if (!dateStr) return '';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3) return '';
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return days[dt.getDay()] || '';
};

export const OtApprovalDocumentModal: React.FC<OtApprovalDocumentModalProps> = ({
  isOpen,
  onClose,
  initialMonth,
  defaultDeptId
}) => {
  const { users, overtimeRecords, currentUser } = useApp();

  const currentYm = useMemo(() => {
    if (initialMonth && /^\d{4}-\d{2}$/.test(initialMonth)) return initialMonth;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }, [initialMonth]);

  const [targetMonth, setTargetMonth] = useState<string>(currentYm);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(defaultDeptId || 'ALL');
  const [includeDetails, setIncludeDetails] = useState<boolean>(true);
  const [stepCount, setStepCount] = useState<2 | 3 | 4>(3);
  const [saveLineNotice, setSaveLineNotice] = useState<string | null>(null);

  // 부서 목록 로딩
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
  }, [users]);

  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    departments.forEach(d => map.set(d.id, d.name));
    return map;
  }, [departments]);

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

  // 조직도 순서대로 정렬된 활성 임직원 목록
  const activeSortedUsers = useMemo(() => {
    const valid = users.filter(u => !isTester(u) && u.status !== 'RETIRED');
    return [...valid].sort((a, b) => {
      const deptA = getDeptOrder(a.departmentId);
      const deptB = getDeptOrder(b.departmentId);
      if (deptA !== deptB) return deptA - deptB;

      const posA = getPositionRank(a.position);
      const posB = getPositionRank(b.position);
      if (posA !== posB) return posA - posB;

      const roleA = a.role === 'ADMIN' ? 0 : a.role === 'MANAGER' ? 1 : 2;
      const roleB = b.role === 'ADMIN' ? 0 : b.role === 'MANAGER' ? 1 : 2;
      if (roleA !== roleB) return roleA - roleB;

      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }, [users, orderedDeptIds]);

  const getEmployeeDeptName = (u?: UserType) => {
    if (!u) return '미지정';
    if (u.departmentId && departmentMap.has(u.departmentId)) {
      return departmentMap.get(u.departmentId)!;
    }
    if (u.departmentId && DEPT_FALLBACK_NAMES[u.departmentId]) {
      return DEPT_FALLBACK_NAMES[u.departmentId];
    }
    return u.department || '미지정';
  };

  const findUser = (userId?: string): UserType | undefined => {
    if (!userId) return undefined;
    const cleanId = String(userId).trim();
    return activeSortedUsers.find(u => u.id === cleanId || u.id?.toLowerCase() === cleanId.toLowerCase())
      || users.find(u => u.id === cleanId || u.id?.toLowerCase() === cleanId.toLowerCase());
  };

  // 순차 결재선 상태 (기본값 구성 및 localStorage 복원)
  const defaultStepsForCount = (cnt: 2 | 3 | 4): ApprovalStep[] => {
    const drafterId = currentUser?.id || '';
    if (cnt === 2) {
      return [
        { role: '기안', title: currentUser?.position || '담당', userId: drafterId },
        { role: '승인', title: '대표이사', userId: '' }
      ];
    }
    if (cnt === 3) {
      return [
        { role: '기안', title: currentUser?.position || '담당', userId: drafterId },
        { role: '검토', title: '부서장', userId: '' },
        { role: '승인', title: '대표이사', userId: '' }
      ];
    }
    return [
      { role: '기안', title: currentUser?.position || '담당', userId: drafterId },
      { role: '검토', title: '팀장', userId: '' },
      { role: '확인', title: '부서장', userId: '' },
      { role: '승인', title: '대표이사', userId: '' }
    ];
  };

  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>(() => {
    const saved = localStorage.getItem('erp_ot_approval_line');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 2 && parsed.length <= 4) {
          return parsed;
        }
      } catch {}
    }
    return defaultStepsForCount(3);
  });

  useEffect(() => {
    if (approvalSteps.length === 2 || approvalSteps.length === 3 || approvalSteps.length === 4) {
      setStepCount(approvalSteps.length as 2 | 3 | 4);
    }
  }, []);

  const handleStepCountChange = (newCount: 2 | 3 | 4) => {
    setStepCount(newCount);
    setApprovalSteps(prev => {
      const defaults = defaultStepsForCount(newCount);
      return defaults.map((d, i) => {
        if (prev[i]) {
          return {
            role: d.role,
            title: prev[i].title || d.title,
            userId: prev[i].userId || d.userId
          };
        }
        return d;
      });
    });
  };

  const updateApprovalStep = (idx: number, patch: Partial<ApprovalStep>) => {
    setApprovalSteps(prev => prev.map((step, i) => (i === idx ? { ...step, ...patch } : step)));
  };

  const handleSaveApprovalLine = () => {
    localStorage.setItem('erp_ot_approval_line', JSON.stringify(approvalSteps));
    setSaveLineNotice('결재선이 기본값으로 저장되었습니다.');
    setTimeout(() => setSaveLineNotice(null), 3000);
  };

  // 연월 및 부서 조건 필터링된 OT 레코드
  const filteredRecords = useMemo(() => {
    return overtimeRecords.filter(ot => {
      const dateKey = (ot.startDateTime || (ot as any).workDate || ot.createdAt || '').substring(0, 7);
      if (dateKey !== targetMonth) return false;

      if (selectedDeptId !== 'ALL') {
        const u = findUser(ot.userId);
        if (u?.departmentId !== selectedDeptId) return false;
      }
      return true;
    }).sort((a, b) => {
      const dtA = a.startDateTime || a.createdAt || '';
      const dtB = b.startDateTime || b.createdAt || '';
      return dtA.localeCompare(dtB);
    });
  }, [overtimeRecords, targetMonth, selectedDeptId, activeSortedUsers]);

  // 임직원별 요약 집계 (금액 일절 배제: 인당 시간, 건수, 식사)
  const employeeSummaries = useMemo(() => {
    const userMap = new Map<string, {
      userId: string;
      user?: UserType;
      deptName: string;
      name: string;
      position: string;
      recordCount: number;
      totalHours: number;
      mealCount: number;
    }>();

    filteredRecords.forEach(r => {
      const u = findUser(r.userId);
      const uId = r.userId;
      const deptName = getEmployeeDeptName(u);
      const name = u?.name || uId;
      const position = u?.position || '-';

      const existing = userMap.get(uId) || {
        userId: uId,
        user: u,
        deptName,
        name,
        position,
        recordCount: 0,
        totalHours: 0,
        mealCount: 0
      };

      existing.recordCount += 1;
      existing.totalHours += (r.hours || 0);
      if (r.mealYn === 'Y' || r.hasMeal) {
        existing.mealCount += 1;
      }

      userMap.set(uId, existing);
    });

    return Array.from(userMap.values()).sort((a, b) => {
      const deptA = getDeptOrder(a.user?.departmentId);
      const deptB = getDeptOrder(b.user?.departmentId);
      if (deptA !== deptB) return deptA - deptB;

      const posA = getPositionRank(a.user?.position);
      const posB = getPositionRank(b.user?.position);
      if (posA !== posB) return posA - posB;

      return a.name.localeCompare(b.name, 'ko');
    });
  }, [filteredRecords, activeSortedUsers]);

  // 전체 총계 (총 인원, 총 건수, 총 시간, 총 식사)
  const totals = useMemo(() => {
    const totalUsers = employeeSummaries.length;
    const totalCount = filteredRecords.length;
    const totalHours = filteredRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
    const totalMeals = filteredRecords.filter(r => r.mealYn === 'Y' || r.hasMeal).length;
    return { totalUsers, totalCount, totalHours, totalMeals };
  }, [employeeSummaries, filteredRecords]);

  const [yearStr, monthStr] = useMemo(() => {
    const parts = targetMonth.split('-');
    return [parts[0] || '2026', parts[1] || '01'];
  }, [targetMonth]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, '0')}월 ${String(d.getDate()).padStart(2, '0')}일`;
  }, []);

  // 🖨️ 인쇄 액션
  const handlePrint = () => {
    window.print();
  };

  // 📥 엑셀 내보내기 (금액 정보 100% 미포함 보장)
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: 요약표
    const summaryData = employeeSummaries.map((emp, idx) => ({
      '순번': idx + 1,
      '부서': emp.deptName,
      '직급': emp.position,
      '성명': emp.name,
      '등록 건수': emp.recordCount,
      '총 OT 인정시간 (h)': Number(emp.totalHours.toFixed(1)),
      '식사 횟수': emp.mealCount
    }));

    summaryData.push({
      '순번': '합계' as any,
      '부서': `총 ${totals.totalUsers}명` as any,
      '직급': '-' as any,
      '성명': '-' as any,
      '등록 건수': totals.totalCount,
      '총 OT 인정시간 (h)': Number(totals.totalHours.toFixed(1)),
      '식사 횟수': totals.totalMeals
    });

    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'OT_인당시간요약');

    // Sheet 2: 일자별 세부 내역
    if (includeDetails) {
      const detailData = filteredRecords.map((r, idx) => {
        const u = findUser(r.userId);
        const dtStr = (r.startDateTime || (r as any).workDate || r.createdAt || '').substring(0, 10);
        const timeStr = (r.startDateTime || '').substring(11, 16) || '-';
        return {
          'No': idx + 1,
          '근무일자': dtStr,
          '요일': getDayOfWeekKr(dtStr),
          '성명': u?.name || r.userId,
          '부서': getEmployeeDeptName(u),
          '직급': u?.position || '-',
          '시작시각': timeStr,
          '인정시간 (h)': r.hours || 0,
          '식사여부': (r.mealYn === 'Y' || r.hasMeal) ? 'Y' : 'N',
          '초과근무 상세 내용': r.workDetail || '-'
        };
      });

      const wsDetail = XLSX.utils.json_to_sheet(detailData);
      XLSX.utils.book_append_sheet(wb, wsDetail, '일자별_세부증빙');
    }

    const deptSuffix = selectedDeptId === 'ALL' ? '전체' : (departmentMap.get(selectedDeptId) || '부서');
    XLSX.writeFile(wb, `초과근무확인서_${targetMonth}_${deptSuffix}.xlsx`);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        overflowY: 'auto',
        padding: '24px 16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{`
        /* 화면 기본 스타일 */
        .ot-doc-no-print {
          display: flex;
        }

        #printable-ot-approval-canvas {
          background-color: #ffffff !important;
          color: #111827 !important;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", helvetica, "Apple SD Gothic Neo", sans-serif;
        }

        #printable-ot-approval-canvas * {
          color: #111827 !important;
          box-sizing: border-box;
        }

        #printable-ot-approval-canvas table {
          border-collapse: collapse;
          width: 100%;
          table-layout: auto;
        }

        #printable-ot-approval-canvas th,
        #printable-ot-approval-canvas td {
          border: 1px solid #374151 !important;
          padding: 6px 8px;
          font-size: 11px;
          vertical-align: middle;
        }

        #printable-ot-approval-canvas th {
          background-color: #f3f4f6 !important;
          font-weight: 700;
          text-align: center;
        }

        /* 🖨️ A4 세로 인쇄 최적화 규칙 */
        @page {
          size: A4 portrait;
          margin: 10mm 12mm;
        }

        @media print {
          body * {
            visibility: hidden;
          }
          .ot-doc-no-print {
            display: none !important;
          }
          #printable-ot-approval-canvas,
          #printable-ot-approval-canvas * {
            visibility: visible;
          }
          #printable-ot-approval-canvas {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            min-height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .page-break-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .page-break-before {
            page-break-before: always;
            break-before: always;
          }
        }
      `}</style>

      {/* ── 컨트롤 및 설정 패널 (화면용, 인쇄 시 숨김) ── */}
      <div
        className="ot-doc-no-print"
        style={{
          width: '100%',
          maxWidth: '920px',
          backgroundColor: 'var(--bg-card, #1e293b)',
          borderRadius: '10px 10px 0 0',
          border: '1px solid var(--border-color, #334155)',
          borderBottom: 'none',
          padding: '16px 20px',
          flexDirection: 'column',
          gap: '14px',
          color: 'var(--text-main, #f8fafc)'
        }}
      >
        {/* 상단 타이틀 & 닫기 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Printer size={20} style={{ color: 'var(--primary, #3b82f6)' }} />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
              초과근무 결재 문서 출력
            </h3>
            <span style={{ fontSize: '11px', color: '#94a3b8', padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              A4 결재 규격 · 금액 미표시
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={handlePrint}
              style={{
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '7px 14px',
                fontSize: '13px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <Printer size={15} />
              A4 문서 인쇄
            </button>

            <button
              onClick={handleExportExcel}
              style={{
                backgroundColor: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '7px 14px',
                fontSize: '13px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <Download size={15} />
              엑셀 다운로드
            </button>

            <button
              onClick={onClose}
              style={{
                backgroundColor: 'transparent',
                color: '#94a3b8',
                border: '1px solid #475569',
                borderRadius: '6px',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
              title="닫기"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 1. 스코프 필터 (귀속연월, 부서, 상세포함 여부) - 헌장 3.4 세로 스택 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 600 }}>
              귀속연월 (대상기간)
            </label>
            <input
              type="month"
              value={targetMonth}
              onChange={e => setTargetMonth(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                fontSize: '13px'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 600 }}>
              신청 부서
            </label>
            <select
              value={selectedDeptId}
              onChange={e => setSelectedDeptId(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                fontSize: '13px'
              }}
            >
              <option value="ALL">전체 부서 통합</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 600 }}>
              출력 범위 설정
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', padding: '6px 0' }}>
              <input
                type="checkbox"
                checked={includeDetails}
                onChange={e => setIncludeDetails(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <span style={{ color: '#e2e8f0' }}>일자별 세부 증빙(표 2) 포함</span>
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 600 }}>
              집계 현황
            </span>
            <div style={{ fontSize: '13px', color: '#38bdf8', fontWeight: 700, padding: '6px 0' }}>
              {totals.totalUsers}명 / {totals.totalCount}건 / {totals.totalHours.toFixed(1)}h
            </div>
          </div>
        </div>

        {/* 2. 순차 결재선 설정 (2단계 / 3단계 / 4단계) */}
        <div style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={16} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#f1f5f9' }}>
                순차 결재선 지정 (A4 우상단 배치)
              </span>
              
              <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
                {([2, 3, 4] as const).map(cnt => (
                  <button
                    key={cnt}
                    onClick={() => handleStepCountChange(cnt)}
                    style={{
                      padding: '3px 9px',
                      borderRadius: '4px',
                      border: '1px solid',
                      fontSize: '11px',
                      fontWeight: stepCount === cnt ? 700 : 500,
                      backgroundColor: stepCount === cnt ? '#3b82f6' : 'transparent',
                      borderColor: stepCount === cnt ? '#60a5fa' : '#475569',
                      color: stepCount === cnt ? '#ffffff' : '#cbd5e1',
                      cursor: 'pointer'
                    }}
                  >
                    {cnt}단계 {cnt === 3 ? '(권장)' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {saveLineNotice && (
                <span style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600 }}>
                  ✓ {saveLineNotice}
                </span>
              )}
              <button
                onClick={handleSaveApprovalLine}
                style={{
                  backgroundColor: '#334155',
                  color: '#e2e8f0',
                  border: '1px solid #475569',
                  borderRadius: '5px',
                  padding: '4px 10px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
                title="현재 결재선을 브라우저에 기본값으로 기억합니다"
              >
                <Save size={13} />
                기본 결재선 저장
              </button>
            </div>
          </div>

          {/* 단계별 결재자 선택 카드 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stepCount}, 1fr)`, gap: '10px' }}>
            {approvalSteps.slice(0, stepCount).map((step, idx) => {
              const u = findUser(step.userId);
              return (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 700 }}>
                      {idx + 1}단계: {step.role}
                    </span>
                    <input
                      type="text"
                      value={step.title}
                      onChange={e => updateApprovalStep(idx, { title: e.target.value })}
                      placeholder="직책 (예: 부서장)"
                      style={{
                        width: '75px',
                        padding: '2px 5px',
                        fontSize: '11px',
                        backgroundColor: '#1e293b',
                        color: '#f8fafc',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        textAlign: 'center'
                      }}
                    />
                  </div>

                  <select
                    value={step.userId}
                    onChange={e => updateApprovalStep(idx, { userId: e.target.value })}
                    style={{
                      padding: '4px 6px',
                      borderRadius: '4px',
                      border: '1px solid #475569',
                      backgroundColor: '#1e293b',
                      color: '#f8fafc',
                      fontSize: '12px'
                    }}
                  >
                    <option value="">결재자 선택 (공란 가능)</option>
                    {activeSortedUsers.map(usr => (
                      <option key={usr.id} value={usr.id}>
                        {usr.name} {usr.position ? `(${usr.position})` : ''} - {getEmployeeDeptName(usr)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── A4 인쇄 대상 캔버스 (#printable-ot-approval-canvas) ── */}
      <div
        id="printable-ot-approval-canvas"
        style={{
          width: '100%',
          maxWidth: '920px',
          backgroundColor: '#ffffff',
          borderRadius: '0 0 10px 10px',
          padding: '36px 40px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          minHeight: '1100px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}
      >
        {/* 문서 최상단: 제목 및 순차 결재란 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #111827', paddingBottom: '16px' }}>
          {/* 좌측: 문서 타이틀 및 메타 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 900, letterSpacing: '-0.5px', color: '#111827' }}>
              초과근무(OT) 확인 및 결재신청서
            </h1>
            <div style={{ fontSize: '11.5px', color: '#4b5563', fontWeight: 600 }}>
              ※ 본 문서는 임직원 초과근무 시간 확인 및 결재용이며, 개인별 시급·급여 금액은 표기되지 않습니다.
            </div>
            <div style={{ marginTop: '6px', display: 'flex', gap: '16px', fontSize: '12px' }}>
              <span><strong>귀속연월:</strong> {yearStr}년 {monthStr}월</span>
              <span><strong>신청부서:</strong> {selectedDeptId === 'ALL' ? '전체 부서 통합' : (departmentMap.get(selectedDeptId) || '-')}</span>
              <span><strong>기안일자:</strong> {todayStr}</span>
            </div>
          </div>

          {/* 우측: 순차 결재란 테이블 (가로 2~4칸) */}
          <div style={{ flexShrink: 0 }}>
            <table style={{ width: `${stepCount * 72}px`, borderCollapse: 'collapse', textAlign: 'center' }}>
              <tbody>
                {/* 상단: 직책명 */}
                <tr>
                  {approvalSteps.slice(0, stepCount).map((step, idx) => (
                    <th
                      key={idx}
                      style={{
                        width: '72px',
                        padding: '4px 2px',
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: '#f3f4f6',
                        border: '1px solid #111827',
                        color: '#111827'
                      }}
                    >
                      {step.title || step.role}
                    </th>
                  ))}
                </tr>

                {/* 중단: 결재자 성명 및 서명/날인 영역 (높이 55px) */}
                <tr style={{ height: '55px' }}>
                  {approvalSteps.slice(0, stepCount).map((step, idx) => {
                    const u = findUser(step.userId);
                    return (
                      <td
                        key={idx}
                        style={{
                          height: '55px',
                          border: '1px solid #111827',
                          verticalAlign: 'bottom',
                          padding: '4px',
                          textAlign: 'center',
                          fontSize: '11px',
                          color: '#111827'
                        }}
                      >
                        {u ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 600 }}>{u.name}</span>
                            <span style={{ fontSize: '9px', color: '#6b7280' }}>(서명/인)</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '9px', color: '#9ca3af' }}>(서명/인)</span>
                        )}
                      </td>
                    );
                  })}
                </tr>

                {/* 하단: 결재일자 칸 */}
                <tr>
                  {approvalSteps.slice(0, stepCount).map((_, idx) => (
                    <td
                      key={idx}
                      style={{
                        border: '1px solid #111827',
                        padding: '2px',
                        fontSize: '9.5px',
                        color: '#4b5563',
                        textAlign: 'center',
                        height: '18px'
                      }}
                    >
                      {idx === 0 ? todayStr.replace('년 ', '.').replace('월 ', '.').replace('일', '') : ''}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 요약 통계 배너 바 ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '10px 16px' }}>
          <div style={{ display: 'flex', gap: '24px', fontSize: '12px' }}>
            <span><strong>대상 인원:</strong> 총 {totals.totalUsers}명</span>
            <span><strong>총 등록건수:</strong> {totals.totalCount}건</span>
            <span><strong>총 식사제공:</strong> {totals.totalMeals}회</span>
          </div>
          <div style={{ fontSize: '14px', fontWeight: 900, color: '#1e3a8a' }}>
            총 인정 초과근무 시간: <span style={{ fontSize: '16px', color: '#dc2626' }}>{totals.totalHours.toFixed(1)}</span> 시간
          </div>
        </div>

        {/* ── [표 1] 임직원별 초과근무 집계 요약 (인당 시간 중심) ── */}
        <div className="page-break-avoid" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#111827' }}>
              [표 1] 임직원별 초과근무 시간 합계 요약
            </h2>
            <span style={{ fontSize: '10.5px', color: '#6b7280' }}>
              (단위: 시간, 회 / 개인별 확인 서명 필수)
            </span>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: '38px' }}>순번</th>
                <th style={{ width: '100px' }}>부서</th>
                <th style={{ width: '70px' }}>직급</th>
                <th style={{ width: '80px' }}>성명</th>
                <th style={{ width: '70px' }}>등록건수</th>
                <th style={{ width: '120px' }}>총 OT 인정시간</th>
                <th style={{ width: '75px' }}>식사여부(Y)</th>
                <th style={{ width: '110px' }}>본인확인 서명</th>
              </tr>
            </thead>
            <tbody>
              {employeeSummaries.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>
                    해당 연월({targetMonth})의 초과근무(OT) 등록 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                employeeSummaries.map((emp, idx) => (
                  <tr key={emp.userId}>
                    <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{emp.deptName}</td>
                    <td style={{ textAlign: 'center' }}>{emp.position}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{emp.name}</td>
                    <td style={{ textAlign: 'center' }}>{emp.recordCount}건</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, paddingRight: '12px' }}>
                      {emp.totalHours.toFixed(1)} 시간
                    </td>
                    <td style={{ textAlign: 'center' }}>{emp.mealCount > 0 ? `${emp.mealCount}회` : '-'}</td>
                    <td style={{ textAlign: 'center', color: '#9ca3af', height: '26px' }}>
                      (서명/인)
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f3f4f6', fontWeight: 800 }}>
                <td colSpan={4} style={{ textAlign: 'center' }}>
                  합 계 (총 {totals.totalUsers}명)
                </td>
                <td style={{ textAlign: 'center' }}>{totals.totalCount}건</td>
                <td style={{ textAlign: 'right', paddingRight: '12px', color: '#b91c1c', fontSize: '12px' }}>
                  {totals.totalHours.toFixed(1)} 시간
                </td>
                <td style={{ textAlign: 'center' }}>{totals.totalMeals}회</td>
                <td style={{ textAlign: 'center', fontSize: '10px', color: '#6b7280' }}>정산 승인</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── [표 2] 일자별 세부 증빙 내역 (토글 ON 시) ── */}
        {includeDetails && filteredRecords.length > 0 && (
          <div className="page-break-before" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#111827' }}>
                [표 2] 일자별 세부 초과근무 증빙 내역
              </h2>
              <span style={{ fontSize: '10.5px', color: '#6b7280' }}>
                총 {filteredRecords.length}건 등록
              </span>
            </div>

            <table>
              <thead>
                <tr>
                  <th style={{ width: '32px' }}>No</th>
                  <th style={{ width: '75px' }}>근무일자</th>
                  <th style={{ width: '38px' }}>요일</th>
                  <th style={{ width: '75px' }}>성명</th>
                  <th style={{ width: '80px' }}>부서</th>
                  <th style={{ width: '85px' }}>시작시각</th>
                  <th style={{ width: '75px' }}>인정시간</th>
                  <th style={{ width: '50px' }}>식사</th>
                  <th>초과근무 상세 내용</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((r, idx) => {
                  const u = findUser(r.userId);
                  const dtStr = (r.startDateTime || (r as any).workDate || r.createdAt || '').substring(0, 10);
                  const timeStr = (r.startDateTime || '').substring(11, 16) || '-';
                  const isWeekend = ['토', '일'].includes(getDayOfWeekKr(dtStr));

                  return (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{dtStr}</td>
                      <td style={{ textAlign: 'center', color: isWeekend ? '#dc2626' : '#111827', fontWeight: isWeekend ? 700 : 400 }}>
                        {getDayOfWeekKr(dtStr)}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>{u?.name || r.userId}</td>
                      <td style={{ textAlign: 'center', fontSize: '10.5px' }}>{getEmployeeDeptName(u)}</td>
                      <td style={{ textAlign: 'center', fontSize: '10.5px' }}>{timeStr}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, paddingRight: '8px' }}>
                        {(r.hours || 0).toFixed(1)}h
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {(r.mealYn === 'Y' || r.hasMeal) ? 'Y' : '-'}
                      </td>
                      <td style={{ textAlign: 'left', wordBreak: 'break-all' }}>
                        {r.workDetail || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 하단 확인 서약 및 결재 상신문 ── */}
        <div className="page-break-avoid" style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid #9ca3af', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#1f2937', textAlign: 'center', lineHeight: 1.6 }}>
            상기 임직원의 {yearStr}년 {monthStr}월 초과근무 시간 및 세부 업무 내역을 정히 확인하였으며,<br />
            이에 관련 규정에 의거하여 수당 지급을 위한 결재를 신청합니다.
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: '600px', marginTop: '12px', fontSize: '12.5px', color: '#111827' }}>
            <span><strong>기안일자:</strong> {todayStr}</span>
            <span>
              <strong>기안자:</strong> {currentUser?.name || '담당자'} (인/서명)
            </span>
          </div>

          <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '8px' }}>
            (주)기연리프트 전사 ERP 자산관리시스템 발급 문서
          </div>
        </div>

      </div>
    </div>
  );
};
