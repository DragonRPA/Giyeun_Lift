// src/config/role_templates.ts
import { normalizeMenuId } from './menu_config';

export interface MenuPermissionRule {
  canView: boolean;
  canSave: boolean;
}

export type PermissionRuleMap = Record<string, MenuPermissionRule>;

// 1. 공통 기본 권한 (모든 직원 공통: 대시보드, 본인 연차신청, 차량운행일지)
const BASE_COMMON_PERMISSIONS: PermissionRuleMap = {
  dashboard: { canView: true, canSave: false },
  leave_application: { canView: true, canSave: true }, // 모든 직원 공통 연차신청
  leave_ot: { canView: true, canSave: true },          // 레거시 호환
  vehicle_log: { canView: true, canSave: true },
  ot_management: { canView: false, canSave: false },   // OT 관리: 권한관리에서 통제
  leave_management: { canView: false, canSave: false }, // 연차관리: 급여 권한자 전용
  // 에이전트 배지: 기본 비노출 (프린터·파일변환 직무만 ON)
  agent_badge: { canView: false, canSave: false }
};

// 2. 관리부 (경영 / 회계 / 인사 / 자금) - DEPT-0000002
export const ACCOUNTING_TEMPLATE: PermissionRuleMap = {
  ...BASE_COMMON_PERMISSIONS,
  billing: { canView: true, canSave: true },
  receivable: { canView: true, canSave: true },
  purchase_settlement: { canView: true, canSave: true },
  vendors: { canView: true, canSave: true },
  bank_matching: { canView: true, canSave: true },
  corporate_card: { canView: true, canSave: true },
  cash_flow: { canView: true, canSave: true },
  delinquency: { canView: true, canSave: true },
  depreciation_execution: { canView: true, canSave: true },
  payroll: { canView: true, canSave: true },
  leave_management: { canView: true, canSave: true }, // 급여 권한자와 100% 동일
  ot_management: { canView: true, canSave: true },    // 관리부 OT 관리 권한
  organization: { canView: true, canSave: true },
  regular_reports: { canView: true, canSave: true },
  acquisition_disposal: { canView: true, canSave: true },
  // 열람만 허용 (영업/자산 상태 대사)
  customer: { canView: true, canSave: false },
  contract: { canView: true, canSave: false },
  product: { canView: true, canSave: false },
  asset: { canView: true, canSave: false },
  // 소모품 구매 승인 및 입출고/재고 총괄
  consumable_purchase: { canView: true, canSave: true },
  consumable_inout: { canView: true, canSave: true },
  consumable_stock: { canView: true, canSave: true },
  consumable: { canView: true, canSave: true },
  // 에이전트 배지: 관리부는 로컬 출력 없음 → 비노출
  agent_badge: { canView: false, canSave: false }
};

// 3. 영업부 (고객 / 계약 / 출고의뢰 / AS의뢰) - DEPT-0000003
export const SALES_TEMPLATE: PermissionRuleMap = {
  ...BASE_COMMON_PERMISSIONS,
  customer: { canView: true, canSave: true },
  contract: { canView: true, canSave: true },
  smart_dispatch: { canView: true, canSave: true },
  smart_dispatch4: { canView: true, canSave: true },
  smart_return: { canView: true, canSave: true },
  smart_as_request: { canView: true, canSave: true },
  receivable: { canView: true, canSave: true }, // 외상미수금 확인 및 독촉
  // 열람만 허용
  billing: { canView: true, canSave: false },
  product: { canView: true, canSave: false },
  asset: { canView: true, canSave: false },
  rent_asset: { canView: true, canSave: false },
  // 에이전트 배지: 영업부는 로컬 출력 없음 → 비노출
  agent_badge: { canView: false, canSave: false }
};

// 4. 출고팀 (배차 / 운송 / 출고검수) - DEPT-0000004
export const LOGISTICS_TEMPLATE: PermissionRuleMap = {
  ...BASE_COMMON_PERMISSIONS,
  delivery: { canView: true, canSave: true },
  transport_master: { canView: true, canSave: true },
  dispatch_assign: { canView: true, canSave: true },
  outbound_inspections: { canView: true, canSave: true },
  asset_inout_history: { canView: true, canSave: true },
  print_queue_monitor: { canView: true, canSave: true },
  // 열람만 허용
  smart_dispatch4: { canView: true, canSave: false },
  product: { canView: true, canSave: false },
  asset: { canView: true, canSave: false },
  rent_asset: { canView: true, canSave: false },
  // 소모품 입출고 (출고팀 검수 및 입출고 권한)
  consumable_purchase: { canView: true, canSave: false },
  consumable_inout: { canView: true, canSave: true },
  consumable_stock: { canView: true, canSave: false },
  // 에이전트 배지: 출고팀은 서류 프린트 필수 → 노출
  agent_badge: { canView: true, canSave: false }
};

// 5. AS팀 (정비 / 현장AS / 소모품수불 / 점검표) - DEPT-0000005
export const MECHANIC_TEMPLATE: PermissionRuleMap = {
  ...BASE_COMMON_PERMISSIONS,
  consumable_purchase: { canView: true, canSave: true },
  consumable_inout: { canView: true, canSave: true },
  consumable_stock: { canView: true, canSave: true },
  consumable: { canView: true, canSave: true },
  field_as: { canView: true, canSave: true },
  repair: { canView: true, canSave: true },
  inspection_checklist_manage: { canView: true, canSave: true },
  smart_as_request: { canView: true, canSave: true },
  outbound_inspections: { canView: true, canSave: true },
  asset_inout_history: { canView: true, canSave: true },
  print_queue_monitor: { canView: true, canSave: true },
  // 열람만 허용
  asset: { canView: true, canSave: false },
  product: { canView: true, canSave: false },
  // 에이전트 배지: AS팀은 출고검수 서류 프린트 필수 → 노출
  agent_badge: { canView: true, canSave: false }
};

/**
 * 🏢 부서 ID 또는 부서명, 직무 Role 기반 표준 권한 템플릿 반환
 */
export function getRoleTemplate(role?: string, departmentIdOrName?: string): PermissionRuleMap {
  const r = (role || '').toUpperCase();
  const d = (departmentIdOrName || '').toUpperCase();

  // 최고관리자: 템플릿 레벨에서도 전 권한 개방
  if (r === 'ADMIN' || r === 'MASTER') {
    return new Proxy({}, {
      get: () => ({ canView: true, canSave: true })
    }) as PermissionRuleMap;
  }

  // 1순위: departmentId 기반 매핑
  if (d === 'DEPT-0000002') return ACCOUNTING_TEMPLATE;
  if (d === 'DEPT-0000003') return SALES_TEMPLATE;
  if (d === 'DEPT-0000004') return LOGISTICS_TEMPLATE;
  if (d === 'DEPT-0000005') return MECHANIC_TEMPLATE;

  // 2순위: 부서명 텍스트 기반 매핑
  if (d.includes('관리') || d.includes('회계') || d.includes('재무') || d.includes('총무')) return ACCOUNTING_TEMPLATE;
  if (d.includes('영업')) return SALES_TEMPLATE;
  if (d.includes('출고') || d.includes('배차') || d.includes('운송') || d.includes('물류')) return LOGISTICS_TEMPLATE;
  if (d.includes('AS') || d.includes('정비') || d.includes('수리')) return MECHANIC_TEMPLATE;

  // 3순위: Role 텍스트 기반 매핑
  if (r.includes('ACCOUNT') || r.includes('PURCHASE')) return ACCOUNTING_TEMPLATE;
  if (r.includes('SALE')) return SALES_TEMPLATE;
  if (r.includes('LOGISTIC') || r.includes('DELIVERY') || r.includes('DISPATCH')) return LOGISTICS_TEMPLATE;
  if (r.includes('MECHANIC') || r.includes('REPAIR')) return MECHANIC_TEMPLATE;

  // 기본값: 최소 기본 권한
  return BASE_COMMON_PERMISSIONS;
}

/**
 * 🔍 특정 사용자의 직무 템플릿에서 해당 메뉴의 기본 권한 판정
 */
export function getRoleTemplatePermission(
  role: string | undefined,
  departmentIdOrName: string | undefined,
  menuId: string,
  action: 'view' | 'save'
): boolean | undefined {
  const normMenuId = normalizeMenuId(menuId);
  const template = getRoleTemplate(role, departmentIdOrName);
  const rule = template[normMenuId];
  if (!rule) return undefined;
  return action === 'view' ? rule.canView : rule.canSave;
}
