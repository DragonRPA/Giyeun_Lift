// src/mobile/pages/MobileDispatchOrderCreate.tsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Building2, MapPin, Phone, Calendar, Clock, Plus, Minus, 
  Send, AlertTriangle, CheckCircle2, ChevronRight, ArrowLeft, Bot,
  Mic, MicOff, RotateCcw, FileText, Check, Sparkles, ClipboardList,
  RotateCw, Truck, ArrowDownLeft, ArrowUpRight, ArrowRight, Shield, ChevronDown, ChevronUp
} from 'lucide-react';
import { matchHangul, sortCustomersByName } from '../../utils/hangulSearch';
import { 
  loadVoiceOrderDraft, 
  saveVoiceOrderDraft, 
  clearVoiceOrderDraft, 
  mergeVoiceFragmentToDraft, 
  isOptionsChangedFromSite,
  VoiceOrderDraft, 
  EquipmentOrderItem 
} from '../../services/voiceOrderDraftService';
import { db, ContractHistory, Delivery, ContractAsset } from '../../services/db';
import { broadcastWorkNotification } from '../../utils/workNotificationService';
import { VoiceGuideWizardModal, VoiceGuideWizardCompleteData } from '../components/VoiceGuideWizardModal';
import { VoiceMemoDispatchStudioModal } from '../components/VoiceMemoDispatchStudioModal';
import { BusinessLicenseModal } from '../../components/BusinessLicenseModal';

interface MobileDispatchOrderCreateProps {
  onBack: () => void;
  onSuccess: () => void;
  onOpenGems?: () => void;
  initialCustomerId?: string;
  initialSpecFt?: string;
}

const SPEC_OPTIONS = [
  { ft: '19ft', defaultModel: 'GS-1930' },
  { ft: '26ft', defaultModel: 'GTJZ0812E' },
  { ft: '32ft', defaultModel: 'GTJZ1012E' },
  { ft: '40ft', defaultModel: 'GS-4047' },
  { ft: '46ft', defaultModel: 'GS-4655' },
  { ft: '53ft', defaultModel: 'S1614AC+' },
];

const inferFeetFromModel = (modelName: string): string => {
  const s = String(modelName || '').toUpperCase();
  if (s.includes('1930') || s.includes('1330') || s.includes('1432') || s.includes('3215') || s.includes('0608') || s.includes('1230') || s.includes('19')) return '19ft';
  if (s.includes('2646') || s.includes('2632') || s.includes('0812') || s.includes('0808') || s.includes('3219') || s.includes('26')) return '26ft';
  if (s.includes('3246') || s.includes('1012') || s.includes('1008') || s.includes('32')) return '32ft';
  if (s.includes('4047') || s.includes('4046') || s.includes('4069') || s.includes('1212') || s.includes('40')) return '40ft';
  if (s.includes('4655') || s.includes('1412') || s.includes('1414') || s.includes('46')) return '46ft';
  if (s.includes('1612') || s.includes('1614') || s.includes('5390') || s.includes('53')) return '53ft';
  return '19ft';
};

export const MobileDispatchOrderCreate: React.FC<MobileDispatchOrderCreateProps> = ({ 
  onBack, 
  onSuccess, 
  onOpenGems,
  initialCustomerId,
  initialSpecFt
}) => {
  const { 
    customers, sites, currentUser, saveSmartDispatch,
    contracts, contractAssets, assets, saveSmartReturn, refreshAllData 
  } = useApp();

  // 의뢰 유형 모드 (출고 DISPATCH vs 회수 RETURN vs 대차교체 EXCHANGE - 헌장 2.3)
  const [dispatchMode, setDispatchMode] = useState<'DISPATCH' | 'RETURN' | 'EXCHANGE'>('DISPATCH');

  // 폼 상태
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [showBizLicenseModal, setShowBizLicenseModal] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [siteContactName, setSiteContactName] = useState('');
  const [siteContactPhone, setSiteContactPhone] = useState('');
  
  // 전체 출고의뢰 8대 도메인 확장 상태
  const [paidOptions, setPaidOptions] = useState('');
  const [protection, setProtection] = useState('');
  const [checkedSpecs, setCheckedSpecs] = useState<Record<string, boolean>>({});
  const [saveOptionsToSite, setSaveOptionsToSite] = useState<boolean>(true); // 🌟 변경된 옵션을 현장 기본값으로 저장할지 여부
  const [billableToCustomer, setBillableToCustomer] = useState(false);
  const [closingDay, setClosingDay] = useState('말일');
  const [paymentDay, setPaymentDay] = useState('익월 25일');
  const [taxBillEmail, setTaxBillEmail] = useState('');
  const [vehicleType, setVehicleType] = useState('5톤 렉카');

  // 🌟 선택된 현장 객체 및 옵션 변경 발생 여부 실시간 감지
  const selectedSite = useMemo(() => sites.find(s => s.id === selectedSiteId), [sites, selectedSiteId]);
  const isOptionsDiff = useMemo(() => isOptionsChangedFromSite(selectedSite, paidOptions, protection), [selectedSite, paidOptions, protection]);
  
  // 납품/회수 일시 (기본값: 내일 08:00)
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

  const [deliveryDate, setDeliveryDate] = useState(tomorrow);
  const [deliveryTime, setDeliveryTime] = useState('08:00');

  // 활성화된(선택된) 피트 규격 (기본값 19ft)
  const [activeFt, setActiveFt] = useState<string>('19ft');

  // 출고 요구 장비 목록 (최초 19ft 1대 기본)
  const [orders, setOrders] = useState<EquipmentOrderItem[]>([
    { ft: '19ft', modelName: 'GS-1930', count: 1 }
  ]);

  // 회수 대상 선택 자산 목록
  const [selectedReturnAssetIds, setSelectedReturnAssetIds] = useState<string[]>([]);

  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 대화형 음성 가이드 위자드 모달 상태
  const [isVoiceWizardOpen, setIsVoiceWizardOpen] = useState(false);

  // 🎙️ 자유 음성메모 출고의뢰 스튜디오 모달 상태
  const [isVoiceMemoStudioOpen, setIsVoiceMemoStudioOpen] = useState(false);

  // 음성 조각 입력 및 임시저장 상태
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [recentModifiedFields, setRecentModifiedFields] = useState<string[]>([]);
  const [snippetsHistory, setSnippetsHistory] = useState<{ text: string; timestamp: string }[]>([]);
  const [createdResult, setCreatedResult] = useState<{ isReturn?: boolean; contractNo: string; siteName: string; totalCount: number } | null>(null);
  const recognitionRef = useRef<any>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const [customerSearchText, setCustomerSearchText] = useState('');
  const [siteSearchText, setSiteSearchText] = useState('');

  // 1. 마운트 시 이전 임시저장 의뢰서 복원
  useEffect(() => {
    const saved = loadVoiceOrderDraft();
    if (saved) {
      if (saved.customerId) setSelectedCustomerId(saved.customerId);
      if (saved.siteId) setSelectedSiteId(saved.siteId);
      if (saved.newSiteName) setNewSiteName(saved.newSiteName);
      if (saved.siteAddress) setSiteAddress(saved.siteAddress);
      if (saved.siteContactName) setSiteContactName(saved.siteContactName);
      if (saved.siteContactPhone) setSiteContactPhone(saved.siteContactPhone);
      if (saved.deliveryDate) setDeliveryDate(saved.deliveryDate);
      if (saved.deliveryTime) setDeliveryTime(saved.deliveryTime);
      if (saved.orders && saved.orders.length > 0) setOrders(saved.orders);
      if (saved.memo) setMemo(saved.memo);
      if (saved.paidOptions) setPaidOptions(saved.paidOptions);
      if (saved.protection) setProtection(saved.protection);
      if (saved.checkedSpecs) setCheckedSpecs(saved.checkedSpecs);
      if (saved.billableToCustomer !== undefined) setBillableToCustomer(saved.billableToCustomer);
      if (saved.closingDay) setClosingDay(saved.closingDay);
      if (saved.paymentDay) setPaymentDay(saved.paymentDay);
      if (saved.taxBillEmail) setTaxBillEmail(saved.taxBillEmail);
      if (saved.vehicleType) setVehicleType(saved.vehicleType);
      if (saved.snippets && saved.snippets.length > 0) setSnippetsHistory(saved.snippets);
      setHasRestoredDraft(true);
    }
  }, []);

  // 1-1. 외부 네비게이션(가용재고 조회, 고객관리 등)에서 유입된 초기 파라미터 우선 적용 (헌장 2.1 & 과제 6)
  useEffect(() => {
    if (initialCustomerId) {
      setSelectedCustomerId(initialCustomerId);
    }
    if (initialSpecFt) {
      setActiveFt(initialSpecFt);
      const defaultModel = SPEC_OPTIONS.find(s => s.ft === initialSpecFt)?.defaultModel || 'GS-1930';
      setOrders([{ ft: initialSpecFt, modelName: defaultModel, count: 1 }]);
    }
  }, [initialCustomerId, initialSpecFt]);

  // 2. 값 변경 시 로컬스토리지 자동 임시저장
  useEffect(() => {
    if (selectedCustomerId || siteAddress || siteContactPhone || memo || paidOptions || protection || orders.length > 1 || orders[0]?.count > 1 || snippetsHistory.length > 0) {
      const cust = customers.find(c => c.id === selectedCustomerId);
      const site = sites.find(s => s.id === selectedSiteId);
      const draft: VoiceOrderDraft = {
        customerId: selectedCustomerId,
        customerName: cust?.name || '',
        siteId: selectedSiteId,
        siteName: site?.name || newSiteName,
        newSiteName,
        siteAddress,
        siteContactName,
        siteContactPhone,
        siteContactEmail: '',
        deliveryDate,
        deliveryTime,
        orders,
        memo,
        paidOptions,
        protection,
        checkedSpecs,
        billableToCustomer,
        closingDay,
        paymentDay,
        taxBillEmail,
        vehicleType,
        snippets: snippetsHistory,
        updatedAt: new Date().toISOString()
      };
      saveVoiceOrderDraft(draft);
      setHasRestoredDraft(true);
    }
  }, [
    selectedCustomerId, selectedSiteId, newSiteName, siteAddress, siteContactName, siteContactPhone,
    deliveryDate, deliveryTime, orders, memo, paidOptions, protection, checkedSpecs, billableToCustomer,
    closingDay, paymentDay, taxBillEmail, vehicleType, snippetsHistory, customers, sites
  ]);

  // 해당 고객사/현장에서 현재 대여 중인 자산 목록
  const siteRentedAssets = useMemo(() => {
    if (!selectedCustomerId) return [];
    const targetContracts = contracts.filter(c => 
      c.customerId === selectedCustomerId && 
      (selectedSiteId && selectedSiteId !== 'NEW' ? c.siteId === selectedSiteId : true) &&
      c.status !== 'COMPLETED'
    );
    const items: { contractId: string; contractNo: string; assetId: string; assetNo: string; modelName: string }[] = [];
    targetContracts.forEach(c => {
      const cas = contractAssets.filter(ca => ca.contractId === c.id && ca.assetId && !ca.actualReturnDate);
      cas.forEach(ca => {
        const a = assets.find(ast => ast.id === ca.assetId);
        items.push({
          contractId: c.id,
          contractNo: c.contractNo,
          assetId: ca.assetId!,
          assetNo: a?.assetNo || ca.assetId!,
          modelName: a?.modelName || '고소작업대'
        });
      });
    });
    return items;
  }, [selectedCustomerId, selectedSiteId, contracts, contractAssets, assets]);

  // 임시저장 초기화 핸들러
  const handleResetDraft = () => {
    clearVoiceOrderDraft();
    setSelectedCustomerId('');
    setSelectedSiteId('');
    setNewSiteName('');
    setSiteAddress('');
    setSiteContactName('');
    setSiteContactPhone('');
    setDeliveryDate(tomorrow);
    setDeliveryTime('08:00');
    setOrders([{ ft: '19ft', modelName: 'GS-1930', count: 1 }]);
    setActiveFt('19ft');
    setSelectedReturnAssetIds([]);
    setMemo('');
    setPaidOptions('');
    setProtection('');
    setCheckedSpecs({});
    setBillableToCustomer(false);
    setClosingDay('말일');
    setPaymentDay('익월 25일');
    setTaxBillEmail('');
    setVehicleType('5톤 렉카');
    setSnippetsHistory([]);
    setRecentModifiedFields([]);
    setHasRestoredDraft(false);
    showToast('임시저장이 초기화되었습니다.');
  };

  // 음성 조각 증분 병합 처리 함수
  const processSpokenFragment = (text: string) => {
    const cust = customers.find(c => c.id === selectedCustomerId);
    const site = sites.find(s => s.id === selectedSiteId);
    const currentDraft: VoiceOrderDraft = {
      customerId: selectedCustomerId,
      customerName: cust?.name || '',
      siteId: selectedSiteId,
      siteName: site?.name || newSiteName,
      newSiteName,
      siteAddress,
      siteContactName,
      siteContactPhone,
      deliveryDate,
      deliveryTime,
      orders,
      memo,
      snippets: snippetsHistory,
      updatedAt: new Date().toISOString()
    };

    // 회수 의도 자동 감지
    let detectedMode = dispatchMode;
    const isReturnIntent = /회수|반납|철수|반출|빼줘/i.test(text);
    if (isReturnIntent) {
      detectedMode = 'RETURN';
      setDispatchMode('RETURN');
    }

    const { updatedDraft, modifiedFields } = mergeVoiceFragmentToDraft(
      currentDraft,
      text,
      customers,
      sites
    );

    if (isReturnIntent) {
      modifiedFields.unshift('의뢰유형: 회수의뢰(RETURN)');
    }

    if (updatedDraft.customerId) setSelectedCustomerId(updatedDraft.customerId);
    if (updatedDraft.siteId) setSelectedSiteId(updatedDraft.siteId);
    if (updatedDraft.newSiteName) setNewSiteName(updatedDraft.newSiteName);
    if (updatedDraft.siteAddress) setSiteAddress(updatedDraft.siteAddress);
    if (updatedDraft.siteContactName) setSiteContactName(updatedDraft.siteContactName);
    if (updatedDraft.siteContactPhone) setSiteContactPhone(updatedDraft.siteContactPhone);
    if (updatedDraft.deliveryDate) setDeliveryDate(updatedDraft.deliveryDate);
    if (updatedDraft.deliveryTime) setDeliveryTime(updatedDraft.deliveryTime);
    if (updatedDraft.orders && updatedDraft.orders.length > 0 && detectedMode === 'DISPATCH') {
      setOrders(updatedDraft.orders);
    }
    if (updatedDraft.memo) setMemo(updatedDraft.memo);
    if (updatedDraft.paidOptions) setPaidOptions(updatedDraft.paidOptions);
    if (updatedDraft.protection) setProtection(updatedDraft.protection);
    if (updatedDraft.checkedSpecs) setCheckedSpecs(updatedDraft.checkedSpecs);
    if (updatedDraft.billableToCustomer !== undefined) setBillableToCustomer(updatedDraft.billableToCustomer);
    if (updatedDraft.closingDay) setClosingDay(updatedDraft.closingDay);
    if (updatedDraft.paymentDay) setPaymentDay(updatedDraft.paymentDay);
    if (updatedDraft.vehicleType) setVehicleType(updatedDraft.vehicleType);
    if (updatedDraft.snippets) setSnippetsHistory(updatedDraft.snippets);

    // 회수 모드일 때 언급된 장비번호 자동 체크
    if (detectedMode === 'RETURN') {
      const matchedAssets: string[] = [];
      const numMatches = text.match(/\d{2,4}/g);
      if (numMatches) {
        siteRentedAssets.forEach(ra => {
          if (numMatches.some(n => ra.assetNo.includes(n))) {
            if (!matchedAssets.includes(ra.assetId)) matchedAssets.push(ra.assetId);
          }
        });
        if (matchedAssets.length > 0) {
          setSelectedReturnAssetIds(prev => Array.from(new Set([...prev, ...matchedAssets])));
          modifiedFields.push(`회수장비(${matchedAssets.length}대) 매핑`);
        }
      }
    }

    setRecentModifiedFields(modifiedFields);
    setHasRestoredDraft(true);

    if (modifiedFields.length > 0) {
      showToast(`음성 반영: ${modifiedFields.join(' | ')}`);
    } else {
      showToast('음성을 인식했습니다.');
    }
  };

  // 음성인식 토글 핸들러
  const handleToggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('이 브라우저는 음성인식을 지원하지 않습니다.', 'error');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
      setIsListening(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.lang = 'ko-KR';
      rec.continuous = false;
      rec.interimResults = true;
      recognitionRef.current = rec;

      rec.onstart = () => {
        setIsListening(true);
        setInterimText('');
      };

      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInterimText(transcript);
      };

      rec.onerror = (event: any) => {
        console.warn('SpeechRecognition error:', event.error);
        setIsListening(false);
        if (event.error !== 'no-speech') {
          showToast('음성 인식 오류: ' + event.error, 'error');
        }
      };

      rec.onend = () => {
        setIsListening(false);
        if (interimText.trim()) {
          processSpokenFragment(interimText.trim());
          setInterimText('');
        }
      };

      rec.start();
    } catch (err: any) {
      console.error('Failed to start SpeechRecognition:', err);
      setIsListening(false);
      showToast('마이크 시작 실패: ' + err.message, 'error');
    }
  };

  // 클립보드 통화 텍스트 읽어서 자동 완성 핸들러
  const handlePasteCallTranscript = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        showToast('클립보드 읽기를 지원하지 않는 브라우저입니다.', 'error');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showToast('클립보드에 복사된 통화 텍스트가 없습니다.', 'error');
        return;
      }
      processSpokenFragment(text.trim());
      showToast('복사된 통화 텍스트를 파싱하여 반영했습니다.');
    } catch (err: any) {
      console.warn('Clipboard read error:', err);
      showToast('클립보드 읽기 권한이 필요합니다.', 'error');
    }
  };

  // 선택된 고객사의 등록 현장 목록
  const customerSites = useMemo(() => {
    if (!selectedCustomerId) return [];
    return sites.filter(s => s.customerId === selectedCustomerId);
  }, [sites, selectedCustomerId]);

  const filteredCustomersList = useMemo(() => {
    const list = customers
      .filter(c => c.transactionStatus !== 'BLOCKED')
      .filter(c => !customerSearchText.trim() || matchHangul(c.name, customerSearchText) || matchHangul(c.representative, customerSearchText));
    return sortCustomersByName(list);
  }, [customers, customerSearchText]);

  const filteredCustomerSites = useMemo(() => {
    return customerSites.filter(s => !siteSearchText.trim() || matchHangul(s.name, siteSearchText) || matchHangul(s.address, siteSearchText));
  }, [customerSites, siteSearchText]);

  // 고객사 변경 핸들러
  const handleCustomerChange = (custId: string) => {
    setSelectedCustomerId(custId);
    setSelectedSiteId('');
    setSiteAddress('');
    setSiteContactName('');
    setSiteContactPhone('');
    setSelectedReturnAssetIds([]);
    const cust = customers.find(c => c.id === custId);
    if (cust) {
      if (cust.defaultPaidOptions) setPaidOptions(cust.defaultPaidOptions);
      if (cust.defaultProtection) setProtection(cust.defaultProtection);
      if (cust.defaultCheckedSpecs) setCheckedSpecs(cust.defaultCheckedSpecs);
      if (cust.defaultBillingDay) setClosingDay(cust.defaultBillingDay === 30 || cust.defaultBillingDay === 31 ? '말일' : `${cust.defaultBillingDay}일`);
      if (cust.paymentDueDay) setPaymentDay(`익월 ${cust.paymentDueDay}일`);
      if (cust.repEmail && cust.repEmail !== '미상') setTaxBillEmail(cust.repEmail);
    }
  };

  // 현장 변경 핸들러
  const handleSiteChange = (siteId: string) => {
    setSelectedSiteId(siteId);
    setSelectedReturnAssetIds([]);
    if (siteId === 'NEW') {
      setSiteAddress('');
      setSiteContactName('');
      setSiteContactPhone('');
      return;
    }
    const found = sites.find(s => s.id === siteId);
    if (found) {
      setSiteAddress(found.address || '');
      setSiteContactName(found.contactName || '');
      setSiteContactPhone(found.contact || '');
      if (found.paidOptions) setPaidOptions(typeof found.paidOptions === 'string' ? found.paidOptions : (Array.isArray(found.paidOptions) ? (found.paidOptions as any[]).join(', ') : String(found.paidOptions)));
      if (found.protection) setProtection(typeof found.protection === 'string' ? found.protection : (Array.isArray(found.protection) ? (found.protection as any[]).join(', ') : String(found.protection)));
      if (found.checkedSpecs) setCheckedSpecs(found.checkedSpecs);
    }
  };

  // 임대 가능(AVAILABLE) 자산 규격별 / 모델별 실시간 잔여 재고 집계
  const availableInventory = useMemo(() => {
    const stats: Record<string, { total: number; models: { modelName: string; count: number }[] }> = {
      '19ft': { total: 0, models: [] },
      '26ft': { total: 0, models: [] },
      '32ft': { total: 0, models: [] },
      '40ft': { total: 0, models: [] },
      '46ft': { total: 0, models: [] },
      '53ft': { total: 0, models: [] },
    };

    const modelCountMap: Record<string, { ft: string; count: number }> = {};

    assets
      .filter(a => a.status === 'AVAILABLE')
      .forEach(a => {
        const model = a.modelName?.trim() || '미지정';
        const ft = inferFeetFromModel(model);
        if (!modelCountMap[model]) {
          modelCountMap[model] = { ft, count: 0 };
        }
        modelCountMap[model].count += 1;
      });

    Object.entries(modelCountMap).forEach(([modelName, { ft, count }]) => {
      if (stats[ft]) {
        stats[ft].total += count;
        stats[ft].models.push({ modelName, count });
      }
    });

    Object.values(stats).forEach(specStat => {
      specStat.models.sort((a, b) => b.count - a.count);
    });

    return stats;
  }, [assets]);

  // 규격 피트 카드 터치 시: 활성 피트 전환 (해당 스펙의 가용 재고 모델 표시)
  const handleSelectFt = (ft: string) => {
    setActiveFt(ft);
  };

  // 가용 재고 모델 칩 터치 시: 출고 의뢰 장비에 추가 또는 수량 증가
  const handleAddModelOrder = (ft: string, modelName: string) => {
    setOrders(prev => {
      const existsIdx = prev.findIndex(o => o.ft === ft && o.modelName === modelName);
      if (existsIdx >= 0) {
        const next = [...prev];
        next[existsIdx].count += 1;
        return next;
      }
      // 초기 기본 19ft GS-1930(또는 1930) 1대만 있고 사용자가 다른 모델을 처음 선택할 때 교체
      if (prev.length === 1 && prev[0].count === 1 && (prev[0].modelName === '1930' || prev[0].modelName === 'GS-1930') && prev[0].ft === ft) {
        return [{ ft, modelName, count: 1 }];
      }
      return [...prev, { ft, modelName, count: 1 }];
    });
    showToast(`${modelName} 1대가 출고 장비에 추가되었습니다.`);
  };

  // 규격 수량 변경
  const handleCountChange = (index: number, delta: number) => {
    setOrders(prev => {
      const next = [...prev];
      const newCount = Math.max(1, next[index].count + delta);
      next[index].count = newCount;
      return next;
    });
  };

  // 규격 추가 (기본 모델 또는 가용 재고 최다 모델 추가)
  const handleAddSpec = (spec: typeof SPEC_OPTIONS[0]) => {
    setActiveFt(spec.ft);
    const topModel = availableInventory[spec.ft]?.models[0]?.modelName || spec.defaultModel;
    setOrders(prev => {
      const existsIdx = prev.findIndex(o => o.ft === spec.ft && o.modelName === topModel);
      if (existsIdx >= 0) {
        const next = [...prev];
        next[existsIdx].count += 1;
        return next;
      }
      return [...prev, { ft: spec.ft, modelName: topModel, count: 1 }];
    });
    showToast(`${spec.ft} (${topModel}) 1대가 추가되었습니다.`);
  };

  // 규격 삭제
  const handleRemoveOrder = (index: number) => {
    if (orders.length <= 1) return;
    setOrders(prev => prev.filter((_, i) => i !== index));
  };

  // 회수 대상 자산 체크 토글
  const toggleReturnAsset = (assetId: string) => {
    setSelectedReturnAssetIds(prev => 
      prev.includes(assetId) ? prev.filter(id => id !== assetId) : [...prev, assetId]
    );
  };

  // 저장 및 의뢰 발송 핸들러 (출고 & 회수 통합)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCustomerId) {
      showToast('고객사를 선택해주세요.', 'error');
      return;
    }

    const selectedCust = customers.find(c => c.id === selectedCustomerId);
    if (!selectedCust) return;

    if (selectedCust.transactionStatus === 'BLOCKED') {
      showToast('경영진 처분으로 인해 거래 정지(BLOCKED)된 거래처입니다.', 'error');
      return;
    }

    let finalSiteName = '';
    if (selectedSiteId === 'NEW') {
      if (!newSiteName.trim()) {
        showToast('신규 현장명을 입력해주세요.', 'error');
        return;
      }
      finalSiteName = newSiteName.trim();
    } else {
      const foundSite = sites.find(s => s.id === selectedSiteId);
      if (!foundSite) {
        showToast('현장을 선택해주세요.', 'error');
        return;
      }
      finalSiteName = foundSite.name;
    }

    if (!siteAddress.trim()) {
      showToast('현장 상세 주소를 입력해주세요.', 'error');
      return;
    }

    if (!siteContactPhone.trim()) {
      showToast('현장 담당자 연락처를 입력해주세요.', 'error');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (deliveryDate && deliveryDate < todayStr) {
      showToast('배차 희망일은 오늘 이후 날짜를 선택해주세요.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // 🔄 CASE 1: 회수의뢰 (RETURN)
      if (dispatchMode === 'RETURN') {
        if (selectedReturnAssetIds.length === 0) {
          showToast('회수할 장비를 1대 이상 선택해주세요.', 'error');
          setIsSubmitting(false);
          return;
        }

        // 선택된 자산들이 속한 계약 찾기
        const contractId = siteRentedAssets.find(ra => selectedReturnAssetIds.includes(ra.assetId))?.contractId;

        await saveSmartReturn({
          contractId,
          returnDate: deliveryDate,
          assetIds: selectedReturnAssetIds,
          loadingTime: deliveryTime,
          contactName: siteContactName.trim() || '현장담당자',
          contactPhone: siteContactPhone.trim(),
          note: `[모바일 회수의뢰] ${memo}`.trim()
        });

        clearVoiceOrderDraft();
        setCreatedResult({
          isReturn: true,
          contractNo: `회수의뢰 (장비 ${selectedReturnAssetIds.length}대)`,
          siteName: finalSiteName,
          totalCount: selectedReturnAssetIds.length
        });
        setIsSubmitting(false);
        return;
      }

      // 🔄 CASE 2: 대차/교체 의뢰 (EXCHANGE - 헌장 2.3 단일 EXCHANGE 왕복 배차 1건 발행)
      if (dispatchMode === 'EXCHANGE') {
        if (selectedReturnAssetIds.length === 0) {
          showToast('교체할 기존 대여 장비를 선택해주세요.', 'error');
          setIsSubmitting(false);
          return;
        }

        const oldAssetId = selectedReturnAssetIds[0];
        const oldAssetObj = assets.find(a => a.id === oldAssetId);
        const targetContractId = siteRentedAssets.find(ra => ra.assetId === oldAssetId)?.contractId || '';
        const targetModelName = orders[0]?.modelName || orders[0]?.ft || oldAssetObj?.modelName || '동일/동급 모델';

        // 1. contractHistory 기록 (헌장 2.2 계약 속성 100% 자동 상속)
        db.insertRow<ContractHistory>('contractHistory', {
          contractId: targetContractId,
          changeType: 'EXCHANGE',
          changeDate: deliveryDate,
          description: `[모바일 대차/교체 의뢰 접수] 회수: ${oldAssetObj?.assetNo || '미지정'}(${oldAssetObj?.modelName || '기존'}) ➔ 투입요구: ${targetModelName} (기존 계약조건 100% 자동 상속)`,
          createdAt: new Date().toISOString()
        });

        // 1-1. 기존 ContractAsset 종료 처리 (헌장 1.2 & 4.1 전자산 교체 전일 마감)
        const prevDateObj = new Date(deliveryDate);
        prevDateObj.setDate(prevDateObj.getDate() - 1);
        const dayBeforeDelivery = prevDateObj.toISOString().split('T')[0];

        const targetOldCA = contractAssets.find(ca => ca.contractId === targetContractId && ca.assetId === oldAssetId);
        if (targetOldCA) {
          db.updateRow<ContractAsset>('contractAssets', targetOldCA.id, {
            endDate: dayBeforeDelivery,
            status: 'RETURNED',
            actualReturnDate: deliveryDate,
            updatedAt: new Date().toISOString()
          });
        }

        // 1-2. 출고 부서를 위한 대차 출고 슬롯(ContractAsset) 자동 생성 (헌장 2.2 단가 100% 자동 상속)
        const targetContract = contracts.find(c => c.id === targetContractId);
        db.insertRow<ContractAsset>('contractAssets', {
          contractId: targetContractId,
          assetId: undefined,
          expectedModel: targetModelName,
          monthlyRentalFee: targetOldCA?.monthlyRentalFee || 0,
          dailyRentalFee: targetOldCA?.dailyRentalFee || 0,
          startDate: deliveryDate,
          endDate: targetContract?.endDate || targetOldCA?.endDate || '미정',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        });

        // 2. 단일 대차 요구에 대해 'EXCHANGE' (교환 왕복 배차) 1건만 발행 (헌장 2.3)
        const contactInfoMemo = siteContactName || siteContactPhone
          ? `[고객담당자: ${siteContactName || '-'} (${siteContactPhone || '-'})] `
          : '';

        db.insertRow<Delivery>('deliveries', {
          contractId: targetContractId,
          assetIds: oldAssetId,
          type: 'EXCHANGE',
          dispatchCategory: '교환',
          status: 'REQUESTED',
          requestDate: deliveryDate,
          scheduledDate: deliveryDate,
          loadingDate: deliveryDate,
          loadingTimeSlot: deliveryTime,
          unloadingDate: deliveryDate,
          unloadingTimeSlot: deliveryTime,
          originAddress: `${selectedCust.name} (${finalSiteName})`,
          destinationAddress: `${selectedCust.name} (${finalSiteName})`,
          memo: `[모바일 대차/교환 왕복 배차] ${contactInfoMemo}회수대상: ${oldAssetObj?.assetNo || '미지정'}(${oldAssetObj?.modelName || '기존장비'}) ➔ 대차출고요구: ${targetModelName} | 사유: ${memo.trim() || '현장 고장 교체'}`,
          vehicleType: '5톤 렉카',
          driverName: '',
          deliveryCost: 0,
          expectedCost: 0,
          finalCost: 0,
          deliveryCostConfirmed: 0,
          isCostSettled: false,
          reconciliationStatus: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        await db.awaitPendingWrites();
        refreshAllData();

        // 📢 대차교체 의뢰 등록 알림 브로드캐스트
        broadcastWorkNotification({
          type: 'EXCHANGE',
          title: '대차 교체 의뢰 등록',
          body: `${selectedCust.name} (${finalSiteName}) 회수:${oldAssetObj?.assetNo || '기존'} ➔ 투입:${targetModelName}`,
          url: '/admin/dispatch',
          targetDepts: ['DISPATCH', 'YARD', 'ADMIN', 'EXECUTIVE']
        }).catch(console.warn);

        clearVoiceOrderDraft();
        setCreatedResult({
          isReturn: false,
          contractNo: `대차교환 (회수:${oldAssetObj?.assetNo || '기존'} ➔ 투입:${targetModelName})`,
          siteName: finalSiteName,
          totalCount: 1
        });
        setIsSubmitting(false);
        return;
      }

      // 🚀 CASE 2: 출고의뢰 (DISPATCH)
      const totalEquipCount = orders.reduce((sum, o) => sum + Math.max(0, Math.floor(o.count || 0)), 0);
      if (totalEquipCount <= 0) {
        showToast('출고 장비를 1대 이상 추가해주세요.', 'error');
        setIsSubmitting(false);
        return;
      }

      const equipmentsList: any[] = [];
      // 헌장 2.2 준수: 표준 6대 규격 기본 단가 (19ft: 40만, 26ft: 50만, 32ft: 60만, 40ft: 90만, 46ft: 120만, 53ft: 150만)
      const SPEC_DEFAULT_MONTHLY_RENT: Record<string, number> = {
        '19ft': 400000,
        '26ft': 500000,
        '32ft': 600000,
        '40ft': 900000,
        '46ft': 1200000,
        '53ft': 1500000,
      };

      const custContractIds = contracts.filter(c => c.customerId === selectedCustomerId).map(c => c.id);
      const recentCa = contractAssets
        .filter(ca => custContractIds.includes(ca.contractId) && ca.monthlyRentalFee > 0)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];

      orders.forEach(o => {
        const standardRent = SPEC_DEFAULT_MONTHLY_RENT[o.ft] || 400000;
        const assignedMonthly = recentCa?.monthlyRentalFee || standardRent;
        const assignedDaily = Math.round(assignedMonthly / 30);
        const safeCount = Math.max(1, Math.floor(o.count || 1));

        for (let i = 0; i < safeCount; i++) {
          equipmentsList.push({
            modelName: o.modelName || o.ft,
            spec: o.ft,
            monthlyRent: assignedMonthly,
            dailyRent: assignedDaily,
          });
        }
      });

      const payload = {
        customerName: selectedCust.name,
        siteName: finalSiteName,
        siteAddress: siteAddress.trim(),
        salespersonName: currentUser?.name || '영업담당',
        salespersonPhone: currentUser?.phone || '',
        siteContactName: siteContactName.trim() || '현장소장',
        siteContactPhone: siteContactPhone.trim(),
        siteContactEmail: '',
        billingContactName: '',
        billingContactPhone: '',
        statementEmail: '',
        taxBillEmail: taxBillEmail.trim() || selectedCust.repEmail || '',
        loadingTime: `${deliveryDate} ${deliveryTime}`,
        unloadingTime: `${deliveryDate} ${deliveryTime}`,
        equipments: equipmentsList,
        closingDay: closingDay || String(selectedCust.defaultBillingDay || 30),
        paymentDay: paymentDay || String(selectedCust.paymentDueDay || 25),
        note: `[모바일 외근 출고의뢰] ${memo}`.trim(),
        rawText: `모바일 출고요청: ${selectedCust.name} / ${finalSiteName} (${totalEquipCount}대)`,
        paidOptions: typeof paidOptions === 'string' ? paidOptions.trim() : String(paidOptions || '').trim(),
        protection: typeof protection === 'string' ? protection.trim() : String(protection || '').trim(),
        checkedSpecs,
        saveOptionsToSite,
        billableToCustomer,
        vehicleType,
        isSetAsCustomerDefault: false,
        applyToAllSites: false
      };

      const res = await saveSmartDispatch(payload as any, true);
      if (res && res.success) {
        clearVoiceOrderDraft();
        setCreatedResult({
          isReturn: false,
          contractNo: res.contractNo || '신규 계약 생성됨',
          siteName: finalSiteName,
          totalCount: totalEquipCount
        });
      } else {
        showToast(res?.errorMessage || '출고 요청 접수에 실패했습니다.', 'error');
      }
    } catch (err: any) {
      console.error('Submit error:', err);
      showToast('요청 처리 중 오류가 발생했습니다: ' + (err.message || ''), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-28 p-4 bg-slate-950 min-h-screen text-slate-100 w-full min-w-0 max-w-full overflow-x-hidden">
      {/* 토스트 알림 */}
      {toastMessage && (
        <div className={`fixed top-4 left-4 right-4 z-50 p-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold transition-all ${
          toastMessage.type === 'error' ? 'bg-rose-900 border border-rose-700 text-rose-100' : 'bg-emerald-900 border border-emerald-700 text-emerald-100'
        }`}>
          {toastMessage.type === 'error' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* 완료 모달 */}
      {createdResult && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                <Check className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {createdResult.isReturn ? '회수 요청 접수 완료' : '출고 요청 접수 완료'}
                </h3>
                <p className="text-xs text-slate-400">
                  {createdResult.isReturn ? '배차 대기 목록(입고)에 등록되었습니다.' : '배차 및 출고 검수 대기로 인계되었습니다.'}
                </p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">의뢰 식별번호</span>
                <span className="font-mono font-bold text-emerald-400">{createdResult.contractNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">현장</span>
                <span className="font-bold text-white">{createdResult.siteName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">장비 수량</span>
                <span className="font-bold text-white">{createdResult.totalCount}대</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">배차 상태</span>
                <span className="text-amber-400 font-bold">
                  {createdResult.isReturn ? '회수대기 (REQUESTED - INBOUND)' : '출고대기 (REQUESTED)'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onSuccess}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all"
            >
              확인 및 목록 이동
            </button>
          </div>
        </div>
      )}

      {/* 헤더 바 */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>취소</span>
        </button>
        <h2 className="text-base font-bold text-white">
          {dispatchMode === 'EXCHANGE' ? '대차 교체 요청' : dispatchMode === 'RETURN' ? '장비 회수 요청' : '출고 요청'}
        </h2>
        <div className="w-10" />
      </div>

      {/* 🔄 모드 선택 탭 (출고 요청 vs 회수 요청 vs 대차 교체 - 헌장 2.3) */}
      <div className="grid grid-cols-3 gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => setDispatchMode('DISPATCH')}
          className={`py-2 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition-all ${
            dispatchMode === 'DISPATCH'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>출고 요청</span>
        </button>
        <button
          type="button"
          onClick={() => setDispatchMode('RETURN')}
          className={`py-2 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition-all ${
            dispatchMode === 'RETURN'
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ArrowDownLeft className="w-3.5 h-3.5" />
          <span>회수 의뢰</span>
        </button>
        <button
          type="button"
          onClick={() => setDispatchMode('EXCHANGE')}
          className={`py-2 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition-all ${
            dispatchMode === 'EXCHANGE'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>대차 교체</span>
        </button>
      </div>

      {/* 🎙️ 음성 조각 입력 및 임시저장 패널 */}
      <div className="bg-slate-900 border border-blue-500/30 rounded-2xl p-3.5 flex flex-col gap-2.5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-bold text-slate-200">
              {dispatchMode === 'EXCHANGE' ? '대차 교체 음성 입력' : dispatchMode === 'RETURN' ? '회수 음성 입력' : '출고 음성 입력'}
            </span>
          </div>
          {hasRestoredDraft && (
            <button
              type="button"
              onClick={handleResetDraft}
              className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 active:scale-95"
            >
              <RotateCcw className="w-3 h-3" />
              <span>초기화</span>
            </button>
          )}
        </div>

        {/* 🌟 [1] 최우선 메인: 자유 음성메모 출고의뢰 스튜디오 실행 버튼 */}
        <button
          type="button"
          onClick={() => setIsVoiceMemoStudioOpen(true)}
          className="w-full py-3.5 px-4 rounded-2xl flex items-center justify-between font-black text-xs text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-indigo-500 shadow-xl shadow-indigo-600/30 transition-all active:scale-[0.98]"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <Mic className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <div className="text-[13px] font-extrabold tracking-tight flex items-center gap-1.5">
                <span>자유 음성메모 출고의뢰</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-white/20 text-white">
                  핸즈프리
                </span>
              </div>
              <div className="text-[10px] text-blue-100 font-normal mt-0.5">
                순서 없이 음성메모를 남기면 5대 핵심항목 실시간 충족 검증 후 즉시 접수
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-bold bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl whitespace-nowrap shrink-0">
            <span>시작</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>

        {/* 🌟 [2] 보조: 단계별 대화형 위자드 & 통화 텍스트 붙여넣기 (2열 그리드) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIsVoiceWizardOpen(true)}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>대화형 위자드 (단계별)</span>
          </button>

          <button
            type="button"
            onClick={handlePasteCallTranscript}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
          >
            <ClipboardList className="w-3.5 h-3.5 text-sky-400" />
            <span>통화 텍스트 붙여넣기</span>
          </button>
        </div>

        {/* 실시간 말풍선 */}
        {(isListening || interimText) && (
          <div className="bg-slate-950 border border-blue-500/40 rounded-xl p-2.5 text-xs text-blue-200 animate-in fade-in duration-150">
            <div className="text-[10px] text-slate-400 mb-0.5">실시간 음성 전사:</div>
            <div className="font-mono">{interimText || '말씀하시면 텍스트가 표시됩니다...'}</div>
          </div>
        )}

        {/* 최근 반영된 항목 뱃지 */}
        {recentModifiedFields.length > 0 && (
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-2.5 py-1.5 text-[11px] text-emerald-300 flex items-center gap-1.5 flex-wrap">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-bold">반영 항목:</span>
            {recentModifiedFields.map((f, i) => (
              <span key={i} className="bg-emerald-900/50 px-1.5 py-0.5 rounded text-[10px] text-emerald-200 font-mono">{f}</span>
            ))}
          </div>
        )}

        {/* 임시저장 상태 안내 */}
        {hasRestoredDraft && (
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 px-0.5">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              임시저장 보존 중 (앱을 닫아도 유지됨)
            </span>
            <span>누적 발화: {snippetsHistory.length}회</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* 1. 고객사 & 현장 선택 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            거래처 및 현장 정보
          </span>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-slate-400">거래처 (고객사) 선택 *</label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowBizLicenseModal(true)}
                  className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/80 active:scale-95"
                  title="사업자등록증 사진으로 고객사 신규 등록 및 자동 선택"
                >
                  <FileText className="w-2.5 h-2.5" />
                  <span>사업자등록증 AI</span>
                </button>
                {customerSearchText && (
                  <button
                    type="button"
                    onClick={() => setCustomerSearchText('')}
                    className="text-[10px] text-sky-400 font-bold"
                  >
                    초기화
                  </button>
                )}
              </div>
            </div>
            <input
              type="text"
              value={customerSearchText}
              onChange={(e) => setCustomerSearchText(e.target.value)}
              placeholder="🔍 고객사명 / 초성 검색 (예: ㅅㅅ, ㅇㅈㅇ)"
              className="w-full rounded-xl p-2 text-xs placeholder-slate-500 mb-0.5"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
            />
            <select
              value={selectedCustomerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full rounded-xl p-2.5 text-xs"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
              required
            >
              <option value="">
                {customerSearchText ? `검색 결과 (${filteredCustomersList.length}개사)` : '고객사를 선택하세요'}
              </option>
              {filteredCustomersList.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {selectedCustomerId && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-400">
                  {dispatchMode === 'RETURN' ? '회수 현장 선택 *' : '납품 현장 선택 *'}
                </label>
                {siteSearchText && (
                  <button
                    type="button"
                    onClick={() => setSiteSearchText('')}
                    className="text-[10px] text-sky-400 font-bold"
                  >
                    초기화
                  </button>
                )}
              </div>
              {customerSites.length > 3 && (
                <input
                  type="text"
                  value={siteSearchText}
                  onChange={(e) => setSiteSearchText(e.target.value)}
                  placeholder="🔍 현장명 초성 검색 (예: ㅍㅌ)"
                  className="w-full rounded-xl p-2 text-xs placeholder-slate-500 mb-0.5"
                  style={{
                    backgroundColor: '#090d16',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    colorScheme: 'dark'
                  }}
                />
              )}
              <select
                value={selectedSiteId}
                onChange={(e) => handleSiteChange(e.target.value)}
                className="w-full rounded-xl p-2.5 text-xs"
                style={{
                  backgroundColor: '#090d16',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  colorScheme: 'dark'
                }}
                required
              >
                <option value="">현장을 선택하세요</option>
                {filteredCustomerSites.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.address || '주소미상'})</option>
                ))}
                {dispatchMode === 'DISPATCH' && <option value="NEW">+ [신규 현장 직접 입력]</option>}
              </select>
            </div>
          )}

          {selectedSiteId === 'NEW' && dispatchMode === 'DISPATCH' && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">신규 현장명 *</label>
              <input
                type="text"
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
                placeholder="예: 판교 제2테크노밸리 오피스 신축"
                className="w-full rounded-xl p-2.5 text-xs placeholder-slate-500"
                style={{
                  backgroundColor: '#090d16',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  colorScheme: 'dark'
                }}
                required
              />
            </div>
          )}

          {selectedSiteId && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400">
                  {dispatchMode === 'RETURN' ? '회수 현장 상세 주소 *' : '현장 상세 주소 *'}
                </label>
                <input
                  type="text"
                  value={siteAddress}
                  onChange={(e) => setSiteAddress(e.target.value)}
                  placeholder="예: 경기 성남시 수정구 창업로 42"
                  className="w-full rounded-xl p-2.5 text-xs placeholder-slate-500"
                  style={{
                    backgroundColor: '#090d16',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    colorScheme: 'dark'
                  }}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">현장 담당자</label>
                  <input
                    type="text"
                    value={siteContactName}
                    onChange={(e) => setSiteContactName(e.target.value)}
                    placeholder="소장/반장명"
                    className="w-full rounded-xl p-2.5 text-xs placeholder-slate-500"
                    style={{
                      backgroundColor: '#090d16',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      colorScheme: 'dark'
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">현장 연락처 *</label>
                  <input
                    type="tel"
                    value={siteContactPhone}
                    onChange={(e) => setSiteContactPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    className="w-full rounded-xl p-2.5 text-xs placeholder-slate-500"
                    style={{
                      backgroundColor: '#090d16',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      colorScheme: 'dark'
                    }}
                    required
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 1. 출고/대차 요구 장비 선택 (출고/대차 모드일 때) */}
        {dispatchMode !== 'RETURN' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5" />
                {dispatchMode === 'EXCHANGE' ? '현장 투입 요구 장비 규격' : '출고 요구 장비 규격 및 수량'}
              </span>
              <span className="text-xs text-slate-400 font-bold font-mono">
                총 {orders.reduce((sum, o) => sum + o.count, 0)}대
              </span>
            </div>

            {/* 고소작업대 6대 높이 규격 탭 (19ft ~ 53ft) */}
            <div className="grid grid-cols-6 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {SPEC_OPTIONS.map((spec) => {
                const isSelected = activeFt === spec.ft;
                const specStat = availableInventory[spec.ft];
                const totalAvail = specStat?.total || 0;
                return (
                  <button
                    key={spec.ft}
                    type="button"
                    onClick={() => handleSelectFt(spec.ft)}
                    className={`py-2 flex flex-col items-center justify-center rounded-lg transition-all active:scale-95 ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-xs font-black">{spec.ft}</span>
                    <span className={`text-[10px] font-mono mt-0.5 font-bold ${
                      isSelected ? 'text-blue-100' : totalAvail > 0 ? 'text-emerald-400' : 'text-slate-500'
                    }`}>
                      {totalAvail}대
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 선택된 피트의 모델 리스트 */}
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-400">
                  {activeFt} 가용 모델 (터치 시 목록 추가)
                </span>
                <span className="text-[10.5px] text-slate-500">
                  총 {availableInventory[activeFt]?.total || 0}대 보유
                </span>
              </div>

              {availableInventory[activeFt]?.models && availableInventory[activeFt].models.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {availableInventory[activeFt].models.map(m => {
                    const orderedCount = orders.find(o => o.ft === activeFt && o.modelName === m.modelName)?.count || 0;
                    return (
                      <button
                        key={m.modelName}
                        type="button"
                        onClick={() => handleAddModelOrder(activeFt, m.modelName)}
                        className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold active:scale-95 transition-all shadow-sm ${
                          orderedCount > 0
                            ? 'bg-emerald-950/80 border-emerald-500 text-emerald-100 ring-1 ring-emerald-500/40'
                            : 'bg-slate-900 border-slate-700/80 text-slate-200 hover:border-emerald-500 hover:text-white'
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="font-mono text-white font-bold">{m.modelName}</span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-700/60 text-[10px] text-emerald-300 font-mono font-bold">
                          {m.count}대 재고
                        </span>
                        {orderedCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-900/80 text-blue-200 text-[10px] font-mono font-black">
                            {orderedCount}대 선택됨
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
                  <p className="text-xs text-slate-400">
                    주기장에 즉시 출고 가능한 {activeFt} 자산이 없습니다.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleAddSpec(SPEC_OPTIONS.find(s => s.ft === activeFt) || { ft: activeFt, defaultModel: '동급' })}
                    className="self-start px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5 text-sky-400" />
                    <span>{activeFt} 규격 의뢰 추가 (타사 임차/배차 협의)</span>
                  </button>
                </div>
              )}
            </div>

            {/* 선택된 규격 목록 헤더 */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-bold text-slate-300">
                {dispatchMode === 'EXCHANGE' ? '대차 투입 장비 목록' : '출고 요청 장비 목록'}
              </span>
              <span className="text-[11px] text-slate-400">
                {orders.length}개 모델 ({orders.reduce((sum, o) => sum + o.count, 0)}대)
              </span>
            </div>

            {/* 선택된 규격 목록 */}
            <div className="flex flex-col gap-2">
              {orders.map((item, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs font-bold font-mono">
                        {item.ft}
                      </span>
                      <span className="text-xs font-bold text-white">
                        {item.modelName || '지정 모델'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                      <button
                        type="button"
                        onClick={() => handleCountChange(idx, -1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 text-slate-200 hover:text-white active:scale-95"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-bold text-white min-w-[20px] text-center font-mono">
                        {item.count}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCountChange(idx, 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 text-slate-200 hover:text-white active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {orders.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOrder(idx)}
                        className="text-xs text-rose-400 hover:text-rose-300 p-1 font-bold active:scale-95"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. 회수 대상 장비 선택 (회수 및 대차 모드일 때) */}
        {dispatchMode !== 'DISPATCH' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5" />
                현장 대여중 장비 회수 선택 ({siteRentedAssets.length}대 가동중)
              </span>
              <span className="text-xs text-white font-bold font-mono">
                {selectedReturnAssetIds.length}대 선택됨
              </span>
            </div>

            {siteRentedAssets.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-950 rounded-xl border border-slate-800">
                선택된 거래처/현장에서 현재 대여 중인 장비가 없습니다.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                {siteRentedAssets.map((ra) => {
                  const isChecked = selectedReturnAssetIds.includes(ra.assetId);
                  return (
                    <div
                      key={ra.assetId}
                      onClick={() => toggleReturnAsset(ra.assetId)}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-amber-950/40 border-amber-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-5 h-5 rounded flex items-center justify-center border ${
                          isChecked ? 'bg-amber-600 border-amber-500 text-white' : 'border-slate-700 bg-slate-900'
                        }`}>
                          {isChecked && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <div>
                          <span className="font-mono font-bold text-sm text-white mr-2">{ra.assetNo}</span>
                          <span className="text-xs text-slate-400 font-bold">{ra.modelName}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">계약 {ra.contractNo}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 3. 납품/회수 일시 지정 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {dispatchMode === 'RETURN' ? '회수 희망 일시' : '도착(납품) 희망 일시'}
          </span>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">희망 일자 *</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full rounded-xl p-2.5 text-xs text-white"
                style={{
                  backgroundColor: '#090d16',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  colorScheme: 'dark'
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">희망 시간 *</label>
              <input
                type="time"
                value={deliveryTime}
                onChange={(e) => setDeliveryTime(e.target.value)}
                className="w-full rounded-xl p-2.5 text-xs text-white"
                style={{
                  backgroundColor: '#090d16',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  colorScheme: 'dark'
                }}
                required
              />
            </div>
          </div>
        </div>

        {/* 4. 유상옵션 및 보양작업 / 요구 사양 (출고 및 대차 모드) */}
        {dispatchMode !== 'RETURN' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3.5">
            <span className="text-xs font-bold text-purple-400 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              현장 옵션 및 요구 사양
            </span>

            {/* 유상옵션 입력 및 추천 칩 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-400 font-bold">유상 옵션 (철망/함석/에어배관 등)</label>
                {paidOptions && (
                  <button
                    type="button"
                    onClick={() => setPaidOptions('')}
                    className="text-[10px] text-slate-500 hover:text-slate-400"
                  >
                    초기화
                  </button>
                )}
              </div>
              <input
                type="text"
                value={paidOptions}
                onChange={(e) => setPaidOptions(e.target.value)}
                placeholder="예: 4면 철망 설치, 에어배관, 소형 발전기..."
                className="w-full rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none"
                style={{ backgroundColor: '#090d16', border: '1px solid #334155' }}
              />
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {['4면 철망', '3면 철망', '함석 설치', '에어배관', '발전기 탑재'].map((chip) => {
                  const isIncluded = paidOptions.includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        if (isIncluded) {
                          setPaidOptions(prev => prev.split(', ').filter(s => s !== chip).join(', '));
                        } else {
                          setPaidOptions(prev => prev ? `${prev}, ${chip}` : chip);
                        }
                      }}
                      className={`px-2 py-1 rounded-lg text-[10.5px] font-bold transition-all ${
                        isIncluded
                          ? 'bg-purple-600 text-white border border-purple-500'
                          : 'bg-slate-950 text-slate-400 border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {isIncluded ? `✓ ${chip}` : `+ ${chip}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 보양작업 입력 및 추천 칩 */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-400 font-bold">보양 작업 (바닥보양/휠보양/사다리 등)</label>
                {protection && (
                  <button
                    type="button"
                    onClick={() => setProtection('')}
                    className="text-[10px] text-slate-500 hover:text-slate-400"
                  >
                    초기화
                  </button>
                )}
              </div>
              <input
                type="text"
                value={protection}
                onChange={(e) => setProtection(e.target.value)}
                placeholder="예: 바닥 보양(부직포/플라베니아), 휠커버, 탑승구 사다리보양..."
                className="w-full rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none"
                style={{ backgroundColor: '#090d16', border: '1px solid #334155' }}
              />
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {['바닥 보양(부직포)', '타이어 휠커버', '사다리 보양', '모서리 랩핑'].map((chip) => {
                  const isIncluded = protection.includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        if (isIncluded) {
                          setProtection(prev => prev.split(', ').filter(s => s !== chip).join(', '));
                        } else {
                          setProtection(prev => prev ? `${prev}, ${chip}` : chip);
                        }
                      }}
                      className={`px-2 py-1 rounded-lg text-[10.5px] font-bold transition-all ${
                        isIncluded
                          ? 'bg-indigo-600 text-white border border-indigo-500'
                          : 'bg-slate-950 text-slate-400 border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {isIncluded ? `✓ ${chip}` : `+ ${chip}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 🌟 옵션 변경 시 현장 마스터 저장 확인 토글 */}
            {selectedSite && isOptionsDiff && (
              <div className="mt-2 p-2.5 rounded-xl border border-amber-500/40 bg-amber-950/20 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>현장 기존 옵션과 변경사항 감지</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  변경된 옵션을 현장 기본값으로 저장할까요? (1회성 선택 시 기존 현장 옵션이 유지됩니다)
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  <button
                    type="button"
                    onClick={() => setSaveOptionsToSite(true)}
                    className={`p-1.5 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                      saveOptionsToSite
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {saveOptionsToSite && <Check className="w-3 h-3" />}
                    <span>현장 기본값 저장 (유지)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaveOptionsToSite(false)}
                    className={`p-1.5 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                      !saveOptionsToSite
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {!saveOptionsToSite && <Check className="w-3 h-3" />}
                    <span>이번만 1회성 적용 (보존)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5. 물류 운송비 부담 및 정산마감 조건 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3.5">
          <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5" />
            물류 운송비 및 정산 마감조건
          </span>

          {/* 운송비 부담주체 원터치 토글 (당사부담 vs 고객청구) */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400 font-bold">운송비 부담 주체 *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBillableToCustomer(false)}
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  !billableToCustomer
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-950/40'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                {!billableToCustomer && <Check className="w-3.5 h-3.5" />}
                <span>당사 부담 (기본)</span>
              </button>
              <button
                type="button"
                onClick={() => setBillableToCustomer(true)}
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  billableToCustomer
                    ? 'bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/40'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                {billableToCustomer && <Check className="w-3.5 h-3.5" />}
                <span>고객사 청구 (현장부담)</span>
              </button>
            </div>
          </div>

          {/* 차종 선택 */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400 font-bold">배차 희망 차종</label>
            <div className="grid grid-cols-3 gap-1.5">
              {['5톤 렉카', '셀프로더', '대형 축차'].map(vt => (
                <button
                  key={vt}
                  type="button"
                  onClick={() => setVehicleType(vt)}
                  className={`py-2 px-1 rounded-xl border text-center text-xs font-bold transition-all ${
                    vehicleType === vt
                      ? 'bg-slate-800 text-white border-blue-500'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {vt}
                </button>
              ))}
            </div>
          </div>

          {/* 마감일 / 결제일 / 계산서 수신 메일 */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">청구 마감일</label>
              <input
                type="text"
                value={closingDay}
                onChange={(e) => setClosingDay(e.target.value)}
                placeholder="말일, 20일, 25일..."
                className="w-full rounded-xl p-2.5 text-xs text-white focus:outline-none"
                style={{ backgroundColor: '#090d16', border: '1px solid #334155' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">대금 결제일</label>
              <input
                type="text"
                value={paymentDay}
                onChange={(e) => setPaymentDay(e.target.value)}
                placeholder="익월 25일, 익월 말일..."
                className="w-full rounded-xl p-2.5 text-xs text-white focus:outline-none"
                style={{ backgroundColor: '#090d16', border: '1px solid #334155' }}
              />
            </div>
          </div>
        </div>

        {/* 6. 특이사항 및 현장 메모 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-300">특이사항 및 배차 메모</label>
          <textarea
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={dispatchMode === 'RETURN' ? '회수 위치, 하역장 위치 등 메모...' : '지게차 하차 필요, 지하 2층 높이제한 2.3m, 현장 출입 조건 등...'}
            className="w-full rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none"
            style={{
              backgroundColor: '#090d16',
              color: '#f8fafc',
              border: '1px solid #334155',
              colorScheme: 'dark'
            }}
          />
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-4 rounded-2xl text-white font-black text-sm shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
            dispatchMode === 'EXCHANGE'
              ? 'bg-purple-600 hover:bg-purple-500 shadow-purple-900/30'
              : dispatchMode === 'RETURN'
              ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/30'
              : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/30'
          }`}
        >
          {isSubmitting ? (
            <span>처리 중...</span>
          ) : dispatchMode === 'EXCHANGE' ? (
            <>
              <RotateCw className="w-4 h-4" />
              <span>대차(교환) 의뢰 접수 (단일 왕복 배차)</span>
            </>
          ) : dispatchMode === 'RETURN' ? (
            <>
              <ArrowDownLeft className="w-4 h-4" />
              <span>회수 요청 접수 완료 ({selectedReturnAssetIds.length}대)</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>출고 요청 접수 및 발송 ({orders.reduce((sum, o) => sum + o.count, 0)}대)</span>
            </>
          )}
        </button>
      </form>

      {/* ─── 대화형 음성 인터뷰 위자드 모달 ─── */}
      <VoiceGuideWizardModal
        isOpen={isVoiceWizardOpen}
        onClose={() => setIsVoiceWizardOpen(false)}
        onComplete={(data: VoiceGuideWizardCompleteData) => {
          if (data.customerId) setSelectedCustomerId(data.customerId);
          if (data.siteId) setSelectedSiteId(data.siteId);
          if (data.newSiteName) setNewSiteName(data.newSiteName);
          if (data.siteAddress) setSiteAddress(data.siteAddress);
          if (data.siteContactName) setSiteContactName(data.siteContactName);
          if (data.siteContactPhone) setSiteContactPhone(data.siteContactPhone);
          if (data.deliveryDate) setDeliveryDate(data.deliveryDate);
          if (data.deliveryTime) setDeliveryTime(data.deliveryTime);
          if (data.orders && data.orders.length > 0) setOrders(data.orders);
          if (data.paidOptions) setPaidOptions(data.paidOptions);
          if (data.protection) setProtection(data.protection);
          if (data.checkedSpecs) setCheckedSpecs(data.checkedSpecs);
          if (data.saveOptionsToSite !== undefined) setSaveOptionsToSite(data.saveOptionsToSite);
          if (data.billableToCustomer !== undefined) setBillableToCustomer(data.billableToCustomer);
          if (data.closingDay) setClosingDay(data.closingDay);
          if (data.paymentDay) setPaymentDay(data.paymentDay);
          if (data.vehicleType) setVehicleType(data.vehicleType);
          setHasRestoredDraft(true);
          if (data.isPartialHandOff) {
            showToast('입력 중이던 내용이 일반 서식에 반영되었습니다. 나머지 항목을 확인 후 접수해주세요.');
          } else {
            showToast('대화형 음성으로 출고 요청 전체 서식이 완성되었습니다.');
          }
        }}
      />

      {/* 🎙️ 자유 음성메모 출고의뢰 스튜디오 모달 (핵심 5대 슬롯 충족 자동 접수) */}
      <VoiceMemoDispatchStudioModal
        isOpen={isVoiceMemoStudioOpen}
        onClose={() => setIsVoiceMemoStudioOpen(false)}
        onHandOffToForm={(draftData) => {
          if (draftData.customerId) setSelectedCustomerId(draftData.customerId);
          if (draftData.siteId) setSelectedSiteId(draftData.siteId);
          if (draftData.newSiteName) setNewSiteName(draftData.newSiteName);
          if (draftData.siteAddress) setSiteAddress(draftData.siteAddress);
          if (draftData.siteContactName) setSiteContactName(draftData.siteContactName);
          if (draftData.siteContactPhone) setSiteContactPhone(draftData.siteContactPhone);
          if (draftData.deliveryDate) setDeliveryDate(draftData.deliveryDate);
          if (draftData.deliveryTime) setDeliveryTime(draftData.deliveryTime);
          if (draftData.orders && draftData.orders.length > 0) setOrders(draftData.orders);
          if (draftData.memo) setMemo(draftData.memo);
          if (draftData.paidOptions) setPaidOptions(draftData.paidOptions);
          if (draftData.protection) setProtection(draftData.protection);
          if (draftData.checkedSpecs) setCheckedSpecs(draftData.checkedSpecs);
          if (draftData.billableToCustomer !== undefined) setBillableToCustomer(draftData.billableToCustomer);
          if (draftData.closingDay) setClosingDay(draftData.closingDay);
          if (draftData.paymentDay) setPaymentDay(draftData.paymentDay);
          if (draftData.vehicleType) setVehicleType(draftData.vehicleType);
          setHasRestoredDraft(true);
          showToast('음성 메모 내용이 일반 서식에 반영되었습니다.');
        }}
        onDirectSubmitSuccess={(res) => {
          setCreatedResult({
            isReturn: false,
            contractNo: res.contractNo,
            siteName: res.siteName,
            totalCount: res.totalCount
          });
          showToast('음성 메모로 출고의뢰가 접수되었습니다.');
        }}
      />

      {/* 사업자등록증 AI 신규등록/보완 모달 */}
      <BusinessLicenseModal
        isOpen={showBizLicenseModal}
        onClose={() => setShowBizLicenseModal(false)}
        onSuccess={(cust) => {
          handleCustomerChange(cust.id);
        }}
      />
    </div>
  );
};
