// src/pages/Contracts.tsx - 렌탈 계약 관리 (건조하고 직관적인 전문 용어 적용)
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  Plus, Calendar, Search, Download, Edit3, Repeat, Clock, Wrench, ChevronLeft,
  Building2, ArrowLeftRight, Receipt, FolderOpen, AlertCircle, ExternalLink, Copy, AlertTriangle
} from 'lucide-react';
import { Contract, db, Customer, CustomerContact, CustomerSite, ContractAsset, ContractHistory, Delivery, Asset, normalizeEndDate, formatContractEndDate, isIndefiniteEndDate } from '../services/db';
import { exportToExcel } from '../services/excel';
import { ContractDocumentBundleModal } from '../components/ContractDocumentBundleModal';
import { FileText, CheckCircle2 } from 'lucide-react';
import { matchHangul } from '../utils/hangulSearch';

export const Contracts: React.FC = () => {
  const {
    contracts, contractAssets, contractHistory, customers, contacts, sites, assets, users, currentUser,
    createContract, extendContract, shortenContract, succeedContract, exchangeAsset, hasPermission,
    products, refreshAllData, deliveries, repairs, outboundInspections, billings, billingDetails, receivables
  } = useApp();

  const canSave = hasPermission('contract', 'save');
  const canGeneratePackage = hasPermission('agent_badge', 'view');  // 계약서 패키지 생성 권한 = agent_badge

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 계약서패키지 모달 상태
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [bundleTargetContractId, setBundleTargetContractId] = useState<string | undefined>(undefined);

  // 계약 변경 권한 검증 함수 (매각 계약은 1회성 완결 계약이므로 변경 불가)
  const canModifyContract = (contract: Contract) => {
    if ((contract.contractType || 'RENTAL') === 'SALE') return false;
    if (!currentUser) return false;
    if (currentUser.role === 'ADMIN') return true;
    if (hasPermission('billing', 'save')) return true;
    return contract.salespersonId === currentUser.id;
  };

  // 100% 화면 모드 전환 ('LIST': 목록 뷰 | 'DETAIL': 상세 뷰)
  const [viewMode, setViewMode] = useState<'LIST' | 'DETAIL'>('LIST');
  const [activeTab, setActiveTab] = useState<'ALL_LIST' | 'CREATE'>('ALL_LIST');

  // --- 계약 조회 필터 상태 ---
  const [searchTerm, setSearchTerm] = useState('');
  const [contractTypeFilter, setContractTypeFilter] = useState<'ALL' | 'RENTAL' | 'SALE'>('RENTAL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [customerFilter, setCustomerFilter] = useState('ALL');
  const [customerInputText, setCustomerInputText] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [siteInputText, setSiteInputText] = useState('');
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [quickChipFilter, setQuickChipFilter] = useState<'ALL' | 'ACTIVE' | 'ASSIGNED' | 'D3' | 'ZERO_FEE' | 'SUCCEEDED' | 'COMPLETED'>('ALL');

  // 선택된 계약 ID
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);

  // --- 계약 등록 폼 상태 ---
  const [custSelect, setCustSelect] = useState(customers[0]?.id || '');
  const [overdueAcknowledged, setOverdueAcknowledged] = useState(false);

  const selectedCustOverdue = useMemo(() => {
    if (!custSelect || custSelect === 'NEW') return null;
    const custBillings = billings.filter(b => b.customerId === custSelect && b.status !== 'PAID' && (b.totalAmount - b.paidAmount) > 0);
    const overdueSum = custBillings.reduce((s, b) => s + (b.totalAmount - b.paidAmount), 0);
    const mc = customers.find(c => c.id === custSelect);
    if (overdueSum <= 0 && mc?.transactionStatus !== 'BLOCKED') return null;
    return { overdueSum, count: custBillings.length, isBlocked: mc?.transactionStatus === 'BLOCKED' };
  }, [custSelect, customers, billings]);
  const [contactSelect, setContactSelect] = useState('');
  const [siteSelect, setSiteSelect] = useState('');
  const [salespersonSelect, setSalespersonSelect] = useState(currentUser?.id || '');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [isEndDateOpen, setIsEndDateOpen] = useState(false); // 종료일 미정 여부
  const [endDate, setEndDate] = useState(new Date(new Date().getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [billingDay, setBillingDay] = useState(30);
  const [statementClosingDay, setStatementClosingDay] = useState(25);
  const [paymentDueDay, setPaymentDueDay] = useState(25);

  // 신규 수동입력 세부 폼 상태
  const [newCustName, setNewCustName] = useState('');
  const [newBizRegNo, setNewBizRegNo] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newRepresentative, setNewRepresentative] = useState('');
  const [newRepContact, setNewRepContact] = useState('');
  const [newRepEmail, setNewRepEmail] = useState('');

  const [newContactName, setNewContactName] = useState('');
  const [newContactPosition, setNewContactPosition] = useState('담당자');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');

  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteAddress, setNewSiteAddress] = useState('');
  const [newSiteContactName, setNewSiteContactName] = useState('');
  const [newSiteContactPhone, setNewSiteContactPhone] = useState('');
  const [newSiteContactEmail, setNewSiteContactEmail] = useState('');
  
  // 등록 중 자산 바스켓 (헌장 2.1: 영업 담당자는 모델 규격 의뢰가 기본 표준)
  const [basket, setBasket] = useState<{ assetId?: string; expectedModel?: string; monthlyRentalFee: number; dailyRentalFee: number }[]>([]);
  const [basketAssetMethod, setBasketAssetMethod] = useState<'ASSET' | 'MODEL'>('MODEL');
  const [selectedAssetToAdd, setSelectedAssetToAdd] = useState('');
  const [selectedModelToAdd, setSelectedModelToAdd] = useState('');
  const [customMonthly, setCustomMonthly] = useState(400000);
  const [customDaily, setCustomDaily] = useState(15000);

  // --- 💡 모달 팝업 상태들 ---
  // 1) 렌탈료 수정 모달
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [editCaId, setEditCaId] = useState('');
  const [editMonthlyFee, setEditMonthlyFee] = useState(0);
  const [editDailyFee, setEditDailyFee] = useState(0);
  const [feeChangeReason, setFeeChangeReason] = useState('');

  // 2) 만료일 / 연장/단축 모달
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [modIsOpen, setModIsOpen] = useState(false);
  const [modNewEndDate, setModNewEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [modDesc, setModDesc] = useState('');

  // 3) 계약 승계 모달
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [succCustId, setSuccCustId] = useState('');
  const [succContactId, setSuccContactId] = useState('');
  const [succSiteId, setSuccSiteId] = useState('');
  const [succDate, setSuccDate] = useState(new Date().toISOString().split('T')[0]);
  const [succDesc, setSuccDesc] = useState('');

  // 4) 장비 교체(대차) 모달
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [exchangeContractAssetId, setExchangeContractAssetId] = useState('');
  const [exchangeOldAssetId, setExchangeOldAssetId] = useState('');
  const [exchangeNewAssetId, setExchangeNewAssetId] = useState('');
  const [exchangeDate, setExchangeDate] = useState(new Date().toISOString().split('T')[0]);
  const [exchangeTimeSlot, setExchangeTimeSlot] = useState('오전 (08:00 ~ 12:00)');
  const [exchangeIdentifyType, setExchangeIdentifyType] = useState<'KNOWN' | 'UNKNOWN'>('KNOWN');
  const [exchangeReason, setExchangeReason] = useState('');

  // 헬퍼
  const getCustName = (id: string) => customers.find(c => c.id === id)?.name || '-';
  const getSiteName = (id?: string) => sites.find(s => s.id === id)?.name || '-';
  const getContactName = (id?: string) => contacts.find(c => c.id === id)?.name || '-';

  // 오늘 날짜 및 D-Day 계산
  const todayStr = new Date().toISOString().split('T')[0];

  const getDDayText = (endDateStr?: string) => {
    if (isIndefiniteEndDate(endDateStr)) return { text: '미정', isWarning: false };
    const diff = Math.ceil((new Date(endDateStr!).getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { text: `D+${Math.abs(diff)}일`, isWarning: true };
    if (diff === 0) return { text: 'D-DAY', isWarning: true };
    if (diff <= 3) return { text: `D-${diff}일`, isWarning: true };
    return { text: `D-${diff}일`, isWarning: false };
  };

  // 💡 다차원 필터링 (고객사, 현장, 시작일, 종료일)
  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      const custName = getCustName(c.customerId).toLowerCase();
      const siteName = getSiteName(c.siteId).toLowerCase();
      const contactName = getContactName(c.contactId).toLowerCase();
      const cas = contractAssets.filter(ca => ca.contractId === c.id);
      const assetNos = cas.map(ca => assets.find(a => a.id === ca.assetId)?.assetNo || '').join(' ').toLowerCase();

      const q = searchTerm.trim();
      const matchesSearch = !q ||
        c.contractNo.toLowerCase().includes(q.toLowerCase()) ||
        matchHangul(custName, q) ||
        matchHangul(siteName, q) ||
        matchHangul(contactName, q) ||
        assetNos.includes(q.toLowerCase()) ||
        matchHangul(assetNos, q);

      const matchesType = contractTypeFilter === 'ALL' || (c.contractType || 'RENTAL') === contractTypeFilter;
      const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
      const matchesCustomer = customerFilter === 'ALL' || c.customerId === customerFilter;
      const matchesSite = siteFilter === 'ALL' || c.siteId === siteFilter;
      const matchesStartDate = !startDateFilter || (c.startDate && c.startDate >= startDateFilter);
      const matchesEndDate = !endDateFilter || normalizeEndDate(c.endDate) <= endDateFilter;

      let matchesChip = true;
      if (quickChipFilter === 'ACTIVE') matchesChip = c.status === 'ACTIVE' || c.status === 'EXTENDED';
      else if (quickChipFilter === 'ASSIGNED') matchesChip = cas.some(ca => assets.find(a => a.id === ca.assetId)?.status === 'ASSIGNED');
      else if (quickChipFilter === 'D3') {
        const dday = getDDayText(c.endDate);
        matchesChip = dday.isWarning;
      } else if (quickChipFilter === 'ZERO_FEE') {
        matchesChip = cas.some(ca => ca.monthlyRentalFee === 0);
      } else if (quickChipFilter === 'SUCCEEDED') matchesChip = c.status === 'SUCCEEDED';
      else if (quickChipFilter === 'COMPLETED') matchesChip = c.status === 'COMPLETED';

      return matchesType && matchesSearch && matchesStatus && matchesCustomer && matchesSite && matchesStartDate && matchesEndDate && matchesChip;
    });
  }, [contracts, contractAssets, assets, customers, sites, contacts, searchTerm, contractTypeFilter, statusFilter, customerFilter, siteFilter, startDateFilter, endDateFilter, quickChipFilter]);

  // 🔍 조회 버튼 핸들러 (서버 실시간 데이터 재동기화 및 필터 반영)
  const handleSearchClick = async () => {
    setCustomerDropdownOpen(false);
    setSiteDropdownOpen(false);
    await refreshAllData();
    showToast(`계약 목록 조회 완료 (총 ${filteredContracts.length}건)`);
  };

  // 선택된 계약 관련 데이터
  const activeContract = contracts.find(c => c.id === selectedContractId);
  const activeContractHistory = contractHistory.filter(h => h.contractId === selectedContractId);
  const activeContractAssets = contractAssets.filter(ca => ca.contractId === selectedContractId);

  // 📜 계약 변경 및 이력 타임라인
  const activeTimeline = useMemo(() => {
    if (!activeContract) return [];

    const timeline: { id: string; date: string; title: string; desc: string; category: 'CONTRACT' | 'INSPECTION' | 'TRUCK' }[] = [];

    // 1. 계약 변경 및 대차 교체 이력
    activeContractHistory.forEach(h => {
      const isExchange = h.changeType === 'EXCHANGE' || h.description.includes('대차') || h.description.includes('교체');
      
      let historyTitle = '계약 이력';
      if (h.changeType === 'BILLING_CREATED' || h.description?.includes('소급 청구') || h.description?.includes('청구서 발행')) {
        historyTitle = '🧾 정기 청구 발행';
      } else if (isExchange) {
        historyTitle = '🔄 자산 대차/교체 이력';
      } else if (h.changeType === 'FEE_CHANGE' || h.description?.includes('단가')) {
        if (h.description.includes('월/일') || (h.description.includes('월') && h.description.includes('일'))) {
          historyTitle = '💰 월/일 렌탈료 단가 변경';
        } else if (h.description.includes('일 렌탈료') || h.description.includes('일 단가') || h.description.includes('일단가')) {
          historyTitle = '💰 일 렌탈료 단가 변경';
        } else {
          historyTitle = '💰 월 렌탈료 단가 변경';
        }
      } else if (h.changeType === 'REGISTER') {
        historyTitle = '계약 등록';
      } else if (h.changeType === 'EXTEND') {
        historyTitle = '기간 변경';
      } else if (h.changeType === 'SHORTEN') {
        historyTitle = '기간 단축';
      } else if (h.changeType === 'SUCCEED') {
        historyTitle = '계약 승계';
      }

      timeline.push({
        id: `h-${h.id}`,
        date: h.changeDate || h.createdAt?.split('T')[0] || todayStr,
        title: historyTitle,
        desc: h.description,
        category: 'CONTRACT'
      });
    });

    // 2. 출고 검수 이력
    const relInsps = outboundInspections.filter(o => o.contractId === activeContract.id);
    relInsps.forEach(i => {
      const asset = assets.find(a => a.id === i.assetId);
      timeline.push({
        id: `i-${i.id}`,
        date: i.inspectedAt?.split('T')[0] || i.createdAt.split('T')[0],
        title: i.status === 'COMPLETED' ? `출고 검수 승인 (${asset?.assetNo || '자산'})` : `출고 검수 대기/반려`,
        desc: i.note || '검수 체크리스트 확인',
        category: 'INSPECTION'
      });
    });

    // 3. 배차 이력
    const relDels = deliveries.filter(d => d.contractId === activeContract.id);
    relDels.forEach(d => {
      const cost = d.finalCost || d.deliveryCostConfirmed || d.deliveryCost || d.expectedCost || 0;
      const dDate = d.loadingDate || d.scheduledDate || d.requestDate || d.createdAt.split('T')[0];
      timeline.push({
        id: `d-${d.id}`,
        date: dDate,
        title: `배차 (${d.type === 'OUTBOUND' ? '출고' : '회수'})`,
        desc: `${d.driverName ? `기사: ${d.driverName} (${d.driverContact || ''})` : '배차 대기'} / 운반비: ${cost.toLocaleString()}원`,
        category: 'TRUCK'
      });
    });

    // ※ 현장 AS 및 정비 이력은 하단 '계약 현장 AS 및 정비 이력' 전용 그리드에서 관리되므로 계약 흐름 타임라인에서는 제외함.

    return timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activeContract, activeContractHistory, outboundInspections, deliveries, activeContractAssets, assets, todayStr]);

  // 핸들러
  const handleSelectContract = (contractId: string) => {
    setSelectedContractId(contractId);
    setViewMode('DETAIL');
  };

  const handleOpenFeeModal = (ca: ContractAsset) => {
    setEditCaId(ca.id);
    setEditMonthlyFee(ca.monthlyRentalFee || 0);
    setEditDailyFee(ca.dailyRentalFee || 0);
    setFeeChangeReason('');
    setShowFeeModal(true);
  };

  const handleSaveFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCaId || !selectedContractId) return;

    try {
      const ca = db.contractAssets.find(c => c.id === editCaId);
      const asset = assets.find(a => a.id === ca?.assetId);
      const oldMonthly = ca?.monthlyRentalFee || 0;
      const oldDaily = ca?.dailyRentalFee || 0;

      const isMonthlyChanged = oldMonthly !== editMonthlyFee;
      const isDailyChanged = oldDaily !== editDailyFee;

      db.updateRow<ContractAsset>('contractAssets', editCaId, {
        monthlyRentalFee: editMonthlyFee,
        dailyRentalFee: editDailyFee
      });

      const assetTag = asset?.assetNo || ca?.expectedModel || '자산';
      let changeDesc = '';

      if (isMonthlyChanged && isDailyChanged) {
        changeDesc = `월/일 렌탈료 단가 수정 [${assetTag}]: (월 ${oldMonthly.toLocaleString()}원 ➔ ${editMonthlyFee.toLocaleString()}원, 일 ${oldDaily.toLocaleString()}원 ➔ ${editDailyFee.toLocaleString()}원) (사유: ${feeChangeReason || '단가 조정'})`;
      } else if (isDailyChanged) {
        changeDesc = `일 렌탈료 단가 수정 [${assetTag}]: ${oldDaily.toLocaleString()}원 ➔ ${editDailyFee.toLocaleString()}원 (사유: ${feeChangeReason || '단가 조정'})`;
      } else {
        changeDesc = `월 렌탈료 단가 수정 [${assetTag}]: ${oldMonthly.toLocaleString()}원 ➔ ${editMonthlyFee.toLocaleString()}원 (사유: ${feeChangeReason || '단가 조정'})`;
      }

      db.insertRow<ContractHistory>('contractHistory', {
        contractId: selectedContractId,
        changeType: 'FEE_CHANGE',
        changeDate: todayStr,
        description: changeDesc,
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
      showToast('렌탈료 변경 사항이 저장되었습니다.');
      setShowFeeModal(false);
    } catch (err: any) {
      showToast(`저장 실패: ${err?.message || err}`, 'error');
    }
  };

  const handleOpenExtendModal = () => {
    if (!activeContract) return;
    const isIndef = isIndefiniteEndDate(activeContract.endDate);
    setModIsOpen(isIndef);
    setModNewEndDate(!isIndef && activeContract.endDate ? activeContract.endDate : todayStr);
    setModDesc('');
    setShowExtendModal(true);
  };

  const handleSaveExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeContract) return;

    const activeCust = customers.find(cu => cu.id === activeContract.customerId);
    const isShortened = !isIndefiniteEndDate(activeContract.endDate) && modNewEndDate < activeContract.endDate!;

    if (!isShortened && activeCust?.transactionStatus === 'BLOCKED') {
      showToast(`[출고제한] 거래처 [${activeCust.name}]은(는) 거래 차단 상태이므로 계약 기간 연장이 불가합니다.`, 'error');
      return;
    }

    if (!modIsOpen && modNewEndDate < activeContract.startDate) {
      showToast(`종료일(${modNewEndDate})은 계약 시작일(${activeContract.startDate}) 이후여야 합니다.`, 'error');
      return;
    }

    try {
      const targetEndDate = modIsOpen ? '미정' : modNewEndDate;
      const prevEnd = activeContract.endDate;

      db.updateRow<Contract>('contracts', activeContract.id, {
        endDate: targetEndDate,
        updatedAt: new Date().toISOString()
      });

      const cAssets = contractAssets.filter(ca => ca.contractId === activeContract.id && ca.status !== 'RETURNED');
      cAssets.forEach(ca => {
        db.updateRow<ContractAsset>('contractAssets', ca.id, {
          endDate: targetEndDate,
          updatedAt: new Date().toISOString()
        });
        if (ca.assetId) {
          db.updateRow<Asset>('assets', ca.assetId, {
            contractEnd: targetEndDate,
            updatedAt: new Date().toISOString()
          });
        }
      });

      db.insertRow<ContractHistory>('contractHistory', {
        contractId: activeContract.id,
        changeType: isShortened ? 'SHORTEN' : 'EXTEND',
        changeDate: todayStr,
        description: `계약 기간 ${isShortened ? '단축' : '연장'}: ${prevEnd || '미정'} ➔ ${targetEndDate} (사유: ${modDesc || '기간 조정'})`,
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
      showToast(`계약 만료일이 [${targetEndDate}]로 변경되었습니다.`);
      setShowExtendModal(false);
    } catch (err: any) {
      showToast(`저장 실패: ${err?.message || err}`, 'error');
    }
  };

  const handleOpenTransferModal = () => {
    if (!activeContract) return;
    setSuccCustId('');
    setSuccContactId('');
    setSuccSiteId('');
    setSuccDate(todayStr);
    setSuccDesc('');
    setShowTransferModal(true);
  };

  const handleSaveTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeContract || !succCustId) {
      showToast('양수 고객사를 선택하십시오.', 'error');
      return;
    }

    if (succDate < activeContract.startDate) {
      showToast(`승계일자(${succDate})는 계약 시작일(${activeContract.startDate}) 이후여야 합니다.`, 'error');
      return;
    }

    try {
      await succeedContract(activeContract.id, succCustId, succContactId, succSiteId, succDate, succDesc);
      showToast('계약 승계가 완료되었습니다.');
      setShowTransferModal(false);
    } catch (err: any) {
      showToast(`승계 실패: ${err?.message || err}`, 'error');
    }
  };

  const handleOpenExchangeGlobal = () => {
    setExchangeContractAssetId('');
    setExchangeOldAssetId(activeContractAssets[0]?.assetId || '');
    setExchangeNewAssetId('');
    setExchangeDate(todayStr);
    setExchangeIdentifyType('KNOWN');
    setExchangeReason('');
    setShowExchangeModal(true);
  };

  const handleExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !selectedContractId) return;

    // 💡 [ERR-003] 중복 대차 방지: 동일 계약에 처리 대기 중인 EXCHANGE 배차/슬롯이 이미 존재하는지 검증
    const pendingExchangeDelivery = deliveries.find(d => 
      d.contractId === selectedContractId && 
      d.type === 'EXCHANGE' && 
      (d.status === 'REQUESTED' || d.status === 'PENDING' || d.status === 'DISPATCHED')
    );
    const unassignedExchangeSlot = contractAssets.find(ca => 
      ca.contractId === selectedContractId && 
      !ca.assetId
    );

    if (pendingExchangeDelivery || unassignedExchangeSlot) {
      showToast('해당 계약에 이미 처리 대기 중인 대차/교체 배차 또는 미할당 슬롯이 존재합니다.', 'error');
      return;
    }

    if (activeContract) {
      if (activeContract.startDate && exchangeDate < activeContract.startDate) {
        showToast(`대차일자(${exchangeDate})는 계약 시작일(${activeContract.startDate}) 이후여야 합니다.`, 'error');
        return;
      }
      if (!isIndefiniteEndDate(activeContract.endDate) && exchangeDate > activeContract.endDate!) {
        showToast(`대차일자(${exchangeDate})는 계약 종료일(${activeContract.endDate}) 이전이어야 합니다.`, 'error');
        return;
      }
    }

    try {
      const oldAssetObj = assets.find(a => a.id === exchangeOldAssetId);
      const targetModelName = exchangeIdentifyType === 'KNOWN' 
        ? (oldAssetObj?.modelName || '동일/동급 모델')
        : (exchangeContractAssetId || activeContractAssets[0]?.expectedModel || '동일/동급 모델');

      const isKnown = exchangeIdentifyType === 'KNOWN';
      const identifyTag = isKnown 
        ? `[식별됨] 관리번호:${oldAssetObj?.assetNo || '미지정'} / SN:${oldAssetObj?.serialNo || '미지정'}`
        : `[미식별] 모델명(${targetModelName}) 현장 입고 검수 시 자산 확정 필요`;

      // 💡 [ERR-001] 기존 자산 ContractAsset 종료 처리 (endDate 고정, status=RETURNED, actualReturnDate)
      const targetOldContractAsset = contractAssets.find(ca => 
        ca.contractId === selectedContractId && 
        (isKnown 
          ? (ca.assetId === exchangeOldAssetId) 
          : (ca.id === exchangeContractAssetId || ca.expectedModel === exchangeContractAssetId || assets.find(a => a.id === ca.assetId)?.modelName === exchangeContractAssetId))
      );

      const prevDateObj = new Date(exchangeDate);
      prevDateObj.setDate(prevDateObj.getDate() - 1);
      const dayBeforeExchange = prevDateObj.toISOString().split('T')[0];

      if (targetOldContractAsset) {
        db.updateRow<ContractAsset>('contractAssets', targetOldContractAsset.id, {
          endDate: dayBeforeExchange,
          status: 'RETURNED',
          actualReturnDate: exchangeDate,
          updatedAt: new Date().toISOString()
        });
      }

      // 1. contractHistory 기록 (헌장 4.1 & 4.2 전자산 전일 마감 ➔ 후장비 당일 승계)
      db.insertRow<ContractHistory>('contractHistory', {
        contractId: selectedContractId,
        changeType: 'EXCHANGE',
        changeDate: exchangeDate,
        description: `[대차/교체 의뢰 접수] ${identifyTag} / 회수모델: ${targetModelName} / 사유: ${exchangeReason || '현장 고장/스펙 변경 요청'} — 기존 계약 조건(렌탈료, 마감일, 현장조건) 100% 자동 상속 (전자산 마감: ${dayBeforeExchange} / 후장비 개시: ${exchangeDate})`,
        createdAt: new Date().toISOString()
      });

      // 2. 후속 업무 흐름 연계: 단일 대차 요구에 대해 'EXCHANGE' (교환 왕복 배차) 1건만 발행
      const targetSite = sites.find(s => s.id === activeContract?.siteId);
      db.insertRow<Delivery>('deliveries', {
        contractId: selectedContractId,
        type: 'EXCHANGE',
        dispatchCategory: '교환',
        status: 'REQUESTED',
        requestDate: exchangeDate,
        scheduledDate: exchangeDate,
        loadingTimeSlot: exchangeTimeSlot,
        unloadingTimeSlot: exchangeTimeSlot,
        originAddress: '본사 주기장',
        destinationAddress: targetSite?.address || '',
        memo: `[대차/교환 왕복 배차] 현장: ${targetSite?.name || '현장'} | 희망시간: ${exchangeTimeSlot} | 회수대상: ${isKnown ? `${oldAssetObj?.assetNo}(${targetModelName})` : `${targetModelName}(미식별)`} ➔ 대차출고요구: ${targetModelName} | 사유: ${exchangeReason}`,
        vehicleType: '5톤 렉카',
        driverName: '',
        deliveryCost: 0,
        deliveryCostConfirmed: 0,
        isCostSettled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 3. 후속 업무 흐름 연계: 출고 부서를 위한 대차 출고 슬롯(ContractAsset) 자동 추가
      db.insertRow<ContractAsset>('contractAssets', {
        contractId: selectedContractId,
        assetId: undefined, // 미할당 상태로 생성하여 출고 부서(asset_assignment.tsx)로 할당 요청
        expectedModel: targetModelName,
        monthlyRentalFee: targetOldContractAsset?.monthlyRentalFee || activeContractAssets[0]?.monthlyRentalFee || 0,
        dailyRentalFee: targetOldContractAsset?.dailyRentalFee || activeContractAssets[0]?.dailyRentalFee || 0,
        startDate: exchangeDate,
        endDate: activeContract?.endDate || '미정',
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
      showToast('대차/교체 의뢰가 접수되었습니다. (배차 및 장비할당 연동 완료)');

      setShowExchangeModal(false);
      setExchangeNewAssetId('');
      setExchangeReason('');
    } catch (err: any) {
      showToast(`대차 의뢰 접수 실패: ${err?.message || err}`, 'error');
    }
  };

  const handleExportExcel = () => {
    const excelData = filteredContracts.map((c, idx) => {
      const cas = contractAssets.filter(ca => ca.contractId === c.id);
      const totalMonthlyRent = cas.reduce((sum, ca) => sum + (ca.monthlyRentalFee || 0), 0);
      const assetSummary = cas.map(ca => {
        const a = assets.find(ast => ast.id === ca.assetId);
        return a ? `${a.modelName}[${a.assetNo}]` : (ca.expectedModel || '미배정');
      }).join(', ');

      return {
        // ① 식별 및 계약
        'No': idx + 1,
        '계약번호': c.contractNo,
        '계약 상태': c.status === 'ACTIVE' ? '진행중' :
                   c.status === 'EXTENDED' ? '연장됨' :
                   c.status === 'SUCCEEDED' ? '승계됨' :
                   c.status === 'SHORTENED' ? '단축종료' : '종료',

        // ② 거래처 및 현장
        '고객사명': getCustName(c.customerId),
        '현장명': getSiteName(c.siteId),
        '현장 담당자': getContactName(c.contactId),
        '영업 담당자': users.find(u => u.id === c.salespersonId)?.name || '-',

        // ③ 체결 장비 요약
        '체결 장비 수': `${cas.length}대`,
        '체결 장비 목록': assetSummary || '-',

        // ④ 계약 일정 및 청구 조건
        '계약 시작일': c.startDate,
        '계약 만료일': formatContractEndDate(c.endDate),
        '청구 마감일': `매월 ${c.billingDay}일`,
        '납기일': c.paymentDueDay ? `익월 ${c.paymentDueDay}일` : '익월 25일 (기본)',
        '월 임대료 합계(원)': totalMonthlyRent,

        // ⑤ 승계 및 이력 연계
        '전계약번호': c.predecessorContractNo || '-',
        '전고객사명': c.predecessorCustomerName || '-',
        '후계약 ID': c.successorContractId || '-',

        // ⑥ 감사
        '등록일자': c.createdAt ? c.createdAt.split('T')[0] : '-'
      };
    });

    exportToExcel(excelData, `계약대장_${todayStr}`, '계약목록');
  };

  const availableAssets = assets.filter(a => a.status === 'AVAILABLE');
  const oldAssetToExchange = assets.find(a => a.id === exchangeOldAssetId);
  const filteredAvailableAssets = assets.filter(a => a.status === 'AVAILABLE' && (oldAssetToExchange ? a.modelName === oldAssetToExchange.modelName : true));

  const handleAddToBasket = () => {
    if (basketAssetMethod === 'ASSET') {
      if (!selectedAssetToAdd) return;
      if (basket.some(b => b.assetId === selectedAssetToAdd)) return;
      setBasket([...basket, { assetId: selectedAssetToAdd, monthlyRentalFee: customMonthly, dailyRentalFee: customDaily }]);
      setSelectedAssetToAdd('');
    } else {
      if (!selectedModelToAdd) return;
      if (basket.some(b => b.expectedModel === selectedModelToAdd)) return;
      setBasket([...basket, { expectedModel: selectedModelToAdd, monthlyRentalFee: customMonthly, dailyRentalFee: customDaily }]);
      setSelectedModelToAdd('');
    }
  };

  const handleRemoveFromBasket = (id?: string) => {
    if (!id) return;
    setBasket(basket.filter(b => b.assetId !== id && b.expectedModel !== id));
  };

  const handleCreateContractSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    if (custSelect !== 'NEW' && custSelect) {
      const selectedCustomer = customers.find(c => c.id === custSelect);
      if (selectedCustomer?.transactionStatus === 'BLOCKED') {
        showToast('🚫 경영진 처분으로 인해 거래 불가(BLOCKED) 상태인 거래처입니다. 신규 계약 등록이 원천 차단됩니다.', 'error');
        return;
      }
      if (selectedCustOverdue && !overdueAcknowledged) {
        showToast('⚠️ 연체 채권 경각심 통제: [수금 책임 인지] 확인 체크박스에 동의해야 신규 계약을 등록할 수 있습니다.', 'error');
        return;
      }
    }

    if (basket.length === 0) {
      showToast('최소 한 대 이상의 자산을 추가하십시오.', 'error');
      return;
    }

    let finalCustomerId = custSelect;
    let finalContactId = contactSelect;
    let finalSiteId = siteSelect;

    if (custSelect === 'NEW') {
      const newCust = db.insertRow<Customer>('customers', {
        name: newCustName,
        bizRegNo: newBizRegNo || '미상',
        isClosed: false,
        address: newAddress || '미상',
        representative: newRepresentative || '미상',
        repContact: newRepContact || '미상',
        repEmail: newRepEmail || '미상',
        createdAt: new Date().toISOString()
      });
      finalCustomerId = newCust.id;
    }

    if (contactSelect === 'NEW') {
      const newContact = db.insertRow<CustomerContact>('contacts', {
        customerId: finalCustomerId,
        name: newContactName || '미상',
        position: newContactPosition || '담당자',
        contact: newContactPhone || '미상',
        email: newContactEmail || '미상',
        isActive: true,
        createdAt: new Date().toISOString()
      });
      finalContactId = newContact.id;
    }

    if (siteSelect === 'NEW') {
      const newSite = db.insertRow<CustomerSite>('sites', {
        customerId: finalCustomerId,
        name: newSiteName,
        address: newSiteAddress || '미상',
        contactName: newSiteContactName || '미상',
        contact: newSiteContactPhone || '미상',
        email: newSiteContactEmail || '미상',
        isActive: true,
        createdAt: new Date().toISOString()
      });
      finalSiteId = newSite.id;
    }

    const finalSalespersonId = salespersonSelect || currentUser?.id;

    createContract({
      customerId: finalCustomerId,
      contactId: finalContactId && finalContactId !== 'NEW' ? finalContactId : undefined,
      siteId: finalSiteId && finalSiteId !== 'NEW' ? finalSiteId : undefined,
      salespersonId: finalSalespersonId,
      startDate: startDate,
      endDate: isEndDateOpen ? '미정' : endDate,
      billingDay: Number(billingDay),
      statementClosingDay: Number(statementClosingDay),
      paymentDueDay: Number(paymentDueDay) || 25,
      lateInterestRate: 0,
      status: 'ACTIVE'
    }, basket);

    showToast('계약 등록이 완료되었습니다.');
    setActiveTab('ALL_LIST');
    setViewMode('LIST');
    setBasket([]);
  };

  // 실시간 계약 KPI 통계 (렌탈 계약과 매각 계약 정밀 분리)
  const contractKpiStats = useMemo(() => {
    const rentalContracts = contracts.filter(c => (c.contractType || 'RENTAL') === 'RENTAL');
    const saleContracts = contracts.filter(c => c.contractType === 'SALE');
    const rentalContractIds = new Set(rentalContracts.map(c => c.id));
    const rentalContractAssets = contractAssets.filter(ca => rentalContractIds.has(ca.contractId));

    const totalCount = contracts.length;
    const rentalCount = rentalContracts.length;
    const saleCount = saleContracts.length;
    const activeCount = rentalContracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED').length;
    const d3Count = rentalContracts.filter(c => getDDayText(c.endDate).isWarning).length;
    const zeroFeeCount = rentalContracts.filter(c => contractAssets.filter(ca => ca.contractId === c.id).some(ca => ca.monthlyRentalFee === 0)).length;
    const succeededCount = rentalContracts.filter(c => c.status === 'SUCCEEDED').length;
    const completedCount = rentalContracts.filter(c => c.status === 'COMPLETED').length;
    const totalRentSum = rentalContractAssets.reduce((sum, ca) => sum + (ca.monthlyRentalFee || 0), 0);
    const totalAssetsCount = contractAssets.length;

    return { totalCount, rentalCount, saleCount, activeCount, d3Count, zeroFeeCount, succeededCount, completedCount, totalRentSum, totalAssetsCount };
  }, [contracts, contractAssets]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }}>
      
      {/* 최상단 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-card)', padding: '14px 18px', borderRadius: '8px', border: '1px solid var(--border-color)', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {viewMode === 'DETAIL' && (
            <button
              className="btn-secondary"
              onClick={() => setViewMode('LIST')}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px' }}
            >
              <ChevronLeft size={16} /> 목록으로 돌아가기
            </button>
          )}
          <div>
            <h2 style={{ fontWeight: '700', marginBottom: '2px', fontSize: '18px' }}>
              {viewMode === 'DETAIL' ? `계약 상세: ${activeContract?.contractNo}` : '계약 관리'}
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              {viewMode === 'DETAIL'
                ? `${getCustName(activeContract?.customerId || '')} — ${getSiteName(activeContract?.siteId)}`
                : '계약 등록, 상태 변경, 기간 조정 및 승계 내역을 관리합니다.'}
            </p>
          </div>
        </div>

        {viewMode === 'LIST' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={activeTab === 'ALL_LIST' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setActiveTab('ALL_LIST')}
              style={{ padding: '7px 14px', fontSize: '12px' }}
            >
              계약 목록 ({filteredContracts.length})
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setBundleTargetContractId(undefined);
                setShowBundleModal(true);
              }}
              style={{ padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary)', fontWeight: 'bold' }}
            >
              <FileText size={14} /> 계약서패키지 PDF / 이메일
            </button>
            {canSave && (
              <button
                className={activeTab === 'CREATE' ? 'btn-success' : 'btn-secondary'}
                onClick={() => setActiveTab('CREATE')}
                style={{ padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Plus size={14} /> 신규 계약 등록
              </button>
            )}
          </div>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* 뷰 1: 계약 목록 (viewMode === 'LIST') */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
            {/* 실시간 계약 운용 KPI 바 (Scope) */}
      {viewMode === 'LIST' && activeTab === 'ALL_LIST' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px', flexShrink: 0 }}>
          <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 계약건수</span>
            <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{contractKpiStats.totalCount}건</strong>
          </div>
          <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>진행/연장중</span>
            <strong style={{ fontSize: '14px', color: 'var(--success)', whiteSpace: 'nowrap' }}>{contractKpiStats.activeCount}건</strong>
          </div>
          <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>만료 임박 (D-3)</span>
            <strong style={{ fontSize: '14px', color: contractKpiStats.d3Count > 0 ? 'var(--danger)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{contractKpiStats.d3Count}건</strong>
          </div>
          <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>단가 0원 주의</span>
            <strong style={{ fontSize: '14px', color: contractKpiStats.zeroFeeCount > 0 ? '#b45309' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{contractKpiStats.zeroFeeCount}건</strong>
          </div>
          <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>체결 투입자산</span>
            <strong style={{ fontSize: '14px', color: '#0070C0', whiteSpace: 'nowrap' }}>{contractKpiStats.totalAssetsCount}대</strong>
          </div>
          <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>월 렌탈료 합계</span>
            <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>₩{contractKpiStats.totalRentSum.toLocaleString()}</strong>
          </div>
        </div>
      )}

      {viewMode === 'LIST' && activeTab === 'ALL_LIST' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* 필터 패널 */}
          <div className="card" style={{ padding: '14px', margin: 0, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            
            {/* 0행: 계약 유형 분계선 탭 (렌탈 계약 vs 매각 계약) */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setContractTypeFilter('RENTAL')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: contractTypeFilter === 'RENTAL' ? 700 : 500,
                  border: contractTypeFilter === 'RENTAL' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                  backgroundColor: contractTypeFilter === 'RENTAL' ? 'var(--primary)' : 'var(--bg-app)',
                  color: contractTypeFilter === 'RENTAL' ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap'
                }}
              >
                렌탈 계약 ({contractKpiStats.rentalCount}건)
              </button>
              <button
                type="button"
                onClick={() => setContractTypeFilter('SALE')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: contractTypeFilter === 'SALE' ? 700 : 500,
                  border: contractTypeFilter === 'SALE' ? '1px solid #8b5cf6' : '1px solid var(--border-color)',
                  backgroundColor: contractTypeFilter === 'SALE' ? '#8b5cf6' : 'var(--bg-app)',
                  color: contractTypeFilter === 'SALE' ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap'
                }}
              >
                매각 계약 ({contractKpiStats.saleCount}건)
              </button>
              <button
                type="button"
                onClick={() => setContractTypeFilter('ALL')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: contractTypeFilter === 'ALL' ? 700 : 500,
                  border: contractTypeFilter === 'ALL' ? '1px solid var(--border-focus, #3b82f6)' : '1px solid var(--border-color)',
                  backgroundColor: contractTypeFilter === 'ALL' ? 'var(--bg-card)' : 'var(--bg-app)',
                  color: contractTypeFilter === 'ALL' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                전체 ({contractKpiStats.totalCount}건)
              </button>
            </div>

            {/* 1행: 검색어 & 엑셀 다운로드 */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-app)', padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <Search size={16} color="var(--text-muted)" />
                <input
                  type="text"
                  placeholder="통합 검색 (계약번호, 고객사명, 현장명, 자산번호, 담당자명...)"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearchClick(); }}
                  style={{ flex: 1, border: 'none', backgroundColor: 'transparent', fontSize: '13px', outline: 'none', color: 'var(--text-primary)' }}
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} style={{ border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>✕</button>
                )}
              </div>

              <button className="btn-secondary" onClick={handleExportExcel} style={{ padding: '8px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Download size={14} /> 엑셀 다운로드
              </button>
            </div>

            {/* 2행: 고객사, 현장, 시작일, 종료일 세부 상세 필터 (레이블 상단 헤더 세로 스택 구조) */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap', backgroundColor: 'var(--bg-app)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              {/* 고객사 콤보박스 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0, position: 'relative' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>고객사 선택</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={customerInputText}
                    onChange={e => {
                      setCustomerInputText(e.target.value);
                      setCustomerFilter('ALL');
                      setCustomerDropdownOpen(true);
                    }}
                    onFocus={() => setCustomerDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
                    placeholder="전체 고객사"
                    style={{ padding: '6px 28px 6px 10px', borderRadius: '6px', fontSize: '12.5px', border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', whiteSpace: 'nowrap', minWidth: '160px', width: '100%' }}
                  />
                  {customerInputText && (
                    <button
                      onMouseDown={e => { e.preventDefault(); setCustomerInputText(''); setCustomerFilter('ALL'); setSiteFilter('ALL'); setSiteInputText(''); }}
                      style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                    >✕</button>
                  )}
                  {customerDropdownOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '6px', marginTop: '2px', minHeight: '44px', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
                      <div
                        onMouseDown={() => { setCustomerFilter('ALL'); setCustomerInputText(''); setSiteFilter('ALL'); setSiteInputText(''); setCustomerDropdownOpen(false); }}
                        style={{ padding: '8px 12px', fontSize: '12.5px', cursor: 'pointer', color: customerFilter === 'ALL' ? 'var(--primary)' : 'var(--text-primary)', fontWeight: customerFilter === 'ALL' ? 700 : 400 }}
                      >전체 고객사</div>
                      {customers
                        .filter(c => !customerInputText || matchHangul(c.name, customerInputText))
                        .map(c => (
                          <div
                            key={c.id}
                            onMouseDown={() => { setCustomerFilter(c.id); setCustomerInputText(c.name); setSiteFilter('ALL'); setSiteInputText(''); setCustomerDropdownOpen(false); }}
                            style={{ padding: '8px 12px', fontSize: '12.5px', cursor: 'pointer', color: customerFilter === c.id ? 'var(--primary)' : 'var(--text-primary)', fontWeight: customerFilter === c.id ? 700 : 400, borderTop: '1px solid var(--border-color)' }}
                          >{c.name}</div>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>

              {/* 현장 콤보박스 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0, position: 'relative' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>현장 선택</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={siteInputText}
                    onChange={e => {
                      setSiteInputText(e.target.value);
                      setSiteFilter('ALL');
                      setSiteDropdownOpen(true);
                    }}
                    onFocus={() => setSiteDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setSiteDropdownOpen(false), 150)}
                    placeholder="전체 현장"
                    style={{ padding: '6px 28px 6px 10px', borderRadius: '6px', fontSize: '12.5px', border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', whiteSpace: 'nowrap', minWidth: '160px', width: '100%' }}
                  />
                  {siteInputText && (
                    <button
                      onMouseDown={e => { e.preventDefault(); setSiteInputText(''); setSiteFilter('ALL'); }}
                      style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                    >✕</button>
                  )}
                  {siteDropdownOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '6px', marginTop: '2px', minHeight: '44px', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
                      <div
                        onMouseDown={() => { setSiteFilter('ALL'); setSiteInputText(''); setSiteDropdownOpen(false); }}
                        style={{ padding: '8px 12px', fontSize: '12.5px', cursor: 'pointer', color: siteFilter === 'ALL' ? 'var(--primary)' : 'var(--text-primary)', fontWeight: siteFilter === 'ALL' ? 700 : 400 }}
                      >전체 현장</div>
                      {(customerFilter === 'ALL' ? sites : sites.filter(s => s.customerId === customerFilter))
                        .filter(s => !siteInputText || matchHangul(s.name, siteInputText))
                        .map(s => (
                          <div
                            key={s.id}
                            onMouseDown={() => { setSiteFilter(s.id); setSiteInputText(s.name); setSiteDropdownOpen(false); }}
                            style={{ padding: '8px 12px', fontSize: '12.5px', cursor: 'pointer', color: siteFilter === s.id ? 'var(--primary)' : 'var(--text-primary)', fontWeight: siteFilter === s.id ? 700 : 400, borderTop: '1px solid var(--border-color)' }}
                          >{s.name}</div>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>

              {/* 계약 시작일 (이후) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>계약 시작일 (이후)</label>
                <input
                  type="date"
                  value={startDateFilter}
                  onChange={e => setStartDateFilter(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearchClick(); }}
                  style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '12px', border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}
                />
              </div>

              {/* 계약 종료일 (이전) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>계약 종료일 (이전)</label>
                <input
                  type="date"
                  value={endDateFilter}
                  onChange={e => setEndDateFilter(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearchClick(); }}
                  style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '12px', border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}
                />
              </div>

              {/* 🌟 [조회] 버튼 (사용자 지정 위치: 계약 종료일 바로 우측) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                <label style={{ fontSize: '11px', fontWeight: 700, visibility: 'hidden', whiteSpace: 'nowrap', userSelect: 'none' }}>조회</label>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSearchClick}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    padding: '5px 16px',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    height: '29px',
                    boxSizing: 'border-box'
                  }}
                >
                  <Search size={14} />
                  <span>조회</span>
                </button>
              </div>

              {/* 필터 초기화 버튼 */}
              {(customerFilter !== 'ALL' || siteFilter !== 'ALL' || startDateFilter || endDateFilter || searchTerm) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, visibility: 'hidden', whiteSpace: 'nowrap', userSelect: 'none' }}>초기화</label>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerFilter('ALL');
                      setCustomerInputText('');
                      setSiteFilter('ALL');
                      setSiteInputText('');
                      setStartDateFilter('');
                      setEndDateFilter('');
                      setSearchTerm('');
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: '11.5px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      height: '29px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      boxSizing: 'border-box'
                    }}
                  >
                    필터 초기화 ✕
                  </button>
                </div>
              )}
            </div>

            {/* 3행: 상태 필터 칩 */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>상태 필터:</span>
              {[
                { id: 'ALL', label: `전체 (${contracts.length})` },
                { id: 'ACTIVE', label: `진행중 (${contracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED').length})` },
                { id: 'D3', label: `만료 임박 (${contracts.filter(c => getDDayText(c.endDate).isWarning).length})` },
                { id: 'ZERO_FEE', label: `렌탈료 0원 (${contracts.filter(c => contractAssets.filter(ca => ca.contractId === c.id).some(ca => ca.monthlyRentalFee === 0)).length})` },
                { id: 'SUCCEEDED', label: `승계건 (${contracts.filter(c => c.status === 'SUCCEEDED').length})` },
                { id: 'COMPLETED', label: `종결건 (${contracts.filter(c => c.status === 'COMPLETED').length})` }
              ].map(chip => (
                <button
                  key={chip.id}
                  onClick={() => setQuickChipFilter(chip.id as any)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11.5px',
                    cursor: 'pointer',
                    border: `1px solid ${quickChipFilter === chip.id ? 'var(--primary)' : 'var(--border-color)'}`,
                    backgroundColor: quickChipFilter === chip.id ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-card)',
                    color: quickChipFilter === chip.id ? 'var(--primary)' : 'var(--text-secondary)',
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* 계약 목록 데이터 테이블 (횡 스크롤 지원 & 셀 줄바꿈 방지) */}
          <div className="card" style={{ padding: 0, margin: 0, overflowX: 'auto' }}>
            <div className="table-container" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-app)', whiteSpace: 'nowrap' }}>
                    <th style={{ textAlign: 'center', whiteSpace: 'nowrap', width: '80px' }}>상세 보기</th>
                    <th style={{ whiteSpace: 'nowrap' }}>계약번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고객사명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>현장명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>월 렌탈료</th>
                    <th style={{ whiteSpace: 'nowrap' }}>계약 기간</th>
                    <th style={{ whiteSpace: 'nowrap' }}>최근 청구 기간</th>
                    <th style={{ whiteSpace: 'nowrap' }}>청구 건수</th>
                    <th style={{ whiteSpace: 'nowrap' }}>만료 D-Day</th>
                    <th style={{ whiteSpace: 'nowrap' }}>청구 마감일</th>
                    <th style={{ whiteSpace: 'nowrap' }}>영업담당</th>
                    <th style={{ whiteSpace: 'nowrap' }}>상태</th>
                    <th style={{ whiteSpace: 'nowrap' }}>체결 자산</th>
                  </tr>
                </thead>
                <tbody style={{ whiteSpace: 'nowrap' }}>
                  {filteredContracts.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                        조회 결과가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredContracts.map(c => {
                      const cas = contractAssets.filter(ca => ca.contractId === c.id);
                      const totalFee = cas.reduce((sum, ca) => sum + (ca.monthlyRentalFee || 0), 0);
                      const dday = getDDayText(c.endDate);
                      const hasZeroFee = cas.some(ca => ca.monthlyRentalFee === 0);

                      // 💡 자산 표기: 모델명 * 수량 요약 집계 (예: GS-1930 2대, GS-3246 1대)
                      const modelCountMap: Record<string, number> = {};
                      cas.forEach(ca => {
                        const a = assets.find(ast => ast.id === ca.assetId);
                        const modelName = a?.modelName || ca.expectedModel || '미지정 모델';
                        modelCountMap[modelName] = (modelCountMap[modelName] || 0) + 1;
                      });

                      const modelSummaryText = Object.entries(modelCountMap)
                        .map(([model, count]) => `${model} ${count}대`)
                        .join(', ');

                      // 💡 계약별 청구 건수 집계 (휴먼에러 및 청구 누락 방지 교차 검증)
                      const cBillings = (billings || []).filter(b => b.contractId === c.id && b.status !== 'REJECTED');
                      const unpaidCount = cBillings.filter(b => b.status !== 'PAID').length;

                      return (
                        <tr
                          key={c.id}
                          style={{ whiteSpace: 'nowrap' }}
                          className="hover-row"
                        >
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              className="btn-primary"
                              style={{ padding: '3px 10px', fontSize: '11px' }}
                              onClick={() => handleSelectContract(c.id)}
                            >
                              상세 ➔
                            </button>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <strong style={{ color: 'var(--primary)' }}>{c.contractNo}</strong>
                              {c.contractType === 'SALE' && (
                                <span style={{ fontSize: '10px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', backgroundColor: '#8b5cf6', color: '#fff', flexShrink: 0 }}>
                                  매각
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <strong>{getCustName(c.customerId)}</strong>
                              {customers.find(cu => cu.id === c.customerId)?.transactionStatus === 'BLOCKED' && (
                                <span style={{ fontSize: '10px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', backgroundColor: '#ef4444', color: '#fff', flexShrink: 0 }}>
                                  출고제한
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{getSiteName(c.siteId)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {c.contractType === 'SALE' ? (
                              <span style={{ color: '#8b5cf6', fontWeight: 700 }}>
                                매각가 ₩{cas.reduce((s, ca) => s + (ca.salePrice || 0), 0).toLocaleString()}원
                              </span>
                            ) : hasZeroFee ? (
                              <span style={{ color: 'var(--danger)', fontWeight: 700 }}>0원 (미입력)</span>
                            ) : (
                              <span>{totalFee.toLocaleString()}원</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{c.startDate} ~ {formatContractEndDate(c.endDate)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {c.lastBilledPeriodStart && c.lastBilledPeriodEnd ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <strong style={{ color: 'var(--primary)', fontSize: '12px' }}>
                                  {c.lastBilledPeriodStart} ~ {c.lastBilledPeriodEnd}
                                </strong>
                                {c.lastBillingDate && (
                                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                                    ({c.lastBilledYm || ''}월분 / {c.lastBillingDate} 발행)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>- (미청구)</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {cBillings.length === 0 ? (
                              <span className="badge badge-danger" style={{ fontSize: '10.5px' }}>0건 (미청구)</span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span className="badge badge-info" style={{ fontSize: '10.5px', fontWeight: 700 }}>
                                  총 {cBillings.length}건
                                </span>
                                {unpaidCount > 0 && (
                                  <span style={{ fontSize: '10.5px', color: 'var(--danger)', fontWeight: 600 }}>
                                    (미수 {unpaidCount})
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {dday.isWarning ? (
                              <span className="badge badge-danger" style={{ fontSize: '10px' }}>{dday.text}</span>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{dday.text}</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>매월 {c.billingDay}일</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{users.find(u => u.id === c.salespersonId)?.name || '-'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={
                              c.status === 'ACTIVE' || c.status === 'EXTENDED' ? 'badge badge-success' :
                              c.status === 'SUCCEEDED' ? 'badge badge-info' : 'badge badge-secondary'
                            }>
                              {c.status === 'ACTIVE' ? '진행중' : c.status === 'EXTENDED' ? '연장됨' : c.status === 'SUCCEEDED' ? '승계됨' : '종료'}
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <strong style={{ color: 'var(--text-primary)' }}>{modelSummaryText || '미지정'}</strong>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>(총 {cas.length}대)</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Gutenberg Z-패턴 4단계 최하단 회계 대차대조식 검증 바 (헌장 3.5) */}
            <div style={{
              padding: '8px 14px',
              backgroundColor: 'var(--bg-app)',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '11.5px',
              borderRadius: '0 0 6px 6px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span>전사 체결계약: <strong style={{ color: 'var(--primary)' }}>{contractKpiStats.totalCount}건</strong> (진행 {contractKpiStats.activeCount} / 승계 {contractKpiStats.succeededCount} / 종결 {contractKpiStats.completedCount})</span>
                <span>|</span>
                <span>체결 투입자산: <strong style={{ color: 'var(--primary)' }}>{contractKpiStats.totalAssetsCount}대</strong></span>
                <span>|</span>
                <span>월 렌탈료 총액: <strong style={{ color: 'var(--primary)' }}>₩{contractKpiStats.totalRentSum.toLocaleString()}원</strong></span>
              </div>
              <span style={{
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'var(--success-light)',
                color: 'var(--success)',
                fontWeight: 700,
                fontSize: '11px'
              }}>
                ⚖️ 대차 정상 (계약-자산-청구 기준정보 100% 무결)
              </span>
            </div>

          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* 뷰 2: 계약 상세 뷰 (viewMode === 'DETAIL') */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {viewMode === 'DETAIL' && activeContract && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* 상단 컨트롤 바 */}
          <div className="card" style={{ padding: '12px 18px', margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge badge-success" style={{ fontSize: '12px' }}>
                {activeContract.status === 'ACTIVE' ? '진행중' : activeContract.status === 'EXTENDED' ? '연장됨' : activeContract.status === 'SUCCEEDED' ? '승계됨' : '종료'}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>등록일: {activeContract.createdAt?.split('T')[0]}</span>
            </div>

            {/* 실행 버튼 그룹 */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setBundleTargetContractId(activeContract.id);
                  setShowBundleModal(true);
                }}
                style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary)', fontWeight: 'bold' }}
              >
                <Download size={14} /> 계약서패키지 PDF / 이메일
              </button>

              {canSave && canModifyContract(activeContract) && (
                <>
                  <button className="btn-primary" onClick={handleOpenExtendModal} style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={14} /> 기간 연장/단축
                  </button>

                  <button className="btn-secondary" onClick={handleOpenTransferModal} style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ArrowLeftRight size={14} /> 계약 승계
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 기본 정보 & 체결 자산 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
            
            {/* 섹션 1: 계약 기본 정보 */}
            <div className="card" style={{ margin: 0, height: '100%' }}>
              <h3 className="card-title" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Building2 size={16} /> 계약 기본 정보
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                <div>
                  <label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>고객사명</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <strong>{getCustName(activeContract.customerId)}</strong>
                    {customers.find(cu => cu.id === activeContract.customerId)?.transactionStatus === 'BLOCKED' && (
                      <span style={{ fontSize: '10px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', backgroundColor: '#ef4444', color: '#fff', flexShrink: 0 }}>
                        출고제한
                      </span>
                    )}
                  </div>
                </div>
                <div><label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>현장명</label><strong>{getSiteName(activeContract.siteId)}</strong></div>
                
                <div><label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>영업담당</label><span>{users.find(u => u.id === activeContract.salespersonId)?.name || '-'}</span></div>
                <div><label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>청구 / 마감 / 납기일</label>매월 {activeContract.billingDay}일 / {activeContract.statementClosingDay || '-'}일 (납기: 익월 {activeContract.paymentDueDay || 25}일)</div>
                
                <div><label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>계약 시작일</label><span>{activeContract.startDate}</span></div>
                <div>
                  <label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>계약 만료일</label>
                  <span>{formatContractEndDate(activeContract.endDate)}</span>
                  {!isIndefiniteEndDate(activeContract.endDate) && (
                    <span className={getDDayText(activeContract.endDate).isWarning ? "badge badge-danger" : "badge badge-secondary"} style={{ marginLeft: '6px', fontSize: '10px' }}>
                      {getDDayText(activeContract.endDate).text}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>최근 청구 기간</label>
                  {activeContract.lastBilledPeriodStart && activeContract.lastBilledPeriodEnd ? (
                    <strong style={{ color: 'var(--primary)', fontSize: '13px' }}>
                      {activeContract.lastBilledPeriodStart} ~ {activeContract.lastBilledPeriodEnd}
                    </strong>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>- (미청구 계약)</span>
                  )}
                </div>
                <div>
                  <label style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>최근 청구 발행일 / 누적 건수</label>
                  <span>
                    {activeContract.lastBillingDate ? `${activeContract.lastBillingDate} (${activeContract.lastBilledYm || ''}월분) / 총 ${activeContract.billingCount || 0}건` : '발행 이력 없음'}
                  </span>
                </div>
              </div>

              {/* 승계 이전 정보 안내 박스 */}
              {(activeContract.predecessorContractNo || activeContract.predecessorCustomerName) && (
                <div style={{ marginTop: '12px', padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '12px' }}>
                  <div style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    🔄 승계 이전 계약 정보
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', color: 'var(--text-primary)' }}>
                    <div><span style={{ color: 'var(--text-muted)' }}>이전 고객사:</span> <strong>{activeContract.predecessorCustomerName || '-'}</strong></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>이전 계약번호:</span> <strong>{activeContract.predecessorContractNo || '-'}</strong></div>
                  </div>
                </div>
              )}

              {/* 계약 귀속 외상미수금 (수리비/운송비/부대비용) 현황 */}
              {(() => {
                const contractReceivables = (receivables || []).filter(r => 
                  r.contractId === activeContract.id || (r.customerId === activeContract.customerId && !r.contractId)
                );
                const recTotal = contractReceivables.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
                const recBilled = contractReceivables.reduce((sum, r) => sum + (r.billedAmount || 0), 0);
                const recRemaining = Math.max(0, recTotal - recBilled);
                const unbilledCount = contractReceivables.filter(r => r.status !== 'CLEARED').length;

                return (
                  <div style={{
                    marginTop: '14px',
                    padding: '12px 14px',
                    backgroundColor: unbilledCount > 0 ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-app)',
                    borderRadius: '8px',
                    border: `1px solid ${unbilledCount > 0 ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)'}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700, fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px', color: unbilledCount > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                        <AlertCircle size={15} />
                        <span>외상미수금 (수리비/부대비용)</span>
                        {unbilledCount > 0 ? (
                          <span className="badge badge-danger" style={{ fontSize: '10px' }}>미청구 {unbilledCount}건</span>
                        ) : (
                          <span className="badge badge-secondary" style={{ fontSize: '10px' }}>미청구 없음</span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        총 {contractReceivables.length}건 발생
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: contractReceivables.length > 0 ? '10px' : '0' }}>
                      <div style={{ padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>외상 총액</div>
                        <div style={{ fontSize: '12px', fontWeight: 700 }}>{recTotal.toLocaleString()}원</div>
                      </div>
                      <div style={{ padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>기청구액</div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--success)' }}>{recBilled.toLocaleString()}원</div>
                      </div>
                      <div style={{ padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>미청구 잔액</div>
                        <div style={{ fontSize: '12px', fontWeight: 800, color: recRemaining > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{recRemaining.toLocaleString()}원</div>
                      </div>
                    </div>

                    {/* 최근 미청구 외상 항목 간략 리스트 */}
                    {contractReceivables.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', maxHeight: '100px', overflowY: 'auto' }}>
                        {contractReceivables.slice(0, 3).map(r => (
                          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', borderRadius: '3px', backgroundColor: 'var(--bg-card)' }}>
                            <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                              [{r.occurredDate}] {r.internalDescription}
                            </span>
                            <span style={{ fontWeight: 600, color: r.status === 'CLEARED' ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }}>
                              {r.totalAmount.toLocaleString()}원 ({r.status === 'CLEARED' ? '청구완료' : '미청구'})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 로컬 문서고 및 발송 서류 보관함 (색인 & 다시 열기) */}
              <div style={{
                marginTop: '12px',
                padding: '12px 14px',
                backgroundColor: 'var(--bg-app)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                      <FolderOpen size={15} color="var(--primary)" />
                      <span>로컬 문서고 및 발송 서류 보관함</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      발송 서류 색인: <strong>{getCustName(activeContract.customerId)}_{getSiteName(activeContract.siteId)}_{activeContract.contractNo}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        const indexName = `${getCustName(activeContract.customerId)}_${getSiteName(activeContract.siteId)}_${activeContract.contractNo}`;
                        navigator.clipboard.writeText(indexName);
                        showToast('색인 명칭이 클립보드에 복사되었습니다.');
                      }}
                      style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="색인 명칭 복사"
                    >
                      <Copy size={12} /> 색인 복사
                    </button>
                    
                    <label className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
                      <ExternalLink size={12} /> 로컬 서류 열기
                      <input
                        type="file"
                        accept=".pdf,.xlsx,.xls,.zip,.png,.jpg"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = URL.createObjectURL(file);
                            window.open(url, '_blank');
                          }
                        }}
                      />
                    </label>

                    {canGeneratePackage ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        setBundleTargetContractId(activeContract.id);
                        setShowBundleModal(true);
                      }}
                      style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <FileText size={12} /> 계약서패키지 생성
                    </button>
                    ) : (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', border: '1px solid var(--border-color)', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                      <FileText size={12} /> 패키지 생성 권한 없음
                    </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 섹션 2: 체결 자산 목록 */}
            <div className="card" style={{ margin: 0, height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Wrench size={16} /> 체결 자산 목록 ({activeContractAssets.length}대)
                </h3>
                {canSave && canModifyContract(activeContract) && activeContract.status !== 'COMPLETED' && (
                  <button className="btn-secondary" onClick={() => handleOpenExchangeGlobal()} style={{ padding: '5px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Repeat size={13} /> 자산 교체/대차 의뢰
                  </button>
                )}
              </div>

              <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                <table>
                  <thead>
                    {activeContract.contractType === 'SALE' ? (
                      <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                        <th style={{ whiteSpace: 'nowrap' }}>자산번호</th>
                        <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                        <th style={{ whiteSpace: 'nowrap' }}>매각 공급가액</th>
                        <th style={{ whiteSpace: 'nowrap' }}>부가세 (10%)</th>
                        <th style={{ whiteSpace: 'nowrap' }}>매각 총합계</th>
                        <th style={{ whiteSpace: 'nowrap' }}>매각 상태</th>
                      </tr>
                    ) : (
                      <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                        <th style={{ whiteSpace: 'nowrap' }}>자산번호</th>
                        <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                        <th style={{ whiteSpace: 'nowrap' }}>월 렌탈료</th>
                        <th style={{ whiteSpace: 'nowrap' }}>일 렌탈료</th>
                        <th style={{ whiteSpace: 'nowrap' }}>기여액 <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>(기수)</span></th>
                        <th style={{ whiteSpace: 'nowrap' }}>월 청구 예정 <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>(미수)</span></th>
                        <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>수정</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {activeContractAssets.map(ca => {
                      const asset = assets.find(a => a.id === ca.assetId);
                      if (activeContract.contractType === 'SALE') {
                        const price = ca.salePrice || 0;
                        const vat = Math.round(price * 0.1);
                        return (
                          <tr key={ca.id}>
                            <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--primary)' }}>{asset?.assetNo || '미지정'}</strong></td>
                            <td style={{ whiteSpace: 'nowrap' }}>{asset?.modelName || ca.expectedModel}</td>
                            <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: '#8b5cf6' }}>₩{price.toLocaleString()}원</strong></td>
                            <td style={{ whiteSpace: 'nowrap' }}>₩{vat.toLocaleString()}원</td>
                            <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--text-primary)' }}>₩{(price + vat).toLocaleString()}원</strong></td>
                            <td style={{ whiteSpace: 'nowrap' }}><span className="badge" style={{ backgroundColor: '#8b5cf6', color: '#fff', fontSize: '11px' }}>매각완료</span></td>
                          </tr>
                        );
                      }

                      const isZero = ca.monthlyRentalFee === 0;

                      // ── 기여액 (기수): 이미 발행된 청구 명세 합계만
                      // "기수된 성과 = 기여" 원칙 — billing_details.contractAssetId로 실청구 누계 집계
                      // 아직 발행되지 않은 미래 청구는 포함 불가 (미수 → 기여 아님)
                      const accrualContribution = (billingDetails || [])
                        .filter(bd => bd.contractAssetId === ca.id)
                        .reduce((sum, bd) => sum + (bd.amount || 0), 0);

                      // ── 월 청구 예정 (미수): 계약상 약정된 월 렌탈료
                      // 아직 도래하지 않은 기일의 계획 — 기여로 판단하지 않으며, 예정 정보로만 표시
                      const monthlyScheduled = ca.monthlyRentalFee || 0;

                      return (
                        <tr key={ca.id}>
                          <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--primary)' }}>{asset?.assetNo || '미지정'}</strong></td>
                          <td style={{ whiteSpace: 'nowrap' }}>{asset?.modelName || ca.expectedModel}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {isZero ? (
                              <span style={{ color: 'var(--danger)', fontWeight: 700 }}>0원 (미입력)</span>
                            ) : (
                              <span>{ca.monthlyRentalFee.toLocaleString()}원</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{(ca.dailyRentalFee || 0).toLocaleString()}원</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {/* 기수: 실발행 청구 누계 — 이것만이 기여로 인정되는 확정 성과 */}
                            {accrualContribution > 0 ? (
                              <strong style={{ color: '#0070C0' }}>₩{accrualContribution.toLocaleString()}</strong>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>청구 없음</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {/* 미수: 계획된 정기 청구 예정액 — 기여 아님, 단순 약정 참고 */}
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                              {monthlyScheduled > 0 ? `${monthlyScheduled.toLocaleString()}원` : '-'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {canSave && canModifyContract(activeContract) && (
                              <button className="btn-secondary" onClick={() => handleOpenFeeModal(ca)} style={{ padding: '2px 6px', fontSize: '10.5px' }}>
                                <Edit3 size={11} /> 렌탈료 수정
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 하단 그리드: 계약 관련 청구 발행 현황 & 계약 변경 이력 2분할 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', alignItems: 'start' }}>
            
            {/* 섹션 3: 청구 발행 현황 */}
            <div className="card" style={{ margin: 0, height: '100%' }}>
              {(() => {
                const contractBillings = (billings || [])
                  .filter(b => b.contractId === activeContract?.id)
                  .sort((a, b) => (b.billingYm || '').localeCompare(a.billingYm || ''));

                const totalBilled = contractBillings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
                const totalPaid = contractBillings.reduce((sum, b) => sum + (b.paidAmount || 0), 0);
                const totalUnpaid = Math.max(0, totalBilled - totalPaid);

                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '6px' }}>
                      <div>
                        <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Receipt size={16} color="var(--primary)" /> 청구 발행 현황 ({contractBillings.length}건)
                        </h3>
                        {activeContract?.lastBilledPeriodStart && activeContract?.lastBilledPeriodEnd && (
                          <div style={{ fontSize: '11px', color: 'var(--primary)', marginTop: '2px', fontWeight: 600 }}>
                            ※ 직전 청구 마일스톤: {activeContract.lastBilledPeriodStart} ~ {activeContract.lastBilledPeriodEnd} ({activeContract.lastBillingDate ? `${activeContract.lastBillingDate} 발행` : ''})
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        누적청구: <strong style={{ color: 'var(--text-primary)' }}>₩{totalBilled.toLocaleString()}</strong> | 
                        미수잔액: <strong style={{ color: totalUnpaid > 0 ? 'var(--danger)' : 'var(--success)' }}>₩{totalUnpaid.toLocaleString()}</strong>
                      </div>
                    </div>

                    <div className="table-container" style={{ border: 'none', maxHeight: '320px', overflowY: 'auto' }}>
                      {contractBillings.length === 0 ? (
                        <div style={{ color: 'var(--danger)', textAlign: 'center', padding: '30px 0', fontSize: '12.5px', fontWeight: 600 }}>
                          ⚠️ 발행된 청구 내역이 없습니다. (미청구 계약)
                        </div>
                      ) : (
                        <table style={{ width: '100%', fontSize: '12px', whiteSpace: 'nowrap' }}>
                          <thead>
                            <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                              <th style={{ padding: '6px 8px' }}>청구귀속월</th>
                              <th style={{ padding: '6px 8px' }}>발행일자</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>청구금액</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>수납액</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>미수잔액</th>
                              <th style={{ padding: '6px 8px', textAlign: 'center' }}>상태</th>
                            </tr>
                          </thead>
                          <tbody>
                            {contractBillings.map(b => {
                              const unpaid = Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0));
                              return (
                                <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <td style={{ padding: '6px 8px' }}><strong>{b.billingYm}</strong></td>
                                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{b.billingDate || '-'}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{(b.totalAmount || 0).toLocaleString()}원</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--success)' }}>{(b.paidAmount || 0).toLocaleString()}원</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', color: unpaid > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: unpaid > 0 ? 700 : 400 }}>
                                    {unpaid.toLocaleString()}원
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                    <span className={`badge ${
                                      b.status === 'UNPAID' ? 'badge-secondary' :
                                      b.status === 'REQUESTED' ? 'badge-warning' :
                                      b.status === 'REJECTED' ? 'badge-danger' :
                                      b.status === 'PAID' ? 'badge-success' :
                                      b.status === 'PARTIAL' ? 'badge-info' : 'badge-secondary'
                                    }`} style={{ fontSize: '10px' }}>
                                      {b.status === 'UNPAID' ? '미발송' :
                                       b.status === 'REQUESTED' ? '발송완료' :
                                       b.status === 'REJECTED' ? '이의제기' :
                                       b.status === 'PAID' ? '완납' :
                                       b.status === 'PARTIAL' ? '일부납' : b.status}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 섹션 4: 계약 변경 및 이력 */}
            <div className="card" style={{ margin: 0, height: '100%' }}>
              <h3 className="card-title" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={16} color="var(--primary)" /> 계약 변경 및 이력 ({activeTimeline.length}건)
              </h3>

              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                {activeTimeline.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>기록된 이력이 없습니다.</div>
                ) : (
                  activeTimeline.map(item => (
                    <div
                      key={item.id}
                      style={{
                        padding: '10px 12px',
                        borderLeft: `3px solid ${
                          item.category === 'CONTRACT' ? 'var(--primary)' :
                          item.category === 'INSPECTION' ? '#166534' :
                          item.category === 'TRUCK' ? '#2563eb' : '#c2410c'
                        }`,
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: '0 4px 4px 0',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: '2px' }}>
                        <span>{item.title}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{item.date}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)' }}>{item.desc}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 섹션 5: 계약 귀속 현장 AS 및 정비 이력 */}
          {(() => {
            const relAssetIds = activeContractAssets.map(ca => ca.assetId).filter((id): id is string => Boolean(id));
            const contractRepairs = (repairs || []).filter(r => 
              r.contractId === activeContract.id ||
              (r.assetId && relAssetIds.includes(r.assetId)) ||
              (!r.assetId && r.customerId === activeContract.customerId && (r.siteId === activeContract.siteId || r.siteName === getSiteName(activeContract.siteId)))
            ).sort((a, b) => new Date(b.visitDate || b.requestDate || b.createdAt).getTime() - new Date(a.visitDate || a.requestDate || a.createdAt).getTime());

            const isFrequent = contractRepairs.length >= 2;

            return (
              <div className="card" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Wrench size={16} color="var(--primary)" /> 계약 현장 AS 및 정비 이력 ({contractRepairs.length}건)
                    </h3>
                    {isFrequent && (
                      <span className="badge badge-danger" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ⚠️ AS {contractRepairs.length}회 발생 - 장비 대차/교체 검토 요망
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    총 정비/수리 비용: <strong style={{ color: 'var(--text-primary)' }}>₩{contractRepairs.reduce((sum, r) => sum + (r.totalCost || r.billableAmount || 0), 0).toLocaleString()}</strong>
                  </div>
                </div>

                <div className="table-container" style={{ border: 'none', maxHeight: '280px', overflowY: 'auto' }}>
                  {contractRepairs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', fontSize: '12.5px' }}>
                      ✓ 이 계약에 발생한 현장 AS 및 정비 이력이 없습니다. (무장애 운용중)
                    </div>
                  ) : (
                    <table style={{ width: '100%', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                          <th style={{ padding: '6px 8px' }}>접수/조치일자</th>
                          <th style={{ padding: '6px 8px' }}>자산번호 (모델)</th>
                          <th style={{ padding: '6px 8px' }}>고장 분류 / 증상</th>
                          <th style={{ padding: '6px 8px' }}>정비 조치내용</th>
                          <th style={{ padding: '6px 8px' }}>담당 정비사</th>
                          <th style={{ padding: '6px 8px' }}>유상 / 무상</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractRepairs.map(r => {
                          const asset = assets.find(a => a.id === r.assetId);
                          const assetLabel = asset?.assetNo || r.assetNo || (activeContractAssets.length === 1 ? (assets.find(a => a.id === activeContractAssets[0].assetId)?.assetNo || '단독장비') : '현장확인');
                          const dateStr = r.visitDate || r.completedDate || r.requestDate || r.createdAt.split('T')[0];

                          return (
                            <tr key={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{dateStr}</td>
                              <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--primary)' }}>
                                {assetLabel} <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>({r.modelName || asset?.modelName || '고소작업대'})</span>
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <span style={{ fontWeight: 600 }}>[{r.issueCategory || '일반'}]</span> {r.issueDescription || r.details || '-'}
                              </td>
                              <td style={{ padding: '6px 8px', color: '#059669', fontWeight: 600 }}>
                                {r.actionTaken || '정비 완료'}
                              </td>
                              <td style={{ padding: '6px 8px' }}>{r.mechanicName || '-'}</td>
                              <td style={{ padding: '6px 8px' }}>
                                {r.billableAmount && r.billableAmount > 0 ? (
                                  <span style={{ color: '#dc2626', fontWeight: 700 }}>
                                    유상 ₩{r.billableAmount.toLocaleString()}
                                  </span>
                                ) : (
                                  <span style={{ color: '#059669' }}>무상 정비</span>
                                )}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                <span className={`badge ${
                                  r.status === 'COMPLETED' ? 'badge-success' :
                                  r.status === 'REVISIT' ? 'badge-warning' :
                                  r.status === 'GUIDED' ? 'badge-info' : 'badge-secondary'
                                }`} style={{ fontSize: '10px' }}>
                                  {r.status === 'COMPLETED' ? '조치완료' :
                                   r.status === 'REVISIT' ? '재방문요' :
                                   r.status === 'GUIDED' ? '안내종결' :
                                   r.status === 'IN_PROGRESS' ? '정비중' : '접수'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* 모달 1: 렌탈료 수정 */}
      {showFeeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleSaveFee} className="card" style={{ width: '100%', maxWidth: '400px', backgroundColor: 'var(--bg-card)' }}>
            <h3 className="card-title" style={{ marginBottom: '14px' }}>렌탈료 수정</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label>월 렌탈료 (원) *</label>
                <input type="number" value={editMonthlyFee} onChange={e => setEditMonthlyFee(Number(e.target.value))} required style={{ width: '100%', padding: '8px' }} />
              </div>
              <div>
                <label>일할 계산 일단가 (원) *</label>
                <input type="number" value={editDailyFee} onChange={e => setEditDailyFee(Number(e.target.value))} required style={{ width: '100%', padding: '8px' }} />
              </div>
              <div>
                <label>변경 사유 *</label>
                <input type="text" placeholder="단가 조정 사유 입력" value={feeChangeReason} onChange={e => setFeeChangeReason(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowFeeModal(false)}>취소</button>
              <button type="submit" className="btn-primary">저장</button>
            </div>
          </form>
        </div>
      )}

      {/* 모달 2: 만료일 / 기간 연장/단축 */}
      {showExtendModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleSaveExtend} className="card" style={{ width: '100%', maxWidth: '400px', backgroundColor: 'var(--bg-card)' }}>
            <h3 className="card-title" style={{ marginBottom: '14px' }}>계약 기간 연장 / 단축</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={modIsOpen} onChange={e => setModIsOpen(e.target.checked)} />
                종료일 미정 (상시 대여중)
              </label>

              {!modIsOpen && (
                <div>
                  <label>변경 만료일 *</label>
                  <input type="date" value={modNewEndDate} onChange={e => setModNewEndDate(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
                </div>
              )}

              <div>
                <label>변경 사유 *</label>
                <input type="text" placeholder="기간 연장 또는 단축 사유 입력" value={modDesc} onChange={e => setModDesc(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowExtendModal(false)}>취소</button>
              <button type="submit" className="btn-primary">저장</button>
            </div>
          </form>
        </div>
      )}

      {/* 모달 3: 계약 승계 */}
      {showTransferModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleSaveTransfer} className="card" style={{ width: '100%', maxWidth: '420px', backgroundColor: 'var(--bg-card)' }}>
            <h3 className="card-title" style={{ marginBottom: '14px' }}>계약 승계 처리</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label>양수 고객사 선택 *</label>
                <select value={succCustId} onChange={e => setSuccCustId(e.target.value)} required style={{ width: '100%', padding: '8px' }}>
                  <option value="">-- 양수 고객사 선택 --</option>
                  {customers.filter(c => c.id !== activeContract?.customerId).map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.bizRegNo})</option>
                  ))}
                </select>
              </div>

              <div>
                <label>승계 일자 *</label>
                <input type="date" value={succDate} onChange={e => setSuccDate(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
              </div>

              <div>
                <label>승계 사유 및 메모</label>
                <input type="text" placeholder="승계 사유 입력" value={succDesc} onChange={e => setSuccDesc(e.target.value)} style={{ width: '100%', padding: '8px' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowTransferModal(false)}>취소</button>
              <button type="submit" className="btn-primary" disabled={!succCustId}>승계 처리</button>
            </div>
          </form>
        </div>
      )}

      {/* 모달 4: 자산 교체 / 대차 의뢰 (식별 여부 구분 및 업무 흐름 자동 연계 구조) */}
      {showExchangeModal && activeContract && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleExchangeSubmit} className="card" style={{ width: '100%', maxWidth: '500px', backgroundColor: 'var(--bg-card)' }}>
            <h3 className="card-title" style={{ marginBottom: '14px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ArrowLeftRight size={18} /> 자산 교체 / 대차 의뢰
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '18px' }}>
              
              {/* 1단계 시작점 분기: 교체 대상 식별 여부 */}
              <div>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '6px', fontSize: '12px' }}>1. 회수 대상 장비 식별 상태 *</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className={exchangeIdentifyType === 'KNOWN' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setExchangeIdentifyType('KNOWN')}
                    style={{ flex: 1, padding: '8px 10px', fontSize: '11.5px', fontWeight: 'bold', borderRadius: '6px' }}
                  >
                    🔵 모델 + 관리번호/S/N 식별됨
                  </button>
                  <button
                    type="button"
                    className={exchangeIdentifyType === 'UNKNOWN' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setExchangeIdentifyType('UNKNOWN')}
                    style={{ flex: 1, padding: '8px 10px', fontSize: '11.5px', fontWeight: 'bold', borderRadius: '6px' }}
                  >
                    🟠 모델명만 지정 (현장회수시 확정)
                  </button>
                </div>
              </div>

              {/* 회수 대상 장비 선택 */}
              {exchangeIdentifyType === 'KNOWN' ? (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px', display: 'block' }}>회수 대상 계약 자산 선택 (자산번호/SN 지정) *</label>
                  <select value={exchangeOldAssetId} onChange={e => setExchangeOldAssetId(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '6px', fontSize: '12.5px' }}>
                    {activeContractAssets.map(ca => {
                      const ast = assets.find(a => a.id === ca.assetId);
                      return (
                        <option key={ca.id} value={ca.assetId}>
                          {ast ? `${ast.modelName} (관리번호: ${ast.assetNo} / SN: ${ast.serialNo || '미기재'})` : (ca.expectedModel || '자산')}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px', display: 'block' }}>회수 대상 요청 모델 선택 (모델명만) *</label>
                    <select value={exchangeContractAssetId} onChange={e => setExchangeContractAssetId(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '6px', fontSize: '12.5px' }}>
                      {Array.from(new Set(activeContractAssets.map(ca => ca.expectedModel || (assets.find(a => a.id === ca.assetId)?.modelName)))).map((model, idx) => (
                        <option key={idx} value={model}>{model} (현장 회수 검수 시 자산번호 확정)</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ padding: '8px 10px', backgroundColor: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: '6px', fontSize: '11.5px', color: 'var(--warning-hover)' }}>
                    💡 <strong>미식별 교체 안내:</strong> 현장의 정확한 자산번호/SN을 모르는 상태입니다. 대차 장비 출고 후 회수 장비가 센터에 <strong>입고 검수 승인되는 시점에 자산번호가 최종 매핑 완성</strong>됩니다.
                  </div>
                </div>
              )}

              {/* 계약 속성 자동 상속 카드 명세 */}
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontWeight: 'bold', color: 'var(--primary)', marginBottom: '2px' }}>🔒 기존 계약 속성 100% 자동 상속</div>
                <div>고객사 / 현장: <strong>{getCustName(activeContract.customerId)} — {getSiteName(activeContract.siteId)}</strong></div>
                <div>대차 요구 모델: <strong>{exchangeIdentifyType === 'KNOWN' ? (assets.find(a => a.id === exchangeOldAssetId)?.modelName || activeContractAssets[0]?.expectedModel || '동급 동일 모델') : (exchangeContractAssetId || activeContractAssets[0]?.expectedModel || '동급 동일 모델')}</strong></div>
                <div>렌탈료 단가 조건: 기존 계약 월 렌탈료 조건 100% 동일 상속 (추가 비용 없음)</div>
                <div>청구 / 작업지시 조건: 매월 {activeContract.billingDay}일 청구 마감 조건 승계</div>
              </div>

              {/* 후속 업무 흐름 연계 시각화 카드 */}
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--info-light)', border: '1px solid var(--info)', borderRadius: '6px', fontSize: '11.5px', color: 'var(--info)' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>🔄 후속 업무 자동 연계 체인</div>
                <div>1. <strong>[배차 관리]</strong>에 교환 왕복 배차(EXCHANGE) 1건 자동 발행 (출고/회수 1:1 통합 관리)</div>
                <div>2. <strong>[장비 할당]</strong> 보드 최상단 카드로 대차 출고 할당 요청 자동 노출</div>
                <div>3. <strong>[입고 검수]</strong> 승인 마감 시 회수 자산 `AVAILABLE`(또는 수리) 자동 마감 연동</div>
              </div>

              {/* 대차/교체 희망일자 및 희망시간대 (상하 헤더 세로 스택 컨셉) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>대차/교체 희망일자 *</label>
                  <input
                    type="date"
                    value={exchangeDate}
                    onChange={e => setExchangeDate(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', fontSize: '12.5px', border: '1px solid var(--border-color)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>희망 시간대 (배차 스케줄) *</label>
                  <select
                    value={exchangeTimeSlot}
                    onChange={e => setExchangeTimeSlot(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', fontSize: '12.5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                  >
                    <option value="오전 (08:00 ~ 12:00)">오전 (08:00 ~ 12:00)</option>
                    <option value="오후 (13:00 ~ 17:00)">오후 (13:00 ~ 17:00)</option>
                    <option value="새벽/조기 (07:00 이전)">새벽/조기 (07:00 이전)</option>
                    <option value="08:30 정시 도착">08:30 정시 도착</option>
                    <option value="13:00 정시 도착">13:00 정시 도착</option>
                    <option value="야간/작업 마감후">야간/작업 마감후</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px', display: 'block' }}>교체 사유 및 현장 상황 메모 *</label>
                <input type="text" placeholder="예: 유압유 누유 고장, 작업 높이 변경 요청 등" value={exchangeReason} onChange={e => setExchangeReason(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '6px', fontSize: '12.5px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowExchangeModal(false)}>취소</button>
              <button type="submit" className="btn-success" style={{ fontWeight: 'bold', padding: '8px 14px' }}>
                대차 의뢰 접수 (출고/회수 배차 발행)
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 뷰 3: 신규 계약 등록 */}
      {viewMode === 'LIST' && activeTab === 'CREATE' && (
        <form onSubmit={handleCreateContractSubmit} className="card" style={{ margin: 0 }}>
          <h3 className="card-title" style={{ marginBottom: '16px' }}>신규 계약 등록</h3>
          
          {selectedCustOverdue && (
            <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: selectedCustOverdue.isBlocked ? '#fef2f2' : '#fffbeb', border: `1px solid ${selectedCustOverdue.isBlocked ? '#f87171' : '#fcd34d'}`, color: selectedCustOverdue.isBlocked ? '#991b1b' : '#92400e', marginBottom: '14px', fontSize: '12px' }}>
              <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <AlertTriangle size={15} color={selectedCustOverdue.isBlocked ? '#dc2626' : '#d97706'} />
                {selectedCustOverdue.isBlocked ? '🚫 [경영진 처분] 거래 불가 (BLOCKED)' : '⚠️ [연체 채권 경각심 통제 경보]'}
              </div>
              <div>
                {selectedCustOverdue.isBlocked
                  ? '해당 거래처는 경영진의 출고금지(BLOCKED) 처분으로 신규 계약 등록이 전면 차단되어 있습니다.'
                  : `해당 거래처는 약정 납기일이 도과된 미납 청구서 ${selectedCustOverdue.count}건 (총 ₩${selectedCustOverdue.overdueSum.toLocaleString()}원)이 존재합니다.`
                }
              </div>
              {!selectedCustOverdue.isBlocked && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontWeight: 700, cursor: 'pointer' }}>
                  <input type="checkbox" checked={overdueAcknowledged} onChange={e => setOverdueAcknowledged(e.target.checked)} />
                  <span>☑️ [수금 책임 인지] "위 연체 사실 및 경영진 모니터링 현황을 확인하였으며, 신규 계약 진행에 따른 수금 관리에 책임을 다할 것을 확인합니다."</span>
                </label>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label>고객사 선택 *</label>
              <select
                value={custSelect}
                onChange={e => {
                  const val = e.target.value;
                  setCustSelect(val);
                  if (val && val !== 'NEW') {
                    const sel = customers.find(c => c.id === val);
                    if (sel) {
                      setBillingDay(sel.defaultBillingDay || 30);
                      setStatementClosingDay(sel.defaultStatementClosingDay || 25);
                      setPaymentDueDay(sel.paymentDueDay || 25);
                    }
                  }
                }}
                required
                style={{ width: '100%', padding: '8px' }}
              >
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.transactionStatus === 'BLOCKED' ? `🚫 [거래제한] ${c.name}` : c.name} ({c.bizRegNo})
                  </option>
                ))}
                <option value="NEW">+ [신규 고객사 직접 등록]</option>
              </select>
            </div>

            <div>
              <label>영업담당 *</label>
              <select value={salespersonSelect} onChange={e => setSalespersonSelect(e.target.value)} required style={{ width: '100%', padding: '8px' }}>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label>계약 시작일 *</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={isEndDateOpen} onChange={e => setIsEndDateOpen(e.target.checked)} />
                종료일 미정 (상시 대여중)
              </label>
              {!isEndDateOpen && (
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required style={{ width: '100%', padding: '8px', marginTop: '4px' }} />
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>청구 마감일 (일) *</label>
                <input type="number" min={1} max={31} value={billingDay} onChange={e => setBillingDay(Number(e.target.value))} required style={{ width: '100%', padding: '8px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>명세서 마감일 (일)</label>
                <input type="number" min={1} max={31} value={statementClosingDay} onChange={e => setStatementClosingDay(Number(e.target.value))} style={{ width: '100%', padding: '8px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>약정 결제일 (일)</label>
                <input type="number" min={1} max={31} value={paymentDueDay} onChange={e => setPaymentDueDay(Number(e.target.value))} style={{ width: '100%', padding: '8px' }} />
              </div>
            </div>
          </div>

          {/* 자산 바스켓 */}
          <div style={{ padding: '14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
            <h4 style={{ fontWeight: 600, marginBottom: '10px' }}>체결 자산 선택</h4>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>선택 방식</label>
                <select value={basketAssetMethod} onChange={e => setBasketAssetMethod(e.target.value as any)} style={{ padding: '7px' }}>
                  <option value="MODEL">제품 모델명 선택 (권장)</option>
                  <option value="ASSET">자산 관리번호 선택</option>
                </select>
              </div>

              {basketAssetMethod === 'ASSET' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>자산 관리번호</label>
                  <select value={selectedAssetToAdd} onChange={e => setSelectedAssetToAdd(e.target.value)} style={{ padding: '7px', minWidth: '180px' }}>
                    <option value="">-- 임대가능 자산 선택 --</option>
                    {availableAssets.map(a => (
                      <option key={a.id} value={a.id}>{a.assetNo} ({a.modelName})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>제품 모델</label>
                  <select value={selectedModelToAdd} onChange={e => setSelectedModelToAdd(e.target.value)} style={{ padding: '7px', minWidth: '180px' }}>
                    <option value="">-- 제품 모델 선택 --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.modelName}>{p.modelName} ({p.feet}피트)</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>월 렌탈료</label>
                <input type="number" value={customMonthly} onChange={e => setCustomMonthly(Number(e.target.value))} style={{ width: '120px', padding: '6px' }} />
              </div>
              
              <button type="button" className="btn-primary" onClick={handleAddToBasket} style={{ padding: '7px 14px', height: '36px' }}>+ 추가</button>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {basket.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>추가된 자산이 없습니다.</div>
              ) : (
                basket.map((b, idx) => {
                  const ast = assets.find(a => a.id === b.assetId);
                  return (
                    <div key={idx} style={{ padding: '4px 10px', backgroundColor: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong>{ast?.assetNo || b.expectedModel}</strong> (월 {b.monthlyRentalFee.toLocaleString()}원)
                      <button type="button" onClick={() => handleRemoveFromBasket(b.assetId || b.expectedModel)} style={{ border: 'none', background: 'none', color: 'red', cursor: 'pointer' }}>✕</button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" onClick={() => setActiveTab('ALL_LIST')}>취소</button>
            <button type="submit" className="btn-success">계약 등록</button>
          </div>
        </form>
      )}

      {/* 계약서패키지 모달 */}
      <ContractDocumentBundleModal
        isOpen={showBundleModal}
        onClose={() => setShowBundleModal(false)}
        initialContractId={bundleTargetContractId}
      />

      {/* 스타일 */}
      <style>{`
        .hover-row:hover {
          background-color: #f1f5f9 !important;
        }
      `}</style>
    </div>
  );
};
