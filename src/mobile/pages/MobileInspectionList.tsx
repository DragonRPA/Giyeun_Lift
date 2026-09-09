import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { CameraUploader } from '../components/CameraUploader';
import { db, OutboundInspection, Asset, AssetInOutLog, STANDARD_SPECS } from '../../services/db';
import { 
  CheckSquare, 
  Check, 
  ShieldCheck, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  AlertTriangle, 
  ArrowLeft, 
  Search, 
  X, 
  Repeat, 
  Ban, 
  Truck, 
  Phone, 
  Calendar, 
  RotateCcw,
  Sparkles,
  FileText
} from 'lucide-react';

function isModelMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const cleanA = a.replace(/[-\s]/g, '').toUpperCase();
  const cleanB = b.replace(/[-\s]/g, '').toUpperCase();
  return cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

function getDDay(dateStr?: string): { text: string; color: string; isOverdue: boolean } {
  if (!dateStr) return { text: '-', color: 'text-slate-400 bg-slate-800 border-slate-700', isOverdue: false };
  const today = new Date().toISOString().split('T')[0];
  const diffDays = Math.ceil((new Date(dateStr).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { text: `지연 D+${Math.abs(diffDays)}`, color: 'text-red-300 bg-red-950/60 border-red-500/50', isOverdue: true };
  if (diffDays === 0) return { text: '오늘상차 D-0', color: 'text-amber-300 bg-amber-950/60 border-amber-500/50', isOverdue: false };
  return { text: `D-${diffDays}`, color: 'text-slate-300 bg-slate-800 border-slate-700', isOverdue: false };
}

function getInspectionCheckpoints(
  oin: OutboundInspection,
  contracts: any[],
  contractAssets: any[],
  sites: any[],
  customers: any[],
  assets: any[]
) {
  const contract = contracts.find(c => c.id === oin.contractId);
  const contractAsset = contractAssets.find(ca => ca.id === oin.contractAssetId);
  const site = contract?.siteId ? sites.find(s => s.id === contract.siteId) : undefined;
  const customer = contract?.customerId ? customers.find(c => c.id === contract.customerId) : undefined;
  const asset = assets.find(a => a.id === oin.assetId);

  const checkpoints: { id: string; label: string; type: 'MODEL' | 'SPEC' | 'OPTION' | 'NOTE' }[] = [];

  // 1. 모델 일치 확인 (항상 포함)
  if (contractAsset?.expectedModel) {
    checkpoints.push({
      id: 'model_match',
      label: `장비 모델 확인: 계약 요구 [${contractAsset.expectedModel}] ↔ 실출고 [${asset?.modelName || '미배정'}]`,
      type: 'MODEL'
    });
  }

  // 2. 현장 또는 고객사의 요구 사양 중 true인 항목만 추가
  const specMap: Record<string, boolean> = {
    ...(customer?.defaultCheckedSpecs || {}),
    ...(site?.checkedSpecs || {})
  };
  STANDARD_SPECS.forEach(spec => {
    if (specMap[spec.id] === true) {
      checkpoints.push({ id: spec.id, label: spec.label, type: 'SPEC' });
    }
  });

  // 3. 유상 옵션 (텍스트 기반)
  const paidOpts = site?.paidOptions || customer?.defaultPaidOptions || '';
  if (typeof paidOpts === 'string' && paidOpts.trim()) {
    paidOpts.split(/[,，、\n]/).map((o: string) => o.trim()).filter(Boolean).forEach((opt: string, i: number) => {
      checkpoints.push({ id: `paid_${i}`, label: `[옵션] ${opt} 장착 확인`, type: 'OPTION' });
    });
  }

  // 4. 특이사항 메모
  const specialNote = site?.memo || customer?.specialNotes || '';

  return { checkpoints, specialNote, asset, contract, contractAsset, site, customer };
}

export const MobileInspectionList: React.FC = () => {
  const { 
    outboundInspections, 
    assets, 
    contracts, 
    customers, 
    sites, 
    contractAssets, 
    deliveries, 
    currentUser, 
    contractHistory,
    exchangeOutboundAsset,
    refreshAllData, 
    showErrorModal 
  } = useApp();
  
  // ── 탭 및 필터 상태 ──
  const [activeTab, setActiveTab] = useState<'PENDING' | 'COMPLETED'>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'TOMORROW' | 'WEEK'>('ALL');
  const [exchangeOnly, setExchangeOnly] = useState(false);

  // ── 상세 스튜디오 및 조작 상태 ──
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [assetCheckedList, setAssetCheckedList] = useState<Record<string, Record<string, boolean>>>({});
  const [assetPhotos, setAssetPhotos] = useState<Record<string, string[]>>({});
  const [assetNotes, setAssetNotes] = useState<Record<string, string>>({});
  const [expandedAssetIds, setExpandedAssetIds] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState('');

  // ── 장비 교체(스왑) 모달 상태 ──
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapTargetOin, setSwapTargetOin] = useState<OutboundInspection | null>(null);
  const [swapTargetAsset, setSwapTargetAsset] = useState<Asset | null>(null);
  const [selectedNewAssetId, setSelectedNewAssetId] = useState('');
  const [swapReason, setSwapReason] = useState('시동 불능');
  const [swapPenalty, setSwapPenalty] = useState(5);
  const [swapSearchQuery, setSwapSearchQuery] = useState('');

  // ── 출고 반려 모달 상태 ──
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // ── 날짜 계산 헬퍼 ──
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);
  const weekEndStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  }, []);

  // ── 대차/교체 계약 ID 목록 ──
  const exchangeContractIds = useMemo(() => {
    return new Set(
      (contractHistory || [])
        .filter(h => h.changeType === 'EXCHANGE')
        .map(h => h.contractId)
    );
  }, [contractHistory]);

  // ── 검수의뢰 그룹핑 (대기 / 완료) ──
  const allGroups = useMemo(() => {
    const map = new Map<string, OutboundInspection[]>();
    
    outboundInspections.forEach(ins => {
      // 고아 레코드 가드: 유효 계약 없는 건 제외
      if (contracts.length > 0 && (!ins.contractId || !contracts.some(c => c.id === ins.contractId))) {
        return;
      }
      const key = ins.deliveryId || `no-delivery-${ins.contractId || ins.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ins);
    });

    const pendingMap: Record<string, OutboundInspection[]> = {};
    const completedMap: Record<string, OutboundInspection[]> = {};

    map.forEach((items, key) => {
      const hasPending = items.some(i => i.status === 'PENDING' || i.status === 'IN_PROGRESS');
      if (hasPending) {
        pendingMap[key] = items.filter(i => i.status === 'PENDING' || i.status === 'IN_PROGRESS');
      } else if (items.every(i => i.status === 'COMPLETED')) {
        completedMap[key] = items;
      }
    });

    return { pending: pendingMap, completed: completedMap };
  }, [outboundInspections, contracts]);

  // ── 필터링된 그룹 목록 ──
  const filteredGroupEntries = useMemo(() => {
    const sourceMap = activeTab === 'PENDING' ? allGroups.pending : allGroups.completed;
    const entries = Object.entries(sourceMap);

    return entries.filter(([groupId, insList]) => {
      const first = insList[0];
      const contract = contracts.find(c => c.id === first.contractId);
      const customer = contract ? customers.find(c => c.id === contract.customerId) : undefined;
      const site = contract ? sites.find(s => s.id === contract.siteId) : undefined;
      const delivery = deliveries.find(d => d.id === first.deliveryId);

      const isExchange = contract ? exchangeContractIds.has(contract.id) : false;
      if (exchangeOnly && !isExchange) return false;

      // 상차일자 판별
      const loadingDate = delivery?.loadingDate || delivery?.scheduledDate || contract?.startDate || first.createdAt.slice(0, 10);

      // 날짜 프리셋 필터 (대기 탭일 때만)
      if (activeTab === 'PENDING' && dateFilter !== 'ALL') {
        if (dateFilter === 'TODAY' && loadingDate !== todayStr) return false;
        if (dateFilter === 'TOMORROW' && loadingDate !== tomorrowStr) return false;
        if (dateFilter === 'WEEK' && (loadingDate < todayStr || loadingDate > weekEndStr)) return false;
      }

      // 검색어 필터
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const custName = (customer?.name || '').toLowerCase();
        const sName = (site?.name || '').toLowerCase();
        const cNo = (contract?.contractNo || '').toLowerCase();
        const dNo = (delivery?.id || '').toLowerCase();
        const driver = (delivery?.driverName || '').toLowerCase();
        const hasAssetMatch = insList.some(i => {
          const a = assets.find(x => x.id === i.assetId);
          return a && (a.assetNo.toLowerCase().includes(q) || a.modelName.toLowerCase().includes(q));
        });

        if (!custName.includes(q) && !sName.includes(q) && !cNo.includes(q) && !dNo.includes(q) && !driver.includes(q) && !hasAssetMatch) {
          return false;
        }
      }

      return true;
    }).sort(([aId, aList], [bId, bList]) => {
      // 대차/교체 최우선 ➔ 날짜 오름차순
      const firstA = aList[0];
      const firstB = bList[0];
      const exA = firstA.contractId && exchangeContractIds.has(firstA.contractId) ? 1 : 0;
      const exB = firstB.contractId && exchangeContractIds.has(firstB.contractId) ? 1 : 0;
      if (exA !== exB) return exB - exA;

      const delA = deliveries.find(d => d.id === firstA.deliveryId);
      const delB = deliveries.find(d => d.id === firstB.deliveryId);
      const dateA = delA?.loadingDate || firstA.createdAt;
      const dateB = delB?.loadingDate || firstB.createdAt;
      return dateA.localeCompare(dateB);
    });
  }, [allGroups, activeTab, contracts, customers, sites, deliveries, exchangeContractIds, exchangeOnly, dateFilter, searchQuery, todayStr, tomorrowStr, weekEndStr, assets]);

  const activeGroup = useMemo(() => {
    if (!selectedGroupId) return [];
    const sourceMap = activeTab === 'PENDING' ? allGroups.pending : allGroups.completed;
    return sourceMap[selectedGroupId] || [];
  }, [selectedGroupId, allGroups, activeTab]);

  // ── 그룹 선택 시 초기 펼침 처리 (단일 자산이면 자동 펼침) ──
  const handleSelectGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    const sourceMap = activeTab === 'PENDING' ? allGroups.pending : allGroups.completed;
    const items = sourceMap[groupId] || [];
    if (items.length === 1) {
      setExpandedAssetIds({ [items[0].id]: true });
    } else if (items.length > 1) {
      setExpandedAssetIds({ [items[0].id]: true });
    }
  };

  // ── 체크포인트 토글 ──
  const handleToggleCheck = (oinId: string, itemId: string) => {
    setAssetCheckedList(prev => {
      const prevChecks = prev[oinId] || {};
      return {
        ...prev,
        [oinId]: { ...prevChecks, [itemId]: !prevChecks[itemId] }
      };
    });
  };

  // ── 1-Touch 전 항목 일괄 확인 (단일 자산) ──
  const handleCheckAllForAsset = (oin: OutboundInspection) => {
    const { checkpoints } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
    const newMap: Record<string, boolean> = {};
    checkpoints.forEach(cp => {
      newMap[cp.id] = true;
    });
    setAssetCheckedList(prev => ({
      ...prev,
      [oin.id]: newMap
    }));
  };

  // ── 1-Touch 전 항목 해제 (단일 자산) ──
  const handleUncheckAllForAsset = (oin: OutboundInspection) => {
    setAssetCheckedList(prev => ({
      ...prev,
      [oin.id]: {}
    }));
  };

  // ── 1-Touch 전체 장비 전 항목 일괄 확인 (그룹 전체) ──
  const handleCheckAllForGroup = () => {
    const updated: Record<string, Record<string, boolean>> = { ...assetCheckedList };
    activeGroup.forEach(oin => {
      const { checkpoints } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
      const newMap: Record<string, boolean> = {};
      checkpoints.forEach(cp => {
        newMap[cp.id] = true;
      });
      updated[oin.id] = newMap;
    });
    setAssetCheckedList(updated);
  };

  // ── 빠른 메모 칩 추가 ──
  const handleAppendMemoChip = (oinId: string, chipText: string) => {
    setAssetNotes(prev => {
      const cur = prev[oinId] || '';
      return {
        ...prev,
        [oinId]: cur ? `${cur} / ${chipText}` : chipText
      };
    });
  };

  // ── 단일 장비 승인 ──
  const handleApproveSingle = async (oin: OutboundInspection) => {
    const { checkpoints, asset, contract, site, customer } = getInspectionCheckpoints(
      oin, contracts, contractAssets, sites, customers, assets
    );

    if (customer && (customer as any).transactionStatus === 'BLOCKED') {
      showErrorModal(`[출고제한] 거래차단(BLOCKED) 고객사(${customer.name}) 장비는 출고 승인할 수 없습니다.`);
      return;
    }

    const checked = assetCheckedList[oin.id] || {};
    const checkedCount = Object.values(checked).filter(Boolean).length;
    
    if (checkpoints.length > 0 && checkedCount === 0) {
      showErrorModal('요구 사양 항목을 최소 1개 이상 확인해야 출고 승인이 가능합니다.');
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const photos = assetPhotos[oin.id] || [];
      const memoText = assetNotes[oin.id] || '';

      db.updateRow<OutboundInspection>('outboundInspections', oin.id, {
        status: 'COMPLETED', 
        inspectorId: currentUser?.name || '담당기사',
        inspectedAt: nowIso, 
        approvedAt: nowIso,
        specsJson: JSON.stringify({
          checkpoints: checkpoints.map(cp => ({ ...cp, checked: !!checked[cp.id] })),
          photos,
          checkedCount,
          totalCheckpoints: checkpoints.length,
          completedAt: nowIso,
          inspectorMemo: memoText
        }),
        note: `[출고검수 완료] 확인 ${checkedCount}/${checkpoints.length}개소 (사진 ${photos.length}매)${memoText ? ` | 메모: ${memoText}` : ''}`,
        updatedAt: nowIso
      });
      
      if (oin.assetId) {
        db.updateRow<Asset>('assets', oin.assetId, { status: 'RENTED', updatedAt: nowIso });
        
        db.insertRow<AssetInOutLog>('assetInOutLogs', {
          assetId: oin.assetId, 
          assetNo: asset?.assetNo || '', 
          modelName: asset?.modelName || '',
          deliveryId: oin.deliveryId, 
          type: 'OUTBOUND',
          eventDate: nowIso.split('T')[0],
          customerId: contract?.customerId, 
          customerName: customer?.name || '',
          siteId: contract?.siteId, 
          siteName: site?.name || '',
          memo: `[출고검수 승인] 계약(${contract?.contractNo || ''}) 현장(${site?.name || ''}) (대여중 전환)`,
          createdAt: nowIso,
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();
      
      setSuccessToast(`자산 #${asset?.assetNo || '미배정'} 검수 완료 (대여중 전환)`);
      setTimeout(() => setSuccessToast(''), 3000);
      
      const remainingInGroup = activeGroup.filter(i => i.id !== oin.id);
      if (remainingInGroup.length === 0) {
        setSelectedGroupId('');
      }
    } catch (err: any) {
      showErrorModal('검수 승인 실패: ' + (err.message || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 전체 일괄 승인 ──
  const handleApproveAll = async () => {
    const readyToApprove = activeGroup.filter(oin => {
      const { checkpoints } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
      const checked = assetCheckedList[oin.id] || {};
      const checkedCount = Object.values(checked).filter(Boolean).length;
      return checkpoints.length === 0 || checkedCount > 0;
    });

    if (readyToApprove.length === 0) {
      showErrorModal('검수 확인 조건을 충족한 자산이 없습니다.');
      return;
    }

    const first = activeGroup[0];
    const contract = contracts.find(c => c.id === first.contractId);
    const customer = contract ? customers.find(c => c.id === contract.customerId) : undefined;
    
    if (customer && (customer as any).transactionStatus === 'BLOCKED') {
      showErrorModal(`[출고제한] 거래차단(BLOCKED) 고객사(${customer.name}) 장비는 일괄 승인할 수 없습니다.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const site = contract ? sites.find(s => s.id === contract.siteId) : undefined;
      
      for (const oin of readyToApprove) {
        const { checkpoints, asset } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
        const checked = assetCheckedList[oin.id] || {};
        const checkedCount = Object.values(checked).filter(Boolean).length;
        const photos = assetPhotos[oin.id] || [];
        const memoText = assetNotes[oin.id] || '';

        db.updateRow<OutboundInspection>('outboundInspections', oin.id, {
          status: 'COMPLETED', 
          inspectorId: currentUser?.name || '담당기사',
          inspectedAt: nowIso, 
          approvedAt: nowIso,
          specsJson: JSON.stringify({
            checkpoints: checkpoints.map(cp => ({ ...cp, checked: !!checked[cp.id] })),
            photos,
            checkedCount,
            totalCheckpoints: checkpoints.length,
            completedAt: nowIso,
            inspectorMemo: memoText
          }),
          note: `[출고검수 일괄 완료] 확인 ${checkedCount}/${checkpoints.length}개소 (사진 ${photos.length}매)${memoText ? ` | 메모: ${memoText}` : ''}`,
          updatedAt: nowIso
        });
        
        if (oin.assetId) {
          db.updateRow<Asset>('assets', oin.assetId, { status: 'RENTED', updatedAt: nowIso });
          
          db.insertRow<AssetInOutLog>('assetInOutLogs', {
            assetId: oin.assetId, 
            assetNo: asset?.assetNo || '', 
            modelName: asset?.modelName || '',
            deliveryId: oin.deliveryId, 
            type: 'OUTBOUND',
            eventDate: nowIso.split('T')[0],
            customerId: contract?.customerId, 
            customerName: customer?.name || '',
            siteId: contract?.siteId, 
            siteName: site?.name || '',
            memo: `[출고검수 일괄 승인] 계약(${contract?.contractNo || ''}) 현장(${site?.name || ''}) (대여중 전환)`,
            createdAt: nowIso,
          });
        }
      }

      await db.awaitPendingWrites();
      refreshAllData();
      
      setSuccessToast(`총 ${readyToApprove.length}대 일괄 승인 완료`);
      setTimeout(() => setSuccessToast(''), 3000);
      
      setSelectedGroupId('');
    } catch (err: any) {
      showErrorModal('일괄 검수 승인 실패: ' + (err.message || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 장비 교체 모달 열기 ──
  const handleOpenSwapModal = (oin: OutboundInspection) => {
    const a = assets.find(x => x.id === oin.assetId);
    setSwapTargetOin(oin);
    setSwapTargetAsset(a || null);
    setSelectedNewAssetId('');
    setSwapReason('시동 불능');
    setSwapPenalty(5);
    setSwapSearchQuery('');
    setSwapModalOpen(true);
  };

  // ── 가용 대체 장비 목록 (동일 모델 & AVAILABLE 우선) ──
  const availableSwapAssets = useMemo(() => {
    if (!swapTargetAsset) return [];
    return assets.filter(a => {
      if (a.status !== 'AVAILABLE') return false;
      if (a.id === swapTargetAsset.id) return false;
      if (swapSearchQuery.trim()) {
        const q = swapSearchQuery.toLowerCase().trim();
        return a.assetNo.toLowerCase().includes(q) || a.modelName.toLowerCase().includes(q);
      }
      return isModelMatch(a.modelName, swapTargetAsset.modelName);
    }).sort((a, b) => (a.maintenanceScore || 0) - (b.maintenanceScore || 0));
  }, [assets, swapTargetAsset, swapSearchQuery]);

  // ── 장비 교체 실행 ──
  const handleExecuteSwap = async () => {
    if (!swapTargetOin || !swapTargetAsset || !selectedNewAssetId) {
      showErrorModal('교체할 대체 장비를 선택해 주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      await exchangeOutboundAsset(
        swapTargetOin.contractAssetId || '',
        swapTargetAsset.id,
        selectedNewAssetId,
        swapReason,
        true,
        swapPenalty
      );

      setSuccessToast(`장비 교체 완료 (#${swapTargetAsset.assetNo} ➔ 신규 장비)`);
      setTimeout(() => setSuccessToast(''), 3000);
      setSwapModalOpen(false);
      setSwapTargetOin(null);
    } catch (err: any) {
      showErrorModal(`장비 교체 실패: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 출고의뢰 반려 실행 ──
  const handleExecuteReject = async () => {
    if (!selectedGroupId || activeGroup.length === 0) return;
    if (!rejectReason.trim()) {
      showErrorModal('반려 사유를 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      for (const oin of activeGroup) {
        db.updateRow<OutboundInspection>('outboundInspections', oin.id, {
          status: 'REJECTED',
          rejectReason: rejectReason.trim(),
          note: `[출고검수 반려] 사유: ${rejectReason.trim()} (처리자: ${currentUser?.name || '담당자'})`,
          updatedAt: nowIso
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();

      setSuccessToast(`출고의뢰 ${activeGroup.length}건 반려 완료`);
      setTimeout(() => setSuccessToast(''), 3000);
      setRejectModalOpen(false);
      setSelectedGroupId('');
    } catch (err: any) {
      showErrorModal(`반려 처리 실패: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pendingCount = Object.keys(allGroups.pending).length;
  const completedCount = Object.keys(allGroups.completed).length;

  return (
    <div className="flex flex-col pb-36 p-3.5 h-full bg-slate-950 min-h-screen text-slate-100 selection:bg-emerald-500 selection:text-white">
      {/* 성공 토스트 */}
      {successToast && (
        <div className="p-3 mb-3 rounded-xl bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 text-xs font-bold flex items-center gap-2 shadow-lg animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────
          레이어 1: 출고의뢰 목록 뷰 (검색 + 날짜 필터 + 카드 리스트)
         ─────────────────────────────────────────────────────────────────────── */}
      {!selectedGroupId ? (
        <div className="flex flex-col gap-3">
          {/* 타이틀 헤더 */}
          <div className="flex items-center justify-between pt-1">
            <h1 className="text-base font-black text-white flex items-center gap-2 whitespace-nowrap shrink-0">
              <CheckSquare className="w-5 h-5 text-emerald-400" />
              출고 검수 관리
            </h1>
            {/* 상태 탭 2분할 */}
            <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => { setActiveTab('PENDING'); setSelectedGroupId(''); }}
                className={`px-3 py-1 text-xs font-black rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'PENDING' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                검수 대기 ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('COMPLETED'); setSelectedGroupId(''); }}
                className={`px-3 py-1 text-xs font-black rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'COMPLETED' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                검수 완료 ({completedCount})
              </button>
            </div>
          </div>

          {/* 실시간 검색창 */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="고객사, 현장, 계약번호, 장비번호 검색"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 p-1 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 날짜 프리셋 퀵 버튼 바 (대기 탭 전용) */}
          {activeTab === 'PENDING' && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setDateFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border shrink-0 transition-colors ${
                  dateFilter === 'ALL' && !exchangeOnly
                    ? 'bg-slate-800 border-slate-600 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                전체 기간
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('TODAY')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border shrink-0 transition-colors ${
                  dateFilter === 'TODAY'
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                오늘 상차
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('TOMORROW')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border shrink-0 transition-colors ${
                  dateFilter === 'TOMORROW'
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                내일 상차
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('WEEK')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border shrink-0 transition-colors ${
                  dateFilter === 'WEEK'
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                이번주 (7일)
              </button>
              <button
                type="button"
                onClick={() => setExchangeOnly(prev => !prev)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border shrink-0 transition-colors ${
                  exchangeOnly
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                대차/교체만
              </button>
            </div>
          )}

          {/* 의뢰 카드 목록 */}
          {filteredGroupEntries.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800 flex flex-col items-center gap-2 mt-2">
              <CheckSquare className="w-8 h-8 text-slate-600" />
              <span>{activeTab === 'PENDING' ? '해당 조건의 검수 대기 의뢰가 없습니다.' : '완료된 검수 내역이 없습니다.'}</span>
            </div>
          ) : (
            filteredGroupEntries.map(([groupId, insList]) => {
              const first = insList[0];
              const contract = contracts.find(c => c.id === first.contractId);
              const customer = contract ? customers.find(c => c.id === contract.customerId) : undefined;
              const site = contract ? sites.find(s => s.id === contract.siteId) : undefined;
              const delivery = deliveries.find(d => d.id === first.deliveryId);
              const isBlocked = (customer as any)?.transactionStatus === 'BLOCKED';
              const isExchange = contract ? exchangeContractIds.has(contract.id) : false;

              // 상차일자 & D-day
              const loadingDate = delivery?.loadingDate || delivery?.scheduledDate || contract?.startDate;
              const dDay = getDDay(loadingDate);

              // 모델 수량 요약
              const modelCounts: Record<string, number> = {};
              insList.forEach(item => {
                const a = assets.find(x => x.id === item.assetId);
                const m = a?.modelName || '모델확인중';
                modelCounts[m] = (modelCounts[m] || 0) + 1;
              });
              const modelSummary = Object.entries(modelCounts).map(([m, c]) => `${m} ${c}대`).join(', ');

              return (
                <div
                  key={groupId}
                  onClick={() => handleSelectGroup(groupId)}
                  className={`p-4 rounded-2xl bg-slate-900 border active:scale-[0.99] transition-all cursor-pointer flex flex-col gap-2.5 shadow-lg relative overflow-hidden ${
                    isBlocked 
                      ? 'border-red-900/60' 
                      : isExchange 
                      ? 'border-purple-800/60 ring-1 ring-purple-500/30' 
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {isBlocked && <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500" />}

                  {/* 1행: 고객사명, 긴급도 D-day, 대차 태그 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isExchange && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                          대차/교체
                        </span>
                      )}
                      <span className="text-sm font-black text-white truncate">
                        {customer?.name || '고객사 미지정'}
                      </span>
                      {isBlocked && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 font-bold border border-red-500/40 shrink-0">
                          거래차단
                        </span>
                      )}
                    </div>
                    {/* D-day 배지 */}
                    <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black font-mono border whitespace-nowrap shrink-0 ${dDay.color}`}>
                      {dDay.text}
                    </span>
                  </div>

                  {/* 2행: 현장명 */}
                  <div className="text-xs text-slate-400 truncate">
                    📍 {site?.name || '현장 미지정'}
                  </div>

                  {/* 3행: 장비 요약 및 대기 수량 */}
                  <div className="flex items-center justify-between bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-300 font-medium truncate">
                      <Truck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{modelSummary || '장비 매핑 대기'}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-black text-xs shrink-0 whitespace-nowrap ml-2">
                      {insList.length}대 {activeTab === 'PENDING' ? '대기' : '완료'}
                    </span>
                  </div>

                  {/* 4행: 운송 기사 & 상차 일시 (배차 연결 시) */}
                  {delivery && (
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                      <span className="truncate">
                        🚚 {delivery.driverName ? `${delivery.driverName} 기사 (${delivery.vehicleNo || '배차'})` : '배차 배정 중'}
                      </span>
                      {delivery.loadingDate && (
                        <span className="text-slate-400 shrink-0 whitespace-nowrap">
                          {delivery.loadingDate} {delivery.loadingTimeSlot || ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* ───────────────────────────────────────────────────────────────────────
           레이어 2: 출고검수 스튜디오 (선택된 의뢰 상세)
           ─────────────────────────────────────────────────────────────────────── */
        <div 
          className="flex flex-col gap-3"
          style={{
            paddingBottom: activeTab === 'PENDING' && activeGroup.length > 1 ? '96px' : '32px'
          }}
        >
          {/* 상단 네비게이션 헤더 */}
          <div className="flex items-center justify-between bg-slate-900 p-3 rounded-2xl border border-slate-800 shadow">
            <div className="flex items-center gap-2.5 min-w-0">
              <button 
                type="button"
                onClick={() => setSelectedGroupId('')} 
                className="p-2 -ml-1 rounded-xl text-slate-400 hover:text-white bg-slate-800 active:scale-95 transition-transform shrink-0"
                aria-label="뒤로가기"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <div className="flex flex-col min-w-0">
                <span className="text-white font-black text-sm truncate">{
                  (() => {
                    const first = activeGroup[0];
                    const c = contracts.find(x => x.id === first?.contractId);
                    return c ? customers.find(x => x.id === c.customerId)?.name || '직출고' : '직출고';
                  })()
                }</span>
                <span className="text-slate-400 text-xs truncate">{
                  (() => {
                    const first = activeGroup[0];
                    const c = contracts.find(x => x.id === first?.contractId);
                    return c ? sites.find(x => x.id === c.siteId)?.name || '현장' : '현장';
                  })()
                }</span>
              </div>
            </div>

            {/* 의뢰 반려 버튼 (대기 탭일 때) */}
            {activeTab === 'PENDING' && (
              <button
                type="button"
                onClick={() => setRejectModalOpen(true)}
                className="px-2.5 py-1.5 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs font-bold flex items-center gap-1 shrink-0 whitespace-nowrap hover:bg-red-900/40 active:scale-95 transition-all"
              >
                <Ban className="w-3.5 h-3.5 text-red-400" />
                반려
              </button>
            )}
          </div>

          {/* 배차 & 기사 컨텍스트 바 */}
          {(() => {
            const first = activeGroup[0];
            const delivery = deliveries.find(d => d.id === first?.deliveryId);
            if (!delivery) return null;
            return (
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-2 truncate">
                  <Truck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-bold text-white truncate">{delivery.driverName || '운송기사 미배정'}</span>
                  {delivery.vehicleNo && <span className="text-slate-400 shrink-0">({delivery.vehicleNo})</span>}
                </div>
                {delivery.driverContact && (
                  <a
                    href={`tel:${delivery.driverContact}`}
                    className="px-2.5 py-1 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-300 font-bold text-[11px] flex items-center gap-1 shrink-0"
                  >
                    <Phone className="w-3 h-3" />
                    전화걸기
                  </a>
                )}
              </div>
            );
          })()}

          {/* 특이사항 & 거래차단 가드 배너 */}
          {(() => {
            const first = activeGroup[0];
            const c = contracts.find(x => x.id === first?.contractId);
            const customer = c ? customers.find(x => x.id === c.customerId) : undefined;
            const isBlocked = (customer as any)?.transactionStatus === 'BLOCKED';
            const { specialNote } = getInspectionCheckpoints(first, contracts, contractAssets, sites, customers, assets);
            
            return (
              <div className="flex flex-col gap-2">
                {isBlocked && (
                  <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/60 flex items-start gap-2 shadow">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span className="text-xs text-red-200 font-bold leading-relaxed">
                      거래차단(BLOCKED) 고객사입니다. 연체 미결 건 해제 전까지 출고 승인이 불가합니다.
                    </span>
                  </div>
                )}
                {specialNote && (
                  <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-700/60 flex items-start gap-2">
                    <FileText className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-200 leading-relaxed font-medium">
                      <strong>현장 특이사항:</strong> {specialNote}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* 1-Touch 전체 일괄 체크 액션 바 (대기 탭 전용) */}
          {activeTab === 'PENDING' && activeGroup.length > 1 && (
            <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-400 font-bold">
                전체 {activeGroup.length}대 장비
              </span>
              <button
                type="button"
                onClick={handleCheckAllForGroup}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center gap-1.5 active:scale-95 transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                전체 장비 일괄 확인
              </button>
            </div>
          )}

          {/* 자산별 검수 카드 목록 */}
          <div className="flex flex-col gap-3">
            {activeGroup.map((oin, assetIdx) => {
              const { checkpoints, asset } = getInspectionCheckpoints(
                oin, contracts, contractAssets, sites, customers, assets
              );
              
              const isExpanded = !!expandedAssetIds[oin.id];
              const checked = assetCheckedList[oin.id] || {};
              const checkedCount = Object.values(checked).filter(Boolean).length;
              const photos = assetPhotos[oin.id] || [];
              const memoText = assetNotes[oin.id] || '';
              const isAllChecked = checkpoints.length > 0 && checkedCount === checkpoints.length;

              return (
                <div 
                  key={oin.id} 
                  className="rounded-2xl bg-slate-900 border border-slate-800 flex flex-col shadow-md overflow-hidden transition-all"
                >
                  {/* 자산 행 헤더 */}
                  <div 
                    className="p-3.5 flex items-center justify-between cursor-pointer active:bg-slate-800/50"
                    onClick={() => setExpandedAssetIds(prev => ({ ...prev, [oin.id]: !prev[oin.id] }))}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-mono text-xs font-black shrink-0 whitespace-nowrap">
                        #{asset?.assetNo || '미배정'}
                      </span>
                      <span className="text-white font-bold text-sm truncate">
                        {asset?.modelName || '모델확인중'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* 확인 진행률 배지 */}
                      <span className={`text-xs font-black px-2 py-0.5 rounded-md whitespace-nowrap ${
                        isAllChecked 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                          : checkedCount > 0 
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {checkedCount}/{checkpoints.length}
                      </span>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>

                  {/* 펼쳐진 검수 내용 */}
                  {isExpanded && (
                    <div className="flex flex-col gap-3.5 p-3.5 pt-0 border-t border-slate-800/80 mt-1">
                      
                      {/* 1-Touch 전 항목 확인 & 장비 교체 퀵 툴바 (대기 탭일 때) */}
                      {activeTab === 'PENDING' && (
                        <div className="flex items-center justify-between pt-2 gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCheckAllForAsset(oin)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 font-bold text-[11px] flex items-center gap-1 active:scale-95"
                            >
                              <Check className="w-3 h-3" />
                              전 항목 확인
                            </button>
                            {checkedCount > 0 && (
                              <button
                                type="button"
                                onClick={() => handleUncheckAllForAsset(oin)}
                                className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 text-[11px] font-bold"
                              >
                                해제
                              </button>
                            )}
                          </div>

                          {/* 대체 장비 교체 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleOpenSwapModal(oin)}
                            className="px-2.5 py-1 rounded-lg bg-purple-950/60 border border-purple-700/60 text-purple-300 font-bold text-[11px] flex items-center gap-1 active:scale-95 shrink-0"
                          >
                            <Repeat className="w-3 h-3 text-purple-400" />
                            장비 교체
                          </button>
                        </div>
                      )}

                      {/* 체크포인트 리스트 */}
                      <div className="flex flex-col gap-1.5">
                        {checkpoints.length === 0 ? (
                          <div className="text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-900/50 p-3 rounded-xl">
                            요구 사양 없음 — 모델 일치 확인 후 즉시 승인 가능
                          </div>
                        ) : (
                          checkpoints.map((cp, idx) => {
                            const isChecked = !!checked[cp.id];
                            
                            let colorClasses = 'bg-slate-950 border-slate-800 text-slate-300';
                            let checkBadge = 'border-slate-700 text-transparent';
                            
                            if (isChecked) {
                              if (cp.type === 'MODEL') {
                                colorClasses = 'bg-blue-950/30 border-blue-600 text-blue-100';
                                checkBadge = 'bg-blue-500 border-blue-400 text-white';
                              } else if (cp.type === 'SPEC') {
                                colorClasses = 'bg-emerald-950/30 border-emerald-600 text-emerald-100';
                                checkBadge = 'bg-emerald-500 border-emerald-400 text-white';
                              } else if (cp.type === 'OPTION') {
                                colorClasses = 'bg-amber-950/30 border-amber-600 text-amber-100';
                                checkBadge = 'bg-amber-500 border-amber-400 text-white';
                              }
                            }

                            return (
                              <button
                                key={cp.id}
                                type="button"
                                disabled={activeTab === 'COMPLETED'}
                                onClick={() => handleToggleCheck(oin.id, cp.id)}
                                className={`flex items-center justify-between p-3 rounded-xl border text-xs font-semibold transition-all min-h-[44px] ${colorClasses}`}
                              >
                                <span className="font-mono text-slate-500 mr-2 shrink-0">{idx + 1}.</span>
                                <span className="text-left flex-1 break-keep leading-snug">{cp.label}</span>
                                <div className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 ml-2 transition-all ${checkBadge}`}>
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>

                      {/* 단축 메모 칩 및 메모 입력란 (대기 탭일 때) */}
                      {activeTab === 'PENDING' && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
                            {['특이사항 없음', '작동 점검 완료', '세척 완료', '서류 부착 완료'].map(chip => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => handleAppendMemoChip(oin.id, chip)}
                                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium whitespace-nowrap shrink-0 border border-slate-700/60"
                              >
                                + {chip}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            value={memoText}
                            onChange={e => setAssetNotes(prev => ({ ...prev, [oin.id]: e.target.value }))}
                            placeholder="검수 특이사항 및 정비 메모 직접 입력"
                            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      )}

                      {/* 외관 사진 (카메라 업로더) */}
                      <div className="pt-1">
                        <CameraUploader
                          label="외관 확인 사진 (최대 4매)"
                          images={photos}
                          onChange={newPhotos => setAssetPhotos(prev => ({ ...prev, [oin.id]: newPhotos }))}
                          maxImages={4}
                        />
                      </div>

                      {/* 단일/개별 장비 완료 버튼 (대기 탭일 때) */}
                      {activeTab === 'PENDING' && (
                        <div className="pt-2">
                          {activeGroup.length === 1 ? (
                            <button
                              type="button"
                              disabled={isSubmitting || (checkpoints.length > 0 && checkedCount === 0) || (() => {
                                const c = contracts.find(x => x.id === oin.contractId);
                                const customer = c ? customers.find(x => x.id === c.customerId) : undefined;
                                return (customer as any)?.transactionStatus === 'BLOCKED';
                              })()}
                              onClick={() => handleApproveSingle(oin)}
                              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 whitespace-nowrap active:scale-[0.99] transition-all"
                            >
                              <ShieldCheck className="w-5 h-5 text-white shrink-0" />
                              {isSubmitting ? '승인 처리 중...' : '출고 검수 승인 완료'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isSubmitting || (checkpoints.length > 0 && checkedCount === 0) || (() => {
                                const c = contracts.find(x => x.id === oin.contractId);
                                const customer = c ? customers.find(x => x.id === c.customerId) : undefined;
                                return (customer as any)?.transactionStatus === 'BLOCKED';
                              })()}
                              onClick={() => handleApproveSingle(oin)}
                              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.99] transition-all"
                            >
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              이 장비 개별 승인
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 하단 고정 터미널 완결 바 (2대 이상 다수 장비 대기 탭 전용) */}
          {activeTab === 'PENDING' && activeGroup.length > 1 && (
            <div 
              style={{
                position: 'fixed',
                bottom: 'calc(58px + env(safe-area-inset-bottom, 0px))',
                left: 0,
                right: 0,
                zIndex: 40,
                backgroundColor: 'rgba(15, 23, 42, 0.96)',
                backdropFilter: 'blur(16px)',
                borderTop: '1px solid #334155',
                padding: '12px 16px',
                boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.5)'
              }}
            >
              <div className="max-w-md mx-auto flex items-center gap-3">
                <div className="flex flex-col shrink-0">
                  <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">확인 진행률</span>
                  <span className="text-sm font-black text-emerald-400 whitespace-nowrap">
                    {activeGroup.filter(oin => {
                      const { checkpoints } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
                      const c = assetCheckedList[oin.id] || {};
                      const cCount = Object.values(c).filter(Boolean).length;
                      return checkpoints.length === 0 || cCount > 0;
                    }).length} / {activeGroup.length}대 준비
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isSubmitting || activeGroup.filter(oin => {
                    const { checkpoints } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
                    const c = assetCheckedList[oin.id] || {};
                    return checkpoints.length === 0 || Object.values(c).filter(Boolean).length > 0;
                  }).length !== activeGroup.length || (() => {
                    const first = activeGroup[0];
                    const c = contracts.find(x => x.id === first?.contractId);
                    const customer = c ? customers.find(x => x.id === c.customerId) : undefined;
                    return (customer as any)?.transactionStatus === 'BLOCKED';
                  })()}
                  onClick={handleApproveAll}
                  className="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.99] transition-all"
                >
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  {isSubmitting ? '승인 처리 중...' : `전체 일괄 출고 승인 (${activeGroup.length}대)`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────
          모달 1: 현장 장비 교체(스왑) 모달
         ─────────────────────────────────────────────────────────────────────── */}
      {swapModalOpen && swapTargetAsset && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-1.5">
                <Repeat className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-black text-white">현장 대체 장비 교체</span>
              </div>
              <button 
                type="button" 
                onClick={() => setSwapModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 현재 불량 장비 정보 */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex flex-col gap-1">
              <span className="text-slate-400">교체 대상 불량 장비:</span>
              <span className="text-sm font-bold text-white">
                #{swapTargetAsset.assetNo} ({swapTargetAsset.modelName})
              </span>
            </div>

            {/* 교체 사유 선택 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">교체 사유</label>
              <div className="grid grid-cols-2 gap-1.5">
                {['시동 불능', '유압 누유', '배터리 방전', '조이스틱 파손', '타이어 불량', '기타 결함'].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSwapReason(r)}
                    className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition-colors ${
                      swapReason === r
                        ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* 정비 벌점 선택 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">정비점수 가산 (벌점)</label>
              <div className="flex gap-2">
                {[
                  { label: '+5점 (경미/기본)', val: 5 },
                  { label: '+10점 (중대결함)', val: 10 },
                  { label: '0점 (사양변경)', val: 0 }
                ].map(p => (
                  <button
                    key={p.val}
                    type="button"
                    onClick={() => setSwapPenalty(p.val)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border ${
                      swapPenalty === p.val
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 대체 장비 검색 & 선택 */}
            <div className="flex flex-col gap-1.5 pt-1">
              <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                <span>대체 가용 장비 선택 ({availableSwapAssets.length}대)</span>
                <span className="text-[10px] text-emerald-400">정비점수 낮은순 우선</span>
              </label>
              
              <input
                type="text"
                value={swapSearchQuery}
                onChange={e => setSwapSearchQuery(e.target.value)}
                placeholder="장비번호 검색 (예: 07-1234)"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />

              <div className="max-h-40 overflow-y-auto flex flex-col gap-1.5 pr-1">
                {availableSwapAssets.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500 bg-slate-950 rounded-xl border border-slate-800">
                    대체 가능한 가용 장비가 없습니다.
                  </div>
                ) : (
                  availableSwapAssets.map(a => (
                    <div
                      key={a.id}
                      onClick={() => setSelectedNewAssetId(a.id)}
                      className={`p-2.5 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                        selectedNewAssetId === a.id
                          ? 'bg-purple-950/50 border-purple-500 text-white'
                          : 'bg-slate-950 border-slate-800/80 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-xs text-emerald-400">#{a.assetNo}</span>
                        <span className="text-xs font-bold">{a.modelName}</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                        벌점: {a.maintenanceScore || 0}점
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 교체 실행 버튼 */}
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setSwapModalOpen(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isSubmitting || !selectedNewAssetId}
                onClick={handleExecuteSwap}
                className="flex-2 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/30"
              >
                <Repeat className="w-4 h-4" />
                {isSubmitting ? '교체 처리 중...' : '대체 장비 교체 실행'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────
          모달 2: 출고의뢰 반려 모달
         ─────────────────────────────────────────────────────────────────────── */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-1.5">
                <Ban className="w-4 h-4 text-red-400" />
                <span className="text-sm font-black text-white">출고의뢰 반려</span>
              </div>
              <button 
                type="button" 
                onClick={() => setRejectModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <span className="text-xs text-slate-400 leading-relaxed">
              출고의뢰를 반려 처리하면 담당 영업사원 및 배차 관리자에게 사유가 통보되며 출고 대기열에서 제외됩니다.
            </span>

            {/* 빠른 반려 사유 칩 */}
            <div className="flex flex-wrap gap-1.5">
              {['고객사 공사 지연', '현장 진입 불가', '고객 요청 계약 취소', '안전 서류 미비', '장비 제원 부적합'].map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setRejectReason(chip)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium border border-slate-700/60"
                >
                  {chip}
                </button>
              ))}
            </div>

            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="반려 사유를 구체적으로 작성하십시오."
              rows={3}
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
            />

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isSubmitting || !rejectReason.trim()}
                onClick={handleExecuteReject}
                className="flex-2 py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-red-600/30"
              >
                <Ban className="w-4 h-4" />
                {isSubmitting ? '반려 처리 중...' : '출고의뢰 반려 확정'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
