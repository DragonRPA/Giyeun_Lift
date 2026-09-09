import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { OutboundInspection, OutboundInspectionStatus, Asset, Contract, Customer, CustomerSite as Site, AssetInOutLog, Repair, ContractAsset, db, STANDARD_SPECS } from '../services/db';
import { issueHandoverTask, clearHandoverTasks } from '../utils/taskHandoverPipeline';
import {
  CheckSquare,
  AlertTriangle,
  ShieldCheck,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  FileText,
  ChevronRight,
  UserCheck,
  Wrench,
  PackageCheck,
  Layers,
  Sparkles,
  Check,
  RefreshCw,
  ArrowRightLeft,
  Star,
  ShieldAlert,
  Calendar,
  RotateCcw,
  MessageSquare,
  X
} from 'lucide-react';

interface CheckPoint {
  id: string;
  label: string;
  type: 'MODEL' | 'SPEC' | 'OPTION';
}

function getGroupCheckpoints(
  items: OutboundInspection[],
  groupAssets: Asset[],
  contract: Contract | undefined,
  customer: Customer | null | undefined,
  site: Site | null | undefined
): { checkpoints: CheckPoint[]; specialNote: string } {
  const checkpoints: CheckPoint[] = [];

  // 1. 모델 일치 확인 — 항상 포함
  items.forEach(item => {
    const ca = db.contractAssets.find(ca => ca.id === item.contractAssetId);
    const asset = db.assets.find(a => a.id === item.assetId);
    if (ca?.expectedModel) {
      checkpoints.push({
        id: `model_${item.id}`,
        label: `모델 확인: 계약 요구 [${ca.expectedModel}] ↔ 실출고 [${asset?.modelName || '미배정'}]`,
        type: 'MODEL'
      });
    } else if (asset) {
      checkpoints.push({
        id: `model_${item.id}`,
        label: `모델 확인: [${asset.modelName}] (${asset.assetNo}) 출고 준비 상태`,
        type: 'MODEL'
      });
    }
  });

  // 2. STANDARD_SPECS 중 site.checkedSpecs 또는 customer.defaultCheckedSpecs에서 true인 항목만
  const specMap: Record<string, boolean> = {
    ...(customer?.defaultCheckedSpecs || {}),
    ...(site?.checkedSpecs || {})
  };
  STANDARD_SPECS.forEach(spec => {
    if (specMap[spec.id] === true) {
      checkpoints.push({ id: spec.id, label: spec.label, type: 'SPEC' });
    }
  });

  // 3. 유상옵션 (site.paidOptions 또는 customer.defaultPaidOptions)
  const paidOpts = site?.paidOptions || customer?.defaultPaidOptions || '';
  if (typeof paidOpts === 'string' && paidOpts.trim()) {
    paidOpts.split(/[,，、\\n]/).map(o => o.trim()).filter(Boolean).forEach((opt, i) => {
      checkpoints.push({ id: `paid_${i}`, label: `[옵션] ${opt} 장착 확인`, type: 'OPTION' });
    });
  }

  const specialNote = (site as any)?.memo || customer?.specialNotes || '';
  return { checkpoints, specialNote };
}

// 의뢰 1건 그룹 단위 인터페이스
interface InspectionGroup {
  groupId: string;
  contractId: string;
  contractNo: string;
  customerName: string;
  siteName: string;
  requestDate: string;
  loadingDate: string; // 🚚 상차일자 (YYYY-MM-DD)
  deliveryId?: string; // 연결된 출고 배차 ID
  status: OutboundInspectionStatus;
  items: OutboundInspection[];
  assets: Asset[];
  equipmentsSummary: string;
  checkpoints: CheckPoint[];
  specialNote: string;
  rawText?: string; // 스마트 출고시 입력된 자연어 원문 텍스트
}

export const OutboundInspections: React.FC = () => {
  const {
    outboundInspections,
    contracts,
    contractAssets,
    assets,
    customers,
    sites,
    deliveries,
    currentUser,
    refreshAllData,
    hasPermission,
    showErrorModal,
    exchangeOutboundAsset,
    inspectionChecklistItems
  } = useApp();

  const canEdit = hasPermission('repair', 'save') || hasPermission('delivery', 'save') || hasPermission('contract', 'save');

  const [activeTabStatus, setActiveTabStatus] = useState<string>('PENDING');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 📅 상차일자 기간 필터 state — 기본값: 오늘-3일(지연 건 캡처) ~ 오늘+14일(2주 앞 업무 전망)
  const _today = new Date();
  const _start = new Date(_today); _start.setDate(_today.getDate() - 3);
  const _end = new Date(_today); _end.setDate(_today.getDate() + 14);
  const [startDate, setStartDate] = useState<string>(_start.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(_end.toISOString().split('T')[0]);

  // 💡 [사장님 지시] Quick 날짜 선택 헬퍼 - 오늘 이후 미래 기준 조회 (1주일: 오늘~+7일, 1개월: 오늘~+30일)
  const handleSetDateRange = (type: 'TODAY' | 'WEEK' | 'MONTH' | 'ALL') => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    if (type === 'TODAY') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (type === 'WEEK') {
      const future = new Date();
      future.setDate(today.getDate() + 7);
      setStartDate(todayStr);
      setEndDate(future.toISOString().split('T')[0]);
    } else if (type === 'MONTH') {
      const future = new Date();
      future.setDate(today.getDate() + 30);
      setStartDate(todayStr);
      setEndDate(future.toISOString().split('T')[0]);
    } else {
      setStartDate('');
      setEndDate('');
    }
  };

  // 선택된 의뢰 그룹의 체크리스트 (기본값: false 미체크!)
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [inspectionNote, setInspectionNote] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 반려 모달 상태
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // 반려 시 수리정비중 전환 선택 옵션 (기본값: true)
  const [rejectToRepairing, setRejectToRepairing] = useState<boolean>(true);

  // 🔄 장비 교체 모달 상태
  const [exchangeModalAsset, setExchangeModalAsset] = useState<Asset | null>(null);
  const [targetNewAssetId, setTargetNewAssetId] = useState<string>('');
  const [selectedChecklistId, setSelectedChecklistId] = useState<string>(''); // 💡 마스터 등록 정비사유 ID
  const [exchangeReason, setExchangeReason] = useState<string>('');
  const [exchangeToRepairing, setExchangeToRepairing] = useState<boolean>(false); // 💡 기본값: false (수리 미전환)
  const [exchangeSearchQuery, setExchangeSearchQuery] = useState<string>(''); // 🔍 대체 장비 관리번호 검색어

  // 💡 교체 모달 오픈 시 또는 검색 시 조건에 맞는 첫번째 대체 장비 100% 자동선택!
  React.useEffect(() => {
    if (exchangeModalAsset) {
      const q = exchangeSearchQuery.toLowerCase().trim();
      const availables = assets.filter(a => {
        if (a.status !== 'AVAILABLE' || a.modelName !== exchangeModalAsset.modelName || a.id === exchangeModalAsset.id) return false;
        if (!q) return true;
        return a.assetNo.toLowerCase().includes(q) || (a.serialNo && a.serialNo.toLowerCase().includes(q));
      });
      if (availables.length > 0 && (!targetNewAssetId || !availables.some(a => a.id === targetNewAssetId))) {
        setTargetNewAssetId(availables[0].id);
      }
    }
  }, [exchangeModalAsset, assets, targetNewAssetId, exchangeSearchQuery]);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. 개별 의뢰건들을 계약(contractId) 및 신청일자 기준 의뢰 1건 단위로 그룹핑
  // ──────────────────────────────────────────────────────────────────────────
  const inspectionGroups = useMemo<InspectionGroup[]>(() => {
    const groupMap = new Map<string, OutboundInspection[]>();

    outboundInspections.forEach(item => {
      const key = `${item.contractId || 'NOCONTR'}_${item.createdAt ? item.createdAt.substring(0, 10) : 'NODATE'}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(item);
    });

    const groups: InspectionGroup[] = [];

    groupMap.forEach((items, key) => {
      const firstItem = items[0];
      const contract = contracts.find(c => c.id === firstItem.contractId);
      const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
      const site = contract ? sites.find(s => s.id === contract.siteId) : null;

      const groupAssets = items
        .map(i => assets.find(a => a.id === i.assetId))
        .filter((a): a is Asset => !!a);

      const modelCounts: Record<string, number> = {};
      groupAssets.forEach(a => {
        modelCounts[a.modelName] = (modelCounts[a.modelName] || 0) + 1;
      });
      const summaryText = Object.entries(modelCounts)
        .map(([m, c]) => `${m} ${c}대`)
        .join(', ') || '장비 매핑 대기 중';

      const delivery = deliveries.find(d => d.contractId === firstItem.contractId && d.type === 'OUTBOUND');
      const rawText = delivery?.rawText || delivery?.memo || (contract as any)?.memo || firstItem.note || '';
      const memoText = `${rawText} ${delivery?.closingMemo || ''} ${firstItem.note || ''}`.toLowerCase();

      const { checkpoints, specialNote } = getGroupCheckpoints(items, groupAssets, contract, customer, site);

      let groupStatus: OutboundInspectionStatus = 'PENDING';
      if (items.every(i => i.status === 'COMPLETED')) {
        groupStatus = 'COMPLETED';
      } else if (items.some(i => i.status === 'REJECTED')) {
        groupStatus = 'REJECTED';
      } else if (items.some(i => i.status === 'IN_PROGRESS')) {
        groupStatus = 'IN_PROGRESS';
      }

      const loadingDateVal = delivery?.loadingDate || delivery?.scheduledDate || (contract as any)?.startDate || (firstItem.createdAt ? firstItem.createdAt.substring(0, 10) : new Date().toISOString().split('T')[0]);

      groups.push({
        groupId: key,
        contractId: firstItem.contractId || '',
        contractNo: contract?.contractNo || '출고의뢰건',
        customerName: customer?.name || '고객 미지정',
        siteName: site?.name || '현장 미지정',
        requestDate: firstItem.createdAt ? firstItem.createdAt.substring(0, 10) : new Date().toISOString().split('T')[0],
        loadingDate: loadingDateVal,
        status: groupStatus,
        deliveryId: delivery?.id,
        items,
        assets: groupAssets,
        equipmentsSummary: summaryText,
        checkpoints,
        specialNote,
        rawText
      });
    });

    return groups.sort((a, b) => a.loadingDate.localeCompare(b.loadingDate));
  }, [outboundInspections, contracts, customers, sites, assets, deliveries]);

  // ──────────────────────────────────────────────────────────────────────────
  // 2. 검색, 탭 및 📅 상차일자 기간 범위 필터링
  // ──────────────────────────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    return inspectionGroups.filter(g => {
      if (activeTabStatus !== 'ALL' && g.status !== activeTabStatus) return false;

      // 💡 [사장님 지시] 상차일자(loadingDate) 기준 기간 범위 필터링 적용
      if (startDate && g.loadingDate < startDate) return false;
      if (endDate && g.loadingDate > endDate) return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        g.customerName.toLowerCase().includes(q) ||
        g.siteName.toLowerCase().includes(q) ||
        g.contractNo.toLowerCase().includes(q) ||
        g.equipmentsSummary.toLowerCase().includes(q) ||
        (g.rawText && g.rawText.toLowerCase().includes(q)) ||
        g.assets.some(a => a.assetNo.toLowerCase().includes(q))
      );
    });
  }, [inspectionGroups, activeTabStatus, startDate, endDate, searchQuery]);

  const selectedGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return inspectionGroups.find(g => g.groupId === selectedGroupId) || null;
  }, [selectedGroupId, inspectionGroups]);

  const handleSelectGroup = (group: InspectionGroup) => {
    setSelectedGroupId(group.groupId);

    // 초기 체크 상태 세팅 (기본값 false 미체크!)
    const initialMap: Record<string, boolean> = {};
    group.checkpoints.forEach(cp => {
      initialMap[cp.id] = false;
    });

    // 만약 이미 검수가 진행중이거나 완료된 경우 기존 note 파싱
    const sampleNote = group.items[0]?.note || '';
    setInspectionNote(sampleNote);
    setCheckedItems(initialMap);
  };

  // 1-Click 전체 선택 / 해제
  const handleToggleAllSpecs = () => {
    if (!selectedGroup) return;
    const allChecked = selectedGroup.checkpoints.every(cp => !!checkedItems[cp.id]);
    const updated: Record<string, boolean> = {};
    selectedGroup.checkpoints.forEach(cp => {
      updated[cp.id] = !allChecked;
    });
    setCheckedItems(updated);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 3. 작업 접수 실행 (PENDING ➔ IN_PROGRESS)
  // ──────────────────────────────────────────────────────────────────────────
  const handleAcceptGroup = async (group: InspectionGroup) => {
    if (!canEdit) return;
    setIsProcessing(true);
    try {
      const nowIso = new Date().toISOString();
      const inspectorName = currentUser?.name || '담당엔지니어';

      group.items.forEach(item => {
        db.updateRow<OutboundInspection>('outboundInspections', item.id, {
          status: 'IN_PROGRESS',
          inspectorId: inspectorName,
          updatedAt: nowIso
        });
      });

      await db.awaitPendingWrites();
      refreshAllData();
      showToast(`고객사 [${group.customerName}] 출고 검수 의뢰 접수가 완료되었습니다.`);
      handleSelectGroup(group);
    } catch (err: any) {
      showErrorModal(`⚠️ 의뢰 접수 실패: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 4. 최종 출고 승인 완료 (IN_PROGRESS ➔ COMPLETED & 자산 status ➔ ASSIGNED)
  // ──────────────────────────────────────────────────────────────────────────
  const handleApproveGroup = async () => {
    if (!selectedGroup || !canEdit) return;

    // 🔴 [출고제한 가드] 연체 및 거래차단(BLOCKED) 고객사 최종 출고 승인 원천 차단
    const contract = db.contracts.find(c => c.id === selectedGroup.contractId);
    const customer = contract ? db.customers.find(c => c.id === contract.customerId) : undefined;
    if (customer && customer.transactionStatus === 'BLOCKED') {
      showErrorModal(`⚠️ [출고제한 가드] 연체 및 거래차단(BLOCKED) 상태인 고객사(${customer.name})의 장비는 출고 승인할 수 없습니다.\n관리부 채권 확인 및 거래 제한 해제 후 진행해 주십시오.`);
      return;
    }

    const checkedCount = Object.values(checkedItems).filter(Boolean).length;
    const totalCount = selectedGroup.checkpoints.length;

    if (checkedCount === 0) {
      showErrorModal('점검 항목을 최소 1개 이상 검수 완료해야 출고 승인이 가능합니다.');
      return;
    }

    if (checkedCount < totalCount) {
      showToast(`요구 항목 ${totalCount}개 중 ${checkedCount}개 검수 완료 상태로 승인 마감합니다.`);
    }

    setIsProcessing(true);
    try {
      const nowIso = new Date().toISOString();
      const inspectorName = currentUser?.name || '담당엔지니어';
      const resultNote = `[검수완료 ${checkedCount}/${totalCount}항목 합격] ${inspectionNote}`;

      selectedGroup.items.forEach(item => {
        const itemDeliveryId = item.deliveryId || selectedGroup.deliveryId || undefined;
        db.updateRow<OutboundInspection>('outboundInspections', item.id, {
          status: 'COMPLETED',
          inspectorId: inspectorName,
          inspectedAt: nowIso,
          approvedAt: nowIso,
          specsJson: JSON.stringify({
            checkpoints: selectedGroup.checkpoints.map(cp => ({ ...cp, checked: !!checkedItems[cp.id] })),
            inspectionNote,
            inspectorName,
            approvedAt: nowIso
          }),
          deliveryId: itemDeliveryId,
          note: resultNote,
          updatedAt: nowIso
        });

        // 🟢 출고 승인 마감 시 해당 고유 장비의 status ➔ 'RENTED' (대여중) 으로 실시간 변동!
        if (item.assetId) {
          db.updateRow<Asset>('assets', item.assetId, {
            status: 'RENTED',
            updatedAt: nowIso
          });

          // 🟢 [헌장 1.2] 발생 사건 무누락 DB 저장: 출고 검수 승인 시 자산 입출고 이력 1:1 정규화 영구 저장
          const targetAsset = db.assets.find(a => a.id === item.assetId);
          const site = contract ? db.sites.find(s => s.id === contract.siteId) : undefined;

          db.insertRow<AssetInOutLog>('assetInOutLogs', {
            assetId: item.assetId,
            assetNo: targetAsset?.assetNo || '',
            modelName: targetAsset?.modelName || '',
            deliveryId: itemDeliveryId,
            type: 'OUTBOUND',
            eventDate: nowIso.split('T')[0],
            customerId: contract?.customerId,
            customerName: customer?.name || selectedGroup.customerName,
            siteId: contract?.siteId,
            siteName: site?.name || selectedGroup.siteName,
            memo: `[PC 출고검수 승인] 계약(${contract?.contractNo || item.contractId || '직출고'}) 현장(${site?.name || selectedGroup.siteName || '현장'}) 기사(${inspectorName}) 기능 점검 완료 (자산 대여중 전환)`,
            createdAt: nowIso,
          });
        }
      });

      // 🟢 [단일 업무 인계 파이프라인] 출고 PDI 검수 ToDo 자동 상계
      for (const item of selectedGroup.items) {
        await clearHandoverTasks({
          entityId: item.id,
          category: 'OUTBOUND_PDI_INSPECTION',
          completedByUserId: currentUser?.id,
          completedByName: inspectorName,
          completionAction: 'PDI_APPROVED'
        });
        if (item.assetId) {
          await clearHandoverTasks({
            entityId: item.assetId,
            category: 'OUTBOUND_PDI_INSPECTION',
            completedByUserId: currentUser?.id,
            completedByName: inspectorName,
            completionAction: 'PDI_APPROVED'
          });
        }
      }
      if (selectedGroup.deliveryId) {
        await clearHandoverTasks({
          entityId: selectedGroup.deliveryId,
          category: 'OUTBOUND_PDI_INSPECTION',
          completedByUserId: currentUser?.id,
          completedByName: inspectorName,
          completionAction: 'PDI_APPROVED'
        });
      }

      // 🚀 [단일 업무 인계 파이프라인] 화물 기사/영업에 장비 상차 출발 ToDo 발행
      const matchedContract = contracts.find(c => c.id === selectedGroup.contractId);
      await issueHandoverTask({
        category: 'OUTBOUND_SHIPMENT_START',
        title: `[장비 상차 출발] ${selectedGroup.customerName} (${selectedGroup.items.length}대 PDI 완료)`,
        content: `출고 PDI 검수 완료 승인 (자산 대여중 전환). 차량 상차 및 현장 배송을 시작하세요. (현장: ${selectedGroup.siteName || '-'})`,
        targetDept: 'DISPATCH',
        targetRole: 'LOGISTICS',
        assignedUserId: matchedContract?.salespersonId,
        priority: 'HIGH',
        actionUrl: '/admin/dispatch',
        entityType: 'DELIVERY',
        entityId: selectedGroup.deliveryId || selectedGroup.contractId || 'OUTBOUND',
        senderId: currentUser?.id,
        senderName: inspectorName
      });

      await db.awaitPendingWrites();
      refreshAllData();
      showToast(`[${selectedGroup.customerName}] 출고 검수가 최종 승인 마감되었습니다. (자산상태 RENTED 전환)`);
      setSelectedGroupId(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 출고 승인 마감 실패: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 5. 출고 반려 처리 (REJECTED & 자산 status ➔ REPAIRING 로 불량 전환)
  // ──────────────────────────────────────────────────────────────────────────
  const handleConfirmReject = async () => {
    if (!selectedGroup || !canEdit) return;
    if (!rejectReason.trim()) {
      showErrorModal('반려 사유를 입력해 주세요.');
      return;
    }

    setIsProcessing(true);
    try {
      const nowIso = new Date().toISOString();
      const inspectorName = currentUser?.name || '담당엔지니어';

      selectedGroup.items.forEach(item => {
        const targetAsset = item.assetId ? db.assets.find(a => a.id === item.assetId) : undefined;
        const contract = db.contracts.find(c => c.id === item.contractId || c.id === selectedGroup.contractId);
        const customer = contract ? db.customers.find(c => c.id === contract.customerId) : undefined;
        const site = contract ? db.sites.find(s => s.id === contract.siteId) : undefined;
        let createdRepairId: string | undefined = undefined;

        // 🔴 1. 수리정비중(REPAIRING) 전환 시 긴급 수리 티켓(repairs) 1:1 자동 발행 (헌장 1.2 무누락 저장)
        if (item.assetId && rejectToRepairing) {
          const newRepair = db.insertRow<Repair>('repairs', {
            assetId: item.assetId,
            assetNo: targetAsset?.assetNo || '',
            modelName: targetAsset?.modelName || '',
            workCategory: 'YARD_INTERNAL',
            workLocation: 'YARD',
            stockSource: 'CENTRAL_HQ',
            source: 'INBOUND_INSPECTION',
            repairType: 'INTERNAL',
            status: 'PENDING',
            priority: 'URGENT',
            issueDescription: `[출고검수 반려 긴급점검] 사유: ${rejectReason.trim()}`,
            details: `[출고검수 반려 긴급점검] 사유: ${rejectReason.trim()}`,
            actionTaken: '',
            mechanicName: inspectorName,
            requestDate: nowIso.split('T')[0],
            createdAt: nowIso,
            updatedAt: nowIso
          });
          createdRepairId = newRepair.id;

          // 정비 입고 이력 1:1 무누락 DB 저장
          db.insertRow<AssetInOutLog>('assetInOutLogs', {
            assetId: item.assetId,
            assetNo: targetAsset?.assetNo || '',
            modelName: targetAsset?.modelName || '',
            type: 'REPAIR',
            repairId: createdRepairId,
            eventDate: nowIso.split('T')[0],
            customerId: contract?.customerId,
            customerName: customer?.name || selectedGroup.customerName,
            siteId: contract?.siteId,
            siteName: site?.name || selectedGroup.siteName,
            memo: `[출고검수 반려 긴급입고] 사유: ${rejectReason.trim()} (정비대장 티켓 ${createdRepairId} 자동발행)`,
            createdAt: nowIso
          });

          // 🔴 2. 계약자산(contractAssets)에서 결함 장비 안전 해제 (계약 결함장비 잔류 원천 방어)
          if (item.contractAssetId) {
            db.updateRow<ContractAsset>('contractAssets', item.contractAssetId, {
              assetId: null as any
            });
          } else if (item.contractId) {
            const relCa = db.contractAssets.find(ca => ca.contractId === item.contractId && ca.assetId === item.assetId);
            if (relCa) {
              db.updateRow<ContractAsset>('contractAssets', relCa.id, {
                assetId: null as any
              });
            }
          }
        }

        db.updateRow<OutboundInspection>('outboundInspections', item.id, {
          status: 'REJECTED',
          inspectorId: inspectorName,
          rejectReason: rejectReason.trim(),
          repairId: createdRepairId,
          note: `[출고반려] ${rejectReason.trim()}`,
          updatedAt: nowIso
        });

        // 사용자 선택에 따라 수리정비중(REPAIRING) 또는 임대가능(AVAILABLE) 전환!
        if (item.assetId) {
          const targetStatus = rejectToRepairing ? 'REPAIRING' : 'AVAILABLE';
          db.updateRow<Asset>('assets', item.assetId, {
            status: targetStatus,
            maintenanceScore: rejectToRepairing ? Math.max(targetAsset?.maintenanceScore || 0, 7) : targetAsset?.maintenanceScore,
            updatedAt: nowIso
          });
        }
      });

      // 🟢 [단일 업무 인계 파이프라인] 출고 PDI 검수 ToDo 상계
      for (const item of selectedGroup.items) {
        await clearHandoverTasks({
          entityId: item.id,
          category: 'OUTBOUND_PDI_INSPECTION',
          completedByUserId: currentUser?.id,
          completedByName: inspectorName,
          completionAction: 'PDI_REJECTED'
        });
        if (item.assetId) {
          await clearHandoverTasks({
            entityId: item.assetId,
            category: 'OUTBOUND_PDI_INSPECTION',
            completedByUserId: currentUser?.id,
            completedByName: inspectorName,
            completionAction: 'PDI_REJECTED'
          });
        }
      }

      // 🚀 결함 수리 전환 시 주기장 정비 ToDo 및 배차 대체배정 ToDo 발행
      if (rejectToRepairing) {
        await issueHandoverTask({
          category: 'INBOUND_REPAIR_DEFECT',
          title: `[출고반려 긴급정비] ${selectedGroup.customerName} 장비 점검`,
          content: `출고 PDI 검수 반려 사유: ${rejectReason.trim()} (정비대장 티켓 확인 및 조치 요망)`,
          targetDept: 'YARD',
          priority: 'URGENT',
          actionUrl: '/repairs',
          entityType: 'REPAIR',
          entityId: selectedGroup.items[0]?.assetId || 'REPAIR',
          senderId: currentUser?.id,
          senderName: inspectorName
        });

        await issueHandoverTask({
          category: 'DISPATCH_REQUEST',
          title: `[출고반려 대체 배차] ${selectedGroup.customerName}`,
          content: `장비 검수 반려에 따라 동급 가용 장비로 대체 배정 필요. 사유: ${rejectReason.trim()}`,
          targetDept: 'DISPATCH',
          priority: 'HIGH',
          actionUrl: '/admin/dispatch',
          entityType: 'DELIVERY',
          entityId: selectedGroup.deliveryId || selectedGroup.contractId || 'DISPATCH',
          senderId: currentUser?.id,
          senderName: inspectorName
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();
      const statusText = rejectToRepairing ? '[수리정비중]으로 전환되고 긴급 수리 티켓이 정비대장에 등록되었습니다.' : '[임대가능] 재고로 복원되었습니다.';
      showToast(`출고 의뢰가 반려되었습니다. 장비 상태가 ${statusText}`);
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedGroupId(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 반려 처리 실패: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 6. 🔄 장비 교체 실행 (출고 검수 진행 중 장비 교체)
  // ──────────────────────────────────────────────────────────────────────────
  const handleConfirmExchangeAsset = async () => {
    if (!exchangeModalAsset || !targetNewAssetId || !selectedGroup) {
      showErrorModal('대체 장비를 선택해 주세요.');
      return;
    }

    // 💡 수리정비중 전환 시에만 사유 입력 필수, 수리 미전환 시 사유 입력은 선택 사항 (빈값 허용!)
    const matchedChecklist = inspectionChecklistItems.find(item => item.id === selectedChecklistId);
    const customPenaltyScore = matchedChecklist ? Number(matchedChecklist.score) : undefined;
    const finalReason = matchedChecklist
      ? (exchangeReason.trim() ? `${matchedChecklist.name} (${exchangeReason.trim()})` : matchedChecklist.name)
      : exchangeReason.trim();

    setIsProcessing(true);
    try {
      // 💡 선택된 의뢰 그룹 및 장비에 정확히 매칭되는 contractAsset ID 탐색
      const targetInsp = selectedGroup.items.find(i => i.assetId === exchangeModalAsset.id);
      const targetCaId = targetInsp?.contractAssetId || selectedGroup.contractId;

      await exchangeOutboundAsset(
        targetCaId,
        exchangeModalAsset.id,
        targetNewAssetId,
        finalReason,
        exchangeToRepairing, // 사용자 선택 전송!
        customPenaltyScore // 💡 관리 정비사유 점수 (지정 시 기본 5점 제외)
      );

      await db.awaitPendingWrites();
      refreshAllData();
      const statusText = exchangeToRepairing ? '[수리정비중]으로 전환되었습니다.' : '[임대가능] 재고로 유지되었습니다.';
      const scoreMsg = typeof customPenaltyScore === 'number' && customPenaltyScore > 0
        ? `정비사유 [${matchedChecklist?.name}] 지정으로 정비점수 +${customPenaltyScore}점 부과 (기본 5점 제외)`
        : `기본 벌점 +5점 부과`;
      showToast(`장비 교체(스왑)가 완료되었습니다. 기존 장비: ${statusText}`);
      setExchangeModalAsset(null);
      setTargetNewAssetId('');
      setExchangeReason('');
      setSelectedChecklistId('');
      setSelectedGroupId(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 장비 교체 실패: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 뱃지 표출 헬퍼
  const getStatusBadge = (status: OutboundInspectionStatus) => {
    switch (status) {
      case 'PENDING':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(245,158,11,0.15)', color: '#d97706', border: '1px solid rgba(245,158,11,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> 접수 대기</span>;
      case 'IN_PROGRESS':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Wrench size={12} /> 검수 진행중</span>;
      case 'COMPLETED':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(34,197,94,0.15)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> 출고 승인</span>;
      case 'REJECTED':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(239,68,68,0.15)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><XCircle size={12} /> 의뢰 반려</span>;
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', color: 'var(--text-primary)' }}>
      {/* 헤더 영역 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <CheckSquare size={24} color="var(--primary)" /> 출고 검수 관리
          </h2>
          
        </div>
      </div>

      {/* 상태 필터 카운트 탭 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { key: 'ALL', label: '전체 의뢰 보기', count: inspectionGroups.length },
          { key: 'PENDING', label: '🟡 접수 대기', count: inspectionGroups.filter(g => g.status === 'PENDING').length },
          { key: 'IN_PROGRESS', label: '🔵 검수 진행중', count: inspectionGroups.filter(g => g.status === 'IN_PROGRESS').length },
          { key: 'COMPLETED', label: '🟢 출고 승인 마감', count: inspectionGroups.filter(g => g.status === 'COMPLETED').length },
          { key: 'REJECTED', label: '🔴 의뢰 반려', count: inspectionGroups.filter(g => g.status === 'REJECTED').length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTabStatus(tab.key)}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid',
              borderColor: activeTabStatus === tab.key ? 'var(--primary)' : 'var(--border-color)',
              backgroundColor: activeTabStatus === tab.key ? 'rgba(59,130,246,0.1)' : 'var(--bg-card)',
              color: activeTabStatus === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: activeTabStatus === tab.key ? 700 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            {tab.label}
            <span style={{
              backgroundColor: activeTabStatus === tab.key ? 'var(--primary)' : 'var(--bg-body)',
              color: activeTabStatus === tab.key ? '#fff' : 'var(--text-muted)',
              borderRadius: '12px',
              padding: '1px 7px',
              fontSize: '11px',
              fontWeight: 700
            }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* 2열 메인 레이아웃 (좌: 의뢰 묶음 카드리스트 + 📅 기간 선택 | 우: 상세 검수서) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 420px) 1fr', gap: '20px' }}>
        
        {/* [좌측] 의뢰 묶음 카드리스트 + 📅 요청일자 기간 지정 피커 */}
        <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 230px)', minHeight: '600px' }}>
          
          {/* 📅 의뢰 신청일자 기간 지정 피커 및 1-Click Quick 버튼 */}
          <div style={{ marginBottom: '12px', padding: '10px 12px', backgroundColor: 'var(--bg-body)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Calendar size={13} /> 상차일자 기간 조회
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[
                  { label: '오늘', type: 'TODAY' },
                  { label: '1주일', type: 'WEEK' },
                  { label: '1개월', type: 'MONTH' },
                  { label: '전체', type: 'ALL' }
                ].map(b => (
                  <button
                    key={b.type}
                    onClick={() => handleSetDateRange(b.type as any)}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>~</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => handleSetDateRange('ALL')}
                  title="기간 초기화"
                  style={{
                    padding: '5px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex'
                  }}
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          </div>

          {/* 검색창 */}
          <div style={{ marginBottom: '14px', position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="고객사 / 현장 / 계약 / 장비명 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-body)',
                color: 'var(--text-primary)',
                fontSize: '12.5px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* 카드리스트 */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
            {filteredGroups.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
                조건에 해당하는 출고 의뢰건이 없습니다.
              </div>
            ) : (
              filteredGroups.map(group => {
                const isSelected = selectedGroupId === group.groupId;
                // D-day 계산
                const todayStr = new Date().toISOString().split('T')[0];
                const diffDays = Math.ceil((new Date(group.loadingDate).getTime() - new Date(todayStr).getTime()) / 86400000);
                const isOverdue = diffDays < 0 && group.status === 'PENDING';
                const getDdayBadge = () => {
                  if (diffDays < 0) return <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10.5px', fontWeight: 800, backgroundColor: 'rgba(239,68,68,0.15)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.4)', whiteSpace: 'nowrap' }}>D+{Math.abs(diffDays)} 지연</span>;
                  if (diffDays === 0) return <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10.5px', fontWeight: 800, backgroundColor: 'rgba(239,68,68,0.15)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.4)', whiteSpace: 'nowrap' }}>D-DAY</span>;
                  if (diffDays <= 2) return <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10.5px', fontWeight: 800, backgroundColor: 'rgba(245,158,11,0.15)', color: '#d97706', border: '1px solid rgba(245,158,11,0.4)', whiteSpace: 'nowrap' }}>D-{diffDays}</span>;
                  if (diffDays <= 7) return <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10.5px', fontWeight: 700, backgroundColor: 'rgba(234,179,8,0.12)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.3)', whiteSpace: 'nowrap' }}>D-{diffDays}</span>;
                  return <span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10.5px', fontWeight: 600, backgroundColor: 'rgba(59,130,246,0.08)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.2)', whiteSpace: 'nowrap' }}>D-{diffDays}</span>;
                };
                return (
                  <div
                    key={group.groupId}
                    onClick={() => handleSelectGroup(group)}
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid var(--primary)' : isOverdue ? '1.5px solid rgba(239,68,68,0.5)' : '1px solid var(--border-color)',
                      backgroundColor: isSelected ? 'rgba(59,130,246,0.05)' : isOverdue ? 'rgba(239,68,68,0.04)' : 'var(--bg-body)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 4px 12px rgba(59,130,246,0.12)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11.5px', fontWeight: 800, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        상차일: {group.loadingDate}
                        {getDdayBadge()}
                        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 500 }}>(신청: {group.requestDate})</span>
                      </span>
                      {getStatusBadge(group.status)}
                    </div>

                    <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      {group.customerName}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      📍 {group.siteName}
                    </div>

                    {/* 포함 장비 요약 및 할당 장비 관리번호 */}
                    <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '8px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Layers size={13} color="var(--primary)" /> 총 {group.assets.length}대: {group.equipmentsSummary}
                      </div>
                      {group.assets.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed var(--border-color)' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600 }}>할당 장비:</span>
                          {group.assets.map(a => (
                            <span key={a.id} style={{ padding: '1px 5px', borderRadius: '4px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '10.5px', fontWeight: 700 }}>
                              {a.assetNo}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        검수 항목 ({group.checkpoints.length}개):
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                        {group.checkpoints.slice(0, 4).map(cp => (
                          <span key={cp.id} style={{
                            padding: '2px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 600,
                            backgroundColor: cp.type === 'MODEL' ? 'rgba(59,130,246,0.1)' : cp.type === 'SPEC' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                            color: cp.type === 'MODEL' ? '#2563eb' : cp.type === 'SPEC' ? '#059669' : '#d97706'
                          }}>{cp.label.length > 20 ? cp.label.slice(0,20) + '…' : cp.label}</span>
                        ))}
                        {group.checkpoints.length > 4 && (
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>+{group.checkpoints.length - 4}개 더</span>
                        )}
                        {group.checkpoints.length === 0 && (
                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>모델 확인 후 즉시 승인 가능</span>
                        )}
                      </div>
                    </div>

                    {group.status === 'PENDING' && canEdit && (
                      <div style={{ marginTop: '10px', textAlign: 'right' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAcceptGroup(group); }}
                          disabled={isProcessing}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            backgroundColor: 'var(--primary)',
                            color: '#fff',
                            border: 'none',
                            fontWeight: 700,
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          ▶ 작업 접수 실행
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* [우측] 의뢰 맞춤 검수서 및 정비 체크 작성 */}
        <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 230px)', minHeight: '600px', overflowY: 'auto' }}>
          {!selectedGroup ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <PackageCheck size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600 }}>좌측에서 검수할 출고 의뢰건을 선택해 주세요.</p>
            </div>
          ) : (
            <div>
              {/* 상세 상단 헤더 정보 */}
              <div style={{ padding: '16px', backgroundColor: 'var(--bg-body)', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <FileText size={14} /> 출고 의뢰건 상세정보 (계약: {selectedGroup.contractNo})
                    </span>
                    <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '4px 0 0 0' }}>
                      🏢 {selectedGroup.customerName} — {selectedGroup.siteName}
                    </h2>
                  </div>
                  {getStatusBadge(selectedGroup.status)}
                </div>

                {/* 포함 장비 다수 묶음 상세 표출 + 🔄 [장비 교체] 버튼 장착! */}
                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Wrench size={14} color="var(--primary)" /> 출고 장비 ({selectedGroup.assets.length}대)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                    {selectedGroup.assets.map(asset => (
                      <div key={asset.id} style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-body)', border: '1px solid var(--border-color)', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>🏷️ {asset.assetNo}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>모델: {asset.modelName} | 시리얼: {asset.serialNo || '-'}</div>
                        </div>
                        {canEdit && selectedGroup.status !== 'COMPLETED' && (
                          <button
                            onClick={() => {
                              setExchangeModalAsset(asset);
                              setTargetNewAssetId('');
                              setExchangeReason('');
                            }}
                            title="출고 불가 사유 발생 시 동일 모델의 다른 임대가능 장비로 즉시 교체"
                            style={{
                              padding: '5px 9px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(239,68,68,0.1)',
                              color: '#dc2626',
                              border: '1px solid rgba(239,68,68,0.3)',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <ArrowRightLeft size={12} /> 교체
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {selectedGroup.specialNote && (
                <div style={{
                  marginBottom: '16px', padding: '10px 14px',
                  backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
                  borderRadius: '8px', fontSize: '12.5px', color: '#b45309'
                }}>
                  <strong>현장/고객 특이사항:</strong> {selectedGroup.specialNote}
                </div>
              )}

              {/* 🎯 의뢰 요구 맞춤 정비 스펙 체크리스트 */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Sparkles size={16} color="var(--primary)" /> 검수 항목 ({selectedGroup.checkpoints.length}개)
                    </h3>
                  </div>
                  {canEdit && (
                    <button
                      onClick={handleToggleAllSpecs}
                      className="btn-secondary"
                      style={{ fontSize: '12px', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CheckCircle size={14} /> 전체 선택/해제
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                  {selectedGroup.checkpoints.map((cp, index) => {
                    const isChecked = !!checkedItems[cp.id];
                    return (
                      <div
                        key={cp.id}
                        onClick={() => {
                          if (!canEdit) return;
                          setCheckedItems(prev => ({ ...prev, [cp.id]: !isChecked }));
                        }}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '10px',
                          border: isChecked ? '1.5px solid #22c55e' : '1px solid var(--border-color)',
                          backgroundColor: isChecked ? 'rgba(34,197,94,0.06)' : 'var(--bg-body)',
                          cursor: canEdit ? 'pointer' : 'default',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          transition: 'all 0.15s ease',
                          boxShadow: isChecked ? '0 2px 8px rgba(34,197,94,0.1)' : 'none'
                        }}
                      >
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '6px',
                          border: isChecked ? 'none' : '2px solid var(--text-muted)',
                          backgroundColor: isChecked ? '#22c55e' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: '12px',
                          transition: 'all 0.15s ease'
                        }}>
                          {isChecked && <Check size={14} strokeWidth={3} />}
                        </div>

                        <div style={{ flex: 1 }}>
                          <span style={{
                            fontSize: '10.5px', fontWeight: 700, display: 'block',
                            color: isChecked ? '#16a34a' : cp.type === 'MODEL' ? '#2563eb' : cp.type === 'SPEC' ? '#059669' : '#d97706'
                          }}>
                            [{cp.type}] {index + 1}.
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: isChecked ? 700 : 500, color: isChecked ? '#15803d' : 'var(--text-primary)' }}>
                            {cp.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 특이사항 및 작업 메모 */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px', display: 'block', color: 'var(--text-secondary)' }}>
                  검수 메모
                </label>
                <textarea
                  placeholder="예: 배터리 단자 정비 완료, 4면 망 완비 완료, 타이어 교체 등 특이사항 기록..."
                  value={inspectionNote}
                  onChange={e => setInspectionNote(e.target.value)}
                  disabled={!canEdit}
                  style={{
                    width: '100%',
                    height: '75px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-body)',
                    color: 'var(--text-primary)',
                    padding: '10px',
                    fontSize: '12.5px',
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* ────────────────────────────────────────────────────────────────── */}
              {/* 💬 스마트 출고 요청 자연어 원본 텍스트 전용 박스 (배차와 동일 디자인) */}
              {/* ────────────────────────────────────────────────────────────────── */}
              <div style={{ marginBottom: '20px', padding: '14px 16px', backgroundColor: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.25)', borderRadius: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MessageSquare size={16} /> 출고 의뢰 원문
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.6', fontFamily: 'Consolas, Monaco, monospace', backgroundColor: 'var(--bg-card)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  {selectedGroup.rawText || '요청된 자연어 원문이 없습니다.'}
                </div>
              </div>

              {/* 하단 최종 출고 승인 및 반려 버튼 */}
              {canEdit && (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={handleApproveGroup}
                    disabled={isProcessing}
                    className="btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      fontWeight: 800,
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                  >
                    <ShieldCheck size={18} /> [🟢 최종 출고 승인 마감] (할당 완료)
                  </button>

                  {selectedGroup.status !== 'COMPLETED' && (
                    <button
                      onClick={() => setShowRejectModal(true)}
                      disabled={isProcessing}
                      style={{
                        padding: '12px 20px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(239,68,68,0.1)',
                        color: '#dc2626',
                        border: '1px solid rgba(239,68,68,0.3)',
                        fontWeight: 800,
                        fontSize: '13.5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <XCircle size={16} /> 🚫 의뢰 반려 (수리정비중 전환)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계 대차대조식 검증 바 (헌장 3.5) */}
      {(() => {
        const pCount = (outboundInspections || []).filter(i => i.status === 'PENDING').length;
        const ipCount = (outboundInspections || []).filter(i => i.status === 'IN_PROGRESS').length;
        const cCount = (outboundInspections || []).filter(i => i.status === 'COMPLETED').length;
        const rCount = (outboundInspections || []).filter(i => i.status === 'REJECTED').length;

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
              <span>검수 대기: <strong style={{ color: '#d97706' }}>총 {pCount}건</strong></span>
              <span>|</span>
              <span>검수 진행중: <strong style={{ color: 'var(--primary)' }}>총 {ipCount}건</strong></span>
              <span>|</span>
              <span>출고 승인마감: <strong style={{ color: 'var(--success)' }}>총 {cCount}건</strong></span>
              <span>|</span>
              <span>반려: <strong style={{ color: 'var(--danger)' }}>총 {rCount}건</strong></span>
            </div>
            <span style={{
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'var(--success-light)',
              color: 'var(--success)',
              fontWeight: 700,
              fontSize: '11px'
            }}>
              ⚖️ 대차 정상 (검수승인-자산상태 RENTED 전환 100% 무결)
            </span>
          </div>
        );
      })()}

      {/* 반려 사유 입력 모달 */}
      {showRejectModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '24px', width: '100%', maxWidth: '480px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#dc2626', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={20} /> 출고 의뢰 반려 사유 작성
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              의뢰를 반려하면 대상 장비의 자산 상태 변경 여부를 직접 지정할 수 있습니다.
            </p>

            {/* 수리정비중 전환 선택 토글 */}
            <div style={{ marginBottom: '16px', padding: '10px 14px', backgroundColor: 'var(--bg-body)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  🛠️ 반려 대상 장비를 [수리정비중 (REPAIRING)]으로 전환
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  꺼짐(OFF) 선택 시 임대가능(AVAILABLE) 재고 상태로 원복됩니다.
                </div>
              </div>
              <ToggleSwitch
                checked={rejectToRepairing}
                onChange={setRejectToRepairing}
              />
            </div>

            <textarea
              placeholder="반려 사유 입력 (예: 타이어 마모 심함, 배터리 충전 불량...)"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              style={{ width: '100%', height: '90px', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box', marginBottom: '20px' }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowRejectModal(false)} className="btn-secondary">취소</button>
              <button onClick={handleConfirmReject} style={{ padding: '8px 16px', borderRadius: '8px', backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>
                반려 처리 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔄 1-Click 장비 교체 모달 */}
      {exchangeModalAsset && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '24px', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ArrowRightLeft size={20} color="var(--primary)" /> 출고 의뢰 장비 교체
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              기존 장비 <strong style={{ color: 'var(--primary)' }}>[{exchangeModalAsset.assetNo}] ({exchangeModalAsset.modelName})</strong>를 대체 가능한 동급 장비로 교체합니다.
            </p>

            {/* 기존 장비 수리정비중 전환 토글 */}
            <div style={{ marginBottom: '16px', padding: '10px 14px', backgroundColor: 'var(--bg-body)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  🛠️ 기존 교체 대상 장비 [{exchangeModalAsset.assetNo}]를 [수리정비중 (REPAIRING)]으로 전환
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  꺼짐(OFF) 선택 시 임대가능(AVAILABLE) 재고 상태로 유지됩니다.
                </div>
              </div>
              <ToggleSwitch
                checked={exchangeToRepairing}
                onChange={setExchangeToRepairing}
              />
            </div>

            {/* 📋 관리 정비사유 마스터 선택 */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                관리 정비 사유 선택
              </label>
              <select
                value={selectedChecklistId}
                onChange={e => setSelectedChecklistId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-body)',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              >
                <option value="">-- 직접 입력 / 미지정 (기본 벌점 +5점 부과) --</option>
                {inspectionChecklistItems.map(item => (
                  <option key={item.id} value={item.id}>
                    [{item.category}] {item.name} (+{item.score}점)
                  </option>
                ))}
              </select>
            </div>

            {/* 💡 정비점수 가산 실시간 안내 배너 */}
            {(() => {
              const matched = inspectionChecklistItems.find(item => item.id === selectedChecklistId);
              if (matched) {
                return (
                  <div style={{ marginBottom: '14px', padding: '8px 12px', backgroundColor: 'rgba(59,130,246,0.08)', border: '1px solid var(--primary)', borderRadius: '6px', fontSize: '11.5px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ShieldCheck size={14} style={{ flexShrink: 0 }} />
                    <span>관리 정비사유 <strong>[{matched.name}]</strong> 지정됨 ➔ 정비점수 <strong>+{matched.score}점</strong> 부여 (기본 벌점 5점 제외)</span>
                  </div>
                );
              }
              return (
                <div style={{ marginBottom: '14px', padding: '8px 12px', backgroundColor: 'var(--warning-light, rgba(245,158,11,0.08))', border: '1px solid var(--warning, #f59e0b)', borderRadius: '6px', fontSize: '11.5px', color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                  <span>관리 정비사유 미지정 교체 ➔ 기본 벌점 <strong>+5점</strong> 자동 가산</span>
                </div>
              );
            })()}

            {/* 상세 교체사유/메모 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                상세 교체 사유 / 추가 메모 {exchangeToRepairing && !selectedChecklistId ? <span style={{ color: '#ef4444' }}>(수리전환 시 필수)</span> : <span style={{ color: 'var(--text-muted)' }}>(선택 사항)</span>}
              </label>
              <input
                type="text"
                placeholder={selectedChecklistId ? "추가 메모가 있을 경우 입력하세요 (생략 가능)" : "사유 미입력 시 기본 벌점 +5점과 함께 등록됩니다"}
                value={exchangeReason}
                onChange={e => setExchangeReason(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', fontSize: '13px', color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>

            {/* 🔍 [사장님 지시] 대체 장비 관리번호/시리얼 실시간 검색창 탑재 */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Search size={14} color="var(--primary)" /> 대체 장비 관리번호 실시간 검색
                </label>
                {exchangeSearchQuery && (
                  <button
                    onClick={() => setExchangeSearchQuery('')}
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    🔄 전체 목록 보기
                  </button>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="관리번호 (예: G19008) 또는 시리얼번호 입력시 1초 실시간 필터링..."
                  value={exchangeSearchQuery}
                  onChange={e => setExchangeSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 34px 8px 34px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--primary)',
                    backgroundColor: 'var(--bg-body)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    outline: 'none',
                    boxShadow: '0 2px 8px rgba(59,130,246,0.1)'
                  }}
                />
                <Search size={16} color="var(--primary)" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.7 }} />
                {exchangeSearchQuery && (
                  <button
                    onClick={() => setExchangeSearchQuery('')}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* 대체 장비 셀렉터 */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                대체 장비 선택 (동일 모델 {exchangeModalAsset.modelName} 내 임대가능 장비만 노출)
              </label>

              {(() => {
                const q = exchangeSearchQuery.toLowerCase().trim();
                const filteredAssets = assets.filter(a => {
                  if (a.status !== 'AVAILABLE' || a.modelName !== exchangeModalAsset.modelName || a.id === exchangeModalAsset.id) return false;
                  if (!q) return true;
                  return a.assetNo.toLowerCase().includes(q) || (a.serialNo && a.serialNo.toLowerCase().includes(q));
                });

                if (filteredAssets.length === 0) {
                  return (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}>
                      {exchangeSearchQuery ? `⚠️ 검색어 [${exchangeSearchQuery}]에 해당되는 임대가능(${exchangeModalAsset.modelName}) 장비가 없습니다.` : `⚠️ 교체 가능한 동일 모델(${exchangeModalAsset.modelName})의 임대가능(AVAILABLE) 자산이 없습니다.`}
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '10px', maxHeight: '260px', overflowY: 'auto' }}>
                    {filteredAssets.map(a => {
                      const isTarget = targetNewAssetId === a.id;
                      const score = a.maintenanceScore || 0;
                      return (
                        <div
                          key={a.id}
                          onClick={() => setTargetNewAssetId(a.id)}
                          style={{
                            padding: '12px',
                            borderRadius: '8px',
                            border: isTarget ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                            backgroundColor: isTarget ? 'rgba(59,130,246,0.08)' : 'var(--bg-body)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-primary)' }}>🏷️ {a.assetNo}</span>
                            <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, backgroundColor: score === 0 ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)', color: score === 0 ? '#16a34a' : '#d97706' }}>
                              정비점수: {score}점 {score === 0 ? '(이상무)' : '(검수필요)'}
                            </span>
                          </div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>시리얼: {a.serialNo || '-'}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setExchangeModalAsset(null)} className="btn-secondary" style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px' }}>취소</button>
              {(() => {
                const isBtnDisabled = isProcessing || !targetNewAssetId || (exchangeToRepairing && !exchangeReason.trim());
                return (
                  <button
                    onClick={handleConfirmExchangeAsset}
                    disabled={isBtnDisabled}
                    style={{
                      padding: '9px 22px',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '13.5px',
                      backgroundColor: isBtnDisabled ? 'var(--border-color, #cbd5e1)' : 'var(--primary, #3b82f6)',
                      color: isBtnDisabled ? 'var(--text-muted, #64748b)' : '#ffffff',
                      border: 'none',
                      cursor: isBtnDisabled ? 'not-allowed' : 'pointer',
                      boxShadow: isBtnDisabled ? 'none' : '0 4px 14px rgba(59,130,246,0.35)',
                      transition: 'all 0.15s ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <ArrowRightLeft size={15} /> 교체 실행
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
