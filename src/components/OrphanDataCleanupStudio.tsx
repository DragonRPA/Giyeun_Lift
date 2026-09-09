// src/components/OrphanDataCleanupStudio.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { db } from '../services/db';
import {
  ShieldAlert,
  Trash2,
  RefreshCw,
  Search,
  CheckSquare,
  Square,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Truck,
  Wrench,
  Layers,
  CreditCard,
  Building2,
  MapPin,
  X,
  AlertCircle
} from 'lucide-react';

export type MismatchCategory =
  | 'ALL'
  | 'CONTRACT'
  | 'DELIVERY'
  | 'REPAIR'
  | 'CONTRACT_ASSET'
  | 'BILLING'
  | 'RECEIVABLE'
  | 'SITE_CONTACT';

export interface MismatchItem {
  id: string; // 레코드 고유 ID
  category: 'CONTRACT' | 'DELIVERY' | 'REPAIR' | 'CONTRACT_ASSET' | 'BILLING' | 'RECEIVABLE' | 'SITE_CONTACT';
  categoryLabel: string;
  tableKey: string; // 'contracts' | 'deliveries' | 'repairs' | 'contractAssets' | 'billings' | 'receivables' | 'sites' | 'contacts'
  targetId: string; // 식별 번호 또는 코드
  title: string; // 명칭 / 내용
  reason: string; // 불부합 원인
  extraInfo?: string; // 추가 정보 (금액, 일자 등)
  createdAt?: string; // 등록일시
  severity: 'HIGH' | 'MEDIUM';
}

export const OrphanDataCleanupStudio: React.FC = () => {
  const { fullRefreshFromServer } = useApp();

  const [items, setItems] = useState<MismatchItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<MismatchCategory>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number; message: string }>({
    current: 0,
    total: 0,
    message: ''
  });

  // 토스트 알림 상태 (헌장 5.2)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 확인 모달 상태
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    targetItems: MismatchItem[];
  } | null>(null);

  // ── 1. 불부합 데이터 실시간 스캔 (Audit Engine) ──
  const runScan = useCallback(() => {
    setIsScanning(true);
    try {
      const customers = db.customers || [];
      const contracts = db.contracts || [];
      const assets = db.assets || [];
      const contractAssets = db.contractAssets || [];
      const deliveries = db.deliveries || [];
      const repairs = db.repairs || [];
      const billings = db.billings || [];
      const receivables = db.receivables || [];
      const sites = db.sites || [];
      const contacts = db.contacts || [];

      const validCustIdMap = new Map(customers.map((c: any) => [c.id, c.name || c.companyName || '고객']));
      const validContractIdMap = new Map(contracts.map((c: any) => [c.id, c.contractNo || c.contractName || c.id]));
      const validAssetIdMap = new Map(assets.map((a: any) => [a.id, a.assetNo || a.modelName || a.id]));

      const detected: MismatchItem[] = [];

      // ① 고아 계약 (고객 참조 결손 또는 완전 허위 레코드)
      contracts.forEach((ct: any) => {
        const custId = ct.customerId;
        const hasBadCustomer = !custId || !validCustIdMap.has(custId);
        const isCompletelyEmpty = !ct.contractNo && !ct.customerId && !ct.startDate;

        if (hasBadCustomer || isCompletelyEmpty) {
          detected.push({
            id: ct.id,
            category: 'CONTRACT',
            categoryLabel: '고아 계약',
            tableKey: 'contracts',
            targetId: ct.contractNo || ct.id,
            title: ct.contractName || ct.customerName || '미지정 계약건',
            reason: isCompletelyEmpty
              ? '계약번호 및 고객 정보가 전무한 깡통 레코드'
              : `참조 고객 ID [${custId || '미입력'}] 고객 마스터 부재`,
            extraInfo: `계약기간: ${ct.startDate || '-'} ~ ${ct.endDate || '-'} | 대여료: ₩${(ct.rentalFee || 0).toLocaleString()}`,
            createdAt: ct.createdAt,
            severity: 'HIGH'
          });
        }
      });

      // ② 고아 배차 / 출고 / 회수 의뢰
      deliveries.forEach((d: any) => {
        const hasBadContract = d.contractId && !validContractIdMap.has(d.contractId);
        const hasBadCustomer = d.customerId && !validCustIdMap.has(d.customerId);
        const isCompletelyOrphan = !d.contractId && !d.customerId;

        if (hasBadContract || hasBadCustomer || isCompletelyOrphan) {
          let reason = '';
          if (isCompletelyOrphan) {
            reason = '계약 및 고객 참조 ID 둘 다 결손된 고아 의뢰';
          } else if (hasBadContract && hasBadCustomer) {
            reason = `계약 ID [${d.contractId}] 및 고객 ID [${d.customerId}] 모두 부재`;
          } else if (hasBadContract) {
            reason = `참조 계약 ID [${d.contractId}] 계약 대장 미존재`;
          } else {
            reason = `참조 고객 ID [${d.customerId}] 고객 마스터 미존재`;
          }

          const dType = d.deliveryType === 'OUTBOUND' ? '출고의뢰' : d.deliveryType === 'INBOUND' ? '회수의뢰' : d.deliveryType === 'EXCHANGE' ? '교환의뢰' : (d.deliveryType || '배차의뢰');
          detected.push({
            id: d.id,
            category: 'DELIVERY',
            categoryLabel: '고아 배차/출고 의뢰',
            tableKey: 'deliveries',
            targetId: d.deliveryNo || d.id,
            title: `[${dType}] ${d.siteName || d.address || '배차 대상 미지정'}`,
            reason,
            extraInfo: `의뢰일: ${d.deliveryDate || d.requestDate || '-'} | 상태: ${d.status || '-'} | 기사: ${d.driverName || '미배정'}`,
            createdAt: d.createdAt,
            severity: 'HIGH'
          });
        }
      });

      // ③ 고아 AS / 수리 의뢰
      repairs.forEach((r: any) => {
        const hasBadAsset = r.assetId && !validAssetIdMap.has(r.assetId);
        const hasBadContract = r.contractId && !validContractIdMap.has(r.contractId);
        const hasBadCustomer = r.customerId && !validCustIdMap.has(r.customerId);
        const isCompletelyOrphan = !r.assetId && !r.contractId && !r.customerId;

        if (hasBadAsset || hasBadContract || hasBadCustomer || isCompletelyOrphan) {
          const reasons: string[] = [];
          if (isCompletelyOrphan) reasons.push('자산/계약/고객 참조가 모두 누락됨');
          if (hasBadAsset) reasons.push(`참조 자산 ID [${r.assetId}] 자산 대장 미존재`);
          if (hasBadContract) reasons.push(`참조 계약 ID [${r.contractId}] 미존재`);
          if (hasBadCustomer) reasons.push(`참조 고객 ID [${r.customerId}] 미존재`);

          detected.push({
            id: r.id,
            category: 'REPAIR',
            categoryLabel: '고아 AS/정비 의뢰',
            tableKey: 'repairs',
            targetId: r.repairNo || r.ticketNo || r.id,
            title: `[${r.repairType || '정비'}] ${r.issue || r.actionTaken || '고장 내용 미기재'}`,
            reason: reasons.join(' / '),
            extraInfo: `접수일: ${r.repairDate || r.requestDate || '-'} | 정비사: ${r.mechanicName || '미지정'} | 상태: ${r.status || '-'}`,
            createdAt: r.createdAt,
            severity: 'HIGH'
          });
        }
      });

      // ④ 고아 계약자산 매핑
      contractAssets.forEach((ca: any) => {
        const hasBadContract = !ca.contractId || !validContractIdMap.has(ca.contractId);
        const hasBadAsset = !ca.assetId || !validAssetIdMap.has(ca.assetId);

        if (hasBadContract || hasBadAsset) {
          let reason = '';
          if (hasBadContract && hasBadAsset) {
            reason = `계약 ID [${ca.contractId || '미입력'}] 및 자산 ID [${ca.assetId || '미입력'}] 모두 부재`;
          } else if (hasBadContract) {
            reason = `연결된 계약 ID [${ca.contractId}] 계약 대장 미존재`;
          } else {
            reason = `연결된 자산 ID [${ca.assetId}] 자산 대장 미존재`;
          }

          detected.push({
            id: ca.id,
            category: 'CONTRACT_ASSET',
            categoryLabel: '고아 계약자산 매핑',
            tableKey: 'contractAssets',
            targetId: ca.id,
            title: `자산 [${ca.assetNo || ca.assetId || '-'}] ➔ 계약 [${ca.contractId || '-'}]`,
            reason,
            extraInfo: `상태: ${ca.status || '-'} | 투입일: ${ca.startDate || '-'}`,
            createdAt: ca.createdAt,
            severity: 'MEDIUM'
          });
        }
      });

      // ⑤ 고아 청구서
      billings.forEach((b: any) => {
        const hasBadCustomer = !b.customerId || !validCustIdMap.has(b.customerId);
        const hasBadContract = b.contractId && !validContractIdMap.has(b.contractId);

        if (hasBadCustomer || hasBadContract) {
          detected.push({
            id: b.id,
            category: 'BILLING',
            categoryLabel: '고아 청구서',
            tableKey: 'billings',
            targetId: b.billingNo || b.id,
            title: `${b.billingYm || ''} 청구서 (공급가: ₩${(b.totalSupply || 0).toLocaleString()})`,
            reason: hasBadCustomer
              ? `청구 대상 고객 ID [${b.customerId || '미입력'}] 고객 마스터 미존재`
              : `연동된 계약 ID [${b.contractId}] 계약 대장 미존재`,
            extraInfo: `청구일: ${b.billingDate || '-'} | 합계: ₩${((b.totalSupply || 0) + (b.totalVat || 0)).toLocaleString()} | 입금상태: ${b.status || '-'}`,
            createdAt: b.createdAt,
            severity: 'HIGH'
          });
        }
      });

      // ⑥ 고아 외상미수금
      receivables.forEach((r: any) => {
        const hasBadCustomer = !r.customerId || !validCustIdMap.has(r.customerId);

        if (hasBadCustomer) {
          detected.push({
            id: r.id,
            category: 'RECEIVABLE',
            categoryLabel: '고아 외상미수금',
            tableKey: 'receivables',
            targetId: r.id,
            title: `${r.description || '외상미수금'} (₩${(r.amount || 0).toLocaleString()})`,
            reason: `미수 대상 고객 ID [${r.customerId || '미입력'}] 고객 마스터 미존재`,
            extraInfo: `발생일: ${r.occurredDate || '-'} | 잔액: ₩${((r.amount || 0) - (r.billedAmount || 0)).toLocaleString()}`,
            createdAt: r.createdAt,
            severity: 'HIGH'
          });
        }
      });

      // ⑦ 고아 고객 현장 및 담당자
      sites.forEach((s: any) => {
        if (s.customerId && !validCustIdMap.has(s.customerId)) {
          detected.push({
            id: s.id,
            category: 'SITE_CONTACT',
            categoryLabel: '고아 현장/담당자',
            tableKey: 'sites',
            targetId: s.id,
            title: `[현장] ${s.siteName || s.name || '현장'}`,
            reason: `소속 고객 ID [${s.customerId}] 고객 마스터 미존재`,
            extraInfo: `주소: ${s.address || '-'}`,
            createdAt: s.createdAt,
            severity: 'MEDIUM'
          });
        }
      });

      contacts.forEach((ct: any) => {
        if (ct.customerId && !validCustIdMap.has(ct.customerId)) {
          detected.push({
            id: ct.id,
            category: 'SITE_CONTACT',
            categoryLabel: '고아 현장/담당자',
            tableKey: 'contacts',
            targetId: ct.id,
            title: `[담당자] ${ct.name || '담당자'} (${ct.phone || ct.mobile || '-'})`,
            reason: `소속 고객 ID [${ct.customerId}] 고객 마스터 미존재`,
            extraInfo: `직책: ${ct.position || '-'} | 부서: ${ct.department || '-'}`,
            createdAt: ct.createdAt,
            severity: 'MEDIUM'
          });
        }
      });

      setItems(detected);
      setSelectedIds(new Set());
    } catch (err: any) {
      console.error('Scan failed:', err);
      showToast(`데이터 감사 스캔 중 오류가 발생했습니다: ${err.message || err}`, 'error');
    } finally {
      setIsScanning(false);
    }
  }, []);

  // 최초 진입 시 자동 1회 스캔 실행
  useEffect(() => {
    runScan();
  }, [runScan]);

  // ── 2. 통계 집계 ──
  const counts = useMemo(() => {
    const summary: Record<MismatchCategory, number> = {
      ALL: items.length,
      CONTRACT: 0,
      DELIVERY: 0,
      REPAIR: 0,
      CONTRACT_ASSET: 0,
      BILLING: 0,
      RECEIVABLE: 0,
      SITE_CONTACT: 0
    };
    items.forEach(item => {
      summary[item.category] = (summary[item.category] || 0) + 1;
    });
    return summary;
  }, [items]);

  // ── 3. 필터 및 검색 적용 ──
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matchTarget = (item.targetId || '').toLowerCase().includes(q);
        const matchTitle = (item.title || '').toLowerCase().includes(q);
        const matchReason = (item.reason || '').toLowerCase().includes(q);
        const matchExtra = (item.extraInfo || '').toLowerCase().includes(q);
        return matchTarget || matchTitle || matchReason || matchExtra;
      }
      return true;
    });
  }, [items, categoryFilter, searchTerm]);

  // ── 4. 선택 관리 ──
  const isAllSelected = useMemo(() => {
    if (filteredItems.length === 0) return false;
    return filteredItems.every(i => selectedIds.has(i.id));
  }, [filteredItems, selectedIds]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const next = new Set(selectedIds);
      filteredItems.forEach(i => next.delete(i.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filteredItems.forEach(i => next.add(i.id));
      setSelectedIds(next);
    }
  };

  const handleToggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // ── 5. 안전 삭제 실행 엔진 (헌장 5.2 준수: await db.awaitPendingWrites) ──
  const executeDelete = async (targets: MismatchItem[]) => {
    if (targets.length === 0) return;
    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: targets.length, message: '불부합 레코드 안전 삭제 준비 중...' });

    try {
      let deletedCount = 0;
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        setDeleteProgress({
          current: i + 1,
          total: targets.length,
          message: `[${i + 1}/${targets.length}] ${target.categoryLabel} (${target.targetId}) 삭제 처리 중...`
        });

        // db.deleteRow 호출 (Supabase 및 로컬 스토리지 동기 삭제 큐 주입)
        db.deleteRow(target.tableKey, target.id);
        deletedCount++;
      }

      setDeleteProgress({
        current: targets.length,
        total: targets.length,
        message: 'Supabase 원격 데이터베이스 비동기 쓰기 큐 완결 대기 중 (헌장 5.2)...'
      });

      // 헌장 5.2 전 스토리지/DB 저장 성공 검증 및 무음 실패 방지
      await db.awaitPendingWrites();

      // 전역 상태 동기화
      if (fullRefreshFromServer) {
        await fullRefreshFromServer();
      }

      showToast(`총 ${deletedCount}건의 불부합 데이터가 안전하게 정리(삭제)되었습니다.`, 'success');
      setConfirmModal(null);
      runScan();
    } catch (err: any) {
      console.error('Delete execution failed:', err);
      showToast(`데이터 정리 중 오류가 발생했습니다: ${err.message || err}`, 'error');
    } finally {
      setIsDeleting(false);
      setDeleteProgress({ current: 0, total: 0, message: '' });
    }
  };

  // 모달 트리거 헬퍼
  const promptDeleteSingle = (item: MismatchItem) => {
    setConfirmModal({
      isOpen: true,
      title: '단건 불부합 데이터 삭제',
      description: `[${item.categoryLabel}] "${item.title}" (${item.targetId}) 레코드를 영구 삭제하시겠습니까?`,
      targetItems: [item]
    });
  };

  const promptDeleteSelected = () => {
    const targets = filteredItems.filter(i => selectedIds.has(i.id));
    if (targets.length === 0) {
      showToast('선택된 항목이 없습니다.', 'warning');
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: '선택 항목 일괄 삭제',
      description: `현재 선택된 ${targets.length}건의 불부합 데이터를 데이터베이스에서 영구 삭제하시겠습니까?`,
      targetItems: targets
    });
  };

  const promptDeleteCategory = () => {
    if (filteredItems.length === 0) {
      showToast('정리할 대상 데이터가 없습니다.', 'warning');
      return;
    }
    const catName = categoryFilter === 'ALL' ? '전체 불부합 데이터' : filteredItems[0]?.categoryLabel || '해당 카테고리';
    setConfirmModal({
      isOpen: true,
      title: `${catName} 일괄 삭제`,
      description: `현재 필터링된 ${filteredItems.length}건의 ${catName}를 데이터베이스에서 일괄 영구 삭제하시겠습니까?`,
      targetItems: filteredItems
    });
  };

  const promptDeleteAll = () => {
    if (items.length === 0) {
      showToast('정리할 불부합 데이터가 없습니다.', 'warning');
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: '전체 불부합 데이터 전수 일괄 정리',
      description: `시스템에서 탐지된 모든 불부합 데이터 총 ${items.length}건을 일괄 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      targetItems: items
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* ── 1. 상단 개요 카드 ── */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldAlert size={22} color="#ef4444" />
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                불부합 데이터 조회 및 정리
              </h2>
            </div>
            <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              고객/계약/자산 마스터가 유실되었거나 참조 무결성이 결손된 고아 계약, 고아 배차·AS 의뢰, 매핑 레코드를 전수 탐지하여 안전하게 일괄 정리합니다.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={runScan}
              disabled={isScanning || isDeleting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text-main)',
                cursor: (isScanning || isDeleting) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <RefreshCw size={15} className={isScanning ? 'animate-spin' : ''} />
              스캔 실행
            </button>

            {items.length > 0 && (
              <button
                onClick={promptDeleteAll}
                disabled={isScanning || isDeleting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: (isScanning || isDeleting) ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)'
                }}
              >
                <Trash2 size={15} />
                전체 불부합 일괄 정리 ({items.length}건)
              </button>
            )}
          </div>
        </div>

        {/* ── 2. 통계 지표 카드 덱 (8종) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginTop: '16px' }}>
          {[
            { cat: 'ALL' as const, label: '총 불부합', count: counts.ALL, icon: <AlertTriangle size={15} />, color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' },
            { cat: 'CONTRACT' as const, label: '고아 계약', count: counts.CONTRACT, icon: <FileText size={15} />, color: '#ea580c', bg: 'rgba(234, 88, 12, 0.08)' },
            { cat: 'DELIVERY' as const, label: '배차/출고 의뢰', count: counts.DELIVERY, icon: <Truck size={15} />, color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' },
            { cat: 'REPAIR' as const, label: 'AS/정비 의뢰', count: counts.REPAIR, icon: <Wrench size={15} />, color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' },
            { cat: 'CONTRACT_ASSET' as const, label: '계약자산 매핑', count: counts.CONTRACT_ASSET, icon: <Layers size={15} />, color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.08)' },
            { cat: 'BILLING' as const, label: '고아 청구서', count: counts.BILLING, icon: <CreditCard size={15} />, color: '#0284c7', bg: 'rgba(2, 132, 199, 0.08)' },
            { cat: 'RECEIVABLE' as const, label: '외상미수금', count: counts.RECEIVABLE, icon: <CreditCard size={15} />, color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
            { cat: 'SITE_CONTACT' as const, label: '현장/담당자', count: counts.SITE_CONTACT, icon: <Building2 size={15} />, color: '#64748b', bg: 'rgba(100, 116, 139, 0.08)' }
          ].map(stat => {
            const isActive = categoryFilter === stat.cat;
            return (
              <div
                key={stat.cat}
                onClick={() => setCategoryFilter(stat.cat)}
                style={{
                  padding: '12px',
                  borderRadius: '6px',
                  border: isActive ? `2px solid ${stat.color}` : '1px solid var(--border-color)',
                  backgroundColor: isActive ? stat.bg : 'var(--bg-surface)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {stat.label}
                  </span>
                  <span style={{ color: stat.color }}>{stat.icon}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: stat.count > 0 ? stat.color : 'var(--text-main)', whiteSpace: 'nowrap' }}>
                    {stat.count.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>건</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 3. 본문 툴바 및 필터 패널 ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        
        {/* 검색 및 필터 정보 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '260px' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '360px' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="식별번호, 대상명칭, 불부합 원인 검색..."
              style={{
                width: '100%',
                padding: '8px 12px 8px 34px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-main)',
                fontSize: '13px'
              }}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            조회 {filteredItems.length}건 / 선택 {selectedIds.size}건
          </span>
        </div>

        {/* 액션 버튼군 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {selectedIds.size > 0 && (
            <button
              onClick={promptDeleteSelected}
              disabled={isDeleting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                backgroundColor: '#ef4444',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: isDeleting ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <Trash2 size={14} />
              선택 항목 삭제 ({selectedIds.size}건)
            </button>
          )}

          {filteredItems.length > 0 && (
            <button
              onClick={promptDeleteCategory}
              disabled={isDeleting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid #fca5a5',
                color: '#b91c1c',
                borderRadius: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: isDeleting ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <Trash2 size={14} />
              현재 목록 일괄 삭제 ({filteredItems.length}건)
            </button>
          )}
        </div>
      </div>

      {/* ── 4. 불부합 상세 대사 그리드 ── */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '950px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '10px 14px', width: '44px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                <button
                  onClick={handleToggleSelectAll}
                  disabled={filteredItems.length === 0}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  {isAllSelected ? <CheckSquare size={16} color="#2563eb" /> : <Square size={16} color="var(--text-muted)" />}
                </button>
              </th>
              <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '120px' }}>유형</th>
              <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '150px' }}>식별 번호/ID</th>
              <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', minWidth: '220px' }}>대상 명칭 / 정보</th>
              <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', minWidth: '260px' }}>불부합 상세 원인</th>
              <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '200px' }}>부가 정보</th>
              <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '120px' }}>등록일시</th>
              <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '70px', textAlign: 'center' }}>조치</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '48px 20px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                    <CheckCircle2 size={36} color="#16a34a" />
                    <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
                      불부합 데이터가 존재하지 않습니다.
                    </span>
                    <span style={{ fontSize: '12.5px' }}>
                      모든 계약, 배차 의뢰, AS 의뢰, 청구서의 참조 무결성이 정상입니다.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              filteredItems.map(item => {
                const isChecked = selectedIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      backgroundColor: isChecked ? 'rgba(37, 99, 235, 0.05)' : 'transparent'
                    }}
                  >
                    <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleToggleSelectOne(item.id)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                      >
                        {isChecked ? <CheckSquare size={16} color="#2563eb" /> : <Square size={16} color="var(--text-muted)" />}
                      </button>
                    </td>

                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          backgroundColor:
                            item.category === 'CONTRACT' ? 'rgba(234, 88, 12, 0.15)' :
                            item.category === 'DELIVERY' ? 'rgba(37, 99, 235, 0.15)' :
                            item.category === 'REPAIR' ? 'rgba(22, 163, 74, 0.15)' :
                            item.category === 'CONTRACT_ASSET' ? 'rgba(124, 58, 237, 0.15)' :
                            item.category === 'BILLING' ? 'rgba(2, 132, 199, 0.15)' :
                            item.category === 'RECEIVABLE' ? 'rgba(217, 119, 6, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                          color:
                            item.category === 'CONTRACT' ? '#ea580c' :
                            item.category === 'DELIVERY' ? '#2563eb' :
                            item.category === 'REPAIR' ? '#16a34a' :
                            item.category === 'CONTRACT_ASSET' ? '#7c3aed' :
                            item.category === 'BILLING' ? '#0284c7' :
                            item.category === 'RECEIVABLE' ? '#d97706' : '#64748b'
                        }}
                      >
                        {item.categoryLabel}
                      </span>
                    </td>

                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600 }}>
                      {item.targetId}
                    </td>

                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text-main)' }}>
                      {item.title}
                    </td>

                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontWeight: 600, fontSize: '12px' }}>
                        <AlertCircle size={13} />
                        {item.reason}
                      </span>
                    </td>

                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {item.extraInfo || '-'}
                    </td>

                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {item.createdAt ? item.createdAt.substring(0, 16).replace('T', ' ') : '-'}
                    </td>

                    <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => promptDeleteSingle(item)}
                        disabled={isDeleting}
                        title="단건 삭제"
                        style={{
                          padding: '4px 8px',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          borderRadius: '4px',
                          cursor: isDeleting ? 'not-allowed' : 'pointer',
                          fontSize: '11px',
                          fontWeight: 600
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── 5. 진행 중 프로그레스 바 ── */}
      {isDeleting && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', backgroundColor: 'var(--bg-card)', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--border-color)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 9999, minWidth: '320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <RefreshCw size={18} className="animate-spin" color="#2563eb" />
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-main)' }}>
              불부합 데이터 정리 중...
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            {deleteProgress.message}
          </div>
          <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--bg-main)', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                backgroundColor: '#2563eb',
                width: `${deleteProgress.total ? (deleteProgress.current / deleteProgress.total) * 100 : 0}%`,
                transition: 'width 0.2s ease'
              }}
            />
          </div>
        </div>
      )}

      {/* ── 6. 확인 다이얼로그 모달 ── */}
      {confirmModal?.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '10px', maxWidth: '520px', width: '100%', padding: '24px', boxShadow: '0 12px 32px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={20} color="#dc2626" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-main)' }}>
                  {confirmModal.title}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  영구 삭제 대상: 총 {confirmModal.targetItems.length}건
                </span>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-main)', lineHeight: 1.5 }}>
              {confirmModal.description}
            </p>

            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px', fontSize: '12px', color: '#b91c1c' }}>
              ⚠️ 본 작업은 선택된 불부합 레코드를 데이터베이스에서 완전히 삭제하며, 삭제 즉시 원격 Supabase DB 쓰기 큐를 완결 동기화합니다.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <button
                onClick={() => setConfirmModal(null)}
                disabled={isDeleting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                취소
              </button>

              <button
                onClick={() => executeDelete(confirmModal.targetItems)}
                disabled={isDeleting}
                style={{
                  padding: '8px 18px',
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                영구 삭제 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. 토스트 알림 배너 (헌장 5.2) ── */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            padding: '12px 20px',
            borderRadius: '8px',
            backgroundColor:
              toastMessage.type === 'success' ? '#059669' :
              toastMessage.type === 'error' ? '#dc2626' : '#d97706',
            color: '#ffffff',
            fontSize: '13.5px',
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            whiteSpace: 'nowrap'
          }}
        >
          {toastMessage.type === 'success' && <CheckCircle2 size={16} />}
          {toastMessage.type === 'error' && <AlertTriangle size={16} />}
          {toastMessage.type === 'warning' && <AlertCircle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
};
