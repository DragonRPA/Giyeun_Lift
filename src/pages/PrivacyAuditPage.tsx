// src/pages/PrivacyAuditPage.tsx
// 개인정보 접속 감사 스튜디오 (개인정보 보호법 제29조 및 안전성 확보조치 기준 제8조 준수)
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  FileCheck, Shield, Download, Search, RefreshCw, Calendar, 
  Filter, CheckCircle, AlertTriangle, UserCheck, Eye, EyeOff, Lock
} from 'lucide-react';
import { db, supabase, PrivacyAccessLog } from '../services/db';
import { exportToExcel } from '../services/excel';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

export const PrivacyAuditPage: React.FC = () => {
  const { currentUser, users, hasPermission, showErrorModal } = useApp();
  const isSuperAdmin = currentUser?.id === 'u-1' || currentUser?.id === 'sys-admin' || currentUser?.loginId === 'admin';
  const isExecutive = currentUser?.role === 'ADMIN' || ['대표', '대표이사', '사장', '부사장'].includes(currentUser?.position || '') || currentUser?.department === '기연리프트';
  const canAudit = isSuperAdmin || isExecutive || hasPermission('permission', 'view');

  // 필터 상태
  const todayStr = new Date().toISOString().substring(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(todayStr);
  const [selectedUser, setSelectedUser] = useState('ALL');
  const [selectedAction, setSelectedAction] = useState('ALL');
  const [selectedMenu, setSelectedMenu] = useState('ALL');
  const [maskFilter, setMaskFilter] = useState<'ALL' | 'MASKED' | 'UNMASKED'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // 개인정보 처리방침 모달
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  // 반기 점검 완료 기록 상태
  const [auditCheckSign, setAuditCheckSign] = useState<{ checkedAt: string; checkedBy: string } | null>(() => {
    const saved = localStorage.getItem('erp_privacy_audit_check');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return null;
  });

  // 토스트 알림
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // DB 접속로그 로딩
  const [logs, setLogs] = useState<PrivacyAccessLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadAuditLogs = async () => {
    setIsLoading(true);
    try {
      if (db.isSupabaseConnected() && supabase) {
        const { data, error } = await supabase
          .from('privacy_access_logs')
          .select('*')
          .order('createdAt', { ascending: false })
          .limit(2000);
        if (!error && Array.isArray(data)) {
          const mapped: PrivacyAccessLog[] = data.map((d: any) => ({
            id: d.id,
            userId: d.userId,
            userName: d.userName,
            ipAddress: d.ipAddress,
            actionType: d.actionType,
            targetMenu: d.targetMenu,
            targetSubjectId: d.targetSubjectId,
            targetSubjectName: d.targetSubjectName,
            actionDetail: d.actionDetail,
            isMasked: d.isMasked !== false,
            createdAt: d.createdAt
          }));
          setLogs(mapped);
          db.privacyAccessLogs = mapped;
          return;
        }
      }
      setLogs(db.privacyAccessLogs || []);
    } catch (err: any) {
      console.warn('Audit logs load failed, fallback to local:', err);
      setLogs(db.privacyAccessLogs || []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, []);

  // 필터링된 로그 목록
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const logDate = (log.createdAt || '').substring(0, 10);
      if (startDate && logDate < startDate) return false;
      if (endDate && logDate > endDate) return false;

      if (selectedUser !== 'ALL' && log.userId !== selectedUser) return false;
      if (selectedAction !== 'ALL' && log.actionType !== selectedAction) return false;
      if (selectedMenu !== 'ALL' && log.targetMenu !== selectedMenu) return false;

      if (maskFilter === 'MASKED' && log.isMasked === false) return false;
      if (maskFilter === 'UNMASKED' && log.isMasked !== false) return false;

      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const match = 
          log.userName?.toLowerCase().includes(q) ||
          log.userId?.toLowerCase().includes(q) ||
          log.actionDetail?.toLowerCase().includes(q) ||
          log.targetSubjectName?.toLowerCase().includes(q) ||
          log.targetMenu?.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [logs, startDate, endDate, selectedUser, selectedAction, selectedMenu, maskFilter, searchTerm]);

  // 통계 집계
  const stats = useMemo(() => {
    const total = filteredLogs.length;
    const downloadCount = filteredLogs.filter(l => l.actionType === 'EXCEL_DOWNLOAD').length;
    const unmaskedDownloads = filteredLogs.filter(l => l.actionType === 'EXCEL_DOWNLOAD' && l.isMasked === false).length;
    const uniqueUsers = new Set(filteredLogs.map(l => l.userId)).size;
    return { total, downloadCount, unmaskedDownloads, uniqueUsers };
  }, [filteredLogs]);

  // 감사 로그 엑셀 출력
  const handleExportAuditExcel = () => {
    if (filteredLogs.length === 0) {
      showToast('출력할 감사 로그가 없습니다.', 'error');
      return;
    }
    const rows = filteredLogs.map((log, idx) => ({
      'NO': idx + 1,
      '감사로그ID': log.id,
      '일시': log.createdAt ? log.createdAt.replace('T', ' ').substring(0, 19) : '-',
      '접속자ID': log.userId,
      '접속자명': log.userName,
      '수행업무': log.actionType,
      '대상메뉴': log.targetMenu,
      '정보주체명': log.targetSubjectName || '-',
      '정보주체ID': log.targetSubjectId || '-',
      '마스킹여부': log.isMasked === false ? '비마스킹 (전체정보)' : '마스킹 적용',
      '상세내용': log.actionDetail
    }));

    exportToExcel(rows, `개인정보접속감사대장_${startDate}_${endDate}`, '개인정보감사대장');
    showToast(`개인정보 감사기록 (${rows.length}건) 엑셀이 출력되었습니다.`);
  };

  // 반기 감사 점검 승인
  const handleConfirmAuditCheck = () => {
    if (!canAudit) return;
    const nowIso = new Date().toISOString();
    const sign = {
      checkedAt: nowIso,
      checkedBy: `${currentUser?.name || '관리자'} (${currentUser?.position || '경영진'})`
    };
    setAuditCheckSign(sign);
    localStorage.setItem('erp_privacy_audit_check', JSON.stringify(sign));
    showToast('안전성 확보조치 기준 제8조에 따른 개인정보 접속기록 반기 점검이 승인·완결되었습니다.');
  };

  return (
    <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 🔔 인앱 토스트 */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          padding: '10px 18px',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          color: '#ffffff',
          backgroundColor: toastMessage.type === 'success' ? '#059669' : '#dc2626',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {toastMessage.text}
        </div>
      )}

      {/* 개인정보 처리방침 모달 */}
      <PrivacyPolicyModal isOpen={showPolicyModal} onClose={() => setShowPolicyModal(false)} />

      {/* ─────────────────────────────────────────────────────────────
          헤더 및 정책 바로가기
          ───────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            backgroundColor: 'var(--primary, #4f46e5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff'
          }}>
            <FileCheck size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
              개인정보 접속 감사
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #475569)', marginTop: '2px' }}>
              대한민국 개인정보 보호법 제29조 및 개인정보의 안전성 확보조치 기준 제8조 준수 접속기록 관리
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setShowPolicyModal(true)}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border: '1px solid var(--border-color, #cbd5e1)',
              backgroundColor: 'var(--bg-card, #ffffff)',
              color: 'var(--text-main, #0f172a)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap'
            }}
          >
            <Shield size={14} color="var(--primary, #4f46e5)" />
            개인정보 처리방침 전문
          </button>
          <button
            type="button"
            onClick={loadAuditLogs}
            disabled={isLoading}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border: '1px solid var(--border-color, #cbd5e1)',
              backgroundColor: 'var(--bg-card, #ffffff)',
              color: 'var(--text-main, #0f172a)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap'
            }}
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          Z-패턴 ① 좌상단 (Scope) & ② 우상단 (Pipeline) 필터 패널
          ───────────────────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--bg-card, #ffffff)',
        borderRadius: '8px',
        border: '1px solid var(--border-color, #cbd5e1)',
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          {/* 좌측: 상하 세로 스택 필터군 (헌장 3.4 준수) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* 조회 기간 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                조회 시작일
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                조회 종료일
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              />
            </div>

            {/* 수행 업무 유형 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                수행 업무 유형
              </label>
              <select
                value={selectedAction}
                onChange={(e) => setSelectedAction(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              >
                <option value="ALL">전체 업무</option>
                <option value="EXCEL_DOWNLOAD">엑셀 다운로드 (핵심 감사)</option>
                <option value="LOGIN">로그인</option>
                <option value="LOGOUT">로그아웃</option>
                <option value="VIEW">화면 조회</option>
                <option value="CREATE">등록</option>
                <option value="UPDATE">수정</option>
                <option value="DELETE">삭제</option>
              </select>
            </div>

            {/* 접속자 선택 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                접속자
              </label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              >
                <option value="ALL">전체 접속자</option>
                {users.map(u => (
                  <option key={u.id} value={u.loginId || u.id}>
                    {u.name} ({u.position || u.role})
                  </option>
                ))}
              </select>
            </div>

            {/* 마스킹 여부 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                마스킹 여부
              </label>
              <select
                value={maskFilter}
                onChange={(e) => setMaskFilter(e.target.value as any)}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              >
                <option value="ALL">전체</option>
                <option value="UNMASKED">비마스킹 (전체정보 다운로드)</option>
                <option value="MASKED">마스킹 적용</option>
              </select>
            </div>

            {/* 키워드 검색 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                검색어
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="성명, 사번, 대상정보, 상세내용"
                style={{
                  width: '180px',
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* 우측 액션: 엑셀 출력 버튼 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleExportAuditExcel}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#059669',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <Download size={14} />
              감사기록 엑셀 출력
            </button>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          Z-패턴 ③ 중앙 본문 (Inspection): 38px 슬림 고밀도 테이블
          ───────────────────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--bg-card, #ffffff)',
        borderRadius: '8px',
        border: '1px solid var(--border-color, #cbd5e1)',
        overflow: 'auto',
        maxHeight: '600px'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{
              backgroundColor: 'var(--bg-secondary, #f8fafc)',
              borderBottom: '1px solid var(--border-color, #e2e8f0)',
              color: 'var(--text-secondary, #475569)',
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}>
              <th style={{ padding: '8px 12px', textAlign: 'center', width: '50px' }}>NO</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', width: '140px' }}>일시</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', width: '110px' }}>접속자</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', width: '110px' }}>수행 업무</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', width: '110px' }}>대상 메뉴</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', width: '130px' }}>대상 정보주체</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', width: '100px' }}>마스킹 여부</th>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>상세 수행 내역 (감사 사유)</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '50px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                  조회 조건에 해당하는 개인정보 접속기록이 없습니다.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log, idx) => {
                const isDownload = log.actionType === 'EXCEL_DOWNLOAD';
                const isUnmasked = log.isMasked === false;
                return (
                  <tr
                    key={log.id || idx}
                    style={{
                      borderBottom: '1px solid var(--border-color, #f1f5f9)',
                      backgroundColor: isUnmasked && isDownload ? 'rgba(239, 68, 68, 0.04)' : 'transparent',
                      whiteSpace: 'nowrap',
                      height: '38px'
                    }}
                  >
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text-main, #0f172a)' }}>
                      {log.createdAt ? log.createdAt.replace('T', ' ').substring(0, 19) : '-'}
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-main, #0f172a)' }}>
                      {log.userName}
                      <span style={{ fontSize: '11px', color: 'var(--text-muted, #64748b)', marginLeft: '4px', fontWeight: 400 }}>
                        ({log.userId})
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: 
                          log.actionType === 'EXCEL_DOWNLOAD' ? (isUnmasked ? '#fee2e2' : '#fef3c7') :
                          log.actionType === 'LOGIN' ? '#dcfce7' :
                          log.actionType === 'LOGOUT' ? '#f1f5f9' :
                          log.actionType === 'DELETE' ? '#fee2e2' :
                          '#eff6ff',
                        color:
                          log.actionType === 'EXCEL_DOWNLOAD' ? (isUnmasked ? '#b91c1c' : '#b45309') :
                          log.actionType === 'LOGIN' ? '#15803d' :
                          log.actionType === 'LOGOUT' ? '#475569' :
                          log.actionType === 'DELETE' ? '#dc2626' :
                          '#1d4ed8'
                      }}>
                        {log.actionType}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary, #475569)' }}>
                      {log.targetMenu}
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: log.targetSubjectName ? 600 : 400, color: 'var(--text-main, #0f172a)' }}>
                      {log.targetSubjectName || '-'}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {isUnmasked ? (
                        <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#b91c1c', fontWeight: 700 }}>
                          비마스킹 (전체)
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#ecfdf5', color: '#047857', fontWeight: 600 }}>
                          마스킹 완료
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-main, #0f172a)' }}>
                      {log.actionDetail}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          Z-패턴 ④ 우하단 (Terminal Action): 통계 검증식 및 반기 감사 승인
          ───────────────────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--bg-secondary, #f8fafc)',
        borderRadius: '8px',
        border: '1px solid var(--border-color, #cbd5e1)',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        {/* 대차대조 감사 통계 HUD */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12.5px', color: 'var(--text-secondary, #475569)', flexWrap: 'wrap' }}>
          <span>📄 총 접속 건수: <strong style={{ color: 'var(--text-main, #0f172a)' }}>{stats.total.toLocaleString()}</strong>건</span>
          <span>📥 엑셀 다운로드: <strong style={{ color: '#b45309' }}>{stats.downloadCount.toLocaleString()}</strong>건</span>
          <span>🔓 비마스킹(전체정보) 다운로드: <strong style={{ color: stats.unmaskedDownloads > 0 ? '#dc2626' : 'var(--text-main, #0f172a)' }}>{stats.unmaskedDownloads.toLocaleString()}</strong>건</span>
          <span>👥 접속 임직원 수: <strong style={{ color: 'var(--primary, #4f46e5)' }}>{stats.uniqueUsers}</strong>명</span>
        </div>

        {/* 법정 반기 점검 승인 액션 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {auditCheckSign && (
            <div style={{ fontSize: '11.5px', color: '#047857', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle size={14} color="#059669" />
              반기 점검 승인됨: {auditCheckSign.checkedBy} ({auditCheckSign.checkedAt.substring(0, 10)})
            </div>
          )}
          {canAudit && (
            <button
              type="button"
              onClick={handleConfirmAuditCheck}
              style={{
                padding: '7px 16px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'var(--primary, #4f46e5)',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)'
              }}
            >
              <UserCheck size={14} />
              반기 점검 완료 승인
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
