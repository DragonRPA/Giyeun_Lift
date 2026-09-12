// src/mobile/components/VoiceMemoDispatchStudioModal.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mic, MicOff, Volume2, VolumeX, X, CheckCircle2, AlertCircle,
  RotateCcw, Sparkles, Building2, MapPin, Calendar, Clock,
  Phone, Truck, Settings, Send, ArrowRight, ChevronRight, Check,
  Radio, Play, Square, FileText, CornerDownRight, MessageSquare
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ttsService } from '../../services/ttsService';
import {
  VoiceOrderDraft,
  createEmptyDraft,
  loadVoiceOrderDraft,
  saveVoiceOrderDraft,
  clearVoiceOrderDraft,
  mergeVoiceFragmentToDraft,
  evaluateOrderSlotsStatus,
  OrderSlotsStatus
} from '../../services/voiceOrderDraftService';

interface VoiceMemoDispatchStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onHandOffToForm: (draft: VoiceOrderDraft) => void;
  onDirectSubmitSuccess?: (result: { contractNo: string; siteName: string; totalCount: number }) => void;
}

export const VoiceMemoDispatchStudioModal: React.FC<VoiceMemoDispatchStudioModalProps> = ({
  isOpen,
  onClose,
  onHandOffToForm,
  onDirectSubmitSuccess
}) => {
  const { customers, sites, contracts, contractAssets, currentUser, saveSmartDispatch, refreshAllData, showErrorModal } = useApp();

  // 1. 임시저장 draft 상태
  const [draft, setDraft] = useState<VoiceOrderDraft>(() => {
    return loadVoiceOrderDraft() || createEmptyDraft();
  });

  // 2. 음성인식 상태
  const [isListening, setIsListening] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true); // 기본 연속 청취 ON
  const [interimText, setInterimText] = useState('');
  const [recentSpokenText, setRecentSpokenText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => ttsService.getIsEnabled());
  const [autoSubmitOnVoice, setAutoSubmitOnVoice] = useState(true);

  // 음성인식 Ref
  const recognitionRef = useRef<any>(null);
  const isContinuousRef = useRef(continuousMode);
  isContinuousRef.current = continuousMode;
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 3. 5대 핵심 항목 충족 상태 실시간 평가
  const slotsStatus: OrderSlotsStatus = useMemo(() => {
    return evaluateOrderSlotsStatus(draft);
  }, [draft]);

  // 모달 오픈 시 저장된 draft 동기화
  useEffect(() => {
    if (isOpen) {
      const saved = loadVoiceOrderDraft();
      if (saved) {
        setDraft(saved);
      }
    } else {
      stopListening();
    }
  }, [isOpen]);

  // 음성인식 중지
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
  }, []);

  // 음성 조각 병합 및 분석
  const handleProcessSpeech = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;

    setRecentSpokenText(clean);

    // 완결 음성 명령 감지: 5개 항목 완성 상태에서 "접수", "의뢰 접수", "출고해줘" 발화 시
    const isComplete = slotsStatus.isAllComplete;
    if (isComplete && /접수|출고해|완료해/i.test(clean)) {
      if (autoSubmitOnVoice) {
        handleDirectSubmit();
        return;
      }
    }

    // "초기화" 명령 감지
    if (/전체 초기화|처음부터|모두 지워/i.test(clean)) {
      handleResetDraft();
      if (ttsEnabled) {
        ttsService.speak('음성 메모를 초기화했습니다. 다시 말씀해 주세요.');
      }
      return;
    }

    const { updatedDraft, modifiedFields } = mergeVoiceFragmentToDraft(
      draftRef.current,
      clean,
      customers,
      sites
    );

    setDraft(updatedDraft);
    saveVoiceOrderDraft(updatedDraft);

    // 슬롯 재평가 후 TTS 가이드 피드백
    const nextStatus = evaluateOrderSlotsStatus(updatedDraft);
    if (ttsEnabled) {
      if (nextStatus.isAllComplete && !slotsStatus.isAllComplete) {
        ttsService.speak('모든 필수 항목이 완성되었습니다. 출고의뢰를 접수하시겠습니까?');
      } else if (modifiedFields.length > 0 && !nextStatus.isAllComplete) {
        // 단축 피드백: 결측 항목 안내
        const missing = nextStatus.missingSlotPrompts[0];
        if (missing) {
          ttsService.speak(missing.split(' (')[0]);
        }
      }
    }
  }, [customers, sites, slotsStatus.isAllComplete, autoSubmitOnVoice, ttsEnabled]);

  // 음성인식 시작
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showErrorModal('현재 브라우저 환경에서 마이크 음성 인식을 지원하지 않습니다. Chrome 또는 사파리를 이용해 주세요.');
      return;
    }

    stopListening();

    try {
      const rec = new SpeechRecognition();
      rec.lang = 'ko-KR';
      rec.continuous = isContinuousRef.current;
      rec.interimResults = true;
      recognitionRef.current = rec;

      rec.onstart = () => {
        setIsListening(true);
        setInterimText('');
      };

      rec.onresult = (event: any) => {
        let finalTrans = '';
        let interimTrans = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTrans += item[0].transcript;
          } else {
            interimTrans += item[0].transcript;
          }
        }

        setInterimText(interimTrans || finalTrans);

        if (finalTrans.trim()) {
          handleProcessSpeech(finalTrans.trim());
          setInterimText('');
        }
      };

      rec.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
          setIsListening(false);
        }
      };

      rec.onend = () => {
        // 연속 청취 모드 활성화 시 자동 재시작
        if (isContinuousRef.current && isListeningRef.current) {
          try {
            rec.start();
            return;
          } catch (e) {
            setIsListening(false);
          }
        } else {
          setIsListening(false);
        }
      };

      rec.start();
    } catch (e: any) {
      console.error('Failed to start SpeechRecognition:', e);
      setIsListening(false);
    }
  }, [handleProcessSpeech, stopListening, showErrorModal]);

  // 마이크 토글
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // 초기화 핸들러
  const handleResetDraft = () => {
    clearVoiceOrderDraft();
    const empty = createEmptyDraft();
    setDraft(empty);
    setRecentSpokenText('');
    setInterimText('');
  };

  // TTS 토글
  const toggleTts = () => {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    ttsService.setIsEnabled(next);
    if (next) {
      ttsService.speak('음성 안내가 켜졌습니다.');
    }
  };

  // 일반 서식으로 전달 (Handoff)
  const handleHandOff = () => {
    stopListening();
    saveVoiceOrderDraft(draft);
    onHandOffToForm(draft);
    onClose();
  };

  // 출고의뢰 즉시 접수 (Direct Submit)
  const handleDirectSubmit = async () => {
    if (!slotsStatus.isAllComplete) {
      showErrorModal(`출고의뢰 접수를 위해 다음 필수 항목을 먼저 말씀해 주세요:\n\n${slotsStatus.missingSlotPrompts.join('\n')}`);
      return;
    }

    setIsSubmitting(true);
    stopListening();

    try {
      // 1. 고객사 확정
      const custName = draft.customerName.trim() || '고객사';
      const siteName = draft.siteName.trim() || draft.newSiteName.trim() || '신규 현장';
      const totalCount = draft.orders.reduce((sum, o) => sum + (o.count || 1), 0);

      // 장비 목록 구성
      const SPEC_DEFAULT_MONTHLY_RENT: Record<string, number> = {
        '19ft': 400000, '26ft': 500000, '32ft': 600000, '40ft': 900000, '46ft': 1200000, '53ft': 1500000
      };

      const custContractIds = contracts.filter(c => c.customerId === draft.customerId).map(c => c.id);
      const recentCa = contractAssets
        .filter(ca => custContractIds.includes(ca.contractId) && ca.monthlyRentalFee > 0)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];

      const equipmentsList: any[] = [];
      draft.orders.forEach(o => {
        const standardRent = SPEC_DEFAULT_MONTHLY_RENT[o.ft] || 400000;
        const assignedMonthly = recentCa?.monthlyRentalFee || standardRent;
        const assignedDaily = Math.round(assignedMonthly / 30);
        const safeCount = Math.max(1, Math.floor(o.count || 1));

        for (let i = 0; i < safeCount; i++) {
          equipmentsList.push({
            modelName: o.modelName || o.ft,
            spec: o.ft,
            monthlyRent: assignedMonthly,
            dailyRent: assignedDaily
          });
        }
      });

      const payload = {
        customerName: custName,
        siteName: siteName,
        siteAddress: draft.siteAddress.trim(),
        salespersonName: currentUser?.name || '영업담당',
        salespersonPhone: currentUser?.phone || '',
        siteContactName: draft.siteContactName.trim() || '현장소장',
        siteContactPhone: draft.siteContactPhone.trim(),
        siteContactEmail: '',
        billingContactName: '',
        billingContactPhone: '',
        statementEmail: '',
        taxBillEmail: draft.taxBillEmail || '',
        loadingTime: `${draft.deliveryDate} ${draft.deliveryTime}`,
        unloadingTime: `${draft.deliveryDate} ${draft.deliveryTime}`,
        equipments: equipmentsList,
        closingDay: draft.closingDay || '말일',
        paymentDay: draft.paymentDay || '익월 25일',
        note: `[자유 음성메모 출고의뢰] ${draft.memo || ''}`.trim(),
        rawText: `음성메모 출고요청: ${custName} / ${siteName} (${totalCount}대)`,
        paidOptions: draft.paidOptions || '',
        protection: draft.protection || '',
        checkedSpecs: draft.checkedSpecs || {},
        saveOptionsToSite: true,
        billableToCustomer: Boolean(draft.billableToCustomer),
        vehicleType: draft.vehicleType || '5톤 렉카',
        isSetAsCustomerDefault: false,
        applyToAllSites: false
      };

      const res = await saveSmartDispatch(payload as any, true);

      if (res && res.success) {
        clearVoiceOrderDraft();
        if (ttsEnabled) {
          ttsService.speak('출고의뢰가 시스템에 정상 접수되었습니다.');
        }

        if (onDirectSubmitSuccess) {
          onDirectSubmitSuccess({
            contractNo: res.contractNo || '신규 계약 생성됨',
            siteName: siteName,
            totalCount: totalCount
          });
        } else {
          onHandOffToForm(createEmptyDraft());
        }
        onClose();
      } else {
        throw new Error(res?.errorMessage || '출고의뢰 저장에 실패했습니다.');
      }
    } catch (err: any) {
      console.error('Direct submit error:', err);
      showErrorModal(`출고의뢰 접수 실패: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col font-sans text-slate-100 overflow-hidden">
      {/* 1. 상단 건조한 헤더 바 (헌장 3.1 & 3.2 준수) */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
            <Mic className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="font-extrabold text-sm text-white flex items-center gap-1.5 whitespace-nowrap">
              <span>음성 메모 출고의뢰</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-300">
                핸즈프리
              </span>
            </div>
            <div className="text-[10px] text-slate-400 whitespace-nowrap">순서 없이 자유롭게 음성을 남기세요</div>
          </div>
        </div>

        {/* 상단 액션 툴스 */}
        <div className="flex items-center gap-1.5">
          {/* TTS 토글 */}
          <button
            type="button"
            onClick={toggleTts}
            className={`p-2 rounded-xl border text-xs flex items-center gap-1 transition-all active:scale-95 ${
              ttsEnabled
                ? 'bg-blue-950/60 border-blue-700 text-blue-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title={ttsEnabled ? '음성 안내 켜짐' : '음성 안내 꺼짐'}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* 초기화 */}
          <button
            type="button"
            onClick={handleResetDraft}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 active:scale-95"
            title="음성 메모 초기화"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* 닫기 */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-400 hover:text-white active:scale-95 ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. 중앙 스튜디오 본문 (스크롤 영역) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3.5 max-w-lg mx-auto w-full">
        {/* 🌟 2-1. 대형 음성 제어 센터 (Hero Microphone Visualizer) */}
        <div className="bg-gradient-to-b from-slate-900 to-slate-900/90 border border-slate-800 rounded-3xl p-4 flex flex-col items-center justify-center gap-3 relative shadow-xl">
          {/* 연속 청취 모드 토글 칩 */}
          <div className="w-full flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => setContinuousMode(!continuousMode)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                continuousMode
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              <Radio className={`w-3 h-3 ${continuousMode ? 'animate-pulse text-emerald-400' : ''}`} />
              <span>{continuousMode ? '연속 청취 ON' : '1회 청취'}</span>
            </button>

            <span className="text-slate-400 font-mono text-[10px]">
              {isListening ? '🎙️ 실시간 청취 중...' : '마이크 정지'}
            </span>
          </div>

          {/* 메인 마이크 버튼 (펄스 레이더 애니메이션) */}
          <div className="relative my-2">
            {isListening && (
              <>
                <div className="absolute -inset-3 rounded-full bg-rose-500/20 animate-ping" />
                <div className="absolute -inset-1.5 rounded-full bg-rose-600/30 animate-pulse" />
              </>
            )}
            <button
              type="button"
              onClick={toggleListening}
              className={`relative w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-transform active:scale-90 ${
                isListening
                  ? 'bg-gradient-to-tr from-rose-600 to-red-500 text-white shadow-rose-900/60'
                  : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-blue-900/40'
              }`}
            >
              {isListening ? (
                <Square className="w-7 h-7 fill-white" />
              ) : (
                <Mic className="w-8 h-8" />
              )}
            </button>
          </div>

          {/* 파형 시각화 바 */}
          {isListening ? (
            <div className="flex items-center gap-1 h-5">
              <span className="w-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.1s] h-3" />
              <span className="w-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.2s] h-5" />
              <span className="w-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.3s] h-4" />
              <span className="w-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.15s] h-6" />
              <span className="w-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.25s] h-4" />
              <span className="w-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.35s] h-2" />
            </div>
          ) : (
            <div className="text-xs font-bold text-slate-300">
              마이크를 눌러 음성 메모를 시작하세요
            </div>
          )}

          {/* 실시간 전사 말풍선 */}
          <div className="w-full bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3 min-h-[44px] flex items-center justify-center text-center">
            {interimText ? (
              <span className="text-xs text-blue-300 font-medium animate-pulse">
                "{interimText}"
              </span>
            ) : recentSpokenText ? (
              <span className="text-xs text-slate-300">
                "{recentSpokenText}"
              </span>
            ) : (
              <span className="text-[11px] text-slate-400">
                예: "내일 아침 8시 동탄 포스코 현장에 19피트 2대, 김반장 010-1234-5678"
              </span>
            )}
          </div>
        </div>

        {/* 🌟 2-2. 핵심 5대 슬롯 충족 진행률 바 및 상태 배너 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs px-1">
            <span className="font-extrabold text-slate-200 flex items-center gap-1.5">
              <CheckCircle2 className={`w-4 h-4 ${slotsStatus.isAllComplete ? 'text-emerald-400' : 'text-blue-400'}`} />
              <span>출고의뢰 핵심 항목 점검</span>
            </span>
            <span className="font-mono font-black text-sm">
              <span className={slotsStatus.isAllComplete ? 'text-emerald-400' : 'text-blue-400'}>
                {slotsStatus.completedCount}
              </span>
              <span className="text-slate-500"> / {slotsStatus.totalRequiredCount}</span>
              <span className="text-xs text-slate-400 ml-1.5">({slotsStatus.completionPercent}%)</span>
            </span>
          </div>

          {/* 진행률 게이지 */}
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                slotsStatus.isAllComplete
                  ? 'bg-gradient-to-r from-emerald-500 to-green-400 shadow-lg shadow-emerald-500/50'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-500'
              }`}
              style={{ width: `${slotsStatus.completionPercent}%` }}
            />
          </div>

          {/* 지능형 결측 / 완성 안내 배너 */}
          {slotsStatus.isAllComplete ? (
            <div className="p-3 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between text-xs text-emerald-200 mt-1 shadow-md">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 animate-bounce" />
                <span className="font-bold">5대 필수 항목 100% 완성! 즉시 접수 가능</span>
              </div>
              <span className="text-[10px] text-emerald-300 font-mono">준비 완료</span>
            </div>
          ) : (
            <div className="p-2.5 rounded-2xl bg-slate-900 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-300 mt-1">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="font-medium truncate flex-1">
                {slotsStatus.nextMissingPrompt}
              </span>
            </div>
          )}
        </div>

        {/* 🌟 2-3. 5대 핵심 항목 HUD 체크리스트 카드 (2열 그리드) */}
        <div className="grid grid-cols-2 gap-2">
          {/* [1] 고객사 */}
          <div className={`p-3 rounded-2xl border flex flex-col gap-1 transition-all ${
            slotsStatus.customer.isComplete
              ? 'bg-slate-900 border-emerald-800/60'
              : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Building2 className="w-3 h-3 text-slate-400" />
                <span>고객사</span>
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                slotsStatus.customer.isComplete
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {slotsStatus.customer.isComplete ? '충족' : '결측'}
              </span>
            </div>
            <div className={`text-xs font-bold truncate mt-0.5 ${
              slotsStatus.customer.isComplete ? 'text-white' : 'text-slate-500 italic'
            }`}>
              {slotsStatus.customer.value}
            </div>
          </div>

          {/* [2] 현장명 */}
          <div className={`p-3 rounded-2xl border flex flex-col gap-1 transition-all ${
            slotsStatus.site.isComplete
              ? 'bg-slate-900 border-emerald-800/60'
              : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-slate-400" />
                <span>현장명</span>
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                slotsStatus.site.isComplete
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {slotsStatus.site.isComplete ? '충족' : '결측'}
              </span>
            </div>
            <div className={`text-xs font-bold truncate mt-0.5 ${
              slotsStatus.site.isComplete ? 'text-white' : 'text-slate-500 italic'
            }`}>
              {slotsStatus.site.value}
            </div>
          </div>

          {/* [3] 희망 출고일시 */}
          <div className={`p-3 rounded-2xl border flex flex-col gap-1 transition-all ${
            slotsStatus.dateTime.isComplete
              ? 'bg-slate-900 border-emerald-800/60'
              : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>출고일시</span>
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                slotsStatus.dateTime.isComplete
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {slotsStatus.dateTime.isComplete ? '충족' : '결측'}
              </span>
            </div>
            <div className={`text-xs font-bold truncate mt-0.5 font-mono ${
              slotsStatus.dateTime.isComplete ? 'text-emerald-400' : 'text-slate-500 italic'
            }`}>
              {slotsStatus.dateTime.value}
            </div>
          </div>

          {/* [4] 투입 장비 및 수량 */}
          <div className={`p-3 rounded-2xl border flex flex-col gap-1 transition-all ${
            slotsStatus.equipment.isComplete
              ? 'bg-slate-900 border-emerald-800/60'
              : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Truck className="w-3 h-3 text-slate-400" />
                <span>투입장비</span>
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                slotsStatus.equipment.isComplete
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {slotsStatus.equipment.isComplete ? `${slotsStatus.equipment.count}대` : '결측'}
              </span>
            </div>
            <div className={`text-xs font-bold truncate mt-0.5 ${
              slotsStatus.equipment.isComplete ? 'text-white' : 'text-slate-500 italic'
            }`}>
              {slotsStatus.equipment.value}
            </div>
          </div>

          {/* [5] 현장 담당자 연락처 (전폭 차지) */}
          <div className={`col-span-2 p-3 rounded-2xl border flex flex-col gap-1 transition-all ${
            slotsStatus.contact.isComplete
              ? 'bg-slate-900 border-emerald-800/60'
              : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Phone className="w-3 h-3 text-slate-400" />
                <span>현장 담당자 연락처</span>
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                slotsStatus.contact.isComplete
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {slotsStatus.contact.isComplete ? '충족' : '결측 (필수)'}
              </span>
            </div>
            <div className={`text-xs font-bold truncate mt-0.5 font-mono ${
              slotsStatus.contact.isComplete ? 'text-sky-300' : 'text-slate-500 italic'
            }`}>
              {slotsStatus.contact.value}
            </div>
          </div>
        </div>

        {/* 🌟 2-4. 보조 운송/옵션 정보 (1줄 요약 바) */}
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-2.5 flex items-center justify-between text-[11px] text-slate-400">
          <span className="truncate flex-1">
            운송: <strong className="text-slate-300">{slotsStatus.transport.value}</strong>
          </span>
          <span className="text-slate-600 mx-1.5">•</span>
          <span className="truncate flex-1 text-right">
            옵션: <strong className="text-slate-300">{slotsStatus.options.value}</strong>
          </span>
        </div>

        {/* 🌟 2-5. 음성 메모 누적 피드 (Snippets History) */}
        {(draft.snippets || []).length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="text-[11px] font-bold text-slate-400 flex items-center justify-between px-1">
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                <span>남긴 음성 메모 ({(draft.snippets || []).length}건)</span>
              </span>
            </div>
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-2.5 flex flex-col gap-1.5 max-h-36 overflow-y-auto">
              {draft.snippets.map((snip, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <span className="text-[10px] text-slate-400 font-mono shrink-0 mt-0.5">
                    {snip.timestamp}
                  </span>
                  <span className="text-slate-300 flex-1 break-all">
                    {snip.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. 최하단 종단 액션 바 (Z-패턴 헌장 3.5 준수) */}
      <div className="p-3 bg-slate-900 border-t border-slate-800 flex flex-col gap-2 shrink-0">
        <div className="flex gap-2">
          {/* 일반 서식으로 전달 (미세 조정) */}
          <button
            type="button"
            onClick={handleHandOff}
            className="flex-1 py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>일반 서식으로 전달</span>
          </button>

          {/* 출고의뢰 즉시 접수 버튼 */}
          <button
            type="button"
            disabled={!slotsStatus.isAllComplete || isSubmitting}
            onClick={handleDirectSubmit}
            className={`flex-[2] py-3.5 px-4 rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-lg transition-all ${
              slotsStatus.isAllComplete && !isSubmitting
                ? 'bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white shadow-emerald-600/40 active:scale-95'
                : 'bg-slate-800/80 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>출고의뢰 접수 처리 중...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>
                  {slotsStatus.isAllComplete
                    ? '출고의뢰 즉시 접수 (완결)'
                    : `출고의뢰 접수 대기 (${slotsStatus.completedCount}/5)`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};