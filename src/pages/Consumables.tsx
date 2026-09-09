// src/pages/Consumables.tsx
// 구 소모품관리 단일 페이지 호환 래퍼 -> 소모품 재고 페이지(ConsumableStockPage)로 위임
import React from 'react';
import { ConsumableStockPage } from './ConsumableStockPage';

export const Consumables: React.FC = () => {
  return <ConsumableStockPage />;
};

export default Consumables;
