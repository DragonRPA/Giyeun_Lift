import React from 'react';
import { Home, Wrench, Truck, CheckSquare, Search, Send, Building2, PlusCircle, Boxes, ArrowDownToLine, Layers, Users, AlertTriangle, Car, Fuel } from 'lucide-react';
import { MobileDeptMode } from './MobileHeader';

export type MobileTabType = 
  | 'home' 
  | 'assignment'
  | 'assets' 
  | 'sales_order' 
  | 'my_contracts' 
  | 'as_create' 
  | 'as' 
  | 'dispatch' 
  | 'inspection'
  | 'vehicle_stock'
  | 'inbound_register'
  | 'sublease'
  | 'customers'
  | 'delinquency'
  | 'vehicle_log'
  | 'manual_viewer';

interface MobileBottomNavProps {
  deptMode: MobileDeptMode;
  activeTab: MobileTabType;
  onChangeTab: (tab: MobileTabType) => void;
  pendingAsCount?: number;
  pendingDispatchCount?: number;
  pendingInspectionCount?: number;
  pendingAssignmentCount?: number;
  subleaseLeakCount?: number;
  overdueBadgeCount?: number;
  incompleteCustomerCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  deptMode,
  activeTab,
  onChangeTab,
  pendingAsCount = 0,
  pendingDispatchCount = 0,
  pendingInspectionCount = 0,
  pendingAssignmentCount = 0,
  subleaseLeakCount = 0,
  overdueBadgeCount = 0,
  incompleteCustomerCount = 0,
}) => {
  // 부서별 하단 5대 탭 동적 매핑
  let navItems: { id: MobileTabType; label: string; icon: any; badge: number }[] = [];

  if (deptMode === 'SALES') {
    // 💼 영업부 모바일 5대 정예 탭 (헌장 3.1 & 과제 10: 홈, 고객관리, 가용재고, 출고요청, 내현장)
    navItems = [
      { id: 'home', label: '홈', icon: Home, badge: 0 },
      { id: 'customers', label: '고객관리', icon: Users, badge: incompleteCustomerCount },
      { id: 'assets', label: '가용재고', icon: Search, badge: 0 },
      { id: 'sales_order', label: '출고요청', icon: Send, badge: 0 },
      { id: 'my_contracts', label: '내현장', icon: Building2, badge: 0 },
    ];
  } else if (deptMode === 'AS') {
    // 🔧 AS팀 모바일 탭 (검수지원 제거 ➔ 차량 소모품재고 신설)
    navItems = [
      { id: 'home', label: '홈', icon: Home, badge: 0 },
      { id: 'as', label: '출동티켓', icon: Wrench, badge: pendingAsCount },
      { id: 'as_create', label: 'AS신규', icon: PlusCircle, badge: 0 },
      { id: 'vehicle_stock', label: '차량재고', icon: Boxes, badge: 0 },
      { id: 'assets', label: '가용자산', icon: Search, badge: 0 },
    ];
  } else if (deptMode === 'OUTBOUND') {
    // 🏗️ 출고/자산팀 모바일 5대 정예 탭 (장비할당 신설 & 출고 라이프사이클 완성)
    navItems = [
      { id: 'home', label: '홈', icon: Home, badge: 0 },
      { id: 'assignment', label: '장비할당', icon: Layers, badge: pendingAssignmentCount },
      { id: 'inspection', label: '출고검수', icon: CheckSquare, badge: pendingInspectionCount },
      { id: 'inbound_register', label: '입고등록', icon: ArrowDownToLine, badge: 0 },
      { id: 'assets', label: '주기장자산', icon: Search, badge: 0 },
    ];
  } else if (deptMode === 'EXECUTIVE') {
    // 👑 경영진 모바일 탭 (출고승인, AS현황 영구 제거 ➔ 고객관리, 연체관리 신규 탑재)
    navItems = [
      { id: 'home', label: '경영홈', icon: Home, badge: 0 },
      { id: 'customers', label: '고객관리', icon: Users, badge: incompleteCustomerCount },
      { id: 'delinquency', label: '연체관리', icon: AlertTriangle, badge: overdueBadgeCount },
      { id: 'my_contracts', label: '계약현황', icon: Building2, badge: 0 },
      { id: 'assets', label: '자산가동', icon: Search, badge: 0 },
    ];
  } else {
    // 📊 관리부 모바일 5대 전용 탭 (출고관리, 채권/계약, 출고요청 전면 제거)
    navItems = [
      { id: 'home', label: '관리홈', icon: Home, badge: 0 },
      { id: 'sublease', label: '전대관리', icon: Layers, badge: subleaseLeakCount },
      { id: 'dispatch', label: '배차상차', icon: Truck, badge: pendingDispatchCount },
      { id: 'vehicle_log', label: '주유영수증', icon: Fuel, badge: 0 },
      { id: 'assets', label: '자산목록', icon: Search, badge: 0 },
    ];
  }

  return (
    <nav 
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9000,
        backgroundColor: 'rgba(15, 23, 42, 0.98)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid #1e293b',
        paddingTop: '6px',
        paddingLeft: '4px',
        paddingRight: '4px',
        paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.4)'
      }}
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChangeTab(item.id)}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              minWidth: 0,
              padding: '4px 2px',
              borderRadius: '12px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? '#60a5fa' : '#94a3b8',
              fontWeight: isActive ? '700' : '500'
            }}
          >
            <div style={{ position: 'relative' }}>
              <Icon size={20} color={isActive ? '#60a5fa' : '#94a3b8'} strokeWidth={isActive ? 2.4 : 1.8} />
              {item.badge > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-5px',
                  right: '-8px',
                  minWidth: '16px',
                  height: '16px',
                  padding: '0 3px',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  fontSize: '9px',
                  fontWeight: '900',
                  borderRadius: '9999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #0f172a',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}>
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>
            <span style={{
              fontSize: '10.5px',
              marginTop: '3px',
              color: isActive ? '#60a5fa' : '#94a3b8',
              fontWeight: isActive ? '800' : '500',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              maxWidth: '100%',
              letterSpacing: '-0.3px'
            }}>
              {item.label}
            </span>
            {isActive && (
              <span style={{
                width: '4px',
                height: '4px',
                borderRadius: '9999px',
                backgroundColor: '#3b82f6',
                marginTop: '2px'
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
};
