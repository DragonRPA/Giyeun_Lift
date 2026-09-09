// src/mobile/pages/MobileAssetAssignment.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  CheckSquare, 
  Square, 
  Check, 
  ArrowLeft, 
  ArrowRight, 
  Search, 
  X, 
  Building2, 
  MapPin, 
  Calendar, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  ChevronRight, 
  Zap
} from 'lucide-react';

export interface MobileAssetAssignmentProps {
  onNavigate?: (tab: any) => void;
  onBack?: () => void;
}

export const MobileAssetAssignment: React.FC<MobileAssetAssignmentProps> = ({
  onNavigate,
  onBack,
}) => {
  const {
    contracts,
    contractAssets,
    assets,
    customers,
    sites,
    contractHistory,
    batchAssignAssetsToContract,
    unassignAssetFromContract,
    showErrorModal,
    refreshAllData,
    hasPermission,
  } = useApp();

  // 권한 검증
  const canView = hasPermission ? hasPermission('dispatch_assign', 'view') : true;
  const canEdit = hasPermission ? hasPermission('dispatch_assign', 'save') : true;

  // 계약 선택 상태 (null이면 계약 목록 화면, string이면 해당 계약 할당 스튜디오)
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);

  // 검색 및 필터 탭 ('ALL' | 'EXCHANGE' | 'NORMAL')
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'ALL' | 'EXCHANGE' | 'NORMAL'>('ALL');

  // 스튜디오 내 슬롯 및 장비 선택 상태
  const [selectedCaIds, setSelectedCaIds] = useState<string[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [quickInputText, setQuickInputText] = useState('');

  // 상태 플래그
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [lastAssignedSuccessCount, setLastAssignedSuccessCount] = useState<number | null>(null);

  // 토스트 알림 헬퍼
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. 모델명 정규화 헬퍼 (공백/하이픈/대소문자 통일)
  const normalizeModelKey = (name?: string): string => {
    if (!name) return '미지정';
    return name.replace(/[\s\-_]/g, '').toUpperCase();
  };

  // 2. 모델 유사 매칭 헬퍼 (제원 숫자 및 접두어 포함)
  const isModelMatch = (assetModel?: string, expectedModel?: string): boolean => {
    if (!assetModel || !expectedModel) return false;
    if (assetModel === expectedModel) return true;
    
    const cleanedA = assetModel.replace(/[\s\-_]/g, '').toLowerCase();
    const cleanedE = expectedModel.replace(/[\s\-_]/g, '').toLowerCase();
    if (cleanedA.includes(cleanedE) || cleanedE.includes(cleanedA)) return true;

    const nums = expectedModel.match(/\d{3,4}/);
    if (nums && assetModel.includes(nums[0])) return true;

    return false;
  };

  // 3. 거래처 및 현장 명칭 헬퍼
  const getCustomerName = (customerId?: string): string => {
    if (!customerId) return '고객사 미지정';
    const c = customers.find(item => item.id === customerId);
    return c?.name || '고객사 미지정';
  };

  const getSiteName = (siteId?: string): string => {
    if (!siteId) return '현장 미지정';
    const s = sites.find(item => item.id === siteId);
    return s?.name || '현장 미지정';
  };

  // 4. 대차/교체 여부 판정
  const isExchangeContract = (contractId: string): boolean => {
    return (contractHistory || []).some(h => h.contractId === contractId && h.changeType === 'EXCHANGE');
  };

  // 5. 전사 미할당 슬롯 및 미할당 계약 집계
  const allUnassignedSlots = useMemo(() => {
    return contractAssets.filter(ca => !ca.assetId);
  }, [contractAssets]);

  const unassignedContractIdSet = useMemo(() => {
    return new Set(allUnassignedSlots.map(ca => ca.contractId));
  }, [allUnassignedSlots]);

  const totalUnassignedContractsCount = unassignedContractIdSet.size;
  const totalUnassignedSlotsCount = allUnassignedSlots.length;

  // 6. 미할당 계약 목록 (검색, 필터, 대차교체 최우선 정렬)
  const pendingContracts = useMemo(() => {
    let list = contracts.filter(c => unassignedContractIdSet.has(c.id));

    // 검색어 필터링
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(c => {
        const custName = getCustomerName(c.customerId).toLowerCase();
        const siteName = getSiteName(c.siteId).toLowerCase();
        const cNo = (c.contractNo || '').toLowerCase();
        const slots = contractAssets.filter(ca => ca.contractId === c.id);
        const modelMatch = slots.some(ca => (ca.expectedModel || '').toLowerCase().includes(q));
        return custName.includes(q) || siteName.includes(q) || cNo.includes(q) || modelMatch;
      });
    }

    // 탭 필터링
    if (filterTab === 'EXCHANGE') {
      list = list.filter(c => isExchangeContract(c.id));
    } else if (filterTab === 'NORMAL') {
      list = list.filter(c => !isExchangeContract(c.id));
    }

    // 정렬: 대차/교체 우선, 이후 출고일자(startDate) 오름차순
    return list.sort((a, b) => {
      const aEx = isExchangeContract(a.id) ? 1 : 0;
      const bEx = isExchangeContract(b.id) ? 1 : 0;
      if (aEx !== bEx) return bEx - aEx;
      return (a.startDate || '').localeCompare(b.startDate || '');
    });
  }, [contracts, unassignedContractIdSet, searchQuery, filterTab, contractHistory, contractAssets, customers, sites]);

  // 7. 특정 계약의 모델별 슬롯 요약 정보
  const getContractModelSummary = (contractId: string) => {
    const slots = contractAssets.filter(ca => ca.contractId === contractId);
    const map = new Map<string, { total: number; pending: number; name: string }>();
    slots.forEach(slot => {
      const raw = slot.expectedModel || '미지정';
      const key = normalizeModelKey(raw);
      const curr = map.get(key) || { total: 0, pending: 0, name: raw };
      curr.total += 1;
      if (!slot.assetId) curr.pending += 1;
      if (raw.includes('-') && !curr.name.includes('-')) curr.name = raw;
      map.set(key, curr);
    });
    return Array.from(map.values());
  };

  // 8. 현재 선택된 계약 정보 및 슬롯 목록
  const activeContract = useMemo(() => {
    if (!selectedContractId) return null;
    return contracts.find(c => c.id === selectedContractId) || null;
  }, [contracts, selectedContractId]);

  const activeContractSlots = useMemo(() => {
    if (!selectedContractId) return [];
    return contractAssets.filter(ca => ca.contractId === selectedContractId);
  }, [contractAssets, selectedContractId]);

  const activeUnassignedSlots = useMemo(() => {
    return activeContractSlots.filter(ca => !ca.assetId);
  }, [activeContractSlots]);

  const activeAssignedSlots = useMemo(() => {
    return activeContractSlots.filter(ca => !!ca.assetId);
  }, [activeContractSlots]);

  // 9. 계약 카드 탭 시 스튜디오 진입 (첫 번째 미할당 모델 슬롯 자동 포커스)
  const handleSelectContract = (contractId: string) => {
    setSelectedContractId(contractId);
    setSelectedAssetIds([]);
    setLastAssignedSuccessCount(null);

    const slots = contractAssets.filter(ca => ca.contractId === contractId && !ca.assetId);
    if (slots.length > 0) {
      const firstModelKey = normalizeModelKey(slots[0].expectedModel);
      const firstModelSlotIds = slots
        .filter(ca => normalizeModelKey(ca.expectedModel) === firstModelKey)
        .map(ca => ca.id);
      setSelectedCaIds(firstModelSlotIds);
    } else {
      setSelectedCaIds([]);
    }
  };

  // 10. 가용 장비 풀 필터링 (선택된 슬롯 요구모델 매칭 & 정비점수 오름차순)
  const availableAssets = useMemo(() => {
    if (!selectedContractId) return [];
    let list = assets.filter(a => a.status === 'AVAILABLE');

    // 선택된 슬롯이 있는 경우 해당 슬롯 요구모델로 필터링
    const targetSlots = selectedCaIds.length > 0
      ? activeUnassignedSlots.filter(ca => selectedCaIds.includes(ca.id))
      : activeUnassignedSlots;

    const reqModels = Array.from(new Set(targetSlots.map(ca => ca.expectedModel).filter(Boolean))) as string[];
    if (reqModels.length > 0) {
      list = list.filter(a => reqModels.some(m => isModelMatch(a.modelName, m)));
    }

    // 정비점수 기준 오름차순 정렬 (0점이 최상)
    return list.sort((a, b) => (a.maintenanceScore || 0) - (b.maintenanceScore || 0));
  }, [assets, selectedContractId, selectedCaIds, activeUnassignedSlots]);

  // 11. 정비점수 배지 스타일 헬퍼
  const getMaintenanceBadge = (score: number = 0) => {
    if (score === 0) {
      return {
        text: '정비점수 0 (최상)',
        className: 'bg-emerald-950/70 text-emerald-300 border border-emerald-800'
      };
    }
    if (score <= 20) {
      return {
        text: `정비점수 ${score}`,
        className: 'bg-amber-950/70 text-amber-300 border border-amber-800'
      };
    }
    return {
      text: `정비점수 ${score} (정비권장)`,
      className: 'bg-rose-950/70 text-rose-300 border border-rose-800'
    };
  };

  // 12. 슬롯 선택 토글
  const handleToggleSlot = (caId: string) => {
    if (selectedCaIds.includes(caId)) {
      setSelectedCaIds(prev => prev.filter(id => id !== caId));
      setSelectedAssetIds([]);
    } else {
      setSelectedCaIds(prev => [...prev, caId]);
      setSelectedAssetIds([]);
    }
  };

  // 전체 슬롯 선택 / 해제
  const handleSelectAllSlots = () => {
    if (selectedCaIds.length === activeUnassignedSlots.length) {
      setSelectedCaIds([]);
      setSelectedAssetIds([]);
    } else {
      setSelectedCaIds(activeUnassignedSlots.map(ca => ca.id));
      setSelectedAssetIds([]);
    }
  };

  // 13. 개별 장비 선택 토글
  const handleToggleAsset = (assetId: string) => {
    if (selectedAssetIds.includes(assetId)) {
      setSelectedAssetIds(prev => prev.filter(id => id !== assetId));
    } else {
      if (selectedCaIds.length === 0) {
        showToast('할당 대상 슬롯을 먼저 선택해 주십시오.', 'error');
        return;
      }
      if (selectedAssetIds.length >= selectedCaIds.length) {
        showToast(`선택 슬롯 수량(${selectedCaIds.length}대)을 초과할 수 없습니다.`, 'error');
        return;
      }
      setSelectedAssetIds(prev => [...prev, assetId]);
    }
  };

  // 14. 정비순 자동선택 (선택된 슬롯 수만큼 상위 가용장비 자동 담기)
  const handleAutoSelectAssets = () => {
    if (selectedCaIds.length === 0) {
      showToast('할당 대상 슬롯을 먼저 선택해 주십시오.', 'error');
      return;
    }
    const count = selectedCaIds.length;
    const topIds = availableAssets.slice(0, count).map(a => a.id);
    if (topIds.length === 0) {
      showToast('매칭되는 가용 장비가 없습니다.', 'error');
      return;
    }
    setSelectedAssetIds(topIds);
  };

  // 15. 관리번호 직접 입력 / 바코드 매칭
  const handleQuickInput = () => {
    if (!quickInputText.trim()) return;
    const query = quickInputText.trim().toLowerCase();

    const matched = availableAssets.find(a => 
      !selectedAssetIds.includes(a.id) &&
      (
        a.assetNo?.toLowerCase() === query ||
        a.assetNo?.toLowerCase().endsWith(query) ||
        a.serialNo?.toLowerCase() === query ||
        a.serialNo?.toLowerCase().includes(query)
      )
    );

    if (!matched) {
      showToast(`가용 장비 중 ${quickInputText}에 해당하는 장비가 없습니다.`, 'error');
      return;
    }

    if (selectedCaIds.length === 0) {
      showToast('할당 대상 슬롯을 먼저 선택해 주십시오.', 'error');
      return;
    }

    if (selectedAssetIds.length >= selectedCaIds.length) {
      showToast(`선택 슬롯 수량(${selectedCaIds.length}대)을 초과할 수 없습니다.`, 'error');
      return;
    }

    setSelectedAssetIds(prev => [...prev, matched.id]);
    setQuickInputText('');
    showToast(`${matched.assetNo} / ${matched.modelName} 선택 완료`);
  };

  // 16. 장비 할당 실행 (헌장 5.2 무음 실패 방지)
  const handleExecuteAssignment = async () => {
    if (!canEdit) {
      showErrorModal('장비 할당 권한이 없습니다. (dispatch_assign)');
      return;
    }
    if (selectedCaIds.length === 0 || selectedAssetIds.length === 0) {
      showToast('슬롯과 장비를 선택해 주십시오.', 'error');
      return;
    }
    if (selectedCaIds.length !== selectedAssetIds.length) {
      showToast(`선택 슬롯(${selectedCaIds.length}개)과 선택 장비(${selectedAssetIds.length}대) 수량이 일치해야 합니다.`, 'error');
      return;
    }

    // 모델 정합성 우선 1:1 매핑 페어링
    const pairs: { contractAssetId: string; assetId: string }[] = [];
    const remainingCaIds = [...selectedCaIds];

    for (const assetId of selectedAssetIds) {
      const asset = assets.find(a => a.id === assetId);
      if (!asset) continue;

      const matchIdx = remainingCaIds.findIndex(caId => {
        const ca = contractAssets.find(c => c.id === caId);
        return ca && isModelMatch(asset.modelName, ca.expectedModel || '');
      });

      if (matchIdx !== -1) {
        pairs.push({ contractAssetId: remainingCaIds[matchIdx], assetId });
        remainingCaIds.splice(matchIdx, 1);
      } else if (remainingCaIds.length > 0) {
        pairs.push({ contractAssetId: remainingCaIds[0], assetId });
        remainingCaIds.splice(0, 1);
      }
    }

    if (pairs.length !== selectedAssetIds.length) {
      showToast('슬롯 매핑 생성 중 오류가 발생했습니다.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await batchAssignAssetsToContract(pairs);
      await refreshAllData();
      setLastAssignedSuccessCount(pairs.length);
      showToast(`총 ${pairs.length}대 장비 할당 완료 (출고검수 대기 전환)`, 'success');
      setSelectedCaIds([]);
      setSelectedAssetIds([]);
    } catch (err: any) {
      console.error('장비 할당 실패:', err);
      showErrorModal(err?.message || '장비 할당 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 17. 기할당 슬롯 할당 취소
  const handleUnassignSlot = async (caId: string, assetNo?: string) => {
    if (!canEdit) {
      showErrorModal('장비 할당 권한이 없습니다. (dispatch_assign)');
      return;
    }
    setIsSubmitting(true);
    try {
      await unassignAssetFromContract(caId);
      await refreshAllData();
      showToast(`${assetNo || '장비'} 할당 취소 완료 (임대가능 복원)`, 'success');
    } catch (err: any) {
      console.error('할당 취소 실패:', err);
      showErrorModal(err?.message || '할당 취소 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 권한 없는 경우 안내
  if (!canView && !canEdit) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center text-slate-400">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
        <div className="text-base font-bold text-slate-200 mb-1">접근 권한 제한</div>
        <div className="text-xs">장비 할당 메뉴 조회 권한이 없습니다. (dispatch_assign)</div>
      </div>
    );
  }

  return (
    <div className="mobile-asset-assignment-root min-h-screen bg-slate-950 text-slate-100 flex flex-col pb-36 font-sans">
      {/* ── 1. 상단 고정 헤더 ── */}
      <header className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3 shadow-md">
        <div className="flex items-center justify-between gap-2">
          {/* 뒤로가기 및 타이틀 */}
          <div className="flex items-center gap-2 min-w-0">
            {selectedContractId ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedContractId(null);
                  setSelectedCaIds([]);
                  setSelectedAssetIds([]);
                  setLastAssignedSuccessCount(null);
                }}
                className="p-1.5 -ml-1 text-slate-400 hover:text-slate-100 rounded-lg active:bg-slate-800 transition-colors"
                aria-label="계약 목록 이동"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="p-1.5 -ml-1 text-slate-400 hover:text-slate-100 rounded-lg active:bg-slate-800 transition-colors"
                aria-label="이전 화면 이동"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : null}

            <h1 className="text-base font-bold text-slate-100 whitespace-nowrap shrink-0 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-400 shrink-0" />
              <span>장비 할당</span>
            </h1>

            {/* 헤더 카운트 배지 */}
            <div className="flex items-center gap-1 ml-1 overflow-x-auto no-scrollbar">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 bg-amber-950/80 text-amber-300 border border-amber-800">
                미할당 계약 {totalUnassignedContractsCount}건
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 bg-blue-950/80 text-blue-300 border border-blue-800">
                미할당 슬롯 {totalUnassignedSlotsCount}대
              </span>
            </div>
          </div>

          {/* 우측 상단 액션: 출고검수 이동 */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate?.('inspection')}
              className="text-xs bg-emerald-700 hover:bg-emerald-600 active:scale-95 text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1 font-medium whitespace-nowrap shrink-0 shadow-sm transition-all"
            >
              <span>출고검수 이동</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── 토스트 알림 팝업 ── */}
      {toastMessage && (
        <div 
          className={`fixed top-14 left-4 right-4 z-50 p-3 rounded-xl shadow-2xl border backdrop-blur-md flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/95 text-emerald-200 border-emerald-700 shadow-emerald-950/50'
              : 'bg-rose-950/95 text-rose-200 border-rose-700 shadow-rose-950/50'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span className="flex-1">{toastMessage.text}</span>
          <button 
            type="button" 
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-slate-200 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── 본문 영역 ── */}
      <main className="flex-1 px-3 py-3 flex flex-col gap-3 max-w-full">
        {!selectedContractId ? (
          /* ========================================================================= */
          /* 📋 뷰 1: 미할당 계약 목록 화면                                          */
          /* ========================================================================= */
          <>
            {/* 검색 및 필터 패널 (헌장 3.4 상하 스택 배치) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5 shadow-sm">
              {/* 검색어 입력 필드 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300 whitespace-nowrap shrink-0">
                  계약 검색
                </label>
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="고객사명, 현장명, 모델명, 계약번호 검색"
                    className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 필터 탭 (건조한 명사 단일 표준화) */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setFilterTab('ALL')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    filterTab === 'ALL'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('EXCHANGE')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    filterTab === 'EXCHANGE'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  대차/교체 우선
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('NORMAL')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    filterTab === 'NORMAL'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  일반계약
                </button>
              </div>
            </div>

            {/* 계약 카드 목록 */}
            <div className="flex flex-col gap-2.5">
              {pendingContracts.length === 0 ? (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 text-center text-slate-400 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500/80 mb-1" />
                  <div className="text-sm font-bold text-slate-200">미할당 계약 없음</div>
                  <div className="text-xs text-slate-400">
                    {searchQuery ? '검색 조건과 일치하는 미할당 계약이 없습니다.' : '모든 계약의 장비 할당이 완료되었습니다.'}
                  </div>
                </div>
              ) : (
                pendingContracts.map((c) => {
                  const isEx = isExchangeContract(c.id);
                  const modelSummaries = getContractModelSummary(c.id);
                  const totalPendingForThis = modelSummaries.reduce((sum, m) => sum + m.pending, 0);

                  return (
                    <div
                      key={c.id}
                      onClick={() => handleSelectContract(c.id)}
                      className={`rounded-xl p-3.5 flex flex-col gap-2.5 border shadow-sm active:scale-[0.99] transition-all cursor-pointer ${
                        isEx
                          ? 'bg-rose-950/15 border-rose-900/60 hover:border-rose-700'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* 카드 상단: 계약번호 & 대차교체 배지 & 미할당 카운트 */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isEx && (
                            <span className="text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap shrink-0 bg-rose-600 text-white shadow-sm">
                              대차/교체
                            </span>
                          )}
                          <span className="text-xs font-bold text-slate-300 font-mono whitespace-nowrap shrink-0">
                            {c.contractNo || '계약번호 미상'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 whitespace-nowrap shrink-0">
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-950/80 text-amber-300 border border-amber-800">
                            미할당 {totalPendingForThis}대
                          </span>
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        </div>
                      </div>

                      {/* 고객사 및 현장명 */}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-sm font-black text-slate-100">
                          <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="truncate">{getCustomerName(c.customerId)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate">{getSiteName(c.siteId)}</span>
                        </div>
                      </div>

                      {/* 출고일자 및 계약기간 */}
                      <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-slate-800/80 text-slate-400">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-slate-400 whitespace-nowrap shrink-0">출고일:</span>
                          <span className="font-semibold text-slate-200 whitespace-nowrap shrink-0">{c.startDate || '미정'}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                          {c.startDate} ~ {c.endDate}
                        </div>
                      </div>

                      {/* 모델별 슬롯 요약 배지 목록 */}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {modelSummaries.map((m) => (
                          <span
                            key={m.name}
                            className={`text-[11px] px-2 py-0.5 rounded font-medium whitespace-nowrap shrink-0 border ${
                              m.pending > 0
                                ? 'bg-slate-950 text-blue-300 border-blue-900/60'
                                : 'bg-slate-950/50 text-slate-400 border-slate-800 line-through'
                            }`}
                          >
                            {m.name}: {m.pending}대 미할당 (총 {m.total}대)
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          /* ========================================================================= */
          /* 🛠️ 뷰 2: 선택된 계약의 장비 할당 스튜디오 (Assignment Studio)           */
          /* ========================================================================= */
          <>
            {/* 상단: 계약 컨텍스트 요약 카드 */}
            {activeContract && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isExchangeContract(activeContract.id) && (
                      <span className="text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap shrink-0 bg-rose-600 text-white">
                        대차/교체
                      </span>
                    )}
                    <span className="text-xs font-bold text-slate-400 font-mono whitespace-nowrap shrink-0">
                      {activeContract.contractNo}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedContractId(null);
                      setSelectedCaIds([]);
                      setSelectedAssetIds([]);
                      setLastAssignedSuccessCount(null);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <span>계약 목록 변경</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-col gap-0.5">
                  <div className="text-sm font-black text-slate-100 truncate">
                    {getCustomerName(activeContract.customerId)}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {getSiteName(activeContract.siteId)}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/80">
                  <span>출고일: <strong className="text-slate-200">{activeContract.startDate}</strong></span>
                  <span>기간: {activeContract.startDate} ~ {activeContract.endDate}</span>
                </div>
              </div>
            )}

            {/* 할당 완료 직후 출고검수 바로가기 배너 */}
            {lastAssignedSuccessCount !== null && (
              <div className="bg-emerald-950/50 border border-emerald-800 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-md">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-emerald-200">
                      총 {lastAssignedSuccessCount}대 장비 할당 완료
                    </span>
                    <span className="text-[11px] text-emerald-400/80">
                      출고검수 대기 상태로 전환되었습니다.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate?.('inspection')}
                  className="text-xs bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold px-3 py-2 rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1 shadow transition-all"
                >
                  <span>출고검수 바로가기</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* ── 섹션 1: 미할당 슬롯 선택 목록 ── */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-200 whitespace-nowrap shrink-0">
                    미할당 슬롯 ({activeUnassignedSlots.length}대 잔여)
                  </span>
                </div>

                {activeUnassignedSlots.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectAllSlots}
                    className="text-xs text-slate-400 hover:text-slate-200 font-medium whitespace-nowrap shrink-0"
                  >
                    {selectedCaIds.length === activeUnassignedSlots.length ? '선택 해제' : '전체 선택'}
                  </button>
                )}
              </div>

              {activeUnassignedSlots.length === 0 ? (
                <div className="p-4 text-center text-xs text-emerald-400 font-medium bg-emerald-950/20 border border-emerald-900/40 rounded-lg">
                  ✓ 이 계약의 모든 슬롯 장비 할당이 완료되었습니다.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {activeUnassignedSlots.map((ca, idx) => {
                    const isSelected = selectedCaIds.includes(ca.id);
                    return (
                      <div
                        key={ca.id}
                        onClick={() => handleToggleSlot(ca.id)}
                        className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-950/40 border-blue-600 text-blue-100'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-600 shrink-0" />
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold truncate">
                              슬롯 #{idx + 1}: {ca.expectedModel || '모델 미지정'}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">
                              월 ₩{(ca.monthlyRentalFee || 0).toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <span className="text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap shrink-0 bg-amber-950/80 text-amber-300 border border-amber-800">
                          미할당
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 섹션 2: 가용 장비 매핑 (관리번호 빠른입력 및 장비 리스트) ── */}
            {activeUnassignedSlots.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-200 whitespace-nowrap shrink-0">
                      가용 장비 목록 ({availableAssets.length}대 가용)
                    </span>
                  </div>

                  {/* 정비순 자동선택 버튼 */}
                  <button
                    type="button"
                    onClick={handleAutoSelectAssets}
                    className="text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-2.5 py-1 rounded-md font-medium whitespace-nowrap shrink-0 border border-slate-700 flex items-center gap-1 transition-colors"
                  >
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span>정비순 자동선택</span>
                  </button>
                </div>

                {/* 관리번호 직접 입력 (헌장 3.4 상하 스택 배치) */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-300 whitespace-nowrap shrink-0">
                    관리번호 직접 입력
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={quickInputText}
                      onChange={(e) => setQuickInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleQuickInput();
                        }
                      }}
                      placeholder="관리번호 / 바코드 입력"
                      className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors uppercase font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleQuickInput}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs rounded-lg whitespace-nowrap shrink-0 transition-colors"
                    >
                      선택 추가
                    </button>
                  </div>
                </div>

                {/* 가용 장비 리스트 */}
                <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-0.5">
                  {availableAssets.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400 bg-slate-950/60 rounded-lg border border-slate-800">
                      매칭되는 가용 장비가 없습니다. (타 모델 또는 주기장 입고 필요)
                    </div>
                  ) : (
                    availableAssets.map((asset) => {
                      const isSelected = selectedAssetIds.includes(asset.id);
                      const badgeInfo = getMaintenanceBadge(asset.maintenanceScore);

                      return (
                        <div
                          key={asset.id}
                          onClick={() => handleToggleAsset(asset.id)}
                          className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-emerald-950/40 border-emerald-600 text-emerald-100 shadow-sm'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-600 shrink-0" />
                            )}
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-black font-mono text-slate-100 whitespace-nowrap shrink-0">
                                  {asset.assetNo}
                                </span>
                                <span className="text-xs font-semibold text-slate-300 truncate">
                                  {asset.modelName}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                                <span>{asset.ownerType === 'OWNED' ? '자사' : '전대'}</span>
                                {asset.serialNo && <span>· S/N: {asset.serialNo}</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold whitespace-nowrap shrink-0 ${badgeInfo.className}`}>
                              {badgeInfo.text}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ── 섹션 3: 기할당 슬롯 목록 (할당 취소 지원) ── */}
            {activeAssignedSlots.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-300 whitespace-nowrap shrink-0">
                    기할당 장비 ({activeAssignedSlots.length}대)
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  {activeAssignedSlots.map((ca) => {
                    const assignedAsset = assets.find(a => a.id === ca.assetId);

                    return (
                      <div
                        key={ca.id}
                        className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold font-mono text-slate-200 whitespace-nowrap shrink-0">
                                {assignedAsset?.assetNo || '장비번호 미상'}
                              </span>
                              <span className="text-xs text-slate-400 truncate">
                                {assignedAsset?.modelName || ca.expectedModel}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono">
                              상태: 출고대기 (ASSIGNED)
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isSubmitting || !canEdit}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnassignSlot(ca.id, assignedAsset?.assetNo);
                          }}
                          className="text-xs px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/80 active:scale-95 text-rose-300 border border-rose-800/80 font-medium whitespace-nowrap shrink-0 transition-colors"
                        >
                          할당 취소
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── 5. 하단 고정 바 (Terminal Action Bar) ── */}
      {selectedContractId && activeUnassignedSlots.length > 0 && (
        <div 
          style={{
            position: 'fixed',
            bottom: 'calc(58px + env(safe-area-inset-bottom, 0px))',
            left: 0,
            right: 0,
            zIndex: 8900,
          }}
          className="bg-slate-900/98 backdrop-blur-md border-t border-slate-800 px-4 py-3 shadow-2xl max-w-lg md:max-w-3xl mx-auto"
        >
          <div className="flex flex-col gap-2">
            {/* 상단 요약 라인 */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0 font-medium text-slate-300">
                <span>선택 슬롯 <strong className="text-blue-400">{selectedCaIds.length}개</strong></span>
                <span>➔</span>
                <span>선택 장비 <strong className="text-emerald-400">{selectedAssetIds.length}대</strong> 매핑</span>
              </div>

              {selectedCaIds.length !== selectedAssetIds.length && (
                <span className="text-[11px] text-rose-400 font-semibold whitespace-nowrap shrink-0">
                  수량 불일치 ({Math.abs(selectedCaIds.length - selectedAssetIds.length)}대 차이)
                </span>
              )}
            </div>

            {/* 할당 실행 버튼 */}
            <button
              type="button"
              disabled={
                isSubmitting ||
                !canEdit ||
                selectedCaIds.length === 0 ||
                selectedAssetIds.length === 0 ||
                selectedCaIds.length !== selectedAssetIds.length
              }
              onClick={handleExecuteAssignment}
              className={`w-full py-3.5 px-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all whitespace-nowrap shrink-0 ${
                selectedCaIds.length === 0 || selectedAssetIds.length === 0 || selectedCaIds.length !== selectedAssetIds.length
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30'
              }`}
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>
                {isSubmitting 
                  ? '장비 할당 처리 중...' 
                  : selectedCaIds.length === 0
                    ? '할당 대상 슬롯 선택'
                    : selectedAssetIds.length === 0
                      ? '매핑 대상 장비 선택'
                      : selectedCaIds.length !== selectedAssetIds.length
                        ? `슬롯/장비 수량 불일치 (${selectedCaIds.length} vs ${selectedAssetIds.length})`
                        : `장비 할당 실행 (${selectedCaIds.length}대)`}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
