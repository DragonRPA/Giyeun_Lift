// src/mobile/components/VoiceGuideWizardModal.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Mic, MicOff, Volume2, VolumeX, X, Check, ChevronRight, 
  RotateCcw, Sparkles, Building2, MapPin, Layers, Clock, ArrowRight, AlertTriangle,
  Edit3, Search, Plus, Minus, FileText, Calendar, CornerDownLeft
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ttsService } from '../../services/ttsService';
import { Customer, CustomerSite } from '../../services/db';
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
} from '../../services/voiceOrderDraftService';

export type WizardStep = 'CUSTOMER' | 'SITE' | 'EQUIPMENT' | 'DATETIME' | 'OPTIONS_NOTE' | 'CONFIRM';
export type SiteSubStep = 'SITE_SELECT' | 'CONTACT_CONFIRM' | 'CONTACT_NAME' | 'CONTACT_PHONE' | 'OPTIONS_CONFIRM';

export interface VoiceGuideWizardCompleteData {
  customerId: string;
  customerName: string;
  siteId: string;
  siteName: string;
  newSiteName: string;
  siteAddress: string;
  siteContactName: string;
  siteContactPhone: string;
  deliveryDate: string;
  deliveryTime: string;
  orders: { ft: string; modelName: string; count: number }[];
  memo: string;
  paidOptions: string;
  protection: string;
  checkedSpecs: Record<string, boolean>;
  saveOptionsToSite?: boolean; // 🌟 옵션 변경 시 현장 마스터 저장 여부 (false: 1회성 적용)
  billableToCustomer: boolean;
  closingDay: string;
  paymentDay: string;
  vehicleType: string;
  isAsap: boolean;
  isPartialHandOff?: boolean; // 🌟 작성 중 일반 폼으로 핸드오프 전환 여부
}

interface VoiceGuideWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: VoiceGuideWizardCompleteData) => void;
}

export const VoiceGuideWizardModal: React.FC<VoiceGuideWizardModalProps> = ({
  isOpen,
  onClose,
  onComplete
}) => {
  const { customers, sites, currentUser } = useApp();

  // 1. 현재 위자드 단계
  const [currentStep, setCurrentStep] = useState<WizardStep>('CUSTOMER');
  const [siteSubStep, setSiteSubStep] = useState<SiteSubStep>('SITE_SELECT');
  const [pendingSite, setPendingSite] = useState<CustomerSite | null>(null);

  // 2. TTS 음성 안내 ON/OFF 상태
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => ttsService.getIsEnabled());

  // 3. 각 단계별 수집된 데이터 상태
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSite, setSelectedSite] = useState<CustomerSite | null>(null);
  const [newSiteName, setNewSiteName] = useState<string>('');
  const [siteAddress, setSiteAddress] = useState<string>('');
  const [siteContactName, setSiteContactName] = useState<string>('');
  const [siteContactPhone, setSiteContactPhone] = useState<string>('');
  const [equipmentResult, setEquipmentResult] = useState<ParsedEquipmentResult | null>(null);
  const [dateTimeResult, setDateTimeResult] = useState<ParsedDateTimeResult | null>(null);

  // 전체 출고의뢰 구조 확장 필드 (8대 도메인)
  const [paidOptions, setPaidOptions] = useState<string>('');
  const [protection, setProtection] = useState<string>('');
  const [checkedSpecs, setCheckedSpecs] = useState<Record<string, boolean>>({});
  const [saveOptionsToSite, setSaveOptionsToSite] = useState<boolean>(true); // 🌟 변경된 옵션을 현장 기본값으로 저장할지 여부
  const [billableToCustomer, setBillableToCustomer] = useState<boolean>(false);
  const [closingDay, setClosingDay] = useState<string>('');
  const [paymentDay, setPaymentDay] = useState<string>('');
  const [vehicleType, setVehicleType] = useState<string>('5톤 렉카');
  const [specialMemo, setSpecialMemo] = useState<string>('');

  // 🌟 기존 현장 옵션과 현재 입력된 옵션 간 차이 발생 여부 실시간 감지
  const isOptionsDiff = useMemo(() => {
    const targetSite = selectedSite || pendingSite;
    return isOptionsChangedFromSite(targetSite, paidOptions, protection, checkedSpecs);
  }, [selectedSite, pendingSite, paidOptions, protection, checkedSpecs]);

  // 긴급 발화 확인 대기 상태 ("시간 무관하게 가장 빨리로 접수할까요?" 질문 중)
  const [isAwaitingAsapConfirmation, setIsAwaitingAsapConfirmation] = useState<boolean>(false);
  const [pendingAsapDate, setPendingAsapDate] = useState<string>('');

  // 4. 녹음 및 STT 상태
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [recognizedText, setRecognizedText] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // 5. 음성-터치 하이브리드 인터리빙(Hybrid Interleaving) 상태
  const defaultTomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

  const [isEditingText, setIsEditingText] = useState<boolean>(false);
  const [editingTextValue, setEditingTextValue] = useState<string>('');
  const [customerSearchText, setCustomerSearchText] = useState<string>('');
  const [touchEquipmentFt, setTouchEquipmentFt] = useState<string>('19ft');
  const [touchEquipmentModel, setTouchEquipmentModel] = useState<string>('GS-1930');
  const [touchEquipmentQty, setTouchEquipmentQty] = useState<number>(1);
  const [touchCustomDate, setTouchCustomDate] = useState<string>(defaultTomorrowStr);
  const [touchCustomTime, setTouchCustomTime] = useState<string>('08:00');
  const [showNewSiteForm, setShowNewSiteForm] = useState<boolean>(false);
  const [manualNewSiteName, setManualNewSiteName] = useState<string>('');
  const [manualNewSiteAddr, setManualNewSiteAddr] = useState<string>('');
  const [manualContactInput, setManualContactInput] = useState<string>('');
  const [manualPhoneInput, setManualPhoneInput] = useState<string>('');
  const [manualMemoInput, setManualMemoInput] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null); // 브라우저 STT 폴백용

  // 고객사 실시간 필터 목록
  const filteredCustomers = useMemo(() => {
    if (!customerSearchText.trim()) return customers || [];
    const q = customerSearchText.trim().toLowerCase();
    return (customers || []).filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.representative && c.representative.toLowerCase().includes(q))
    );
  }, [customers, customerSearchText]);

  // TTS 상태 구독
  useEffect(() => {
    return ttsService.onEnabledChange((enabled) => {
      setTtsEnabled(enabled);
    });
  }, []);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
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
      setBillableToCustomer(false);
      setClosingDay('');
      setPaymentDay('');
      setVehicleType('5톤 렉카');
      setSpecialMemo('');
      setIsAwaitingAsapConfirmation(false);
      setRecognizedText('');
      setStatusMessage('');

      // 하이브리드 인터리빙 상태 초기화
      setIsEditingText(false);
      setEditingTextValue('');
      setCustomerSearchText('');
      setTouchEquipmentFt('19ft');
      setTouchEquipmentModel('GS-1930');
      setTouchEquipmentQty(1);
      setTouchCustomDate(defaultTomorrowStr);
      setTouchCustomTime('08:00');
      setShowNewSiteForm(false);
      setManualNewSiteName('');
      setManualNewSiteAddr('');
      setManualContactInput('');
      setManualPhoneInput('');
      setManualMemoInput('');

      guideCurrentStep('CUSTOMER');
    } else {
      stopRecording();
      ttsService.stop();
    }
  }, [isOpen]);

  // 각 단계별 질문 안내 (화면 텍스트 + TTS 음성)
  const guideCurrentStep = (step: WizardStep, customPrompt?: string) => {
    let prompt = customPrompt || '';

    if (!prompt) {
      switch (step) {
        case 'CUSTOMER':
          prompt = '어느 고객사인가요? 고객사 이름을 말씀해주세요.';
          break;
        case 'SITE':
          prompt = `${selectedCustomer?.name || '해당 고객사'}의 현장명을 말씀해주세요.`;
          break;
        case 'EQUIPMENT':
          prompt = '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.';
          break;
        case 'DATETIME':
          prompt = '하차 희망 일시를 말씀해주세요.';
          break;
        case 'OPTIONS_NOTE':
          prompt = '철망, 보양, 운송비나 현장 특이사항이 있나요? 없으면 건너뛰기를 누르세요.';
          break;
        case 'CONFIRM':
          prompt = '입력된 출고 의뢰 전체 내용을 확인 후 접수해주세요.';
          break;
      }
    }

    setStatusMessage(prompt);
    if (ttsService.getIsEnabled()) {
      ttsService.speak(prompt);
    }
  };

  // ── 🖐️ 터치 선택/수정 핸들러군 (하이브리드 인터리빙) ──
  // 1) 고객사 터치 선택
  const handleTouchSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    if (customer.defaultBillingDay) setClosingDay(customer.defaultBillingDay === 30 || customer.defaultBillingDay === 31 ? '말일' : `${customer.defaultBillingDay}일`);
    if (customer.paymentDueDay) setPaymentDay(`익월 ${customer.paymentDueDay}일`);
    if (customer.defaultPaidOptions) setPaidOptions(customer.defaultPaidOptions);
    if (customer.defaultProtection) setProtection(customer.defaultProtection);
    if (customer.defaultCheckedSpecs) setCheckedSpecs(customer.defaultCheckedSpecs);

    setRecognizedText(customer.name);
    setStatusMessage(`고객사: [${customer.name}] 선택 완료.`);
    setTimeout(() => {
      setCurrentStep('SITE');
      setSiteSubStep('SITE_SELECT');
      guideCurrentStep('SITE', `${customer.name}의 현장명을 말씀해주세요.`);
    }, 800);
  };

  // 2) 신규 현장 직접 등록
  const handleTouchSubmitNewSite = () => {
    if (!manualNewSiteName.trim()) return;
    const sName = manualNewSiteName.trim();
    setNewSiteName(sName);
    setSelectedSite(null);
    setPendingSite(null);
    if (manualNewSiteAddr.trim()) setSiteAddress(manualNewSiteAddr.trim());
    if (manualContactInput.trim()) setSiteContactName(manualContactInput.trim());
    if (manualPhoneInput.trim()) setSiteContactPhone(manualPhoneInput.trim());

    setRecognizedText(sName);
    setStatusMessage(`신규 현장: [${sName}] 등록 완료.`);
    setShowNewSiteForm(false);
    setTimeout(() => {
      setCurrentStep('EQUIPMENT');
      guideCurrentStep('EQUIPMENT', '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.');
    }, 800);
  };

  // 3) 장비/대수 터치 확정
  const handleTouchSelectEquipment = (ft: string, model: string, count: number) => {
    const matchedItem = EQUIPMENT_SPEC_MATRIX.find(m => m.ft === ft || m.modelName === model);
    const confirmedDescription = `${matchedItem?.manufacturer || ''} ${model} ${count}대`.trim();
    const eqResult: ParsedEquipmentResult = {
      orders: [{ ft, modelName: model, count }],
      order: { ft, modelName: model, count },
      matchedItem: matchedItem || EQUIPMENT_SPEC_MATRIX[0],
      confirmedDescription
    };
    setEquipmentResult(eqResult);
    setRecognizedText(confirmedDescription);
    setStatusMessage(`장비: [${confirmedDescription}] 지정 완료.`);
    setTimeout(() => {
      setCurrentStep('DATETIME');
      guideCurrentStep('DATETIME', '하차 희망 일시를 말씀해주세요.');
    }, 800);
  };

  // 4) 하차일시 터치 확정
  const handleTouchSelectDateTime = (dateStr: string, timeStr: string, isAsap: boolean = false) => {
    const dtResult: ParsedDateTimeResult = {
      date: dateStr,
      time: isAsap ? 'ASAP' : timeStr,
      isAsap,
      confirmQuestion: '',
      displayText: isAsap ? `${dateStr} [긴급 최우선 배차(ASAP)]` : `${dateStr} ${timeStr}`
    };
    setDateTimeResult(dtResult);
    setRecognizedText(dtResult.displayText);
    setStatusMessage(`하차일시: [${dtResult.displayText}] 지정 완료.`);
    setTimeout(() => {
      setCurrentStep('OPTIONS_NOTE');
      guideCurrentStep('OPTIONS_NOTE', '철망, 보양, 운송비나 현장 특이사항이 있나요? 없으면 건너뛰기를 누르세요.');
    }, 800);
  };

  // 5) 일반 서식으로 안전 전환 (Safe Hand-off)
  const handleHandOffToForm = () => {
    const finalSiteAddress = siteAddress || selectedSite?.address || selectedCustomer?.address || manualNewSiteAddr || '';
    const finalContactName = siteContactName || selectedSite?.contactName || manualContactInput || '';
    const finalContactPhone = siteContactPhone || selectedSite?.contact || manualPhoneInput || '';

    const payload: VoiceGuideWizardCompleteData = {
      customerId: selectedCustomer?.id || '',
      customerName: selectedCustomer?.name || '',
      siteId: selectedSite?.id || (newSiteName || manualNewSiteName ? 'NEW' : ''),
      siteName: selectedSite?.name || newSiteName || manualNewSiteName || '',
      newSiteName: newSiteName || manualNewSiteName || '',
      siteAddress: finalSiteAddress,
      siteContactName: finalContactName,
      siteContactPhone: finalContactPhone,
      deliveryDate: dateTimeResult?.date || touchCustomDate || defaultTomorrowStr,
      deliveryTime: dateTimeResult?.time === 'ASAP' ? '07:00' : (dateTimeResult?.time || touchCustomTime || '08:00'),
      orders: equipmentResult?.orders && equipmentResult.orders.length > 0
        ? equipmentResult.orders
        : (equipmentResult?.order ? [equipmentResult.order] : [{ ft: touchEquipmentFt, modelName: touchEquipmentModel, count: touchEquipmentQty }]),
      memo: specialMemo || manualMemoInput || '',
      paidOptions,
      protection,
      checkedSpecs,
      saveOptionsToSite,
      billableToCustomer,
      closingDay: closingDay || '',
      paymentDay: paymentDay || '',
      vehicleType,
      isAsap: !!dateTimeResult?.isAsap,
      isPartialHandOff: true
    };

    onComplete(payload);
    onClose();
  };

  // ── 🎙️ 녹음 시작 ──
  const startRecording = async () => {
    if (isRecording || isProcessing) return;
    setRecognizedText('');

    try {
      // 1. 오디오 스트림 획득 (노이즈 캔슬링 및 에코 억제 명시적 적용)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      streamRef.current = stream;

      // 2. MediaRecorder 지원 확인
      if (typeof MediaRecorder !== 'undefined') {
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const candidates = isSafari
          ? ['audio/mp4', 'audio/aac']
          : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
        const mimeType = candidates.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';

        audioChunksRef.current = [];
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        setStatusMessage('말씀해 주세요... (듣는 중)');
      } else {
        // 브라우저 Web Speech API 폴백
        startBrowserSttFallback();
      }
    } catch (err: any) {
      console.warn('Microphone stream error, fallback to Web Speech:', err);
      startBrowserSttFallback();
    }
  };

  // 브라우저 STT 폴백
  const startBrowserSttFallback = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatusMessage('음성인식을 지원하지 않는 브라우저입니다. 직접 텍스트로 입력해주세요.');
      return;
    }
    try {
      const rec = new SpeechRecognition();
      rec.lang = 'ko-KR';
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        handleRecognizedText(text);
      };
      rec.onerror = (e: any) => {
        setIsRecording(false);
        setStatusMessage('음성을 인식하지 못했습니다. 다시 말씀해주세요.');
      };
      rec.onend = () => {
        setIsRecording(false);
      };
      rec.start();
      recognitionRef.current = rec;
      setIsRecording(true);
      setStatusMessage('말씀해 주세요... (브라우저 STT)');
    } catch (e) {
      setIsRecording(false);
      setStatusMessage('마이크 시작 실패');
    }
  };

  // ── 🛑 녹음 종료 및 Groq Whisper STT 호출 ──
  const stopRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
      return;
    }

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return;
    }

    setIsProcessing(true);
    setStatusMessage('음성을 분석하고 있습니다...');

    mediaRecorderRef.current.onstop = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }

        const mime = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mime });

        if (blob.size < 200) {
          setIsProcessing(false);
          setStatusMessage('음성이 너무 짧습니다. 다시 말씀해주세요.');
          return;
        }

        // Blob -> Base64
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          await sendToGroqStt(base64Audio, mime);
        };
      } catch (err) {
        console.error('Stop recording error:', err);
        setIsProcessing(false);
        setStatusMessage('오디오 처리 오류가 발생했습니다.');
      }
    };

    mediaRecorderRef.current.stop();
  };

  // ── ⚡ Groq Whisper STT API 호출 (단계별 초정밀 힌트 주입) ──
  const sendToGroqStt = async (base64Data: string, mimeType: string) => {
    try {
      // 단계별 초정밀 프롬프트 힌트 구성
      let stepPrompt = '고소작업대 렌탈 출고의뢰.';
      if (currentStep === 'CUSTOMER') {
        const topCustNames = (customers || []).slice(0, 15).map(c => c.name).join(', ');
        stepPrompt = `고객사 거래처 이름. 예: ${topCustNames}`;
      } else if (currentStep === 'SITE') {
        const candidateSites = selectedCustomer 
          ? sites.filter(s => s.customerId === selectedCustomer.id).map(s => s.name).join(', ')
          : sites.slice(0, 15).map(s => s.name).join(', ');
        stepPrompt = `현장 이름 현장명 상세주소 소장 연락처. 예: ${candidateSites || '판교, 송도, 화성, 평택'}`;
      } else if (currentStep === 'EQUIPMENT') {
        stepPrompt = '고소작업대 모델 제조사 규격 수량: GS-1930, SJ-3219, GTJZ0812, 19피트, 26피트, 32피트, 40피트, 3219, 0812, 1930, 4047, 스카이잭, 지니, 시노붐, 1대, 2대, 3대';
      } else if (currentStep === 'DATETIME') {
        stepPrompt = '하차 납품 일정 시간: 내일, 모레, 다음주 월요일, 수요일, 아침 8시, 오후 2시, 최대한 빨리, 일찍, 당장, 급해';
      } else if (currentStep === 'OPTIONS_NOTE') {
        stepPrompt = '출고 옵션 보양 운송비 특이사항: 4면 철망, 함석, 바닥보양, 휠보양, 상단 감지봉, 협착방지, 소화기, 운송비 고객부담, 당사부담, 지게차 하차, 지하 2층, 높이제한, 없음, 기본';
      }

      const res = await fetch('/api/groq-stt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64Data,
          mimeType,
          language: 'ko',
          prompt: stepPrompt
        })
      });

      if (!res.ok) {
        throw new Error(`STT API 오류 (${res.status})`);
      }

      const data = await res.json();
      const text = (data?.textTranscript || '').trim();
      handleRecognizedText(text);
    } catch (err: any) {
      console.warn('Groq STT failed, falling back to message:', err);
      setIsProcessing(false);
      setStatusMessage('음성 변환에 실패했습니다. 다시 말씀해주세요.');
    }
  };


  // ── 🏢 현장 선택 시 능동형 확인 인터뷰 시작 ──
  const startSiteProactiveInterview = (s: CustomerSite) => {
    setSelectedSite(s);
    setPendingSite(s);
    setNewSiteName('');
    if (s.address) setSiteAddress(s.address);

    // 1) 담당자 확인 분기
    if (s.contactName || s.contact) {
      setSiteSubStep('CONTACT_CONFIRM');
      const targetName = s.contactName ? `${s.contactName} 소장님` : '현장소장님';
      const targetPhone = s.contact ? `(${s.contact})` : '';
      const prompt = `현장 담당자는 ${targetName} ${targetPhone}인가요?`;
      setStatusMessage(prompt);
      if (ttsEnabled) ttsService.speak(prompt);
      return;
    }

    // 2) 옵션 확인 분기
    const hasExistingOptions = !!s.paidOptions || !!s.protection || 
      (s.checkedSpecs && Object.keys(s.checkedSpecs).length > 0);
    if (hasExistingOptions) {
      setSiteSubStep('OPTIONS_CONFIRM');
      const summary = getSiteOptionsSummary(s);
      const prompt = `기존 출고의 옵션(${summary})과 동일한가요?`;
      setStatusMessage(prompt);
      if (ttsEnabled) ttsService.speak(prompt);
      return;
    }

    // 둘 다 없으면 장비 단계로 직행
    setStatusMessage(`현장: [${s.name}] 확인되었습니다.`);
    setTimeout(() => {
      setCurrentStep('EQUIPMENT');
      guideCurrentStep('EQUIPMENT', '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.');
    }, 1000);
  };

  // ── [Step 2: 현장 매칭 & 능동형 확인 인터뷰] ──
  const handleSiteStepLogic = (text: string) => {
    // 1) 담당자 확인 중 ("현장 담당자는 OOO 인가요? 네 / 아니요")
    if (siteSubStep === 'CONTACT_CONFIRM') {
      const yn = parseYesNoVoiceInput(text);
      if (yn === true) {
        // "네" ➔ 기존 담당자 정보 확정!
        setSiteContactName(pendingSite?.contactName || '');
        setSiteContactPhone(pendingSite?.contact || '');
        
        const hasExistingOptions = !!pendingSite?.paidOptions || !!pendingSite?.protection || 
          (pendingSite?.checkedSpecs && Object.keys(pendingSite.checkedSpecs).length > 0);
        
        if (hasExistingOptions && pendingSite) {
          setSiteSubStep('OPTIONS_CONFIRM');
          const summary = getSiteOptionsSummary(pendingSite);
          const prompt = `기존 출고의 옵션(${summary})과 동일한가요?`;
          setStatusMessage(`담당자 확인 완료.\n${prompt}`);
          if (ttsEnabled) ttsService.speak(prompt);
        } else {
          setSiteSubStep('SITE_SELECT');
          setStatusMessage(`담당자 [${pendingSite?.contactName || '소장'}] 확인 완료.`);
          setTimeout(() => {
            setCurrentStep('EQUIPMENT');
            guideCurrentStep('EQUIPMENT', '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.');
          }, 1000);
        }
        return;
      } else if (yn === false) {
        // "아니요" ➔ 새 담당자 성함 묻기
        setSiteSubStep('CONTACT_NAME');
        const prompt = '그럼 누구입니까? 새 담당자 성함을 말씀해주세요.';
        setStatusMessage(prompt);
        if (ttsEnabled) ttsService.speak(prompt);
        return;
      } else {
        setStatusMessage('네 또는 아니요 로 답변해주세요. (예: "네 맞습니다" 또는 "아닙니다")');
        if (ttsEnabled) ttsService.speak('네 또는 아니요로 답변해주세요.');
        return;
      }
    }

    // 2) 새 담당자 성함 입력 중 ("그럼 누구입니까?")
    if (siteSubStep === 'CONTACT_NAME') {
      const name = parseContactNameVoiceInput(text);
      if (name) {
        setSiteContactName(name);
        setSiteSubStep('CONTACT_PHONE');
        const prompt = `${name} 소장님의 전화번호를 말씀해주세요.`;
        setStatusMessage(prompt);
        if (ttsEnabled) ttsService.speak('전화번호를 말씀해주세요.');
      } else {
        setStatusMessage('담당자 성함을 인식하지 못했습니다. 다시 말씀해주세요. (예: "김철수 소장")');
        if (ttsEnabled) ttsService.speak('담당자 성함을 다시 말씀해주세요.');
      }
      return;
    }

    // 3) 새 담당자 전화번호 입력 중 ("전화번호를 말해주세요")
    if (siteSubStep === 'CONTACT_PHONE') {
      const phone = parseContactPhoneVoiceInput(text);
      if (phone) {
        setSiteContactPhone(phone);
        
        const hasExistingOptions = !!pendingSite?.paidOptions || !!pendingSite?.protection || 
          (pendingSite?.checkedSpecs && Object.keys(pendingSite.checkedSpecs).length > 0);
        
        if (hasExistingOptions && pendingSite) {
          setSiteSubStep('OPTIONS_CONFIRM');
          const summary = getSiteOptionsSummary(pendingSite);
          const prompt = `기존 출고의 옵션(${summary})과 동일한가요?`;
          setStatusMessage(`담당자 [${siteContactName} / ${phone}] 등록 완료.\n${prompt}`);
          if (ttsEnabled) ttsService.speak(prompt);
        } else {
          setSiteSubStep('SITE_SELECT');
          setStatusMessage(`담당자 [${siteContactName} / ${phone}] 등록 완료.`);
          setTimeout(() => {
            setCurrentStep('EQUIPMENT');
            guideCurrentStep('EQUIPMENT', '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.');
          }, 1000);
        }
      } else {
        setStatusMessage('전화번호를 인식하지 못했습니다. (예: "010-1234-5678" 또는 "공일공 일이삼사...")');
        if (ttsEnabled) ttsService.speak('전화번호를 다시 말씀해주세요.');
      }
      return;
    }

    // 4) 옵션/스펙 상속 확인 중 ("기존 출고의 옵션과 동일한가요? 예/아니요")
    if (siteSubStep === 'OPTIONS_CONFIRM') {
      const yn = parseYesNoVoiceInput(text);
      if (yn === true) {
        // "예" ➔ 과거 옵션 100% 자동 상속!
        if (pendingSite?.paidOptions) setPaidOptions(pendingSite.paidOptions);
        if (pendingSite?.protection) setProtection(pendingSite.protection);
        if (pendingSite?.checkedSpecs) setCheckedSpecs(pendingSite.checkedSpecs);
        
        setSiteSubStep('SITE_SELECT');
        setStatusMessage('기존 출고 옵션 및 안전스펙 100% 상속 완료.');
        setTimeout(() => {
          setCurrentStep('EQUIPMENT');
          guideCurrentStep('EQUIPMENT', '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.');
        }, 1000);
        return;
      } else if (yn === false) {
        // "아니요" ➔ 옵션 초기화 후 나중에 OPTIONS_NOTE 단계에서 추가 입력
        setPaidOptions('');
        setProtection('');
        setCheckedSpecs({});
        
        setSiteSubStep('SITE_SELECT');
        setStatusMessage('새로운 조건으로 접수합니다.');
        setTimeout(() => {
          setCurrentStep('EQUIPMENT');
          guideCurrentStep('EQUIPMENT', '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.');
        }, 1000);
        return;
      } else {
        setStatusMessage('예 또는 아니요 로 답변해주세요. (예: "예, 동일합니다" 또는 "아니요")');
        if (ttsEnabled) ttsService.speak('예 또는 아니요로 답변해주세요.');
        return;
      }
    }

    // 5) 기본: 현장명 발화 / 선택
    const siteResult = parseSiteVoiceInput(text, sites, selectedCustomer?.id);
    if (siteResult) {
      if (siteResult.site) {
        startSiteProactiveInterview(siteResult.site);
      } else if (siteResult.newSiteName) {
        setSelectedSite(null);
        setPendingSite(null);
        setNewSiteName(siteResult.newSiteName);
        if (siteResult.extractedAddress) setSiteAddress(siteResult.extractedAddress);
        if (siteResult.extractedContactName) setSiteContactName(siteResult.extractedContactName);
        if (siteResult.extractedContactPhone) setSiteContactPhone(siteResult.extractedContactPhone);
        setStatusMessage(`신규 현장: [${siteResult.newSiteName}]으로 지정되었습니다.`);
        setTimeout(() => {
          setCurrentStep('EQUIPMENT');
          guideCurrentStep('EQUIPMENT', '출고할 장비의 제조사나 모델명, 대수를 말씀해주세요.');
        }, 1200);
      }
    } else {
      setStatusMessage('현장명을 인식하지 못했습니다. 다시 말씀해주세요.');
      if (ttsEnabled) ttsService.speak('현장명을 다시 말씀해주세요.');
    }
  };

  // ── 🎯 인식된 텍스트 단계별 해석 및 다음 단계 전이 ──
  const handleRecognizedText = (text: string) => {
    setIsProcessing(false);
    if (!text || !text.trim()) {
      setStatusMessage('인식된 음성이 없습니다. 다시 말씀해주세요.');
      return;
    }
    setRecognizedText(text);

    // ── [Step 1: 고객사 매칭] ──
    if (currentStep === 'CUSTOMER') {
      const matched = parseCustomerVoiceInput(text, customers);
      if (matched) {
        setSelectedCustomer(matched);
        if (matched.defaultBillingDay) setClosingDay(matched.defaultBillingDay === 30 || matched.defaultBillingDay === 31 ? '말일' : `${matched.defaultBillingDay}일`);
        if (matched.paymentDueDay) setPaymentDay(`익월 ${matched.paymentDueDay}일`);
        if (matched.defaultPaidOptions) setPaidOptions(matched.defaultPaidOptions);
        if (matched.defaultProtection) setProtection(matched.defaultProtection);
        if (matched.defaultCheckedSpecs) setCheckedSpecs(matched.defaultCheckedSpecs);

        setStatusMessage(`고객사: [${matched.name}] 확인되었습니다.`);
        setTimeout(() => {
          setCurrentStep('SITE');
          guideCurrentStep('SITE', `${matched.name}의 현장명을 말씀해주세요.`);
        }, 1200);
      } else {
        setStatusMessage(`"${text}" 고객사를 찾을 수 없습니다. 다시 말씀해주시거나 아래 목록에서 선택하세요.`);
        if (ttsEnabled) ttsService.speak('고객사를 찾을 수 없습니다. 다시 말씀해주세요.');
      }
      return;
    }

    // ── [Step 2: 현장 매칭] ──
    if (currentStep === 'SITE') {
      handleSiteStepLogic(text);
      return;
    }

    // ── [Step 3: 장비 규격 및 수량 매칭] ──
    if (currentStep === 'EQUIPMENT') {
      const eqResult = parseEquipmentVoiceInput(text);
      if (eqResult) {
        setEquipmentResult(eqResult);
        setStatusMessage(`장비: [${eqResult.confirmedDescription}] 지정 완료.`);
        // 4단계(일시)로 자동 전환
        setTimeout(() => {
          setCurrentStep('DATETIME');
          guideCurrentStep('DATETIME', '하차 희망 일시를 말씀해주세요.');
        }, 1200);
      } else {
        setStatusMessage('장비 규격을 파악하지 못했습니다. (예: "스카이잭 19피트 2대", "3219 2대", "0812 1대")');
        if (ttsEnabled) ttsService.speak('장비 규격과 대수를 다시 말씀해주세요.');
      }
      return;
    }

    // ── [Step 4: 하차 일시 매칭] ──
    if (currentStep === 'DATETIME') {
      // 만약 이전 턴에서 "시간 무관하게 가장 빨리로 접수할까요?"를 물어본 상태라면:
      if (isAwaitingAsapConfirmation) {
        if (/응|그래|어|맞아|네|좋아|그렇게/i.test(text)) {
          // ASAP 확정
          const dtResult: ParsedDateTimeResult = {
            date: pendingAsapDate || new Date().toISOString().split('T')[0],
            time: 'ASAP',
            isAsap: true,
            confirmQuestion: '',
            displayText: `${pendingAsapDate} [긴급 최우선 배차(ASAP)]`
          };
          setDateTimeResult(dtResult);
          setIsAwaitingAsapConfirmation(false);
          setStatusMessage('긴급 최우선 배차로 지정되었습니다.');
          setTimeout(() => {
            setCurrentStep('OPTIONS_NOTE');
            guideCurrentStep('OPTIONS_NOTE', '철망, 보양, 운송비나 현장 특이사항이 있나요? 없으면 건너뛰기를 누르세요.');
          }, 1000);
          return;
        } else {
          // 거절 또는 다른 시간 발화
          setIsAwaitingAsapConfirmation(false);
        }
      }

      const dtResult = parseDateTimeVoiceInput(text);
      if (dtResult.isAsap) {
        // 긴급 감지 ➔ 사장님 지침대로 "시간 무관하게 가장 빨리로 접수할까요?" 되짚어 확인!
        setIsAwaitingAsapConfirmation(true);
        setPendingAsapDate(dtResult.date);
        setStatusMessage(dtResult.confirmQuestion);
        if (ttsEnabled) {
          ttsService.speak(dtResult.confirmQuestion);
        }
      } else {
        setDateTimeResult(dtResult);
        setStatusMessage(`하차일시: [${dtResult.displayText}] 지정 완료.`);
        setTimeout(() => {
          setCurrentStep('OPTIONS_NOTE');
          guideCurrentStep('OPTIONS_NOTE', '철망, 보양, 운송비나 현장 특이사항이 있나요? 없으면 건너뛰기를 누르세요.');
        }, 1200);
      }
      return;
    }

    // ── [Step 5: 옵션, 보양, 운송비 및 현장 특이사항 매칭] ──
    if (currentStep === 'OPTIONS_NOTE') {
      if (/없어|그냥|기본|패스|건너|됐어|아니/i.test(text)) {
        setStatusMessage('기본 표준 사양으로 지정되었습니다.');
        setTimeout(() => {
          setCurrentStep('CONFIRM');
          guideCurrentStep('CONFIRM', '출고 의뢰 전체 내용이 완성되었습니다. 확인 후 접수해주세요.');
        }, 800);
        return;
      }

      const optRes = parseOptionsAndSpecsVoiceInput(text);
      const logiRes = parseLogisticsAndBillingVoiceInput(text);

      if (optRes.paidOptions) setPaidOptions(prev => prev ? `${prev}, ${optRes.paidOptions}` : optRes.paidOptions);
      if (optRes.protection) setProtection(prev => prev ? `${prev}, ${optRes.protection}` : optRes.protection);
      if (Object.keys(optRes.checkedSpecs).length > 0) setCheckedSpecs(prev => ({ ...prev, ...optRes.checkedSpecs }));
      if (logiRes.billableToCustomer !== undefined) setBillableToCustomer(logiRes.billableToCustomer);
      if (logiRes.closingDay) setClosingDay(logiRes.closingDay);
      if (logiRes.paymentDay) setPaymentDay(logiRes.paymentDay);
      if (logiRes.vehicleType) setVehicleType(logiRes.vehicleType);
      if (logiRes.specialMemo) setSpecialMemo(prev => prev ? `${prev}, ${logiRes.specialMemo}` : logiRes.specialMemo!);

      const summary = [
        optRes.paidOptions && `옵션: ${optRes.paidOptions}`,
        optRes.protection && `보양: ${optRes.protection}`,
        logiRes.billableToCustomer !== undefined && (logiRes.billableToCustomer ? '운송비: 고객부담' : '운송비: 당사부담'),
        logiRes.specialMemo && `특이사항: ${logiRes.specialMemo}`
      ].filter(Boolean).join(' | ');

      setStatusMessage(summary ? `반영됨: [${summary}]` : '옵션 및 특이사항이 접수되었습니다.');

      setTimeout(() => {
        setCurrentStep('CONFIRM');
        guideCurrentStep('CONFIRM', '출고 의뢰 전체 내용이 완성되었습니다. 확인 후 접수해주세요.');
      }, 1200);
      return;
    }

    // ── [Step 6: 확인 단계 음성 명령] ──
    if (currentStep === 'CONFIRM') {
      if (/현장\s*저장|기본값|저장해|계속\s*유지|네|맞아|그렇게/i.test(text)) {
        setSaveOptionsToSite(true);
        setStatusMessage('현장 기본값으로 저장하도록 설정되었습니다.');
        if (ttsEnabled) ttsService.speak('현장 기본값으로 저장합니다.');
        return;
      }
      if (/이번만|1회|일회|그냥\s*이번|아니|보존/i.test(text)) {
        setSaveOptionsToSite(false);
        setStatusMessage('이번 출고에만 1회성으로 적용하고 기존 현장 옵션은 보존합니다.');
        if (ttsEnabled) ttsService.speak('이번 출고에만 1회성으로 적용합니다.');
        return;
      }
      if (/접수|등록|출고|확인|완료/i.test(text)) {
        handleFinalSubmit();
        return;
      }
    }
  };

  // ── 최종 완료 제출 ──
  const handleFinalSubmit = () => {
    if (!selectedCustomer) return;

    const finalSiteAddress = siteAddress || selectedSite?.address || selectedCustomer.address || '';
    const finalContactName = siteContactName || selectedSite?.contactName || '현장소장';
    const finalContactPhone = siteContactPhone || selectedSite?.contact || selectedCustomer.repContact || '';

    const combinedNotes = [
      dateTimeResult?.isAsap ? '[긴급 최우선 배차(ASAP)]' : '',
      equipmentResult?.matchedItem ? `${equipmentResult.matchedItem.manufacturer} ${equipmentResult.order.modelName}` : '',
      specialMemo ? `[현장특이사항] ${specialMemo}` : '',
      paidOptions ? `[유상옵션: ${paidOptions}]` : '',
      protection ? `[보양: ${protection}]` : '',
      billableToCustomer ? '[운송비 고객청구]' : '[운송비 당사부담]'
    ].filter(Boolean).join(' | ');

    const payload: VoiceGuideWizardCompleteData = {
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      siteId: selectedSite?.id || 'NEW',
      siteName: selectedSite?.name || newSiteName || '현장',
      newSiteName: newSiteName || '',
      siteAddress: finalSiteAddress,
      siteContactName: finalContactName,
      siteContactPhone: finalContactPhone,
      deliveryDate: dateTimeResult?.date || new Date().toISOString().split('T')[0],
      deliveryTime: dateTimeResult?.time === 'ASAP' ? '07:00' : (dateTimeResult?.time || '08:00'),
      orders: equipmentResult?.orders && equipmentResult.orders.length > 0
        ? equipmentResult.orders
        : [equipmentResult?.order || { ft: '19ft', modelName: 'GS-1930', count: 1 }],
      memo: combinedNotes,
      paidOptions,
      protection,
      checkedSpecs,
      saveOptionsToSite,
      billableToCustomer,
      closingDay: closingDay || (selectedCustomer.defaultBillingDay ? String(selectedCustomer.defaultBillingDay) : '말일'),
      paymentDay: paymentDay || (selectedCustomer.paymentDueDay ? `익월 ${selectedCustomer.paymentDueDay}일` : '익월 25일'),
      vehicleType,
      isAsap: !!dateTimeResult?.isAsap
    };

    onComplete(payload);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      fontFamily: 'sans-serif'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-card, #1e293b)',
        borderTop: '1px solid var(--border-color, #334155)',
        borderTopLeftRadius: '24px',
        borderTopRightRadius: '24px',
        padding: '20px 16px 24px',
        maxHeight: '90vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: '0 -10px 25px rgba(0,0,0,0.5)',
        color: '#ffffff'
      }}>
        {/* ── 1. 상단 타이틀 바 & TTS 토글 & 일반서식 이동 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '8px',
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa'
            }}>
              <Sparkles size={16} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, letterSpacing: '-0.3px' }}>
              대화형 음성 출고의뢰 (전체 구조)
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* ✏️ 일반 화면에서 이어서 작성 (Safe Hand-off) */}
            <button
              type="button"
              onClick={handleHandOffToForm}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 8px',
                borderRadius: '16px',
                border: '1px solid #475569',
                backgroundColor: 'rgba(51, 65, 85, 0.7)',
                color: '#93c5fd',
                fontSize: '11px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
              title="지금까지 입력한 내용으로 일반 서식에서 이어서 작성"
            >
              <Edit3 size={12} />
              <span>일반서식 이동</span>
            </button>

            {/* 🔊 TTS 음성 안내 ON/OFF 토글 버튼 */}
            <button
              type="button"
              onClick={() => ttsService.toggle()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 8px',
                borderRadius: '16px',
                border: ttsEnabled ? '1px solid #3b82f6' : '1px solid #475569',
                backgroundColor: ttsEnabled ? 'rgba(59, 130, 246, 0.25)' : 'rgba(30, 41, 59, 0.6)',
                color: ttsEnabled ? '#60a5fa' : '#94a3b8',
                fontSize: '11px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
              title="음성 안내(TTS) 켜기/끄기"
            >
              {ttsEnabled ? <Volume2 size={13} color="#60a5fa" /> : <VolumeX size={13} color="#94a3b8" />}
              <span>{ttsEnabled ? '소리 ON' : '소리 OFF'}</span>
            </button>

            {/* 닫기 버튼 */}
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px',
                borderRadius: '50%',
                backgroundColor: '#334155',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer'
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── 2. 5단계 프로그레스 바 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px' }}>
          {[
            { key: 'CUSTOMER', label: '1. 고객사', done: !!selectedCustomer },
            { key: 'SITE', label: '2. 현장명', done: !!selectedSite || !!newSiteName },
            { key: 'EQUIPMENT', label: '3. 장비', done: !!equipmentResult },
            { key: 'DATETIME', label: '4. 일시', done: !!dateTimeResult },
            { key: 'OPTIONS_NOTE', label: '5. 옵션/특이', done: !!paidOptions || !!protection || !!specialMemo || billableToCustomer },
          ].map((item, idx) => {
            const isCurrent = currentStep === item.key;
            return (
              <div
                key={item.key}
                onClick={() => {
                  if (item.done || idx === 0) {
                    setCurrentStep(item.key as WizardStep);
                    guideCurrentStep(item.key as WizardStep);
                  }
                }}
                style={{
                  padding: '6px 2px',
                  borderRadius: '8px',
                  textAlign: 'center',
                  fontSize: '10.5px',
                  fontWeight: '700',
                  backgroundColor: item.done ? 'rgba(16, 185, 129, 0.2)' : isCurrent ? 'rgba(59, 130, 246, 0.25)' : '#0f172a',
                  border: item.done ? '1px solid #10b981' : isCurrent ? '1px solid #3b82f6' : '1px solid #334155',
                  color: item.done ? '#34d399' : isCurrent ? '#60a5fa' : '#64748b',
                  cursor: item.done ? 'pointer' : 'default',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {item.done ? `✓ ${item.label.split('. ')[1]}` : item.label}
              </div>
            );
          })}
        </div>

        {/* ── 3. 메인 인터랙션 대형 카드 (화면 텍스트 출력 중심) ── */}
        <div style={{
          padding: '16px 18px',
          borderRadius: '16px',
          backgroundColor: '#0f172a',
          border: '1.5px solid #3b82f6',
          minHeight: '100px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '8px'
        }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {currentStep === 'CUSTOMER' && 'STEP 1 • 고객사 확인'}
            {currentStep === 'SITE' && 'STEP 2 • 납품 현장명 및 주소'}
            {currentStep === 'EQUIPMENT' && 'STEP 3 • 장비 규격 및 수량'}
            {currentStep === 'DATETIME' && 'STEP 4 • 하차 희망 일시'}
            {currentStep === 'OPTIONS_NOTE' && 'STEP 5 • 옵션/보양/운송비/특이사항'}
            {currentStep === 'CONFIRM' && 'STEP 6 • 최종 의뢰 전산 접수'}
          </div>

          <div style={{ fontSize: '16px', fontWeight: '800', color: '#ffffff', lineHeight: 1.4 }}>
            {statusMessage || '질문을 준비 중입니다...'}
          </div>

          {/* 들린 내용 & 인라인 터치 수정 에디터 (Tap-to-Edit Buffer) */}
          {isEditingText ? (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
              <input
                type="text"
                value={editingTextValue}
                onChange={(e) => setEditingTextValue(e.target.value)}
                placeholder="인식된 내용 직접 수정 또는 입력"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editingTextValue.trim()) {
                    setIsEditingText(false);
                    handleRecognizedText(editingTextValue.trim());
                  }
                }}
                autoFocus
                style={{
                  flex: 1,
                  backgroundColor: '#1e293b',
                  border: '1.5px solid #38bdf8',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  color: '#ffffff',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (editingTextValue.trim()) {
                    setIsEditingText(false);
                    handleRecognizedText(editingTextValue.trim());
                  }
                }}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                반영
              </button>
              <button
                type="button"
                onClick={() => setIsEditingText(false)}
                style={{
                  padding: '6px 8px',
                  backgroundColor: '#334155',
                  color: '#94a3b8',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                취소
              </button>
            </div>
          ) : recognizedText ? (
            <div
              onClick={() => {
                setEditingTextValue(recognizedText);
                setIsEditingText(true);
              }}
              style={{
                fontSize: '12.5px',
                color: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                padding: '6px 10px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                border: '1px dashed rgba(56, 189, 248, 0.4)'
              }}
              title="터치하여 직접 텍스트 수정"
            >
              <span>🎙️ 들린 내용: <strong>"{recognizedText}"</strong></span>
              <span style={{ fontSize: '11px', color: '#93c5fd', textDecoration: 'underline', marginLeft: '6px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '2px' }}>
                <Edit3 size={11} />
                <span>터치 수정</span>
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setEditingTextValue('');
                  setIsEditingText(true);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 4px'
                }}
              >
                <Edit3 size={11} />
                <span>직접 텍스트로 입력</span>
              </button>
            </div>
          )}
        </div>

        {/* ── 4. 단계별 스마트 터치 컨트롤러 (하이브리드 인터리빙) ── */}
        {currentStep === 'CUSTOMER' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 고객사 실시간 검색바 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '6px 10px' }}>
              <Search size={14} color="#94a3b8" />
              <input
                type="text"
                placeholder="고객사 검색 (예: 삼보, 현대, 성우)"
                value={customerSearchText}
                onChange={(e) => setCustomerSearchText(e.target.value)}
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              {customerSearchText && (
                <button
                  type="button"
                  onClick={() => setCustomerSearchText('')}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* 고객사 칩 목록 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', width: '100%', marginBottom: '2px' }}>
                {customerSearchText ? '검색 결과 (터치하여 선택):' : '주요 거래처 빠른 선택:'}
              </span>
              {filteredCustomers.slice(0, 6).map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleTouchSelectCustomer(c)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    backgroundColor: selectedCustomer?.id === c.id ? 'rgba(59, 130, 246, 0.3)' : '#334155',
                    border: selectedCustomer?.id === c.id ? '1px solid #3b82f6' : '1px solid #475569',
                    color: selectedCustomer?.id === c.id ? '#60a5fa' : '#e2e8f0',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 'SITE' && selectedCustomer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            {/* 1) 담당자 확인 중 ("현장 담당자는 OOO 인가요? 네/아니요") */}
            {siteSubStep === 'CONTACT_CONFIRM' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleRecognizedText('네')}
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    border: '1.5px solid #10b981',
                    color: '#34d399',
                    fontSize: '14px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <Check size={18} />
                  <span>네, 맞습니다</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRecognizedText('아니요')}
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    border: '1.5px solid #ef4444',
                    color: '#f87171',
                    fontSize: '14px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <X size={18} />
                  <span>아니요 (변경)</span>
                </button>
              </div>
            )}

            {/* 2) 새 담당자 성함 발화/직접입력 안내 */}
            {siteSubStep === 'CONTACT_NAME' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    placeholder="담당자 성함 직접 입력 (예: 김철수 소장)"
                    value={manualContactInput}
                    onChange={(e) => setManualContactInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && manualContactInput.trim()) {
                        handleRecognizedText(manualContactInput.trim());
                        setManualContactInput('');
                      }
                    }}
                    style={{
                      flex: 1, backgroundColor: '#1e293b', border: '1px solid #334155',
                      borderRadius: '8px', padding: '6px 10px', color: '#ffffff', fontSize: '12px', outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (manualContactInput.trim()) {
                        handleRecognizedText(manualContactInput.trim());
                        setManualContactInput('');
                      }
                    }}
                    style={{
                      padding: '6px 12px', backgroundColor: '#2563eb', color: '#ffffff',
                      borderRadius: '8px', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    반영
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', width: '100%' }}>성함 또는 직함 발화/터치 예시:</span>
                  {['김철수 소장', '이반장', '박소장님'].map(ex => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => handleRecognizedText(ex)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        color: '#93c5fd',
                        fontSize: '11.5px',
                        cursor: 'pointer'
                      }}
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3) 새 전화번호 발화/직접입력 안내 */}
            {siteSubStep === 'CONTACT_PHONE' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="tel"
                    placeholder="010-0000-0000 직접 입력"
                    value={manualPhoneInput}
                    onChange={(e) => setManualPhoneInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && manualPhoneInput.trim()) {
                        handleRecognizedText(manualPhoneInput.trim());
                        setManualPhoneInput('');
                      }
                    }}
                    style={{
                      flex: 1, backgroundColor: '#1e293b', border: '1px solid #334155',
                      borderRadius: '8px', padding: '6px 10px', color: '#ffffff', fontSize: '12px', outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (manualPhoneInput.trim()) {
                        handleRecognizedText(manualPhoneInput.trim());
                        setManualPhoneInput('');
                      }
                    }}
                    style={{
                      padding: '6px 12px', backgroundColor: '#2563eb', color: '#ffffff',
                      borderRadius: '8px', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    반영
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', width: '100%' }}>전화번호 발화/터치 예시:</span>
                  {['010-1234-5678', '010-9876-5432'].map(ex => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => handleRecognizedText(ex)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        color: '#fcd34d',
                        fontSize: '11.5px',
                        cursor: 'pointer'
                      }}
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 4) 옵션/스펙 상속 확인 중 ("기존 출고 옵션과 동일한가요? 예/아니요") */}
            {siteSubStep === 'OPTIONS_CONFIRM' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleRecognizedText('예')}
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    border: '1.5px solid #10b981',
                    color: '#34d399',
                    fontSize: '14px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <Check size={18} />
                  <span>예, 동일합니다</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRecognizedText('아니요')}
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    border: '1.5px solid #f59e0b',
                    color: '#fbbf24',
                    fontSize: '14px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <X size={18} />
                  <span>아니요 (조건 변경)</span>
                </button>
              </div>
            )}

            {/* 5) 기본: 현장 선택 칩 목록 + 신규 현장 직접 입력 폼 */}
            {siteSubStep === 'SITE_SELECT' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', width: '100%', marginBottom: '2px' }}>해당 고객사의 기존 현장:</span>
                  {sites.filter(s => s.customerId === selectedCustomer.id).slice(0, 6).map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => startSiteProactiveInterview(s)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '8px',
                        backgroundColor: '#334155',
                        border: '1px solid #475569',
                        color: '#e2e8f0',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      📍 {s.name}
                    </button>
                  ))}
                </div>

                {/* 신규 현장 직접 입력 토글 */}
                {!showNewSiteForm ? (
                  <button
                    type="button"
                    onClick={() => setShowNewSiteForm(true)}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      border: '1px dashed #3b82f6',
                      color: '#60a5fa',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <Plus size={14} />
                    <span>목록에 없는 신규 현장 직접 입력</span>
                  </button>
                ) : (
                  <div style={{
                    padding: '10px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid #3b82f6',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 800, color: '#60a5fa' }}>신규 현장 정보 입력</div>
                    <input
                      type="text"
                      placeholder="현장명 (필수, 예: 판교 제2밸리 신축)"
                      value={manualNewSiteName}
                      onChange={(e) => setManualNewSiteName(e.target.value)}
                      style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', padding: '6px 8px', fontSize: '12px', outline: 'none' }}
                    />
                    <input
                      type="text"
                      placeholder="현장 주소 (선택)"
                      value={manualNewSiteAddr}
                      onChange={(e) => setManualNewSiteAddr(e.target.value)}
                      style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', padding: '6px 8px', fontSize: '12px', outline: 'none' }}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder="현장소장 (선택)"
                        value={manualContactInput}
                        onChange={(e) => setManualContactInput(e.target.value)}
                        style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', padding: '6px 8px', fontSize: '12px', outline: 'none' }}
                      />
                      <input
                        type="tel"
                        placeholder="전화번호 (선택)"
                        value={manualPhoneInput}
                        onChange={(e) => setManualPhoneInput(e.target.value)}
                        style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', padding: '6px 8px', fontSize: '12px', outline: 'none' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                      <button
                        type="button"
                        onClick={handleTouchSubmitNewSite}
                        disabled={!manualNewSiteName.trim()}
                        style={{
                          flex: 1, padding: '7px', borderRadius: '6px', backgroundColor: manualNewSiteName.trim() ? '#2563eb' : '#475569',
                          color: '#fff', border: 'none', fontSize: '12px', fontWeight: 700, cursor: manualNewSiteName.trim() ? 'pointer' : 'not-allowed'
                        }}
                      >
                        신규 현장 등록 후 다음 ➔
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNewSiteForm(false)}
                        style={{ padding: '7px 10px', borderRadius: '6px', backgroundColor: '#334155', color: '#94a3b8', border: 'none', fontSize: '12px', cursor: 'pointer' }}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 3단계: 장비 규격 및 수량 스마트 터치 컨트롤러 ── */}
        {currentStep === 'EQUIPMENT' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>주요 규격 터치 선택:</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {[
                { ft: '19ft', model: 'GS-1930', label: '19ft (GS-1930)' },
                { ft: '26ft', model: 'SJ-3219', label: '26ft 협폭 (3219)' },
                { ft: '26ft', model: 'GS-2646', label: '26ft 광폭 (2646)' },
                { ft: '32ft', model: 'SJ-3246', label: '32ft (3246)' },
                { ft: '40ft', model: 'GS-4047', label: '40ft (4047)' },
                { ft: '53ft', model: 'S1614AC+', label: '53ft 대형 (Dingli)' },
              ].map(item => {
                const isSelected = touchEquipmentFt === item.ft && touchEquipmentModel === item.model;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setTouchEquipmentFt(item.ft);
                      setTouchEquipmentModel(item.model);
                    }}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '8px',
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.25)' : '#1e293b',
                      border: isSelected ? '1.5px solid #3b82f6' : '1px solid #334155',
                      color: isSelected ? '#60a5fa' : '#cbd5e1',
                      fontSize: '11.5px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      textAlign: 'center'
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* 수량 증감 카운터 및 터치 확정 버튼 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1e293b', padding: '8px 12px', borderRadius: '10px', border: '1px solid #334155', marginTop: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>수량:</span>
                <button
                  type="button"
                  onClick={() => setTouchEquipmentQty(prev => Math.max(1, prev - 1))}
                  style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#ffffff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  -
                </button>
                <span style={{ fontSize: '15px', fontWeight: '800', color: '#ffffff', minWidth: '24px', textAlign: 'center' }}>
                  {touchEquipmentQty}
                </span>
                <button
                  type="button"
                  onClick={() => setTouchEquipmentQty(prev => prev + 1)}
                  style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#ffffff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  +
                </button>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>대</span>
              </div>

              <button
                type="button"
                onClick={() => handleTouchSelectEquipment(touchEquipmentFt, touchEquipmentModel, touchEquipmentQty)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '12.5px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>터치 확정 ➔</span>
              </button>
            </div>
          </div>
        )}

        {/* ── 4단계: 하차 일시 스마트 터치 컨트롤러 ── */}
        {currentStep === 'DATETIME' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>빠른 일시 터치 선택:</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              <button
                type="button"
                onClick={() => handleTouchSelectDateTime(defaultTomorrowStr, '08:00', false)}
                style={{
                  padding: '8px', borderRadius: '8px', backgroundColor: '#1e293b',
                  border: '1px solid #334155', color: '#e2e8f0', fontSize: '12px', fontWeight: '700', cursor: 'pointer'
                }}
              >
                🌅 내일 아침 08:00
              </button>
              <button
                type="button"
                onClick={() => handleTouchSelectDateTime(defaultTomorrowStr, '07:00', false)}
                style={{
                  padding: '8px', borderRadius: '8px', backgroundColor: '#1e293b',
                  border: '1px solid #334155', color: '#e2e8f0', fontSize: '12px', fontWeight: '700', cursor: 'pointer'
                }}
              >
                ⚡ 내일 이른아침 07:00
              </button>
              <button
                type="button"
                onClick={() => handleTouchSelectDateTime(new Date().toISOString().split('T')[0], 'ASAP', true)}
                style={{
                  padding: '8px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171', fontSize: '12px', fontWeight: '700', cursor: 'pointer'
                }}
              >
                🚨 오늘 당장 (긴급 ASAP)
              </button>
              <button
                type="button"
                onClick={() => {
                  const afterTomorrow = new Date();
                  afterTomorrow.setDate(afterTomorrow.getDate() + 2);
                  handleTouchSelectDateTime(afterTomorrow.toISOString().split('T')[0], '08:00', false);
                }}
                style={{
                  padding: '8px', borderRadius: '8px', backgroundColor: '#1e293b',
                  border: '1px solid #334155', color: '#e2e8f0', fontSize: '12px', fontWeight: '700', cursor: 'pointer'
                }}
              >
                📅 모레 아침 08:00
              </button>
            </div>

            {/* 직접 날짜/시간 피커 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#1e293b', padding: '8px 10px', borderRadius: '10px', border: '1px solid #334155' }}>
              <input
                type="date"
                value={touchCustomDate}
                onChange={(e) => setTouchCustomDate(e.target.value)}
                style={{
                  backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px',
                  color: '#ffffff', padding: '4px 6px', fontSize: '12px', outline: 'none'
                }}
              />
              <input
                type="time"
                value={touchCustomTime}
                onChange={(e) => setTouchCustomTime(e.target.value)}
                style={{
                  backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px',
                  color: '#ffffff', padding: '4px 6px', fontSize: '12px', outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={() => handleTouchSelectDateTime(touchCustomDate, touchCustomTime, false)}
                style={{
                  padding: '6px 12px', borderRadius: '6px', backgroundColor: '#2563eb',
                  color: '#ffffff', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer', marginLeft: 'auto'
                }}
              >
                확정 ➔
              </button>
            </div>
          </div>
        )}

        {/* ── 5단계: 옵션, 보양, 운송비 및 특이사항 스마트 터치 컨트롤러 ── */}
        {currentStep === 'OPTIONS_NOTE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>주요 옵션 및 조건 터치 선택:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {[
                { label: '4면 철망', type: 'paid', val: '4면 철망' },
                { label: '바닥보양', type: 'protection', val: '바닥보양(플라베니아)' },
                { label: '타이어 휠커버', type: 'protection', val: '타이어 휠커버' },
                { label: '탑승구 사다리', type: 'protection', val: '탑승구 사다리' },
                { label: '모서리 랩핑', type: 'protection', val: '모서리 랩핑' },
                { label: '에어배관', type: 'paid', val: '에어배관' },
              ].map(opt => {
                const isActive = opt.type === 'paid' ? paidOptions.includes(opt.val) : protection.includes(opt.val);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => {
                      if (opt.type === 'paid') {
                        setPaidOptions(prev => prev.includes(opt.val) ? prev.replace(opt.val, '').replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '') : (prev ? `${prev}, ${opt.val}` : opt.val));
                      } else {
                        setProtection(prev => prev.includes(opt.val) ? prev.replace(opt.val, '').replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '') : (prev ? `${prev}, ${opt.val}` : opt.val));
                      }
                    }}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '8px',
                      backgroundColor: isActive ? 'rgba(168, 85, 247, 0.3)' : '#1e293b',
                      border: isActive ? '1.5px solid #a855f7' : '1px solid #334155',
                      color: isActive ? '#d8b4fe' : '#cbd5e1',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {isActive ? '✓ ' : ''}{opt.label}
                  </button>
                );
              })}

              {/* 운송비 귀속선 토글 버튼 */}
              <button
                type="button"
                onClick={() => setBillableToCustomer(prev => !prev)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '8px',
                  backgroundColor: billableToCustomer ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                  border: billableToCustomer ? '1.5px solid #ef4444' : '1.5px solid #10b981',
                  color: billableToCustomer ? '#f87171' : '#34d399',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                운송비: {billableToCustomer ? '🔴 고객청구' : '🟢 당사부담'}
              </button>
            </div>

            {/* 특이사항 인라인 입력 및 확정 버튼 */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
              <input
                type="text"
                placeholder="현장 특이사항 직접 입력 (예: 지하 2층 진입, 지게차 하차)"
                value={manualMemoInput}
                onChange={(e) => setManualMemoInput(e.target.value)}
                style={{
                  flex: 1,
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#ffffff',
                  padding: '6px 10px',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (manualMemoInput.trim()) {
                    setSpecialMemo(prev => prev ? `${prev}, ${manualMemoInput.trim()}` : manualMemoInput.trim());
                    setManualMemoInput('');
                  }
                  setCurrentStep('CONFIRM');
                  guideCurrentStep('CONFIRM', '출고 의뢰 전체 내용이 완성되었습니다. 확인 후 접수해주세요.');
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                다음 ➔
              </button>
            </div>
          </div>
        )}

        {/* ── 5. 최종 확정 8대 전 영역 요약 카드 (CONFIRM 단계) ── */}
        {currentStep === 'CONFIRM' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{
              padding: '12px 14px',
              borderRadius: '12px',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid #10b981',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
              fontSize: '12px'
            }}>
              <div>🏢 <strong>고객사:</strong> {selectedCustomer?.name}</div>
              <div>📍 <strong>현장명:</strong> {selectedSite?.name || newSiteName}</div>
              <div style={{ gridColumn: 'span 2' }}>🏠 <strong>주소:</strong> {siteAddress || selectedSite?.address || selectedCustomer?.address || '미상'}</div>
              <div>👤 <strong>소장:</strong> {siteContactName || selectedSite?.contactName || '미지정'} ({siteContactPhone || selectedSite?.contact || '-'})</div>
              <div>🏗️ <strong>장비:</strong> {equipmentResult?.confirmedDescription}</div>
              <div>⏰ <strong>하차일시:</strong> {dateTimeResult?.displayText}</div>
              <div>🚚 <strong>운송비:</strong> {billableToCustomer ? '🔴 고객부담(청구)' : '🟢 당사부담'}</div>
              <div>🛡️ <strong>유상옵션:</strong> {paidOptions || '표준 사양'}</div>
              <div>📦 <strong>보양작업:</strong> {protection || '표준 사양'}</div>
              <div style={{ gridColumn: 'span 2' }}>📄 <strong>마감/결제:</strong> {closingDay || '말일'} 마감 / {paymentDay || '익월 25일'} 결제</div>
              {specialMemo && <div style={{ gridColumn: 'span 2', color: '#f59e0b' }}>📝 <strong>특이사항:</strong> {specialMemo}</div>}
            </div>

            {/* 🌟 옵션 변경 시 현장 마스터 저장 확인 패널 */}
            {isOptionsDiff && (
              <div style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <AlertTriangle size={14} />
                  <span>현장 기존 옵션과 변경사항 감지됨</span>
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  변경된 옵션을 현장 기본값으로 저장할까요? (1회성 선택 시 기존 현장 옵션이 유지됩니다)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveOptionsToSite(true);
                      setStatusMessage('현장 기본값으로 저장하도록 설정되었습니다.');
                    }}
                    style={{
                      padding: '8px 6px',
                      borderRadius: '8px',
                      border: saveOptionsToSite ? '2px solid #10b981' : '1px solid #334155',
                      backgroundColor: saveOptionsToSite ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)',
                      color: saveOptionsToSite ? '#10b981' : '#64748b',
                      fontSize: '11.5px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    {saveOptionsToSite ? '✓ ' : ''}현장 기본값 저장 (유지)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveOptionsToSite(false);
                      setStatusMessage('이번 출고에만 1회성으로 적용하고 기존 현장 옵션은 보존합니다.');
                    }}
                    style={{
                      padding: '8px 6px',
                      borderRadius: '8px',
                      border: !saveOptionsToSite ? '2px solid #3b82f6' : '1px solid #334155',
                      backgroundColor: !saveOptionsToSite ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                      color: !saveOptionsToSite ? '#60a5fa' : '#64748b',
                      fontSize: '11.5px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    {!saveOptionsToSite ? '✓ ' : ''}이번만 1회성 적용 (보존)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 6. 하단 마이크 및 실행 버튼 바 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
          {currentStep !== 'CONFIRM' ? (
            <>
              {/* 대형 마이크 토글 버튼 */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                style={{
                  flex: 1,
                  padding: '14px',
                  borderRadius: '16px',
                  border: 'none',
                  cursor: isProcessing ? 'wait' : 'pointer',
                  backgroundColor: isRecording ? '#ef4444' : '#2563eb',
                  color: '#ffffff',
                  fontSize: '15px',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: isRecording ? '0 0 15px rgba(239, 68, 68, 0.5)' : '0 4px 12px rgba(37, 99, 235, 0.4)',
                  transition: 'all 0.15s ease'
                }}
              >
                {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                <span>{isRecording ? '터치하여 발화 완료' : '마이크 켜고 말하기'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  // 다음 단계 수동 건너뛰기
                  if (currentStep === 'CUSTOMER') setCurrentStep('SITE');
                  else if (currentStep === 'SITE') setCurrentStep('EQUIPMENT');
                  else if (currentStep === 'EQUIPMENT') setCurrentStep('DATETIME');
                  else if (currentStep === 'DATETIME') setCurrentStep('OPTIONS_NOTE');
                  else if (currentStep === 'OPTIONS_NOTE') setCurrentStep('CONFIRM');
                }}
                style={{
                  padding: '14px 16px',
                  borderRadius: '16px',
                  border: '1px solid #475569',
                  backgroundColor: '#1e293b',
                  color: '#94a3b8',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                건너뛰기
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleFinalSubmit}
              style={{
                width: '100%',
                padding: '15px',
                borderRadius: '16px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: '#10b981',
                color: '#ffffff',
                fontSize: '16px',
                fontWeight: '900',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 15px rgba(16, 185, 129, 0.4)'
              }}
            >
              <Check size={20} />
              <span>전산 출고의뢰 최종 등록</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};