// src/components/SmartDispatchConversationalStudio.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Mic, MicOff, Volume2, VolumeX, Send, RotateCcw,
  Building2, MapPin, Sparkles, 
  Plus, Minus, Search, CheckCircle2, AlertTriangle, ArrowRight
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ttsService } from '../services/ttsService';
import { Customer, CustomerSite } from '../services/db';
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
  ParsedEquipmentResult,
  ParsedDateTimeResult
} from '../services/voiceOrderDraftService';

export type StudioStep = 'CUSTOMER' | 'SITE' | 'EQUIPMENT' | 'DATETIME' | 'OPTIONS_NOTE' | 'CONFIRM';
export type StudioSiteSubStep = 'SITE_SELECT' | 'CONTACT_CONFIRM' | 'CONTACT_NAME' | 'CONTACT_PHONE' | 'OPTIONS_CONFIRM';

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
  const [equipmentResult, setEquipmentResult] = useState<ParsedEquipmentResult | null>(null);
  const [dateTimeResult, setDateTimeResult] = useState<ParsedDateTimeResult | null>(null);

  const [paidOptions, setPaidOptions] = useState<string>('');
  const [protection, setProtection] = useState<string>('');
  const [checkedSpecs, setCheckedSpecs] = useState<Record<string, boolean>>({});
  const [saveOptionsToSite, setSaveOptionsToSite] = useState<boolean>(true);
  const [billableToCustomer, setBillableToCustomer] = useState<boolean>(false);
  const [closingDay, setClosingDay] = useState<string>('');
  const [paymentDay, setPaymentDay] = useState<string>('');
  const [specialMemo, setSpecialMemo] = useState<string>('');

  // 4. 입력창 및 음성 인식 상태
  const [textInput, setTextInput] = useState<string>('');
  const [assistantPrompt, setAssistantPrompt] = useState<string>('어느 고객사인가요? 고객사 이름을 입력하거나 말씀해주세요.');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [customerSearchText, setCustomerSearchText] = useState<string>('');
  const [showNewSiteForm, setShowNewSiteForm] = useState<boolean>(false);
  const [manualNewSiteName, setManualNewSiteName] = useState<string>('');
  const [manualNewSiteAddr, setManualNewSiteAddr] = useState<string>('');

  // 5. 터치/클릭 컨트롤러 상태
  const [selectedFt, setSelectedFt] = useState<string>('19ft');
  const [selectedModel, setSelectedModel] = useState<string>('GS-1930');
  const [selectedQty, setSelectedQty] = useState<number>(1);

  const defaultTomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);
  const [customDate, setCustomDate] = useState<string>(defaultTomorrowStr);
  const [customTime, setCustomTime] = useState<string>('08:00');

  const recognitionRef = useRef<any>(null);

  // 옵션 변경 감지
  const isOptionsDiff = useMemo(() => {
    const targetSite = selectedSite || pendingSite;
    return isOptionsChangedFromSite(targetSite, paidOptions, protection, checkedSpecs);
  }, [selectedSite, pendingSite, paidOptions, protection, checkedSpecs]);

  // 고객사 필터
  const filteredCustomers = useMemo(() => {
    if (!customerSearchText.trim()) return (customers || []).slice(0, 8);
    const q = customerSearchText.trim().toLowerCase();
    return (customers || []).filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.representative && c.representative.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [customers, customerSearchText]);

  // 고객사의 현장 목록
  const customerSites = useMemo(() => {
    if (!selectedCustomer) return [];
    return (sites || []).filter(s => s.customerId === selectedCustomer.id);
  }, [sites, selectedCustomer]);

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
    setEquipmentResult(null);
    setDateTimeResult(null);
    setPaidOptions('');
    setProtection('');
    setCheckedSpecs({});
    setSaveOptionsToSite(true);
    setBillableToCustomer(false);
    setClosingDay('');
    setPaymentDay('');
    setSpecialMemo('');
    setTextInput('');
    setCustomerSearchText('');
    setShowNewSiteForm(false);
    setSelectedFt('19ft');
    setSelectedModel('GS-1930');
    setSelectedQty(1);
    setCustomDate(defaultTomorrowStr);
    setCustomTime('08:00');

    speakPrompt('어느 고객사인가요? 고객사 이름을 입력하거나 말씀해주세요.');
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
      equipments: (equipmentResult && equipmentResult.orders && equipmentResult.orders.length > 0)
        ? equipmentResult.orders.map(o => ({ modelName: o.modelName, qty: o.count })) 
        : [{ modelName: selectedModel, qty: selectedQty }],
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
    const closing = customer.defaultBillingDay ? (customer.defaultBillingDay === 30 || customer.defaultBillingDay === 31 ? '말일' : `${customer.defaultBillingDay}일`) : '';
    const payment = customer.paymentDueDay ? `익월 ${customer.paymentDueDay}일` : '';
    const defPaid = customer.defaultPaidOptions || '';
    const defProt = customer.defaultProtection || '';
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
    speakPrompt(`${customer.name}의 현장명을 입력하거나 선택해주세요.`);
  };

  // 2단계: 현장 선택 및 능동 확인 핸들러
  const handleSelectExistingSite = (site: CustomerSite) => {
    setPendingSite(site);
    setSelectedSite(site);
    setNewSiteName(site.name);
    setSiteAddress(site.address || '');

    const hasContact = !!(site.contactName && site.contact);
    const hasOptions = !!((site.paidOptions && site.paidOptions.trim()) || (site.protection && site.protection.trim()));

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

  const handleCreateNewSite = (name: string, address: string) => {
    if (!name.trim()) return;
    setSelectedSite(null);
    setPendingSite(null);
    setNewSiteName(name.trim());
    setSiteAddress(address.trim());
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

  // 3단계: 장비 선택 및 수량 확정
  const handleConfirmEquipment = (model: string, qty: number, ft: string) => {
    const matchedItem = EQUIPMENT_SPEC_MATRIX.find(m => m.modelName === model) || EQUIPMENT_SPEC_MATRIX[0];
    const order = { ft, modelName: model, count: qty };
    const result: ParsedEquipmentResult = {
      order,
      orders: [order],
      matchedItem,
      confirmedDescription: `${model} ${qty}대`
    };
    setEquipmentResult(result);

    syncCurrentData({
      equipments: [{ modelName: model, qty }]
    });

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
    let currentArr = paidOptions.split(',').map(s => s.trim()).filter(Boolean);
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

  // 텍스트 전송 및 자연어 파싱 핸들러 (키보드 Enter 지원)
  const handleSendText = (textToSend?: string) => {
    const raw = (textToSend !== undefined ? textToSend : textInput).trim();
    if (!raw) return;
    setTextInput('');

    // 1단계: 고객사
    if (currentStep === 'CUSTOMER') {
      const matched = parseCustomerVoiceInput(raw, customers || []);
      if (matched) {
        handleSelectCustomer(matched);
      } else {
        speakPrompt(`'${raw}' 거래처를 찾지 못했습니다. 목록에서 직접 선택하거나 다시 입력해주세요.`);
      }
      return;
    }

    // 2단계: 현장
    if (currentStep === 'SITE') {
      if (siteSubStep === 'SITE_SELECT') {
        const matched = parseSiteVoiceInput(raw, customerSites);
        if (matched?.site) {
          handleSelectExistingSite(matched.site);
        } else if (matched?.isNew && matched?.newSiteName) {
          handleCreateNewSite(matched.newSiteName, matched.extractedAddress || '');
        } else {
          speakPrompt('현장명을 찾지 못했습니다. 목록에서 선택하거나 신규 현장으로 입력해주세요.');
        }
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
          speakPrompt('현장 담당자님의 성함을 입력하거나 말씀해주세요.');
        }
      } else if (siteSubStep === 'CONTACT_NAME') {
        const name = parseContactNameVoiceInput(raw);
        setSiteContactName(name || raw);
        setSiteSubStep('CONTACT_PHONE');
        speakPrompt(`${name || raw} 담당자님의 연락처를 입력하거나 말씀해주세요.`);
      } else if (siteSubStep === 'CONTACT_PHONE') {
        const phone = parseContactPhoneVoiceInput(raw);
        setSiteContactPhone(phone || raw);
        if (pendingSite && (pendingSite.paidOptions || pendingSite.protection)) {
          setSiteSubStep('OPTIONS_CONFIRM');
          const optSummary = getSiteOptionsSummary(pendingSite);
          speakPrompt(`기존 현장 옵션(${optSummary})과 동일하게 출고할까요? [동일] 또는 [변경]을 선택하세요.`);
        } else if (pendingSite) {
          finalizeSiteSelection(pendingSite, siteContactName, phone || raw);
        }
      } else if (siteSubStep === 'OPTIONS_CONFIRM') {
        const yn = parseYesNoVoiceInput(raw);
        if (pendingSite) {
          finalizeSiteSelection(pendingSite, siteContactName || pendingSite.contactName || '', siteContactPhone || pendingSite.contact || '', yn !== false);
        }
      }
      return;
    }

    // 3단계: 장비
    if (currentStep === 'EQUIPMENT') {
      const eq = parseEquipmentVoiceInput(raw);
      if (eq && eq.orders && eq.orders.length > 0) {
        setEquipmentResult(eq);
        setSelectedModel(eq.orders[0].modelName);
        setSelectedQty(eq.orders[0].count);
        setSelectedFt(eq.orders[0].ft);
        syncCurrentData({
          equipments: eq.orders.map(o => ({ modelName: o.modelName, qty: o.count }))
        });
        setCurrentStep('DATETIME');
        speakPrompt('하차 희망 일시를 선택하거나 말씀해주세요.');
      } else {
        speakPrompt('장비 규격과 대수를 인식하지 못했습니다. 규격 칩을 누르시거나 다시 입력해주세요.');
      }
      return;
    }

    // 4단계: 일시
    if (currentStep === 'DATETIME') {
      const dt = parseDateTimeVoiceInput(raw);
      if (dt) {
        handleConfirmDateTime(dt.date, dt.time, dt.isAsap);
      } else {
        speakPrompt('일시를 인식하지 못했습니다. 빠른 선택 칩을 누르시거나 직접 입력해주세요.');
      }
      return;
    }

    // 5단계: 옵션/특이
    if (currentStep === 'OPTIONS_NOTE') {
      const parsed = parseOptionsAndSpecsVoiceInput(raw);
      const logi = parseLogisticsAndBillingVoiceInput(raw);
      if (parsed.paidOptions) setPaidOptions(parsed.paidOptions);
      if (parsed.protection) setProtection(parsed.protection);
      if (Object.keys(parsed.checkedSpecs).length > 0) setCheckedSpecs(prev => ({ ...prev, ...parsed.checkedSpecs }));
      if (logi.billableToCustomer !== undefined) setBillableToCustomer(logi.billableToCustomer);

      handleFinishOptions();
      return;
    }

    // 6단계: 확인
    if (currentStep === 'CONFIRM') {
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

  // 브라우저 음성인식 (STT)
  const startRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speakPrompt('이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트 입력창을 사용해주세요.');
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
          setTextInput(text);
          handleSendText(text);
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
      
      {/* 1. 상단 스튜디오 헤더 & 진행 단계 인디케이터 */}
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
            음성/키보드로 입력하면 우측 폼에 실시간 반영됩니다.
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
          { key: 'EQUIPMENT', label: '3. 장비/수량' },
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
                if (s.key === 'CUSTOMER') speakPrompt('어느 고객사인가요? 고객사 이름을 선택하거나 입력하세요.');
                if (s.key === 'SITE') speakPrompt('현장명을 선택하거나 입력하세요.');
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

      {/* 4. 입력 도구: 텍스트 입력창 + 음성 마이크 + 전송 버튼 (상하 스택 3.4 준수) */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="text"
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSendText();
            }
          }}
          placeholder="키보드로 입력 후 Enter 또는 전송 (예: 현대건설, 10미터 2대, 내일 아침 8시)..."
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '13px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)'
          }}
        />

        {/* 음성 마이크 버튼 */}
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          title={isRecording ? '음성인식 중지' : '음성인식 시작'}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: isRecording ? '#ef4444' : 'var(--bg-card)',
            color: isRecording ? '#fff' : 'var(--text-main)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: isRecording ? '#ef4444' : 'var(--border-color)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }}
        >
          {isRecording ? <MicOff size={14} /> : <Mic size={14} color="var(--primary)" />}
          <span>{isRecording ? '듣는중' : '음성'}</span>
        </button>

        {/* 전송 버튼 */}
        <button
          type="button"
          className="btn-primary"
          onClick={() => handleSendText()}
          style={{
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            whiteSpace: 'nowrap'
          }}
        >
          <Send size={13} />
          <span>전송</span>
        </button>
      </div>

      {/* 5. 각 단계별 스마트 인터랙티브 컨트롤러 */}
      <div style={{
        padding: '12px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        minHeight: '130px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        
        {/* ── 1단계: 고객사 컨트롤러 ── */}
        {currentStep === 'CUSTOMER' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={customerSearchText}
                  onChange={e => setCustomerSearchText(e.target.value)}
                  placeholder="거래처 검색 필터..."
                  style={{
                    width: '100%',
                    padding: '6px 10px 6px 30px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-main)'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {filteredCustomers.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelectCustomer(c)}
                  style={{
                    padding: '5px 10px',
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

        {/* ── 2단계: 현장 컨트롤러 ── */}
        {currentStep === 'SITE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

                {!showNewSiteForm ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {customerSites.length > 0 ? (
                      customerSites.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectExistingSite(s)}
                          style={{
                            padding: '6px 10px',
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
                        등록된 현장이 없습니다. 신규 현장을 입력해주세요.
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
                      style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                    />
                    <input
                      type="text"
                      placeholder="현장 주소 (예: 경기 평택시 고덕면)"
                      value={manualNewSiteAddr}
                      onChange={e => setManualNewSiteAddr(e.target.value)}
                      style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleCreateNewSite(manualNewSiteName, manualNewSiteAddr)}
                      style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700 }}
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
                    onClick={() => handleSendText('네')}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [예] 동일 담당자 확정
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleSendText('아니오')}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [아니오] 새 담당자 입력
                  </button>
                </div>
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
                    onClick={() => handleSendText('동일')}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [동일] 기존 옵션 100% 승계
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleSendText('변경')}
                    style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700 }}
                  >
                    [변경] 새 옵션 직접 설정
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 3단계: 장비/수량 컨트롤러 ── */}
        {currentStep === 'EQUIPMENT' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 규격 칩 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {EQUIPMENT_SPEC_MATRIX.map(item => (
                <button
                  key={item.modelName}
                  type="button"
                  onClick={() => {
                    setSelectedFt(item.ft);
                    setSelectedModel(item.modelName);
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: selectedModel === item.modelName ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: selectedModel === item.modelName ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-app)',
                    color: selectedModel === item.modelName ? 'var(--primary)' : 'var(--text-main)',
                    fontWeight: selectedModel === item.modelName ? 700 : 500,
                    cursor: 'pointer'
                  }}
                >
                  <strong>{item.ft}</strong> ({item.modelName})
                </button>
              ))}
            </div>

            {/* 수량 카운터 및 확정 버튼 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>수량:</span>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedQty(Math.max(1, selectedQty - 1))}
                    style={{ padding: '6px 10px', background: 'var(--bg-app)', border: 'none', cursor: 'pointer' }}
                  >
                    <Minus size={13} />
                  </button>
                  <span style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 700, minWidth: '32px', textAlign: 'center' }}>
                    {selectedQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedQty(selectedQty + 1)}
                    style={{ padding: '6px 10px', background: 'var(--bg-app)', border: 'none', cursor: 'pointer' }}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>대</span>
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={() => handleConfirmEquipment(selectedModel, selectedQty, selectedFt)}
                style={{
                  padding: '7px 14px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>선택 반영 및 일시 이동</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        )}

        {/* ── 4단계: 일시 컨트롤러 ── */}
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

            {/* 인라인 날짜/시간 피커 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <input
                type="date"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
              />
              <input
                type="time"
                value={customTime}
                onChange={e => setCustomTime(e.target.value)}
                style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleConfirmDateTime(customDate, customTime, false)}
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700 }}
              >
                일시 확정
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

            {/* 특이사항 메모 인라인 */}
            <input
              type="text"
              placeholder="배차/현장 특이사항 (예: 진입로 좁음, 사다리차 필요)..."
              value={specialMemo}
              onChange={e => {
                setSpecialMemo(e.target.value);
                syncCurrentData({ memo: e.target.value });
              }}
              style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
            />

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
