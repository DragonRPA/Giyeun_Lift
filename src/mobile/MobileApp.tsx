// src/mobile/MobileApp.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { MobileHeader, MobileDeptMode } from './MobileHeader';
import { MobileBottomNav, MobileTabType } from './MobileBottomNav';
import { MobileHome } from './pages/MobileHome';
import { MobileExecutiveHome } from './pages/MobileExecutiveHome';
import { MobileAdminHome } from './pages/MobileAdminHome';
import { MobileAsList } from './pages/MobileAsList';
import { MobileAsDetail } from './pages/MobileAsDetail';
import { MobileAsCreate } from './pages/MobileAsCreate';
import { MobileDispatchList } from './pages/MobileDispatchList';
import { MobileInspectionList } from './pages/MobileInspectionList';
import { MobileAssetAssignment } from './pages/MobileAssetAssignment';
import { MobileAssetSearch } from './pages/MobileAssetSearch';
import { MobileDispatchOrderCreate } from './pages/MobileDispatchOrderCreate';
import { MobileMyContracts } from './pages/MobileMyContracts';
import { MobileVehicleStock } from './pages/MobileVehicleStock';
import { MobileInboundRegister } from './pages/MobileInboundRegister';
import { MobileSubleaseManage } from './pages/MobileSubleaseManage';
import { MobileCustomerManage } from './pages/MobileCustomerManage';
import { MobileDelinquencyManage } from './pages/MobileDelinquencyManage';
import { MobileVehicleLog } from './pages/MobileVehicleLog';
import { MobileManualViewer } from './pages/MobileManualViewer';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { MobileWalkieTalkieModal } from './components/MobileWalkieTalkieModal';
import { MobileApkMonitorModal } from './components/MobileApkMonitorModal';
import { CallAudioUploadModal } from '../components/CallAudioUploadModal';
import { walkieService } from '../services/walkieTalkieService';
import { initWorkNotificationListener } from '../utils/workNotificationService';
import { 
  getMyWorkStatus, clockIn, clockOut, subscribeWorkStatus, 
  getLatestApkRelease, WorkStatus, ApkRelease 
} from '../services/workStatusService';
import { ErrorBoundary } from '../components/ErrorBoundary';
import './mobile.css';

interface MobileAppProps {
  onSwitchToPc?: () => void;
}

export const MobileApp: React.FC<MobileAppProps> = ({ onSwitchToPc: _onSwitchToPc }) => {
  const { fieldAsTickets, deliveries, outboundInspections, currentUser, assets, customers, billings, currentTenant, contractAssets, loadTablesForMenu } = useApp();

  // 전대 장비 주기장 유휴 누수 위험 건수
  const subleaseLeakCount = useMemo(() => {
    return (assets || []).filter(a => 
      a.ownerType === 'RENTED' && 
      !a.actualRentReturnDate && 
      a.status !== 'RENTED_RETURNED' && 
      a.status !== 'RENTED'
    ).length;
  }, [assets]);

  // 🚨 약정 납기일 도과 연체 고객사 수 배지 (헌장 4.1 & 5.1 준수)
  const overdueBadgeCount = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const overdueCustIds = new Set<string>();

    (billings || []).forEach(b => {
      if (b.status === 'REJECTED' || b.status === 'PAID') return;
      const unpaid = (b.totalAmount || 0) - (b.paidAmount || 0);
      if (unpaid <= 0) return;

      const customer = (customers || []).find(c => c.id === b.customerId);
      let dueDate = '';
      if (customer?.paymentDueDay) {
        const ym = b.billingYm || b.createdAt.slice(0, 7);
        const [y, m] = ym.split('-');
        let year = parseInt(y, 10);
        let month = parseInt(m, 10) + 1;
        if (month > 12) { month = 1; year += 1; }
        const lastDay = new Date(year, month, 0).getDate();
        dueDate = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(customer.paymentDueDay, lastDay)).padStart(2, '0')}`;
      } else if (customer?.paymentTermDays) {
        const baseDate = new Date(b.billingDate || b.createdAt.split('T')[0]);
        baseDate.setDate(baseDate.getDate() + customer.paymentTermDays);
        dueDate = baseDate.toISOString().split('T')[0];
      } else {
        const baseDate = new Date(b.billingDate || b.createdAt.split('T')[0]);
        baseDate.setDate(baseDate.getDate() + 30);
        dueDate = baseDate.toISOString().split('T')[0];
      }

      if (dueDate < todayStr) {
        overdueCustIds.add(b.customerId);
      }
    });

    return overdueCustIds.size;
  }, [billings, customers]);

  // 📋 정보 누락 고객사 수 배지 (헌장 1.2 준수)
  const incompleteCustomerCount = useMemo(() => {
    return (customers || []).filter(c => 
      !c.bizRegNo || c.bizRegNo === '미상' ||
      !c.representative || c.representative === '미상' ||
      !c.repContact || c.repContact === '미상' ||
      !c.address || c.address === '미상'
    ).length;
  }, [customers]);

  // 1. 초기 부서 모드 감지 (사용자 역할 기반 또는 저장된 모드)
  const [deptMode, setDeptMode] = useState<MobileDeptMode>(() => {
    const saved = localStorage.getItem('erp_mobile_dept') as MobileDeptMode;
    if (saved && (saved === 'SALES' || saved === 'AS' || saved === 'OUTBOUND' || saved === 'EXECUTIVE' || saved === 'ADMIN')) {
      return saved;
    }
    const role = (currentUser?.role || '').toUpperCase();
    if (role === 'ADMIN') return 'EXECUTIVE';
    if (role === 'ACCOUNTING' || role === 'OFFICE') return 'ADMIN';
    if (role === 'MECHANIC' || role === 'AS') return 'AS';
    if (role === 'DISPATCH' || role === 'YARD') return 'OUTBOUND';
    return 'SALES';
  });

  const [activeTab, setActiveTab] = useState<MobileTabType>('home');
  const [selectedAsTicketId, setSelectedAsTicketId] = useState<string | null>(null);
  const [isCreatingAs, setIsCreatingAs] = useState(false);
  const [orderInitialParams, setOrderInitialParams] = useState<{ customerId?: string; specFt?: string } | null>(null);
  const [asInitialParams, setAsInitialParams] = useState<{ assetNo?: string; siteId?: string } | null>(null);

  // 📻 무전기 모달 및 전원 상태
  const [isWalkieModalOpen, setIsWalkieModalOpen] = useState(false);
  const [isWalkieOn, setIsWalkieOn] = useState(() => walkieService.getIsPowerOn());

  // 📱 통화캡처 APK 모니터링 & 출퇴근 상태
  const [isApkMonitorOpen, setIsApkMonitorOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [workStatus, setWorkStatus] = useState<WorkStatus | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [apkRelease, setApkRelease] = useState<ApkRelease | null>(null);

  // 출퇴근 및 APK 릴리즈 자동 동기화
  useEffect(() => {
    getMyWorkStatus(currentUser?.id).then(s => setWorkStatus(s));
    getLatestApkRelease().then(r => setApkRelease(r));
    if (!currentUser?.id) return;
    const unsub = subscribeWorkStatus(currentUser.id, s => setWorkStatus(s));
    return unsub;
  }, [currentUser?.id]);

  // 상단 헤더 & 모니터링 모달 공용 출퇴근 토글 핸들러
  const handleWorkToggle = async () => {
    const targetUserId = currentUser?.id || 'current_user';
    if (workLoading) return;
    setWorkLoading(true);
    try {
      if (workStatus?.isWorking) {
        const updated = await clockOut(targetUserId);
        setWorkStatus(updated);
      } else {
        const updated = await clockIn(targetUserId);
        setWorkStatus(updated);
      }
    } catch (e) {
      console.error('출퇴근 토글 오류:', e);
    } finally {
      setWorkLoading(false);
    }
  };

  // 무전기 서비스 자동 구독 (백그라운드 수신 대기) 및 모바일 오디오 락 해제
  useEffect(() => {
    if (currentUser) {
      walkieService.subscribe({
        id: currentUser.id,
        name: currentUser.name,
        role: currentUser.role,
        deptName: currentUser.department || currentTenant?.displayName || currentTenant?.tradeName || 'eBro'
      });
      initWorkNotificationListener(currentUser);
    }

    // 모바일 브라우저 오디오 자동재생 언락 (첫 화면 터치 시 영구 언락)
    const handleFirstGesture = () => {
      walkieService.unlockAudio();
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('click', handleFirstGesture);
    };
    window.addEventListener('touchstart', handleFirstGesture, { passive: true });
    window.addEventListener('click', handleFirstGesture, { passive: true });

    // 전원 변경 체크 인터벌
    const interval = setInterval(() => {
      setIsWalkieOn(walkieService.getIsPowerOn());
    }, 1000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('click', handleFirstGesture);
    };
  }, [currentUser, currentTenant]);

  // 부서 모드 변경 핸들러
  const handleDeptModeChange = (mode: MobileDeptMode) => {
    setDeptMode(mode);
    localStorage.setItem('erp_mobile_dept', mode);
    setActiveTab('home');
    setSelectedAsTicketId(null);
    setIsCreatingAs(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // 미처리 배지 카운트
  const pendingAsCount = fieldAsTickets.filter(
    (t) => t.status === 'REQUESTED' || t.status === 'SCHEDULED' || t.status === 'REVISIT' || t.status === 'IN_PROGRESS'
  ).length;

  const pendingDispatchCount = deliveries.filter(
    (d) => d.status === 'DISPATCHED' || d.status === 'PENDING'
  ).length;

  const pendingInspectionCount = outboundInspections.filter((ins) => ins.status === 'PENDING').length;

  // 🏗️ 미할당 슬롯 수 (장비할당 대기 배지)
  const pendingAssignmentCount = useMemo(() => {
    return (contractAssets || []).filter((ca) => !ca.assetId).length;
  }, [contractAssets]);

  // 네비게이션 핸들러
  const handleTabChange = (tab: MobileTabType) => {
    setSelectedAsTicketId(null);
    setIsCreatingAs(false);
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenAsDetail = (ticketId: string) => {
    setSelectedAsTicketId(ticketId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenCreateAs = (assetNo?: string, siteId?: string) => {
    setAsInitialParams(assetNo || siteId ? { assetNo, siteId } : null);
    setIsCreatingAs(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="mobile-app-root min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-500 selection:text-white w-full max-w-full overflow-x-hidden">
      {/* 상단 모바일 헤더 + 부서 퀵 체인저 + 무전기 버튼 */}
      <MobileHeader 
        deptMode={deptMode}
        onChangeDeptMode={handleDeptModeChange}
        isWalkieOn={isWalkieOn}
        onOpenWalkieTalkie={() => {
          walkieService.unlockAudio();
          setIsWalkieModalOpen(true);
        }}
        onOpenApkMonitor={() => setIsApkMonitorOpen(true)}
        onOpenVehicleLog={() => {
          if (loadTablesForMenu) loadTablesForMenu('vehicle_log');
          handleTabChange('vehicle_log');
        }}
        isWorking={workStatus?.isWorking ?? false}
        isWorkLoading={workLoading}
        onToggleWork={handleWorkToggle}
      />

      {/* 홈 화면 PWA 설치 안내 배너 */}
      <PwaInstallBanner />

      {/* 본문 라우팅 */}
      <main className="flex-1 w-full max-w-lg md:max-w-3xl mx-auto px-1 sm:px-3 min-w-0 max-w-full overflow-x-hidden">
        {selectedAsTicketId ? (
          <MobileAsDetail
            ticketId={selectedAsTicketId}
            onBack={() => setSelectedAsTicketId(null)}
          />
        ) : isCreatingAs ? (
          <MobileAsCreate
            initialAssetNo={asInitialParams?.assetNo}
            initialSiteId={asInitialParams?.siteId}
            onBack={() => setIsCreatingAs(false)}
            onCreated={(ticketId) => {
              setIsCreatingAs(false);
              setSelectedAsTicketId(ticketId);
            }}
          />
        ) : activeTab === 'home' ? (
          deptMode === 'EXECUTIVE' ? (
            <MobileExecutiveHome
              onNavigate={handleTabChange}
              onOpenAsDetail={handleOpenAsDetail}
            />
          ) : deptMode === 'ADMIN' ? (
            <MobileAdminHome
              onNavigate={handleTabChange}
            />
          ) : (
            <MobileHome
              deptMode={deptMode}
              onNavigate={handleTabChange}
              onOpenAsDetail={handleOpenAsDetail}
              onOpenCreateAs={handleOpenCreateAs}
            />
          )
        ) : activeTab === 'sales_order' ? (
          <MobileDispatchOrderCreate
            initialCustomerId={orderInitialParams?.customerId}
            initialSpecFt={orderInitialParams?.specFt}
            onBack={() => handleTabChange('home')}
            onSuccess={() => handleTabChange('my_contracts')}
          />
        ) : activeTab === 'my_contracts' ? (
          <MobileMyContracts
            onOpenCreateAsForAsset={(assetNo, siteId) => handleOpenCreateAs(assetNo, siteId)}
          />
        ) : activeTab === 'as_create' ? (
          <MobileAsCreate
            initialAssetNo={asInitialParams?.assetNo}
            initialSiteId={asInitialParams?.siteId}
            onBack={() => handleTabChange('home')}
            onCreated={(ticketId) => {
              setSelectedAsTicketId(ticketId);
            }}
          />
        ) : activeTab === 'as' ? (
          <MobileAsList
            onSelectTicket={handleOpenAsDetail}
            onOpenCreate={handleOpenCreateAs}
          />
        ) : activeTab === 'dispatch' ? (
          <MobileDispatchList />
        ) : activeTab === 'sublease' ? (
          <MobileSubleaseManage
            onNavigate={(tab) => handleTabChange(tab)}
            onBack={() => handleTabChange('home')}
          />
        ) : activeTab === 'customers' ? (
          <MobileCustomerManage 
            onNavigateToOrder={(customerId) => {
              setOrderInitialParams({ customerId });
              handleTabChange('sales_order');
            }}
          />
        ) : activeTab === 'delinquency' ? (
          <MobileDelinquencyManage />
        ) : activeTab === 'assignment' ? (
          <MobileAssetAssignment 
            onNavigate={(tab) => handleTabChange(tab)}
            onBack={() => handleTabChange('home')}
          />
        ) : activeTab === 'inspection' ? (
          <MobileInspectionList />
        ) : activeTab === 'inbound_register' ? (
          <MobileInboundRegister 
            onSuccess={() => handleTabChange('inspection')}
            onBack={() => handleTabChange('home')}
          />
        ) : activeTab === 'vehicle_log' ? (
          <MobileVehicleLog onBack={() => handleTabChange('home')} />
        ) : activeTab === 'manual_viewer' ? (
          <MobileManualViewer onBack={() => handleTabChange('home')} />
        ) : activeTab === 'vehicle_stock' ? (
          <MobileVehicleStock />
        ) : (
          <MobileAssetSearch
            onNavigateToOrder={(specFt) => {
              setOrderInitialParams({ specFt });
              handleTabChange('sales_order');
            }}
          />
        )}
      </main>

      {/* 하단 고정 부서별 특화 엄지손가락 내비게이션 바 */}
      {!selectedAsTicketId && !isCreatingAs && (
        <MobileBottomNav
          deptMode={deptMode}
          activeTab={activeTab}
          onChangeTab={handleTabChange}
          pendingAsCount={pendingAsCount}
          pendingDispatchCount={pendingDispatchCount}
          pendingInspectionCount={pendingInspectionCount}
          pendingAssignmentCount={pendingAssignmentCount}
          subleaseLeakCount={subleaseLeakCount}
          overdueBadgeCount={overdueBadgeCount}
          incompleteCustomerCount={incompleteCustomerCount}
        />
      )}

      {/* 📻 현장 무전기 (PTT) 모달 */}
      <ErrorBoundary fallbackTitle="무전기 오류 복구" isModal onClose={() => setIsWalkieModalOpen(false)}>
        <MobileWalkieTalkieModal
          isOpen={isWalkieModalOpen}
          onClose={() => setIsWalkieModalOpen(false)}
          onNavigateToDispatchOrder={() => {
            setIsWalkieModalOpen(false);
            handleTabChange('sales_order');
          }}
        />
      </ErrorBoundary>

      {/* 📱 통화 녹음 APK 다운로드 및 모니터링 모달 */}
      <MobileApkMonitorModal
        isOpen={isApkMonitorOpen}
        onClose={() => setIsApkMonitorOpen(false)}
        workStatus={workStatus}
        isWorkLoading={workLoading}
        onToggleWork={handleWorkToggle}
        onOpenAudioUpload={() => setIsUploadModalOpen(true)}
        apkRelease={apkRelease}
      />

      {/* 📁 통화 녹음 파일 직접 업로드 모달 (아이폰/미설치자 대응) */}
      <CallAudioUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
      />
    </div>
  );
};
