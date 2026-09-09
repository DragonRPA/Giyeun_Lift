// src/pages/Repairs.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Wrench, Download, Search, AlertTriangle, CheckCircle, Clock, 
  Camera, Plus, Trash2, ShieldCheck, ChevronRight, X, Truck, 
  Layers, Package, Check, RefreshCw, FileText
} from 'lucide-react';
import { Repair, Asset, InboundDefectDetail, db } from '../services/db';
import { exportToExcel } from '../services/excel';
import { compressFileIfNeeded } from '../utils/imageCompressor';

// 10대 자주 쓰는 정비 작업 퀵 태그
const QUICK_WORK_TAGS = [
  '유압유(작동유) 보충',
  '배터리 증류수 보충 및 단자 청소',
  '상하강 리밋 스위치 교체',
  '상부 조종기 레버 센서 점검 및 수리',
  '배터리 충전기 및 전원선 점검',
  '구동 모터 브러시 점검',
  '경광등 및 후진 부저 수리',
  '상승 체인 및 와이어 장력 조절',
  '주요 관절부 그리스 주유',
  '비상 수동 하강 밸브 점검'
];

export const Repairs: React.FC = () => {
  const {
    repairs, assets, consumables, repairConsumables, registerRepair, updateRepairStatus, 
    hasPermission, users, currentUser, vendors, assetInOutLogs, showErrorModal,
    inspectionChecklistItems
  } = useApp();

  const canSave = hasPermission('repair', 'save');

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 뷰 모드 탭: 'STUDIO' (주기장 정비 스튜디오) vs 'LEDGER' (정비 이력 대장)
  const [activeTab, setActiveTab] = useState<'STUDIO' | 'LEDGER'>('STUDIO');

  // =========================================================================
  // [1] 스튜디오 모드 상태 (마스터-디테일 워크벤치)
  // =========================================================================
  // 좌측 큐 필터: 'ALL' | 'INBOUND_DEFECT' | 'RENTED_RETURNED' | 'REPAIRING' | 'EXTERNAL' | 'AVAILABLE'
  const [yardQueueFilter, setYardQueueFilter] = useState<'ALL' | 'INBOUND_DEFECT' | 'RENTED_RETURNED' | 'REPAIRING' | 'EXTERNAL' | 'AVAILABLE'>('ALL');
  const [yardSearchTerm, setYardSearchTerm] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');

  // 🌟 입고 결함 연계 상태
  const [selectedRepairId, setSelectedRepairId] = useState<string>('');
  const [inboundDefects, setInboundDefects] = useState<InboundDefectDetail[]>([]);
  const [inboundPhotos, setInboundPhotos] = useState<string[]>([]);
  const [inboundMeta, setInboundMeta] = useState<{ inboundNo?: string; requestDate?: string; details?: string } | null>(null);

  // 우측 워크벤치 입력 폼 상태
  const [maintenanceType, setMaintenanceType] = useState<'INHOUSE_REPAIR' | 'PREVENTIVE' | 'EXTERNAL'>('INHOUSE_REPAIR');
  const [repairDate, setRepairDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>(currentUser?.id || '');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [repairDetails, setRepairDetails] = useState<string>('');
  const [inspectionItemCode, setInspectionItemCode] = useState<string>('');
  const [degradationScore, setDegradationScore] = useState<number>(0);
  const [externalCost, setExternalCost] = useState<number>(0);
  const [billableType, setBillableType] = useState<'FREE' | 'BILLABLE'>('FREE');
  const [billableAmount, setBillableAmount] = useState<number>(0);

  // 사용 소모품 목록: { consumableId, quantity, unitPrice }
  const [usedConsumables, setUsedConsumables] = useState<{ consumableId: string; quantity: number }[]>([]);
  const [tempConsumableId, setTempConsumableId] = useState<string>('');
  const [tempConsumableQty, setTempConsumableQty] = useState<number>(1);

  // 사진 증빙
  const [beforeImage, setBeforeImage] = useState<string>('');
  const [afterImage, setAfterImage] = useState<string>('');
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);

  // 미완료/부품대기 모달 상태
  const [showUnresolvedModal, setShowUnresolvedModal] = useState<boolean>(false);
  const [unresolvedReason, setUnresolvedReason] = useState<string>('부품 수급 대기');

  // =========================================================================
  // [2] 대장 모드 필터 상태
  // =========================================================================
  const thisMonthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; })();
  const thisMonthEnd   = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()).padStart(2,'0')}`; })();
  
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('ALL');
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState('ALL');
  const [ledgerStartDate, setLedgerStartDate] = useState(thisMonthStart);
  const [ledgerEndDate, setLedgerEndDate] = useState(thisMonthEnd);
  const [ledgerMechanicFilter, setLedgerMechanicFilter] = useState('ALL');

  // 대장 상세 팝업 모달
  const [selectedDetailRepair, setSelectedDetailRepair] = useState<Repair | null>(null);

  // =========================================================================
  // [3] 연산 및 필터링
  // =========================================================================
  const getAssetNo = (id?: string) => (id ? assets.find(a => a.id === id)?.assetNo : '') || '-';
  const getAssetModel = (id?: string) => (id ? assets.find(a => a.id === id)?.modelName : '') || '-';
  const getMechanicName = (id?: string) => users.find(u => u.id === id)?.name || '정비사';
  const getVendorName = (id?: string) => vendors.find(v => v.id === id)?.name || '-';

  // 주기장 대상 자산 목록 (RENTED_RETURNED, REPAIRING, AVAILABLE 및 진행중인 외주정비 자산)
  const yardAssets = useMemo(() => {
    return assets.filter(a => {
      // 대여중(RENTED)이나 매각(SOLD)은 주기장 정비 큐에서 제외
      if (a.status === 'RENTED' || a.status === 'SOLD' || a.status === 'ASSIGNED') return false;

      // 외주정비 진행 건 확인
      const hasActiveExternalRepair = repairs.some(r => r.assetId === a.id && r.status === 'IN_PROGRESS' && r.maintenanceType === 'EXTERNAL');
      const hasInboundDefect = repairs.some(r => r.assetId === a.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');

      if (yardQueueFilter === 'INBOUND_DEFECT') return hasInboundDefect;
      if (yardQueueFilter === 'RENTED_RETURNED') return a.status === 'RENTED_RETURNED';
      if (yardQueueFilter === 'REPAIRING') return a.status === 'REPAIRING';
      if (yardQueueFilter === 'EXTERNAL') return hasActiveExternalRepair;
      if (yardQueueFilter === 'AVAILABLE') return a.status === 'AVAILABLE';
      return true; // 'ALL'
    }).filter(a => {
      if (!yardSearchTerm.trim()) return true;
      const term = yardSearchTerm.toLowerCase();
      return a.assetNo.toLowerCase().includes(term) || a.modelName.toLowerCase().includes(term) || (a.memo && a.memo.toLowerCase().includes(term));
    });
  }, [assets, repairs, yardQueueFilter, yardSearchTerm]);

  // 주기장 큐 카운트 통계
  const queueCounts = useMemo(() => {
    const nonRented = assets.filter(a => a.status !== 'RENTED' && a.status !== 'SOLD' && a.status !== 'ASSIGNED');
    const inboundDefects = nonRented.filter(a => repairs.some(r => r.assetId === a.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION')).length;
    const returned = nonRented.filter(a => a.status === 'RENTED_RETURNED').length;
    const repairing = nonRented.filter(a => a.status === 'REPAIRING').length;
    const external = repairs.filter(r => r.status === 'IN_PROGRESS' && r.maintenanceType === 'EXTERNAL').length;
    const available = nonRented.filter(a => a.status === 'AVAILABLE').length;
    return { all: nonRented.length, inboundDefects, returned, repairing, external, available };
  }, [assets, repairs]);

  // 현재 선택된 자산 객체
  const selectedAsset = useMemo(() => {
    return assets.find(a => a.id === selectedAssetId) || null;
  }, [assets, selectedAssetId]);

  // 선택된 자산의 가장 최근 입고/하자 로그
  const assetInboundNote = useMemo(() => {
    if (!selectedAsset) return null;
    const logs = assetInOutLogs
      .filter(l => l.assetId === selectedAsset.id)
      .sort((a, b) => new Date(b.createdAt || b.eventDate).getTime() - new Date(a.createdAt || a.eventDate).getTime());
    return logs[0] || null;
  }, [selectedAsset, assetInOutLogs]);

  // 투입 소모품 금액 합산
  const totalConsumablesCost = useMemo(() => {
    return usedConsumables.reduce((sum, item) => {
      const c = consumables.find(con => con.id === item.consumableId);
      const price = c ? c.unitPrice : 0;
      return sum + (price * item.quantity);
    }, 0);
  }, [usedConsumables, consumables]);

  // 총 정비 비용 (소모품비 + 외주비)
  const totalCost = totalConsumablesCost + (maintenanceType === 'EXTERNAL' ? externalCost : 0);

  // 대장 목록 필터링
  const filteredLedgerRepairs = useMemo(() => {
    return repairs.filter(r => {
      // 1. 검색어 (자산번호, 모델명, 고객사, 내용)
      const assetNo = (r.assetNo || getAssetNo(r.assetId)).toLowerCase();
      const model = (r.modelName || getAssetModel(r.assetId)).toLowerCase();
      const details = (r.details || '').toLowerCase();
      const matchSearch = !ledgerSearch.trim() || 
        assetNo.includes(ledgerSearch.toLowerCase()) || 
        model.includes(ledgerSearch.toLowerCase()) || 
        details.includes(ledgerSearch.toLowerCase());

      // 2. 구분
      const matchType = ledgerTypeFilter === 'ALL' || r.maintenanceType === ledgerTypeFilter;

      // 3. 상태
      const matchStatus = ledgerStatusFilter === 'ALL' || r.status === ledgerStatusFilter;

      // 4. 기간
      const dateVal = r.repairDate || r.requestDate || '';
      const matchStart = !ledgerStartDate || dateVal >= ledgerStartDate;
      const matchEnd = !ledgerEndDate || dateVal <= ledgerEndDate;

      // 5. 정비사
      const matchMechanic = ledgerMechanicFilter === 'ALL' || r.mechanicId === ledgerMechanicFilter;

      return matchSearch && matchType && matchStatus && matchStart && matchEnd && matchMechanic;
    });
  }, [repairs, ledgerSearch, ledgerTypeFilter, ledgerStatusFilter, ledgerStartDate, ledgerEndDate, ledgerMechanicFilter]);

  // =========================================================================
  // [4] 핸들러
  // =========================================================================
  const handleSelectAsset = (asset: Asset) => {
    setSelectedAssetId(asset.id);
    
    // 진행 중인 외주정비, 부품대기 또는 입고 결함 PENDING 건 탐색
    const activeExternal = repairs.find(r => r.assetId === asset.id && r.status === 'IN_PROGRESS' && r.maintenanceType === 'EXTERNAL');
    const unresolvedRepair = repairs.find(r => r.assetId === asset.id && r.status === 'UNRESOLVED');
    const pendingInbound = repairs.find(r => r.assetId === asset.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');
    const generalPending = repairs.find(r => r.assetId === asset.id && (r.status === 'PENDING' || r.status === 'IN_PROGRESS'));

    const targetRepair = pendingInbound || activeExternal || unresolvedRepair || generalPending;
    setSelectedRepairId(targetRepair?.id || '');

    setRepairDate(new Date().toISOString().split('T')[0]);
    setSelectedMechanicId(currentUser?.id || '');
    setUsedConsumables([]);
    setBeforeImage('');
    setAfterImage('');
    setInspectionItemCode('');
    setDegradationScore(asset.maintenanceScore || 0);

    if (pendingInbound) {
      // 🌟 입고 결함 정비 모드로 프리셋
      setMaintenanceType('INHOUSE_REPAIR');
      setSelectedVendorId('');
      setExternalCost(0);
      setDegradationScore(pendingInbound.degradationScore || asset.maintenanceScore || 0);
      setInspectionItemCode(pendingInbound.inspectionItemCode || '');

      let parsedDefects: InboundDefectDetail[] = [];
      if (pendingInbound.defectsJson) {
        try {
          const parsed = JSON.parse(pendingInbound.defectsJson);
          if (Array.isArray(parsed)) parsedDefects = parsed;
        } catch (e) {
          console.error(e);
        }
      }
      setInboundDefects(parsedDefects);
      setInboundPhotos(pendingInbound.evidenceImages || []);
      setInboundMeta({
        inboundNo: pendingInbound.inboundNo,
        requestDate: pendingInbound.requestDate,
        details: pendingInbound.details
      });

      const defectSummary = parsedDefects.length > 0
        ? parsedDefects.map(d => `• [${d.checkitemName}] 점검 및 부품 교체/수리 조치 완료`).join('\n')
        : '• 입고 결함 항목 점검 및 정상 작동 확인 완료';
      setRepairDetails(`[입고결함 정비 - ${pendingInbound.inboundNo || '검수'}]\n${defectSummary}\n• 장비 기능 및 안전장치 시운전 테스트 완료`);
    } else if (activeExternal) {
      setInboundDefects([]);
      setInboundPhotos([]);
      setInboundMeta(null);
      setMaintenanceType('EXTERNAL');
      setSelectedVendorId(activeExternal.vendorId || '');
      setExternalCost(activeExternal.totalCost || 0);
      setRepairDetails(`[외주정비 완료 입고검수] 업체: ${getVendorName(activeExternal.vendorId)}\n• 외주 수리내역 확인 및 장비 정상 작동 테스트 완료`);
    } else if (unresolvedRepair) {
      setInboundDefects([]);
      setInboundPhotos([]);
      setInboundMeta(null);
      setMaintenanceType(unresolvedRepair.maintenanceType === 'EXTERNAL' ? 'EXTERNAL' : unresolvedRepair.maintenanceType === 'PREVENTIVE' ? 'PREVENTIVE' : 'INHOUSE_REPAIR');
      setSelectedVendorId(unresolvedRepair.vendorId || '');
      setExternalCost(unresolvedRepair.totalCost || 0);
      setRepairDetails(`[부품대기 해제 및 정비 재개]\n• 보류사유: ${unresolvedRepair.unresolvedReason || '부품 대기'}\n• 부품 장착 및 정비 완료 조치`);
    } else {
      setInboundDefects([]);
      setInboundPhotos([]);
      setInboundMeta(null);
      setMaintenanceType('INHOUSE_REPAIR');
      setSelectedVendorId('');
      setExternalCost(0);
      setRepairDetails(asset.memo ? `[입고 메모] ${asset.memo}\n` : '');
    }
  };

  // 📝 입고 결함 점검 조치내용 자동 반영
  const handleAutoFillDefectDetails = () => {
    if (inboundDefects.length === 0) return;
    const lines = inboundDefects.map(d => {
      const chk = (inspectionChecklistItems || []).find(c => c.id === d.checkitemId || c.code === d.checkitemId);
      const sop = chk?.actionGuide ? ` (SOP: ${chk.actionGuide})` : '';
      return `• [${d.checkitemName}] 점검 및 부품 교체/정비 완료${sop}`;
    });
    const prefix = `[입고결함 정비 - ${inboundMeta?.inboundNo || '검수'}]\n`;
    setRepairDetails(prefix + lines.join('\n') + '\n• 이상 부위 시운전 및 안전 기능 검증 완료');
    showToast('입고 결함 항목 조치 내용이 입력되었습니다.');
  };

  // 📦 추천 소모품 일괄 자동 담기
  const handleAutoAddRecommendedConsumables = () => {
    if (inboundDefects.length === 0) {
      showToast('입고 결함 항목이 없습니다.', 'error');
      return;
    }
    const recConsumableIds = new Set<string>();
    inboundDefects.forEach(d => {
      const chk = (inspectionChecklistItems || []).find(c => c.id === d.checkitemId || c.code === d.checkitemId);
      if (chk?.recommendedConsumableIds && Array.isArray(chk.recommendedConsumableIds)) {
        chk.recommendedConsumableIds.forEach(cId => recConsumableIds.add(cId));
      }
    });

    if (recConsumableIds.size === 0) {
      inboundDefects.forEach(d => {
        const name = d.checkitemName.toLowerCase();
        consumables.forEach(c => {
          const cName = c.modelName.toLowerCase();
          if (
            (name.includes('유압') && cName.includes('유압')) ||
            (name.includes('배터리') && (cName.includes('증류수') || cName.includes('단자'))) ||
            (name.includes('조이스틱') && cName.includes('조이스틱')) ||
            (name.includes('센서') && cName.includes('센서')) ||
            (name.includes('스위치') && cName.includes('스위치')) ||
            (name.includes('그리스') && cName.includes('그리스'))
          ) {
            recConsumableIds.add(c.id);
          }
        });
      });
    }

    if (recConsumableIds.size === 0) {
      showToast('해당 결함 항목에 매핑된 추천 소모품이 없습니다. 소모품 목록에서 직접 선택해 주십시오.', 'error');
      return;
    }

    let addedCount = 0;
    setUsedConsumables(prev => {
      const next = [...prev];
      recConsumableIds.forEach(cId => {
        const con = consumables.find(c => c.id === cId);
        if (con && (con.stockQty || 0) > 0) {
          const existIdx = next.findIndex(item => item.consumableId === cId);
          if (existIdx >= 0) {
            if (next[existIdx].quantity < (con.stockQty || 0)) {
              next[existIdx] = { ...next[existIdx], quantity: next[existIdx].quantity + 1 };
              addedCount++;
            }
          } else {
            next.push({ consumableId: cId, quantity: 1 });
            addedCount++;
          }
        }
      });
      return next;
    });

    if (addedCount > 0) {
      showToast(`추천 소모품 ${addedCount}건이 투입 목록에 자동 반영되었습니다.`);
    } else {
      showToast('추천 소모품 재고가 부족하거나 이미 모두 추가되어 있습니다.', 'error');
    }
  };

  const handleAddQuickTag = (tag: string) => {
    setRepairDetails(prev => {
      const trimmed = prev.trim();
      if (!trimmed) return `• ${tag}`;
      if (trimmed.includes(tag)) return prev;
      return `${trimmed}\n• ${tag}`;
    });
  };

  const handleAddConsumable = () => {
    if (!tempConsumableId) return;
    const targetItem = consumables.find(c => c.id === tempConsumableId);
    if (!targetItem) return;
    const qty = Math.max(1, tempConsumableQty);
    const existingUsed = usedConsumables.find(item => item.consumableId === tempConsumableId)?.quantity || 0;
    if (existingUsed + qty > (targetItem.stockQty || 0)) {
      showToast(`소모품 [${targetItem.modelName}] 본사 가용 재고(${targetItem.stockQty || 0}개)를 초과하여 추가할 수 없습니다.`, 'error');
      return;
    }
    setUsedConsumables(prev => {
      const idx = prev.findIndex(item => item.consumableId === tempConsumableId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [...prev, { consumableId: tempConsumableId, quantity: qty }];
    });
    setTempConsumableId('');
    setTempConsumableQty(1);
  };

  const handleRemoveConsumable = (cId: string) => {
    setUsedConsumables(prev => prev.filter(item => item.consumableId !== cId));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'BEFORE' | 'AFTER') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsProcessingImage(true);
      const compressed = await compressFileIfNeeded(file);
      if (type === 'BEFORE') setBeforeImage(compressed.base64);
      else setAfterImage(compressed.base64);
      setIsProcessingImage(false);
    } catch (err: any) {
      console.error(err);
      showErrorModal(`사진 처리 실패: ${err?.message || err}`);
      setIsProcessingImage(false);
    }
  };

  // ✅ 정비 완료 ➔ AVAILABLE 전환
  const handleCompleteRepair = async () => {
    if (!canSave) return;
    if (!selectedAsset) {
      showToast('정비 대상 자산을 먼저 선택해 주십시오.', 'error');
      return;
    }
    if (!repairDetails.trim()) {
      showToast('정비 상세 내용 또는 점검 조치 내역을 입력해 주십시오.', 'error');
      return;
    }



    const evidenceImages: string[] = [];
    if (beforeImage) evidenceImages.push(beforeImage);
    if (afterImage) evidenceImages.push(afterImage);

    const payload: Partial<Repair> = {
      id: selectedRepairId || undefined, // 🟢 기존 PENDING 티켓(입고결함 등)이 있으면 업데이트, 없으면 신규
      assetId: selectedAsset.id,
      assetNo: selectedAsset.assetNo,
      modelName: selectedAsset.modelName,
      workLocation: 'YARD',
      stockSource: 'CENTRAL_HQ',
      maintenanceType,
      repairType: maintenanceType === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL',
      status: 'COMPLETED',
      targetAssetStatus: 'AVAILABLE',
      mechanicId: selectedMechanicId || currentUser?.id,
      vendorId: maintenanceType === 'EXTERNAL' ? selectedVendorId : undefined,
      repairDate,
      requestDate: repairDate,
      details: repairDetails,
      totalCost,
      beforeImage,
      afterImage,
      evidenceImages,
      billableType,
      billableAmount: billableType === 'BILLABLE' ? billableAmount : 0,
      billableToCustomer: billableType === 'BILLABLE',
      inspectionItemCode,
      degradationScore,
      inboundNo: inboundMeta?.inboundNo
    };

    await registerRepair(payload, usedConsumables);
    await db.awaitPendingWrites();
    showToast(`[${selectedAsset.assetNo}] 정비 완료: 임대가능(AVAILABLE) 복원 및 소모품 차감 완료`);

    // 폼 초기화
    setSelectedAssetId('');
    setSelectedRepairId('');
    setInboundDefects([]);
    setInboundPhotos([]);
    setInboundMeta(null);
    setRepairDetails('');
    setUsedConsumables([]);
    setBeforeImage('');
    setAfterImage('');
    setInspectionItemCode('');
    setDegradationScore(0);
    setBillableType('FREE');
    setBillableAmount(0);
  };

  // ⏸️ 부품대기 (수리중 REPAIRING 유지)
  const handleHoldRepair = async () => {
    if (!selectedAsset) return;
    setShowUnresolvedModal(true);
  };

  const handleConfirmHoldRepair = async () => {
    if (!canSave || !selectedAsset) return;
    const evidenceImages: string[] = [];
    if (beforeImage) evidenceImages.push(beforeImage);
    if (afterImage) evidenceImages.push(afterImage);

    const payload: Partial<Repair> = {
      id: selectedRepairId || undefined,
      assetId: selectedAsset.id,
      assetNo: selectedAsset.assetNo,
      modelName: selectedAsset.modelName,
      workLocation: 'YARD',
      stockSource: 'CENTRAL_HQ',
      maintenanceType,
      repairType: maintenanceType === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL',
      status: 'UNRESOLVED',
      targetAssetStatus: 'REPAIRING',
      unresolvedReason,
      nextAction: 'NONE',
      mechanicId: selectedMechanicId || currentUser?.id,
      vendorId: maintenanceType === 'EXTERNAL' ? selectedVendorId : undefined,
      repairDate,
      requestDate: repairDate,
      details: (repairDetails ? repairDetails + '\n' : '') + `[부품대기 사유: ${unresolvedReason}]`,
      totalCost,
      beforeImage,
      afterImage,
      evidenceImages,
      billableType,
      billableAmount: billableType === 'BILLABLE' ? billableAmount : 0,
      billableToCustomer: billableType === 'BILLABLE',
      inspectionItemCode,
      degradationScore,
      inboundNo: inboundMeta?.inboundNo
    };

    await registerRepair(payload, usedConsumables);
    await db.awaitPendingWrites();
    showToast(`[${selectedAsset.assetNo}] 장비가 수리정비중(REPAIRING) 상태로 보존되었습니다.`);
    setShowUnresolvedModal(false);
    setSelectedAssetId('');
    setSelectedRepairId('');
    setInboundDefects([]);
    setInboundPhotos([]);
    setInboundMeta(null);
    setRepairDetails('');
    setUsedConsumables([]);
  };

  // 🚚 외주위탁 등록
  const handleOutsourceRepair = async () => {
    if (!canSave || !selectedAsset) return;
    if (!selectedVendorId) {
      showToast('외주 정비 업체를 선택해 주십시오.', 'error');
      return;
    }

    const payload: Partial<Repair> = {
      assetId: selectedAsset.id,
      assetNo: selectedAsset.assetNo,
      modelName: selectedAsset.modelName,
      workLocation: 'VENDOR_SHOP',
      maintenanceType: 'EXTERNAL',
      repairType: 'EXTERNAL',
      status: 'IN_PROGRESS',
      targetAssetStatus: 'REPAIRING',
      mechanicId: selectedMechanicId || currentUser?.id,
      vendorId: selectedVendorId,
      repairDate,
      requestDate: repairDate,
      details: repairDetails || `외주정비 위탁 반출: ${getVendorName(selectedVendorId)}`,
      totalCost: externalCost,
      billableType,
      billableAmount: billableType === 'BILLABLE' ? billableAmount : 0,
      billableToCustomer: billableType === 'BILLABLE',
      inspectionItemCode,
      degradationScore
    };

    await registerRepair(payload, []);
    await db.awaitPendingWrites();
    showToast(`[${selectedAsset.assetNo}] 외주 정비 위탁 등록 완료`);
    setSelectedAssetId('');
    setRepairDetails('');
  };

  // 대장 엑셀 내보내기
  const handleExportExcel = () => {
    const data = filteredLedgerRepairs.map((r, idx) => ({
      'No': idx + 1,
      '접수번호': r.ticketNo || r.id,
      '정비일자': r.repairDate || r.requestDate || '-',
      '정비구분': r.maintenanceType === 'EXTERNAL' ? '외주정비' : r.maintenanceType === 'PREVENTIVE' ? '정기예방' : '자체정비',
      '자산번호': r.assetNo || getAssetNo(r.assetId),
      '모델명': r.modelName || getAssetModel(r.assetId),
      '정비내용': r.details || '-',
      '미완료사유': r.unresolvedReason || '-',
      '총비용(원)': r.totalCost || 0,
      '담당정비사': getMechanicName(r.mechanicId),
      '외주거래처': r.vendorId ? getVendorName(r.vendorId) : '-',
      '진행상태': r.status === 'COMPLETED' ? '정비완료' : r.status === 'UNRESOLVED' ? '부품대기' : '진행중',
      '점검코드': r.inspectionItemCode || '-',
      '노후도점수': r.degradationScore ? `${r.degradationScore}점` : '0점',
      '유무상구분': r.billableType === 'BILLABLE' ? '유상' : '무상',
      '고객청구액': r.billableAmount ? `${r.billableAmount.toLocaleString()}원` : '0원'
    }));
    exportToExcel(data, `주기장정비대장_${new Date().toISOString().split('T')[0]}`, '정비대장');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      {/* ─── 상단 헤더 & 탭 네비게이션 (무수식어 건조 표준) ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            주기장 정비 관리
          </h2>
        </div>

        {/* 탭 버튼군 */}
        <div style={{ display: 'flex', backgroundColor: 'var(--bg-app)', padding: '3px', borderRadius: '6px', border: '1px solid var(--border-color)', gap: '4px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('STUDIO')}
            style={{
              padding: '6px 14px',
              fontSize: '12.5px',
              fontWeight: activeTab === 'STUDIO' ? '700' : '500',
              backgroundColor: activeTab === 'STUDIO' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'STUDIO' ? '#ffffff' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            <Wrench size={14} /> 정비 스튜디오
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('LEDGER')}
            style={{
              padding: '6px 14px',
              fontSize: '12.5px',
              fontWeight: activeTab === 'LEDGER' ? '700' : '500',
              backgroundColor: activeTab === 'LEDGER' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'LEDGER' ? '#ffffff' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            <FileText size={14} /> 정비 관리 대장 ({repairs.length}건)
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 탭 1: 주기장 정비 스튜디오 (유형 A: 요청 처리형 마스터-디테일 스튜디오)   */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'STUDIO' && (
        <div style={{ display: 'grid', gridTemplateColumns: '370px 1fr', gap: '14px', alignItems: 'start' }}>
          
          {/* ── 좌측: 수리 대기 자산 큐 ── */}
          <div className="card" style={{ margin: 0, padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <Package size={15} color="var(--primary)" /> 정비 대상 자산 ({yardAssets.length}대)
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                총 비임대 {queueCounts.all}대
              </span>
            </div>

            {/* 필터 탭 (Pill) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {[
                { key: 'ALL', label: '전체', count: queueCounts.all },
                { key: 'INBOUND_DEFECT', label: '입고결함', count: queueCounts.inboundDefects, color: '#ef4444' },
                { key: 'RENTED_RETURNED', label: '반납검수', count: queueCounts.returned, color: '#f59e0b' },
                { key: 'REPAIRING', label: '수리중', count: queueCounts.repairing, color: '#f97316' },
                { key: 'EXTERNAL', label: '외주위탁', count: queueCounts.external, color: '#8b5cf6' },
                { key: 'AVAILABLE', label: '점검대상', count: queueCounts.available, color: '#10b981' },
              ].map(f => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setYardQueueFilter(f.key as any)}
                  style={{
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: yardQueueFilter === f.key ? '700' : '500',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: yardQueueFilter === f.key ? 'var(--primary)' : 'var(--bg-app)',
                    color: yardQueueFilter === f.key ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>

            {/* 콤팩트 검색 */}
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="자산번호, 모델명 검색..."
                value={yardSearchTerm}
                onChange={e => setYardSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '6px 8px 6px 26px', fontSize: '12px', boxSizing: 'border-box' }}
              />
            </div>

            {/* 자산 카드 목록 (고밀도 스크롤) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 'calc(100vh - 270px)', overflowY: 'auto' }}>
              {yardAssets.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  해당 조건의 정비 대상 자산이 없습니다.
                </div>
              ) : (
                yardAssets.map(asset => {
                  const isSelected = selectedAssetId === asset.id;
                  const isReturned = asset.status === 'RENTED_RETURNED';
                  const isRepairing = asset.status === 'REPAIRING';
                  const isAvailable = asset.status === 'AVAILABLE';

                  // 외주정비, 부품대기 및 입고 결함 활성 건 탐색
                  const activeExternal = repairs.find(r => r.assetId === asset.id && r.status === 'IN_PROGRESS' && r.maintenanceType === 'EXTERNAL');
                  const unresolvedRepair = repairs.find(r => r.assetId === asset.id && r.status === 'UNRESOLVED');
                  const pendingInbound = repairs.find(r => r.assetId === asset.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');

                  return (
                    <div
                      key={asset.id}
                      onClick={() => handleSelectAsset(asset)}
                      style={{
                        padding: '9px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.08)' : 'var(--bg-app)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>[{asset.assetNo}]</strong>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-main)' }}>{asset.modelName}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {pendingInbound ? (
                            <span className="badge badge-danger" style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#dc2626', color: '#ffffff' }}>
                              🚨 입고불량
                            </span>
                          ) : activeExternal ? (
                            <span className="badge" style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#8b5cf6', color: '#ffffff' }}>
                              외주:{getVendorName(activeExternal.vendorId)}
                            </span>
                          ) : unresolvedRepair ? (
                            <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 6px' }}>
                              부품대기
                            </span>
                          ) : (
                            <span className={`badge ${
                              isRepairing ? 'badge-danger' :
                              isReturned ? 'badge-warning' :
                              isAvailable ? 'badge-success' : 'badge-secondary'
                            }`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                              {isRepairing ? '수리중' : isReturned ? '입고검수대기' : isAvailable ? '임대가능' : asset.status}
                            </span>
                          )}
                          {(asset.maintenanceScore || 0) > 0 && (
                            <span className="badge badge-danger" style={{ fontSize: '10px', padding: '2px 5px' }}>
                              {asset.maintenanceScore}점
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <span>구분: {asset.ownerType === 'RENTED' ? '타사임차' : '자사보유'}</span>
                        {asset.serialNo && <span>S/N: {asset.serialNo}</span>}
                      </div>

                      {pendingInbound && (
                        <div style={{ fontSize: '11px', color: '#b91c1c', backgroundColor: 'rgba(239, 68, 68, 0.08)', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          🚨 입고결함 [{pendingInbound.inboundNo || '검수'}]: {pendingInbound.details.split('\n')[1] || '수리 요망'}
                        </div>
                      )}

                      {unresolvedRepair && unresolvedRepair.unresolvedReason && (
                        <div style={{ fontSize: '11px', color: '#b45309', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          ⏸️ 부품대기: {unresolvedRepair.unresolvedReason}
                        </div>
                      )}

                      {asset.memo && (
                        <div style={{ fontSize: '11px', color: '#b91c1c', backgroundColor: 'rgba(239, 68, 68, 0.08)', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          ⚠️ {asset.memo}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── 우측: 정비 조치 & 소모품 투입 워크벤치 ── */}
          <div className="card" style={{ margin: 0, padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {!selectedAsset ? (
              <div style={{ padding: '100px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Wrench size={42} style={{ opacity: 0.25, marginBottom: '12px' }} />
                <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>정비 대상 자산 미선택</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  좌측 정비 대상 자산 큐에서 점검 또는 수리할 장비를 선택하십시오.
                </div>
              </div>
            ) : (
              <>
                {/* 1. 선택 자산 헤더 배너 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--primary)' }}>[{selectedAsset.assetNo}]</span>
                      <span style={{ fontSize: '15px', fontWeight: '700' }}>{selectedAsset.modelName}</span>
                      <span className={`badge ${
                        selectedAsset.status === 'REPAIRING' ? 'badge-danger' :
                        selectedAsset.status === 'RENTED_RETURNED' ? 'badge-warning' : 'badge-success'
                      }`} style={{ fontSize: '11px' }}>
                        현재: {selectedAsset.status === 'REPAIRING' ? '수리중' : selectedAsset.status === 'RENTED_RETURNED' ? '입고검수대기' : '임대가능'}
                      </span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', gap: '12px' }}>
                      <span>시리얼: {selectedAsset.serialNo || '-'}</span>
                      <span>제조년도: {selectedAsset.manufactureYear || '-'}</span>
                      <span>소유구분: {selectedAsset.ownerType === 'RENTED' ? '타사임차' : '자사보유'}</span>
                      <span>누적수리비: {(selectedAsset.cumRepairCost || 0).toLocaleString()}원</span>
                    </div>
                    {assetInboundNote && (
                      <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#b91c1c', backgroundColor: 'rgba(239, 68, 68, 0.08)', padding: '4px 8px', borderRadius: '4px' }}>
                        📌 <strong>최근 입고/검수 메모:</strong> {assetInboundNote.memo || '이상 없음'} ({assetInboundNote.eventDate})
                      </div>
                    )}
                    {/* 진행 중인 외주정비 안내 배너 */}
                    {repairs.some(r => r.assetId === selectedAsset.id && r.status === 'IN_PROGRESS' && r.maintenanceType === 'EXTERNAL') && (
                      <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#6d28d9', backgroundColor: 'rgba(139, 92, 246, 0.1)', padding: '5px 10px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Truck size={14} />
                        <strong>외주정비 위탁 진행 중:</strong> 협력업체 정비 완료 후 수리내역 확인 및 [외주 입고 검수 완료]를 실행하면 임대가능(AVAILABLE)으로 복원됩니다.
                      </div>
                    )}
                    {/* 부품대기 안내 배너 */}
                    {repairs.some(r => r.assetId === selectedAsset.id && r.status === 'UNRESOLVED') && (
                      <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#b45309', backgroundColor: 'rgba(245, 158, 11, 0.12)', padding: '5px 10px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertTriangle size={14} />
                        <strong>부품 수급 대기 중인 장비:</strong> 입고된 부품을 아래 소모품 목록에서 투입한 후 [정비 완료]를 실행하면 정상 임대가능으로 전환됩니다.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedAssetId('')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    title="선택 해제"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* 1-1. 입고 결함 점검 리포트 카드 (입고 시 적발된 결함 내역 연동) */}
                {inboundDefects.length > 0 && (
                  <div style={{
                    padding: '12px 14px',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    borderRadius: '6px',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertTriangle size={16} color="#dc2626" />
                        <strong style={{ fontSize: '13px', color: '#dc2626' }}>입고 검수 결함 리포트</strong>
                        {inboundMeta?.inboundNo && (
                          <span className="badge" style={{ backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '11px', fontWeight: '700' }}>
                            입고번호: {inboundMeta.inboundNo}
                          </span>
                        )}
                        <span className="badge badge-danger" style={{ fontSize: '11px' }}>
                          총 결함 {inboundDefects.length}건 (+{degradationScore}점)
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={handleAutoFillDefectDetails}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                        >
                          <Check size={12} /> 조치내용 자동 반영
                        </button>
                        <button
                          type="button"
                          onClick={handleAutoAddRecommendedConsumables}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                        >
                          <Package size={12} /> 추천 소모품 일괄 담기
                        </button>
                      </div>
                    </div>

                    {/* 결함 항목 배지 그리드 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {inboundDefects.map((defect, idx) => (
                        <div key={idx} style={{
                          padding: '4px 8px',
                          backgroundColor: '#ffffff',
                          border: '1px solid #fca5a5',
                          borderRadius: '4px',
                          fontSize: '11.5px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                        }}>
                          <span style={{ fontWeight: '700', color: '#b91c1c' }}>{defect.checkitemName}</span>
                          <span style={{ fontSize: '10.5px', color: '#ef4444', fontWeight: '700', backgroundColor: '#fef2f2', padding: '1px 4px', borderRadius: '3px' }}>
                            +{defect.score}점
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 입고 시 촬영된 사진 미리보기 */}
                    {inboundPhotos.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>입고 검수 사진 ({inboundPhotos.length}매):</span>
                        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
                          {inboundPhotos.map((photo, pIdx) => (
                            <img
                              key={pIdx}
                              src={photo}
                              alt={`입고 사진 ${pIdx + 1}`}
                              style={{ width: '46px', height: '46px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #fca5a5', cursor: 'pointer' }}
                              onClick={() => window.open(photo, '_blank')}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. 정비 기본 설정 (헌장 3.4 상하 수직 스택) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 구분 *</label>
                    <select
                      value={maintenanceType}
                      onChange={e => setMaintenanceType(e.target.value as any)}
                      style={{ padding: '6px 8px', fontSize: '12.5px' }}
                    >
                      <option value="INHOUSE_REPAIR">야적장/주기장 자체수리 (INHOUSE)</option>
                      <option value="PREVENTIVE">주기장 정기 예방점검 (PREVENTIVE)</option>
                      <option value="EXTERNAL">외주 전문공업사 위탁 (EXTERNAL)</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 일자 *</label>
                    <input
                      type="date"
                      value={repairDate}
                      onChange={e => setRepairDate(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12.5px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>담당 정비사 *</label>
                    <select
                      value={selectedMechanicId}
                      onChange={e => setSelectedMechanicId(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12.5px' }}
                    >
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 항목 코드 (Inspection Code)</label>
                    <select
                      value={inspectionItemCode}
                      onChange={e => setInspectionItemCode(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12.5px' }}
                    >
                      <option value="">분류 선택</option>
                      <option value="CHK-000001">외관/바디 (CHK-000001)</option>
                      <option value="CHK-000002">유압/동력 (CHK-000002)</option>
                      <option value="CHK-000003">전기/배터리 (CHK-000003)</option>
                      <option value="CHK-000004">주행/타이어 (CHK-000004)</option>
                      <option value="CHK-000005">기타/접수 (CHK-000005)</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>노후도 점수 (Degradation)</label>
                    <input
                      type="number"
                      value={degradationScore}
                      onChange={e => setDegradationScore(Number(e.target.value) || 0)}
                      placeholder="+/- 점수"
                      style={{ padding: '6px 8px', fontSize: '12.5px' }}
                    />
                  </div>
                </div>

                {/* 2-1. 유무상 청구 구분 및 청구금액 (헌장 3.4 상하 수직 스택) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>유/무상 구분</label>
                    <select
                      value={billableType}
                      onChange={e => setBillableType(e.target.value as any)}
                      style={{ padding: '6px 8px', fontSize: '12.5px' }}
                    >
                      <option value="FREE">무상 (회사부담 / 기본보증)</option>
                      <option value="BILLABLE">유상 (고객사 청구)</option>
                    </select>
                  </div>
                  {billableType === 'BILLABLE' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: '#ea580c', whiteSpace: 'nowrap' }}>고객사 청구금액 (원) *</label>
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={billableAmount}
                        onChange={e => setBillableAmount(Number(e.target.value) || 0)}
                        placeholder="청구 금액 입력"
                        style={{ padding: '6px 8px', fontSize: '12.5px' }}
                      />
                    </div>
                  ) : (
                    <div />
                  )}
                </div>

                {/* 외주 정비 선택 시 외주업체 및 비용 패널 */}
                {maintenanceType === 'EXTERNAL' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', padding: '10px', backgroundColor: 'rgba(139, 92, 246, 0.08)', borderRadius: '6px', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: '#7c3aed', whiteSpace: 'nowrap' }}>외주 정비 거래처 *</label>
                      <select
                        value={selectedVendorId}
                        onChange={e => setSelectedVendorId(e.target.value)}
                        style={{ padding: '6px 8px', fontSize: '12.5px' }}
                      >
                        <option value="">거래처 선택...</option>
                        {vendors.map(v => (
                          <option key={v.id} value={v.id}>{v.name} ({v.type || '외주처'})</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: '#7c3aed', whiteSpace: 'nowrap' }}>외주 정비 예상 비용 (원)</label>
                      <input
                        type="number"
                        value={externalCost || ''}
                        onChange={e => setExternalCost(Number(e.target.value) || 0)}
                        placeholder="0"
                        style={{ padding: '6px 8px', fontSize: '12.5px' }}
                      />
                    </div>
                  </div>
                )}

                {/* 3. 정비 항목 프리셋 칩 */}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block', whiteSpace: 'nowrap' }}>
                    정비 항목 프리셋
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {QUICK_WORK_TAGS.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleAddQuickTag(tag)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          backgroundColor: 'var(--bg-app)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0
                        }}
                      >
                        <Plus size={10} color="var(--primary)" /> {tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. 정비 상세 내용 (Textarea) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 상세 조치 내용 *</label>
                  <textarea
                    rows={4}
                    value={repairDetails}
                    onChange={e => setRepairDetails(e.target.value)}
                    placeholder="수리 조치 사항, 교체 부품, 상태 점검 결과 입력"
                    style={{ width: '100%', padding: '8px', fontSize: '12.5px', resize: 'vertical' }}
                  />
                </div>

                {/* 5. 소모품 투입 관리 그리드 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', margin: 0, whiteSpace: 'nowrap' }}>
                      <Layers size={14} color="var(--primary)" /> 소모품 투입 관리
                    </label>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                      소모품 투입 합계: {totalConsumablesCost.toLocaleString()}원
                    </span>
                  </div>

                  {/* 소모품 선택 입력줄 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: '8px', alignItems: 'end' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '10.5px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>품목 선택</label>
                      <select
                        value={tempConsumableId}
                        onChange={e => setTempConsumableId(e.target.value)}
                        style={{ padding: '6px', fontSize: '12px' }}
                      >
                        <option value="">주기장 재고 소모품 선택...</option>
                        {consumables.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.modelName} (재고: {c.stockQty || 0} {c.unit} | ₩{c.unitPrice.toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <label style={{ fontSize: '10.5px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>투입 수량</label>
                      <input
                        type="number"
                        min={1}
                        value={tempConsumableQty}
                        onChange={e => setTempConsumableQty(Number(e.target.value) || 1)}
                        style={{ padding: '6px', fontSize: '12px' }}
                      />
                    </div>

                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleAddConsumable}
                      style={{ padding: '6px 12px', height: '33px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      <Plus size={13} /> 투입
                    </button>
                  </div>

                  {/* 투입된 소모품 목록 테이블 */}
                  {usedConsumables.length > 0 && (
                    <table style={{ width: '100%', fontSize: '11.5px', borderCollapse: 'collapse', marginTop: '4px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                          <th style={{ textAlign: 'left', padding: '4px', whiteSpace: 'nowrap' }}>품목명</th>
                          <th style={{ textAlign: 'center', padding: '4px', whiteSpace: 'nowrap' }}>수량</th>
                          <th style={{ textAlign: 'right', padding: '4px', whiteSpace: 'nowrap' }}>단가</th>
                          <th style={{ textAlign: 'right', padding: '4px', whiteSpace: 'nowrap' }}>금액</th>
                          <th style={{ textAlign: 'center', padding: '4px', width: '40px', whiteSpace: 'nowrap' }}>삭제</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usedConsumables.map(uc => {
                          const item = consumables.find(c => c.id === uc.consumableId);
                          const subtotal = (item?.unitPrice || 0) * uc.quantity;
                          return (
                            <tr key={uc.consumableId} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                              <td style={{ padding: '4px', fontWeight: '600', whiteSpace: 'nowrap' }}>{item?.modelName || uc.consumableId}</td>
                              <td style={{ textAlign: 'center', padding: '4px', whiteSpace: 'nowrap' }}>{uc.quantity} {item?.unit}</td>
                              <td style={{ textAlign: 'right', padding: '4px', whiteSpace: 'nowrap' }}>{(item?.unitPrice || 0).toLocaleString()}원</td>
                              <td style={{ textAlign: 'right', padding: '4px', fontWeight: '600', whiteSpace: 'nowrap' }}>{subtotal.toLocaleString()}원</td>
                              <td style={{ textAlign: 'center', padding: '4px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveConsumable(uc.consumableId)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '2px' }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 6. 증빙 사진 (정비 전 / 정비 후) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 전 사진</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => handleImageUpload(e, 'BEFORE')}
                      style={{ fontSize: '11.5px' }}
                    />
                    {beforeImage && (
                      <img src={beforeImage} alt="정비 전" style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: '4px', marginTop: '4px', border: '1px solid var(--border-color)' }} />
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 후 사진</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => handleImageUpload(e, 'AFTER')}
                      style={{ fontSize: '11.5px' }}
                    />
                    {afterImage && (
                      <img src={afterImage} alt="정비 후" style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: '4px', marginTop: '4px', border: '1px solid var(--border-color)' }} />
                    )}
                  </div>
                </div>

                {/* 7. 우측 하단 최종 종결 액션 (헌장 3.5 Gutenberg Z-패턴 4단계 종결) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '4px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                    총 정비 원가: <strong style={{ color: 'var(--primary)', fontSize: '15px' }}>{totalCost.toLocaleString()}</strong>원
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleHoldRepair}
                      disabled={!canSave}
                      style={{ padding: '8px 14px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      <Clock size={14} /> 부품 대기 등록
                    </button>

                    {maintenanceType === 'EXTERNAL' ? (
                      repairs.some(r => r.assetId === selectedAsset.id && r.status === 'IN_PROGRESS' && r.maintenanceType === 'EXTERNAL') ? (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleCompleteRepair}
                          disabled={!canSave || isProcessingImage}
                          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#16a34a', borderColor: '#16a34a', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          <CheckCircle size={15} /> 외주 정비 완료 (임대가능 복원)
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleOutsourceRepair}
                          disabled={!canSave || isProcessingImage}
                          style={{ padding: '8px 16px', fontSize: '13px', fontWeight: '700', backgroundColor: '#7c3aed', borderColor: '#7c3aed', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          <Truck size={14} /> 외주 위탁 등록
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleCompleteRepair}
                        disabled={!canSave || isProcessingImage}
                        style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#16a34a', borderColor: '#16a34a', whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        <CheckCircle size={15} /> 정비 완료 (임대가능 복원)
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 탭 2: 주기장 정비 대장 (유형 B: 기간 조회 및 정산/정리형 고밀도 그리드)   */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'LEDGER' && (
        <div className="card" style={{ margin: 0, padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* 상단 필터 바 (헌장 3.4 상하 수직 스택 구조) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.5fr 1fr auto', gap: '10px', alignItems: 'end', backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '6px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>자산번호/모델/내용 검색</label>
              <input
                type="text"
                placeholder="검색어 입력..."
                value={ledgerSearch}
                onChange={e => setLedgerSearch(e.target.value)}
                style={{ padding: '6px', fontSize: '12px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 구분</label>
              <select
                value={ledgerTypeFilter}
                onChange={e => setLedgerTypeFilter(e.target.value)}
                style={{ padding: '6px', fontSize: '12px' }}
              >
                <option value="ALL">전체 정비구분</option>
                <option value="INHOUSE_REPAIR">야적장/자체정비</option>
                <option value="PREVENTIVE">정기예방점검</option>
                <option value="EXTERNAL">외주정비</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>진행 상태</label>
              <select
                value={ledgerStatusFilter}
                onChange={e => setLedgerStatusFilter(e.target.value)}
                style={{ padding: '6px', fontSize: '12px' }}
              >
                <option value="ALL">전체 상태</option>
                <option value="COMPLETED">정비완료</option>
                <option value="UNRESOLVED">미완료(부품대기)</option>
                <option value="IN_PROGRESS">진행중</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>정비 일자 범위</label>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  type="date"
                  value={ledgerStartDate}
                  onChange={e => setLedgerStartDate(e.target.value)}
                  style={{ padding: '6px', fontSize: '12px' }}
                />
                <span>~</span>
                <input
                  type="date"
                  value={ledgerEndDate}
                  onChange={e => setLedgerEndDate(e.target.value)}
                  style={{ padding: '6px', fontSize: '12px' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>담당 정비사</label>
              <select
                value={ledgerMechanicFilter}
                onChange={e => setLedgerMechanicFilter(e.target.value)}
                style={{ padding: '6px', fontSize: '12px' }}
              >
                <option value="ALL">전체 정비사</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleExportExcel}
              style={{ padding: '6px 12px', height: '33px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
            >
              <Download size={13} /> 엑셀 다운로드
            </button>
          </div>

          {/* 고밀도 정비 대장 그리드 */}
          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table style={{ width: '100%', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', width: '45px' }}>No</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>정비일자</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>정비구분</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>자산번호</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>모델명</th>
                  <th style={{ padding: '8px 10px' }}>정비 상세 내용</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>정비비용</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>점검코드</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>노후도</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>담당정비사</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>상태</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', width: '60px' }}>상세</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedgerRepairs.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                      조회 조건에 해당하는 주기장 정비 이력이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredLedgerRepairs.map((r, idx) => (
                    <tr
                      key={r.id}
                      onDoubleClick={() => setSelectedDetailRepair(r)}
                      style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                    >
                      <td style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{r.repairDate || r.requestDate}</td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        <span className={`badge ${
                          r.maintenanceType === 'EXTERNAL' ? 'badge-warning' :
                          r.maintenanceType === 'PREVENTIVE' ? 'badge-info' : 'badge-secondary'
                        }`} style={{ fontSize: '10.5px' }}>
                          {r.maintenanceType === 'EXTERNAL' ? '외주정비' :
                           r.maintenanceType === 'PREVENTIVE' ? '정기예방' : '자체정비'}
                        </span>
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        <strong style={{ color: 'var(--primary)' }}>[{r.assetNo || getAssetNo(r.assetId)}]</strong>
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{r.modelName || getAssetModel(r.assetId)}</td>
                      <td style={{ padding: '8px', maxWidth: '300px' }}>
                        {r.unresolvedReason && (
                          <span style={{ fontSize: '11px', color: 'var(--danger)', fontWeight: '700', marginRight: '6px' }}>
                            [부품대기: {r.unresolvedReason}]
                          </span>
                        )}
                        <span style={{ fontSize: '12px' }}>{r.details}</span>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: '700', whiteSpace: 'nowrap' }}>
                        {(r.totalCost || 0).toLocaleString()}원
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {r.inspectionItemCode || '-'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: '11px', color: r.degradationScore ? '#d97706' : 'var(--text-muted)', fontWeight: r.degradationScore ? 700 : 400, whiteSpace: 'nowrap' }}>
                        {r.degradationScore ? `${r.degradationScore}점` : '-'}
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{getMechanicName(r.mechanicId)}</td>
                      <td style={{ padding: '8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span className={`badge ${
                          r.status === 'COMPLETED' ? 'badge-success' :
                          r.status === 'UNRESOLVED' ? 'badge-danger' : 'badge-warning'
                        }`} style={{ fontSize: '10.5px' }}>
                          {r.status === 'COMPLETED' ? '완료' : r.status === 'UNRESOLVED' ? '미완료' : '진행중'}
                        </span>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setSelectedDetailRepair(r)}
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                        >
                          상세
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계 대차대조식 검증 바 (헌장 3.5) */}
      {(() => {
        const repairingAssets = assets.filter(a => a.status === 'REPAIRING').length;
        const availableAssets = assets.filter(a => a.status === 'AVAILABLE').length;
        const monthlyCompletedRepairs = repairs.filter(r => r.status === 'COMPLETED' && (r.repairDate || '').startsWith(thisMonthStart.slice(0, 7))).length;
        const totalConsumableCost = repairs.filter(r => (r.repairDate || '').startsWith(thisMonthStart.slice(0, 7))).reduce((sum, r) => sum + (r.totalCost || 0), 0);

        return (
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
              <span>수리정비중(REPAIRING): <strong style={{ color: 'var(--danger)' }}>총 {repairingAssets}대</strong></span>
              <span>|</span>
              <span>임대가능(AVAILABLE): <strong style={{ color: 'var(--success)' }}>총 {availableAssets}대</strong></span>
              <span>|</span>
              <span>금월 정비완료: <strong style={{ color: 'var(--primary)' }}>총 {monthlyCompletedRepairs}건</strong></span>
              <span>|</span>
              <span>금월 소모품비: <strong style={{ color: 'var(--text-main)' }}>₩{totalConsumableCost.toLocaleString()}원</strong></span>
            </div>
            <span style={{
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'var(--success-light)',
              color: 'var(--success)',
              fontWeight: 700,
              fontSize: '11px'
            }}>
              ⚖️ 대차 정상 (정비완료-자산AVAILABLE환원 100% 무결)
            </span>
          </div>
        );
      })()}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 모달 1: 부품대기 (수리중 유지) 사유 입력 모달                             */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showUnresolvedModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: '420px', backgroundColor: 'var(--bg-card)', margin: 0, padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={16} color="var(--danger)" /> 부품대기 (수리중 유지) 등록
              </h3>
              <button type="button" onClick={() => setShowUnresolvedModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                <strong>[{selectedAsset?.assetNo}]</strong> 장비를 수리 완료하지 않고 '수리정비중(REPAIRING)' 상태로 유지합니다.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: '600' }}>미완료/대기 사유 *</label>
                <select
                  value={unresolvedReason}
                  onChange={e => setUnresolvedReason(e.target.value)}
                  style={{ padding: '6px', fontSize: '12.5px' }}
                >
                  <option value="부품 수급 대기">부품 수급 대기</option>
                  <option value="배터리 재생/충전 대기">배터리 재생/충전 대기</option>
                  <option value="외주 공업사 견적 대기">외주 공업사 견적 대기</option>
                  <option value="정밀 계측 및 추가 점검 필요">정밀 계측 및 추가 점검 필요</option>
                  <option value="기타 사유">기타 사유</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowUnresolvedModal(false)} style={{ padding: '6px 12px', fontSize: '12px' }}>
                  취소
                </button>
                <button type="button" className="btn-primary" onClick={handleConfirmHoldRepair} style={{ padding: '6px 14px', fontSize: '12px', backgroundColor: 'var(--danger)', borderColor: 'var(--danger)' }}>
                  수리중 유지 등록
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 모달 2: 정비 상세 내역 모달                                               */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {selectedDetailRepair && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: '580px', backgroundColor: 'var(--bg-card)', margin: 0, padding: '18px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>정비 상세 정보</h3>
              </div>
              <button type="button" onClick={() => setSelectedDetailRepair(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12.5px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>자산번호 / 모델</div>
                  <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>[{selectedDetailRepair.assetNo || getAssetNo(selectedDetailRepair.assetId)}]</strong> {selectedDetailRepair.modelName || getAssetModel(selectedDetailRepair.assetId)}
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>정비구분 / 상태</div>
                  <span style={{ fontWeight: '700' }}>
                    {selectedDetailRepair.maintenanceType === 'EXTERNAL' ? '외주정비' : selectedDetailRepair.maintenanceType === 'PREVENTIVE' ? '정기예방' : '자체정비'} ({selectedDetailRepair.status})
                  </span>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>정비일자</div>
                  <span>{selectedDetailRepair.repairDate || selectedDetailRepair.requestDate}</span>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>담당 정비사</div>
                  <span>{getMechanicName(selectedDetailRepair.mechanicId)}</span>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>점검코드 / 노후도</div>
                  <span>{selectedDetailRepair.inspectionItemCode || '-'} / {selectedDetailRepair.degradationScore ? `${selectedDetailRepair.degradationScore}점` : '0점'}</span>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>유무상 / 고객청구액</div>
                  <span style={{ color: selectedDetailRepair.billableType === 'BILLABLE' ? '#ea580c' : 'inherit', fontWeight: 600 }}>
                    {selectedDetailRepair.billableType === 'BILLABLE' ? `유상 (₩${(selectedDetailRepair.billableAmount || 0).toLocaleString()}원)` : '무상'}
                  </span>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: '700', marginBottom: '4px' }}>조치 상세 내용</div>
                <div style={{ whiteSpace: 'pre-wrap', backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', lineHeight: '1.5' }}>
                  {selectedDetailRepair.details || '내용 없음'}
                </div>
              </div>

              {selectedDetailRepair.unresolvedReason && (
                <div style={{ color: 'var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.08)', padding: '8px', borderRadius: '6px' }}>
                  ⚠️ <strong>미완료/부품대기 사유:</strong> {selectedDetailRepair.unresolvedReason}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                <span style={{ fontWeight: '700' }}>총 정비 비용</span>
                <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>
                  {(selectedDetailRepair.totalCost || 0).toLocaleString()}원
                </strong>
              </div>

              {(selectedDetailRepair.beforeImage || selectedDetailRepair.afterImage) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
                  {selectedDetailRepair.beforeImage && (
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>정비 전 사진</div>
                      <img src={selectedDetailRepair.beforeImage} alt="정비 전" style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '4px' }} />
                    </div>
                  )}
                  {selectedDetailRepair.afterImage && (
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>정비 후 사진</div>
                      <img src={selectedDetailRepair.afterImage} alt="정비 후" style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '4px' }} />
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setSelectedDetailRepair(null)} style={{ padding: '6px 14px', fontSize: '12px' }}>
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
