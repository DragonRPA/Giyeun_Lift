// d:\Giyeun_Lift\src\App.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from './context/AppContext';
import {
  LayoutDashboard, Users, UserCheck, Package, Layers, PlusCircle,
  Truck, Wrench, Shield, ShoppingBag, CreditCard, LogOut, Sun, Moon, Menu, X, Zap, Settings, Database as DatabaseIcon,
  TrendingUp, Clock, AlertTriangle, Building2, ChevronDown, ChevronRight, Briefcase, Box, FolderKanban, ShieldAlert, Terminal, ArrowLeftRight, CheckSquare,
  Smartphone, Monitor, Car, FileText, Search, Printer, PackagePlus, Boxes, Calendar
} from 'lucide-react';

import { WeatherWidget } from './components/WeatherWidget';

// 페이지 컴포넌트 임포트 (SSOT 언더바 파일명 통일)
import { Dashboard } from './pages/Dashboard';
import { PrintQueueManager } from './pages/PrintQueueManager';
import { UsersPermissions } from './pages/users_permissions';
import { Customers } from './pages/Customers';
import { Products } from './pages/Products';
import { Assets } from './pages/Assets';
import { AssetAcquisitionDisposal } from './pages/AssetAcquisitionDisposal';
import { RentAssets } from './pages/rent_assets';
import { InspectionChecklistManage } from './pages/inspection_checklist_manage';
import { Consumables } from './pages/Consumables';
import { ConsumablePurchasesPage } from './pages/ConsumablePurchasesPage';
import { ConsumableInOutPage } from './pages/ConsumableInOutPage';
import { ConsumableStockPage } from './pages/ConsumableStockPage';
import { Contracts } from './pages/Contracts';
import { Billings } from './pages/Billings';
import { Receivables } from './pages/Receivables';
import { BankMatching } from './pages/BankMatching';
import { TruckDispatch } from './pages/TruckDispatch';
import { TransportMaster } from './pages/TransportMaster';
import { DevDataUploader } from './pages/DevDataUploader';
import { Repairs } from './pages/Repairs';
import { SmartAsRequest } from './pages/SmartAsRequest';
import { FieldAsManagement } from './pages/FieldAsManagement';
import { SmartDispatch } from './pages/smart_dispatch';
import { SmartDispatch4 } from './pages/smart_dispatch4';
import { SmartReturn } from './pages/smart_return';
import { AssetHistory } from './pages/asset_history';
import { AssetAssignment } from './pages/asset_assignment';
import { OrganizationSettings } from './pages/OrganizationSettings';
import { Vendors } from './pages/Vendors';
import { GoogleConfig } from './pages/GoogleConfig';
import { LeaveOtPage } from './pages/LeaveOtPage';
import { LeaveApplicationPage } from './pages/LeaveApplicationPage';
import { LeaveManagementPage } from './pages/LeaveManagementPage';
import { OtManagementPage } from './pages/OtManagementPage';
import { VehicleOperationLogPage } from './pages/VehicleOperationLogPage';
import { PayrollPage } from './pages/PayrollPage';
import { CorporateCardPage } from './pages/CorporateCardPage';
import { CashFlowPage } from './pages/CashFlowPage';
import { DelinquencyPage } from './pages/DelinquencyPage';
import { OutboundInspections } from './pages/outbound_inspections';
import { DepreciationExecution } from './pages/depreciation_execution';
import { PurchaseSettlementPage } from './pages/PurchaseSettlementPage';
import { RegularReportsPage } from './pages/RegularReportsPage';
import { InitialDbUploader } from './pages/InitialDbUploader';
import { AgentHeaderBadge } from './components/AgentHeaderBadge';
import { MirrorSyncProgressToast } from './components/MirrorSyncProgressToast';
import { MobileApp } from './mobile/MobileApp';
import { initWorkNotificationListener } from './utils/workNotificationService';
import { ErrorBoundary } from './components/ErrorBoundary';

export interface SubMenuItem {
  id: string;
  name: string;
  icon: React.ReactNode;
  component: React.ReactNode;
}

export interface MenuGroup {
  id: string;
  name: string;
  icon: React.ReactNode;
  items: SubMenuItem[];
}

const App: React.FC = () => {
  const { currentUser, users, switchUser, login, logout, theme, toggleTheme, hasPermission, activeTab, setActiveTab, loadTablesForMenu, currentTenant } = useApp();

  // 로그인 폼 상태
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);

  // 편의기능 체크박스 상태
  const [rememberId, setRememberId] = useState(false);
  const [rememberPw, setRememberPw] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);

  // 모바일 메뉴 사이드바 토글 상태
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ─── 메뉴 검색 네비게이터 상태 ───
  const [menuSearchOpen, setMenuSearchOpen] = useState(false);
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [menuSearchHighlight, setMenuSearchHighlight] = useState(0);
  const menuSearchInputRef = useRef<HTMLInputElement>(null);
  const menuSearchBoxRef = useRef<HTMLDivElement>(null);

  // 모바일 전용 뷰 모드 (PWA / Field App)
  const [isMobileView, setIsMobileView] = useState<boolean>(() => {
    // 1. URL 쿼리나 해시 확인 (/m 또는 ?mode=mobile 또는 ?view=mobile)
    const search = window.location.search;
    if (
      window.location.pathname.startsWith('/m') ||
      search.includes('view=mobile') ||
      search.includes('mode=mobile')
    ) {
      return true;
    }
    // 2. localStorage 저장값 확인 (사용자의 명시적 수동 선택 최우선)
    const savedView = localStorage.getItem('erp_view_mode');
    if (savedView === 'mobile') return true;
    if (savedView === 'desktop') return false;

    // 3. 디바이스 환경 판별 (아이폰, 아이패드, 안드로이드 모바일 등)
    const ua = navigator.userAgent;
    const isIPhone = /iPhone|iPod/i.test(ua);
    const isIPad = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMobileWidth = window.innerWidth < 768;

    // 아이폰 또는 768px 미만 소형 기기는 기본 모바일 뷰
    if (isIPhone || isMobileWidth) return true;

    // 아이패드 세로 모드(portrait <= 834px)는 현장 모바일 뷰 기본 진입 권장
    if (isIPad && window.innerWidth <= 834) return true;

    return false;
  });

  // 컴포넌트 마운트 시 저장된 로그인 편의 정보 로드
  useEffect(() => {
    const savedId = localStorage.getItem('remember_id');
    const savedPw = localStorage.getItem('remember_pw');
    if (savedId) {
      setLoginId(savedId);
      setRememberId(true);
    }
    if (savedPw) {
      setPassword(savedPw);
      setRememberPw(true);
    }
    const hasAuto = !!localStorage.getItem('auto_user');
    if (hasAuto) {
      setAutoLogin(true);
    }
  }, []);

  // 실시간 업무 알림 리스너 연동
  useEffect(() => {
    if (currentUser) {
      initWorkNotificationListener(currentUser);
    }
  }, [currentUser]);

  // 메뉴(activeTab) 전환 시 스크롤 최상단 리셋 + 해당 메뉴 관련 테이블만 Supabase pull (최신 데이터 보장)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const mainArea = document.querySelector('.main-content-area');
    if (mainArea) {
      mainArea.scrollTop = 0;
    }
    loadTablesForMenu(activeTab);
  }, [activeTab]);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const success = login(loginId, password, autoLogin);
    if (success) {
      setLoginError(false);
      
      // 아이디 저장 처리
      if (rememberId) {
        localStorage.setItem('remember_id', loginId);
      } else {
        localStorage.removeItem('remember_id');
      }
      
      // 비밀번호 저장 처리
      if (rememberPw) {
        localStorage.setItem('remember_pw', password);
      } else {
        localStorage.removeItem('remember_pw');
      }

      // 필드 정리 (저장 설정 안된 값만 비우기)
      if (!rememberId) setLoginId('');
      if (!rememberPw) setPassword('');
      
      setActiveTab('dashboard'); // 로그인 성공시 대시보드로
    } else {
      setLoginError(true);
    }
  };

  // 계층형 상위-하위 아코디언 메뉴 구조 정의 (유저 지정 규격)
  const menuGroups: MenuGroup[] = [
    {
      id: 'grp_sales',
      name: '영업관리',
      icon: <Briefcase size={17} />,
      items: [
        { id: 'customer', name: '고객 관리', icon: <Users size={16} />, component: <Customers /> },
        { id: 'contract', name: '계약 관리', icon: <UserCheck size={16} />, component: <Contracts /> },
        { id: 'billing', name: '청구 / 수납 관리', icon: <CreditCard size={16} />, component: <Billings /> },
        { id: 'receivable', name: '외상미수금 대장', icon: <CreditCard size={16} />, component: <Receivables /> },
        { id: 'smart_dispatch4', name: '출고 요청', icon: <Zap size={16} />, component: <SmartDispatch4 /> },
        { id: 'smart_return', name: '회수 요청', icon: <Zap size={16} />, component: <SmartReturn /> },
        { id: 'smart_as_request', name: 'AS 요청', icon: <Wrench size={16} />, component: <SmartAsRequest /> },
      ]
    },
    {
      id: 'grp_product_asset',
      name: '제품 / 자산관리',
      icon: <Box size={17} />,
      items: [
        { id: 'product', name: '제품 관리', icon: <Package size={16} />, component: <Products /> },
        { id: 'asset', name: '자산 관리 (대장)', icon: <Layers size={16} />, component: <Assets /> },
        { id: 'acquisition_disposal', name: '당사자산 취득 / 매각', icon: <PlusCircle size={16} />, component: <AssetAcquisitionDisposal /> },
        { id: 'rent_asset', name: '임차 장비 관리', icon: <ShoppingBag size={16} />, component: <RentAssets /> },
      ]
    },
    {
      id: 'grp_logistics',
      name: '배차 / 운송관리',
      icon: <Truck size={17} />,
      items: [
        { id: 'delivery', name: '배차 / 운송 관리', icon: <Truck size={16} />, component: <TruckDispatch /> },
        { id: 'transport_master', name: '운송 거래처 관리', icon: <Settings size={16} />, component: <TransportMaster /> },
      ]
    },
    {
      id: 'grp_inout',
      name: '입출고관리',
      icon: <ArrowLeftRight size={17} />,
      items: [
        { id: 'asset_inout_history', name: '자산 입출고 / 정비 이력', icon: <Clock size={16} />, component: <AssetHistory /> },
        { id: 'dispatch_assign', name: '장비 할당 / 매핑', icon: <Layers size={16} />, component: <AssetAssignment /> },
        { id: 'outbound_inspections', name: '출고 검수 관리', icon: <CheckSquare size={16} />, component: <OutboundInspections /> },
        { id: 'print_queue_monitor', name: '프린트 큐 모니터', icon: <Printer size={16} />, component: <PrintQueueManager /> },
      ]
    },
    {
      id: 'grp_maintenance',
      name: '정비 / 소모품관리',
      icon: <Wrench size={17} />,
      items: [
        { id: 'consumable_purchase', name: '소모품 구매', icon: <ShoppingBag size={16} />, component: <ConsumablePurchasesPage /> },
        { id: 'consumable_inout', name: '소모품 입출고', icon: <PackagePlus size={16} />, component: <ConsumableInOutPage /> },
        { id: 'consumable_stock', name: '소모품 재고', icon: <Boxes size={16} />, component: <ConsumableStockPage /> },
        { id: 'field_as', name: '현장 AS 관리', icon: <Wrench size={16} />, component: <FieldAsManagement /> },
        { id: 'repair', name: '주기장 정비 관리', icon: <Wrench size={16} />, component: <Repairs /> },
        { id: 'inspection_checklist_manage', name: '정비 항목 관리', icon: <Shield size={16} />, component: <InspectionChecklistManage /> },
      ]
    },
    {
      id: 'grp_management',
      name: '경영관리',
      icon: <FolderKanban size={17} />,
      items: [
        { id: 'leave_application', name: '연차신청', icon: <Calendar size={16} />, component: <LeaveApplicationPage /> },
        { id: 'ot_management', name: 'OT 관리', icon: <Clock size={16} />, component: <OtManagementPage /> },
        { id: 'vehicle_log', name: '차량 / 주유관리', icon: <Car size={16} />, component: <VehicleOperationLogPage /> },
        { id: 'purchase_settlement', name: '월말 매입 정산', icon: <CreditCard size={16} />, component: <PurchaseSettlementPage /> },
        { id: 'vendors', name: '매입처 (공급자 / 외주처) 관리', icon: <Building2 size={16} />, component: <Vendors /> },
        { id: 'bank_matching', name: '은행 입출금 대장', icon: <TrendingUp size={16} />, component: <BankMatching /> },
        { id: 'corporate_card', name: '법인카드 매입정산', icon: <CreditCard size={16} />, component: <CorporateCardPage /> },
        { id: 'cash_flow', name: '자금 흐름 분석', icon: <TrendingUp size={16} />, component: <CashFlowPage /> },
        { id: 'delinquency', name: '미수 채권 연체 관리', icon: <AlertTriangle size={16} />, component: <DelinquencyPage /> },
        { id: 'depreciation_execution', name: '감가상각 마감 실행', icon: <TrendingUp size={16} />, component: <DepreciationExecution /> },
        { id: 'regular_reports', name: '정기보고서 생성', icon: <FileText size={16} />, component: <RegularReportsPage /> },
      ]
    },
    {
      id: 'grp_management_special',
      name: '경영관리 - 특수',
      icon: <ShieldAlert size={17} />,
      items: [
        { id: 'organization', name: '조직 / 인사 관리', icon: <Users size={16} />, component: <OrganizationSettings /> },
        { id: 'permission', name: '사용자 및 권한', icon: <Shield size={16} />, component: <UsersPermissions /> },
        { id: 'payroll', name: '급여 정산', icon: <CreditCard size={16} />, component: <PayrollPage /> },
        { id: 'leave_management', name: '연차관리', icon: <UserCheck size={16} />, component: <LeaveManagementPage /> },
      ]
    },
    {
      id: 'grp_system_dev',
      name: '시스템관리 - 개발자',
      icon: <Terminal size={17} />,
      items: [
        { id: 'initial_db_upload', name: '초기DB 업로드', icon: <DatabaseIcon size={16} />, component: <InitialDbUploader /> },
        { id: 'google_config', name: '구글 관리자 설정', icon: <Settings size={16} />, component: <GoogleConfig /> },
        { id: 'dev_uploader', name: '[개발] DB 데이터 업로더', icon: <DatabaseIcon size={16} />, component: <DevDataUploader /> },
      ]
    }
  ];

  // 상위 그룹 아코디언 접힘/펼침 상태

  // ─── 메뉴 검색 네비게이터 — 필터링 결과 계산 ───
  const menuSearchResults = useCallback(() => {
    const q = menuSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: { groupName: string; id: string; name: string }[] = [];
    menuGroups.forEach(grp => {
      grp.items.forEach(item => {
        if (item.name.toLowerCase().includes(q) || grp.name.toLowerCase().includes(q)) {
          results.push({ groupName: grp.name, id: item.id, name: item.name });
        }
      });
    });
    return results;
  }, [menuSearchQuery, menuGroups]);

  const searchResults = menuSearchResults();

  // 전역 키보드 단축키: '/' 또는 Ctrl+K → 검색창 오픈
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K 또는 Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setMenuSearchOpen(true);
        setMenuSearchQuery('');
        setMenuSearchHighlight(0);
        setTimeout(() => menuSearchInputRef.current?.focus(), 50);
        return;
      }
      // Esc — 닫기
      if (e.key === 'Escape' && menuSearchOpen) {
        setMenuSearchOpen(false);
        setMenuSearchQuery('');
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuSearchOpen]);

  // 검색창 외부 클릭 시 닫기
  useEffect(() => {
    if (!menuSearchOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuSearchBoxRef.current && !menuSearchBoxRef.current.contains(e.target as Node)) {
        setMenuSearchOpen(false);
        setMenuSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuSearchOpen]);

  // 검색창 오픈 시 자동 포커스
  useEffect(() => {
    if (menuSearchOpen) {
      setTimeout(() => menuSearchInputRef.current?.focus(), 50);
    }
  }, [menuSearchOpen]);

  const handleMenuSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMenuSearchHighlight(h => Math.min(h + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMenuSearchHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = searchResults[menuSearchHighlight];
      if (target) {
        setActiveTab(target.id);
        setMenuSearchOpen(false);
        setMenuSearchQuery('');
      }
    } else if (e.key === 'Escape') {
      setMenuSearchOpen(false);
      setMenuSearchQuery('');
    }
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    grp_sales: true,
    grp_product_asset: true,
    grp_logistics: true,
    grp_inout: true,
    grp_maintenance: true,
    grp_management: true,
    grp_management_special: true,
    grp_system_dev: true
  });


  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // activeTab이 활성화될 때 속한 상위 그룹 자동 펼침
  useEffect(() => {
    menuGroups.forEach(grp => {
      if (grp.items.some(item => item.id === activeTab)) {
        setExpandedGroups(prev => ({ ...prev, [grp.id]: true }));
      }
    });
  }, [activeTab]);

  // 활성 페이지 컴포넌트 탐색
  const getActiveComponent = () => {
    if (activeTab === 'dashboard') return <Dashboard />;
    if (activeTab === 'consumable' || activeTab === 'consumables') return <ConsumableStockPage />;
    if (activeTab === 'leave_ot') return <LeaveOtPage />;
    for (const grp of menuGroups) {
      const found = grp.items.find(item => item.id === activeTab);
      if (found) return found.component;
    }
    return <Dashboard />;
  };

  // 1. 비로그인 상태: 로그인 화면 렌더링
  if (!currentUser) {
    return (
      <div style={{
        display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)', padding: '16px'
      }}>
        <div className="card" style={{ width: '100%', maxWidth: '380px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <img 
                src={currentTenant?.ciUrl || currentTenant?.logoUrl || '/images/ci/giyeun_ci.png'} 
                alt="CI" 
                style={{ height: '32px', maxWidth: '110px', objectFit: 'contain' }} 
                onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
              />
              <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--primary)', letterSpacing: '-0.5px', margin: 0 }}>
                {currentTenant?.displayName || currentTenant?.tradeName || currentTenant?.corporateName || '기연리프트'}
              </h1>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontWeight: '600', letterSpacing: '0.3px' }}>
              e-Bro ERP System
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ color: 'var(--text-main)', fontSize: '13px', marginBottom: '4px', display: 'block' }}>사용자 아이디</label>
              <input
                type="text"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                placeholder="아이디 입력 (admin)"
                required
                style={{ fontSize: '14px', padding: '8px 12px' }}
              />
            </div>
            <div>
              <label style={{ color: 'var(--text-main)', fontSize: '13px', marginBottom: '4px', display: 'block' }}>비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                required
                style={{ fontSize: '14px', padding: '8px 12px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', padding: '2px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberId}
                  onChange={e => setRememberId(e.target.checked)}
                />
                아이디 저장
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberPw}
                  onChange={e => setRememberPw(e.target.checked)}
                />
                비밀번호 저장
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoLogin}
                  onChange={e => setAutoLogin(e.target.checked)}
                />
                자동 로그인
              </label>
            </div>

            {loginError && (
              <div style={{ color: 'var(--danger)', fontSize: '13px', textAlign: 'center', fontWeight: '600' }}>
                아이디 또는 비밀번호가 잘못되었습니다.
              </div>
            )}

            <button type="submit" className="btn-primary" style={{ padding: '12px', fontSize: '16px', fontWeight: '600', marginTop: '4px' }}>
              로그인
            </button>
          </form>

          {/* 접속 화면 모드 선택 (모바일 / PC) */}
          <div style={{
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px'
          }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: '600' }}>접속 화면 모드</span>
            <div style={{
              display: 'flex',
              gap: '4px',
              backgroundColor: 'var(--bg-app)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <button
                type="button"
                onClick={() => {
                  setIsMobileView(true);
                  localStorage.setItem('erp_view_mode', 'mobile');
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '700',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: isMobileView ? 'var(--primary)' : 'transparent',
                  color: isMobileView ? '#ffffff' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease'
                }}
              >
                <Smartphone size={13} />
                <span>모바일</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMobileView(false);
                  localStorage.setItem('erp_view_mode', 'desktop');
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '700',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: !isMobileView ? 'var(--primary)' : 'transparent',
                  color: !isMobileView ? '#ffffff' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease'
                }}
              >
                <Monitor size={13} />
                <span>PC/대화면</span>
              </button>
            </div>
          </div>

          {/* 아이폰 · 아이패드 사파리(Safari) 최적화 안내 */}
          <div style={{
            marginTop: '16px',
            padding: '12px 14px',
            borderRadius: '12px',
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            color: '#94a3b8',
            fontSize: '11.5px',
            lineHeight: 1.5
          }}>
            <div style={{ fontWeight: '700', color: '#60a5fa', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Smartphone size={14} />
              <span>아이폰 · 아이패드 사파리(Safari) 지원</span>
            </div>
            <div>• 사파리 브라우저 <strong>[공유]</strong> ➔ <strong>[홈 화면에 추가]</strong> 시 전체화면 단독 앱으로 즉시 실행됩니다.</div>
            <div>• 아이패드는 화면 회전 및 상단 모드 전환을 통해 모바일/PC 뷰를 자유롭게 선택할 수 있습니다.</div>
          </div>

          {/* 테스트 계정 안내 — 개발 환경(localhost)에서만 표시 */}
          {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
            <div style={{ marginTop: '16px', padding: '12px', border: '1px dashed #f59e0b', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(251,191,36,0.07)', fontSize: '12px' }}>
              <div style={{ fontWeight: '700', marginBottom: '6px', color: '#d97706' }}>⚠️ [개발 전용] 테스트 계정 — 운영 환경에서는 표시 안됨</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <div>• 최고관리자: <strong>admin / admin123</strong></div>
                <div>• 영업관리: <strong>manager / mgr123</strong></div>
                <div>• 일반영업: <strong>user / user123</strong></div>
                <div>• 정비현장: <strong>mechanic / mech123</strong></div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. 모바일 전용 PWA 화면 렌더링 (분리 구축 뷰)
  if (isMobileView) {
    return (
      <MobileApp
        onSwitchToPc={() => {
          setIsMobileView(false);
          localStorage.setItem('erp_view_mode', 'desktop');
        }}
      />
    );
  }

  // 3. 로그인 상태: 메인 ERP 대시보드 렌더링
  const userHasViewPerm = hasPermission(activeTab, 'view');

  return (
    <div style={{ display: 'flex', height: '100dvh', maxHeight: '100dvh', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* 상단 네비게이션 헤더 */}
      <header style={{
        height: '64px',
        flexShrink: 0,
        backgroundColor: 'var(--bg-header)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{ padding: '8px', display: 'none', borderRadius: '4px', backgroundColor: 'transparent' }}
            className="mobile-burger-btn"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* 🏢 테넌트 회사 CI 이미지 (회사이름 바로 왼쪽) */}
            <img 
              src={currentTenant?.ciUrl || currentTenant?.logoUrl || '/images/ci/giyeun_ci.png'} 
              alt="CI" 
              style={{ height: '32px', maxWidth: '90px', objectFit: 'contain', flexShrink: 0 }} 
              onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
            />
            {/* 🏢 1열: 고객회사명(강조) / 2열: e-Bro ERP System (작은 글씨) */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: '18px', fontWeight: '900', color: 'var(--text-primary)', letterSpacing: '-0.5px', whiteSpace: 'nowrap', lineHeight: 1.15 }}>
                {currentTenant?.displayName || currentTenant?.tradeName || currentTenant?.corporateName || '기연리프트'}
              </span>
              <span style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--primary)', letterSpacing: '0.2px', whiteSpace: 'nowrap', marginTop: '2px' }}>
                e-Bro ERP System
              </span>
            </div>
          </div>

          {/* 헤더 좌측 실시간 현장 날씨 정보 위젯 */}
          <WeatherWidget />
        </div>

        {/* ─── 헤더 중앙: 메뉴 검색 네비게이터 ─── */}
        <div
          ref={menuSearchBoxRef}
          style={{ position: 'relative', flex: '0 1 380px', minWidth: 0 }}
        >
          {/* 검색 트리거 버튼 (닫힌 상태) */}
          {!menuSearchOpen && (
            <button
              onClick={() => { setMenuSearchOpen(true); setMenuSearchQuery(''); setMenuSearchHighlight(0); }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-muted)',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              title="메뉴 검색 (Ctrl+K)"
            >
              <Search size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                메뉴 검색
              </span>
              <span style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
                flexShrink: 0,
                fontFamily: 'monospace',
              }}>
                Ctrl+K
              </span>
            </button>
          )}

          {/* 검색 입력창 (열린 상태) */}
          {menuSearchOpen && (
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{
                position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-muted)', pointerEvents: 'none', flexShrink: 0,
              }} />
              <input
                ref={menuSearchInputRef}
                value={menuSearchQuery}
                onChange={e => { setMenuSearchQuery(e.target.value); setMenuSearchHighlight(0); }}
                onKeyDown={handleMenuSearchKeyDown}
                placeholder="메뉴명 입력..."
                style={{
                  width: '100%',
                  padding: '7px 14px 7px 34px',
                  borderRadius: '8px',
                  border: '1.5px solid var(--primary)',
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* 드롭다운 검색 결과 목록 */}
          {menuSearchOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              zIndex: 200,
              overflow: 'hidden',
              maxHeight: '320px',
              overflowY: 'auto',
            }}>
              {searchResults.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  {menuSearchQuery.trim() ? '일치하는 메뉴 없음' : '메뉴명을 입력하세요'}
                </div>
              ) : (
                searchResults.map((item, idx) => (
                  <div
                    key={item.id}
                    onMouseDown={() => {
                      setActiveTab(item.id);
                      setMenuSearchOpen(false);
                      setMenuSearchQuery('');
                    }}
                    onMouseEnter={() => setMenuSearchHighlight(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 14px',
                      cursor: 'pointer',
                      backgroundColor: idx === menuSearchHighlight ? 'var(--primary)' : 'transparent',
                      color: idx === menuSearchHighlight ? '#fff' : 'var(--text-primary)',
                      borderBottom: idx < searchResults.length - 1 ? '1px solid var(--border-color)' : 'none',
                      transition: 'background-color 0.1s',
                    }}
                  >
                    <Search size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: '11px', opacity: 0.65, whiteSpace: 'nowrap' }}>
                        {item.groupName}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 사용자 정보 및 화면 모드 (밝은화면모드 / 어두운화면모드 / 모바일전환) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>

          {/* 🤖 로컬 사이드카 에이전트 실시간 상태 미니 배지 */}
          <AgentHeaderBadge currentUser={currentUser} />


          {/* 모바일 현장 전용 뷰 전환 버튼 */}
          <button
            onClick={() => {
              setIsMobileView(true);
              localStorage.setItem('erp_view_mode', 'mobile');
            }}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              backgroundColor: 'var(--bg-app)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              fontWeight: '600',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
            title="모바일 현장 PWA 모드로 전환"
          >
            <Smartphone size={15} color="#38BDF8" />
            <span>모바일화면</span>
          </button>

          {/* 화면 모드 전환 버튼 (명시적 텍스트 라벨 적용) */}
          <button
            onClick={toggleTheme}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              backgroundColor: 'var(--bg-app)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              fontWeight: '600',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
            title={theme === 'light' ? '어두운화면모드(다크모드)로 전환' : '밝은화면모드(라이트모드)로 전환'}
          >
            {theme === 'light' ? (
              <>
                <Sun size={15} color="#F59E0B" />
                <span>밝은화면모드</span>
              </>
            ) : (
              <>
                <Moon size={15} color="#8B5CF6" />
                <span>어두운화면모드</span>
              </>
            )}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} className="user-profile-badge">
            {(() => {
              const originalAdminStr = sessionStorage.getItem('original_admin_user');
              const originalAdmin = originalAdminStr ? JSON.parse(originalAdminStr) : null;
              const isSuperAdmin = currentUser.role === 'ADMIN' || originalAdmin?.role === 'ADMIN';

              if (isSuperAdmin) {
                const allUsers = [...users];
                if (originalAdmin && !allUsers.find(u => u.id === originalAdmin.id)) {
                  allUsers.unshift(originalAdmin);
                } else if (currentUser.id === 'sys-admin' && !allUsers.find(u => u.id === 'sys-admin')) {
                  allUsers.unshift(currentUser);
                }

                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
                    <select
                      value={currentUser.id}
                      onChange={(e) => switchUser(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-app)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                      title="[관리자 전용] 다른 사용자로 권한 테스트 전환"
                    >
                      <option value={currentUser.id}>{currentUser.name} ({currentUser.department}) - 현재</option>
                      <optgroup label="다른 사용자로 전환">
                        {allUsers.filter(u => u.id !== currentUser.id).map(u => (
                          <option key={u.id} value={u.id}>{u.name} ({u.department} / {u.role})</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700' }}>{currentUser.name} {currentUser.role === 'ADMIN' ? '관리자' : '임직원'}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentUser.department} ({currentUser.role})</span>
                </div>
              );
            })()}
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--primary)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700'
            }}>
              {currentUser.name.substring(0, 1)}
            </div>
          </div>

          <button
            onClick={logout}
            className="btn-secondary"
            style={{ padding: '8px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      </header>

      {/* 메인 레이아웃 본문 (헤더 64px 제외 나머지 전체) */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        
        {/* 데스크탑 계층형 아코디언 사이드바 (독자 스크롤) */}
        <aside
          className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}
          style={{
            width: '260px',
            height: '100%',
            backgroundColor: 'var(--bg-sidebar)',
            borderRight: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 10px',
            gap: '4px',
            overflowY: 'auto',
            overscrollBehavior: 'contain'
          }}
        >
          {/* 최상단 독립 ERP 대시보드 버튼 */}
          {hasPermission('dashboard', 'view') && (
            <button
              onClick={() => {
                setActiveTab('dashboard');
                setMobileMenuOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                fontSize: '13.5px',
                fontWeight: activeTab === 'dashboard' ? '700' : '500',
                color: activeTab === 'dashboard' ? '#ffffff' : 'var(--text-main)',
                background: activeTab === 'dashboard' ? 'linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%)' : 'transparent',
                boxShadow: activeTab === 'dashboard' ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none',
                cursor: 'pointer',
                marginBottom: '8px',
                transition: 'all 0.2s ease'
              }}
            >
              <LayoutDashboard size={17} />
              <span>ERP 대시보드</span>
            </button>
          )}

          {/* 계층형 접이식 상위-하위 아코디언 그룹 메뉴 */}
          {menuGroups.map(grp => {
            // 권한이 있는 하위 메뉴가 1개 이상 존재하는지 확인
            const visibleItems = grp.items.filter(item => hasPermission(item.id, 'view'));
            if (visibleItems.length === 0) return null;

            const isExpanded = expandedGroups[grp.id] !== false;
            const hasActiveChild = grp.items.some(item => item.id === activeTab);

            return (
              <div key={grp.id} style={{ marginBottom: '4px' }}>
                {/* 상위 메뉴 헤더 버튼 (아코디언 토글) */}
                <button
                  onClick={() => toggleGroup(grp.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '8px 10px', // 상위 아이콘 시작 X = 10px, 텍스트 시작 X = 38px
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    backgroundColor: hasActiveChild ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                    color: hasActiveChild ? 'var(--primary)' : 'var(--text-secondary)',
                    fontWeight: '700',
                    fontSize: '12.5px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden' }}>
                    <span style={{ width: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {grp.icon}
                    </span>
                    <span style={{ marginLeft: '8px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {grp.name}
                    </span>
                  </div>
                  {isExpanded ? <ChevronDown size={14} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} style={{ flexShrink: 0 }} />}
                </button>

                {/* 하위 메뉴 서브 항목 그룹 */}
                {isExpanded && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    marginTop: '2px',
                    marginLeft: '15px',
                    borderLeft: '2px solid rgba(59, 130, 246, 0.22)',
                  }}>
                    {visibleItems.map(item => {
                      const isItemActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveTab(item.id);
                            setMobileMenuOpen(false);
                          }}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '16px 1fr',
                            columnGap: '8px',
                            alignItems: 'center',
                            width: '100%',
                            padding: '7px 8px 7px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: 'none',
                            fontSize: '12px',
                            fontWeight: isItemActive ? '700' : '400',
                            color: isItemActive ? 'var(--primary)' : 'var(--text-secondary)',
                            backgroundColor: isItemActive ? 'var(--primary-light)' : 'transparent',
                            textAlign: 'left',
                            cursor: 'pointer',
                            transition: 'all var(--transition-fast)',
                            boxSizing: 'border-box',
                          }}
                        >
                          <span style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '16px',
                            height: '16px',
                            flexShrink: 0,
                            overflow: 'hidden',
                          }}>
                            {item.icon}
                          </span>
                          <span style={{
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                          }}>
                            {item.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* 메인 콘텐츠 영역 (독자 종스크롤 & 다이나믹 뷰포트 활용, 두꺼운 16px 스크롤바 적용) */}
        <main style={{ flex: 1, height: '100%', minHeight: 0, padding: '16px 20px 5px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }} className="main-content-area">
          {userHasViewPerm ? (
            getActiveComponent()
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '80px 0', color: 'var(--danger)', backgroundColor: 'var(--danger-light)' }}>
              <h3>접근 권한 제한 알림</h3>
              <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>
                선택하신 메뉴에 대한 조회 권한이 비활성화되어 있습니다.<br />
                권한이 필요할 경우 최고관리자에게 문의하시기 바랍니다.
              </p>
            </div>
          )}
        </main>

        {/* 모바일 메인 영역 어두운 백드롭 오버레이 (클릭 시 사이드바 자동 닫힘) */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: 'fixed',
              top: '64px',
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 35
            }}
          />
        )}

      </div>

      {/* 모바일 다이나믹 반응형 전용 스타일 (PC vs 모바일 분리) */}
      <style>{`
        @media (max-width: 768px) {
          .mobile-burger-btn {
            display: inline-flex !important;
          }
          .sidebar-nav {
            position: fixed;
            top: 64px;
            left: -270px;
            bottom: 0;
            width: 270px;
            z-index: 40;
            transition: left 0.25s ease;
            box-shadow: 4px 0 15px rgba(0,0,0,0.2);
          }
          .sidebar-nav.mobile-open {
            left: 0;
          }
          .user-profile-badge {
            display: none !important;
          }
          .main-content-area {
            padding: 12px 10px 40px 10px !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            touch-action: pan-x pan-y !important;
          }
        }
      `}</style>

      {/* 🚀 구글 드라이브 실시간 미러링 진행상황 플로팅 토스트 */}
      <MirrorSyncProgressToast />

    </div>
  );
};

export default App;
