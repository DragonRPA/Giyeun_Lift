// src/config/menu_config.ts
export interface MenuItemConfig {
  id: string;
  name: string;
}

export interface MenuGroupConfig {
  id: string;
  name: string;
  items: MenuItemConfig[];
}

// 전사 전체 메뉴 그룹 및 항목 통합 관리 (Single Source of Truth)
export const SYSTEM_MENU_CONFIG: MenuGroupConfig[] = [
  {
    id: 'grp_dashboard',
    name: 'ERP 대시보드',
    items: [
      { id: 'dashboard', name: 'ERP 대시보드 메인' }
    ]
  },
  {
    id: 'grp_sales',
    name: '영업관리',
    items: [
      { id: 'customer', name: '고객 관리 (담당자/현장)' },
      { id: 'contract', name: '계약 관리' },
      { id: 'billing', name: '청구/수납 관리' },
      { id: 'receivable', name: '외상미수금 대장' },
      { id: 'smart_dispatch', name: '출고 요청' },
      { id: 'smart_dispatch4', name: '출고의뢰 (통합)' },
      { id: 'smart_return', name: '회수 요청' },
      { id: 'smart_as_request', name: 'AS 요청' }
    ]
  },
  {
    id: 'grp_product_asset',
    name: '제품 / 자산관리',
    items: [
      { id: 'product', name: '제품 관리' },
      { id: 'asset', name: '자산 관리 (대장)' },
      { id: 'acquisition_disposal', name: '당사자산 취득/매각' },
      { id: 'rent_asset', name: '임차자산 관리' }
    ]
  },
  {
    id: 'grp_logistics',
    name: '배차 / 운송관리',
    items: [
      { id: 'delivery', name: '배차/운송 관리 (비용정산)' },
      { id: 'transport_master', name: '운송 거래처/기사 관리' }
    ]
  },
  {
    id: 'grp_inout',
    name: '입출고관리',
    items: [
      { id: 'asset_inout_history', name: '자산 입출고/정비 이력' },
      { id: 'dispatch_assign', name: '장비 할당 (매핑)' },
      { id: 'outbound_inspections', name: '출고 검수 의뢰 관리' }
    ]
  },
  {
    id: 'grp_maintenance',
    name: '정비 / 소모품관리',
    items: [
      { id: 'consumable', name: '소모품 관리' },
      { id: 'field_as', name: '현장 AS 관리' },
      { id: 'repair', name: '주기장 정비 관리' },
      { id: 'inspection_checklist_manage', name: '정비항목관리' }
    ]
  },
  {
    id: 'grp_management',
    name: '경영관리',
    items: [
      { id: 'leave_ot', name: '연차/OT 관리' },
      { id: 'vehicle_log', name: '차량운행일지' },
      { id: 'purchase_settlement', name: '월말 매입 정산' },
      { id: 'vendors', name: '매입처 (공급자/외주처) 관리' },
      { id: 'bank_matching', name: '은행 입출금 대장' },
      { id: 'corporate_card', name: '법인카드 매입정산' },
      { id: 'cash_flow', name: '자금 흐름 분석' },
      { id: 'delinquency', name: '미수 채권 연체 관리' },
      { id: 'depreciation_execution', name: '감가상각 마감 실행' },
      { id: 'regular_reports', name: '정기보고서 생성' }
    ]
  },
  {
    id: 'grp_management_special',
    name: '경영관리 - 특수',
    items: [
      { id: 'organization', name: '조직/인사 관리' },
      { id: 'permission', name: '사용자 및 권한 설정' },
      { id: 'payroll', name: '급여 정산 (보안 강제)' }
    ]
  },
  {
    id: 'grp_system_dev',
    name: '시스템관리 - 개발자',
    items: [
      { id: 'initial_db_upload', name: '초기DB 업로드' },
      { id: 'google_config', name: '구글 관리자 설정' },
      { id: 'dev_uploader', name: '[개발] DB 데이터 업로더' }
    ]
  }
];

// 전사 모든 menuId 목록 추출 도우미
export const getAllSystemMenuIds = (): string[] => {
  const ids: string[] = [];
  SYSTEM_MENU_CONFIG.forEach(grp => {
    grp.items.forEach(item => {
      ids.push(item.id);
    });
  });
  return ids;
};

// menuId로 메뉴 한글 명칭 검색 도우미
export const getMenuNameById = (menuId: string): string => {
  for (const grp of SYSTEM_MENU_CONFIG) {
    const item = grp.items.find(i => i.id === menuId);
    if (item) return item.name;
  }
  return menuId;
};
