import React, { useState } from 'react';
import { LogOut, Wrench, Crown, Radio, RotateCw, Car, Smartphone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { WeatherWidget } from '../components/WeatherWidget';

export type MobileDeptMode = 'SALES' | 'AS' | 'OUTBOUND' | 'EXECUTIVE' | 'ADMIN';

interface MobileHeaderProps {
  deptMode: MobileDeptMode;
  onChangeDeptMode: (mode: MobileDeptMode) => void;
  isWalkieOn?: boolean;
  onOpenWalkieTalkie?: () => void;
  onOpenApkMonitor?: () => void;
  onOpenVehicleLog?: () => void;
  isWorking?: boolean;
  isWorkLoading?: boolean;
  onToggleWork?: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ 
  deptMode, 
  onChangeDeptMode,
  isWalkieOn = false,
  onOpenWalkieTalkie,
  onOpenApkMonitor,
  onOpenVehicleLog,
  isWorking = false,
  isWorkLoading = false,
  onToggleWork
}) => {
  const { currentUser, logout, currentTenant } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.update();
        }
      }
    } catch (e) {
      console.error('캐시 초기화 오류:', e);
    }
    setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('t', Date.now().toString());
      window.location.replace(url.toString());
    }, 200);
  };

  const deptList: { mode: MobileDeptMode; label: string; activeColor: string }[] = [
    { mode: 'SALES', label: '영업부', activeColor: '#2563eb' },
    { mode: 'AS', label: 'AS팀', activeColor: '#d97706' },
    { mode: 'OUTBOUND', label: '출고팀', activeColor: '#059669' },
    { mode: 'EXECUTIVE', label: '경영진', activeColor: '#7c3aed' },
    { mode: 'ADMIN', label: '관리부', activeColor: '#0284c7' },
  ];

  return (
    <>
      <header 
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #1e293b',
          padding: 'max(8px, env(safe-area-inset-top, 8px)) 12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
          width: '100%',
          maxWidth: '100vw',
          overflowX: 'hidden'
        }}
      >
        {/* ── 1행: 좌상단 날씨 위젯 & 우상단 퀵 액션 버튼군 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '6px' }}>
          {/* 🌤️ 좌상단 실시간 현장 날씨 위젯 */}
          <div style={{ flexShrink: 0 }}>
            <WeatherWidget compact />
          </div>

          {/* 우상단 퀵 액션 버튼군 */}
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px', 
              flexShrink: 0
            }}
          >
            {/* 🔄 화면 새로고침 버튼 (헌장 3.1 무수식어 건조한 명사) */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                fontWeight: '600',
                padding: '5px 7px',
                borderRadius: '8px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                color: '#38bdf8',
                cursor: 'pointer',
                flexShrink: 0
              }}
              title="새로고침"
            >
              <RotateCw 
                size={12} 
                style={{
                  transition: 'transform 0.4s ease',
                  transform: isRefreshing ? 'rotate(360deg)' : 'none'
                }} 
                color="#38bdf8" 
              />
              <span>새로고침</span>
            </button>

            {/* 📻 현장 무전기 (PTT) 버튼 */}
            <button
              type="button"
              onClick={onOpenWalkieTalkie}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                fontWeight: '700',
                padding: '5px 7px',
                borderRadius: '8px',
                backgroundColor: isWalkieOn ? 'rgba(16, 185, 129, 0.2)' : '#1e293b',
                border: isWalkieOn ? '1px solid #10b981' : '1px solid #334155',
                color: isWalkieOn ? '#34d399' : '#cbd5e1',
                cursor: 'pointer',
                flexShrink: 0
              }}
              title="무전기"
            >
              <Radio size={12} color={isWalkieOn ? '#34d399' : '#94a3b8'} />
              <span>{isWalkieOn ? '무전ON' : '무전'}</span>
              {isWalkieOn && (
                <span style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '9999px',
                  backgroundColor: '#10b981',
                  boxShadow: '0 0 5px #10b981'
                }} />
              )}
            </button>

            {/* 📱 통화캡처 APK 다운로드 & 모니터링 버튼 (헌장 3.1 무수식어 건조 표준) */}
            <button
              type="button"
              onClick={onOpenApkMonitor}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                fontWeight: '800',
                padding: '5px 7px',
                borderRadius: '8px',
                backgroundColor: isWorking ? 'rgba(16, 185, 129, 0.25)' : 'rgba(2, 132, 199, 0.25)',
                border: isWorking ? '1px solid #10b981' : '1px solid #38bdf8',
                color: isWorking ? '#34d399' : '#38bdf8',
                cursor: 'pointer',
                flexShrink: 0
              }}
              title="APK 다운로드 및 작동 모니터링"
            >
              <Smartphone size={12} color={isWorking ? '#34d399' : '#38bdf8'} />
              <span>APK</span>
              <span style={{
                width: '5px',
                height: '5px',
                borderRadius: '9999px',
                backgroundColor: isWorking ? '#10b981' : '#64748b',
                boxShadow: isWorking ? '0 0 5px #10b981' : 'none'
              }} />
            </button>

            {/* 🚗 전사 공용 차량운행일지/주유일지 버튼 */}
            {onOpenVehicleLog && (
              <button
                type="button"
                onClick={onOpenVehicleLog}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '11px',
                  fontWeight: '800',
                  padding: '5px 7px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(245, 158, 11, 0.2)',
                  border: '1px solid #f59e0b',
                  color: '#fbbf24',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
                title="차량운행일지"
              >
                <Car size={12} color="#fbbf24" />
                <span>차량일지</span>
              </button>
            )}

            {/* 로그아웃 버튼 */}
            <button
              onClick={logout}
              style={{
                padding: '6px',
                borderRadius: '8px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
              title="로그아웃"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>

        {/* ── 2행: 회사 로고 & 사용자 정보 & 출퇴근 토글 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
            {/* 🏢 테넌트 회사 CI 로고 표출 (모바일 헤더) */}
            <img 
              src={currentTenant?.ciUrl || currentTenant?.logoUrl || '/images/ci/giyeun_ci.png'} 
              alt="CI" 
              style={{ height: '24px', maxWidth: '65px', objectFit: 'contain', flexShrink: 0 }} 
              onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
            />
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              backgroundColor: deptMode === 'EXECUTIVE' ? '#7c3aed' : '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
              flexShrink: 0
            }}>
              {deptMode === 'EXECUTIVE' ? (
                <Crown size={13} color="#ffffff" />
              ) : (
                <Wrench size={12} color="#ffffff" />
              )}
            </div>
            <div style={{ minWidth: 0, overflow: 'hidden', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: '13px', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.02em' }}>{currentTenant?.displayName || currentTenant?.tradeName || currentTenant?.corporateName || 'e-Bro ERP'}</span>
                <span style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  padding: '1px 5px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  flexShrink: 0
                }}>
                  FIELD
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.5px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <span style={{ fontSize: '10px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
                  {currentUser?.name || '담당자'} ({currentUser?.role === 'ADMIN' ? '최고관리자' : currentUser?.role === 'MECHANIC' ? '정비기사' : '임직원'})
                </span>
                {/* 🌟 컴팩트 출근/퇴근 토글 버튼 (헌장 3.1 무수식어 건조 표준) */}
                {onToggleWork && (
                  <button
                    type="button"
                    onClick={onToggleWork}
                    disabled={isWorkLoading}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '1px 6px',
                      borderRadius: '6px',
                      fontSize: '10px',
                      fontWeight: '800',
                      border: isWorking ? '1px solid #10b981' : '1px solid #475569',
                      backgroundColor: isWorking ? 'rgba(16, 185, 129, 0.25)' : '#1e293b',
                      color: isWorking ? '#34d399' : '#cbd5e1',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'all 0.15s ease'
                    }}
                    title={isWorking ? '퇴근 처리' : '출근 처리'}
                  >
                    <span style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '9999px',
                      backgroundColor: isWorking ? '#10b981' : '#64748b',
                      boxShadow: isWorking ? '0 0 5px #10b981' : 'none'
                    }} />
                    <span>{isWorkLoading ? '...' : isWorking ? '근무중' : '출근'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 부서별 특화 모드 5대 직무 퀵 체인저 (헌장 3.1 무수식어 건조한 명사) */}
      <div style={{
        backgroundColor: 'rgba(15, 23, 42, 0.98)',
        padding: '6px 12px 8px',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        gap: '4px'
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          backgroundColor: '#020617',
          padding: '3px',
          borderRadius: '10px',
          border: '1px solid #334155'
        }}>
          {deptList.map(item => {
            const isActive = deptMode === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                onClick={() => onChangeDeptMode(item.mode)}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: '7px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: isActive ? '800' : '500',
                  backgroundColor: isActive ? item.activeColor : 'transparent',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap'
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
