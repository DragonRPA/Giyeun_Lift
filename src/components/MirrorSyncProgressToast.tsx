// src/components/MirrorSyncProgressToast.tsx
// e-Bro ERP 구글 드라이브 실시간 미러링 진행상황 플로팅 토스트 UI

import React, { useState, useEffect } from 'react';
import { Cloud, CheckCircle2, AlertCircle, RefreshCw, HardDrive, X } from 'lucide-react';
import { subscribeMirrorProgress, MirrorProgressState } from '../services/driveMirrorSync';

export const MirrorSyncProgressToast: React.FC = () => {
  const [state, setState] = useState<MirrorProgressState>({
    isActive: false,
    phase: 'IDLE',
    currentFile: '',
    currentIndex: 0,
    totalCount: 0,
    percent: 0,
    message: ''
  });
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeMirrorProgress((newState) => {
      setState(newState);
      if (newState.isActive) {
        setIsDismissed(false);
      }
    });
    return unsubscribe;
  }, []);

  if (!state.isActive || isDismissed || state.phase === 'IDLE') {
    return null;
  }

  const isCompleted = state.phase === 'COMPLETED';
  const isError = state.phase === 'ERROR';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 99999,
        width: '360px',
        backgroundColor: 'var(--bg-card)',
        border: `1.5px solid ${isCompleted ? '#22c55e' : isError ? '#ef4444' : 'var(--primary)'}`,
        borderRadius: '12px',
        padding: '14px 16px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        animation: 'slideUp 0.25s ease-out'
      }}
    >
      {/* 상단 헤더 라인 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: '800' }}>
          {isCompleted ? (
            <CheckCircle2 size={16} color="#16a34a" />
          ) : isError ? (
            <AlertCircle size={16} color="#dc2626" />
          ) : (
            <RefreshCw size={15} color="var(--primary)" className="animate-spin" />
          )}
          <span style={{ color: isCompleted ? '#16a34a' : isError ? '#dc2626' : 'var(--text-primary)' }}>
            {isCompleted
              ? '구글 드라이브 미러링 완료'
              : isError
              ? '미러링 동기화 오류'
              : `드라이브 로컬 미러링 중... (${state.currentIndex}/${state.totalCount || '?'})`}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* 현재 처리 중인 파일명 */}
      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
        <HardDrive size={12} style={{ flexShrink: 0, color: 'var(--primary)' }} />
        <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: '600' }}>
          {state.currentFile || state.message}
        </span>
      </div>

      {/* 프로그레스 바 (게이지) */}
      {!isCompleted && !isError && (
        <div style={{ width: '100%', height: '5px', backgroundColor: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden', marginTop: '2px' }}>
          <div
            style={{
              width: `${state.percent}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #2563eb, #10b981)',
              transition: 'width 0.2s ease'
            }}
          />
        </div>
      )}

      {/* 하단 상세 메시지 */}
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>저장소: C:\eBroAgent\drive_mirror\</span>
        {!isCompleted && !isError && <span>{state.percent}%</span>}
      </div>
    </div>
  );
};
