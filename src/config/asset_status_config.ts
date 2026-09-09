// src/config/asset_status_config.ts — 자산 상태 단일 원본 마스터 장부 (SSOT)

export type AssetStatusKey = 'AVAILABLE' | 'ASSIGNED' | 'RENTED' | 'REPAIRING' | 'RENTED_RETURNED' | 'SOLD';

export interface AssetStatusDetail {
  code: AssetStatusKey;
  label: string;
  badgeClass: string;
  description: string;
}

// 자산 상태 전사 단일 원본 정의 (Single Source of Truth)
export const ASSET_STATUS_SSOT: Record<AssetStatusKey, AssetStatusDetail> = {
  AVAILABLE: {
    code: 'AVAILABLE',
    label: '임대가능',
    badgeClass: 'badge-success',
    description: '대여 및 출고 지시가 가능한 가용 장비'
  },
  ASSIGNED: {
    code: 'ASSIGNED',
    label: '출고대기',
    badgeClass: 'badge-warning',
    description: '계약에 장비가 할당 완료되어 출고 검수 대기 중인 장비 (이중 할당 차단)'
  },
  RENTED: {
    code: 'RENTED',
    label: '대여중',
    badgeClass: 'badge-info',
    description: '출고 검수 승인 완료 후 현장에서 대여 운영 중인 장비'
  },
  REPAIRING: {
    code: 'REPAIRING',
    label: '정비중',
    badgeClass: 'badge-danger',
    description: '입고 정비 또는 현장 수리 진행 중인 장비'
  },
  RENTED_RETURNED: {
    code: 'RENTED_RETURNED',
    label: '임차반납',
    badgeClass: 'badge-secondary',
    description: '외부 임차처에서 임차한 자산을 임차처에 반납 완료한 상태'
  },
  SOLD: {
    code: 'SOLD',
    label: '매각완료',
    badgeClass: 'badge-dark',
    description: '당사 소유 자산을 매각 완료 처리한 상태'
  }
};

// SSOT: 모든 자산 상태 키 목록
export const getAssetStatusKeys = (): AssetStatusKey[] => {
  return Object.keys(ASSET_STATUS_SSOT) as AssetStatusKey[];
};

// SSOT: DB CHECK 제약조건 SQL DDL 자동 생성 구문
export const getAssetStatusCheckConstraintSql = (): string => {
  const keysStr = getAssetStatusKeys().map(k => `'${k}'`).join(', ');
  return `CHECK (status IN (${keysStr}))`;
};

// SSOT: PostgreSQL ALTER TABLE CHECK 제약조건 갱신 DDL 쿼리문
export const getAssetStatusFixDdlStatements = (): string[] => {
  const keysStr = getAssetStatusKeys().map(k => `'${k}'`).join(', ');
  return [
    'ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_check;',
    `ALTER TABLE assets ADD CONSTRAINT assets_status_check CHECK (status IN (${keysStr}));`
  ];
};

// SSOT: 한글 상태 라벨 변환 도우미
export const getAssetStatusLabel = (status: string): string => {
  const detail = ASSET_STATUS_SSOT[status as AssetStatusKey];
  return detail ? detail.label : status;
};

// SSOT: 뱃지 CSS 클래스 변환 도우미
export const getAssetStatusBadgeClass = (status: string): string => {
  const detail = ASSET_STATUS_SSOT[status as AssetStatusKey];
  return detail ? detail.badgeClass : 'badge-secondary';
};
