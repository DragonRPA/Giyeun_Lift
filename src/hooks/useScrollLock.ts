// src/hooks/useScrollLock.ts
import { useEffect } from 'react';

/**
 * 모달/드로어 오픈 시 배경 스크롤을 잠그고 Layout Shift를 방지하는 훅
 */
export const useScrollLock = (lock: boolean) => {
  useEffect(() => {
    if (!lock) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    // OS 스크롤바 너비 계산 (레이아웃 튕김 방지)
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [lock]);
};
