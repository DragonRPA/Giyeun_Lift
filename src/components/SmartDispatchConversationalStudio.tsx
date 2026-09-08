// src/components/SmartDispatchConversationalStudio.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Mic, MicOff, Volume2, VolumeX, RotateCcw,
  Building2, MapPin, Sparkles, 
  Plus, Minus, Search, CheckCircle2, AlertTriangle, ArrowRight, Trash2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ttsService } from '../services/ttsService';
import { Customer, CustomerSite } from '../services/db';
import { matchHangulAny } from '../utils/hangulSearch';
import { 
  parseCustomerVoiceInput, 
  parseSiteVoiceInput, 
  parseEquipmentVoiceInput, 
  parseDateTimeVoiceInput,
  parseOptionsAndSpecsVoiceInput,
  parseLogisticsAndBillingVoiceInput,
  parseYesNoVoiceInput,
  parseContactNameVoiceInput,
  parseContactPhoneVoiceInput,
  getSiteOptionsSummary,
  isOptionsChangedFromSite,
  EQUIPMENT_SPEC_MATRIX,
  ParsedDateTimeResult
} from '../services/voiceOrderDraftService';

export type StudioStep = 'CUSTOMER' | 'SITE' | 'EQUIPMENT' | 'DATETIME' | 'OPTIONS_NOTE' | 'CONFIRM';
export type StudioSiteSubStep = 'SITE_SELECT' | 'CONTACT_CONFIRM' | 'CONTACT_NAME' | 'CONTACT_PHONE' | 'OPTIONS_CONFIRM';

export interface StudioEquipmentItem {
  ft: string;
  modelName: string;
  qty: number;
}

export interface StudioSyncData {
  customerName: string;
  siteName: string;
  siteAddress: string;
  siteContactName: string;
  siteContactPhone: string;
  equipments: { modelName: string; qty: number }[];
  unloadingTime: string;
  paidOptions: string;
  protection: string;
  checkedSpecs: Record<string, boolean>;
  saveOptionsToSite: boolean;
  billableToCustomer: boolean;
  closingDay: string;
  paymentDay: string;
  memo: string;
}

interface SmartDispatchConversationalStudioProps {
  onSyncToForm: (data: Partial<StudioSyncData>) => void;
  onResetAll?: () => void;
}

export const SmartDispatchConversationalStudio: React.FC<SmartDispatchConversationalStudioProps> = ({
  onSyncToForm,
  onResetAll
}) => {
  const { customers, sites } = useApp();

  // 1. 단계 상태
  const [currentStep, setCurrentStep] = useState<StudioStep>('CUSTOMER');
  const [siteSubStep, setSiteSubStep] = useState<StudioSiteSubStep>('SITE_SELECT');
  const [pendingSite, setPendingSite] = useState<CustomerSite | null>(null);

  // 2. TTS 음성 안내 ON/OFF 상태
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => ttsService.getIsEnabled());

  // 3. 입력 데이터 상태
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSite, setSelectedSite] = useState<CustomerSite | null>(null);
  const [newSiteName, setNewSiteName] = useState<string>('');
  const [siteAddress, setSiteAddress] = useState<string>('');
  const [siteContactName, setSiteContactName] = useState<string>('');
  const [siteContactPhone, setSiteContactPhone] = useState<string>('');

  // 3-B. 복수 모델 장바구니/목록 상태 (1개 출고건에 복수 모델 완벽 지원)
  const [equipmentList, setEquipmentList] = useState<StudioEquipmentItem[]>([
    { ft: '19ft', modelName: 'GS-1930', qty: 1 }
  ]);
  const [equipmentInputText, setEquipmentInputText] = useState<string>('');

  const [dateTimeResult, setDateTimeResult] = useState<ParsedDateTimeResult | null>(null);

  const [paidOptions, setPaidOptions] = useState<string>('');
  const [protection, setProtection] = useState<string>('');
  const [checkedSpecs, setCheckedSpecs] = useState<Record<string, boolean>>({});
  const [saveOptionsToSite, setSaveOptionsToSite] = useState<boolean>(true);
  const [billableToCustomer, setBillableToCustomer] = useState<boolean>(false);
  const [closingDay, setClosingDay] = useState<string>('');
  const [paymentDay, setPaymentDay] = useState<string>('');
  const [specialMemo, setSpecialMemo] = useState<string>('');

  // 4. 입력 필드 및 음성 인식 상태
  const [lastSttText, setLastSttText] = useState<string>('');
  const [assistantPrompt, setAssistantPrompt] = useState<string>('어느 고객사인가요? 고객사 이름을 검색하거나 말씀해주세요.');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [customerSearchText, setCustomerSearchText] = useState<string>('');
  const [siteSearchText, setSiteSearchText] = useState<string>('');
  const [showNewSiteForm, setShowNewSiteForm] = useState<boolean>(false);
  const [manualNewSiteName, setManualNewSiteName] = useState<string>('');
  const [manualNewSiteAddr, setManualNewSiteAddr] = useState<string>('');

  // 5. 날짜/시간 기본값
  const defaultTomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);
  const [customDate, setCustomDate] = useState<string>(defaultTomorrowStr);
  const [customTime, setCustomTime] = useState<string>('08:00');

  const recognitionRef = useRef<any>(null);

  // 총 장비 대수 계산
  const totalEquipmentQty = useMemo(() => {
    return equipmentList.reduce((sum, item) => sum + item.qty, 0);
  }, [equipmentList]);

  // 옵션 변경 감지
  const isOptionsDiff = useMemo(() => {
    const targetSite = selectedSite || pendingSite;
    return isOptionsChangedFromSite(targetSite, paidOptions, protection, checkedSpecs);
  }, [selectedSite, pendingSite, paidOptions, protection, checkedSpecs]);

  // 고객사 필터 (완성형, 초성 및 복자음 분해 검색 실시간 지원)
  const filteredCustomers = useMemo(() => {
    if (!customerSearchText.trim()) return (customers || []).slice(0, 10);
    const q = customerSearchText.trim();
    return (customers || []).filter(c => 
      matchHangulAny([c.name, c.representative, c.bizRegNo], q)
    ).slice(0, 10);
  }, [customers, customerSearchText]);

  // 고객사의 현장 목록 (초성 검색 지원)
  const customerSites = useMemo(() => {
    if (!selectedCustomer) return [];
    return (sites || []).filter(s => s.customerId === selectedCustomer.id);
  }, [sites, selectedCustomer]);

  const filteredCustomerSites = useMemo(() => {
    if (!siteSearchText.trim()) return customerSites;
    const q = siteSearchText.trim();
    return customerSites.filter(s => matchHangulAny([s.name, s.address, s.contactName], q));
  }, [customerSites, siteSearchText]);

  // TTS 구독
  useEffect(() => {
    return ttsService.onEnabledChange((enabled) => {
      setTtsEnabled(enabled);
    });
  }, []);

  // 단계 변경 시 안내 발화
  const speakPrompt = (promptText: string) => {
    setAssistantPrompt(promptText);
    if (ttsService.getIsEnabled()) {
      ttsService.speak(promptText);
    }
  };

  // 전체 초기화
  const handleReset = () => {
    setCurrentStep('CUSTOMER');
    setSiteSubStep('SITE_SELECT');
    setPendingSite(null);
    setSelectedCustomer(null);
    setSelectedSite(null);
    setNewSiteName('');
    setSiteAddress('');
    setSiteContactName('');
    setSiteContactPhone('');
    setEquipmentList([{ ft: '19ft', modelName: 'GS-1930', qty: 1 }]);
    setEquipmentInputText('');
    setDateTimeResult(null);
    setPaidOptions('');
    setProtection('');
    setCheckedSpecs({});
    setSaveOptionsToSite(true);
    setBillableToCustomer(false);
    setClosingDay('');
    setPaymentDay('');
    setSpecialMemo('');
    setLastSttText('');
    setCustomerSearchText('');
    setSiteSearchText('');
    setShowNewSiteForm(false);
    setCustomDate(defaultTomorrowStr);
    setCustomTime('08:00');

    speakPrompt('어느 고객사인가요? 고객사 이름을 검색하거나 말씀해주세요.');
    if (onResetAll) onResetAll();
  };

  // 동기화 헬퍼 (우측 폼으로 즉시 전달)
  const syncCurrentData = (extra?: Partial<StudioSyncData>) => {
    const data: Partial<StudioSyncData> = {
      customerName: selectedCustomer ? selectedCustomer.name : '',
      siteName: selectedSite ? selectedSite.name : newSiteName,
      siteAddress: selectedSite ? (selectedSite.address || '') : siteAddress,
      siteContactName,
      siteContactPhone,
      equipments: equipmentList.length > 0 
        ? equipmentList.map(e => ({ modelName: e.modelName, qty: e.qty }))
        : [{ modelName: '', qty: 1 }],
      unloadingTime: dateTimeResult ? `${dateTimeResult.date} ${dateTimeResult.time}` : `${customDate} ${customTime}`,
      paidOptions,
      protection,
      checkedSpecs,
      saveOptionsToSite,
      billableToCustomer,
      closingDay,
      paymentDay,
      memo: specialMemo,
      ...extra
    };
    onSyncToForm(data);
  };

  // 1단계: 고객사 선택 핸들러
  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearchText(customer.name);
    const closing = customer.defaultBillingDay ? (customer.defaultBillingDay === 30 || customer.defaultBillingDay === 31 ? '말일' : `${customer.defaultBillingDay}일`) : '';
    const payment = customer.paymentDueDay ? `익월 ${customer.paymentDueDay}일` : '';
    const toCleanStr = (val: any) => {
      if (!val) return '';
      if (Array.isArray(val)) return val.flat().map((s: any) => String(s).trim()).filter(Boolean).join(', ');
      return String(val).trim();
    };

    const defPaid = toCleanStr(customer.defaultPaidOptions);
    const defProt = toCleanStr(customer.defaultProtection);
    const defSpecs = customer.defaultCheckedSpecs || {};

    setClosingDay(closing);
    setPaymentDay(payment);
    if (defPaid) setPaidOptions(defPaid);
    if (defProt) setProtection(defProt);
    if (defSpecs) setCheckedSpecs(defSpecs);

    syncCurrentData({
      customerName: customer.name,
      closingDay: closing,
      paymentDay: payment,
      paidOptions: defPaid,
      protection: defProt,
      checkedSpecs: defSpecs
    });

    setCurrentStep('SITE');
    setSiteSubStep('SITE_SELECT');
    speakPrompt(`${customer.name}의 현장명을 검색하거나 말씀해주세요.`);
  };

  const handleCustomerSubmit = (queryText: string) => {
    const raw = queryText.trim();
    if (!raw) return;
    const matched = parseCustomerVoiceInput(raw, customers || []);
    if (matched) {
      handleSelectCustomer(matched);
    } else if (filteredCustomers.length === 1) {
      handleSelectCustomer(filteredCustomers[0]);
    } else if (filteredCustomers.length > 1) {
      handleSelectCustomer(filteredCustomers[0]);
    } else {
      speakPrompt(`'${raw}' 거래처를 찾지 못했습니다. 목록에서 직접 선택하거나 다시 입력해주세요.`);
    }
  };

  // 2단계: 현장 선택 및 능동 확인 핸들러
  const handleSelectExistingSite = (site: CustomerSite) => {
    setPendingSite(site);
    setSelectedSite(site);
    setSiteSearchText(site.name);
    setNewSiteName(site.name);
    setSiteAddress(site.address || '');

    const hasContact = !!(site.contactName && site.contact);
    const sitePaid = site.paidOptions ? (Array.isArray(site.paidOptions) ? (site.paidOptions as any[]).join(', ') : String(site.paidOptions)).trim() : '';
    const siteProt = site.protection ? (Array.isArray(site.protection) ? (site.protection as any[]).join(', ') : String(site.protection)).trim() : '';
    const hasOptions = !!(sitePaid || siteProt);

    if (hasContact) {
      setSiteSubStep('CONTACT_CONFIRM');
      speakPrompt(`현장 담당자가 ${site.contactName} 님(${site.contact})이 맞으신가요? [예] 또는 [아니오]를 선택하세요.`);
    } else if (hasOptions) {
      setSiteSubStep('OPTIONS_CONFIRM');
      const optSummary = getSiteOptionsSummary(site);
      speakPrompt(`기존 현장 옵션(${optSummary})과 동일하게 출고할까요? [동일] 또는 [변경]을 선택하세요.`);
    } else {
      finalizeSiteSelection(site, site.contactName || '', site.contact || '');
    }
  };

  const handleSiteSubmit = (queryText: string) => {
    const raw = queryText.trim();
    if (!raw) return;
    const matched = parseSiteVoiceInput(raw, customerSites);
    if (matched?.site) {
      handleSelectExistingSite(matched.site);
    } else if (matched?.isNew && matched?.newSiteName) {
      handleCreateNewSite(matched.newSiteName, matched.extractedAddress || '');
    } else if (filteredCustomerSites.length === 1) {
      handleSelectExistingSite(filteredCustomerSites[0]);
    } else {
      handleCreateNewSite(raw, '');
    }
  };

  const handleCreateNewSite = (name: string, address: string) => {
    if (!name.trim()) return;
    setSelectedSite(null);
    setPendingSite(null);
    setNewSiteName(name.trim());
    setSiteAddress(address.trim());
    setSiteSearchText(name.trim());
    setShowNewSiteForm(false);

    syncCurrentData({
      siteName: name.trim(),
      siteAddress: address.trim()
    });

    setCurrentStep('EQUIPMENT');
    speakPrompt('출고할 장비의 규격과 수량을 선택하거나 말씀해주세요.');
  };

  const finalizeSiteSelection = (
    site: CustomerSite,
    cName: string,
    cPhone: string,
    useSiteOpts: boolean = true
  ) => {
    setSelectedSite(site);
    setSiteContactName(cName);
    setSiteContactPhone(cPhone);

    let nextPaid = paidOptions;
    let nextProt = protection;
    let nextSpecs = { ...checkedSpecs };

    if (useSiteOpts) {
      if (site.paidOptions) nextPaid = site.paidOptions;
      if (site.protection) nextProt = site.protection;
      if (site.checkedSpecs) nextSpecs = { ...nextSpecs, ...site.checkedSpecs };
      setPaidOptions(nextPaid);
      setProtection(nextProt);
      setCheckedSpecs(nextSpecs);
    }

    syncCurrentData({
      siteName: site.name,
      siteAddress: site.address || '',
      siteContactName: cName,
      siteContactPhone: cPhone,
      paidOptions: nextPaid,
      protection: nextProt,
      checkedSpecs: nextSpecs
    });

    setPendingSite(null);
    setCurrentStep('EQUIPMENT');
    speakPrompt('출고할 장비의 규격과 수량을 선택하거나 말씀해주세요.');
  };

  // 3단계: 복수 장비 모델 장바구니 조작 핸들러
  // 규격 칩 클릭 시: 이미 있으면 +1, 없으면 신규 1대 추가
  const handleAddOrIncrementSpec = (spec: { ft: string; modelName: string }) => {
    let updated = [...equipmentList];
    const existingIdx = updated.findIndex(e => e.modelName === spec.modelName);
    if (existingIdx >= 0) {
      updated[existingIdx] = { ...updated[existingIdx], qty: updated[existingIdx].qty + 1 };
    } else {
      updated.push({ ft: spec.ft, modelName: spec.modelName, qty: 1 });
    }
    setEquipmentList(updated);
    syncCurrentData({
      equipments: updated.map(e => ({ modelName: e.modelName, qty: e.qty }))
    });
  };

  // 수량 증감 (- / +)
  const handleUpdateQty = (index: number, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveEquipmentItem(index);
      return;
    }
    const updated = [...equipmentList];
    updated[index] = { ...updated[index], qty: newQty };
    setEquipmentList(updated);
    syncCurrentData({
      equipments: updated.map(e => ({ modelName: e.modelName, qty: e.qty }))
    });
  };

  // 개별 장비 삭제
  const handleRemoveEquipmentItem = (index: number) => {
    const updated = equipmentList.filter((_, i) => i !== index);
    setEquipmentList(updated);
    syncCurrentData({
      equipments: updated.length > 0 
        ? updated.map(e => ({ modelName: e.modelName, qty: e.qty })) 
        : [{ modelName: '', qty: 1 }]
    });
  };

  // 장비 목록 전체 비우기
  const handleClearEquipments = () => {
    setEquipmentList([]);
    syncCurrentData({
      equipments: [{ modelName: '', qty: 1 }]
    });
  };

  // 장비 텍스트/음성 파싱 추가 (예: "1930 2대, 3246 1대")
  const handleEquipmentTextInput = (text: string) => {
    const raw = text.trim();
    if (!raw) return;
    const parsed = parseEquipmentVoiceInput(raw);
    if (parsed && parsed.orders && parsed.orders.length > 0) {
      let updated = [...equipmentList];
      parsed.orders.forEach(order => {
        const existingIdx = updated.findIndex(e => e.modelName === order.modelName);
        if (existingIdx >= 0) {
          updated[existingIdx] = { ...updated[existingIdx], qty: order.count };
        } else {
          updated.push({ ft: order.ft, modelName: order.modelName, qty: order.count });
        }
      });
      setEquipmentList(updated);
      setEquipmentInputText('');
      syncCurrentData({
        equipments: updated.map(e => ({ modelName: e.modelName, qty: e.qty }))
      });
      speakPrompt(`${parsed.orders.map(o => `${o.modelName} ${o.count}대`).join(', ')}가 목록에 추가되었습니다.`);
    } else {
      speakPrompt('장비 규격과 수량을 인식하지 못했습니다. 아래 규격 칩을 누르시거나 직접 입력해주세요.');
    }
  };

  // 장비 확정 후 일시 단계로 이동
  const handleAdvanceToDateTime = () => {
    if (equipmentList.length === 0) {
      speakPrompt('출고할 장비를 최소 1대 이상 선택해주세요.');
      return;
    }
    setCurrentStep('DATETIME');
    speakPrompt('하차 희망 일시를 선택하거나 말씀해주세요.');
  };

  // 4단계: 하차일시 확정
  const handleConfirmDateTime = (date: string, time: string, isAsap: boolean = false) => {
    const dtResult: ParsedDateTimeResult = {
      date,
      time,
      isAsap,
      confirmQuestion: '',
      displayText: `${date} ${time}`
    };
    setDateTimeResult(dtResult);
    setCustomDate(date);
    setCustomTime(time);

    syncCurrentData({
      unloadingTime: `${date} ${time}`
    });

    setCurrentStep('OPTIONS_NOTE');
    speakPrompt('철망, 보양, 운송비나 특이사항이 있나요? 설정 후 확인 단계로 이동하세요.');
  };

  // 5단계: 옵션 토글
  const toggleOption = (optName: string) => {
    const rawPaid = typeof paidOptions === 'string' ? paidOptions : (Array.isArray(paidOptions) ? (paidOptions as any[]).join(', ') : String(paidOptions || ''));
    let currentArr = rawPaid.split(',').map(s => s.trim()).filter(Boolean);
    if (currentArr.includes(optName)) {
      currentArr = currentArr.filter(s => s !== optName);
    } else {
      currentArr.push(optName);
    }
    const updated = currentArr.join(', ');
    setPaidOptions(updated);
    syncCurrentData({ paidOptions: updated });
  };

  const handleFinishOptions = () => {
    syncCurrentData({
      paidOptions,
      protection,
      billableToCustomer,
      memo: specialMemo,
      saveOptionsToSite
    });
    setCurrentStep('CONFIRM');
    speakPrompt('입력된 내용이 우측 폼에 실시간 반영되었습니다. 내용을 확인 후 출고지시를 저장하세요.');
  };

  // 음성인식 (STT) 통합 디스패처 (각 단계별 검색/입력 객체에 직결)
  const handleVoiceResultForStep = (text: string, step: StudioStep) => {
    const raw = text.trim();
    if (!raw) return;

    if (step === 'CUSTOMER') {
      setCustomerSearchText(raw);
      handleCustomerSubmit(raw);
      return;
    }

    if (step === 'SITE') {
      if (siteSubStep === 'SITE_SELECT') {
        setSiteSearchText(raw);
        handleSiteSubmit(raw);
      } else if (siteSubStep === 'CONTACT_CONFIRM') {
        const yn = parseYesNoVoiceInput(raw);
        if (yn === true && pendingSite) {
          if (pendingSite.paidOptions || pendingSite.protection) {
            setSiteSubStep('OPTIONS_CONFIRM');
            const optSummary = getSiteOptionsSummary(pendingSite);
            speakPrompt(`기존 현장 옵션(${optSummary})과 동일하게 출고할까요? [동일] 또는 [변경]을 선택하세요.`);
          } else {
            finalizeSiteSelection(pendingSite, pendingSite.contactName || '', pendingSite.contact || '');
          }
        } else if (yn === false && pendingSite) {
          setSiteSubStep('CONTACT_NAME');
          speakPrompt('현장 담당자님의 성함을 말씀해주세요.');
        }
      } else if (siteSubStep === 'CONTACT_NAME') {
        const name = parseContactNameVoiceInput(raw) || raw;
        setSiteContactName(name);
        setSiteSubStep('CONTACT_PHONE');
        speakPrompt(`${name} 담당자님의 연락처를 말씀해주세요.`);
      } else if (siteSubStep === 'CONTACT_PHONE') {
        const phone = parseContactPhoneVoiceInput(raw) || raw;
        setSiteContactPhone(phone);
        if (pendingSite && (pendingSite.paidOptions || pendingSite.protection)) {
          setSiteSubStep('OPTIONS_CONFIRM');
          const optSummary = getSiteOptionsSummary(pendingSite);
          speakPrompt(`기존 현장 옵션(${optSummary})과 동일하게 출고할까요? [동일] 또는 [변경]을 선택하세요.`);
        } else if (pendingSite) {
          finalizeSiteSelection(pendingSite, siteContactName, phone);
        }
      } else if (siteSubStep === 'OPTIONS_CONFIRM') {
        const yn = parseYesNoVoiceInput(raw);
        if (pendingSite) {
          finalizeSiteSelection(pendingSite, siteContactName || pendingSite.contactName || '', siteContactPhone || pendingSite.contact || '', yn !== false);
        }
      }
      return;
    }

    if (step === 'EQUIPMENT') {
      setEquipmentInputText(raw);
      handleEquipmentTextInput(raw);
      return;
    }

    if (step === 'DATETIME') {
      const dt = parseDateTimeVoiceInput(raw);
      if (dt) {
        handleConfirmDateTime(dt.date, dt.time, dt.isAsap);
      } else {
        speakPrompt('일시를 인식하지 못했습니다. 빠른 선택 칩을 누르시거나 직접 입력해주세요.');
      }
      return;
    }

    if (step === 'OPTIONS_NOTE') {
      const parsed = parseOptionsAndSpecsVoiceInput(raw);
      const logi = parseLogisticsAndBillingVoiceInput(raw);
      if (parsed.paidOptions) setPaidOptions(parsed.paidOptions);
      if (parsed.protection) setProtection(parsed.protection);
      if (Object.keys(parsed.checkedSpecs).length > 0) setCheckedSpecs(prev => ({ ...prev, ...parsed.checkedSpecs }));
      if (logi.billableToCustomer !== undefined) setBillableToCustomer(logi.billableToCustomer);
      if (logi.specialMemo) setSpecialMemo(prev => prev ? `${prev} | ${logi.specialMemo}` : logi.specialMemo || '');

      handleFinishOptions();
      return;
    }

    if (step === 'CONFIRM') {
      if (raw.includes('저장') || raw.includes('기본값') || raw.includes('유지')) {
        setSaveOptionsToSite(true);
        syncCurrentData({ saveOptionsToSite: true });
        speakPrompt('변경된 옵션을 현장 기본값으로 저장하도록 설정되었습니다.');
      } else if (raw.includes('이번만') || raw.includes('1회') || raw.includes('일회') || raw.includes('보존')) {
        setSaveOptionsToSite(false);
        syncCurrentData({ saveOptionsToSite: false });
        speakPrompt('이번 출고에만 1회성으로 적용하고 기존 현장 옵션은 보존하도록 설정되었습니다.');
      }
    }
  };

  // 브라우저 음성인식 (STT) 시작
  const startRecording = (forStep?: StudioStep) => {
    const targetStep = forStep || currentStep;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speakPrompt('이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트 입력을 사용해주세요.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.interimResults = false;
      recognition.continuous = false;

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        if (text) {
          setLastSttText(text);
          handleVoiceResultForStep(text, targetStep);
        }
      };

      recognition.onerror = () => {
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsRecording(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      
      {/* 1. 상단 스튜디오 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 800,
            padding: '2px 8px',
            borderRadius: '12px',
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <Sparkles size={12} /> 대화형 인터뷰
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            각 단계별 검색창에 직접 타이핑하거나 음성으로 편리하게 입력하세요.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* TTS 스피커 토글 버튼 */}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const next = !ttsEnabled;
              setTtsEnabled(next);
              ttsService.setIsEnabled(next);
            }}
            title={ttsEnabled ? '음성 안내 끄기' : '음성 안내 켜기'}
            style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            {ttsEnabled ? <Volume2 size={13} color="var(--primary)" /> : <VolumeX size={13} color="var(--text-muted)" />}
            <span style={{ fontSize: '11px' }}>{ttsEnabled ? '음성 ON' : '음성 OFF'}</span>
          </button>

          {/* 초기화 버튼 */}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleReset}
            title="대화형 스튜디오 초기화"
            style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <RotateCcw size={12} />
            <span style={{ fontSize: '11px' }}>초기화</span>
          </button>
        </div>
      </div>

      {/* 2. 단계별 프로그레스 탭 바 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '4px',
        backgroundColor: 'var(--bg-app)',
        padding: '4px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)'
      }}>
        {[
          { key: 'CUSTOMER', label: '1. 고객사' },
          { key: 'SITE', label: '2. 현장' },
          { key: 'EQUIPMENT', label: `3. 장비/수량 (${totalEquipmentQty}대)` },
          { key: 'DATETIME', label: '4. 일시' },
          { key: 'OPTIONS_NOTE', label: '5. 옵션/특이' },
          { key: 'CONFIRM', label: '6. 확인' }
        ].map((s, idx) => {
          const isActive = currentStep === s.key;
          const isDone = [
            'CUSTOMER', 'SITE', 'EQUIPMENT', 'DATETIME', 'OPTIONS_NOTE', 'CONFIRM'
          ].indexOf(currentStep) > idx;

          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setCurrentStep(s.key as StudioStep);
                if (s.key === 'CUSTOMER') speakPrompt('어느 고객사인가요? 고객사 이름을 검색하거나 말씀해주세요.');
                if (s.key === 'SITE') speakPrompt('현장명을 검색하거나 말씀해주세요.');
                if (s.key === 'EQUIPMENT') speakPrompt('출고할 장비 규격과 수량을 선택하거나 입력하세요.');
                if (s.key === 'DATETIME') speakPrompt('하차 희망 일시를 선택하거나 입력하세요.');
                if (s.key === 'OPTIONS_NOTE') speakPrompt('옵션과 특이사항을 설정하세요.');
                if (s.key === 'CONFIRM') speakPrompt('전체 내용을 확인하세요.');
              }}
              style={{
                padding: '6px 4px',
                fontSize: '11px',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#fff' : isDone ? 'var(--primary)' : 'var(--text-muted)',
                backgroundColor: isActive ? 'var(--primary)' : 'transparent',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                textAlign: 'center',
                transition: 'all 0.15s ease'
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* 3. AI 어시스턴트 질문 안내 배너 */}
      <div style={{
        padding: '10px 14px',
        borderRadius: '8px',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <div style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          backgroundColor: 'var(--primary)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <Sparkles size={15} />
        </div>
        <div style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', lineHeight: 1.4 }}>
          {assistantPrompt}
        </div>
      </div>

      {/* 3-B. 음성인식(STT) 확인 및 클릭 수정 배지 */}
      {lastSttText && (
        <div style={{
          padding: '6px 12px',
          borderRadius: '6px',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          border: '1px dashed rgba(56, 189, 248, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#38bdf8' }}>
            <Mic size={13} color="#38bdf8" />
            <span>음성 인식: <strong style={{ color: '#ffffff' }}>"{lastSttText}"</strong></span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (currentStep === 'CUSTOMER') setCustomerSearchText(lastSttText);
              if (currentStep === 'SITE') setSiteSearchText(lastSttText);
              if (currentStep === 'EQUIPMENT') setEquipmentInputText(lastSttText);
              if (currentStep === 'OPTIONS_NOTE') setSpecialMemo(lastSttText);
            }}
            style={{
              padding: '2px 8px',
              backgroundColor: 'rgba(56, 189, 248, 0.2)',
              border: '1px solid #38bdf8',
              borderRadius: '4px',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
            title="인식된 텍스트를 현재 입력창에 넣어 키보드로 수정"
          >
            클릭하여 수정
          </button>
        </div>
      )}

      {/* 4. 각 단계별 스마트 통합 컨트롤러 (빨간색 중복 바 완전 제거 & 노란색 검색창에 음성 직결) */}
      <div style={{
        padding: '12px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        minHeight: '140px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        
        {/* ── 1단계: 고객사 컨트롤러 (노란 표시 검색창 + 음성 마이크 단일 통합) ── */}
        {currentStep === 'CUSTOMER' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 통합 검색/음성 바 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={customerSearchText}
                  onChange={e => setCustomerSearchText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCustomerSubmit(customerSearchText);
                    }
                  }}
                  placeholder="거래처명 또는 초성 검색/음성 (예: ㅂㅅ, 백산, 현대)..."
                  style={{
                    width: '100%',
                    padding: '8px 12px 8px 34px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-main)'
                  }}
                  autoFocus
                />
              </div>

              {/* 음성 마이크 버튼 */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : () => startRecording('CUSTOMER')}
                title={isRecording ? '음성인식 중지' : '음성으로 거래처 입력'}
                style={{
                  padding: '8px 14px',
                  borderRadius: '6px',
                  border: '1px solid',
                  borderColor: isRecording ? '#ef4444' : 'var(--border-color)',
                  backgroundColor: isRecording ? '#ef4444' : 'var(--bg-app)',
                  color: isRecording ? '#fff' : 'var(--text-main)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}
              >
                {isRecording ? <MicOff size={14} /> : <Mic size={14} color="var(--primary)" />}
                <span>{isRecording ? '듣는중' : '음성'}</span>
              </button>
            </div>

            {/* 거래처 칩 목록 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {filteredCustomers.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelectCustomer(c)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: selectedCustomer?.id === c.id ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: selectedCustomer?.id === c.id ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-app)',
                    color: selectedCustomer?.id === c.id ? 'var(--primary)' : 'var(--text-main)',
                    fontWeight: selectedCustomer?.id === c.id ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Building2 size={12} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 2단계: 현장 컨트롤러 (현장 검색창 + 음성 마이크 단일 통합) ── */}
        {currentStep === 'SITE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {siteSubStep === 'SITE_SELECT' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    [{selectedCustomer?.name || '고객사'}] 등록 현장 목록:
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowNewSiteForm(!showNewSiteForm)}
                    style={{
                      fontSize: '11.5px',
                      color: 'var(--primary)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      fontWeight: 600
                    }}
                  >
                    <Plus size={12} /> {showNewSiteForm ? '등록 목록 보기' : '신규 현장 직접입력'}
                  </button>
                </div>

                {/* 현장 통합 검색/음성 바 */}
                {!showNewSiteForm && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                      <Search size={15} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        value={siteSearchText}
                        onChange={e => setSiteSearchText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSiteSubmit(siteSearchText);
                          }
                        }}
                        placeholder="현장명 검색 또는 초성/음성 (예: ㅍㄱ, 판교)..."
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 34px',
                          fontSize: '13px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-app)',
                          color: 'var(--text-main)'
                        }}
                        autoFocus
                      />
                    </div>

                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : () => startRecording('SITE')}
                      title={isRecording ? '음성인식 중지' : '음성으로 현장 입력'}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '6px',
                        border: '1px solid',
                        borderColor: isRecording ? '#ef4444' : 'var(--border-color)',
                        backgroundColor: isRecording ? '#ef4444' : 'var(--bg-app)',
                        color: isRecording ? '#fff' : 'var(--text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {isRecording ? <MicOff size={14} /> : <Mic size={14} color="var(--primary)" />}
                      <span>{isRecording ? '듣는중' : '음성'}</span>
                    </button>
                  </div>
                )}

                {!showNewSiteForm ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {filteredCustomerSites.length > 0 ? (
                      filteredCustomerSites.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectExistingSite(s)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            borderRadius: '6px',
                            border: selectedSite?.id === s.id ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                            backgroundColor: selectedSite?.id === s.id ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-app)',
                            color: selectedSite?.id === s.id ? 'var(--primary)' : 'var(--text-main)',
                            fontWeight: selectedSite?.id === s.id ? 700 : 500,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <MapPin size={12} />
                          <span>{s.name}</span>
                          {s.contactName && <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>({s.contactName})</span>}
                        </button>
                      ))
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px 0' }}>
                        검색 조건에 맞는 현장이 없습니다. 신규 현장을 직접 입력해주세요.
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                      type="text"
                      placeholder="신규 현장명 (예: 평택 반도체 2공구)"
                      value={manualNewSiteName}
                      onChange={e => setManualNewSiteName(e.target.value)}
                      style={{ padding: '8px 10px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="현장 주소 (예: 경기 평택시 고덕면)"
                      value={manualNewSiteAddr}
                      onChange={e => setManualNewSiteAddr(e.target.value)}
                      style={{ padding: '8px 10px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleCreateNewSite(manualNewSiteName, manualNewSiteAddr)}
                      style={{ padding: '7px 12px', fontSize: '12px', fontWeight: 700 }}
                    >
                      신규 현장 확정 및 장비 단계 이동
                    </button>
                  </div>
                )}
              </>
            )}

            {/* 담당자 능동 확인 */}
            {siteSubStep === 'CONTACT_CONFIRM' && pendingSite && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '12.5px', color: 'var(--text-main)' }}>
                  현장 담당자: <strong>{pendingSite.contactName}</strong> 님 (연락처: {pendingSite.contact || '미등록'})
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      if (pendingSite.paidOptions || pendingSite.protection) {
                        setSiteSubStep('OPTIONS_CONFIRM');
                        const optSummary = getSiteOptionsSummary(pendingSite);
                        speakPrompt(`기존 현장 옵션(${optSummary})과 동일하게 출고할까요? [동일] 또는 [변경]을 선택하세요.`);
                      } else {
                        finalizeSiteSelection(pendingSite, pendingSite.contactName || '', pendingSite.contact || '');
                      }
                    }}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [예] 동일 담당자 확정
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setSiteSubStep('CONTACT_NAME');
                      speakPrompt('새 담당자 성함을 입력해주세요.');
                    }}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [아니오] 새 담당자 입력
                  </button>
                </div>
              </div>
            )}

            {/* 새 담당자 성함 직접 입력 */}
            {siteSubStep === 'CONTACT_NAME' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="현장 담당자 성함 (예: 김철수 소장)"
                  value={siteContactName}
                  onChange={e => setSiteContactName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && siteContactName.trim()) {
                      setSiteSubStep('CONTACT_PHONE');
                      speakPrompt(`${siteContactName} 담당자님의 연락처를 입력해주세요.`);
                    }
                  }}
                  style={{ flex: 1, padding: '8px 10px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (siteContactName.trim()) {
                      setSiteSubStep('CONTACT_PHONE');
                      speakPrompt(`${siteContactName} 담당자님의 연락처를 입력해주세요.`);
                    }
                  }}
                  style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 700 }}
                >
                  다음
                </button>
              </div>
            )}

            {/* 새 담당자 연락처 직접 입력 */}
            {siteSubStep === 'CONTACT_PHONE' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="현장 담당자 연락처 (예: 010-1234-5678)"
                  value={siteContactPhone}
                  onChange={e => setSiteContactPhone(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && pendingSite) {
                      finalizeSiteSelection(pendingSite, siteContactName, siteContactPhone);
                    }
                  }}
                  style={{ flex: 1, padding: '8px 10px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (pendingSite) {
                      finalizeSiteSelection(pendingSite, siteContactName, siteContactPhone);
                    }
                  }}
                  style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 700 }}
                >
                  확정
                </button>
              </div>
            )}

            {/* 옵션 승계 능동 확인 */}
            {siteSubStep === 'OPTIONS_CONFIRM' && pendingSite && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '12.5px', color: 'var(--text-main)' }}>
                  기존 현장 옵션: <strong>{getSiteOptionsSummary(pendingSite)}</strong>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => finalizeSiteSelection(pendingSite, siteContactName || pendingSite.contactName || '', siteContactPhone || pendingSite.contact || '', true)}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [동일] 기존 옵션 100% 승계
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => finalizeSiteSelection(pendingSite, siteContactName || pendingSite.contactName || '', siteContactPhone || pendingSite.contact || '', false)}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [변경] 새 옵션 직접 설정
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 3단계: 장비/수량 컨트롤러 (복수 모델 장바구니 관리 & 음성 통합) ── */}
        {currentStep === 'EQUIPMENT' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            
            {/* 3-1. 직접 입력/음성 통합 검색 바 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={equipmentInputText}
                  onChange={e => setEquipmentInputText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleEquipmentTextInput(equipmentInputText);
                    }
                  }}
                  placeholder="규격/수량 입력 또는 음성 (예: 1930 2대, 2646 1대)..."
                  style={{
                    width: '100%',
                    padding: '8px 12px 8px 34px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-main)'
                  }}
                  autoFocus
                />
              </div>

              {/* 음성 마이크 버튼 */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : () => startRecording('EQUIPMENT')}
                title={isRecording ? '음성인식 중지' : '음성으로 장비 추가'}
                style={{
                  padding: '8px 14px',
                  borderRadius: '6px',
                  border: '1px solid',
                  borderColor: isRecording ? '#ef4444' : 'var(--border-color)',
                  backgroundColor: isRecording ? '#ef4444' : 'var(--bg-app)',
                  color: isRecording ? '#fff' : 'var(--text-main)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}
              >
                {isRecording ? <MicOff size={14} /> : <Mic size={14} color="var(--primary)" />}
                <span>{isRecording ? '듣는중' : '음성'}</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleEquipmentTextInput(equipmentInputText)}
                style={{ padding: '8px 12px', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}
              >
                <Plus size={13} /> 추가
              </button>
            </div>

            {/* 3-2. 신청 장비 목록 (장바구니 패널 - 복수 모델 가시화 및 개별 수량 증감) */}
            <div style={{
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                  📋 신청 장비 목록 (총 <strong style={{ color: 'var(--primary)' }}>{totalEquipmentQty}</strong>대)
                </span>
                {equipmentList.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearEquipments}
                    style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    전체비우기
                  </button>
                )}
              </div>

              {equipmentList.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  아래 규격 칩을 누르거나 음성으로 장비를 추가하세요.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {equipmentList.map((item, idx) => (
                    <div
                      key={`${item.modelName}-${idx}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: 'var(--bg-card)',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(59, 130, 246, 0.15)',
                          color: 'var(--primary)'
                        }}>
                          {item.ft}
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                          {item.modelName}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, item.qty - 1)}
                            style={{ padding: '4px 8px', background: 'var(--bg-app)', border: 'none', cursor: 'pointer' }}
                            title="수량 감소"
                          >
                            <Minus size={12} />
                          </button>
                          <span style={{ minWidth: '28px', textAlign: 'center', fontSize: '12px', fontWeight: 700 }}>
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, item.qty + 1)}
                            style={{ padding: '4px 8px', background: 'var(--bg-app)', border: 'none', cursor: 'pointer' }}
                            title="수량 증가"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>대</span>

                        <button
                          type="button"
                          onClick={() => handleRemoveEquipmentItem(idx)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                          title="이 장비 삭제"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3-3. 장비 규격 빠른 추가 칩 (클릭 시 1대 추가 또는 카운트 증가) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                장비 규격 빠른 추가 (클릭 시 수량 증가):
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {EQUIPMENT_SPEC_MATRIX.map(spec => {
                  const existing = equipmentList.find(e => e.modelName === spec.modelName);
                  return (
                    <button
                      key={spec.modelName}
                      type="button"
                      onClick={() => handleAddOrIncrementSpec(spec)}
                      style={{
                        padding: '6px 10px',
                        fontSize: '12px',
                        borderRadius: '6px',
                        border: existing ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: existing ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-app)',
                        color: existing ? 'var(--primary)' : 'var(--text-main)',
                        fontWeight: existing ? 700 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>{spec.ft} ({spec.modelName})</span>
                      {existing && (
                        <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 800 }}>
                          [{existing.qty}대]
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3-4. 하차일시 이동 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={equipmentList.length === 0}
                onClick={handleAdvanceToDateTime}
                style={{
                  padding: '8px 16px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: equipmentList.length === 0 ? 0.5 : 1
                }}
              >
                <span>하차일시 입력으로 이동 (총 {totalEquipmentQty}대)</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── 4단계: 일시 컨트롤러 (빠른 칩 + 피커 + 음성 마이크) ── */}
        {currentStep === 'DATETIME' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 퀵 프리셋 칩 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {[
                { label: '내일 08:00', date: defaultTomorrowStr, time: '08:00', asap: false },
                { label: '내일 07:00 (조기)', date: defaultTomorrowStr, time: '07:00', asap: false },
                { label: '오늘 긴급 (ASAP)', date: new Date().toISOString().split('T')[0], time: 'ASAP', asap: true },
                { label: '모레 08:00', date: (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0]; })(), time: '08:00', asap: false }
              ].map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleConfirmDateTime(chip.date, chip.time, chip.asap)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-app)',
                    color: chip.asap ? '#ef4444' : 'var(--text-main)',
                    fontWeight: chip.asap ? 700 : 500,
                    cursor: 'pointer'
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* 인라인 날짜/시간 피커 + 음성 마이크 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <input
                type="date"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                style={{ padding: '7px 8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
              />
              <input
                type="time"
                value={customTime}
                onChange={e => setCustomTime(e.target.value)}
                style={{ padding: '7px 8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
              />

              <button
                type="button"
                onClick={isRecording ? stopRecording : () => startRecording('DATETIME')}
                title={isRecording ? '음성인식 중지' : '음성으로 일시 입력'}
                style={{
                  padding: '7px 12px',
                  borderRadius: '4px',
                  border: '1px solid',
                  borderColor: isRecording ? '#ef4444' : 'var(--border-color)',
                  backgroundColor: isRecording ? '#ef4444' : 'var(--bg-app)',
                  color: isRecording ? '#fff' : 'var(--text-main)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}
              >
                {isRecording ? <MicOff size={13} /> : <Mic size={13} color="var(--primary)" />}
                <span>{isRecording ? '듣는중' : '음성'}</span>
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={() => handleConfirmDateTime(customDate, customTime, false)}
                style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 700 }}
              >
                일시 확정 및 옵션 이동 ➔
              </button>
            </div>
          </div>
        )}

        {/* ── 5단계: 옵션/특이사항 컨트롤러 ── */}
        {currentStep === 'OPTIONS_NOTE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 유상 옵션 토글 칩 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {['철망', '함석', '인버터', '러그타이어', '에어배관', '상부센서'].map(opt => {
                const isSelected = paidOptions.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleOption(opt)}
                    style={{
                      padding: '5px 10px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-app)',
                      color: isSelected ? 'var(--primary)' : 'var(--text-main)',
                      fontWeight: isSelected ? 700 : 500,
                      cursor: 'pointer'
                    }}
                  >
                    {opt} {isSelected ? '✓' : ''}
                  </button>
                );
              })}
            </div>

            {/* 운송비 귀속선 토글 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>운송비:</span>
              <button
                type="button"
                onClick={() => {
                  const next = !billableToCustomer;
                  setBillableToCustomer(next);
                  syncCurrentData({ billableToCustomer: next });
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: '11.5px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: billableToCustomer ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                  color: billableToCustomer ? '#ef4444' : '#16a34a',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {billableToCustomer ? '고객 청구' : '당사 부담'}
              </button>
            </div>

            {/* 특이사항 메모 인라인 + 음성 마이크 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="배차/현장 특이사항 (예: 진입로 좁음, 사다리차 필요)..."
                value={specialMemo}
                onChange={e => {
                  setSpecialMemo(e.target.value);
                  syncCurrentData({ memo: e.target.value });
                }}
                style={{ flex: 1, padding: '7px 10px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
              />

              <button
                type="button"
                onClick={isRecording ? stopRecording : () => startRecording('OPTIONS_NOTE')}
                title={isRecording ? '음성인식 중지' : '음성으로 메모 입력'}
                style={{
                  padding: '7px 12px',
                  borderRadius: '4px',
                  border: '1px solid',
                  borderColor: isRecording ? '#ef4444' : 'var(--border-color)',
                  backgroundColor: isRecording ? '#ef4444' : 'var(--bg-app)',
                  color: isRecording ? '#fff' : 'var(--text-main)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}
              >
                {isRecording ? <MicOff size={13} /> : <Mic size={13} color="var(--primary)" />}
                <span>{isRecording ? '듣는중' : '음성'}</span>
              </button>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={handleFinishOptions}
              style={{ padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, alignSelf: 'flex-end' }}
            >
              확인 단계로 이동 ➔
            </button>
          </div>
        )}

        {/* ── 6단계: 확인 & 옵션 변경 분기 컨트롤러 ── */}
        {currentStep === 'CONFIRM' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 옵션 변경 감지 패널 */}
            {isOptionsDiff && (
              <div style={{
                padding: '10px',
                borderRadius: '6px',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#d97706', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={13} /> 현장 기억 옵션과 변경점이 감지되었습니다.
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveOptionsToSite(true);
                      syncCurrentData({ saveOptionsToSite: true });
                    }}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      borderRadius: '4px',
                      border: saveOptionsToSite ? '1px solid #16a34a' : '1px solid var(--border-color)',
                      backgroundColor: saveOptionsToSite ? 'rgba(22, 163, 74, 0.15)' : 'var(--bg-app)',
                      color: saveOptionsToSite ? '#16a34a' : 'var(--text-main)',
                      cursor: 'pointer'
                    }}
                  >
                    🟢 현장 기본값 저장 (유지)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveOptionsToSite(false);
                      syncCurrentData({ saveOptionsToSite: false });
                    }}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      borderRadius: '4px',
                      border: !saveOptionsToSite ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                      backgroundColor: !saveOptionsToSite ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-app)',
                      color: !saveOptionsToSite ? 'var(--primary)' : 'var(--text-main)',
                      cursor: 'pointer'
                    }}
                  >
                    🔵 이번만 1회성 적용 (보존)
                  </button>
                </div>
              </div>
            )}

            <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={13} /> 우측 폼에 모든 정보가 실시간 동기화되었습니다. 우측 상단의 [출고지시] 버튼으로 저장하세요.
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
