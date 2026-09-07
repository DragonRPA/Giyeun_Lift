// src/mobile/pages/MobileAsCreate.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { CameraUploader } from '../components/CameraUploader';
import { 
  ArrowLeft, Check, Plus, AlertTriangle, Mic, MicOff, 
  FileText, RotateCcw, Sparkles, X, CheckCircle2, MapPin, Volume2, VolumeX
} from 'lucide-react';
import { parseAsCallTranscript } from '../../services/voiceOrderDraftService';
import { resolveSiteDetailedAddress } from '../../utils/nativeLauncher';
import { ttsService } from '../../services/ttsService';

interface MobileAsCreateProps {
  onBack: () => void;
  onCreated: (ticketId: string) => void;
  initialAssetNo?: string;
  initialSiteId?: string;
}

const CATEGORIES = [
  '방지봉/협착',
  '상하강불량',
  '충전/전원',
  '오일누유',
  '키박스/스위치',
  '에러코드',
  '파이프걸림',
  '점검요청',
  '기타',
];

export const MobileAsCreate: React.FC<MobileAsCreateProps> = ({ 
  onBack, 
  onCreated,
  initialAssetNo,
  initialSiteId
}) => {
  const { createFieldAsTicket, showErrorModal, customers, sites, assets, contracts, contractAssets } = useApp();

  const [customerName, setCustomerName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [assetNo, setAssetNo] = useState(initialAssetNo || '');
  const [locationDetail, setLocationDetail] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [issueCategory, setIssueCategory] = useState('상하강불량');
  const [issueDescription, setIssueDescription] = useState('');
  const [priority, setPriority] = useState<'NORMAL' | 'URGENT'>('NORMAL');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split('T')[0]);
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 음성 및 통화 텍스트 파싱 상태
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => ttsService.getIsEnabled());
  const [interimText, setInterimText] = useState('');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedTranscript, setPastedTranscript] = useState('');
  const [recentModifiedFields, setRecentModifiedFields] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // 🌟 1. 장비번호 입력 시 계약 현장 및 고객사·도로명 주소 실시간 자동 역추적
  const handleAssetNoChange = (val: string) => {
    setAssetNo(val);
    const clean = val.trim().toUpperCase();
    if (!clean) return;

    const matchedAsset = assets.find(a => a.assetNo.toUpperCase() === clean);
    if (matchedAsset) {
      const ca = contractAssets.find(c => c.assetId === matchedAsset.id && !c.actualReturnDate);
      if (ca) {
        const contract = contracts.find(c => c.id === ca.contractId);
        if (contract) {
          const cust = customers.find(c => c.id === contract.customerId);
          if (cust && !customerName) setCustomerName(cust.name);
          if (contract.siteId) {
            const site = sites.find(s => s.id === contract.siteId);
            if (site) {
              setSiteName(site.name);
              if (site.address?.trim()) setSiteAddress(site.address.trim());
              else if (cust?.address?.trim()) setSiteAddress(cust.address.trim());
            }
          } else if (cust?.address?.trim()) {
            setSiteAddress(cust.address.trim());
          }
        }
      }
    }
  };

  // 🌟 초기 인계 파라미터(내현장/자산조회 등에서 유입) 자동 바인딩 (헌장 1.1 & 과제 6)
  useEffect(() => {
    if (initialAssetNo) {
      handleAssetNoChange(initialAssetNo);
    }
    if (initialSiteId) {
      const site = sites.find(s => s.id === initialSiteId);
      if (site) {
        setSiteName(site.name);
        if (site.address?.trim()) setSiteAddress(site.address.trim());
        const cust = customers.find(c => c.id === site.customerId);
        if (cust && !customerName) setCustomerName(cust.name);
      }
    }
  }, [initialAssetNo, initialSiteId]);

  // 🌟 2. 고객사명 입력 시 마스터 일치 및 현장·도로명 주소 상속
  const handleCustomerNameChange = (val: string) => {
    setCustomerName(val);
    const clean = val.trim();
    if (!clean) return;

    const cust = customers.find(c => c.name.trim() === clean || c.name.includes(clean));
    if (cust) {
      const cSites = sites.filter(s => s.customerId === cust.id);
      if (cSites.length === 1) {
        setSiteName(cSites[0].name);
        if (cSites[0].address?.trim()) {
          setSiteAddress(cSites[0].address.trim());
        } else if (cust.address?.trim()) {
          setSiteAddress(cust.address.trim());
        }
      } else if (cust.address?.trim() && !siteAddress) {
        setSiteAddress(cust.address.trim());
      }
    }
  };

  // 🌟 3. 현장명 입력 시 현장 상세 주소 상속
  const handleSiteNameChange = (val: string) => {
    setSiteName(val);
    const clean = val.trim();
    if (!clean) return;

    const matchedCust = customers.find(c => c.name.trim() === customerName.trim() || c.name.includes(customerName.trim()));
    const cSites = matchedCust ? sites.filter(s => s.customerId === matchedCust.id) : sites;
    const site = cSites.find(s => s.name.trim() === clean || s.name.includes(clean) || clean.includes(s.name.trim()));
    if (site?.address?.trim()) {
      setSiteAddress(site.address.trim());
    }
  };

  // 통화 텍스트 파싱 및 폼 자동 반영 공통 함수
  const applyTranscript = (text: string) => {
    if (!text.trim()) return;
    const result = parseAsCallTranscript(text, customers || [], sites || [], assets || []);

    if (result.customerName) setCustomerName(result.customerName);
    if (result.siteName) setSiteName(result.siteName);
    if (result.siteAddress) {
      setSiteAddress(result.siteAddress);
    } else {
      const resolved = resolveSiteDetailedAddress({
        siteName: result.siteName || siteName,
        customerName: result.customerName || customerName,
        assetNo: result.assetNo || assetNo,
        locationDetail: result.locationDetail || locationDetail,
        customerSites: sites,
        contracts,
        contractAssets,
        customers,
      });
      if (resolved && resolved !== (result.siteName || result.customerName || '현장')) {
        setSiteAddress(resolved);
      }
    }
    if (result.assetNo) setAssetNo(result.assetNo);
    if (result.locationDetail) setLocationDetail(result.locationDetail);
    if (result.reporterName) setReporterName(result.reporterName);
    if (result.reporterContact) setReporterContact(result.reporterContact);
    if (result.issueCategory && CATEGORIES.includes(result.issueCategory)) {
      setIssueCategory(result.issueCategory);
    }
    if (result.issueDescription) setIssueDescription(result.issueDescription);
    if (result.priority) setPriority(result.priority);

    setRecentModifiedFields(result.modifiedFields);
  };

  // 고정밀 Groq Whisper STT 및 Web Speech 폴백 음성 제어
  const toggleListening = async () => {
    if (isListening) {
      // 녹음 종료 및 STT 분석
      setIsListening(false);

      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
        return;
      }

      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        return;
      }

      setIsProcessing(true);
      setInterimText('음성을 분석하고 있습니다...');

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
            setInterimText('');
            return;
          }

          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = async () => {
            const base64Audio = reader.result as string;
            try {
              const res = await fetch('/api/groq-stt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audioBase64: base64Audio,
                  mimeType: mime,
                  language: 'ko',
                  prompt: '고소작업대 현장 긴급 AS 접수 고장수리. 증상: 상하강불량, 충전 전원 방전, 오일누유, 키박스 스위치 레버 조이스틱, 에러코드, 방지봉 협착, 파이프걸림. 긴급, 당장. 관리번호 장비번호 호기.'
                })
              });

              if (res.ok) {
                const data = await res.json();
                const text = (data?.textTranscript || '').trim();
                if (text) {
                  applyTranscript(text);
                  setInterimText(`인식완료: "${text}"`);
                  if (ttsService.getIsEnabled()) {
                    ttsService.speak('AS 정보가 폼에 반영되었습니다.');
                  }
                  setTimeout(() => setInterimText(''), 3000);
                } else {
                  setInterimText('음성이 명확하지 않습니다.');
                }
              } else {
                throw new Error('STT API 오류');
              }
            } catch (err) {
              console.warn('Groq STT failed:', err);
              setInterimText('음성 분석 실패. 다시 시도해주세요.');
            } finally {
              setIsProcessing(false);
            }
          };
        } catch (e) {
          setIsProcessing(false);
          setInterimText('');
        }
      };

      mediaRecorderRef.current.stop();
      return;
    }

    // 녹음 시작
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

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
        setIsListening(true);
        setInterimText('음성 듣는 중... (말씀 후 터치하여 완료)');
      } else {
        startBrowserAsStt();
      }
    } catch (err: any) {
      console.warn('Microphone error, fallback to browser STT:', err);
      startBrowserAsStt();
    }
  };

  const startBrowserAsStt = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showErrorModal('이 브라우저는 음성 인식을 지원하지 않습니다.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setInterimText('음성 듣는 중... (말씀해 주세요)');
      };

      recognition.onresult = (event: any) => {
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript;
        }
        if (finalChunk.trim()) {
          applyTranscript(finalChunk.trim());
          setInterimText('');
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
        setInterimText('');
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText('');
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setIsListening(false);
    }
  };

  const handlePasteSubmit = () => {
    if (!pastedTranscript.trim()) return;
    applyTranscript(pastedTranscript);
    setShowPasteModal(false);
    setPastedTranscript('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !assetNo.trim()) {
      showErrorModal('고객사명과 장비번호는 필수 입력 항목입니다.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 🌟 고객사 및 현장 마스터 ID 자동 매핑 (도로명 주소 상속 보장)
      const matchedCust = customers.find(c => c.name.trim() === customerName.trim() || c.name.includes(customerName.trim()));
      const matchedSite = sites.find(s => 
        (matchedCust ? s.customerId === matchedCust.id : true) && 
        (s.name.trim() === siteName.trim() || s.name.includes(siteName.trim()) || siteName.trim().includes(s.name))
      );

      const ticket = await createFieldAsTicket({
        customerId: matchedCust?.id,
        customerName: customerName.trim(),
        siteId: matchedSite?.id,
        siteName: siteName.trim(),
        siteAddress: siteAddress.trim(),
        assetNo: assetNo.toUpperCase(),
        locationDetail,
        reporterName,
        reporterContact,
        issueCategory,
        issueDescription,
        priority,
        visitDate,
        scheduleDate: visitDate,
        faultImageUrl: images[0] || '',
        evidenceImages: images,
      });

      onCreated(ticket.id);
    } catch (err: any) {
      showErrorModal('접수 등록 실패: ' + (err.message || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  const matchedCustomer = customers.find(c => 
    c.name.trim() === customerName.trim() || 
    (customerName.trim().length >= 2 && c.name.includes(customerName.trim()))
  );
  const matchedCustomerSites = matchedCustomer 
    ? sites.filter(s => s.customerId === matchedCustomer.id) 
    : [];

  return (
    <div className="flex flex-col gap-4 pb-28 p-4 bg-slate-950 min-h-screen">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-300 py-2 px-3 rounded-xl bg-slate-900 border border-slate-800 active:scale-95 transition-transform"
        >
          <ArrowLeft className="w-4 h-4" />
          뒤로가기
        </button>
        <span className="text-sm font-black text-white">현장 AS 접수</span>
        <button
          type="button"
          onClick={() => {
            const next = ttsService.toggle();
            setTtsEnabled(next);
          }}
          className={`flex items-center gap-1 text-[11px] font-bold py-1.5 px-2.5 rounded-xl border transition-all ${
            ttsEnabled
              ? 'bg-blue-600/20 border-blue-500 text-blue-400'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
          title="음성 안내(TTS) 켜기/끄기"
        >
          {ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{ttsEnabled ? '소리 ON' : '소리 OFF'}</span>
        </button>
      </div>

      {/* 🎙️ 음성 & 통화 텍스트 입력 바 */}
      <div className="p-3 rounded-2xl bg-gradient-to-r from-blue-950/40 via-slate-900 to-indigo-950/40 border border-blue-800/40 flex flex-col gap-2 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-blue-300 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              통화 음성/텍스트 자동 입력
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowPasteModal(true)}
              className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1 border border-slate-700 active:scale-95"
            >
              <FileText className="w-3.5 h-3.5 text-blue-400" />
              통화 텍스트
            </button>
            <button
              type="button"
              onClick={toggleListening}
              className={`py-1 px-3 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all shadow-md active:scale-95 ${
                isListening
                  ? 'bg-rose-600 text-white animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  듣는중...
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  음성 접수
                </>
              )}
            </button>
          </div>
        </div>

        {/* 실시간 음성 수신 미리보기 */}
        {isListening && interimText && (
          <div className="p-2 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-200 text-xs font-medium">
            🎙️ {interimText}
          </div>
        )}

        {/* 최근 인식/추출된 필드 태그 */}
        {recentModifiedFields.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800/80">
            {recentModifiedFields.map((field, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[11px] font-bold flex items-center gap-1"
              >
                <Check className="w-3 h-3 text-blue-400" />
                {field}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* AS 접수 폼 */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* 장비번호 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
            장비번호 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
            value={assetNo}
            onChange={(e) => handleAssetNoChange(e.target.value)}
            placeholder="예: 102, G19-01, 1001"
            className="w-full rounded-xl p-3 text-sm font-mono uppercase placeholder-slate-500 focus:outline-none"
            style={{
              backgroundColor: '#090d16',
              color: '#f8fafc',
              border: '1px solid #334155',
              colorScheme: 'dark'
            }}
          />
        </div>

        {/* 고객사명 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
            고객사명 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
            value={customerName}
            onChange={(e) => handleCustomerNameChange(e.target.value)}
            placeholder="고객사 상호명 입력"
            className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none"
            style={{
              backgroundColor: '#090d16',
              color: '#f8fafc',
              border: '1px solid #334155',
              colorScheme: 'dark'
            }}
          />
        </div>

        {/* 고객사 소속 현장 퀵 셀렉트 칩 */}
        {matchedCustomerSites.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap flex-shrink-0">
              등록 현장 선택
            </span>
            <div className="w-full min-w-0 max-w-full overflow-x-auto flex items-center gap-1.5 pb-1 scrollbar-none">
              {matchedCustomerSites.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSiteName(s.name);
                    if (s.address?.trim()) setSiteAddress(s.address.trim());
                    else if (matchedCustomer?.address?.trim()) setSiteAddress(matchedCustomer.address.trim());
                  }}
                  className={`text-xs px-2.5 py-1 rounded-lg border whitespace-nowrap flex-shrink-0 transition-colors ${
                    siteName === s.name
                      ? 'bg-blue-600 text-white border-blue-500 font-bold'
                      : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 현장명 / 상세 위치 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">현장명</label>
            <input
              type="text"
              value={siteName}
              onChange={(e) => handleSiteNameChange(e.target.value)}
              placeholder="현장 이름"
              className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">상세 위치</label>
            <input
              type="text"
              value={locationDetail}
              onChange={(e) => setLocationDetail(e.target.value)}
              placeholder="예: 지하 1층, 하역장"
              className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
            />
          </div>
        </div>

        {/* 현장 도로명 주소 (T맵/카카오내비/네이버지도 연동) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
              현장 도로명 주소
            </label>
            {matchedCustomer?.address && siteAddress !== matchedCustomer.address.trim() && (
              <button
                type="button"
                onClick={() => setSiteAddress(matchedCustomer.address.trim())}
                className="text-[10px] font-bold text-sky-400 bg-sky-950/40 hover:bg-sky-900/60 px-2 py-0.5 rounded border border-sky-800/40 whitespace-nowrap flex-shrink-0"
              >
                고객사 주소 적용
              </button>
            )}
          </div>
          <div className="relative">
            <input
              type="text"
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              placeholder="도로명 주소 입력 (고객 정보 자동 연동)"
              className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none pr-9"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
            />
            {siteAddress && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sky-400 pointer-events-none">
                <MapPin className="w-4 h-4" />
              </div>
            )}
          </div>
        </div>

        {/* 고장 분류 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-300">고장 분류</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">우선순위:</span>
              <button
                type="button"
                onClick={() => setPriority(priority === 'NORMAL' ? 'URGENT' : 'NORMAL')}
                className={`px-2 py-0.5 rounded text-[11px] font-black border transition-colors ${
                  priority === 'URGENT'
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {priority === 'URGENT' ? '🚨 긴급(URGENT)' : '일반'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setIssueCategory(cat)}
                className={`py-2 px-1 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  issueCategory === cat
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 고장 상세 증상 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">고장 상세 내용</label>
          <textarea
            rows={3}
            value={issueDescription}
            onChange={(e) => setIssueDescription(e.target.value)}
            placeholder="고장 호소 내용 입력"
            className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none"
            style={{
              backgroundColor: '#090d16',
              color: '#f8fafc',
              border: '1px solid #334155',
              colorScheme: 'dark'
            }}
          />
        </div>

        {/* 접수자 성함 및 연락처 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">접수자 성함</label>
            <input
              type="text"
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              placeholder="예: 김반장, 이소장"
              className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">연락처</label>
            <input
              type="tel"
              value={reporterContact}
              onChange={(e) => setReporterContact(e.target.value)}
              placeholder="010-0000-0000"
              className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
            />
          </div>
        </div>

        {/* 방문 예정일 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">방문 예정일</label>
          <input
            type="date"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            className="w-full rounded-xl p-3 text-sm placeholder-slate-500 focus:outline-none"
            style={{
              backgroundColor: '#090d16',
              color: '#f8fafc',
              border: '1px solid #334155',
              colorScheme: 'dark'
            }}
          />
        </div>

        {/* 고장 현장 사진 첨부 */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <CameraUploader
            label="고장 현장 사진 첨부 / 촬영"
            images={images}
            onChange={setImages}
            maxImages={4}
          />
        </div>

        {/* 접수 등록 버튼 */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-base shadow-xl active:scale-98 transition-all"
        >
          {isSubmitting ? '접수 등록 중...' : '현장 AS 접수 등록'}
        </button>
      </form>

      {/* 📋 통화 텍스트 붙여넣기 모달 */}
      {showPasteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                고객 통화 녹음 텍스트 입력
              </h3>
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              rows={5}
              value={pastedTranscript}
              onChange={(e) => setPastedTranscript(e.target.value)}
              placeholder="통화 내용을 붙여넣으세요...\n예: 102호기 상승이 안되고 삐소리 남, 내일 오전 김반장 010-1234-5678 판교 현장 급해요"
              className="w-full rounded-xl p-3 text-xs placeholder-slate-500 focus:outline-none font-sans leading-relaxed"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                border: '1px solid #334155',
                colorScheme: 'dark'
              }}
            />

            {/* 테스트용 예시 버튼 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-slate-400">테스트 예시:</span>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setPastedTranscript('102호기 상승이 안되고 삐소리 남, 김반장 010-1234-5678 지하 1층 급해요')}
                  className="text-left py-1.5 px-2.5 rounded-lg bg-slate-800 text-[11px] text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  "102호기 상승이 안되고 삐소리 남, 김반장 010-1234-5678 지하 1층 급해요"
                </button>
                <button
                  type="button"
                  onClick={() => setPastedTranscript('205호 배터리 방전 시동 안걸림 하역장 이소장 010-9876-5432 점검요청')}
                  className="text-left py-1.5 px-2.5 rounded-lg bg-slate-800 text-[11px] text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  "205호 배터리 방전 시동 안걸림 하역장 이소장 010-9876-5432 점검요청"
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handlePasteSubmit}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-lg"
              >
                파싱 및 자동 반영
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
