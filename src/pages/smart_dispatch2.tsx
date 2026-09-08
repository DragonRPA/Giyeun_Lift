// src/pages/smart_dispatch2.tsx
// 출고의뢰2 - 새 설계안 (A/B 비교 테스트용)
// ┌─────────────────────────────────────────────────────────┐
// │  설계 원칙                                               │
// │  1. 상단 스마트 드롭바 단 1개 (카톡 줄글 붙여넣기 → Enter) │
// │  2. 단일 전체폭 캔버스 폼 (좌우 2단 분할 없음)             │
// │  3. 장바구니 패널: 규격 칩 클릭 + 수량 증감               │
// │  4. 음성 마이크: 드롭바에만 1개 배치                       │
// │  5. 6단계 위자드 완전 폐기                                │
// └─────────────────────────────────────────────────────────┘
import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { findCustomerByNormalizedName, STANDARD_SPECS } from '../services/db';
import { isOptionsChangedFromSite, EQUIPMENT_SPEC_MATRIX } from '../services/voiceOrderDraftService';
import {
  Zap, Mic, MicOff, Plus, Minus, Trash2, CheckCircle2, AlertTriangle,
  ShoppingCart, RotateCcw, ClipboardPaste
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────
interface EquipmentItem {
  modelName: string;
  qty: number;
}

// 규격 칩 매트릭스에서 ft 그룹 목록 추출 (배열 → ft 필드 기준 유니크 정렬)
const FT_GROUPS = Array.from(new Set(EQUIPMENT_SPEC_MATRIX.map(item => item.ft)))
  .sort((a, b) => parseInt(a) - parseInt(b));

// ft별 모델 목록 조회
const getModelsByFt = (ft: string) => EQUIPMENT_SPEC_MATRIX.filter(item => item.ft === ft);

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export const SmartDispatch2: React.FC = () => {
  const {
    hasPermission, saveSmartDispatch, assets, products, showErrorModal,
    users, contracts, currentUser, customers, contacts, sites, billings
  } = useApp();
  const canSave = hasPermission('delivery', 'save');

  // ── 토스트 ──────────────────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ── 스마트 드롭바 ──────────────────────────────────────────────────────────
  const [dropBarText, setDropBarText] = useState('');
  const dropBarRef = useRef<HTMLTextAreaElement>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // ── 폼 상태 ─────────────────────────────────────────────────────────────────
  const [contractNo, setContractNo] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [dispatchOverdueAcknowledged, setDispatchOverdueAcknowledged] = useState(false);

  const [salespersonName, setSalespersonName] = useState('');
  const [salespersonPhone, setSalespersonPhone] = useState('');
  const [siteContactName, setSiteContactName] = useState('');
  const [siteContactPhone, setSiteContactPhone] = useState('');
  const [siteContactEmail, setSiteContactEmail] = useState('');
  const [billingContactName, setBillingContactName] = useState('');
  const [billingContactPhone, setBillingContactPhone] = useState('');
  const [statementEmail, setStatementEmail] = useState('');
  const [taxBillEmail, setTaxBillEmail] = useState('');

  const [loadingTime, setLoadingTime] = useState('');
  const [unloadingTime, setUnloadingTime] = useState('');

  // 장바구니
  const [equipments, setEquipments] = useState<EquipmentItem[]>([]);
  const [activeFt, setActiveFt] = useState<string>(FT_GROUPS[0] || '19ft');

  const [paidOptions, setPaidOptions] = useState('');
  const [protection, setProtection] = useState('');
  const [checkedSpecs, setCheckedSpecs] = useState<Record<string, boolean>>({});
  const [showAllSpecs, setShowAllSpecs] = useState(false);
  const [isSetAsCustomerDefault, setIsSetAsCustomerDefault] = useState(false);
  const [applyToAllSites, setApplyToAllSites] = useState(false);
  const [saveOptionsToSite, setSaveOptionsToSite] = useState(true);
  const [closingDay, setClosingDay] = useState('');
  const [paymentDay, setPaymentDay] = useState('');
  const [note, setNote] = useState('');

  const [inheritedFieldList, setInheritedFieldList] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessingModalOpen, setIsProcessingModalOpen] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentStepText, setCurrentStepText] = useState('');
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [isProcessCompleted, setIsProcessCompleted] = useState(false);

  const uniqueModels = useMemo(() =>
    Array.from(new Set(assets.map(a => a.modelName).filter(Boolean))).sort()
  , [assets]);

  // ── 연체 감지 ────────────────────────────────────────────────────────────────
  const matchedCustOverdue = useMemo(() => {
    const mc = findCustomerByNormalizedName(customers, customerName);
    if (!mc) return null;
    const custBillings = billings.filter(b => b.customerId === mc.id && b.status !== 'PAID' && (b.totalAmount - b.paidAmount) > 0);
    const overdueSum = custBillings.reduce((s, b) => s + (b.totalAmount - b.paidAmount), 0);
    if (overdueSum <= 0 && mc.transactionStatus !== 'BLOCKED') return null;
    return { overdueSum, count: custBillings.length, isBlocked: mc.transactionStatus === 'BLOCKED' };
  }, [customers, customerName, billings]);

  const currentMatchedCustomer = useMemo(() =>
    findCustomerByNormalizedName(customers, customerName)
  , [customers, customerName]);

  const currentMatchedSite = useMemo(() => {
    if (!currentMatchedCustomer || !siteName) return null;
    const cleanSite = siteName.replace(/\s/g, '');
    return sites.find(s => s.customerId === currentMatchedCustomer.id && (
      s.name.replace(/\s/g, '') === cleanSite || s.name.includes(siteName) || siteName.includes(s.name)
    )) || null;
  }, [sites, currentMatchedCustomer, siteName]);

  const isOptionsDiff = useMemo(() =>
    isOptionsChangedFromSite(currentMatchedSite, paidOptions, protection, checkedSpecs)
  , [currentMatchedSite, paidOptions, protection, checkedSpecs]);

  // ── 자동 상속 엔진 ────────────────────────────────────────────────────────────
  const applyAutoInheritance = useCallback((
    cName: string,
    sName: string,
    current: {
      address: string; salespersonName: string; salespersonPhone: string;
      siteContactName: string; siteContactPhone: string; siteContactEmail: string;
      billingContactName: string; billingContactPhone: string;
      statementEmail: string; taxBillEmail: string;
      paidOptions: string; protection: string;
      checkedSpecs: Record<string, boolean>; closing: string; payment: string;
    }
  ) => {
    if (!cName.trim()) return { ...current, inherited: [] as string[] };

    const inherited: string[] = [];
    const matchedCustomer = findCustomerByNormalizedName(customers, cName);

    let nextAddress = current.address;
    let nextSalespersonName = current.salespersonName;
    let nextSalespersonPhone = current.salespersonPhone;
    let nextSiteContactName = current.siteContactName;
    let nextSiteContactPhone = current.siteContactPhone;
    let nextSiteContactEmail = current.siteContactEmail;
    let nextBillingContactName = current.billingContactName;
    let nextBillingContactPhone = current.billingContactPhone;
    let nextStatementEmail = current.statementEmail;
    let nextTaxBillEmail = current.taxBillEmail;
    let nextPaidOptions = current.paidOptions;
    let nextProtection = current.protection;
    let nextCheckedSpecs = { ...current.checkedSpecs };
    let nextClosing = current.closing;
    let nextPayment = current.payment;

    if (matchedCustomer) {
      if (!nextTaxBillEmail && matchedCustomer.repEmail && matchedCustomer.repEmail !== '미상') {
        nextTaxBillEmail = matchedCustomer.repEmail; inherited.push('계산서 메일');
      }
      if (!nextClosing) {
        const d = matchedCustomer.defaultBillingDay || 30;
        nextClosing = (d === 30 || d === 31) ? '말일' : `${d}일`; inherited.push('마감일');
      }
      if (!nextPayment) {
        const p = matchedCustomer.paymentDueDay || 25;
        nextPayment = `익월 ${p}일`; inherited.push('결제일');
      }
      if (!nextPaidOptions && matchedCustomer.defaultPaidOptions) {
        nextPaidOptions = matchedCustomer.defaultPaidOptions; inherited.push('유상옵션(고객기본)');
      }
      if (!nextProtection && matchedCustomer.defaultProtection) {
        nextProtection = matchedCustomer.defaultProtection; inherited.push('보양작업(고객기본)');
      }
      if (matchedCustomer.defaultCheckedSpecs) {
        let any = false;
        Object.entries(matchedCustomer.defaultCheckedSpecs).forEach(([k, v]) => {
          if (v && !nextCheckedSpecs[k]) { nextCheckedSpecs[k] = true; any = true; }
        });
        if (any) inherited.push('요구사양(고객기본)');
      }

      const matchedSite = sites.find(s =>
        s.customerId === matchedCustomer.id &&
        (sName ? (s.name.replace(/\s/g, '') === sName.replace(/\s/g, '') || s.name.includes(sName) || sName.includes(s.name)) : true)
      );
      if (matchedSite) {
        if (!nextAddress && matchedSite.address && matchedSite.address !== '미상') {
          nextAddress = matchedSite.address; inherited.push('현장 상세 주소');
        }
        if (!nextSiteContactName && matchedSite.contactName && matchedSite.contactName !== '미상') {
          nextSiteContactName = matchedSite.contactName; inherited.push('현장담당자 이름');
        }
        if (!nextSiteContactPhone && matchedSite.contact && matchedSite.contact !== '미상') {
          nextSiteContactPhone = matchedSite.contact; inherited.push('현장담당자 연락처');
        }
        if (!nextSiteContactEmail && matchedSite.email && matchedSite.email !== '미상') {
          nextSiteContactEmail = matchedSite.email; inherited.push('현장담당자 이메일');
        }
        if (matchedSite.paidOptions) { nextPaidOptions = matchedSite.paidOptions; inherited.push('유상옵션(현장)'); }
        if (matchedSite.protection) { nextProtection = matchedSite.protection; inherited.push('보양작업(현장)'); }
        if (matchedSite.checkedSpecs) {
          let any = false;
          Object.entries(matchedSite.checkedSpecs).forEach(([k, v]) => {
            if (v && !nextCheckedSpecs[k]) { nextCheckedSpecs[k] = true; any = true; }
          });
          if (any) inherited.push('요구사양(현장)');
        }
      }

      const custContacts = contacts.filter(ct => ct.customerId === matchedCustomer.id);
      if (custContacts.length > 0) {
        if (!nextSiteContactPhone) {
          const siteCt = custContacts.find(ct => ct.position?.includes('현장') || ct.position?.includes('소장')) || custContacts[0];
          if (siteCt && siteCt.contact && siteCt.contact !== '미상') {
            nextSiteContactPhone = siteCt.contact;
            if (!nextSiteContactName && siteCt.name) nextSiteContactName = siteCt.name;
            inherited.push('현장담당자(연락처)');
          }
        }
        if (!nextBillingContactName || !nextBillingContactPhone) {
          const billCt = custContacts.find(ct => ct.position?.includes('청구') || ct.position?.includes('경리') || ct.position?.includes('회계'));
          if (billCt) {
            if (!nextBillingContactName && billCt.name) { nextBillingContactName = billCt.name; inherited.push('청구담당자'); }
            if (!nextBillingContactPhone && billCt.contact && billCt.contact !== '미상') { nextBillingContactPhone = billCt.contact; inherited.push('청구담당자 연락처'); }
            if (!nextTaxBillEmail && billCt.email && billCt.email !== '미상') { nextTaxBillEmail = billCt.email; inherited.push('계산서 메일'); }
          }
        }
      }

      if (!nextSalespersonName) {
        const lastContract = contracts
          .filter(c => c.customerId === matchedCustomer.id && (c.contractType || 'RENTAL') === 'RENTAL')
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
        if (lastContract?.salespersonId) {
          const salesUser = users.find(u => u.id === lastContract.salespersonId);
          if (salesUser) {
            nextSalespersonName = salesUser.name;
            nextSalespersonPhone = salesUser.phone || '';
            inherited.push('영업담당자');
          }
        }
      }
    }

    return {
      address: nextAddress, salespersonName: nextSalespersonName, salespersonPhone: nextSalespersonPhone,
      siteContactName: nextSiteContactName, siteContactPhone: nextSiteContactPhone, siteContactEmail: nextSiteContactEmail,
      billingContactName: nextBillingContactName, billingContactPhone: nextBillingContactPhone,
      statementEmail: nextStatementEmail, taxBillEmail: nextTaxBillEmail,
      paidOptions: nextPaidOptions, protection: nextProtection,
      checkedSpecs: nextCheckedSpecs, closing: nextClosing, payment: nextPayment,
      inherited
    };
  }, [customers, sites, contacts, contracts, users]);

  // ── 드롭바 → 폼 파서 ──────────────────────────────────────────────────────────
  const parseDropBar = useCallback((text: string) => {
    if (!text.trim()) { showToast('파싱할 텍스트를 입력해 주세요.', 'error'); return; }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let parsedCustomer = '';
    let parsedSite = '';
    let parsedAddress = '';
    let parsedSalespersonName = '';
    let parsedSalespersonPhone = '';
    let parsedSiteContactName = '';
    let parsedSiteContactPhone = '';
    let parsedSiteContactEmail = '';
    let parsedBillingContactName = '';
    let parsedBillingContactPhone = '';
    let parsedStatementEmail = '';
    let parsedTaxBillEmail = '';
    let parsedLoading = '';
    let parsedUnloading = '';
    let parsedEquipments: EquipmentItem[] = [];
    let parsedPaidOptions = '';
    let parsedProtection = '';
    let parsedClosing = '';
    let parsedPayment = '';
    let parsedNote = '';

    const extractEmails = (str: string): string => {
      const m = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      return m ? m.map(e => e.replace(/\s+/g, '')).join('/') : '';
    };
    const extractPhone = (str: string): string => {
      const m = str.match(/(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g);
      return m ? m[0].replace(/\s+/g, '') : '';
    };
    const extractName = (str: string): string => {
      let n = str.split(/01[016789]/)[0] || str;
      n = n.split(/[a-zA-Z0-9._%+-]+@/)[0] || n;
      return n.replace(/[:\-]/g, '').replace(/선임|책임|담당자|소장|부장|과장|대리|팀장/g, '').trim();
    };

    lines.forEach(line => {
      const val = line.includes(':') ? line.substring(line.indexOf(':') + 1).trim()
        : (line.includes('：') ? line.substring(line.indexOf('：') + 1).trim() : '');

      if (/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|고객사)/i.test(line)) {
        parsedCustomer = val || line.replace(/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|고객사)\s*[:：]?\s*/i, '');
      } else if (/^(?:\d+[.)]\s*)?(?:현장\s*상세\s*주소|현장상세주소|현장\s*주소|주소|배송지)/i.test(line)) {
        parsedAddress = val || line.replace(/^(?:\d+[.)]\s*)?(?:현장\s*상세\s*주소|현장상세주소|현장\s*주소|주소|배송지)\s*[:：]?\s*/i, '');
      } else if (/^(?:\d+[.)]\s*)?(?:현장\s*담당자?|현장담당|담당자?|소장|반장)/i.test(line) && !line.includes('청구') && !line.includes('영업')) {
        parsedSiteContactName = extractName(val);
        parsedSiteContactPhone = extractPhone(val);
        const email = extractEmails(val);
        if (email) parsedSiteContactEmail = email;
      } else if (/^(?:\d+[.)]\s*)?(?:현장명?|현장)(?!\s*상세|\s*주소|\s*담당)/i.test(line)) {
        parsedSite = val || line.replace(/^(?:\d+[.)]\s*)?(?:현장명?|현장)\s*[:：]?\s*/i, '');
      } else if (/^(?:\d+[.)]\s*)?(?:영업\s*담당자?|영업담당|영업)/i.test(line)) {
        parsedSalespersonName = extractName(val);
        parsedSalespersonPhone = extractPhone(val);
      } else if (/^(?:\d+[.)]\s*)?(?:청구\s*담당자?|청구담당|경리|회계)/i.test(line)) {
        parsedBillingContactName = extractName(val);
        parsedBillingContactPhone = extractPhone(val);
        const email = extractEmails(val);
        if (email) parsedTaxBillEmail = email;
      } else if (/^(?:\d+[.)]\s*)?(?:거래명세서\s*(?:수신)?\s*메일|거래명세서메일|명세서\s*메일)/i.test(line)) {
        parsedStatementEmail = extractEmails(val || line);
      } else if (/^(?:\d+[.)]\s*)?(?:계산서\s*메일|계산서메일|세금계산서)/i.test(line)) {
        const email = extractEmails(val || line);
        parsedTaxBillEmail = email || val;
      } else if (/^(?:\d+[.)]\s*)?(?:상차\s*스케줄|상차스케줄|상차\s*시간|상차시간|상차)/i.test(line)) {
        parsedLoading = val;
      } else if (/^(?:\d+[.)]\s*)?(?:하차\s*스케줄|하차스케줄|하차\s*시간|하차시간|하차|도착\s*시간|도착시간|도착)/i.test(line)) {
        parsedUnloading = val;
      } else if (/^(?:\d+[.)]\s*)?(?:신청\s*(?:고소작업대\s*)?모델\s*목록|신청모델목록|신청모델|모델명?|장비명?|규격)/i.test(line) || /^\s*-\s*(?:GS|SJ|JCPT|HD|star|STAR)/i.test(line)) {
        const raw = val || line.replace(/^(?:\d+[.)]\s*)?(?:신청\s*(?:고소작업대\s*)?모델\s*목록|신청모델목록|신청모델|모델명?|장비명?|규격)\s*[:：]?\s*/i, '').replace(/^-\s*/, '');
        raw.split(/[\/,]/).forEach(p => {
          const match = p.match(/(.+?)\s*[*xX대]\s*(\d+)/) || p.match(/(.+?)\s*(\d+)\s*대/);
          if (match) parsedEquipments.push({ modelName: match[1].replace(/대$/, '').trim(), qty: parseInt(match[2]) || 1 });
          else if (p.trim()) parsedEquipments.push({ modelName: p.trim(), qty: 1 });
        });
      } else if (/^(?:\d+[.)]\s*)?(?:유상\s*옵션|유상옵션|옵션)/i.test(line) && !line.includes('요구') && !line.includes('스펙')) {
        parsedPaidOptions = val;
      } else if (/^(?:\d+[.)]\s*)?(?:보양\s*작업|보양작업|보양)/i.test(line)) {
        parsedProtection = val;
      } else if (/^(?:\d+[.)]\s*)?(?:마감일|청구\s*마감일)/i.test(line)) {
        parsedClosing = val;
      } else if (/^(?:\d+[.)]\s*)?(?:결제일|입금일)/i.test(line)) {
        parsedPayment = val;
      } else if (/^(?:\d+[.)]\s*)?(?:특이사항|비고|배차\s*메모|배차메모)/i.test(line)) {
        parsedNote = val;
      }
    });

    // 스펙 자동 감지
    const cleanedText = text.replace(/\s+/g, '');
    const newCheckedSpecs: Record<string, boolean> = {};
    STANDARD_SPECS.forEach(spec => {
      newCheckedSpecs[spec.id] = spec.keywords.some(kw => cleanedText.includes(kw.replace(/\s+/g, '')));
    });

    // 자동 상속
    const inheritedResult = applyAutoInheritance(parsedCustomer, parsedSite, {
      address: parsedAddress, salespersonName: parsedSalespersonName, salespersonPhone: parsedSalespersonPhone,
      siteContactName: parsedSiteContactName, siteContactPhone: parsedSiteContactPhone, siteContactEmail: parsedSiteContactEmail,
      billingContactName: parsedBillingContactName, billingContactPhone: parsedBillingContactPhone,
      statementEmail: parsedStatementEmail, taxBillEmail: parsedTaxBillEmail,
      paidOptions: parsedPaidOptions, protection: parsedProtection,
      checkedSpecs: newCheckedSpecs, closing: parsedClosing, payment: parsedPayment
    });

    setCustomerName(parsedCustomer);
    setSiteName(parsedSite);
    setSiteAddress(inheritedResult.address);
    setSalespersonName(inheritedResult.salespersonName || currentUser?.name || '');
    setSalespersonPhone(inheritedResult.salespersonPhone || currentUser?.phone || '');
    setSiteContactName(inheritedResult.siteContactName);
    setSiteContactPhone(inheritedResult.siteContactPhone);
    setSiteContactEmail(inheritedResult.siteContactEmail);
    setBillingContactName(inheritedResult.billingContactName);
    setBillingContactPhone(inheritedResult.billingContactPhone);
    setStatementEmail(inheritedResult.statementEmail);
    setTaxBillEmail(inheritedResult.taxBillEmail);
    setLoadingTime(parsedLoading);
    setUnloadingTime(parsedUnloading);
    if (parsedEquipments.length > 0) setEquipments(parsedEquipments);
    setPaidOptions(inheritedResult.paidOptions);
    setProtection(inheritedResult.protection);
    setCheckedSpecs(inheritedResult.checkedSpecs);
    setClosingDay(inheritedResult.closing);
    setPaymentDay(inheritedResult.payment);
    setNote(parsedNote);
    setInheritedFieldList(inheritedResult.inherited);
    setDropBarText('');

    showToast(inheritedResult.inherited.length > 0
      ? `파싱 완료 — DB 자동 상속 ${inheritedResult.inherited.length}개 항목`
      : '파싱 완료');
  }, [applyAutoInheritance, currentUser]);

  // 드롭바 Enter 키 처리
  const handleDropBarKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && dropBarText.includes('\n')) {
      e.preventDefault();
      parseDropBar(dropBarText);
    }
  };

  const handleDropBarPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // 붙여넣기 후 자동 파싱 (여러 줄이면 즉시)
    const pasted = e.clipboardData.getData('text');
    if (pasted.includes('\n')) {
      e.preventDefault();
      parseDropBar(pasted);
    }
  };

  // ── 음성 입력 (Web Speech API) ─────────────────────────────────────────────
  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      showToast('이 브라우저는 음성 인식을 지원하지 않습니다.', 'error');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      if (transcript) {
        setDropBarText(prev => prev ? `${prev}\n${transcript}` : transcript);
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  // ── 장바구니 관리 ──────────────────────────────────────────────────────────
  const addEquipmentModel = (modelName: string) => {
    setEquipments(prev => {
      const existing = prev.findIndex(e => e.modelName === modelName);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], qty: updated[existing].qty + 1 };
        return updated;
      }
      return [...prev, { modelName, qty: 1 }];
    });
  };

  const changeEquipmentQty = (index: number, delta: number) => {
    setEquipments(prev => {
      const updated = [...prev];
      const newQty = (updated[index].qty || 1) + delta;
      if (newQty <= 0) return prev.filter((_, i) => i !== index);
      updated[index] = { ...updated[index], qty: newQty };
      return updated;
    });
  };

  const removeEquipment = (index: number) => {
    setEquipments(prev => prev.filter((_, i) => i !== index));
  };

  const totalEquipmentCount = equipments.reduce((s, e) => s + e.qty, 0);

  // ── 스펙 체크 ──────────────────────────────────────────────────────────────
  const handleToggleSpec = (id: string) => setCheckedSpecs(prev => ({ ...prev, [id]: !prev[id] }));
  const handleSetAllSpecs = (status: boolean) => {
    const updated: Record<string, boolean> = {};
    STANDARD_SPECS.forEach(spec => { updated[spec.id] = status; });
    setCheckedSpecs(updated);
  };

  // ── 모델명 정규화 ─────────────────────────────────────────────────────────
  const findSuggestedModel = (inputModel: string, officialModels: string[]): string | null => {
    if (!inputModel?.trim()) return null;
    const cleaned = inputModel.replace(/[\s\-_]/g, '').toLowerCase();
    let matched = officialModels.find(m => {
      const cm = m.replace(/[\s\-_]/g, '').toLowerCase();
      return cm.includes(cleaned) || cleaned.includes(cm);
    });
    if (matched) return matched;
    const nums = inputModel.match(/\d{3,4}/);
    if (nums) matched = officialModels.find(m => m.includes(nums[0]));
    return matched || null;
  };

  // ── 초기화 ────────────────────────────────────────────────────────────────
  const handleResetForm = () => {
    setDropBarText('');
    setContractNo('');
    setCustomerName('');
    setDispatchOverdueAcknowledged(false);
    setSiteName('');
    setSiteAddress('');
    setSalespersonName('');
    setSalespersonPhone('');
    setSiteContactName('');
    setSiteContactPhone('');
    setSiteContactEmail('');
    setBillingContactName('');
    setBillingContactPhone('');
    setStatementEmail('');
    setTaxBillEmail('');
    setLoadingTime('');
    setUnloadingTime('');
    setEquipments([]);
    setPaidOptions('');
    setProtection('');
    setCheckedSpecs({});
    setInheritedFieldList([]);
    setSaveOptionsToSite(true);
    setIsSetAsCustomerDefault(false);
    setApplyToAllSites(false);
    setClosingDay('');
    setPaymentDay('');
    setNote('');
    showToast('폼이 초기화되었습니다.');
  };

  // ── 저장 ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (isSubmitting) return;
    if (!canSave) { showToast('저장 권한이 없습니다.', 'error'); return; }
    if (!customerName.trim()) { showToast('고객사명을 입력하세요.', 'error'); return; }
    if (!siteName.trim()) { showToast('현장명을 입력하세요.', 'error'); return; }

    const matchedCust = findCustomerByNormalizedName(customers, customerName);
    if (matchedCust?.transactionStatus === 'BLOCKED') {
      showToast('🚫 거래 불가(BLOCKED) 거래처입니다.', 'error'); return;
    }
    if (matchedCustOverdue && matchedCustOverdue.overdueSum > 0 && !dispatchOverdueAcknowledged) {
      showToast('⚠️ 연체 채권 확인 체크박스에 동의해야 합니다.', 'error'); return;
    }
    if (!siteAddress.trim()) { showToast('현장 상세 주소를 입력하세요.', 'error'); return; }
    if (!siteContactPhone.trim()) { showToast('현장 담당자 연락처를 입력하세요.', 'error'); return; }
    if (equipments.length === 0) { showToast('신청 장비를 최소 1대 이상 선택하세요.', 'error'); return; }

    setIsSubmitting(true);
    try {
      const officialModels = uniqueModels.length > 0 ? uniqueModels : products.map((p: any) => p.modelName);
      const updatedEquipments = [...equipments];
      for (let i = 0; i < updatedEquipments.length; i++) {
        const eq = updatedEquipments[i];
        if (!eq.modelName?.trim()) continue;
        if (!officialModels.some(m => m === eq.modelName)) {
          const suggested = findSuggestedModel(eq.modelName, officialModels);
          if (suggested) {
            updatedEquipments[i].modelName = suggested;
            showToast(`모델명 [${suggested}]으로 자동 보정`);
          } else {
            showToast(`'${eq.modelName}'은 등록된 모델이 아닙니다.`, 'error'); return;
          }
        }
      }

      const data = {
        customerName, siteName, siteAddress, salespersonName, salespersonPhone,
        siteContactName, siteContactPhone, siteContactEmail,
        billingContactName, billingContactPhone, statementEmail, taxBillEmail,
        loadingTime, unloadingTime, equipments: updatedEquipments, note, rawText: note,
        paidOptions, protection, checkedSpecs, saveOptionsToSite, isSetAsCustomerDefault, applyToAllSites,
        closingDay, paymentDay
      };

      setProgressLogs([]);
      setProgressPercent(0);
      setCurrentStepText('🚀 출고 파이프라인 가동 중...');
      setIsProcessCompleted(false);
      setIsProcessingModalOpen(true);

      const onProgress = (logText: string, pct: number) => {
        setProgressPercent(pct);
        setCurrentStepText(logText);
        setProgressLogs(prev => [...prev, logText]);
      };

      let result = await saveSmartDispatch(data, false, onProgress);
      if (result.requiresConfirm) {
        showToast('신규 고객/현장 자동 등록 후 재진행합니다.');
        setProgressLogs([]);
        setProgressPercent(0);
        setCurrentStepText('🚀 신규 등록 & 재가동 중...');
        result = await saveSmartDispatch(data, true, onProgress);
      }
      if (result.errorMessage) {
        setIsProcessingModalOpen(false);
        showErrorModal(result.errorMessage, '출고 요청 저장 오류');
        return;
      }
      if (result.success) {
        setIsProcessCompleted(true);
        if (result.contractNo) setContractNo(result.contractNo);
      }
    } catch (err: any) {
      console.error('handleSave error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 고객명 onChange 자동 상속 ───────────────────────────────────────────────
  const handleCustomerChange = (val: string) => {
    setCustomerName(val);
    const matched = findCustomerByNormalizedName(customers, val);
    if (matched) {
      const res = applyAutoInheritance(val, siteName, {
        address: siteAddress, salespersonName, salespersonPhone,
        siteContactName, siteContactPhone, siteContactEmail,
        billingContactName, billingContactPhone, statementEmail, taxBillEmail,
        paidOptions, protection, checkedSpecs, closing: closingDay, payment: paymentDay
      });
      setSiteAddress(res.address);
      setSalespersonName(res.salespersonName); setSalespersonPhone(res.salespersonPhone);
      setSiteContactName(res.siteContactName); setSiteContactPhone(res.siteContactPhone);
      setSiteContactEmail(res.siteContactEmail);
      setBillingContactName(res.billingContactName); setBillingContactPhone(res.billingContactPhone);
      setStatementEmail(res.statementEmail); setTaxBillEmail(res.taxBillEmail);
      setPaidOptions(res.paidOptions); setProtection(res.protection);
      setCheckedSpecs(res.checkedSpecs);
      setClosingDay(res.closing); setPaymentDay(res.payment);
      setInheritedFieldList(res.inherited);
    }
  };

  const handleSiteChange = (val: string) => {
    setSiteName(val);
    if (customerName) {
      const res = applyAutoInheritance(customerName, val, {
        address: siteAddress, salespersonName, salespersonPhone,
        siteContactName, siteContactPhone, siteContactEmail,
        billingContactName, billingContactPhone, statementEmail, taxBillEmail,
        paidOptions, protection, checkedSpecs, closing: closingDay, payment: paymentDay
      });
      setSiteAddress(res.address);
      setSiteContactName(res.siteContactName); setSiteContactPhone(res.siteContactPhone);
      setSiteContactEmail(res.siteContactEmail);
      setPaidOptions(res.paidOptions); setProtection(res.protection);
      setCheckedSpecs(res.checkedSpecs);
      setInheritedFieldList(res.inherited);
    }
  };

  // ── CSS 변수 기반 공통 스타일 ───────────────────────────────────────────────
  const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px' };
  const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' };
  const sectionTitle = (n: number, label: string) => (
    <h4 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--primary)', margin: '0 0 10px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
      {n}. {label}
    </h4>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ─── 토스트 ─────────────────────────────────────────────────────── */}
      {toastMessage && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          padding: '12px 20px', borderRadius: '8px', fontWeight: 700, fontSize: '13.5px',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          backgroundColor: toastMessage.type === 'success' ? '#10b981' : '#ef4444',
          animation: 'slideIn 0.3s ease'
        }}>
          {toastMessage.text}
        </div>
      )}

      {/* ─── 헤더 ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontWeight: 800, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            출고 요청 (신설)
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', backgroundColor: '#dbeafe', color: '#1d4ed8' }}>
              A/B 비교 테스트
            </span>
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            드롭바에 카톡 줄글 붙여넣기 → 자동 파싱 → 단일 캔버스 폼 확인 → 출고 지시
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={handleResetForm}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '13px' }}>
            <RotateCcw size={14} /> 초기화
          </button>
          {canSave && (
            <button type="button" className="btn-primary" onClick={handleSave} disabled={isSubmitting}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', fontSize: '13px', fontWeight: 800 }}>
              <Zap size={15} /> 출고 지시
            </button>
          )}
        </div>
      </div>

      {/* ─── 스마트 드롭바 ──────────────────────────────────────────────── */}
      <div className="card" style={{ border: '2px solid var(--primary)', borderRadius: '10px' }}>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ClipboardPaste size={16} color="var(--primary)" />
              <span style={{ fontWeight: 800, fontSize: '13px', color: 'var(--primary)' }}>스마트 드롭바</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>카톡 줄글 붙여넣기 → 자동 파싱 / 여러 줄 후 Enter → 파싱</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button type="button"
                onClick={toggleVoice}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                  border: 'none', cursor: 'pointer',
                  backgroundColor: isListening ? '#ef4444' : 'var(--primary)',
                  color: '#fff',
                  animation: isListening ? 'pulse 1s infinite' : 'none'
                }}>
                {isListening ? <><MicOff size={14} /> 중지</> : <><Mic size={14} /> 음성 입력</>}
              </button>
              <button type="button" className="btn-primary"
                onClick={() => parseDropBar(dropBarText)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', fontSize: '12px', fontWeight: 800 }}>
                <Zap size={13} /> 파싱 실행
              </button>
            </div>
          </div>
          <textarea
            ref={dropBarRef}
            value={dropBarText}
            onChange={e => setDropBarText(e.target.value)}
            onKeyDown={handleDropBarKeyDown}
            onPaste={handleDropBarPaste}
            placeholder="카카오톡/메신저의 출고 요청 줄글을 여기에 붙여넣기(Ctrl+V)하면 즉시 자동 파싱됩니다.
또는 자연어를 입력하고 [파싱 실행] 버튼을 클릭하세요."
            rows={3}
            style={{
              width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '12.5px',
              lineHeight: '1.5', padding: '10px', boxSizing: 'border-box',
              border: '1px solid var(--border-color)', borderRadius: '6px',
              backgroundColor: 'var(--bg-app)', color: 'var(--text-main)'
            }}
          />
        </div>
      </div>

      {/* ─── DB 자동 상속 배너 ──────────────────────────────────────────── */}
      {inheritedFieldList.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 14px', borderRadius: '8px',
          backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)',
          color: '#10b981', fontSize: '12.5px', fontWeight: 700
        }}>
          <CheckCircle2 size={16} />
          <span>DB 자동 상속: {inheritedFieldList.join(' · ')}</span>
        </div>
      )}

      {/* ─── 연체 경보 ──────────────────────────────────────────────────── */}
      {matchedCustOverdue && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px',
          backgroundColor: matchedCustOverdue.isBlocked ? '#fef2f2' : '#fffbeb',
          border: `1px solid ${matchedCustOverdue.isBlocked ? '#f87171' : '#fcd34d'}`,
          color: matchedCustOverdue.isBlocked ? '#991b1b' : '#92400e'
        }}>
          <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <AlertTriangle size={15} color={matchedCustOverdue.isBlocked ? '#dc2626' : '#d97706'} />
            {matchedCustOverdue.isBlocked ? '🚫 [경영진 처분] 거래 불가 (BLOCKED)' : '⚠️ 연체 채권 경각심 통제 경보'}
          </div>
          {!matchedCustOverdue.isBlocked && (
            <>
              <div style={{ marginBottom: '6px' }}>
                미납 청구 {matchedCustOverdue.count}건 (총 ₩{matchedCustOverdue.overdueSum.toLocaleString()}원)
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, cursor: 'pointer' }}>
                <input type="checkbox" checked={dispatchOverdueAcknowledged} onChange={e => setDispatchOverdueAcknowledged(e.target.checked)} />
                [수금 책임 인지] 연체 사실을 확인하고 수금 관리에 책임을 다할 것을 확인합니다.
              </label>
            </>
          )}
        </div>
      )}

      {/* ─── 단일 캔버스 폼 ─────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* 섹션 1: 기본 고객 및 현장 */}
          <div>
            {sectionTitle(1, '기본 고객 및 현장 정보')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div style={fieldWrap}>
                <label style={labelStyle}>계약번호</label>
                <input type="text" value={contractNo} onChange={e => setContractNo(e.target.value)} placeholder="저장 후 자동 채번" />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>
                  고객사명 <span style={{ color: '#ef4444' }}>*</span>
                  {currentMatchedCustomer && <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, marginLeft: '4px' }}>✓ 매핑됨</span>}
                </label>
                <input type="text" list="sd2-customer-list" value={customerName}
                  onChange={e => handleCustomerChange(e.target.value)} placeholder="고객사명 입력" />
                <datalist id="sd2-customer-list">
                  {customers.map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>
                  현장명 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input type="text" list="sd2-site-list" value={siteName}
                  onChange={e => handleSiteChange(e.target.value)} placeholder="현장명 입력" />
                <datalist id="sd2-site-list">
                  {sites
                    .filter(s => currentMatchedCustomer ? s.customerId === currentMatchedCustomer.id : true)
                    .map(s => <option key={s.id} value={s.name} />)}
                </datalist>
              </div>
              <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>
                  현장 상세 주소 <span style={{ color: '#ef4444' }}>*</span>
                  {inheritedFieldList.includes('현장 상세 주소') && <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, marginLeft: '4px' }}>[DB 상속]</span>}
                </label>
                <input type="text" value={siteAddress} onChange={e => setSiteAddress(e.target.value)}
                  placeholder="예: 경기도 평택시 고덕면 고덕산단로 123"
                  style={{ borderColor: !siteAddress && customerName ? '#fca5a5' : undefined }} />
              </div>
            </div>
          </div>

          {/* 섹션 2: 업무 관계자 */}
          <div>
            {sectionTitle(2, '업무 관계자 정보')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              {([
                ['영업담당자', salespersonName, setSalespersonName, '홍길동', false],
                ['영업담당자 연락처', salespersonPhone, setSalespersonPhone, '010-1234-5678', false],
                ['현장담당자', siteContactName, setSiteContactName, '김소장', inheritedFieldList.includes('현장담당자 이름')],
                ['현장담당자 연락처 *', siteContactPhone, setSiteContactPhone, '010-0000-0000',
                  inheritedFieldList.includes('현장담당자 연락처') || inheritedFieldList.includes('현장담당자(연락처)')],
                ['청구담당자', billingContactName, setBillingContactName, '이대리', inheritedFieldList.includes('청구담당자')],
                ['청구담당자 연락처', billingContactPhone, setBillingContactPhone, '010-9999-0000', inheritedFieldList.includes('청구담당자 연락처')],
                ['거래명세서 수신 메일', statementEmail, setStatementEmail, 'site@co.kr', false],
                ['계산서 메일', taxBillEmail, setTaxBillEmail, 'tax@co.kr', inheritedFieldList.includes('계산서 메일')],
              ] as [string, string, (v: string) => void, string, boolean][]).map(([label, val, setter, ph, inherited]) => (
                <div key={label} style={fieldWrap}>
                  <label style={labelStyle}>
                    {label}
                    {inherited && <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, marginLeft: '4px' }}>[DB 상속]</span>}
                  </label>
                  <input type="text" value={val}
                    onChange={e => setter(e.target.value)}
                    placeholder={`예: ${ph}`}
                    style={{ borderColor: label.includes('연락처 *') && !val && customerName ? '#fca5a5' : undefined }} />
                </div>
              ))}
            </div>
          </div>

          {/* 섹션 3: 배차 일정 */}
          <div>
            {sectionTitle(3, '배차 일정')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={fieldWrap}>
                <label style={labelStyle}>상차 스케줄</label>
                <input type="text" value={loadingTime} onChange={e => setLoadingTime(e.target.value)} placeholder="예: 07.18(토) 오전 8시 상차" />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>하차 스케줄</label>
                <input type="text" value={unloadingTime} onChange={e => setUnloadingTime(e.target.value)} placeholder="예: 07.18(토) 오전 하차" />
              </div>
            </div>
          </div>

          {/* 섹션 4: 신청 장비 (장바구니) */}
          <div>
            {sectionTitle(4, '신청 장비 목록 (장바구니)')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              {/* ft 탭 선택 */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {FT_GROUPS.map(ft => (
                  <button key={ft} type="button"
                    onClick={() => setActiveFt(ft)}
                    style={{
                      padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                      border: '1px solid var(--border-color)', cursor: 'pointer',
                      backgroundColor: activeFt === ft ? 'var(--primary)' : 'var(--bg-app)',
                      color: activeFt === ft ? '#fff' : 'var(--text-secondary)'
                    }}>
                    {ft}
                  </button>
                ))}
              </div>

              {/* 규격 칩 */}
              {getModelsByFt(activeFt).length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {getModelsByFt(activeFt).map((item) => {
                    const modelName = item.modelName;
                    const existingItem = equipments.find(e => e.modelName === modelName);
                    return (
                      <button key={modelName} type="button"
                        onClick={() => addEquipmentModel(modelName)}
                        style={{
                          padding: '5px 12px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700,
                          border: `2px solid ${existingItem ? 'var(--primary)' : 'var(--border-color)'}`,
                          cursor: 'pointer',
                          backgroundColor: existingItem ? 'rgba(var(--primary-rgb, 79,70,229), 0.1)' : 'var(--bg-app)',
                          color: existingItem ? 'var(--primary)' : 'var(--text-secondary)',
                          position: 'relative'
                        }}>
                        {modelName}
                        {existingItem && (
                          <span style={{
                            marginLeft: '6px', backgroundColor: 'var(--primary)', color: '#fff',
                            borderRadius: '10px', padding: '1px 6px', fontSize: '11px'
                          }}>
                            {existingItem.qty}대
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 직접 입력 행 */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input type="text" list="sd2-models" placeholder="직접 모델명 입력 후 + 추가"
                  id="sd2-manual-model"
                  style={{ flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val) { addEquipmentModel(val); (e.target as HTMLInputElement).value = ''; }
                    }
                  }} />
                <datalist id="sd2-models">
                  {uniqueModels.map(m => <option key={m} value={m} />)}
                </datalist>
                <button type="button" className="btn-secondary"
                  onClick={() => {
                    const inp = document.getElementById('sd2-manual-model') as HTMLInputElement;
                    if (inp?.value.trim()) { addEquipmentModel(inp.value.trim()); inp.value = ''; }
                  }}
                  style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                  <Plus size={13} /> 추가
                </button>
              </div>

              {/* 장바구니 목록 */}
              {equipments.length > 0 ? (
                <div style={{
                  border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden',
                  backgroundColor: 'var(--bg-app)'
                }}>
                  <div style={{
                    padding: '8px 12px', backgroundColor: 'var(--bg-card)',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 800
                  }}>
                    <ShoppingCart size={14} color="var(--primary)" />
                    신청 장비 목록 — 총 {totalEquipmentCount}대
                    <button type="button" onClick={() => setEquipments([])}
                      style={{ marginLeft: 'auto', fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                      전체비우기
                    </button>
                  </div>
                  {equipments.map((eq, index) => (
                    <div key={index} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', borderBottom: index < equipments.length - 1 ? '1px solid var(--border-color)' : 'none'
                    }}>
                      <span style={{ flex: 1, fontSize: '13px', fontWeight: 700 }}>{eq.modelName}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button type="button" onClick={() => changeEquipmentQty(index, -1)}
                          style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Minus size={12} />
                        </button>
                        <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 800, fontSize: '14px' }}>{eq.qty}</span>
                        <button type="button" onClick={() => changeEquipmentQty(index, 1)}
                          style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Plus size={12} />
                        </button>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>대</span>
                      </div>
                      <button type="button" onClick={() => removeEquipment(index)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  padding: '20px', textAlign: 'center',
                  border: '1px dashed var(--border-color)', borderRadius: '8px',
                  color: 'var(--text-muted)', fontSize: '13px'
                }}>
                  위 규격 칩을 클릭하거나 직접 입력하여 장비를 추가하세요.
                </div>
              )}
            </div>
          </div>

          {/* 섹션 5: 필수 요구사항 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--primary)', margin: 0 }}>
                5. 필수 요구사항 체크리스트
                {STANDARD_SPECS.filter(s => !!checkedSpecs[s.id]).length > 0 && (
                  <span style={{ fontSize: '11px', color: '#16a34a', marginLeft: '8px', fontWeight: 700 }}>
                    ({STANDARD_SPECS.filter(s => !!checkedSpecs[s.id]).length}개 선택됨)
                  </span>
                )}
              </h4>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAllSpecs(!showAllSpecs)} style={{ padding: '3px 8px', fontSize: '11px', fontWeight: 700 }}>
                  {showAllSpecs ? '▲ 선택 항목만' : '▼ 전체 펼치기'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => handleSetAllSpecs(true)} style={{ padding: '2px 6px', fontSize: '11px' }}>전체선택</button>
                <button type="button" className="btn-secondary" onClick={() => handleSetAllSpecs(false)} style={{ padding: '2px 6px', fontSize: '11px' }}>전체해제</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div style={fieldWrap}>
                <label style={labelStyle}>
                  유상 옵션 내역
                  {(inheritedFieldList.includes('유상옵션(현장)') || inheritedFieldList.includes('유상옵션(고객기본)')) &&
                    <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, marginLeft: '4px' }}>[DB 상속]</span>}
                </label>
                <input type="text" value={paidOptions} onChange={e => setPaidOptions(e.target.value)} placeholder="예: 3면 함석, 감지봉 4EA" />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>
                  보양작업 조건
                  {(inheritedFieldList.includes('보양작업(현장)') || inheritedFieldList.includes('보양작업(고객기본)')) &&
                    <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, marginLeft: '4px' }}>[DB 상속]</span>}
                </label>
                <input type="text" value={protection} onChange={e => setProtection(e.target.value)} placeholder="예: 4면 망 포함 보양" />
              </div>
            </div>

            {/* 고객사 기본값 등록 패널 */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '8px',
              padding: '12px 14px', backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-color)', borderRadius: '8px',
              marginBottom: '12px', fontSize: '12.5px'
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                <input type="checkbox" checked={isSetAsCustomerDefault} onChange={e => setIsSetAsCustomerDefault(e.target.checked)} />
                🏢 이 옵션·보양·스펙을 '{customerName || '해당 고객사'}' 기본 설정으로 등록
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: '#3b82f6' }}>
                <input type="checkbox" checked={applyToAllSites} onChange={e => setApplyToAllSites(e.target.checked)} />
                ⚡ '{customerName || '해당 고객사'}'의 모든 현장에 일괄 적용
              </label>
              {currentMatchedSite && isOptionsDiff && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: '#f59e0b' }}>
                  <input type="checkbox" checked={saveOptionsToSite} onChange={e => setSaveOptionsToSite(e.target.checked)} />
                  📍 변경된 옵션을 '{siteName || '해당 현장'}' 기본값으로 갱신
                </label>
              )}
            </div>

            {/* 체크박스 그리드 */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '6px', padding: '12px',
              maxHeight: showAllSpecs ? '400px' : 'none',
              overflowY: showAllSpecs ? 'auto' : 'visible',
              border: '1px solid var(--border-color)', borderRadius: '8px',
              backgroundColor: 'var(--bg-app)'
            }}>
              {STANDARD_SPECS
                .filter(spec => showAllSpecs || !!checkedSpecs[spec.id])
                .map(spec => {
                  const isChecked = !!checkedSpecs[spec.id];
                  return (
                    <label key={spec.id} style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12.5px',
                      backgroundColor: isChecked ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                      border: `1px solid ${isChecked ? '#16a34a' : 'var(--border-color)'}`,
                      transition: 'all 0.15s ease'
                    }}>
                      <input type="checkbox" checked={isChecked} onChange={() => handleToggleSpec(spec.id)} />
                      <span style={{ color: isChecked ? '#15803d' : 'var(--text-secondary)', fontWeight: isChecked ? 800 : 'normal' }}>
                        {spec.label}
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>

          {/* 섹션 6: 정산 회계 */}
          <div>
            {sectionTitle(6, '정산 회계 및 특이사항')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              <div style={fieldWrap}>
                <label style={labelStyle}>
                  매달 청구 마감일
                  {inheritedFieldList.includes('마감일') && <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, marginLeft: '4px' }}>[DB 상속]</span>}
                </label>
                <input type="text" value={closingDay} onChange={e => setClosingDay(e.target.value)} placeholder="예: 20일" />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>
                  결제 예정일
                  {inheritedFieldList.includes('결제일') && <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, marginLeft: '4px' }}>[DB 상속]</span>}
                </label>
                <input type="text" value={paymentDay} onChange={e => setPaymentDay(e.target.value)} placeholder="예: 익월 말일" />
              </div>
              <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>특이사항 / 메모</label>
                <input type="text" value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ─── 하단 출고 지시 CTA ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
        padding: '16px 20px', backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: '10px'
      }}>
        <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
          {equipments.length > 0 ? (
            <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
              {equipments.map(e => `${e.modelName} × ${e.qty}대`).join(' / ')} — 총 {totalEquipmentCount}대
            </span>
          ) : '장비를 선택하세요'}
        </div>
        <button type="button" className="btn-secondary" onClick={handleResetForm}
          style={{ padding: '8px 16px', fontSize: '13px' }}>
          초기화
        </button>
        {canSave && (
          <button type="button" className="btn-primary" onClick={handleSave} disabled={isSubmitting}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '13px', fontWeight: 800 }}>
            <Zap size={15} /> 출고 지시 (자동 생성 및 저장)
          </button>
        )}
      </div>

      {/* ─── 진행 모달 ──────────────────────────────────────────────────── */}
      {isProcessingModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)', borderRadius: '12px',
            padding: '32px 36px', minWidth: '400px', maxWidth: '560px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
          }}>
            <h3 style={{ marginBottom: '20px', fontSize: '16px', fontWeight: 800 }}>
              {isProcessCompleted ? '✅ 출고 지시 완료' : '🚀 출고 파이프라인 진행 중...'}
            </h3>
            <div style={{ marginBottom: '16px', height: '6px', backgroundColor: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', backgroundColor: '#10b981', borderRadius: '3px', width: `${progressPercent}%`, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', fontWeight: 600 }}>{currentStepText}</div>
            <div style={{
              maxHeight: '200px', overflowY: 'auto', fontSize: '12px',
              color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: '1.6'
            }}>
              {progressLogs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
            {isProcessCompleted && (
              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-primary" onClick={() => { setIsProcessingModalOpen(false); handleResetForm(); }}
                  style={{ padding: '8px 20px', fontWeight: 800 }}>
                  신규 입력
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
