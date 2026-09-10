// src/pages/LeaveApplicationPage.tsx
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import { Calendar, Trash2, Download } from 'lucide-react';
import { User as UserType } from '../services/db';

export const LeaveApplicationPage: React.FC = () => {
  const {
    users,
    annualLeaveQuotas,
    leaveUsages,
    currentUser,
    showErrorModal,
    addLeaveUsage,
    deleteLeaveUsage
  } = useApp();

  // 토스트 알림 상태 (헌장 5.2)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // admin 판별 (헌장 2.1 R&R: admin 계정만 타 임직원 대리신청 및 전체조회 허용)
  const isSystemAdmin = currentUser?.role === 'ADMIN' || currentUser?.loginId === 'admin' || currentUser?.id === 'sys-admin';

  // 신청 대상 임직원 성명 정규화 헬퍼 (헌장 3.1)
  const getApplicantDisplayName = (u?: UserType | null) => {
    if (!u) return '임직원';
    if (u.loginId === 'admin' || u.name === '최고관리자') return '개발자';
    return u.name || '임직원';
  };

  // 신청 폼 상태 (admin 외에는 로그인된 본인 ID 고정)
  const [targetUserId, setTargetUserId] = useState(currentUser?.id || '');
  const [leaveType, setLeaveType] = useState<'ANNUAL' | 'HALF_AM' | 'HALF_PM'>('ANNUAL');
  const [leaveStartDate, setLeaveStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [leaveEndDate, setLeaveEndDate] = useState(new Date().toISOString().substring(0, 10));
  const [leaveReason, setLeaveReason] = useState('');

  // 이력 대장 필터 (admin 외에는 'MY' 고정)
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'ALL' | 'ANNUAL' | 'HALF_AM' | 'HALF_PM'>('ALL');
  const [viewScope, setViewScope] = useState<'MY' | 'ALL'>('MY');

  // admin 외 일반 임직원은 본인 ID 및 'MY' 스코프로 강제 동기화 (전체조회 및 타인신청 원천 차단)
  React.useEffect(() => {
    if (!isSystemAdmin && currentUser?.id) {
      setTargetUserId(currentUser.id);
      setViewScope('MY');
    } else if (isSystemAdmin && !targetUserId && currentUser?.id) {
      setTargetUserId(currentUser.id);
    }
  }, [currentUser, isSystemAdmin, targetUserId]);

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

  // 유효 대상 사용자 ID (admin 외에는 로그인된 본인 ID 강제 고정)
  const effectiveUserId = isSystemAdmin ? (targetUserId || currentUser?.id || '') : (currentUser?.id || '');
  const activeApplicantUser = users.find(u => u.id === effectiveUserId) || (effectiveUserId === currentUser?.id ? currentUser : null);
  const mySummary = activeApplicantUser ? getUserLeaveSummary(activeApplicantUser) : {
    periodStart: '-',
    periodEnd: '-',
    grantedDays: 15,
    usedDays: 0,
    remainingDays: 15
  };

  // 신청 일수 실시간 계산
  const calculateRequestedDays = () => {
    if (leaveType === 'HALF_AM' || leaveType === 'HALF_PM') return 0.5;
    if (!leaveStartDate || !leaveEndDate) return 1.0;
    const start = new Date(leaveStartDate);
    const end = new Date(leaveEndDate);
    if (end < start) return 0;
    const diffTime = end.getTime() - start.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const requestedDays = calculateRequestedDays();

  // 3. 연차/반차 신청 제출 (가드 로직 적용)
  const handleLeaveUsageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitUserId = isSystemAdmin ? effectiveUserId : (currentUser?.id || '');
    if (!submitUserId || !leaveReason.trim()) {
      showErrorModal('신청 대상 임직원과 연차/반차 사유를 입력해 주십시오.');
      return;
    }

    const targetUser = users.find(u => u.id === submitUserId) || (submitUserId === currentUser?.id ? currentUser : null);
    if (!targetUser) {
      showErrorModal('선택된 임직원 정보를 찾을 수 없습니다.');
      return;
    }

    if (leaveType === 'ANNUAL' && leaveEndDate < leaveStartDate) {
      showErrorModal('연차 종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }

    let usedDays = 0.5;
    if (leaveType === 'ANNUAL') {
      usedDays = Math.max(1.0, requestedDays);
    }

    const summary = getUserLeaveSummary(targetUser);
    if (usedDays > summary.remainingDays) {
      showErrorModal(`잔여 연차(${summary.remainingDays}일)를 초과하여 신청할 수 없습니다. (신청 요구: ${usedDays}일)`);
      return;
    }

    const actualEndDate = leaveType === 'ANNUAL' ? leaveEndDate : leaveStartDate;
    const hasOverlap = leaveUsages.some(l => 
      l.userId === submitUserId && 
      l.status !== 'REJECTED' &&
      ((leaveStartDate >= l.startDate && leaveStartDate <= l.endDate) ||
       (actualEndDate >= l.startDate && actualEndDate <= l.endDate) ||
       (leaveStartDate <= l.startDate && actualEndDate >= l.endDate))
    );

    if (hasOverlap) {
      showErrorModal('해당 기간에 이미 등록된 연차 또는 반차 내역이 존재합니다. 중복 신청할 수 없습니다.');
      return;
    }

    try {
      await addLeaveUsage({
        userId: submitUserId,
        leaveType,
        usedDays,
        startDate: leaveStartDate,
        endDate: actualEndDate,
        reason: leaveReason.trim(),
        status: 'APPROVED'
      });

      setLeaveReason('');
      showToast(`연차/반차 신청 내역(${usedDays}일 차감)이 정상 등록되었습니다.`);
    } catch (err: any) {
      showErrorModal(err?.message || '연차 신청 등록 중 오류가 발생했습니다.');
    }
  };

  // 4. 신청 취소 (삭제) - ADMIN 권한만 가능
  const handleDelete = async (id: string, usedDays: number) => {
    if (!isSystemAdmin) {
      showErrorModal('⚠️ 연차/반차 신청 취소는 관리자(ADMIN) 권한만 가능합니다.');
      return;
    }
    try {
      await deleteLeaveUsage(id);
      showToast(`연차/반차 신청 내역(${usedDays}일 환원)이 정상 취소되었습니다.`);
    } catch (err: any) {
      showErrorModal(err?.message || '신청 취소 중 오류가 발생했습니다.');
    }
  };

  // 유효 조회 스코프 (admin 외에는 무조건 'MY' 고정)
  const effectiveScope = isSystemAdmin ? viewScope : 'MY';

  // 5. 엑셀 다운로드 (admin 외에는 본인 내역만 다운로드)
  const handleExportExcel = () => {
    const ymd = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    const filtered = leaveUsages.filter(l => {
      if (effectiveScope === 'MY' && l.userId !== currentUser?.id) return false;
      if (historyTypeFilter !== 'ALL' && l.leaveType !== historyTypeFilter) return false;
      return true;
    });

    const data = filtered.map((l, idx) => {
      const uObj = users.find(u => u.id === l.userId) || (l.userId === currentUser?.id ? currentUser : null);
      const uName = getApplicantDisplayName(uObj);
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
    XLSX.utils.book_append_sheet(wb, ws, '연차신청내역');
    XLSX.writeFile(wb, `연차_신청_내역_${ymd}.xlsx`);
  };

  // 표시할 이력 필터링 (admin 외에는 무조건 본인 내역만 필터링)
  const displayedUsages = leaveUsages.filter(l => {
    if (effectiveScope === 'MY' && l.userId !== currentUser?.id) return false;
    if (historyTypeFilter !== 'ALL' && l.leaveType !== historyTypeFilter) return false;
    return true;
  });

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 헤더 타이틀 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={22} style={{ color: 'var(--primary)' }} />
            연차신청
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

      {/* 📊 본인 연차 현황 카드 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
        backgroundColor: 'var(--bg-card)',
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>신청 대상 임직원</span>
          <strong style={{ fontSize: '15px', color: 'var(--text-main)' }}>
            {getApplicantDisplayName(activeApplicantUser)} ({activeApplicantUser?.department || '미지정'})
          </strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>현재 1년 갱신 주기</span>
          <strong style={{ fontSize: '13.5px', color: 'var(--text-main)', fontFamily: 'monospace' }}>
            {mySummary.periodStart} ~ {mySummary.periodEnd}
          </strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>1년 부여 연차</span>
          <strong style={{ fontSize: '16px', color: 'var(--primary)' }}>
            {mySummary.grantedDays}일
          </strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>누적 소진 일수</span>
          <strong style={{ fontSize: '16px', color: 'var(--warning)' }}>
            {mySummary.usedDays}일
          </strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>잔여 연차</span>
          <strong style={{ fontSize: '18px', color: mySummary.remainingDays > 0 ? '#10b981' : '#ef4444' }}>
            {mySummary.remainingDays}일
          </strong>
        </div>
      </div>

      {/* 2단 작업대 레이아웃 (좌: 신청 폼 / 우: 신청 이력) */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '20px' }}>
        
        {/* 좌측: 연차/반차 신청 폼 (헌장 3.4 상하 세로 스택) */}
        <div style={{
          backgroundColor: 'var(--bg-surface)',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          height: 'fit-content'
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            연차 / 반차 소진 등록
          </h3>

          <form onSubmit={handleLeaveUsageSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* 임직원 선택 (admin만 타 임직원 대리신청 가능, 일반 임직원은 본인 고정 및 변경 불가) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                신청 임직원:
              </label>
              {isSystemAdmin ? (
                <select
                  required
                  value={effectiveUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                >
                  {/* 로그인된 관리자 본인이 users 목록에 없더라도 드롭다운 최상단에 본인 옵션 기본 노출 */}
                  {currentUser && !users.some(u => u.id === currentUser.id) && (
                    <option value={currentUser.id}>
                      {getApplicantDisplayName(currentUser)} ({currentUser.department || '시스템'} / {currentUser.role}) - 본인
                    </option>
                  )}
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {getApplicantDisplayName(u)} ({u.department || '미지정'} / {u.position || '직원'}){u.id === currentUser?.id ? ' - 본인' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text-main)'
                }}>
                  {getApplicantDisplayName(currentUser)} ({currentUser?.department || '미지정'} / {currentUser?.position || '직원'})
                </div>
              )}
            </div>

            {/* 휴가 구분 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                휴가 구분 (차감 일수):
              </label>
              <select
                value={leaveType}
                onChange={(e: any) => setLeaveType(e.target.value)}
                className="form-control"
                style={{ fontSize: '13px' }}
              >
                <option value="ANNUAL">연차 (1.0일 차감)</option>
                <option value="HALF_AM">오전 반차 (0.5일 차감)</option>
                <option value="HALF_PM">오후 반차 (0.5일 차감)</option>
              </select>
            </div>

            {/* 시작 일자 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                시작 일자:
              </label>
              <input
                type="date"
                required
                value={leaveStartDate}
                onChange={(e) => {
                  setLeaveStartDate(e.target.value);
                  if (leaveType !== 'ANNUAL') setLeaveEndDate(e.target.value);
                }}
                className="form-control"
                style={{ fontSize: '13px' }}
              />
            </div>

            {/* 종료 일자 (연차인 경우만 표시) */}
            {leaveType === 'ANNUAL' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  종료 일자:
                </label>
                <input
                  type="date"
                  required
                  min={leaveStartDate}
                  value={leaveEndDate}
                  onChange={(e) => setLeaveEndDate(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                />
              </div>
            )}

            {/* 소진 일수 실시간 안내 배너 */}
            <div style={{
              padding: '10px 12px',
              borderRadius: '6px',
              backgroundColor: requestedDays > mySummary.remainingDays ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.08)',
              border: `1px solid ${requestedDays > mySummary.remainingDays ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.2)'}`,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>신청 예정 일수:</span>
              <strong style={{ color: requestedDays > mySummary.remainingDays ? '#ef4444' : 'var(--primary)', fontSize: '13px' }}>
                {requestedDays}일 소진 (잔여: {mySummary.remainingDays - requestedDays}일)
              </strong>
            </div>

            {/* 휴가 사유 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                휴가 사유:
              </label>
              <textarea
                required
                rows={3}
                placeholder="연차 / 반차 사유를 기입하세요"
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                className="form-control"
                style={{ fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ fontSize: '13px', marginTop: '6px' }}
              disabled={requestedDays <= 0 || requestedDays > mySummary.remainingDays}
            >
              연차 / 반차 신청
            </button>
          </form>
        </div>

        {/* 우측: 신청 및 소진 이력 대장 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* 서브 필터 바 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['ALL', 'ANNUAL', 'HALF_AM', 'HALF_PM'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setHistoryTypeFilter(t)}
                  className={`btn ${historyTypeFilter === t ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }}
                >
                  {t === 'ALL' ? '전체 구분' : t === 'ANNUAL' ? '연차' : t === 'HALF_AM' ? '오전반차' : '오후반차'}
                </button>
              ))}
            </div>

            {isSystemAdmin && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => setViewScope('MY')}
                  className={`btn ${viewScope === 'MY' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11.5px', padding: '4px 8px', whiteSpace: 'nowrap' }}
                >
                  내 신청 내역
                </button>
                <button
                  onClick={() => setViewScope('ALL')}
                  className={`btn ${viewScope === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11.5px', padding: '4px 8px', whiteSpace: 'nowrap' }}
                >
                  전체 임직원 내역
                </button>
              </div>
            )}
          </div>

          {/* 이력 테이블 */}
          <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  {isSystemAdmin && <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '70px', textAlign: 'center' }}>취소</th>}
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>성명</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>구분</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>차감 일수</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>사용 기간</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>휴가 사유</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>등록일시</th>
                </tr>
              </thead>
              <tbody>
                {displayedUsages.length === 0 ? (
                  <tr>
                    <td colSpan={isSystemAdmin ? 7 : 6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      조회 조건에 해당하는 연차/반차 신청 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  displayedUsages.map((l) => {
                    const rawUser = users.find(u => u.id === l.userId);
                    const uName = l.userId === currentUser?.id 
                      ? getApplicantDisplayName(currentUser) 
                      : (rawUser ? getApplicantDisplayName(rawUser) : (l.userId === 'sys-admin' ? '개발자' : '알 수 없음'));
                    const typeLabel = l.leaveType === 'ANNUAL' ? '연차' : l.leaveType === 'HALF_AM' ? '오전반차' : '오후반차';

                    return (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        {isSystemAdmin && (
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                            <button
                              onClick={() => handleDelete(l.id, l.usedDays)}
                              className="btn btn-secondary"
                              style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--danger)' }}
                              title="신청 취소"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        )}
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
