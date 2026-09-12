// src/components/NtsStatusAuditModal.tsx
// 전사 등록 고객사/매입처 국세청 홈택스 사업자 휴폐업 전수 점검 및 렌탈 자산 보호 스튜디오

import React, { useState, useMemo, useRef } from 'react';
import { 
  X, Building2, Layers, Search, RefreshCw, AlertCircle, 
  CheckCircle2, ShieldAlert, Download, Play, Check, Truck, AlertTriangle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db, Customer, Vendor, DelinquencyActionLog, Todo } from '../services/db';
import { checkBatchNtsStatus, NtsStatusResult, formatBizNo } from '../services/ntsBusinessService';
import { exportToExcel } from '../services/excel';

interface NtsStatusAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTarget?: 'CUSTOMER' | 'VENDOR';
}

export const NtsStatusAuditModal: React.FC<NtsStatusAuditModalProps> = ({
  isOpen,
  onClose,
  initialTarget = 'CUSTOMER'
}) => {
  const { customers, vendors, assets, currentUser, saveCustomer, saveVendor, refreshAllData, showErrorModal } = useApp();

  const [targetType, setTargetType] = useState<'CUSTOMER' | 'VENDOR'>(initialTarget);
  const [filterType, setFilterType] = useState<'ALL' | 'CLOSED' | 'RENTED_RISK' | 'ACTIVE'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ processed: 0, total: 0 });
  const [scanResults, setScanResults] = useState<Map<string, NtsStatusResult>>(new Map());
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  // 1. 대상 목록 정제
  const targetItems = useMemo(() => {
    if (targetType === 'CUSTOMER') {
      return customers.map(c => {
        const cleanNo = (c.bizRegNo || '').replace(/[^0-9]/g, '');
        const rentedAssets = assets.filter(a => a.currentCustomerId === c.id && a.status === 'RENTED');
        const nts = scanResults.get(cleanNo);

        return {
          id: c.id,
          name: c.name,
          bizRegNo: c.bizRegNo,
          cleanNo,
          representative: c.representative,
          isClosed: c.isClosed,
          transactionStatus: c.transactionStatus,
          closedDate: c.closedDate,
          taxType: c.taxType,
          rentedCount: rentedAssets.length,
          rentedAssets,
          nts,
          rawEntity: c
        };
      });
    } else {
      return vendors.map(v => {
        const cleanNo = (v.bizRegNo || '').replace(/[^0-9]/g, '');
        const nts = scanResults.get(cleanNo);

        return {
          id: v.id,
          name: v.name,
          bizRegNo: v.bizRegNo,
          cleanNo,
          representative: v.representative,
          isClosed: !v.isActive,
          transactionStatus: v.isActive ? 'ALLOWED' : 'BLOCKED',
          closedDate: v.closedDate,
          taxType: v.taxType,
          rentedCount: 0,
          rentedAssets: [],
          nts,
          rawEntity: v
        };
      });
    }
  }, [targetType, customers, vendors, assets, scanResults]);

  // 2. 검색 및 필터링
  const filteredItems = useMemo(() => {
    return targetItems.filter(item => {
      const matchText = !searchTerm || 
        item.name.includes(searchTerm) || 
        item.cleanNo.includes(searchTerm) || 
        (item.representative || '').includes(searchTerm);

      if (!matchText) return false;

      const isNtsClosed = item.nts?.status === 'CLOSED' || (!item.nts && item.isClosed);
      const isRentedRisk = isNtsClosed && item.rentedCount > 0;

      if (filterType === 'CLOSED') return isNtsClosed;
      if (filterType === 'RENTED_RISK') return isRentedRisk;
      if (filterType === 'ACTIVE') return item.nts?.status === 'ACTIVE' || (!item.nts && !item.isClosed);
      return true;
    });
  }, [targetItems, searchTerm, filterType]);

  // 3. 상단 통계
  const stats = useMemo(() => {
    let active = 0;
    let closed = 0;
    let rentedRisk = 0;
    let suspended = 0;

    targetItems.forEach(item => {
      const status = item.nts?.status || (item.isClosed ? 'CLOSED' : 'ACTIVE');
      if (status === 'ACTIVE') active++;
      else if (status === 'CLOSED') {
        closed++;
        if (item.rentedCount > 0) rentedRisk++;
      } else if (status === 'SUSPENDED') {
        suspended++;
      }
    });

    return { total: targetItems.length, active, closed, rentedRisk, suspended };
  }, [targetItems]);

  // 4. 전수 점검 실행 (100건 단위 일괄 호출)
  const handleStartScan = async () => {
    if (isScanning) return;
    setIsScanning(true);

    const allBizNos = targetItems.map(i => i.cleanNo).filter(no => no.length === 10);
    setScanProgress({ processed: 0, total: allBizNos.length });

    try {
      const resultMap = await checkBatchNtsStatus(allBizNos, (processed, total) => {
        setScanProgress({ processed, total });
      });

      setScanResults(resultMap);
    } catch (err: any) {
      showErrorModal(`국세청 전수 상태 조회 중 오류: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  };

  // 5. 단건 폐업 조치 (출고차단 + 긴급 자산회수 ToDo 발행 + 감사로그)
  const handleApplySingleRestriction = async (item: typeof targetItems[0]) => {
    try {
      const closedDt = item.nts?.closedDate || item.closedDate || new Date().toISOString().slice(0, 10);
      const taxTp = item.nts?.taxType || item.taxType;

      if (targetType === 'CUSTOMER') {
        const cust = item.rawEntity as Customer;
        await saveCustomer({
          ...cust,
          isClosed: true,
          transactionStatus: 'BLOCKED',
          closedDate: closedDt,
          taxType: taxTp,
          businessStatus: 'CLOSED',
          lastStatusCheckDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        // 1) 사법 감사 로그 영구 기록
        db.insertRow<DelinquencyActionLog>('delinquencyActionLogs', {
          customerId: cust.id,
          actionType: 'LEGAL',
          actionDetails: `[국세청 전수점검] 폐업 확인(폐업일: ${closedDt})에 따른 직권 출고제한(BLOCKED) 조치 발효`,
          recordedBy: currentUser?.name || '시스템',
          mandateType: 'CEO_AUTO_MANDATE',
          createdAt: new Date().toISOString()
        });

        // 2) 가동 장비가 있는 경우 긴급 회수 ToDo 자동 발행
        if (item.rentedCount > 0) {
          db.insertRow<Todo>('todos', {
            userId: currentUser?.id || 'admin',
            targetType: 'DEPT',
            targetDept: '출고배차부',
            type: 'URGENT',
            priority: 'URGENT',
            title: `[🚨긴급] 폐업 고객사 가동장비 회수 지시: ${cust.name}`,
            content: `국세청 조회 결과 [${cust.name}]의 폐업(폐업일: ${closedDt})이 공식 확인되었습니다. 현재 현장에 투입된 ${item.rentedCount}대의 렌탈 자산에 대해 즉시 회수 배차 및 임대료 채권 회수를 집행하십시오.`,
            relatedEntityId: cust.id,
            isCompleted: false,
            createdAt: new Date().toISOString()
          });
        }
      } else {
        const vnd = item.rawEntity as Vendor;
        await saveVendor({
          ...vnd,
          isActive: false,
          closedDate: closedDt,
          taxType: taxTp,
          businessStatus: 'CLOSED',
          lastStatusCheckDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      await db.awaitPendingWrites();
      await refreshAllData();

      setAppliedIds(prev => new Set(prev).add(item.id));
    } catch (err: any) {
      showErrorModal(`상태 반영 실패: ${err?.message || err}`);
    }
  };

  // 6. 폐업 감지 전건 일괄 출고제한 및 회수 지시
  const handleApplyAllRestrictions = async () => {
    const closedItems = targetItems.filter(i => {
      const isNtsClosed = i.nts?.status === 'CLOSED';
      return isNtsClosed && !appliedIds.has(i.id);
    });

    if (closedItems.length === 0) return;

    for (const item of closedItems) {
      await handleApplySingleRestriction(item);
    }
  };

  // 7. 결과 엑셀 다운로드
  const handleExportExcel = () => {
    const excelData = targetItems.map((item, idx) => ({
      'No': idx + 1,
      '구분': targetType === 'CUSTOMER' ? '매출처(고객사)' : '매입처(협력사)',
      '거래처명': item.name,
      '사업자등록번호': formatBizNo(item.cleanNo),
      '대표자': item.representative || '-',
      '국세청상태': item.nts?.statusLabel || (item.isClosed ? '폐업자(ERP)' : '계속사업자'),
      '과세유형': item.nts?.taxType || item.taxType || '-',
      '폐업일자': item.nts?.closedDate || item.closedDate || '-',
      'ERP거래상태': item.transactionStatus === 'BLOCKED' ? '출고제한' : '정상거래',
      '가동장비수': item.rentedCount > 0 ? `${item.rentedCount}대 (위험)` : '0대',
      '최근조회일시': item.nts?.checkedAt?.slice(0, 16).replace('T', ' ') || '-'
    }));

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    exportToExcel(excelData, `국세청_휴폐업_전수점검결과_${dateStr}`, '전수점검');
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '1320px',
        height: '90vh',
        maxHeight: '900px',
        backgroundColor: 'var(--bg-card, #ffffff)',
        color: 'var(--text-main, #0f172a)',
        borderRadius: '12px',
        border: '1px solid var(--border-color, #cbd5e1)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* ─── ① 헤더 (Scope & Title) ─── */}
        <div style={{
          padding: '14px 20px',
          backgroundColor: 'var(--bg-secondary, #f8fafc)',
          borderBottom: '1px solid var(--border-color, #cbd5e1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Building2 size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-main, #0f172a)', whiteSpace: 'nowrap' }}>
                국세청 휴폐업 점검
              </h3>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose}
            disabled={isScanning}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              color: 'var(--text-muted, #64748b)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px'
            }}
            title="닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* ─── ② 조작 및 파이프라인 제어 바 (Gutenberg Z-Pattern) ─── */}
        <div style={{
          padding: '10px 20px',
          backgroundColor: 'var(--bg-card, #ffffff)',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          flexShrink: 0
        }}>
          {/* 좌상단: 대상 선택 및 필터 칩 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* 세그먼트 버튼: 매출처 / 매입처 */}
            <div style={{
              display: 'flex',
              padding: '2px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-secondary, #f1f5f9)',
              border: '1px solid var(--border-color, #cbd5e1)'
            }}>
              <button
                type="button"
                disabled={isScanning}
                onClick={() => setTargetType('CUSTOMER')}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: targetType === 'CUSTOMER' ? 700 : 500,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: isScanning ? 'not-allowed' : 'pointer',
                  backgroundColor: targetType === 'CUSTOMER' ? '#3b82f6' : 'transparent',
                  color: targetType === 'CUSTOMER' ? '#ffffff' : 'var(--text-secondary, #475569)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Building2 size={13} />
                매출처 ({customers.length})
              </button>
              <button
                type="button"
                disabled={isScanning}
                onClick={() => setTargetType('VENDOR')}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: targetType === 'VENDOR' ? 700 : 500,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: isScanning ? 'not-allowed' : 'pointer',
                  backgroundColor: targetType === 'VENDOR' ? '#10b981' : 'transparent',
                  color: targetType === 'VENDOR' ? '#ffffff' : 'var(--text-secondary, #475569)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Layers size={13} />
                매입처 ({vendors.length})
              </button>
            </div>

            {/* 필터 칩 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <button
                type="button"
                onClick={() => setFilterType('ALL')}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: filterType === 'ALL' ? 700 : 500,
                  borderRadius: '6px',
                  border: filterType === 'ALL' ? '1px solid #475569' : '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: filterType === 'ALL' ? '#334155' : 'transparent',
                  color: filterType === 'ALL' ? '#ffffff' : 'var(--text-secondary, #475569)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                전체 ({stats.total})
              </button>
              <button
                type="button"
                onClick={() => setFilterType('RENTED_RISK')}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: '1px solid #e11d48',
                  backgroundColor: filterType === 'RENTED_RISK' ? '#e11d48' : '#ffe4e6',
                  color: filterType === 'RENTED_RISK' ? '#ffffff' : '#be123c',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Truck size={13} />
                가동장비 위험 ({stats.rentedRisk})
              </button>
              <button
                type="button"
                onClick={() => setFilterType('CLOSED')}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: filterType === 'CLOSED' ? 700 : 500,
                  borderRadius: '6px',
                  border: '1px solid #f43f5e',
                  backgroundColor: filterType === 'CLOSED' ? '#f43f5e' : '#fff1f2',
                  color: filterType === 'CLOSED' ? '#ffffff' : '#e11d48',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                폐업 ({stats.closed})
              </button>
              <button
                type="button"
                onClick={() => setFilterType('ACTIVE')}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: filterType === 'ACTIVE' ? 700 : 500,
                  borderRadius: '6px',
                  border: '1px solid #10b981',
                  backgroundColor: filterType === 'ACTIVE' ? '#10b981' : '#ecfdf5',
                  color: filterType === 'ACTIVE' ? '#ffffff' : '#047857',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                정상 ({stats.active})
              </button>
            </div>
          </div>

          {/* 우상단: 검색창 및 실행 버튼군 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '8px', color: 'var(--text-muted, #94a3b8)' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="상호, 사업자번호 검색"
                style={{
                  width: '100%',
                  padding: '5px 8px 5px 28px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  outline: 'none'
                }}
              />
            </div>

            <button
              type="button"
              disabled={isScanning || targetItems.length === 0}
              onClick={handleStartScan}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                backgroundColor: isScanning ? '#94a3b8' : '#2563eb',
                color: '#ffffff',
                cursor: isScanning ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
                whiteSpace: 'nowrap'
              }}
            >
              <Play size={14} style={{ fill: '#ffffff' }} />
              {isScanning ? `점검 중 (${scanProgress.processed}/${scanProgress.total})` : '국세청 전수 점검 시작'}
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                border: '1px solid var(--border-color, #cbd5e1)',
                backgroundColor: 'var(--bg-secondary, #f8fafc)',
                color: 'var(--text-main, #0f172a)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap'
              }}
            >
              <Download size={14} color="#059669" />
              엑셀 내보내기
            </button>
          </div>
        </div>

        {/* ─── ③ 진행 HUD 요약 바 ─── */}
        <div style={{
          padding: '6px 20px',
          backgroundColor: 'var(--bg-secondary, #f1f5f9)',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          fontSize: '12px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--text-muted, #64748b)' }}>점검 대상:</span>
            <strong>{stats.total}개사</strong>
            {scanResults.size > 0 && (
              <span style={{ color: '#0284c7', fontWeight: 600 }}>
                (국세청 대사 완료: {scanResults.size}건)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#059669' }}>정상: <strong>{stats.active}</strong></span>
            <span style={{ color: '#d97706' }}>휴업: <strong>{stats.suspended}</strong></span>
            <span style={{ color: '#e11d48' }}>폐업: <strong>{stats.closed}</strong></span>
            {stats.rentedRisk > 0 && (
              <span style={{
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: '#e11d48',
                color: '#ffffff',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <AlertTriangle size={12} />
                가동장비 위험 {stats.rentedRisk}개사
              </span>
            )}
          </div>
        </div>

        {/* ─── ④ 고밀도 실시간 대사 그리드 테이블 ─── */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          backgroundColor: 'var(--bg-card, #ffffff)'
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '12px',
            textAlign: 'left'
          }}>
            <thead style={{
              position: 'sticky',
              top: 0,
              zIndex: 5,
              backgroundColor: 'var(--bg-secondary, #f8fafc)',
              borderBottom: '2px solid var(--border-color, #cbd5e1)',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
            }}>
              <tr style={{ height: '38px' }}>
                <th style={{ padding: '6px 10px', textAlign: 'center', width: '48px', whiteSpace: 'nowrap', fontWeight: 700 }}>No.</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>거래처명</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>사업자등록번호</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>대표자</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>국세청 공식 상태</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>과세유형</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>폐업일자</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>대여중 장비</th>
                <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>ERP 상태</th>
                <th style={{ padding: '6px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>조치</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                    조회 조건에 해당하는 거래처가 없습니다.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => {
                  const isNtsClosed = item.nts?.status === 'CLOSED';
                  const isNtsActive = item.nts?.status === 'ACTIVE';
                  const isNtsSuspended = item.nts?.status === 'SUSPENDED';
                  const hasRentedRisk = (isNtsClosed || item.isClosed) && item.rentedCount > 0;
                  const isAlreadyApplied = appliedIds.has(item.id) || item.transactionStatus === 'BLOCKED';

                  return (
                    <tr 
                      key={item.id}
                      style={{
                        height: '38px',
                        borderBottom: '1px solid var(--border-color, #e2e8f0)',
                        backgroundColor: hasRentedRisk ? '#fff1f2' : (idx % 2 === 1 ? 'var(--bg-secondary, #f8fafc)' : 'transparent')
                      }}
                    >
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {idx + 1}
                      </td>

                      <td style={{ padding: '6px 12px', fontWeight: 700, color: 'var(--text-main, #0f172a)', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name}
                      </td>

                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                        {formatBizNo(item.cleanNo)}
                      </td>

                      <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary, #475569)' }}>
                        {item.representative || '-'}
                      </td>

                      {/* 국세청 공식 상태 배지 */}
                      <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                        {isNtsClosed ? (
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: '#fee2e2',
                            border: '1px solid #fca5a5',
                            color: '#b91c1c',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}>
                            <AlertCircle size={12} /> 폐업자
                          </span>
                        ) : isNtsSuspended ? (
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: '#fef3c7',
                            border: '1px solid #fcd34d',
                            color: '#b45309',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}>
                            휴업자
                          </span>
                        ) : isNtsActive ? (
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: '#dcfce7',
                            border: '1px solid #86efac',
                            color: '#15803d',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}>
                            <CheckCircle2 size={12} /> 계속사업자
                          </span>
                        ) : (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            color: 'var(--text-muted, #94a3b8)',
                            backgroundColor: 'var(--bg-secondary, #f1f5f9)'
                          }}>
                            {item.isClosed ? '폐업(ERP)' : '미조회'}
                          </span>
                        )}
                      </td>

                      {/* 과세유형 */}
                      <td style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.nts?.taxType || item.taxType || '-'}
                      </td>

                      {/* 폐업일자 */}
                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                        {item.nts?.closedDate || item.closedDate || '-'}
                      </td>

                      {/* 가동 장비수 */}
                      <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                        {item.rentedCount > 0 ? (
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            backgroundColor: (isNtsClosed || item.isClosed) ? '#e11d48' : '#ecfdf5',
                            color: (isNtsClosed || item.isClosed) ? '#ffffff' : '#047857',
                            border: (isNtsClosed || item.isClosed) ? 'none' : '1px solid #a7f3d0',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <Truck size={12} /> {item.rentedCount}대 가동
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '11px', fontFamily: 'monospace' }}>0대</span>
                        )}
                      </td>

                      {/* ERP 거래상태 */}
                      <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                        {item.transactionStatus === 'BLOCKED' ? (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fca5a5'
                          }}>
                            출고제한
                          </span>
                        ) : (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            backgroundColor: '#ecfdf5',
                            color: '#047857',
                            border: '1px solid #a7f3d0'
                          }}>
                            정상거래
                          </span>
                        )}
                      </td>

                      {/* 원클릭 조치 버튼 */}
                      <td style={{ padding: '6px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isNtsClosed && !isAlreadyApplied ? (
                          <button
                            type="button"
                            onClick={() => handleApplySingleRestriction(item)}
                            style={{
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor: '#e11d48',
                              color: '#ffffff',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <ShieldAlert size={12} /> 출고제한/회수 지시
                          </button>
                        ) : isAlreadyApplied ? (
                          <span style={{ fontSize: '11px', color: '#059669', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <Check size={12} /> 조치완료
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted, #cbd5e1)', fontSize: '11px' }}>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ─── ⑤ 우하단 마감 바 (Terminal Action) ─── */}
        <div style={{
          padding: '12px 20px',
          backgroundColor: 'var(--bg-secondary, #f8fafc)',
          borderTop: '1px solid var(--border-color, #cbd5e1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #475569)' }}>
            총 <strong>{filteredItems.length}</strong>개사 표시
            {stats.rentedRisk > 0 && (
              <span style={{ color: '#e11d48', fontWeight: 800, marginLeft: '8px' }}>
                (가동장비 위험: {stats.rentedRisk}개사 즉시 회수 필요)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {stats.closed > 0 && (
              <button
                type="button"
                onClick={handleApplyAllRestrictions}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  backgroundColor: '#e11d48',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <ShieldAlert size={14} />
                폐업처 일괄 출고제한/회수 지시
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: 'var(--primary, #4f46e5)',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
