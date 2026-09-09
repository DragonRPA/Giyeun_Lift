import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import { Clock, Trash2, Download, Search, CheckCircle2, Plus, Minus, RotateCcw } from 'lucide-react';
import { User as UserType } from '../services/db';

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

const START_TIME_PRESETS = ['18:00', '19:00', '08:00', '13:00'];

export const OtManagementPage: React.FC = () => {
  const {
    users,
    overtimeRecords,
    currentUser,
    hasPermission,
    showErrorModal,
    addOvertimeRecord,
    deleteOvertimeRecord
  } = useApp();

  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // OT 관리는 권한관리에서 통제 (ot_management view/save)
  const canSave = hasPermission('ot_management', 'save');
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  // OT 연장근무 6단계 등록 폼 상태
  const [otDate, setOtDate] = useState<string>(getTodayYmd());
  const [otUserId, setOtUserId] = useState(currentUser?.id || '');
  const [otStartTime, setOtStartTime] = useState('18:00');
  const [otHours, setOtHours] = useState<number>(1.0);
  const [otWorkDetail, setOtWorkDetail] = useState('');

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
      const u = users.find(user => user.id === ot.userId);
      const uName = u?.name || '알 수 없음';
      const uDept = u?.department || '미지정';

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
    const u = users.find(user => user.id === ot.userId);
    return (u?.name || '').toLowerCase().includes(q) || (ot.workDetail || '').toLowerCase().includes(q);
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
            
            {/* 1. 날짜 지정 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                1. 날짜 지정
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setOtDate(getTodayYmd())}
                  className="btn"
                  style={{
                    fontSize: '11.5px',
                    padding: '5px 9px',
                    whiteSpace: 'nowrap',
                    backgroundColor: otDate === getTodayYmd() ? 'var(--primary)' : 'var(--bg-main)',
                    color: otDate === getTodayYmd() ? '#fff' : 'var(--text-main)',
                    border: '1px solid var(--border-color)',
                    fontWeight: otDate === getTodayYmd() ? 700 : 500
                  }}
                >
                  오늘
                </button>
                <button
                  type="button"
                  onClick={() => setOtDate(getYesterdayYmd())}
                  className="btn"
                  style={{
                    fontSize: '11.5px',
                    padding: '5px 9px',
                    whiteSpace: 'nowrap',
                    backgroundColor: otDate === getYesterdayYmd() ? 'var(--primary)' : 'var(--bg-main)',
                    color: otDate === getYesterdayYmd() ? '#fff' : 'var(--text-main)',
                    border: '1px solid var(--border-color)',
                    fontWeight: otDate === getYesterdayYmd() ? 700 : 500
                  }}
                >
                  어제
                </button>
                <input
                  type="date"
                  required
                  value={otDate}
                  onChange={(e) => setOtDate(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px', flex: 1 }}
                />
              </div>
            </div>

            {/* 2. 대상 임직원 지정 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                2. 대상 임직원 지정
              </label>
              <select
                required
                value={otUserId}
                onChange={(e) => setOtUserId(e.target.value)}
                className="form-control"
                style={{ fontSize: '13px' }}
              >
                <option value="">임직원 선택</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.department || '미지정'})</option>
                ))}
              </select>
            </div>

            {/* 3. 시작시간 지정 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                3. 시작시간 지정
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="time"
                  required
                  value={otStartTime}
                  onChange={(e) => setOtStartTime(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px', width: '120px' }}
                />
                <div style={{ display: 'flex', gap: '4px' }}>
                  {START_TIME_PRESETS.map(time => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => setOtStartTime(time)}
                      className="btn"
                      style={{
                        fontSize: '11px',
                        padding: '4px 6px',
                        whiteSpace: 'nowrap',
                        backgroundColor: otStartTime === time ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-main)',
                        color: otStartTime === time ? 'var(--primary)' : 'var(--text-muted)',
                        border: otStartTime === time ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                        fontWeight: otStartTime === time ? 700 : 500
                      }}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 4. 근로시간 설정 (+1시간, +0.5시간 증감) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  4. 근로시간 설정
                </label>
                <div style={{
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: 'var(--primary)',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}>
                  {otHours.toFixed(1)} 시간
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setOtHours(prev => Math.min(24, Math.round((prev + 1.0) * 10) / 10))}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '12px',
                    padding: '6px 8px',
                    fontWeight: 700,
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    color: '#10b981',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={13} /> +1시간
                </button>
                <button
                  type="button"
                  onClick={() => setOtHours(prev => Math.min(24, Math.round((prev + 0.5) * 10) / 10))}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '12px',
                    padding: '6px 8px',
                    fontWeight: 700,
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: 'var(--primary)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={13} /> +0.5시간
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setOtHours(prev => Math.max(0.5, Math.round((prev - 0.5) * 10) / 10))}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '11px',
                    padding: '5px 8px',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <Minus size={12} /> -0.5시간
                </button>
                <button
                  type="button"
                  onClick={() => setOtHours(1.0)}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '11px',
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
              style={{ width: '160px', fontSize: '13px' }}
            >
              <option value="ALL">전체 임직원</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
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
                    const u = users.find(user => user.id === ot.userId);
                    const uName = u?.name || '알 수 없음';
                    const uDept = u?.department || '미지정';
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
