// src/components/ChosungFilterBar.tsx - 전사 표준 헌장 준수 초성 필터 칩 바 컴포넌트
import React from 'react';
import { CHOSUNG_FILTER_LIST, ChosungFilterOption } from '../utils/hangulSearch';

interface ChosungFilterBarProps {
  selected: string;
  onChange: (chosung: string) => void;
  counts?: Record<string, number>;
  compact?: boolean;
  style?: React.CSSProperties;
}

export const ChosungFilterBar: React.FC<ChosungFilterBarProps> = ({
  selected = '전체',
  onChange,
  counts,
  compact = false,
  style
}) => {
  const handleClick = (item: string) => {
    // 이미 선택된 자음을 재클릭하면 '전체'로 토글 해제 (직관 편의)
    if (selected === item && item !== '전체') {
      onChange('전체');
    } else {
      onChange(item);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? '3px' : '4px',
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        padding: compact ? '2px 0' : '4px 0',
        whiteSpace: 'nowrap',
        flexWrap: 'nowrap',
        WebkitOverflowScrolling: 'touch',
        ...style
      }}
    >
      {CHOSUNG_FILTER_LIST.map((item) => {
        const isSelected = selected === item || (!selected && item === '전체');
        const count = counts ? counts[item] : undefined;

        return (
          <button
            key={item}
            type="button"
            onClick={() => handleClick(item)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              padding: compact ? '2px 7px' : '3px 9px',
              minWidth: item === '전체' || item === '기타' ? (compact ? '36px' : '42px') : (compact ? '24px' : '28px'),
              height: compact ? '24px' : '28px',
              borderRadius: '5px',
              fontSize: compact ? '11px' : '12px',
              fontWeight: isSelected ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.15s ease-in-out',
              backgroundColor: isSelected ? 'var(--primary, #2563eb)' : 'var(--bg-card, #1e293b)',
              color: isSelected ? '#ffffff' : 'var(--text-muted, #94a3b8)',
              border: isSelected ? '1px solid var(--primary, #2563eb)' : '1px solid var(--border-color, #334155)',
              boxShadow: isSelected ? '0 1px 3px rgba(37,99,235,0.3)' : 'none',
              lineHeight: 1
            }}
          >
            <span>{item}</span>
            {count !== undefined && count > 0 && (
              <span
                style={{
                  fontSize: '10px',
                  opacity: isSelected ? 0.9 : 0.7,
                  fontWeight: 600
                }}
              >
                ({count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
