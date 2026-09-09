// src/pages/LeaveOtPage.tsx
// 레거시 호환용 래퍼: 연차신청/연차관리/OT관리 분리 이후 구 라우팅 유입 시 자동 분기
import React from 'react';
import { useApp } from '../context/AppContext';
import { LeaveApplicationPage } from './LeaveApplicationPage';
import { LeaveManagementPage } from './LeaveManagementPage';

export const LeaveOtPage: React.FC = () => {
  const { hasPermission } = useApp();
  const canViewManagement = hasPermission('leave_management', 'view');

  // 급여 권한 보유자는 연차관리 화면, 일반 직원은 연차신청 화면으로 자연스럽게 안내
  if (canViewManagement) {
    return <LeaveManagementPage />;
  }
  return <LeaveApplicationPage />;
};
