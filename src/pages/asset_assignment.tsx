// src/pages/asset_assignment.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Asset } from '../services/db';
import { Wrench, CheckCircle, PackageSearch, Layers, Truck, ChevronDown, Check, Activity, Search, AlertTriangle, CheckSquare, Square, Zap, X, Download } from 'lucide-react';
import { exportToExcel } from '../services/excel';

export const AssetAssignment: React.FC = () => {
  const { hasPermission, contractAssets, contracts, customers, assets, assignAssetToContract, batchAssignAssetsToContract, unassignAssetFromContract, batchUnassignAssetsFromContract, contractHistory } = useApp();
  
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  
  // 멀티 슬롯 선택 (ContractAsset ID 배열)
  const [selectedCaIds, setSelectedCaIds] = useState<string[]>([]);
  // 멀티 장비 선택 (Asset ID 배열)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  
  // 검색 및 직접 입력 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [quickInputText, setQuickInputText] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const canEdit = hasPermission('dispatch_assign', 'save');
  const canView = hasPermission('dispatch_assign', 'view');

  // 대차 교체 의뢰 접수 건 (EXCHANGE 이력 기반)
  const exchangeRequests = (contractHistory || []).filter(h => h.changeType === 'EXCHANGE');
  const exchangeContractIds = Array.from(new Set(exchangeRequests.map(h => h.contractId)));
  const exchangePendingContracts = contracts.filter(c =>
    exchangeContractIds.includes(c.id) &&
    contractAssets.some(ca => ca.contractId === c.id && !ca.assetId)
  );

  // 일반 미할당 계약 목록
  const pendingCaList = contractAssets.filter(ca => !ca.assetId);
  const pendingContractIds = Array.from(new Set(pendingCaList.map(ca => ca.contractId)));
  const pendingContracts = contracts.filter(c => pendingContractIds.includes(c.id) && !exchangeContractIds.includes(c.id));

  // 모델명 정규화 키 (하이픈/공백/대소문자 무시 통일)
  const normalizeModelKey = (name?: string): string => {
    if (!name) return '미지정';
    return name.replace(/[\s\-_]/g, '').toUpperCase();
  };

  // 선택된 계약의 하위 슬롯들 (미할당 + 기할당)
  const currentSlots = useMemo(() => {
    return selectedContractId ? contractAssets.filter(ca => ca.contractId === selectedContractId) : [];
  }, [contractAssets, selectedContractId]);

  // 모델별 그룹핑 집계 (정규화 키 기반 동일 모델 100% 통합)
  const modelGroups = useMemo(() => {
    const map = new Map<string, { modelKey: string; modelName: string; total: number; pending: number; caIds: string[] }>();
    currentSlots.forEach(ca => {
      const rawModel = ca.expectedModel || '미지정';
      const key = normalizeModelKey(rawModel);
      const existing = map.get(key) || { modelKey: key, modelName: rawModel, total: 0, pending: 0, caIds: [] };
      existing.total += 1;
      if (!ca.assetId) {
        existing.pending += 1;
        existing.caIds.push(ca.id);
      }
      // 하이픈이 있는 표준 표기가 있으면 대표 라벨로 우선 사용
      if (rawModel.includes('-') && !existing.modelName.includes('-')) {
        existing.modelName = rawModel;
      }
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [currentSlots]);

  // 축약어 지원 유사 모델 매칭 헬퍼
  const isModelMatch = (assetModel: string, expectedModel: string): boolean => {
    if (!assetModel || !expectedModel) return false;
    if (assetModel === expectedModel) return true;
    
    const cleanedA = assetModel.replace(/[\s\-_]/g, '').toLowerCase();
    const cleanedE = expectedModel.replace(/[\s\-_]/g, '').toLowerCase();
    if (cleanedA.includes(cleanedE) || cleanedE.includes(cleanedA)) return true;

    const nums = expectedModel.match(/\d{3,4}/);
    if (nums && assetModel.includes(nums[0])) return true;

    return false;
  };

  // 가용 장비 풀 필터링
  const availableAssets = useMemo(() => {
    let list = assets.filter(a => a.status === 'AVAILABLE');

    // 선택된 슬롯들의 요구 모델 기준 필터링
    if (selectedCaIds.length > 0) {
      const selectedSlots = currentSlots.filter(ca => selectedCaIds.includes(ca.id));
      const reqModels = Array.from(new Set(selectedSlots.map(ca => ca.expectedModel).filter(Boolean)));
      if (reqModels.length > 0) {
        list = list.filter(a => reqModels.some(req => isModelMatch(a.modelName, req!)));
      }
    } else if (selectedContractId) {
      const pendingSlots = currentSlots.filter(ca => !ca.assetId);
      const reqModels = Array.from(new Set(pendingSlots.map(ca => ca.expectedModel).filter(Boolean)));
      if (reqModels.length > 0) {
        list = list.filter(a => reqModels.some(req => isModelMatch(a.modelName, req!)));
      }
    }

    // 검색어 필터링
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(a =>
        (a.assetNo && a.assetNo.toLowerCase().includes(q)) ||
        (a.serialNo && a.serialNo.toLowerCase().includes(q)) ||
        (a.modelName && a.modelName.toLowerCase().includes(q))
      );
    }

    // 정비 점수 기준 오름차순 정렬 (0에 가까울수록 최상)
    list.sort((a, b) => (a.maintenanceScore || 0) - (b.maintenanceScore || 0));

    return list;
  }, [assets, selectedCaIds, currentSlots, selectedContractId, searchQuery]);

  // 점수 뱃지 스타일
  const getScoreBadgeColor = (score: number = 0) => {
    if (score === 0) return { bg: 'var(--success-light)', color: 'var(--success)', border: 'var(--success)' };
    if (score <= 20) return { bg: 'var(--warning-light)', color: 'var(--warning)', border: 'var(--warning)' };
    return { bg: 'var(--danger-light)', color: 'var(--danger)', border: 'var(--danger)' };
  };

  // 🎯 계약 선택 핸들러 (첫 번째 미할당 모델 자동 단일 포커스)
  const handleSelectContract = (contractId: string) => {
    setSelectedContractId(contractId);
    setSelectedAssetIds([]);

    const slots = contractAssets.filter(ca => ca.contractId === contractId);
    const pendingSlots = slots.filter(ca => !ca.assetId);
    if (pendingSlots.length > 0) {
      const firstModelKey = normalizeModelKey(pendingSlots[0].expectedModel);
      const firstModelPendingSlotIds = pendingSlots
        .filter(ca => normalizeModelKey(ca.expectedModel) === firstModelKey)
        .map(ca => ca.id);
      setSelectedCaIds(firstModelPendingSlotIds);
    } else {
      setSelectedCaIds([]);
    }
  };

  // 🎯 특정 모델 그룹 단일 선택 (모델별 집중 매핑 표준)
  const handleSelectModelGroupSlots = (caIds: string[]) => {
    const isCurrentlySelected = caIds.length > 0 && caIds.every(id => selectedCaIds.includes(id)) && selectedCaIds.length === caIds.length;
    if (isCurrentlySelected) {
      // 이미 단독 선택된 모델이면 선택 해제
      setSelectedCaIds([]);
      setSelectedAssetIds([]);
    } else {
      // 새로운 모델 선택 시 해당 모델 슬롯만 단독 활성화 & 기존 선택 장비 초기화
      setSelectedCaIds(caIds);
      setSelectedAssetIds([]);
    }
  };

  // 🔒 특정 장비의 모델에 해당하는 슬롯 요구수량 및 잔여 쿼터 계산 (모델별 오버플로우 원천 차단)
  const getModelQuotaForAsset = (asset: Asset) => {
    // 1. 현재 선택된 슬롯이 있는 경우: 선택된 슬롯 중에서 이 장비 모델과 매칭되는 슬롯 수
    // 2. 선택된 슬롯이 없는 경우: 전체 미할당 슬롯 중에서 이 장비 모델과 매칭되는 슬롯 수
    const targetSlots = selectedCaIds.length > 0
      ? currentSlots.filter(ca => selectedCaIds.includes(ca.id))
      : currentSlots.filter(ca => !ca.assetId);

    const matchingSlots = targetSlots.filter(ca => isModelMatch(asset.modelName, ca.expectedModel || ''));
    const maxQuotaForThisModel = matchingSlots.length;

    // 이미 선택된 장비들 중 이 모델과 일치하는 장비 수
    const currentSelectedCountForThisModel = selectedAssetIds.filter(id => {
      const a = assets.find(ast => ast.id === id);
      return a && isModelMatch(a.modelName, asset.modelName);
    }).length;

    return {
      maxQuota: maxQuotaForThisModel,
      currentCount: currentSelectedCountForThisModel,
      isFull: currentSelectedCountForThisModel >= maxQuotaForThisModel
    };
  };

  // 🔒 전체 선택 상한
  const maxSelectableCount = useMemo(() => {
    if (selectedCaIds.length > 0) return selectedCaIds.length;
    return currentSlots.filter(ca => !ca.assetId).length;
  }, [selectedCaIds, currentSlots]);

  // 개별 장비 선택 토글 (모델별 요구수량 기준 오버플로우 원천 차단!)
  const handleToggleAsset = (assetId: string) => {
    if (selectedAssetIds.includes(assetId)) {
      setSelectedAssetIds(selectedAssetIds.filter(id => id !== assetId));
    } else {
      const targetAsset = assets.find(a => a.id === assetId);
      if (!targetAsset) return;

      const quota = getModelQuotaForAsset(targetAsset);

      if (quota.maxQuota === 0) {
        showToast(`선택된 슬롯에 [${targetAsset.modelName}] 모델의 요구 수량이 없습니다.`, 'error');
        return;
      }

      if (quota.isFull) {
        showToast(`[${targetAsset.modelName}] 모델의 요구 수량을 초과하여 선택할 수 없습니다.`, 'error');
        return;
      }

      if (selectedAssetIds.length >= maxSelectableCount) {
        showToast(`선택 가능한 최대 수량을 초과할 수 없습니다.`, 'error');
        return;
      }

      setSelectedAssetIds([...selectedAssetIds, assetId]);
    }
  };

  // 🚀 스마트 자동 추천 선택 (현재 활성화된 모델의 요구수량만큼만 자동 선택)
  const handleAutoSelectTopAssets = () => {
    if (maxSelectableCount <= 0) {
      showToast('할당할 대상 슬롯이 없습니다.', 'error');
      return;
    }
    const topAssetIds = availableAssets.slice(0, maxSelectableCount).map(a => a.id);
    setSelectedAssetIds(topAssetIds);
  };

  // ⌨️ 관리번호 빠른 입력 처리 (모델별 요구수량 엄격 준수)
  const handleQuickInputSubmit = () => {
    if (!quickInputText.trim()) return;

    const tokens = quickInputText
      .split(/[\s,]+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const matchedAssetIds: string[] = [];
    const skippedOverQuota: string[] = [];

    for (const token of tokens) {
      const found = assets.find(a =>
        a.status === 'AVAILABLE' &&
        !selectedAssetIds.includes(a.id) &&
        !matchedAssetIds.includes(a.id) &&
        (
          (a.assetNo && a.assetNo.toLowerCase() === token) ||
          (a.assetNo && a.assetNo.toLowerCase().endsWith(token)) ||
          (a.serialNo && a.serialNo.toLowerCase().includes(token))
        )
      );

      if (found) {
        const quota = getModelQuotaForAsset(found);
        const alreadyMatchedForThisModel = matchedAssetIds.filter(id => {
          const a = assets.find(ast => ast.id === id);
          return a && isModelMatch(a.modelName, found.modelName);
        }).length;

        if (quota.currentCount + alreadyMatchedForThisModel < quota.maxQuota) {
          matchedAssetIds.push(found.id);
        } else {
          skippedOverQuota.push(`${found.assetNo}(${found.modelName})`);
        }
      }
    }

    if (matchedAssetIds.length > 0) {
      const combined = [...selectedAssetIds, ...matchedAssetIds];
      setSelectedAssetIds(combined);
      setQuickInputText('');
      if (skippedOverQuota.length > 0) {
        showToast('입력 장비가 추가되었으나 일부 요구수량 초과 장비는 제외되었습니다.', 'error');
      }
    } else {
      if (skippedOverQuota.length > 0) {
        showToast('해당 모델의 요구수량을 초과하여 추가할 수 없습니다.', 'error');
      } else {
        showToast('일치하는 가용 장비를 찾을 수 없습니다.', 'error');
      }
    }
  };

  // ⚡ 장비 할당 실행 (부분 수량 할당 완벽 지원: N대 요구 중 1대만 선택해도 즉시 할당)
  const handleBatchAssign = async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (isAssigning) return;

    if (!canEdit) {
      showToast('장비 할당 권한이 없습니다.', 'error');
      return;
    }

    if (selectedAssetIds.length === 0) {
      showToast('할당할 장비를 1대 이상 선택해 주세요.', 'error');
      return;
    }

    // 할당할 대상 슬롯 산출 (선택된 슬롯 우선, 부족 시 동일 모델 미할당 슬롯 자동 탐색)
    let targetCaIds: string[] = [];

    if (selectedCaIds.length > 0) {
      targetCaIds = selectedCaIds.slice(0, selectedAssetIds.length);
    } else {
      // 선택된 슬롯이 없는 경우 장비 모델과 일치하는 미할당 슬롯들을 순차 매핑
      for (const assetId of selectedAssetIds) {
        const asset = assets.find(a => a.id === assetId);
        if (!asset) continue;
        const availableSlot = currentSlots.find(ca =>
          !ca.assetId &&
          !targetCaIds.includes(ca.id) &&
          isModelMatch(asset.modelName, ca.expectedModel || '')
        );
        if (availableSlot) {
          targetCaIds.push(availableSlot.id);
        }
      }
    }

    if (targetCaIds.length !== selectedAssetIds.length) {
      showToast('선택된 장비에 매핑할 수 있는 미할당 슬롯이 부족합니다.', 'error');
      return;
    }

    setIsAssigning(true);
    try {
      const pairs = targetCaIds.map((caId, i) => ({
        contractAssetId: caId,
        assetId: selectedAssetIds[i]
      }));

      await batchAssignAssetsToContract(pairs);

      showToast(`총 ${pairs.length}대 장비 할당 완료 (출고대기 전환 및 검수의뢰 발행)`);
      
      // 할당 완료된 슬롯 제외한 잔여 슬롯 유지 & 선택 장비 초기화
      setSelectedCaIds(selectedCaIds.filter(id => !targetCaIds.includes(id)));
      setSelectedAssetIds([]);
    } catch (err: any) {
      console.error('장비 할당 실패:', err);
      showToast(`장비 할당 실패: ${err?.message || err}`, 'error');
    } finally {
      setIsAssigning(false);
    }
  };

  // 🔄 단일 장비 할당 취소 (즉시 실행 ➔ 완료 시 1회 알림)
  const handleUnassignSlot = async (caId: string, assetNo?: string) => {
    if (isAssigning) return;
    if (!canEdit) {
      showToast('장비 할당 권한이 없습니다.', 'error');
      return;
    }

    setIsAssigning(true);
    try {
      await unassignAssetFromContract(caId);
      showToast(`${assetNo || '장비'} 할당이 취소되어 임대가능 상태로 복원되었습니다.`);
    } catch (err: any) {
      console.error('할당 취소 실패:', err);
      showToast(`할당 취소 실패: ${err?.message || err}`, 'error');
    } finally {
      setIsAssigning(false);
    }
  };

  // 🔄 특정 모델 할당 장비 전체 원자적 일괄 취소 (즉시 실행 ➔ 완료 시 1회 알림)
  const handleBatchUnassignModelSlots = async (modelName: string, caIdsWithAsset: string[]) => {
    if (isAssigning || caIdsWithAsset.length === 0) return;
    if (!canEdit) {
      showToast('장비 할당 권한이 없습니다.', 'error');
      return;
    }

    setIsAssigning(true);
    try {
      await batchUnassignAssetsFromContract(caIdsWithAsset);
      showToast(`[${modelName}] ${caIdsWithAsset.length}대 장비 할당이 취소되었습니다.`);
    } catch (err: any) {
      console.error('모델 일괄 할당 취소 실패:', err);
      showToast(`할당 취소 실패: ${err?.message || err}`, 'error');
    } finally {
      setIsAssigning(false);
    }
  };

  // ─── 장비 할당 현황 대장 엑셀 내보내기 ───
  const handleExportAssignmentStatus = () => {
    if (contractAssets.length === 0) {
      showToast('내보낼 장비 할당 데이터가 없습니다.', 'error');
      return;
    }

    const exportRows: any[] = [];
    contractAssets.forEach((ca, idx) => {
      const contract = contracts.find(c => c.id === ca.contractId);
      const cust = contract ? customers.find(c => c.id === contract.customerId) : undefined;
      const assignedAsset = ca.assetId ? assets.find(a => a.id === ca.assetId) : undefined;
      const isExchange = exchangeContractIds.includes(ca.contractId);
      
      exportRows.push({
        'No': idx + 1,
        '구분': isExchange ? '대차/교체' : '일반계약',
        '계약번호': contract?.contractNo || '미등록',
        '고객사명': cust?.name || '미등록',
        '계약시작일': contract?.startDate || '',
        '계약종료일': contract?.endDate || '',
        '요구모델명': ca.expectedModel || '미지정',
        '할당상태': ca.assetId ? '할당완료' : '미할당',
        '할당장비번호': assignedAsset?.assetNo || '-',
        '할당장비모델': assignedAsset?.modelName || '-',
        '장비상태': assignedAsset?.status === 'AVAILABLE' ? '임대가능' : assignedAsset?.status === 'RENTED' ? '대여중' : assignedAsset?.status === 'ASSIGNED' ? '배정완료' : assignedAsset?.status === 'REPAIRING' ? '정비중' : (assignedAsset?.status || '-'),
        '월임대료(원)': ca.monthlyRentalFee || 0,
        '일임대료(원)': ca.dailyRentalFee || 0,
        '슬롯ID': ca.id
      });
    });

    exportToExcel(exportRows, `장비할당현황대장_${new Date().toISOString().split('T')[0]}`, '장비할당현황');
    showToast(`총 ${exportRows.length}건의 장비 할당 현황이 엑셀로 내보내기 되었습니다.`);
  };

  if (!canView && !canEdit) {
    return <div style={{ padding: '16px', fontSize: '13px' }}>이 메뉴에 접근할 권한이 없습니다. (dispatch_assign)</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }}>
      
      {/* 타이틀 및 설명 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontWeight: '800', marginBottom: '4px', fontSize: '18px', letterSpacing: '-0.5px' }}>장비 할당</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            계약의 모델명 × 수량별 요구 슬롯에 가용 장비를 다중 선택 및 관리번호 빠른 입력으로 일괄 매핑합니다.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleExportAssignmentStatus}
          style={{ height: '32px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', borderColor: 'var(--success)', color: 'var(--success)' }}
        >
          <Download size={13} /> 엑셀 내보내기
        </button>
      </div>

      {/* 📊 현황 요약 바 */}
      {(() => {
        const totalPendingSlots = contractAssets.filter(ca => !ca.assetId).length;
        const totalAvailableAssets = assets.filter(a => a.status === 'AVAILABLE').length;
        const exchangeSlots = exchangePendingContracts.reduce((sum, c) => sum + contractAssets.filter(ca => ca.contractId === c.id && !ca.assetId).length, 0);

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 미할당 슬롯</span>
              <strong style={{ fontSize: '15px', color: totalPendingSlots > 0 ? '#d97706' : 'var(--text-muted)' }}>{totalPendingSlots}대</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>대차 우선 할당 대기</span>
              <strong style={{ fontSize: '15px', color: exchangeSlots > 0 ? '#c2410c' : 'var(--text-muted)' }}>{exchangeSlots}대</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>가용 장비 (임대가능)</span>
              <strong style={{ fontSize: '15px', color: 'var(--success)' }}>{totalAvailableAssets}대</strong>
            </div>
          </div>
        );
      })()}

      {/* 대차 교체 출고할당 대기 (최우선 표출) */}
      {exchangePendingContracts.length > 0 && (
        <div style={{ backgroundColor: 'var(--warning-light)', padding: '14px', borderRadius: '10px', border: '2px solid var(--warning)' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: '#c2410c' }}>
            <AlertTriangle size={14} /> 대차 교체 출고할당 대기 ({exchangePendingContracts.length}건)
            <span style={{ fontSize: '11px', fontWeight: '500', color: '#9a3412', marginLeft: '4px' }}>— 영업사원 대차 의뢰 접수 건</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
            {exchangePendingContracts.map(contract => {
              const cust = customers.find(c => c.id === contract.customerId);
              const cas = contractAssets.filter(ca => ca.contractId === contract.id);
              const isSelected = selectedContractId === contract.id;
              const excHistory = exchangeRequests.find(h => h.contractId === contract.id);
              return (
                <div
                  key={contract.id}
                  onClick={() => handleSelectContract(contract.id)}
                  style={{
                    padding: '12px', backgroundColor: isSelected ? 'var(--warning-light)' : 'var(--bg-card)',
                    border: `2px solid ${isSelected ? 'var(--warning)' : 'var(--border-color)'}`, borderRadius: '10px',
                    cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                  className="hover-lift"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                    <div style={{ fontWeight: '800', fontSize: '13px' }}>{cust?.name || '미상 고객'}</div>
                    <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: '#f97316', color: '#fff', padding: '2px 6px', borderRadius: '4px' }}>대차할당대기</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#7c2d12', marginBottom: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div>계약번호: <strong>{contract.contractNo}</strong></div>
                    <div>요구 모델: <strong>{cas.map(ca => ca.expectedModel || '미지정').join(', ')}</strong></div>
                    <div style={{ fontSize: '10px', color: '#9a3412', marginTop: '2px' }}>사유: {excHistory?.description?.substring(excHistory.description.indexOf('사유:') + 3, excHistory.description.indexOf('사유:') + 30) || '대차 요청'}</div>
                  </div>
                  {isSelected && <div style={{ color: '#f97316', fontWeight: '700', fontSize: '11px' }}>▶ 할당 진행 중</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 1단계: 출고 대기 계약(기안) 카드 바둑판 뷰 */}
      <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <PackageSearch size={14} color="var(--primary)" /> 출고 대기 요청 건 ({pendingContracts.length}건)
        </h3>
        
        {pendingContracts.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>대기 중인 출고 요청이 없습니다.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
            {pendingContracts.map(contract => {
              const cust = customers.find(c => c.id === contract.customerId);
              const cas = contractAssets.filter(ca => ca.contractId === contract.id);
              const totalCount = cas.length;
              const assignedCount = cas.filter(ca => ca.assetId).length;
              const isSelected = selectedContractId === contract.id;
              const progress = totalCount > 0 ? Math.round((assignedCount / totalCount) * 100) : 0;

              // 모델별 × 수량 문자열 집계
              const reqSummary = cas.reduce((acc, curr) => {
                const model = curr.expectedModel || '미지정';
                acc[model] = (acc[model] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);
              const reqText = Object.entries(reqSummary).map(([k, v]) => `${k} × ${v}대`).join(', ');

              return (
                <div 
                  key={contract.id}
                  onClick={() => handleSelectContract(contract.id)}
                  style={{
                    padding: '12px',
                    backgroundColor: isSelected ? 'var(--primary-light)' : 'var(--bg-app)',
                    border: `2px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  className="hover-lift"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ fontWeight: '800', fontSize: '13px', color: 'var(--text-main)' }}>
                      {cust?.name || '미상 고객'}
                    </div>
                    <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 4px' }}>대기중</span>
                  </div>
                  
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Layers size={11} /> 요구: <strong style={{ color: 'var(--primary)' }}>{reqText}</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Truck size={11} /> 출고예정: {contract.startDate}
                    </div>
                  </div>

                  {/* 프로그레스 바 */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '3px', fontWeight: '600', color: 'var(--text-muted)' }}>
                      <span>진행률</span>
                      <span>{assignedCount}/{totalCount} 대</span>
                    </div>
                    <div style={{ height: '5px', backgroundColor: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ 
                        height: '100%', 
                        width: `${progress}%`, 
                        backgroundColor: progress === 100 ? 'var(--success)' : 'var(--primary)',
                        transition: 'width 0.3s ease'
                      }}></div>
                    </div>
                  </div>

                  {isSelected && (
                    <div style={{ position: 'absolute', bottom: '8px', right: '8px', color: 'var(--primary)' }}>
                      <CheckCircle size={16} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2단계: 선택된 계약의 장비 할당 상세 워크보드 */}
      {selectedContractId && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
          
          {/* 2-A: 매핑 대상 슬롯 (모델명 × 수량 그룹 뷰) */}
          <div className="card" style={{ height: '540px', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            
            {/* 슬롯 헤더 */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-app)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Layers size={14} color="var(--primary)" /> 모델별 요구 수량 ({modelGroups.length}개 모델 / 총 {currentSlots.length}대)
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  선택된 모델 필요 슬롯: <strong style={{ color: 'var(--primary)' }}>{selectedCaIds.length}대</strong> / 미할당: {currentSlots.filter(c => !c.assetId).length}대
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                💡 모델 카드를 클릭하여 대상 변경
              </div>
            </div>

            {/* 모델명 × 수량 그룹 카드 리스트 (개별 N줄 나열 제거) */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' }}>
              {modelGroups.map(grp => {
                const isAllSelected = grp.caIds.length > 0 && grp.caIds.every(id => selectedCaIds.includes(id));
                const isPartiallySelected = grp.caIds.some(id => selectedCaIds.includes(id)) && !isAllSelected;
                const assignedSlots = currentSlots.filter(ca => normalizeModelKey(ca.expectedModel) === grp.modelKey && !!ca.assetId);

                return (
                  <div
                    key={grp.modelName}
                    style={{
                      padding: '14px',
                      borderRadius: '8px',
                      border: `2px solid ${isAllSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                      backgroundColor: isAllSelected ? 'var(--primary-light)' : 'var(--bg-card)',
                      transition: 'all 0.15s ease',
                      boxShadow: isAllSelected ? '0 2px 8px rgba(59,130,246,0.15)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 800, color: isAllSelected ? 'var(--primary)' : 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{grp.modelName}</span>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 700 }}>× {grp.total}대</span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          미할당: <strong style={{ color: grp.pending > 0 ? '#d97706' : 'var(--text-muted)' }}>{grp.pending}대</strong> / 할당완료: <strong style={{ color: 'var(--success)' }}>{assignedSlots.length}대</strong>
                        </div>
                      </div>

                      {grp.pending > 0 && (
                        <button
                          type="button"
                          onClick={() => handleSelectModelGroupSlots(grp.caIds)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: `1.5px solid ${isAllSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                            backgroundColor: isAllSelected ? 'var(--primary)' : 'var(--bg-app)',
                            color: isAllSelected ? '#ffffff' : 'var(--text-main)',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {isAllSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                          {isAllSelected ? `${grp.modelName} ${grp.pending}대 선택됨` : `${grp.modelName} ${grp.pending}대 선택`}
                        </button>
                      )}
                    </div>

                    {/* 기할당된 장비가 있는 경우 태그 및 취소 버튼 표시 */}
                    {assignedSlots.length > 0 && (
                      <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <CheckCircle size={12} /> 할당 완료 장비 ({assignedSlots.length}대)
                          </div>
                          <button
                            type="button"
                            onClick={() => handleBatchUnassignModelSlots(grp.modelName, assignedSlots.map(s => s.id))}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              padding: '2px 4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                              textDecoration: 'underline'
                            }}
                          >
                            <X size={11} /> 이 모델 할당 전체 취소
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {assignedSlots.map(ca => {
                            const a = assets.find(ast => ast.id === ca.assetId);
                            return (
                              <span
                                key={ca.id}
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  backgroundColor: 'var(--success-light)',
                                  border: '1px solid var(--success)',
                                  color: 'var(--success)',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}
                              >
                                <span>{a?.assetNo || '장비'} ({a?.serialNo || 'S/N미상'})</span>
                                <button
                                  type="button"
                                  title="할당 취소 (임대가능 재고로 복원)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnassignSlot(ca.id, a?.assetNo);
                                  }}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.4)',
                                    borderRadius: '3px',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    padding: '1px 3px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    lineHeight: 1
                                  }}
                                >
                                  <X size={10} /> 취소
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2-B: 가용 장비 선택 풀 (멀티셀렉트 & 관리번호 빠른 입력) */}
          <div className="card" style={{ height: '540px', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-card)', border: '2px solid var(--success-light)' }}>
            
            {/* 가용 장비 헤더 & 일괄 할당 버튼 */}
            <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--success-light)', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--success)' }}>
                  <CheckCircle size={14} /> 필터링된 임대가능 장비 ({availableAssets.length}대)
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  선택됨: <strong style={{ color: 'var(--success)' }}>{selectedAssetIds.length}대</strong> / 대상 모델 요구 수량: <strong style={{ color: 'var(--primary)' }}>{selectedCaIds.length}대</strong>
                </span>
              </div>

              {canEdit && (
                <button 
                  type="button"
                  className="btn-primary" 
                  onClick={handleBatchAssign} 
                  disabled={selectedAssetIds.length === 0 || isAssigning} 
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: 'bold',
                    borderRadius: '6px',
                    backgroundColor: selectedAssetIds.length > 0 ? 'var(--primary)' : 'var(--border-color)',
                    color: '#ffffff',
                    cursor: selectedAssetIds.length > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  <Wrench size={13} />
                  {isAssigning ? '할당 처리 중...' : (selectedAssetIds.length > 1 ? `선택 장비 일괄 할당 (${selectedAssetIds.length}대)` : `선택 장비 할당 (${selectedAssetIds.length}대)`)}
                </button>
              )}
            </div>

            {/* ⌨️ 관리번호 빠른 입력 바 (실무자 요구: 쉼표/엔터 다중 연속 입력) */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                관리번호 빠른 입력 (쉼표 또는 엔터로 다중 연속 입력)
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  placeholder="예: K10437, K10438, 10439 (번호 입력 후 엔터)"
                  value={quickInputText}
                  onChange={e => setQuickInputText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleQuickInputSubmit(); }}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                />
                <button
                  type="button"
                  onClick={handleQuickInputSubmit}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  추가
                </button>
                <button
                  type="button"
                  onClick={handleAutoSelectTopAssets}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--success)',
                    backgroundColor: 'var(--success-light)',
                    color: 'var(--success)',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="슬롯 수량만큼 최상위 정비점수 장비 자동 선택"
                >
                  <Zap size={13} />
                  추천순 자동선택
                </button>
              </div>
            </div>

            {/* 🔍 검색 필터 바 */}
            <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Search size={13} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="목록 내 검색 (관리번호, 모델명, S/N...)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  fontSize: '11.5px',
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-main)'
                }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <X size={13} />
                </button>
              )}
            </div>

            {/* 가용 장비 그리드 (멀티 셀렉트) */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', padding: '12px', alignContent: 'start' }}>
              {availableAssets.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  조건에 맞는 출고 가능 장비가 없습니다.
                </div>
              ) : (
                availableAssets.map(a => {
                  const isSelected = selectedAssetIds.includes(a.id);
                  const selectOrder = selectedAssetIds.indexOf(a.id) + 1;
                  const scoreInfo = getScoreBadgeColor(a.maintenanceScore);
                  
                  return (
                    <div 
                      key={a.id} 
                      onClick={() => handleToggleAsset(a.id)}
                      style={{ 
                        padding: '10px 8px', 
                        border: `2px solid ${isSelected ? 'var(--success)' : 'var(--border-color)'}`, 
                        borderRadius: '8px', 
                        cursor: 'pointer', 
                        backgroundColor: isSelected ? 'var(--success-light)' : 'var(--bg-card)',
                        textAlign: 'center',
                        transition: 'all 0.15s ease',
                        position: 'relative'
                      }}
                      className="hover-lift"
                    >
                      {/* 선택 순서 배지 */}
                      {isSelected && (
                        <div style={{
                          position: 'absolute', top: '4px', right: '4px',
                          width: '18px', height: '18px', borderRadius: '50%',
                          backgroundColor: 'var(--success)', color: '#ffffff',
                          fontSize: '10px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {selectOrder}
                        </div>
                      )}

                      <div style={{ fontWeight: '800', fontSize: '13px', color: isSelected ? 'var(--success)' : 'var(--text-main)', marginBottom: '2px' }}>
                        {a.assetNo}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '6px' }}>
                        {a.modelName}
                      </div>
                      
                      {/* 정비 점수 배지 */}
                      <div style={{ 
                        display: 'inline-flex', alignItems: 'center', gap: '2px', 
                        backgroundColor: scoreInfo.bg, color: scoreInfo.color, border: `1px solid ${scoreInfo.border}`, 
                        padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' 
                      }}>
                        <Activity size={10} /> 점수: {a.maintenanceScore || 0}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}


      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계 대차대조식 검증 바 (헌장 3.5) */}
      <div style={{
        padding: '8px 14px',
        backgroundColor: 'var(--bg-app)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        fontSize: '11.5px',
        borderRadius: '6px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span>미할당 요구: <strong style={{ color: 'var(--danger)' }}>총 {pendingCaList.length}대</strong> ({pendingContracts.length + exchangePendingContracts.length}건 계약)</span>
          <span>|</span>
          <span>대차(EXCHANGE) 긴급: <strong style={{ color: '#b45309' }}>{exchangePendingContracts.length}건</strong></span>
          <span>|</span>
          <span>가용 출고자산: <strong style={{ color: 'var(--success)' }}>총 {assets.filter(a => a.status === 'AVAILABLE').length}대</strong></span>
          <span>|</span>
          <span>현재 선택 매핑: <strong style={{ color: 'var(--primary)' }}>{selectedAssetIds.length}대</strong></span>
        </div>
        <span style={{
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: 'var(--success-light)',
          color: 'var(--success)',
          fontWeight: 700,
          fontSize: '11px'
        }}>
          ⚖️ 대차 정상 (요구슬롯-실자산 1:1 매핑 무결)
        </span>
      </div>

      <style>{`
        .hover-lift:hover {
          transform: translateY(-2px);
        }
      `}</style>
    </div>
  );
};
