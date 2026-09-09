// src/pages/OtManagementPage.tsx
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import { Clock, Trash2, Download, Search, CheckCircle2 } from 'lucide-react';
import { User as UserType } from '../services/db';

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

  // OT 연장근무 신청 폼 상태
  const [otUserId, setOtUserId] = useState(currentUser?.id || '');
  const [otStartDateTime, setOtStartDateTime] = useState(new Date().toISOString().substring(0, 16).replace('T', ' '));
  const [otHours, setOtHours] = useState<number>(2.0);
  const [otWorkDetail, setOtWorkDetail] = useState('');

  // 검색 및 필터
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState<string>('ALL');

  // OT 등록 제출
  const handleOvertimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otUserId || !otWorkDetail.trim()) {
      showErrorModal('신청 대상 임직원과 OT 근무 상세 내용을 기입해 주십시오.');
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

    try {
      await addOvertimeRecord({
        userId: otUserId,
        startDateTime: otStartDateTime,
        hours: otHours,
        workDetail: otWorkDetail.trim(),
        status: 'APPROVED'
      });

      const targetUser = users.find(u => u.id === otUserId);
      setOtWorkDetail('');
      showToast(`${targetUser?.name || '임직원'} 님의 OT 연장근무(${otHours}시간) 내역이 등록되었습니다.`);
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
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>
        
        {/* 좌측: OT 연장근무 등록 폼 (헌장 3.4 상하 세로 스택) */}
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
            OT (연장근무) 등록
          </h3>

          <form onSubmit={handleOvertimeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                대상 임직원:
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                시작 일시 (YYYY-MM-DD HH:mm):
              </label>
              <input
                type="text"
                required
                placeholder="예: 2026-09-09 18:00"
                value={otStartDateTime}
                onChange={(e) => setOtStartDateTime(e.target.value)}
                className="form-control"
                style={{ fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                OT 연장근무 시간 수 (시간):
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                required
                value={otHours}
                onChange={(e) => setOtHours(parseFloat(e.target.value) || 0)}
                className="form-control"
                style={{ fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                근무 상세 내용:
              </label>
              <textarea
                required
                rows={3}
                placeholder="야간/휴일 연장근무 사유 및 업무 내용을 입력하세요"
                value={otWorkDetail}
                onChange={(e) => setOtWorkDetail(e.target.value)}
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
              OT 연장근무 등록
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
