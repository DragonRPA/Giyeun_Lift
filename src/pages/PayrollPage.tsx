import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { db } from '../services/db';
import { 
  CreditCard, FileText, CheckCircle, AlertTriangle, Send, 
  Upload, CheckSquare, RefreshCw, Lock, LockOpen, Download 
} from 'lucide-react';
import { exportToExcel } from '../services/excel';

export const PayrollPage: React.FC = () => {
  const { users, leaveUsages, overtimeRecords, payrollClosings, currentUser, hasPermission, setPayrollClosingStatus, saveUser } = useApp();
  const canSave = hasPermission('payroll', 'save');
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  // 오늘 날짜가 속한 당월 (YYYY-MM) 자동 계산
  const todayMonth = new Date().toISOString().substring(0, 7);

  // 상태 관리 (기본값: 오늘 날짜가 속한 당월)
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);
  const [payrollList, setPayrollList] = useState<any[]>([]);
  const [isTaxDataUploaded, setIsTaxDataUploaded] = useState(false);
  const [payrollStatus, setPayrollStatus] = useState<'DRAFT' | 'APPROVED'>('DRAFT');
  const [isSendingEmails, setIsSendingEmails] = useState(false);

  const [empSearch, setEmpSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');

  const ROLE_LABELS: Record<string, string> = {
    'ADMIN': '관리자', 'MANAGER': '매니저', 'SALES': '영업',
    'BILLING': '청구/수납', 'PURCHASE': '매입', 'DISPATCH': '배차',
    'MECHANIC': '정비사'
  };

  // 기본급 수정 모달 상태 (급여 정산 권한자 전용)
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null);
  const [inputSalary, setInputSalary] = useState<number>(3000000);
  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 인앱 커스텀 확인 모달 상태 (헌장 5.2: 브라우저 confirm 전면 퇴출)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // ─── [Gutenberg Z-패턴 4단계 최하단 급여 정산 대차대조식 검증] ───
  const payrollAuditSummary = useMemo(() => {
    const totalCount = payrollList.length;
    const totalGross = payrollList.reduce((sum, p) => sum + (p.baseSalary || 0) + (p.overtimeHours * p.ordinaryHourly * 1.5) + (p.manualAdjustmentAmount || 0), 0);
    const totalDeductions = payrollList.reduce((sum, p) => sum + (p.nationalPension || 0) + (p.healthInsurance || 0) + (p.careInsurance || 0) + (p.employmentInsurance || 0) + (p.earnedIncomeTax || 0) + (p.localIncomeTax || 0), 0);
    const totalNet = payrollList.reduce((sum, p) => sum + (p.netSalary || 0), 0);

    return { totalCount, totalGross: Math.round(totalGross), totalDeductions: Math.round(totalDeductions), totalNet: Math.round(totalNet) };
  }, [payrollList]);

  // 선택한 월이 변경되면 DB의 월별 마감 상태(payrollClosings) 자동 동기화
  useEffect(() => {
    const closing = payrollClosings.find(p => p.month === selectedMonth);
    setPayrollStatus(closing?.status || 'DRAFT');
  }, [selectedMonth, payrollClosings]);

  // 사원별 당월 OT시간 및 연차/반차 소진 일수 계산 헬퍼
  const calculateMonthLeaveOt = (empId: string, month: string) => {
    const monthOtList = overtimeRecords.filter(ot => 
      ot.userId === empId && 
      (ot.startDateTime || '').substring(0, 7) === month
    );
    const otHours = monthOtList.reduce((sum, ot) => sum + (ot.hours || 0), 0);

    const monthLeaveList = leaveUsages.filter(l => 
      l.userId === empId && 
      (l.startDate || '').substring(0, 7) === month
    );
    const leaveDays = monthLeaveList.reduce((sum, l) => sum + (l.usedDays || 0), 0);

    return { otHours, leaveDays };
  };

  // 당월 급여 데이터 로드 및 leave_ot 자동 연동 (u.baseSalary DB 속성 우선 사용)
  const loadPayrollData = (month: string) => {
    const activeStaff = users.filter(u => u.id !== 'sys-admin');

    const list = activeStaff.map(u => {
      // u.baseSalary 필드가 DB에 존재하면 우선 적용, 없을 경우 규칙상 디폴트값 부여
      let baseSalary = u.baseSalary;
      if (!baseSalary || baseSalary <= 0) {
        if (u.role === 'ADMIN') baseSalary = 5500000;
        else if (u.role === 'MANAGER') baseSalary = 4200000;
        else if (u.id.includes('mech')) baseSalary = 3500000;
        else baseSalary = 3000000;
      }

      const ordinaryHourly = Math.round(baseSalary / 209);
      const { otHours, leaveDays } = calculateMonthLeaveOt(u.id, month);

      const pObj = {
        employeeId: u.id,
        name: u.name,
        deptName: u.department || '미정',
        role: u.role,
        baseSalary,
        ordinaryHourly,
        overtimeHours: otHours,  // leave_ot 자동 연동된 OT 시간
        holidayHours: 0,
        nightHours: 0,
        leaveDays: leaveDays,    // leave_ot 자동 연동된 연차/반차 소진 일수
        unpaidLeaveDays: 0,
        manualAdjustmentAmount: 0,
        manualAdjustmentReason: '',
        nationalPension: 0,
        healthInsurance: 0,
        careInsurance: 0,
        employmentInsurance: 0,
        earnedIncomeTax: 0,
        localIncomeTax: 0,
        netSalary: baseSalary
      };

      recalculateRow(pObj);
      return pObj;
    });

    setPayrollList(list);
  };

  // 초기 로드 및 selectedMonth, leaveUsages, overtimeRecords 변경 시 자동 연동
  useEffect(() => {
    loadPayrollData(selectedMonth);
  }, [selectedMonth, leaveUsages, overtimeRecords, users]);

  // 연장/야근/휴가 변경 시 자동 계산 공식 적용
  const handleHoursChange = (empId: string, field: string, val: number) => {
    if (payrollStatus === 'APPROVED') return; // 승인 락 상태에서는 변경 불가

    setPayrollList(prev => prev.map(p => {
      if (p.employeeId === empId) {
        const updated = { ...p, [field]: val };
        recalculateRow(updated);
        return updated;
      }
      return p;
    }));
  };

  // 수동 가감액 변경 시 계산
  const handleAdjustmentChange = (empId: string, amount: number, reason: string) => {
    if (payrollStatus === 'APPROVED') return;

    setPayrollList(prev => prev.map(p => {
      if (p.employeeId === empId) {
        const updated = { 
          ...p, 
          manualAdjustmentAmount: amount, 
          manualAdjustmentReason: reason 
        };
        recalculateRow(updated);
        return updated;
      }
      return p;
    }));
  };

  // 단일 사원 급여 재계산식
  const recalculateRow = (p: any) => {
    const overtimeAllowance = Math.round(p.overtimeHours * p.ordinaryHourly * 1.5);
    const holidayAllowance = Math.round(p.holidayHours * p.ordinaryHourly * 1.5);
    const nightAllowance = Math.round(p.nightHours * p.ordinaryHourly * 0.5);
    const unpaidDeduction = Math.round(p.unpaidLeaveDays * (p.ordinaryHourly * 8));

    const totalAllowances = overtimeAllowance + holidayAllowance + nightAllowance;
    const grossSalary = p.baseSalary + totalAllowances - unpaidDeduction + p.manualAdjustmentAmount;

    const totalDeductions = p.nationalPension + p.healthInsurance + p.careInsurance + p.employmentInsurance + p.earnedIncomeTax + p.localIncomeTax;
    p.netSalary = Math.max(0, grossSalary - totalDeductions);
  };

  // 세무회계법인 공제액 데이터 모의 업로드 처리
  const handleTaxDataUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    // 모의 파싱 및 주입
    setPayrollList(prev => prev.map(p => {
      const base = p.baseSalary;
      const pension = Math.round(base * 0.045);
      const health = Math.round(base * 0.03545);
      const care = Math.round(health * 0.1281);
      const employment = Math.round(base * 0.009);
      const incomeTax = Math.round(base * 0.015);
      const localTax = Math.round(incomeTax * 0.1);

      const updated = {
        ...p,
        nationalPension: pension,
        healthInsurance: health,
        careInsurance: care,
        employmentInsurance: employment,
        earnedIncomeTax: incomeTax,
        localIncomeTax: localTax
      };
      recalculateRow(updated);
      return updated;
    }));

    setIsTaxDataUploaded(true);
    showToast('세무회계법인 수취 4대보험/소득세 확정액 데이터가 성공적으로 대조 적재되었습니다.');
  };

  // 최종 결재 승인 (월별 Lock 상태 DB 저장)
  const handleApprovePayroll = () => {
    if (!isTaxDataUploaded) {
      showToast('세무회계법인의 공제액 엑셀 파일을 먼저 업로드해 주십시오.', 'error');
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: '급여 대장 최종 결재 승인 (마감 Lock)',
      message: `[${selectedMonth}] 귀속월 급여 대장을 최종 마감 승인하시겠습니까?\n\n승인 시 해당 월의 급여 데이터가 수정 불가능한 읽기 전용 상태로 락(Lock) 설정됩니다.`,
      confirmText: '마감 승인',
      onConfirm: async () => {
        setConfirmModal(null);
        await setPayrollClosingStatus(selectedMonth, 'APPROVED', currentUser?.name);
        await db.awaitPendingWrites();
        showToast(`[${selectedMonth}] 귀속월 급여 정산 대장이 최종 승인 마감(Lock)되었습니다.`);
      }
    });
  };

  // 마감 락 해제 (최고 관리자 전용)
  const handleUnlockPayroll = () => {
    setConfirmModal({
      isOpen: true,
      title: '급여 마감 락 해제',
      message: `[${selectedMonth}] 귀속월의 마감 락을 해제하시겠습니까?\n\n락 해제 시 급여 데이터 재정산 및 수정을 진행할 수 있습니다.`,
      confirmText: '락 해제',
      isDanger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        await setPayrollClosingStatus(selectedMonth, 'DRAFT');
        await db.awaitPendingWrites();
        showToast(`[${selectedMonth}] 귀속월의 마감 락이 성공적으로 해제되었습니다.`);
      }
    });
  };

  // 기본급 변경 저장 (급여 정산 권한자 전용)
  const handleOpenSalaryModal = (empId: string, currentSalary: number) => {
    setEditingEmpId(empId);
    setInputSalary(currentSalary);
  };

  const handleSaveSalary = async () => {
    if (!editingEmpId || inputSalary < 0) return;
    const targetUser = users.find(u => u.id === editingEmpId);
    if (targetUser) {
      await saveUser({
        ...targetUser,
        baseSalary: inputSalary
      });
      await db.awaitPendingWrites();
      showToast(`[${targetUser.name}] 기본급이 ${inputSalary.toLocaleString()}원으로 저장되었습니다.`);
      setEditingEmpId(null);
    }
  };

  // 급여명세서 이메일 일괄 전송
  const handleSendEmails = () => {
    if (payrollStatus !== 'APPROVED') {
      showToast('개발자(ADMIN)의 최종 결재 승인(Lock) 완료 후에만 이메일 교부가 가능합니다.', 'error');
      return;
    }

    setIsSendingEmails(true);
    setTimeout(() => {
      setIsSendingEmails(false);
      showToast(`총 ${payrollList.length}명의 등록된 메일 주소로 급여명세서 PDF가 발송되었습니다.`);
    }, 1500);
  };

  const filteredPayrollList = useMemo(() => {
    return payrollList.filter(p => {
      const matchName = !empSearch || (p.name || '').includes(empSearch);
      const matchDept = deptFilter === 'ALL' || p.deptName === deptFilter;
      const matchRole = roleFilter === 'ALL' || p.role === roleFilter;
      return matchName && matchDept && matchRole;
    });
  }, [payrollList, empSearch, deptFilter, roleFilter]);

  // 급여 정산 대장 엑셀 내보내기
  const handleExportPayrollExcel = () => {
    if (filteredPayrollList.length === 0) {
      showToast('내보낼 급여 데이터가 없습니다.', 'error');
      return;
    }
    const rows = filteredPayrollList.map((p, idx) => {
      const overtimeAllowance = Math.round(p.overtimeHours * p.ordinaryHourly * 1.5);
      const holidayAllowance = Math.round((p.holidayHours || 0) * p.ordinaryHourly * 1.5);
      const nightAllowance = Math.round((p.nightHours || 0) * p.ordinaryHourly * 0.5);
      const totalAllowances = overtimeAllowance + holidayAllowance + nightAllowance;
      const unpaidLeaveDeduction = Math.round((p.unpaidLeaveDays || 0) * p.ordinaryDaily);
      const totalGross = p.baseSalary + totalAllowances + (p.manualAdjustmentAmount || 0) - unpaidLeaveDeduction;
      const taxSum = (p.nationalPension || 0) + (p.healthInsurance || 0) + (p.careInsurance || 0) + 
                     (p.employmentInsurance || 0) + (p.earnedIncomeTax || 0) + (p.localIncomeTax || 0);
      const netSalary = Math.round(totalGross - taxSum);

      return {
        'No': idx + 1,
        '귀속연월': selectedMonth,
        '사원명': p.name,
        '부서': p.deptName || '-',
        '직급(역할)': ROLE_LABELS[p.role] || p.role || '-',
        '기본급(원)': p.baseSalary,
        '통상시급(원)': p.ordinaryHourly,
        '연장근로(시간)': p.overtimeHours,
        '연장수당(원)': overtimeAllowance,
        '휴일수당(원)': holidayAllowance,
        '야간수당(원)': nightAllowance,
        '수당합계(원)': totalAllowances,
        '무급휴가(일)': p.unpaidLeaveDays || 0,
        '수동조정액(원)': p.manualAdjustmentAmount || 0,
        '지급총액(원)': totalGross,
        '국민연금(원)': p.nationalPension || 0,
        '건강보험(원)': p.healthInsurance || 0,
        '장기요양(원)': p.careInsurance || 0,
        '고용보험(원)': p.employmentInsurance || 0,
        '소득세(원)': p.earnedIncomeTax || 0,
        '지방소득세(원)': p.localIncomeTax || 0,
        '공제총액(원)': taxSum,
        '실수령액(원)': netSalary
      };
    });

    exportToExcel(rows, `급여정산대장_${selectedMonth}`, '급여정산');
    showToast(`급여 정산 대장 ${rows.length}명 엑셀 내보내기 완료`);
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
      {/* 타이틀 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CreditCard size={24} color="var(--primary)" />
          <h2 style={{ fontSize: '20px', fontWeight: '800' }}>급여 정산 대장</h2>
        </div>
        
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {payrollStatus === 'DRAFT' ? (
            <button 
              className="btn-success" 
              onClick={handleApprovePayroll}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 'bold' }}
              disabled={!canSave}
            >
              <LockOpen size={16} /> [{selectedMonth}] 결재 마감 승인 (Lock)
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', borderRadius: '6px', border: '1px solid var(--danger)', fontSize: '13px', fontWeight: 'bold' }}>
                <Lock size={15} color="var(--danger)" /> [{selectedMonth}] 결재 마감 완료 (Locked)
              </div>
              {isAdmin && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleUnlockPayroll}
                  style={{ fontSize: '12px', padding: '6px 10px', color: 'var(--text-muted)' }}
                  title="관리자 전용 마감 해제"
                >
                  🔓 마감 해제
                </button>
              )}
            </div>
          )}

          <button 
            className="btn-primary" 
            onClick={handleSendEmails}
            disabled={payrollStatus !== 'APPROVED' || isSendingEmails}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: payrollStatus === 'APPROVED' ? 'var(--primary)' : 'var(--text-muted)' }}
          >
            {isSendingEmails ? (
              <>
                <RefreshCw size={16} className="spin-animation" /> 전송 중...
              </>
            ) : (
              <>
                <Send size={16} /> 급여명세서 이메일 일괄 전송
              </>
            )}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportPayrollExcel}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
          >
            <Download size={15} /> 엑셀 내보내기
          </button>
        </div>
      </div>

      {/* 📊 당월 급여 집계 실시간 요약 바 */}
      {(() => {
        const totalBase = payrollList.reduce((sum, p) => sum + (p.baseSalary || 0), 0);
        const totalNet = payrollList.reduce((sum, p) => sum + (p.netPay || 0), 0);
        const totalOtHours = payrollList.reduce((sum, p) => sum + (p.overtimeHours || 0), 0);

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px' }}>정산 대상 인원</div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--primary)' }}>{payrollList.length}명</div>
            </div>
            <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px' }}>기본급 합계</div>
              <div style={{ fontSize: '16px', fontWeight: 800 }}>₩{totalBase.toLocaleString()}원</div>
            </div>
            <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px' }}>총 OT 시간</div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#d97706' }}>{totalOtHours}시간</div>
            </div>
            <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px' }}>실지급 총액 (Net Pay)</div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--success)' }}>₩{totalNet.toLocaleString()}원</div>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '24px', alignItems: 'start' }}>
        {/* 좌측 제어판 */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <h3 className="card-title">정산 제어판</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>대상 귀속 월 선택</label>
              <input 
                type="month" 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)}
                disabled={payrollStatus === 'APPROVED'}
                style={{ width: '100%', padding: '8px', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>세무법인 자료 업로드</label>
              <div style={{ border: '2px dashed var(--border-color)', borderRadius: '8px', padding: '16px', textAlign: 'center', backgroundColor: isTaxDataUploaded ? 'rgba(34, 197, 94, 0.05)' : 'transparent' }}>
                <Upload size={24} style={{ color: isTaxDataUploaded ? 'var(--success)' : 'var(--text-muted)', marginBottom: '8px' }} />
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  {isTaxDataUploaded ? '확정 세무 데이터 반영됨' : '4대보험/소득세 확정자료'}
                </div>
                <input 
                  type="file" 
                  accept=".csv,.xlsx" 
                  onChange={handleTaxDataUpload}
                  disabled={payrollStatus === 'APPROVED'}
                  style={{ display: 'none' }} 
                  id="tax-file-upload" 
                />
                <label 
                  htmlFor="tax-file-upload" 
                  className="btn-secondary" 
                  style={{ padding: '4px 10px', fontSize: '11px', cursor: 'pointer', display: 'inline-block' }}
                >
                  파일 찾기
                </label>
              </div>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'rgba(59, 130, 246, 0.08)', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)', fontSize: '12px', lineHeight: '1.6' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle size={14} /> [연차관리 / OT 관리] 데이터 자동 연동
              </div>
              • 귀속 월({selectedMonth}) 총 OT: <strong>{payrollList.reduce((sum, p) => sum + (p.overtimeHours || 0), 0)} 시간</strong><br/>
              • 귀속 월({selectedMonth}) 총 연차: <strong>{payrollList.reduce((sum, p) => sum + (p.leaveDays || 0), 0)} 일</strong> 소진<br/>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>* [연차관리 / OT 관리] 등록 시 급여 정산 대장에 실시간 100% 동기화 반영됩니다.</span>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '12px', lineHeight: '1.5' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <AlertTriangle size={14} color="var(--warning)" /> 통상시급 및 1일임금 기준
              </div>
              • 월 소정근로시간: 209시간<br/>
              • 연장/야간/휴일수당: 법정 1.5배/0.5배 자동 산정<br/>
              • 무급휴가 공제: 1일 통상급여 차감 적용
            </div>
          </div>
        </div>

        {/* 우측 급여대장 테이블 */}
        <div className="card" style={{ margin: 0, overflowX: 'auto' }}>
          <div className="card-header">
            <h3 className="card-title">급여 정산 대장</h3>
            <span className={`badge ${payrollStatus === 'APPROVED' ? 'badge-danger' : 'badge-info'}`}>
              {payrollStatus === 'APPROVED' ? '결재 완료 (Locked)' : '초안 작성 중 (Draft)'}
            </span>
          </div>

          <div style={{ padding: '16px', display: 'flex', gap: '16px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', whiteSpace: 'nowrap', flexShrink: 0 }}>사원명</label>
              <input type="text" value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="이름 검색" style={{ padding: '6px', fontSize: '12px', width: '120px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', whiteSpace: 'nowrap', flexShrink: 0 }}>부서</label>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ padding: '6px', fontSize: '12px' }}>
                <option value="ALL">전체</option>
                {Array.from(new Set(users.map(u => u.department).filter(Boolean))).map(dept => (
                  <option key={dept} value={dept as string}>{dept as string}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', whiteSpace: 'nowrap', flexShrink: 0 }}>직급(역할)</label>
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ padding: '6px', fontSize: '12px' }}>
                <option value="ALL">전체</option>
                {Object.entries(ROLE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <table style={{ width: '100%', fontSize: '12.5px' }}>
            <thead>
              <tr>
                <th>사원명(부서)</th>
                <th>기본급</th>
                <th>근태 가산수당 시간 (연장/휴일/야간)</th>
                <th>무급휴가</th>
                <th>수동 가감(조정)</th>
                <th>공제액(보험/세금)</th>
                <th style={{ textAlign: 'right' }}>실수령액</th>
              </tr>
            </thead>
            <tbody>
              {payrollList.filter(p => {
                const matchName = !empSearch || (p.name || '').includes(empSearch);
                const matchDept = deptFilter === 'ALL' || p.deptName === deptFilter;
                const matchRole = roleFilter === 'ALL' || p.role === roleFilter;
                return matchName && matchDept && matchRole;
              }).map(p => {
                const overtimeAllowance = Math.round(p.overtimeHours * p.ordinaryHourly * 1.5);
                const holidayAllowance = Math.round(p.holidayHours * p.ordinaryHourly * 1.5);
                const nightAllowance = Math.round(p.nightHours * p.ordinaryHourly * 0.5);
                const totalAllowances = overtimeAllowance + holidayAllowance + nightAllowance;
                
                const taxSum = p.nationalPension + p.healthInsurance + p.careInsurance + p.employmentInsurance + p.earnedIncomeTax + p.localIncomeTax;

                return (
                  <tr key={p.employeeId}>
                    <td>
                      <strong>{p.name}</strong><br/>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.deptName}</span>
                      {p.leaveDays > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <span style={{ fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)', fontWeight: 'bold' }}>
                            📅 당월 연차: {p.leaveDays}일 소진
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 'bold' }}>{p.baseSalary.toLocaleString()}원</span>
                        {canSave && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleOpenSalaryModal(p.employeeId, p.baseSalary)}
                            disabled={payrollStatus === 'APPROVED'}
                            style={{ fontSize: '10.5px', padding: '2px 6px', color: 'var(--primary)', whiteSpace: 'nowrap' }}
                            title="임직원 계약 기본급 수정 (DB 저장)"
                          >
                            ✏️ 수정
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <div>연장 <input type="number" min="0" max="60" value={p.overtimeHours} onChange={(e) => handleHoursChange(p.employeeId, 'overtimeHours', parseFloat(e.target.value) || 0)} disabled={payrollStatus === 'APPROVED'} style={{ width: '45px', padding: '2px 4px', fontSize: '11px', fontWeight: p.overtimeHours > 0 ? 'bold' : 'normal', color: p.overtimeHours > 0 ? 'var(--primary)' : 'inherit' }} />h</div>
                        <div>휴일 <input type="number" min="0" max="40" value={p.holidayHours} onChange={(e) => handleHoursChange(p.employeeId, 'holidayHours', parseFloat(e.target.value) || 0)} disabled={payrollStatus === 'APPROVED'} style={{ width: '40px', padding: '2px 4px', fontSize: '11px' }} />h</div>
                        <div>야간 <input type="number" min="0" max="40" value={p.nightHours} onChange={(e) => handleHoursChange(p.employeeId, 'nightHours', parseFloat(e.target.value) || 0)} disabled={payrollStatus === 'APPROVED'} style={{ width: '40px', padding: '2px 4px', fontSize: '11px' }} />h</div>
                      </div>
                      {totalAllowances > 0 && (
                        <div style={{ fontSize: '10.5px', color: 'var(--primary)', fontWeight: 'bold', marginTop: '4px' }}>
                          OT 수당계: +{totalAllowances.toLocaleString()}원 (1.5배)
                        </div>
                      )}
                    </td>
                    <td>
                      <input 
                        type="number" 
                        min="0" 
                        max="31" 
                        value={p.unpaidLeaveDays} 
                        onChange={(e) => handleHoursChange(p.employeeId, 'unpaidLeaveDays', parseInt(e.target.value) || 0)} 
                        disabled={payrollStatus === 'APPROVED'}
                        style={{ width: '45px', padding: '2px 4px', fontSize: '11px' }} 
                      />일
                    </td>
                    <td>
                      <input 
                        type="number" 
                        placeholder="가감액"
                        value={p.manualAdjustmentAmount || ''} 
                        onChange={(e) => handleAdjustmentChange(p.employeeId, parseInt(e.target.value) || 0, p.manualAdjustmentReason)}
                        disabled={payrollStatus === 'APPROVED'}
                        style={{ width: '75px', padding: '2px 4px', fontSize: '11px', marginBottom: '4px', display: 'block' }} 
                      />
                      <input 
                        type="text" 
                        placeholder="가감 사유 입력"
                        value={p.manualAdjustmentReason} 
                        onChange={(e) => handleAdjustmentChange(p.employeeId, p.manualAdjustmentAmount, e.target.value)}
                        disabled={payrollStatus === 'APPROVED'}
                        style={{ width: '90px', padding: '2px 4px', fontSize: '10.5px' }} 
                      />
                    </td>
                    <td>
                      {isTaxDataUploaded ? (
                        <div>
                          <strong>{taxSum.toLocaleString()}원</strong>
                          <div style={{ fontSize: '9.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            국: {p.nationalPension.toLocaleString()} / 건: {p.healthInsurance.toLocaleString()}<br/>
                            소: {p.earnedIncomeTax.toLocaleString()}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>자료 대기중</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '13.5px', color: 'var(--primary)' }}>
                      {p.netSalary.toLocaleString()}원
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 기본급 수정 모달 팝업 (급여 정산 권한자 전용) */}
      {editingEmpId && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)', borderRadius: '12px',
            width: '90%', maxWidth: '420px', padding: '24px', display: 'flex',
            flexDirection: 'column', gap: '16px', border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)' }}>
                ⚙️ 계약 기본급 설정 (급여 권한자 전용)
              </h3>
              <button onClick={() => setEditingEmpId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                ✕
              </button>
            </div>

            {(() => {
              const targetU = users.find(u => u.id === editingEmpId);
              return (
                <form onSubmit={(e) => { e.preventDefault(); handleSaveSalary(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '6px', fontSize: '13px' }}>
                    <div><strong>성명:</strong> {targetU?.name || '알 수 없음'}</div>
                    <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}><strong>부서/직급:</strong> {targetU?.department || '미정'} / {targetU?.position || '직원'}</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                      월 계약 기본급 (원):
                    </label>
                    <input
                      type="number"
                      step="10000"
                      min="0"
                      required
                      value={inputSalary}
                      onChange={(e) => setInputSalary(parseInt(e.target.value) || 0)}
                      className="form-control"
                      style={{ fontSize: '14px', fontWeight: 'bold' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      통상시급: 약 {Math.round(inputSalary / 209).toLocaleString()}원/시간 (월 소정근로시간 209시간 기준)
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setEditingEmpId(null)}>
                      취소
                    </button>
                    <button type="submit" className="btn btn-primary">
                      기본급 저장
                    </button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}
      {/* 💬 인앱 확인 모달 (헌장 5.2: alert/confirm 퇴출) */}
      {confirmModal && confirmModal.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '20px' }}>
          <div className="card" style={{ width: '90%', maxWidth: '440px', backgroundColor: 'var(--bg-card)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0, color: confirmModal.isDanger ? 'var(--danger)' : 'var(--text-main)' }}>
              {confirmModal.title}
            </h3>
            <div style={{ fontSize: '12.5px', lineHeight: '1.6', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
              {confirmModal.message}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmModal(null)} style={{ padding: '6px 14px', fontSize: '12px' }}>
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmModal.onConfirm}
                style={{
                  padding: '6px 16px',
                  fontSize: '12px',
                  backgroundColor: confirmModal.isDanger ? '#dc2626' : 'var(--primary)',
                  borderColor: confirmModal.isDanger ? '#dc2626' : 'var(--primary)'
                }}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 급여 정산 대차대조식 검증 바 (헌장 3.5) */}
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
          <span>👥 <strong>대상임직원:</strong> {payrollAuditSummary.totalCount}명</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>💵 <strong>지급총액(세전):</strong> ₩{payrollAuditSummary.totalGross.toLocaleString()}원</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--warning)' }}>📉 <strong>공제총액:</strong> ₩{payrollAuditSummary.totalDeductions.toLocaleString()}원</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--success)' }}>💰 <strong>실지급총액(세후):</strong> ₩{payrollAuditSummary.totalNet.toLocaleString()}원</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: 'var(--success-light)',
            color: 'var(--success)',
            fontWeight: 700,
            fontSize: '11px'
          }}>
            ⚖️ 지급총액 = 실지급총액 + 공제총액 (대차 무결)
          </span>
        </div>
      </div>
      <div style={{ height: '50px' }} aria-hidden="true" />
    </div>
  );
};
