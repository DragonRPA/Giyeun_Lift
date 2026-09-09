// src/pages/LeaveManagementPage.tsx
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import { 
  UserCheck, Download, Edit3, Trash2, Calendar, 
  Info, Search, ShieldCheck
} from 'lucide-react';
import { User as UserType } from '../services/db';

export const LeaveManagementPage: React.FC = () => {
  const {
    users,
    annualLeaveQuotas,
    leaveUsages,
    overtimeRecords,
    hasPermission,
    showErrorModal,
    updateAnnualLeaveQuota,
    addLeaveUsage,
    deleteLeaveUsage
  } = useApp();

  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 연차관리 권한은 급여 권한자와 100% 동일 (hasPermission 내부에서 payroll과 동기화)
  const canSave = hasPermission('leave_management', 'save');

  const [activeTab, setActiveTab] = useState<'QUOTA' | 'USAGE'>('QUOTA');
  const [searchQuery, setSearchQuery] = useState('');

  // 1년 부여 연차 갱신 모달 상태
  const [selectedUserForQuota, setSelectedUserForQuota] = useState<UserType | null>(null);
  const [quotaPeriodStart, setQuotaPeriodStart] = useState('');
  const [quotaPeriodEnd, setQuotaPeriodEnd] = useState('');
  const [grantedDaysInput, setGrantedDaysInput] = useState<number>(15);
  const [quotaMemoInput, setQuotaMemoInput] = useState('');

  // 관리자 소진 등록 폼 상태
  const [adminLeaveUserId, setAdminLeaveUserId] = useState('');
  const [adminLeaveType, setAdminLeaveType] = useState<'ANNUAL' | 'HALF_AM' | 'HALF_PM'>('ANNUAL');
  const [adminLeaveStartDate, setAdminLeaveStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [adminLeaveEndDate, setAdminLeaveEndDate] = useState(new Date().toISOString().substring(0, 10));
  const [adminLeaveReason, setAdminLeaveReason] = useState('');

  // 1. 임직원 입사일 기준 갱신 주기 계산 헬퍼
  const calculatePeriod = (joinDateStr?: string) => {
    const now = new Date();
    const currentYear = now.getFullYear();

    if (!joinDateStr) {
      return {
        start: `${currentYear}-01-01`,
        end: `${currentYear}-12-31`
      };
    }

    const jDate = new Date(joinDateStr);
    const mm = String(jDate.getMonth() + 1).padStart(2, '0');
    const dd = String(jDate.getDate()).padStart(2, '0');

    const thisYearPeriodStart = new Date(`${currentYear}-${mm}-${dd}`);
    let periodStart: string;
    let periodEnd: string;

    if (now >= thisYearPeriodStart) {
      periodStart = `${currentYear}-${mm}-${dd}`;
      periodEnd = `${currentYear + 1}-${mm}-${dd}`;
    } else {
      periodStart = `${currentYear - 1}-${mm}-${dd}`;
      periodEnd = `${currentYear}-${mm}-${dd}`;
    }

    return { start: periodStart, end: periodEnd };
  };

  // 2. 임직원별 연차 현황 집계
  const getUserLeaveSummary = (u: UserType) => {
    const period = calculatePeriod(u.joinDate);
    const quota = annualLeaveQuotas.find(q => q.userId === u.id && q.periodStart === period.start) || {
      grantedDays: 15,
      periodStart: period.start,
      periodEnd: period.end
    };

    const userUsages = leaveUsages.filter(l => 
      l.userId === u.id && 
      l.startDate >= period.start && 
      l.startDate <= period.end &&
      l.status !== 'REJECTED'
    );

    const usedDays = userUsages.reduce((sum, l) => sum + (l.usedDays || 0), 0);
    const remainingDays = quota.grantedDays - usedDays;

    return {
      periodStart: quota.periodStart,
      periodEnd: quota.periodEnd,
      grantedDays: quota.grantedDays,
      usedDays,
      remainingDays
    };
  };

  // 전사 연차 대차대조 집계 (헌장 3.5 & 5.5)
  const totalCompanyGranted = users.reduce((sum, u) => sum + getUserLeaveSummary(u).grantedDays, 0);
  const totalCompanyUsed = users.reduce((sum, u) => sum + getUserLeaveSummary(u).usedDays, 0);
  const totalCompanyRemaining = users.reduce((sum, u) => sum + getUserLeaveSummary(u).remainingDays, 0);
  const leaveBalanceDiff = Math.abs(totalCompanyGranted - (totalCompanyUsed + totalCompanyRemaining));

  // 3. 연차 1년 부여 갯수 갱신 모달 오픈
  const handleOpenQuotaModal = (u: UserType) => {
    setSelectedUserForQuota(u);
    const period = calculatePeriod(u.joinDate);
    setQuotaPeriodStart(period.start);
    setQuotaPeriodEnd(period.end);

    const existingQuota = annualLeaveQuotas.find(q => q.userId === u.id && q.periodStart === period.start);
    setGrantedDaysInput(existingQuota ? existingQuota.grantedDays : 15);
    setQuotaMemoInput(existingQuota?.memo || '');
  };

  const handleSaveQuotaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForQuota) return;

    if (grantedDaysInput < 0) {
      showErrorModal('부여 연차 일수는 0일 이상이어야 합니다.');
      return;
    }

    try {
      await updateAnnualLeaveQuota(
        selectedUserForQuota.id,
        quotaPeriodStart,
        quotaPeriodEnd,
        grantedDaysInput,
        quotaMemoInput
      );

      const targetName = selectedUserForQuota.name;
      setSelectedUserForQuota(null);
      showToast(`${targetName} 님의 1년 부여 연차 일수가 ${grantedDaysInput}일로 갱신되었습니다.`);
    } catch (err: any) {
      showErrorModal(err?.message || '연차 부여 일수 갱신 중 오류가 발생했습니다.');
    }
  };

  // 4. 관리자 대리 소진 등록
  const handleAdminLeaveUsageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminLeaveUserId || !adminLeaveReason.trim()) {
      showErrorModal('대상 임직원과 휴가 사유를 입력해 주십시오.');
      return;
    }

    const targetUser = users.find(u => u.id === adminLeaveUserId);
    if (!targetUser) {
      showErrorModal('선택된 임직원 정보를 찾을 수 없습니다.');
      return;
    }

    if (adminLeaveType === 'ANNUAL' && adminLeaveEndDate < adminLeaveStartDate) {
      showErrorModal('연차 종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }

    let usedDays = 0.5;
    if (adminLeaveType === 'ANNUAL') {
      const start = new Date(adminLeaveStartDate);
      const end = new Date(adminLeaveEndDate);
      const diffTime = end.getTime() - start.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
      usedDays = Math.max(1.0, diffDays);
    }

    const summary = getUserLeaveSummary(targetUser);
    if (usedDays > summary.remainingDays) {
      showErrorModal(`잔여 연차(${summary.remainingDays}일)를 초과하여 등록할 수 없습니다. (요청 일수: ${usedDays}일)`);
      return;
    }

    const actualEndDate = adminLeaveType === 'ANNUAL' ? adminLeaveEndDate : adminLeaveStartDate;
    const hasOverlap = leaveUsages.some(l => 
      l.userId === adminLeaveUserId && 
      l.status !== 'REJECTED' &&
      ((adminLeaveStartDate >= l.startDate && adminLeaveStartDate <= l.endDate) ||
       (actualEndDate >= l.startDate && actualEndDate <= l.endDate) ||
       (adminLeaveStartDate <= l.startDate && actualEndDate >= l.endDate))
    );

    if (hasOverlap) {
      showErrorModal('해당 기간에 이미 등록된 연차 또는 반차 내역이 존재합니다.');
      return;
    }

    try {
      await addLeaveUsage({
        userId: adminLeaveUserId,
        leaveType: adminLeaveType,
        usedDays,
        startDate: adminLeaveStartDate,
        endDate: actualEndDate,
        reason: adminLeaveReason.trim(),
        status: 'APPROVED'
      });

      setAdminLeaveReason('');
      showToast(`${targetUser.name} 님의 연차/반차 소진(${usedDays}일 차감)이 등록되었습니다.`);
    } catch (err: any) {
      showErrorModal(err?.message || '소진 내역 등록 중 오류가 발생했습니다.');
    }
  };

  // 5. 소진 내역 삭제
  const handleDeleteLeaveUsage = async (id: string, userName: string) => {
    try {
      await deleteLeaveUsage(id);
      showToast(`${userName} 님의 연차 소진 내역이 취소(환원)되었습니다.`);
    } catch (err: any) {
      showErrorModal(err?.message || '소진 취소 중 오류가 발생했습니다.');
    }
  };

  // 6. 엑셀 다운로드
  const handleExportExcel = () => {
    const ymd = new Date().toISOString().substring(0, 10).replace(/-/g, '');

    if (activeTab === 'QUOTA') {
      const data = filteredUsers.map((u, idx) => {
        const summary = getUserLeaveSummary(u);
        const totalOtHours = overtimeRecords
          .filter(ot => ot.userId === u.id)
          .reduce((sum, ot) => sum + (ot.hours || 0), 0);

        return {
          '번호': idx + 1,
          '성명': u.name,
          '부서': u.department || '미지정',
          '직급': u.position || '직원',
          '입사일': u.joinDate || '미기재',
          '1년 갱신 주기 시작일': summary.periodStart,
          '1년 갱신 주기 종료일': summary.periodEnd,
          '1년 부여 연차 (일)': summary.grantedDays,
          '소진 일수 (일)': summary.usedDays,
          '잔여 연차 (일)': summary.remainingDays,
          '누적 OT (시간)': totalOtHours
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '임직원 연차 현황');
      XLSX.writeFile(wb, `임직원_연차_현황_대장_${ymd}.xlsx`);
    } else {
      const data = filteredUsages.map((l, idx) => {
        const uName = users.find(u => u.id === l.userId)?.name || '알 수 없음';
        const typeLabel = l.leaveType === 'ANNUAL' ? '연차' : l.leaveType === 'HALF_AM' ? '오전반차' : '오후반차';

        return {
          '번호': idx + 1,
          '성명': uName,
          '휴가 구분': typeLabel,
          '차감 일수 (일)': l.usedDays,
          '시작 일자': l.startDate,
          '종료 일자': l.endDate,
          '휴가 사유': l.reason,
          '등록 일시': l.createdAt?.substring(0, 10)
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '연차반차 소진 이력');
      XLSX.writeFile(wb, `연차_반차_소진_이력_${ymd}.xlsx`);
    }
  };

  const filteredUsers = users.filter(u => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return u.name.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q);
  });

  const filteredUsages = leaveUsages.filter(l => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const u = users.find(user => user.id === l.userId);
    return (u?.name || '').toLowerCase().includes(q) || (l.reason || '').toLowerCase().includes(q);
  });

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 헤더 타이틀 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserCheck size={22} style={{ color: 'var(--primary)' }} />
            연차관리
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--primary)',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <ShieldCheck size={12} /> 급여 권한 연동
            </span>
          </h2>
        </div>

        {/* 탭 버튼 그룹 & 엑셀 다운로드 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={handleExportExcel}
            className="btn btn-secondary"
            style={{ fontSize: '13px', whiteSpace: 'nowrap', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}
          >
            <Download size={14} style={{ marginRight: '6px' }} />
            엑셀 다운로드
          </button>

          <button
            onClick={() => setActiveTab('QUOTA')}
            className={`btn ${activeTab === 'QUOTA' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '13px', whiteSpace: 'nowrap' }}
          >
            <UserCheck size={14} style={{ marginRight: '6px' }} />
            임직원 연차 갱신/현황 대장
          </button>
          <button
            onClick={() => setActiveTab('USAGE')}
            className={`btn ${activeTab === 'USAGE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '13px', whiteSpace: 'nowrap' }}
          >
            <Calendar size={14} style={{ marginRight: '6px' }} />
            연차 소진 관리 대장
          </button>
        </div>
      </div>

      {/* 📊 전사 연차 통계 요약 바 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 등록 임직원</span>
          <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{users.length}명</strong>
        </div>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 부여 연차 일수</span>
          <strong style={{ fontSize: '15px', color: 'var(--text-main)' }}>{totalCompanyGranted.toFixed(1)}일</strong>
        </div>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 연차 소진 일수</span>
          <strong style={{ fontSize: '15px', color: 'var(--warning)' }}>{totalCompanyUsed.toFixed(1)}일</strong>
        </div>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 잔여 연차 일수</span>
          <strong style={{ fontSize: '15px', color: '#10b981' }}>{totalCompanyRemaining.toFixed(1)}일</strong>
        </div>
      </div>

      {/* 검색 바 */}
      <div style={{ display: 'flex', gap: '8px', maxWidth: '360px' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder={activeTab === 'QUOTA' ? "성명 또는 부서 검색..." : "성명 또는 사유 검색..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-control"
            style={{ paddingLeft: '32px', fontSize: '13px' }}
          />
        </div>
      </div>

      {activeTab === 'QUOTA' && (
        <>
          {/* 테이블 (헌장 3.2: 1열 액션 버튼 배치, white-space: nowrap) */}
          <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '1000px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', width: '130px' }}>연차 갱신 액션</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>성명</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>부서 / 직급</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>입사일</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>현재 1년 갱신 주기</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>부여 연차 (일)</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>소진 일수 (일)</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>잔여 연차 (일)</th>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>누적 OT (시간)</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      조회된 임직원 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const summary = getUserLeaveSummary(u);
                    const totalOtHours = overtimeRecords
                      .filter(ot => ot.userId === u.id)
                      .reduce((sum, ot) => sum + (ot.hours || 0), 0);

                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => handleOpenQuotaModal(u)}
                            className="btn btn-secondary"
                            style={{ fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' }}
                            disabled={!canSave}
                          >
                            <Edit3 size={12} style={{ marginRight: '4px' }} />
                            부여 갯수 갱신
                          </button>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 'bold', color: 'var(--text-main)' }}>
                          {u.name}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                          {u.department || '미지정'} / {u.position || '직원'}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-main)' }}>
                          {u.joinDate || '미기재'}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '12px' }}>
                          {summary.periodStart} ~ {summary.periodEnd}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>
                          {summary.grantedDays} 일
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center', color: 'var(--warning)', fontWeight: 'bold' }}>
                          {summary.usedDays} 일
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 'bold', color: summary.remainingDays > 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {summary.remainingDays} 일
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 'bold', color: 'var(--text-main)' }}>
                          {totalOtHours} 시간
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'USAGE' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>
          
          {/* 관리자 수동 등록 폼 */}
          <div style={{ backgroundColor: 'var(--bg-surface)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px', height: 'fit-content' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              연차 / 반차 소진 등록
            </h3>

            <form onSubmit={handleAdminLeaveUsageSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  대상 임직원:
                </label>
                <select
                  required
                  value={adminLeaveUserId}
                  onChange={(e) => setAdminLeaveUserId(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                >
                  <option value="">임직원 선택</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.department || '미지정'})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  휴가 구분:
                </label>
                <select
                  value={adminLeaveType}
                  onChange={(e: any) => setAdminLeaveType(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                >
                  <option value="ANNUAL">연차 (1.0일 차감)</option>
                  <option value="HALF_AM">오전 반차 (0.5일 차감)</option>
                  <option value="HALF_PM">오후 반차 (0.5일 차감)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  시작 일자:
                </label>
                <input
                  type="date"
                  required
                  value={adminLeaveStartDate}
                  onChange={(e) => setAdminLeaveStartDate(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                />
              </div>

              {adminLeaveType === 'ANNUAL' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    종료 일자:
                  </label>
                  <input
                    type="date"
                    required
                    value={adminLeaveEndDate}
                    onChange={(e) => setAdminLeaveEndDate(e.target.value)}
                    className="form-control"
                    style={{ fontSize: '13px' }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  휴가 사유:
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="휴가 사유를 기입하세요"
                  value={adminLeaveReason}
                  onChange={(e) => setAdminLeaveReason(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px', resize: 'vertical' }}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ fontSize: '13px', marginTop: '6px' }}
                disabled={!canSave}
              >
                소진 내역 등록
              </button>
            </form>
          </div>

          {/* 전사 사용 이력 테이블 */}
          <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto', height: 'fit-content' }}>
            <table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '80px' }}>취소</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>성명</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>구분</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>차감 일수</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>사용 기간</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>휴가 사유</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>등록일시</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsages.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      조회된 연차/반차 사용 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredUsages.map((l) => {
                    const u = users.find(user => user.id === l.userId);
                    const uName = u?.name || '알 수 없음';
                    const typeLabel = l.leaveType === 'ANNUAL' ? '연차' : l.leaveType === 'HALF_AM' ? '오전반차' : '오후반차';

                    return (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => handleDeleteLeaveUsage(l.id, uName)}
                            className="btn btn-secondary"
                            style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--danger)' }}
                            disabled={!canSave}
                            title="소진 내역 취소"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                          {uName}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                            backgroundColor: l.leaveType === 'ANNUAL' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: l.leaveType === 'ANNUAL' ? 'var(--primary)' : 'var(--warning)'
                          }}>
                            {typeLabel}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 'bold', color: 'var(--danger)' }}>
                          -{l.usedDays} 일
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                          {l.startDate} {l.startDate !== l.endDate ? `~ ${l.endDate}` : ''}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                          {l.reason}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '12px' }}>
                          {l.createdAt?.substring(0, 10)}
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

      {/* ⚖️ 헌장 3.5 Gutenberg Z-패턴 4단계 대차대조 검증 바 */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>
            연차 대차대조 검증:
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            총부여 <strong style={{ color: 'var(--text-main)' }}>{totalCompanyGranted.toFixed(1)}일</strong>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>=</span>
          <span style={{ fontSize: '12px', color: 'var(--primary)' }}>
            소진합계 <strong>{totalCompanyUsed.toFixed(1)}일</strong>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>+</span>
          <span style={{ fontSize: '12px', color: '#10b981' }}>
            잔여합계 <strong>{totalCompanyRemaining.toFixed(1)}일</strong>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
          <span style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '6px',
            fontWeight: 'bold',
            backgroundColor: leaveBalanceDiff === 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            color: leaveBalanceDiff === 0 ? '#10b981' : '#ef4444'
          }}>
            대차 차액 {leaveBalanceDiff.toFixed(1)}일 {leaveBalanceDiff === 0 ? '(정합)' : '(불일치)'}
          </span>
        </div>
      </div>

      {/* 1년 부여 연차 갯수 갱신 모달 */}
      {selectedUserForQuota && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)', borderRadius: '10px',
            width: '90%', maxWidth: '450px', padding: '24px', display: 'flex',
            flexDirection: 'column', gap: '16px'
          }}>
            <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)' }}>
                이번 1년 부여 연차 일수 갱신
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                임직원 <strong>{selectedUserForQuota.name}</strong> 님의 입사일 주기 내 부여될 연차 갯수를 입력하십시오.
              </p>
            </div>

            <form onSubmit={handleSaveQuotaSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  입사일 주기 범위:
                </label>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--primary)', fontFamily: 'monospace' }}>
                  {quotaPeriodStart} ~ {quotaPeriodEnd}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  이번 1년 동안 부여될 연차 갯수 (일):
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  required
                  value={grantedDaysInput}
                  onChange={(e) => setGrantedDaysInput(parseFloat(e.target.value) || 0)}
                  className="form-control"
                  style={{ fontSize: '14px', fontWeight: 'bold' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  갱신 비고 / 사유:
                </label>
                <input
                  type="text"
                  placeholder="예: 근속 연수 3년차 정기 16일 부여"
                  value={quotaMemoInput}
                  onChange={(e) => setQuotaMemoInput(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedUserForQuota(null)}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" disabled={!canSave}>
                  연차 일수 갱신 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
