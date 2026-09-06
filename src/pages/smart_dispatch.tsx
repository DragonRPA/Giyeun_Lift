import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { findCustomerByNormalizedName, STANDARD_SPECS, SpecItem } from '../services/db';
import { isOptionsChangedFromSite } from '../services/voiceOrderDraftService';
import { Zap, Clipboard, FileText, Copy, Printer, Braces, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Settings, ShieldCheck } from 'lucide-react';

interface EquipmentItem {
  modelName: string;
  qty: number;
}

export const SmartDispatch: React.FC = () => {
  const { hasPermission, saveSmartDispatch, assets, products, showErrorModal, users, contracts, currentUser, customers, contacts, sites, billings } = useApp();
  const canSave = hasPermission('delivery', 'save');

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ⚡ 기존 DB 정보 자동 상속 목록 상태 (시각적 배지 노출용)
  const [inheritedFieldList, setInheritedFieldList] = useState<string[]>([]);

  // 실시간 프로세스 진행 릴레이 모달 상태
  const [isProcessingModalOpen, setIsProcessingModalOpen] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentStepText, setCurrentStepText] = useState('');
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [isProcessCompleted, setIsProcessCompleted] = useState(false);

  // 원본 텍스트 입력 상태 (초기값 빈 문자열)
  const [rawText, setRawText] = useState<string>('');
  const txtFileInputRef = useRef<HTMLInputElement>(null);

  // 텍스트 파일 불러오기 핸들러
  const handleTextFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text !== undefined && text !== null) {
        setRawText(text);
        showToast(`파일 '${file.name}'의 텍스트 내용을 불러왔습니다.`);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // 구조화된 폼 데이터 상태
  const [contractNo, setContractNo] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [dispatchOverdueAcknowledged, setDispatchOverdueAcknowledged] = useState(false);

  const matchedCustOverdue = useMemo(() => {
    const mc = findCustomerByNormalizedName(customers, customerName);
    if (!mc) return null;
    const custBillings = billings.filter(b => b.customerId === mc.id && b.status !== 'PAID' && (b.totalAmount - b.paidAmount) > 0);
    const overdueSum = custBillings.reduce((s, b) => s + (b.totalAmount - b.paidAmount), 0);
    if (overdueSum <= 0 && mc.transactionStatus !== 'BLOCKED') return null;
    return { overdueSum, count: custBillings.length, isBlocked: mc.transactionStatus === 'BLOCKED' };
  }, [customers, customerName, billings]);
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');

  // 👔 업무 관계자 정보 (영업담당자, 현장담당자, 청구담당자)
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
  const [equipments, setEquipments] = useState<EquipmentItem[]>([{ modelName: '', qty: 1 }]);

  const [paidOptions, setPaidOptions] = useState('');
  const [protection, setProtection] = useState('');

  // 🌟 고객사 기본값 등록 및 전체 현장 일괄 전파 플래그 상태
  const [isSetAsCustomerDefault, setIsSetAsCustomerDefault] = useState(false);
  const [applyToAllSites, setApplyToAllSites] = useState(false);
  const [saveOptionsToSite, setSaveOptionsToSite] = useState(true); // 🌟 변경된 옵션을 현장 기본값으로 저장할지 여부

  // 요구사항 필수 체크리스트 선택/해제 상태 (Record<specId, boolean>)
  const [checkedSpecs, setCheckedSpecs] = useState<Record<string, boolean>>({});
  const [showAllSpecs, setShowAllSpecs] = useState<boolean>(false);

  // 🌟 현재 매핑된 고객사/현장 및 옵션 변경 감지 memo
  const currentMatchedCustomer = useMemo(() => {
    return findCustomerByNormalizedName(customers, customerName);
  }, [customers, customerName]);

  const currentMatchedSite = useMemo(() => {
    if (!currentMatchedCustomer || !siteName) return null;
    const cleanSite = siteName.replace(/\s/g, '');
    return sites.find(s => s.customerId === currentMatchedCustomer.id && (s.name.replace(/\s/g, '') === cleanSite || s.name.includes(siteName) || siteName.includes(s.name))) || null;
  }, [sites, currentMatchedCustomer, siteName]);

  const isOptionsDiff = useMemo(() => {
    return isOptionsChangedFromSite(currentMatchedSite, paidOptions, protection, checkedSpecs);
  }, [currentMatchedSite, paidOptions, protection, checkedSpecs]);

  const [closingDay, setClosingDay] = useState('');
  const [paymentDay, setPaymentDay] = useState('');
  const [note, setNote] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // 🖨️ [메뉴별 격리] 출고의뢰서 메뉴 전용 로컬 프린터 저장 키 (타 메뉴/타 직원 설정과 100% 독립 격리)
  const DISPATCH_PRINTER_STORAGE_KEY = 'dedicated_printer_smart_dispatch';

  const [printers, setPrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(() => {
    return localStorage.getItem(DISPATCH_PRINTER_STORAGE_KEY) || '';
  });
  const [isAgentPrinting, setIsAgentPrinting] = useState<boolean>(false);
  const [agentStatus, setAgentStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');

  // 로컬 사이드카 에이전트에서 설치된 프린터 목록 자동 로드
  useEffect(() => {
    const fetchPrinters = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5175/api/printers', { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.printers)) {
            setPrinters(data.printers);
            setAgentStatus('ONLINE');
            const saved = localStorage.getItem(DISPATCH_PRINTER_STORAGE_KEY);
            if (!saved || !data.printers.includes(saved)) {
              const defaultP = data.defaultPrinter || data.printers[0] || 'Apeos C2060';
              setSelectedPrinter(defaultP);
              if (defaultP) localStorage.setItem(DISPATCH_PRINTER_STORAGE_KEY, defaultP);
            }
          }
        }
      } catch (e) {
        setAgentStatus('OFFLINE');
      }
    };
    fetchPrinters();
  }, []);

  const handlePrinterChange = (printerName: string) => {
    setSelectedPrinter(printerName);
    localStorage.setItem(DISPATCH_PRINTER_STORAGE_KEY, printerName);
  };

  // 유니크 모델명 목록 추출
  const uniqueModels = Array.from(new Set(assets.map(a => a.modelName).filter(Boolean))).sort();

  // 프리뷰 탭 관리
  const [previewTab, setPreviewTab] = useState<'SHEET' | 'TEXT' | 'JSON'>('SHEET');

  // 💡 [동적 맞춤형 라벨 추출기] 원문 텍스트에서 '3면 함석', '4면 철망', '3면 철망' 등 실제로 감지된 구체적 키워드가 있다면 해당 명칭으로 동적 라벨명 렌더링!
  const getDynamicSpecLabel = (spec: SpecItem, text: string): string => {
    if (!text.trim()) return spec.label;
    const lowerText = text.toLowerCase();

    // spec1: 철망 / 함석 설치 면수 동적 매칭 (1면, 2면, 3면, 4면, 5면 등 범용 숫자 정규식 지원)
    if (spec.id === 'spec1') {
      // "1면 함석", "2면 철망", "3면 함석", "4면 철망", "1면함석", "2면철망" 등 정규식 캡처
      const match = text.match(/(\d+)\s*면\s*(함석|철망|망)/i) || text.match(/(함석|철망|망)\s*(\d+)\s*면/i);
      if (match) {
        const sideNum = match[1] && !isNaN(Number(match[1])) ? match[1] : match[2];
        const rawMat = (match[2] && (match[2].includes('함석') || match[2].includes('철망') || match[2].includes('망'))) ? match[2] : match[1];
        const material = rawMat.includes('함석') ? '함석' : '철망';
        return `${sideNum}면 ${material} 설치`;
      }

      // 면 수만 "1면", "2면", "3면", "4면" 으로 기재된 경우
      const sideOnlyMatch = text.match(/(\d+)\s*면/i);
      if (sideOnlyMatch) {
        const sideNum = sideOnlyMatch[1];
        const material = lowerText.includes('함석') ? '함석' : '철망';
        return `${sideNum}면 ${material} 설치`;
      }

      if (lowerText.includes('함석')) return '함석 설치';
      if (lowerText.includes('철망') || lowerText.includes('사면철망')) return '철망 설치';
    }

    // spec2: 확장대 철망 / 함석
    if (spec.id === 'spec2') {
      if (lowerText.includes('확장대 함석')) return '확장대 함석 설치';
      if (lowerText.includes('확장대 철망')) return '확장대 철망 설치';
    }

    // spec3: 감지봉 / 협착 센서 (수량 4EA 등 파싱)
    if (spec.id === 'spec3') {
      const match = text.match(/감지봉\s*(\d+\s*EA|\d+\s*개)/i);
      if (match) return `상단 감지봉 (${match[1].replace(/\s+/g, '')}) 설치`;
      if (lowerText.includes('감지봉')) return '상단 감지봉 설치';
    }

    return spec.label;
  };

  // 💡 [실시간 자연어 텍스트 스캐너] rawText 가 변경될 때 텍스트 내 포함된 요구사항을 100% 동적으로 스캔하여 자동 체크!
  useEffect(() => {
    if (!rawText.trim()) return;

    const cleanedText = rawText.toLowerCase().replace(/\s+/g, '');
    const autoSpecs: Record<string, boolean> = {};

    STANDARD_SPECS.forEach(spec => {
      const isMatched = spec.keywords.some(kw => cleanedText.includes(kw.toLowerCase().replace(/\s+/g, '')));
      autoSpecs[spec.id] = isMatched;
    });

    setCheckedSpecs(prev => ({
      ...prev,
      ...autoSpecs
    }));
  }, [rawText]);

  // ⚡ [지능형 자동 상속 엔진] 고객사명 및 현장명 기준 기존 DB 등록 정보 자동 탐색 및 빈칸 상속
  const applyAutoInheritance = (
    cName: string,
    sName: string,
    current: {
      address: string;
      salespersonName: string;
      salespersonPhone: string;
      siteContactName: string;
      siteContactPhone: string;
      siteContactEmail: string;
      billingContactName: string;
      billingContactPhone: string;
      statementEmail: string;
      taxBillEmail: string;
      paidOptions: string;
      protection: string;
      checkedSpecs: Record<string, boolean>;
      closing: string;
      payment: string;
    }
  ) => {
    if (!cName.trim()) return { ...current, inherited: [] };

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
      // 1. 고객 마스터 상속
      if (!nextTaxBillEmail && matchedCustomer.repEmail && matchedCustomer.repEmail !== '미상') {
        nextTaxBillEmail = matchedCustomer.repEmail;
        inherited.push('계산서 메일');
      }
      if (!nextClosing) {
        const d = matchedCustomer.defaultBillingDay || 30;
        nextClosing = (d === 30 || d === 31) ? '말일' : `${d}일`;
        inherited.push('마감일');
      }
      if (!nextPayment) {
        const p = matchedCustomer.paymentDueDay || 25;
        nextPayment = `익월 ${p}일`;
        inherited.push('결제일');
      }
      if (!nextPaidOptions && matchedCustomer.defaultPaidOptions) {
        nextPaidOptions = matchedCustomer.defaultPaidOptions;
        inherited.push('유상옵션(고객기본)');
      }
      if (!nextProtection && matchedCustomer.defaultProtection) {
        nextProtection = matchedCustomer.defaultProtection;
        inherited.push('보양작업(고객기본)');
      }
      if (matchedCustomer.defaultCheckedSpecs) {
        let anySpecInherited = false;
        Object.entries(matchedCustomer.defaultCheckedSpecs).forEach(([k, v]) => {
          if (v && !nextCheckedSpecs[k]) {
            nextCheckedSpecs[k] = true;
            anySpecInherited = true;
          }
        });
        if (anySpecInherited) inherited.push('기술스펙(고객기본)');
      }

      // 2. 현장(Site) 정보 상속 (현장 전용 설정이 있다면 고객 기본값보다 우선 적용!)
      const matchedSite = sites.find(
        s => s.customerId === matchedCustomer.id &&
        (sName ? (s.name.replace(/\s/g, '') === sName.replace(/\s/g, '') || s.name.includes(sName) || sName.includes(s.name)) : true)
      );

      if (matchedSite) {
        if (!nextAddress && matchedSite.address && matchedSite.address !== '미상') {
          nextAddress = matchedSite.address;
          inherited.push('현장 상세 주소');
        }
        if (!nextSiteContactName && matchedSite.contactName && matchedSite.contactName !== '미상') {
          nextSiteContactName = matchedSite.contactName;
          inherited.push('현장담당자 이름');
        }
        if (!nextSiteContactPhone && matchedSite.contact && matchedSite.contact !== '미상') {
          nextSiteContactPhone = matchedSite.contact;
          inherited.push('현장담당자 연락처');
        }
        if (!nextSiteContactEmail && matchedSite.email && matchedSite.email !== '미상') {
          nextSiteContactEmail = matchedSite.email;
          inherited.push('현장담당자 이메일');
        }
        if (matchedSite.paidOptions) {
          nextPaidOptions = matchedSite.paidOptions;
          if (!inherited.includes('유상옵션(현장)')) inherited.push('유상옵션(현장)');
        }
        if (matchedSite.protection) {
          nextProtection = matchedSite.protection;
          if (!inherited.includes('보양작업(현장)')) inherited.push('보양작업(현장)');
        }
        if (matchedSite.checkedSpecs) {
          let anySiteSpecInherited = false;
          Object.entries(matchedSite.checkedSpecs).forEach(([k, v]) => {
            if (v && !nextCheckedSpecs[k]) {
              nextCheckedSpecs[k] = true;
              anySiteSpecInherited = true;
            }
          });
          if (anySiteSpecInherited && !inherited.includes('기술스펙(현장)')) inherited.push('기술스펙(현장)');
        }
      }

      // 3. 담당자(Contacts) 정보 상속
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

      // 4. 최근 계약(Contracts)의 영업담당자 상속
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
      address: nextAddress,
      salespersonName: nextSalespersonName,
      salespersonPhone: nextSalespersonPhone,
      siteContactName: nextSiteContactName,
      siteContactPhone: nextSiteContactPhone,
      siteContactEmail: nextSiteContactEmail,
      billingContactName: nextBillingContactName,
      billingContactPhone: nextBillingContactPhone,
      statementEmail: nextStatementEmail,
      taxBillEmail: nextTaxBillEmail,
      paidOptions: nextPaidOptions,
      protection: nextProtection,
      checkedSpecs: nextCheckedSpecs,
      closing: nextClosing,
      payment: nextPayment,
      inherited
    };
  };

  // 규칙 기반 지능형 텍스트 파서 함수 (AI-less + 동의어 확장 + 자동 상속)
  const handleParse = () => {
    if (!rawText.trim()) {
      showToast('파싱할 텍스트를 입력해 주세요.', 'error');
      return;
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
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

    // 이메일 추출 Helper (공백 제거 후 / 구분자로 조인)
    const extractEmails = (str: string): string => {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matches = str.match(emailRegex);
      if (!matches) return '';
      return matches.map(e => e.replace(/\s+/g, '')).join('/');
    };

    // 전화번호 추출 Helper (공백 제거)
    const extractPhone = (str: string): string => {
      const phoneRegex = /(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g;
      const matches = str.match(phoneRegex);
      return matches ? matches[0].replace(/\s+/g, '') : '';
    };

    // 이름 추출 Helper (전화번호나 이메일 앞부분)
    const extractName = (str: string): string => {
      let namePart = str.split(/01[016789]/)[0] || str;
      namePart = namePart.split(/[a-zA-Z0-9._%+-]+@/)[0] || namePart;
      return namePart.replace(/[:\-]/g, '').replace(/선임|책임|담당자|소장|부장|과장|대리|팀장/g, '').trim();
    };

    lines.forEach(line => {
      const trimmed = line.trim();
      const val = line.includes(':') ? line.substring(line.indexOf(':') + 1).trim() : (line.includes('：') ? line.substring(line.indexOf('：') + 1).trim() : '');

      // 1. 고객사명 / 업체 / 상호
      if (/^(?:\d+[\.\)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|고객사)/i.test(trimmed)) {
        parsedCustomer = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|고객사)\s*[:：]?\s*/i, '');
      }
      // 2. 현장 상세 주소 / 배송지 (현장명보다 먼저 매칭)
      else if (/^(?:\d+[\.\)]\s*)?(?:현장\s*상세\s*주소|현장상세주소|현장\s*주소|주소|배송지)/i.test(trimmed)) {
        parsedAddress = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:현장\s*상세\s*주소|현장상세주소|현장\s*주소|주소|배송지)\s*[:：]?\s*/i, '');
      }
      // 3. 현장담당자 / 소장 / 반장 (현장명보다 먼저 매칭)
      else if (/^(?:\d+[\.\)]\s*)?(?:현장\s*담당자?|현장담당|담당자?|소장|반장)/i.test(trimmed) && !trimmed.includes('청구') && !trimmed.includes('영업')) {
        parsedSiteContactName = extractName(val);
        parsedSiteContactPhone = extractPhone(val);
        const email = extractEmails(val);
        if (email) parsedSiteContactEmail = email;
      }
      // 4. 현장명 / 현장
      else if (/^(?:\d+[\.\)]\s*)?(?:현장명?|현장)(?!\s*상세|\s*주소|\s*담당)/i.test(trimmed)) {
        parsedSite = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:현장명?|현장)\s*[:：]?\s*/i, '');
      }
      // 5. 영업담당자
      else if (/^(?:\d+[\.\)]\s*)?(?:영업\s*담당자?|영업담당|영업)/i.test(trimmed)) {
        parsedSalespersonName = extractName(val);
        parsedSalespersonPhone = extractPhone(val);
      }
      // 6. 청구담당자
      else if (/^(?:\d+[\.\)]\s*)?(?:청구\s*담당자?|청구담당|경리|회계)/i.test(trimmed)) {
        parsedBillingContactName = extractName(val);
        parsedBillingContactPhone = extractPhone(val);
        const email = extractEmails(val);
        if (email) parsedTaxBillEmail = email;
      }
      // 7. 거래명세서 수신 메일
      else if (/^(?:\d+[\.\)]\s*)?(?:거래명세서\s*(?:수신)?\s*메일|거래명세서메일|거래명세서|명세서\s*메일)/i.test(trimmed)) {
        parsedStatementEmail = extractEmails(val || trimmed);
      }
      // 8. 계산서 메일
      else if (/^(?:\d+[\.\)]\s*)?(?:계산서\s*메일|계산서메일|계산서|세금계산서)/i.test(trimmed)) {
        const email = extractEmails(val || trimmed);
        parsedTaxBillEmail = email || val;
      }
      // 9. 상차 스케줄 / 상차시간
      else if (/^(?:\d+[\.\)]\s*)?(?:상차\s*스케줄|상차스케줄|상차\s*시간|상차시간|상차)/i.test(trimmed)) {
        parsedLoading = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:상차\s*스케줄|상차스케줄|상차\s*시간|상차시간|상차)\s*[:：]?\s*/i, '');
      }
      // 10. 하차 스케줄 / 하차시간 / 도착시간
      else if (/^(?:\d+[\.\)]\s*)?(?:하차\s*스케줄|하차스케줄|하차\s*시간|하차시간|하차|도착\s*시간|도착시간|도착)/i.test(trimmed)) {
        parsedUnloading = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:하차\s*스케줄|하차스케줄|하차\s*시간|하차시간|하차|도착\s*시간|도착시간|도착)\s*[:：]?\s*/i, '');
      }
      // 11. 신청 고소작업대 모델 목록 / 모델명 / 규격
      else if (/^(?:\d+[\.\)]\s*)?(?:신청\s*(?:고소작업대\s*)?모델\s*목록|신청모델목록|신청모델|모델명?|장비명?|규격)/i.test(trimmed) || /^\s*-\s*(?:GS|SJ|JCPT|HD|star|STAR)/i.test(trimmed)) {
        const rawModelText = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:신청\s*(?:고소작업대\s*)?모델\s*목록|신청모델목록|신청모델|모델명?|장비명?|규격)\s*[:：]?\s*/i, '').replace(/^-\s*/, '');
        const parts = rawModelText.split(/[\/,]/);
        parts.forEach(p => {
          const match = p.match(/(.+?)\s*[*xX대]\s*(\d+)/) || p.match(/(.+?)\s*(\d+)\s*대/);
          if (match) {
            parsedEquipments.push({
              modelName: match[1].replace(/대$/, '').trim(),
              qty: parseInt(match[2]) || 1
            });
          } else {
            if (p.trim()) {
              parsedEquipments.push({
                modelName: p.trim(),
                qty: 1
              });
            }
          }
        });
      }
      // 12. 유상옵션
      else if (/^(?:\d+[\.\)]\s*)?(?:유상\s*옵션|유상옵션|옵션)/i.test(trimmed) && !trimmed.includes('요구') && !trimmed.includes('스펙')) {
        parsedPaidOptions = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:유상\s*옵션|유상옵션|옵션)\s*[:：]?\s*/i, '');
      }
      // 13. 보양작업
      else if (/^(?:\d+[\.\)]\s*)?(?:보양\s*작업\s*조건|보양작업조건|보양\s*작업|보양작업|보양)/i.test(trimmed)) {
        parsedProtection = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:보양\s*작업\s*조건|보양작업조건|보양\s*작업|보양작업|보양)\s*[:：]?\s*/i, '');
      }
      // 14. 마감일
      else if (/^(?:\d+[\.\)]\s*)?(?:마감일|청구\s*마감일)/i.test(trimmed)) {
        parsedClosing = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:마감일|청구\s*마감일)\s*[:：]?\s*/i, '');
      }
      // 15. 결제일
      else if (/^(?:\d+[\.\)]\s*)?(?:결제일|입금일)/i.test(trimmed)) {
        parsedPayment = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:결제일|입금일)\s*[:：]?\s*/i, '');
      }
      // 16. 특이사항 / 배차메모
      else if (/^(?:\d+[\.\)]\s*)?(?:특이사항|비고|배차\s*메모|배차메모)/i.test(trimmed)) {
        parsedNote = val || trimmed.replace(/^(?:\d+[\.\)]\s*)?(?:특이사항|비고|배차\s*메모|배차메모)\s*[:：]?\s*/i, '');
      }
    });

    // 21가지 표준 스펙 체크 박스 상태 추출 매칭 논리 (공백 제거 후 키워드 탐색)
    const cleanedRawText = rawText.replace(/\s+/g, '');
    const newCheckedSpecs: Record<string, boolean> = {};
    STANDARD_SPECS.forEach(spec => {
      const matched = spec.keywords.some(kw => cleanedRawText.includes(kw.replace(/\s+/g, '')));
      newCheckedSpecs[spec.id] = matched;
    });

    // ⚡ [지능형 자동 상속 엔진 실행] DB에 등록된 기존 정보가 있다면 누락된 빈칸 및 옵션/보양 자동 채움!
    const inheritedResult = applyAutoInheritance(parsedCustomer, parsedSite, {
      address: parsedAddress,
      salespersonName: parsedSalespersonName,
      salespersonPhone: parsedSalespersonPhone,
      siteContactName: parsedSiteContactName,
      siteContactPhone: parsedSiteContactPhone,
      siteContactEmail: parsedSiteContactEmail,
      billingContactName: parsedBillingContactName,
      billingContactPhone: parsedBillingContactPhone,
      statementEmail: parsedStatementEmail,
      taxBillEmail: parsedTaxBillEmail,
      paidOptions: parsedPaidOptions,
      protection: parsedProtection,
      checkedSpecs: newCheckedSpecs,
      closing: parsedClosing,
      payment: parsedPayment
    });

    // 상태 업데이트
    setCustomerName(parsedCustomer);
    setSiteName(parsedSite);
    setSiteAddress(inheritedResult.address);
    setSalespersonName(inheritedResult.salespersonName);
    setSalespersonPhone(inheritedResult.salespersonPhone);
    setSiteContactName(inheritedResult.siteContactName);
    setSiteContactPhone(inheritedResult.siteContactPhone);
    setSiteContactEmail(inheritedResult.siteContactEmail);
    setBillingContactName(inheritedResult.billingContactName);
    setBillingContactPhone(inheritedResult.billingContactPhone);
    setStatementEmail(inheritedResult.statementEmail);
    setTaxBillEmail(inheritedResult.taxBillEmail);
    setLoadingTime(parsedLoading);
    setUnloadingTime(parsedUnloading);
    setEquipments(parsedEquipments.length > 0 ? parsedEquipments : [{ modelName: '', qty: 1 }]);
    setPaidOptions(inheritedResult.paidOptions);
    setProtection(inheritedResult.protection);
    setCheckedSpecs(inheritedResult.checkedSpecs);
    setClosingDay(inheritedResult.closing);
    setPaymentDay(inheritedResult.payment);
    setNote(parsedNote);
    setInheritedFieldList(inheritedResult.inherited);

    if (inheritedResult.inherited.length > 0) {
      showToast('텍스트 분석 및 기존 DB 자동 상속이 완료되었습니다.');
    } else {
      showToast('정규식 분석이 완료되어 폼 필드가 대입되었습니다.');
    }
  };

  // 장비 모델 행 동적 관리
  const handleAddEquipment = () => {
    setEquipments([...equipments, { modelName: '', qty: 1 }]);
  };

  const handleRemoveEquipment = (index: number) => {
    if (equipments.length <= 1) return;
    setEquipments(equipments.filter((_, i) => i !== index));
  };

  const handleEquipmentChange = (index: number, field: keyof EquipmentItem, value: any) => {
    const updated = [...equipments];
    updated[index] = { ...updated[index], [field]: value };
    setEquipments(updated);
  };

  // 체크박스 토글
  const handleToggleSpec = (id: string) => {
    setCheckedSpecs(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // 체크박스 일괄 설정
  const handleSetAllSpecs = (status: boolean) => {
    const updated: Record<string, boolean> = {};
    STANDARD_SPECS.forEach(spec => {
      updated[spec.id] = status;
    });
    setCheckedSpecs(updated);
  };

  // 실시간 정형 텍스트 생성 (적용된 스펙 요구사항 필터링 표시)
  const generateFormattedText = () => {
    const activeSpecs = STANDARD_SPECS.filter(s => checkedSpecs[s.id]);
    return (
`* 기연리프트 출고 요청서 *

■ 기본 정보
- 고객명 : ${customerName || '-'}
- 현장명 : ${siteName || '-'}
- 현장 상세 주소 : ${siteAddress || '-'}

■ 담당자 정보
- 현장담당자 : ${siteContactName || '-'} (연락처: ${siteContactPhone || '-'} / 메일: ${siteContactEmail || '-'})
- 청구담당자 : ${billingContactName || '-'} (연락처: ${billingContactPhone || '-'})
- 거래명세서 메일 : ${statementEmail || '-'}
- 계산서 메일 : ${taxBillEmail || '-'}

■ 배송 및 장비 상세
- 상차스케줄 : ${loadingTime || '-'}
- 하차스케줄 : ${unloadingTime || '-'}
- 임대 장비 : ${equipments.map(e => `${e.modelName || '미지정'} * ${e.qty}대`).join(' / ')}

■ 옵션 및 보양 스펙
- 유상옵션 : ${paidOptions || '없음'}
- 보양작업 : ${protection || '없음'}
- 필수 요구사항 (적용 항목) :
${activeSpecs.map((s, idx) => `  ${idx + 1}. [적용] ${s.label}`).join('\n') || '  - 특이 적용 사양 없음'}

■ 회계 정산 정보
- 마감일 : ${closingDay || '-'}
- 결제일 : ${paymentDay || '-'}
- 특이사항 : ${note || '없음'}`
    );
  };

  // 실시간 JSON 생성 (전체 체크박스 맵과 적용 배열 동시 출력)
  const generateJSON = () => {
    const activeSpecLabels = STANDARD_SPECS.filter(s => checkedSpecs[s.id]).map(s => s.label);
    return JSON.stringify({
      customerInfo: {
        customerName,
        siteName,
        siteAddress
      },
      contacts: {
        siteManager: {
          name: siteContactName,
          phone: siteContactPhone,
          emails: siteContactEmail ? siteContactEmail.split('/') : []
        },
        billingManager: {
          name: billingContactName,
          phone: billingContactPhone
        },
        receivers: {
          statementEmail: statementEmail ? statementEmail.split('/') : [],
          taxBillEmail: taxBillEmail
        }
      },
      logistics: {
        loadingTime,
        unloadingTime,
        equipments
      },
      options: {
        paidOptions,
        protection,
        technicalSpecsMap: checkedSpecs,
        activeTechnicalSpecs: activeSpecLabels
      },
      accounting: {
        closingDay,
        paymentDay,
        note
      },
      meta: {
        parserType: "Deterministic Rule-based RegExp",
        parsedAt: new Date().toISOString()
      }
    }, null, 2);
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('클립보드에 복사되었습니다.');
  };

  // 🖨️ 브라우저 고품질 인쇄 모달 실행 메소드
  const handlePrint = () => {
    const printContent = document.getElementById('dispatch-sheet-print');
    if (!printContent) {
      showToast('인쇄할 출고의뢰서 콘텐츠를 찾을 수 없습니다.', 'error');
      return;
    }

    const uniqueName = new Date().getTime();
    const printWindow = window.open('', `Print_${uniqueName}`, 'left=150,top=100,width=880,height=950,menubar=no,toolbar=no,location=no,status=no');
    
    if (!printWindow) {
      showToast('브라우저 팝업이 차단되었습니다.', 'error');
      return;
    }

    const htmlDoc = `
      <!DOCTYPE html>
      <html lang="ko">
        <head>
          <meta charset="utf-8">
          <title>출고의뢰서_${customerName || '고객사'}_${siteName || '현장'}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm 15mm 15mm;
            }
            @media print {
              body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .no-print {
                display: none !important;
              }
            }
            * {
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
              padding: 0;
              margin: 0 auto;
              color: #111827;
              background-color: #ffffff;
              width: 100%;
              max-width: 210mm;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 16px;
            }
            th, td {
              border: 1px solid #cbd5e1;
              padding: 8px 10px;
              text-align: left;
              font-size: 12px;
              line-height: 1.4;
            }
            th {
              background-color: #f8fafc !important;
              font-weight: 700;
              color: #334155;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          </style>
        </head>
        <body>
          <div style="padding: 10px 0;">
            ${printContent.innerHTML}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 250);
            };
            window.onafterprint = function() {
              window.close();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlDoc);
    printWindow.document.close();
  };

  // 컴포넌트 마운트 시 자동 예제 파싱 실행
  useEffect(() => {
    if (rawText) {
      const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let parsedContractNo = '';
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
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = str.match(emailRegex);
        if (!matches) return '';
        return matches.map(e => e.replace(/\s+/g, '')).join('/');
      };

      const extractPhone = (str: string): string => {
        const phoneRegex = /(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g;
        const matches = str.match(phoneRegex);
        return matches ? matches[0].replace(/\s+/g, '') : '';
      };

      const extractName = (str: string): string => {
        let namePart = str.split(/01[016789]/)[0] || str;
        namePart = namePart.split(/[a-zA-Z0-9._%+-]+@/)[0] || namePart;
        return namePart.replace(/[:\-]/g, '').replace(/선임|책임|담당자/g, '').trim();
      };

      lines.forEach(line => {
        if (line.includes('계약번호') || line.includes('계약 No') || line.includes('계약NO') || line.includes('계약 no')) parsedContractNo = line.split(':')[1]?.trim() || '';
        else if (line.includes('고객명') || line.includes('고객사명')) parsedCustomer = line.split(':')[1]?.trim() || '';
        else if (line.includes('현장명')) parsedSite = line.split(':')[1]?.trim() || '';
        else if (line.includes('현장 상세 주소') || line.includes('현장상세주소') || line.includes('현장주소')) parsedAddress = line.split(':')[1]?.trim() || '';
        else if (line.includes('영업담당') || line.includes('영업사원') || line.includes('영업담당자') || line.includes('담당영업')) {
          const val = line.split(':')[1] || '';
          parsedSalespersonName = extractName(val);
          parsedSalespersonPhone = extractPhone(val);
        } else if (line.includes('현장담당자') || line.includes('현장 담당자')) {
          const val = line.split(':')[1] || '';
          parsedSiteContactName = extractName(val);
          parsedSiteContactPhone = extractPhone(val);
        } else if (line.includes('담당자 메일') || line.includes('담당자메일')) {
          const val = line.split(':')[1] || '';
          parsedSiteContactEmail = extractEmails(val);
        } else if (line.includes('강경현책임') || line.includes('강경현 책임')) {
          const val = line.split(':')[1] || '';
          const email = extractEmails(val);
          if (email) parsedSiteContactEmail = parsedSiteContactEmail ? `${parsedSiteContactEmail}/${email}` : email;
        } else if (line.includes('상차시간') || line.includes('상차 시간') || line.includes('상차일시')) parsedLoading = line.split(':')[1]?.trim() || '';
        else if (line.includes('하차시간') || line.includes('하차 시간') || line.includes('하차일시')) parsedUnloading = line.split(':')[1]?.trim() || '';
        else if (line.includes('모델명') || line.includes('장비명') || line.includes('투입장비')) {
          const val = line.split(':')[1] || '';
          val.split('/').forEach(p => {
            const match = p.match(/(.+?)\s*[*xX]\s*(\d+)/);
            if (match) parsedEquipments.push({ modelName: match[1].trim(), qty: parseInt(match[2]) || 1 });
            else if (p.trim()) parsedEquipments.push({ modelName: p.trim(), qty: 1 });
          });
        } else if (line.includes('유상옵션') || line.includes('유상 옵션')) parsedPaidOptions = line.split(':')[1]?.trim() || '';
        else if (line.includes('보양')) parsedProtection = line.split(':')[1]?.trim() || '';
        else if (line.includes('청구담당자') || line.includes('청구 담당자')) {
          const val = line.split(':')[1] || '';
          parsedBillingContactName = extractName(val);
          parsedBillingContactPhone = extractPhone(val);
        } else if (line.includes('거래명세서')) {
          const val = line.split(':')[1] || '';
          parsedStatementEmail = extractEmails(val);
        } else if (line.includes('계산서메일') || line.includes('계산서 메일')) {
          const val = line.split(':')[1]?.trim() || '';
          parsedTaxBillEmail = extractEmails(val) || val;
        } else if (line.includes('마감일')) parsedClosing = line.split(':')[1]?.trim() || '';
        else if (line.includes('결제일')) parsedPayment = line.split(':')[1]?.trim() || '';
        else if (line.includes('특이사항') || line.includes('메모')) parsedNote = line.split(':')[1]?.trim() || '';
      });

      const cleanedRawText = rawText.replace(/\s+/g, '');
      const newCheckedSpecs: Record<string, boolean> = {};
      STANDARD_SPECS.forEach(spec => {
        newCheckedSpecs[spec.id] = spec.keywords.some(kw => cleanedRawText.includes(kw.replace(/\s+/g, '')));
      });

      setContractNo(parsedContractNo);
      setCustomerName(parsedCustomer);
      setSiteName(parsedSite);
      setSiteAddress(parsedAddress);
      setSalespersonName(parsedSalespersonName || currentUser?.name || '');
      setSalespersonPhone(parsedSalespersonPhone || currentUser?.phone || '');
      setSiteContactName(parsedSiteContactName);
      setSiteContactPhone(parsedSiteContactPhone);
      setSiteContactEmail(parsedSiteContactEmail);
      setBillingContactName(parsedBillingContactName);
      setBillingContactPhone(parsedBillingContactPhone);
      setStatementEmail(parsedStatementEmail);
      setTaxBillEmail(parsedTaxBillEmail);
      setLoadingTime(parsedLoading);
      setUnloadingTime(parsedUnloading);
      setEquipments(parsedEquipments.length > 0 ? parsedEquipments : [{ modelName: '', qty: 1 }]);
      setPaidOptions(parsedPaidOptions);
      setProtection(parsedProtection);
      setCheckedSpecs(newCheckedSpecs);
      setClosingDay(parsedClosing);
      setPaymentDay(parsedPayment);
      setNote(parsedNote);
    }
  }, [rawText, currentUser]);

  const findSuggestedModel = (inputModel: string, officialModels: string[]): string | null => {
    if (!inputModel || !inputModel.trim()) return null;
    const cleanedInput = inputModel.replace(/[\s\-_]/g, '').toLowerCase();

    // 1. 공백/특수문자 제거 후 부분 문자열 매칭
    let matched = officialModels.find(m => {
      const cleanedM = m.replace(/[\s\-_]/g, '').toLowerCase();
      return cleanedM.includes(cleanedInput) || cleanedInput.includes(cleanedM);
    });
    if (matched) return matched;

    // 2. 3~4자리 연속 숫자 패턴 매칭 (예: "1212", "1930", "2646", "3219" 등)
    const nums = inputModel.match(/\d{3,4}/);
    if (nums) {
      const targetNum = nums[0];
      matched = officialModels.find(m => m.includes(targetNum));
      if (matched) return matched;
    }

    return null;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSave = async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (isSubmitting) return;

    if (!canSave) {
      showToast('저장 권한이 없습니다.', 'error');
      return;
    }
    
    // 🛡️ 1. [방어 가드 - Validation Guard] 필수 항목 검증 및 진행 차단
    if (!customerName.trim()) {
      showToast('고객사명을 입력하거나 메신저 텍스트를 파싱해주세요.', 'error');
      return;
    }
    if (!siteName.trim()) {
      showToast('현장명을 입력하거나 메신저 텍스트를 파싱해주세요.', 'error');
      return;
    }

    const matchedCust = findCustomerByNormalizedName(customers, customerName);
    if (matchedCust?.transactionStatus === 'BLOCKED') {
      showToast('🚫 경영진 처분으로 인해 거래 불가(BLOCKED) 상태인 거래처입니다. 신규 출고의뢰 발행이 차단됩니다.', 'error');
      return;
    }
    if (matchedCustOverdue && matchedCustOverdue.overdueSum > 0 && !dispatchOverdueAcknowledged) {
      showToast('⚠️ 연체 채권 경각심 통제: [수금 책임 인지] 확인 체크박스에 동의해야 출고의뢰를 발행할 수 있습니다.', 'error');
      return;
    }
    const matchedSite = matchedCust ? sites.find(s => s.customerId === matchedCust.id && (s.name.replace(/\s/g, '') === siteName.replace(/\s/g, '') || s.name.includes(siteName) || siteName.includes(s.name))) : null;

    const finalAddress = siteAddress.trim() || (matchedSite?.address && matchedSite.address !== '미상' ? matchedSite.address : '');
    if (!finalAddress) {
      showToast('현장 상세 주소를 반드시 입력해주세요.', 'error');
      return; // 🚫 진행 차단
    }

    const finalPhone = siteContactPhone.trim() || (matchedSite?.contact && matchedSite.contact !== '미상' ? matchedSite.contact : '');
    if (!finalPhone) {
      showToast('현장 담당자 연락처를 반드시 입력해주세요.', 'error');
      return; // 🚫 진행 차단
    }

    const validEquips = equipments.filter(e => e.modelName?.trim());
    if (validEquips.length === 0) {
      showToast('신청 고소작업대 모델을 최소 1대 이상 선택해주세요.', 'error');
      return; // 🚫 진행 차단
    }

    setIsSubmitting(true);
    try {

    // 🔍 장비 모델명 정식 검증 & 인터랙티브 변경 승인 팝업
    const officialModels: string[] = uniqueModels.length > 0 ? uniqueModels : products.map((p: any) => p.modelName);
    const updatedEquipments = [...equipments];
    for (let i = 0; i < updatedEquipments.length; i++) {
      const eq = updatedEquipments[i];
      const inputModel = eq.modelName?.trim();
      if (!inputModel) continue;

      const isExactOfficial = officialModels.some(m => m === inputModel);
      if (!isExactOfficial) {
        const suggestedModel = findSuggestedModel(inputModel, officialModels);
        if (suggestedModel) {
          updatedEquipments[i].modelName = suggestedModel;
          setEquipments(updatedEquipments);
          showToast(`모델명이 정식 명칭 [${suggestedModel}]로 자동 보정되었습니다.`);
        } else {
          showToast(`입력하신 모델명 '${inputModel}'은(는) 등록된 자산 모델이 아닙니다.`, 'error');
          return; // 저장 중단
        }
      }
    }

    const data = {
      customerName, siteName, siteAddress, salespersonName, salespersonPhone,
      siteContactName, siteContactPhone, siteContactEmail,
      billingContactName, billingContactPhone, statementEmail, taxBillEmail,
      loadingTime, unloadingTime, equipments: updatedEquipments, note, rawText: rawText || note,
      paidOptions, protection, checkedSpecs, saveOptionsToSite, isSetAsCustomerDefault, applyToAllSites,
      closingDay, paymentDay
    };

    // 프로세스 진행 모달 초기화
    setProgressLogs([]);
    setProgressPercent(0);
    setCurrentStepText('🚀 스마트 출고 파이프라인 가동 준비 중...');
    setIsProcessCompleted(false);
    setIsProcessingModalOpen(true);

    const onProgress = (logText: string, pct: number) => {
      setProgressPercent(pct);
      setCurrentStepText(logText);
      setProgressLogs(prev => [...prev, logText]);
    };

    let result = await saveSmartDispatch(data, false, onProgress);

    if (result.requiresConfirm) {
      showToast('신규 고객/현장을 자동 등록하고 출고 프로세스를 연속 진행합니다.');
      setProgressLogs([]);
      setProgressPercent(0);
      setCurrentStepText('🚀 신규 고객/현장 등록 & 출고 프로세스 재가동 중...');
      setIsProcessCompleted(false);
      setIsProcessingModalOpen(true);

      result = await saveSmartDispatch(data, true, onProgress);
    }

    if (result.errorMessage) {
      setIsProcessingModalOpen(false);
      showErrorModal(result.errorMessage, '스마트 출고 요청 저장 오류');
      return;
    }

    if (result.success) {
      setIsProcessCompleted(true);
      if (result.contractNo) {
        setContractNo(result.contractNo);
      }
      setRawText('');
    }
    } catch (err: any) {
      console.error('handleSave error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
      
      {/* 타이틀 및 상단 프린터 제어 툴바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontWeight: '700', marginBottom: '4px' }}>출고 요청 입력</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>메신저/카카오톡 출고 의뢰 줄글을 정규식으로 안전하게 분석하여 데이터화합니다.</p>
          </div>
        </div>

        {/* 🖨️ 상단 로컬 프린터 지정 및 출고의뢰서 인쇄 컨트롤 패널 */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '10px',
          padding: '8px 12px',
          backgroundColor: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          flexWrap: 'wrap'
        }}>
          {/* 레이블-입력창 세로 스택 (전사 표준 헌장 3.4 준수) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                로컬 프린터 지정
              </label>
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
                color: agentStatus === 'ONLINE' ? '#16a34a' : '#9ca3af',
                backgroundColor: agentStatus === 'ONLINE' ? 'rgba(22, 163, 74, 0.1)' : 'var(--bg-app)',
                padding: '1px 6px',
                borderRadius: '4px'
              }}>
                {agentStatus === 'ONLINE' ? '에이전트 연결됨' : '브라우저 인쇄'}
              </span>
            </div>
            <select
              value={selectedPrinter}
              onChange={(e) => handlePrinterChange(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                fontWeight: '600',
                minWidth: '200px',
                cursor: 'pointer'
              }}
            >
              {printers.length > 0 ? (
                printers.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))
              ) : (
                <option value={selectedPrinter || 'Apeos C2060'}>
                  {selectedPrinter || 'Apeos C2060 (기본)'}
                </option>
              )}
            </select>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handlePrint}
            disabled={isAgentPrinting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              padding: '7px 14px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              height: '33px'
            }}
          >
            <Printer size={14} />
            {isAgentPrinting ? '인쇄 전송중...' : '출고의뢰서 인쇄'}
          </button>
        </div>
      </div>

      {/* 출고 의뢰 분석 상태 바 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', backgroundColor: 'var(--bg-card)',
        borderRadius: '8px', border: '1px solid var(--border-color)',
        fontSize: '12.5px', flexWrap: 'wrap', gap: '12px'
      }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div>파서 상태: <strong style={{ color: '#16a34a' }}>정규식 파서 가동</strong></div>
          <div>분석 모드: <strong style={{ color: 'var(--primary)' }}>의뢰별 맞춤 스펙 추출</strong></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', alignItems: 'start' }}>
        
        {/* 1단계: 레거시 통텍스트 입력 및 스마트 변환 */}
        <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '62px', flexWrap: 'wrap', gap: '8px' }}>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
              <Clipboard size={16} className="text-primary" /> 1단계: 메신저 줄글 텍스트 복사/붙여넣기
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="file"
                ref={txtFileInputRef}
                style={{ display: 'none' }}
                accept=".txt,.log,.csv"
                onChange={handleTextFileChange}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => txtFileInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12.5px' }}
              >
                📂 텍스트 파일 불러오기
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleParse}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '13px', fontWeight: 'bold' }}
              >
                <Zap size={14} /> 폼 데이터로 변환 (추출)
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '12px' }}>
            <textarea
              style={{ flex: 1, minHeight: '380px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6', padding: '12px', resize: 'vertical' }}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder="여기에 메신저로 복사한 출고 줄글 텍스트를 그대로 붙여넣으세요..."
            />
          </div>
        </div>

        {/* 2단계: 구조화 개별 입력 및 편집 폼 */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '62px' }}>
            <h3 className="card-title" style={{ margin: 0 }}>2단계: 개별 세부 정보 확인 및 보정 폼</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn-secondary" onClick={() => setRawText('')} style={{ padding: '6px 12px', fontSize: '13px' }}>
                초기화
              </button>
              {canSave && (
                <button type="button" className="btn-primary" onClick={handleSave} style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 'bold' }}>
                  출고 지시 (자동 생성 및 저장)
                </button>
              )}
            </div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            
            {/* ⚡ 기존 DB 정보 자동 상속 안내 배너 */}
            {inheritedFieldList.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '6px',
                color: '#10b981',
                fontSize: '12px',
                fontWeight: '600'
              }}>
                <CheckCircle2 size={16} color="#10b981" />
                <span>⚡ 기존 DB 자동 상속: {inheritedFieldList.join(', ')}</span>
                <span style={{ fontSize: '11px', color: '#15803d', fontWeight: '400', marginLeft: 'auto' }}>
                  (새로운 입력 시 고객/현장 마스터가 자동 최신화됩니다)
                </span>
              </div>
            )}

            {/* 섹션 1: 고객사 및 현장 기본정보 */}
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>1. 기본 고객 및 현장 정보</span>
                {findCustomerByNormalizedName(customers, customerName) && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#16a34a', backgroundColor: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>
                    ✓ 등록 고객사 매핑됨
                  </span>
                )}
              </h4>
              {matchedCustOverdue && (
                <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: matchedCustOverdue.isBlocked ? '#fef2f2' : '#fffbeb', border: `1px solid ${matchedCustOverdue.isBlocked ? '#f87171' : '#fcd34d'}`, color: matchedCustOverdue.isBlocked ? '#991b1b' : '#92400e', marginBottom: '12px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <AlertTriangle size={15} color={matchedCustOverdue.isBlocked ? '#dc2626' : '#d97706'} />
                    {matchedCustOverdue.isBlocked ? '🚫 [경영진 처분] 거래 불가 (BLOCKED)' : '⚠️ [연체 채권 경각심 통제 경보]'}
                  </div>
                  <div>
                    {matchedCustOverdue.isBlocked
                      ? '해당 고객사는 경영진의 출고금지(BLOCKED) 처분으로 신규 출고의뢰 발행이 전면 차단되어 있습니다.'
                      : `해당 거래처는 약정 납기일이 도과된 미납 청구서 ${matchedCustOverdue.count}건 (총 ₩${matchedCustOverdue.overdueSum.toLocaleString()}원)이 존재합니다.`
                    }
                  </div>
                  {!matchedCustOverdue.isBlocked && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontWeight: 700, cursor: 'pointer' }}>
                      <input type="checkbox" checked={dispatchOverdueAcknowledged} onChange={e => setDispatchOverdueAcknowledged(e.target.checked)} />
                      <span>☑️ [수금 책임 인지] "위 연체 사실 및 경영진 모니터링 현황을 확인하였으며, 신규 출고 진행에 따른 수금 관리에 책임을 다할 것을 확인합니다."</span>
                    </label>
                  )}
                </div>
              )}

              <div className="mobile-grid-1col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label>계약번호</label>
                  <input type="text" value={contractNo} onChange={e => setContractNo(e.target.value)} placeholder="예: CT-2026-00123" />
                </div>
                <div>
                  <label>고객사명 <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    list="smart-dispatch-customer-list"
                    value={customerName}
                    onChange={e => {
                      const val = e.target.value;
                      setCustomerName(val);
                      const matched = findCustomerByNormalizedName(customers, val);
                      if (matched) {
                        const res = applyAutoInheritance(val, siteName, {
                          address: siteAddress,
                          salespersonName,
                          salespersonPhone,
                          siteContactName,
                          siteContactPhone,
                          siteContactEmail,
                          billingContactName,
                          billingContactPhone,
                          statementEmail,
                          taxBillEmail,
                          paidOptions,
                          protection,
                          checkedSpecs,
                          closing: closingDay,
                          payment: paymentDay
                        });
                        setSiteAddress(res.address);
                        setSalespersonName(res.salespersonName);
                        setSalespersonPhone(res.salespersonPhone);
                        setSiteContactName(res.siteContactName);
                        setSiteContactPhone(res.siteContactPhone);
                        setSiteContactEmail(res.siteContactEmail);
                        setBillingContactName(res.billingContactName);
                        setBillingContactPhone(res.billingContactPhone);
                        setStatementEmail(res.statementEmail);
                        setTaxBillEmail(res.taxBillEmail);
                        setPaidOptions(res.paidOptions);
                        setProtection(res.protection);
                        setCheckedSpecs(res.checkedSpecs);
                        setClosingDay(res.closing);
                        setPaymentDay(res.payment);
                        setInheritedFieldList(res.inherited);
                      }
                    }}
                    placeholder="고객사명 입력 또는 선택"
                  />
                  <datalist id="smart-dispatch-customer-list">
                    {customers.map(c => <option key={c.id} value={c.name} />)}
                  </datalist>
                </div>
                <div>
                  <label>현장명 <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    list="smart-dispatch-site-list"
                    value={siteName}
                    onChange={e => {
                      const val = e.target.value;
                      setSiteName(val);
                      if (customerName) {
                        const res = applyAutoInheritance(customerName, val, {
                          address: siteAddress,
                          salespersonName,
                          salespersonPhone,
                          siteContactName,
                          siteContactPhone,
                          siteContactEmail,
                          billingContactName,
                          billingContactPhone,
                          statementEmail,
                          taxBillEmail,
                          paidOptions,
                          protection,
                          checkedSpecs,
                          closing: closingDay,
                          payment: paymentDay
                        });
                        setSiteAddress(res.address);
                        setSiteContactName(res.siteContactName);
                        setSiteContactPhone(res.siteContactPhone);
                        setSiteContactEmail(res.siteContactEmail);
                        setPaidOptions(res.paidOptions);
                        setProtection(res.protection);
                        setCheckedSpecs(res.checkedSpecs);
                        setInheritedFieldList(res.inherited);
                      }
                    }}
                    placeholder="현장명 입력 또는 선택"
                  />
                  <datalist id="smart-dispatch-site-list">
                    {sites
                      .filter(s => {
                        const mc = findCustomerByNormalizedName(customers, customerName);
                        return mc ? s.customerId === mc.id : true;
                      })
                      .map(s => <option key={s.id} value={s.name} />)}
                  </datalist>
                </div>
              </div>
              <div style={{ marginTop: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>현장 상세 주소 <span style={{ color: '#ef4444' }}>*</span></span>
                  {inheritedFieldList.includes('현장 상세 주소') && (
                    <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>[DB 상속됨]</span>
                  )}
                </label>
                <input
                  type="text"
                  value={siteAddress}
                  onChange={e => setSiteAddress(e.target.value)}
                  placeholder="예: 경기도 평택시 고덕면 고덕산단로 123"
                  style={{
                    borderColor: !siteAddress && customerName ? '#fca5a5' : undefined
                  }}
                />
              </div>
            </div>

            {/* 섹션 2: 담당자 상세망 */}
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                2. 업무 관계자 정보 (영업, 현장, 청구)
              </h4>
              <div className="mobile-grid-1col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div>
                  <label>영업담당자 이름</label>
                  <input type="text" value={salespersonName} onChange={e => setSalespersonName(e.target.value)} placeholder="예: 홍길동" />
                </div>
                <div>
                  <label>영업담당자 연락처</label>
                  <input type="text" value={salespersonPhone} onChange={e => setSalespersonPhone(e.target.value)} placeholder="예: 010-1234-5678" />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>현장담당자 이름</span>
                    {inheritedFieldList.includes('현장담당자 이름') && (
                      <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>[DB 상속됨]</span>
                    )}
                  </label>
                  <input type="text" value={siteContactName} onChange={e => setSiteContactName(e.target.value)} placeholder="예: 김소장" />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>현장담당자 연락처 <span style={{ color: '#ef4444' }}>*</span></span>
                    {(inheritedFieldList.includes('현장담당자 연락처') || inheritedFieldList.includes('현장담당자(연락처)')) && (
                      <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>[DB 상속됨]</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={siteContactPhone}
                    onChange={e => setSiteContactPhone(e.target.value)}
                    placeholder="예: 010-1234-5678"
                    style={{
                      borderColor: !siteContactPhone && customerName ? '#fca5a5' : undefined
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>청구담당자 이름</span>
                    {inheritedFieldList.includes('청구담당자') && (
                      <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>[DB 상속됨]</span>
                    )}
                  </label>
                  <input type="text" value={billingContactName} onChange={e => setBillingContactName(e.target.value)} placeholder="예: 이대리" />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>청구담당자 연락처</span>
                    {inheritedFieldList.includes('청구담당자 연락처') && (
                      <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>[DB 상속됨]</span>
                    )}
                  </label>
                  <input type="text" value={billingContactPhone} onChange={e => setBillingContactPhone(e.target.value)} placeholder="예: 010-9876-5432" />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>거래명세서 수신 메일</span>
                  </label>
                  <input type="text" value={statementEmail} onChange={e => setStatementEmail(e.target.value.replace(/\s+/g, ''))} placeholder="예: site@company.co.kr" />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>계산서 메일</span>
                    {inheritedFieldList.includes('계산서 메일') && (
                      <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>[DB 상속됨]</span>
                    )}
                  </label>
                  <input type="text" value={taxBillEmail} onChange={e => setTaxBillEmail(e.target.value)} placeholder="예: tax@company.co.kr" />
                </div>
              </div>
            </div>

            {/* 섹션 3: 배송 스케줄 및 모델 */}
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                3. 배송 배차 일정 및 신청 장비 모델
              </h4>
              <div className="mobile-grid-1col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
                <div>
                  <label>상차 스케줄</label>
                  <input type="text" value={loadingTime} onChange={e => setLoadingTime(e.target.value)} placeholder="예: 07.18(토) 오전 8시 상차" />
                </div>
                <div>
                  <label>하차 스케줄</label>
                  <input type="text" value={unloadingTime} onChange={e => setUnloadingTime(e.target.value)} placeholder="예: 07.18(토) 오전 하차" />
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span>신청 고소작업대 모델 목록</span>
                  <button type="button" className="btn-secondary" onClick={handleAddEquipment} style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <Plus size={12} /> 모델 추가
                  </button>
                </label>
                
                {equipments.map((eq, index) => (
                  <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                    <input
                      type="text"
                      list="unique-models"
                      placeholder="모델 선택 또는 직접 입력 (예: GS3246)"
                      value={eq.modelName}
                      onChange={e => handleEquipmentChange(index, 'modelName', e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="number"
                      placeholder="수량"
                      value={eq.qty}
                      onChange={e => handleEquipmentChange(index, 'qty', parseInt(e.target.value) || 1)}
                      style={{ flex: 1 }}
                      min={1}
                    />
                    {equipments.length > 1 && (
                      <button type="button" className="btn-danger" onClick={() => handleRemoveEquipment(index)} style={{ padding: '6px' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                
                {/* 콤보박스 자동완성(Datalist) 데이터 */}
                <datalist id="unique-models">
                  {uniqueModels.map(model => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* 섹션 4: 필수 기술 요구사항 체크리스트 (자연어 원문 텍스트 동적 생성 반영) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  4. 필수 요구사항 체크리스트 (요청 텍스트 분석 동적 생성)
                </h4>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowAllSpecs(!showAllSpecs)} style={{ padding: '3px 8px', fontSize: '11.5px', fontWeight: 700 }}>
                    {showAllSpecs ? '▲ 추출 항목만 보기' : '▼ 전체 21개 스펙 펼치기'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => handleSetAllSpecs(true)} style={{ padding: '2px 6px', fontSize: '11px' }}>전체선택</button>
                  <button type="button" className="btn-secondary" onClick={() => handleSetAllSpecs(false)} style={{ padding: '2px 6px', fontSize: '11px' }}>전체해제</button>
                </div>
              </div>

              <div className="mobile-grid-1col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>유상 옵션 내역</span>
                    {(inheritedFieldList.includes('유상옵션(현장)') || inheritedFieldList.includes('유상옵션(고객기본)')) && (
                      <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>
                        [{inheritedFieldList.includes('유상옵션(현장)') ? '현장 DB 상속' : '고객 기본 상속'}]
                      </span>
                    )}
                  </label>
                  <input type="text" value={paidOptions} onChange={e => setPaidOptions(e.target.value)} placeholder="예: 3면 함석, 감지봉 4EA..." />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>보양작업 조건</span>
                    {(inheritedFieldList.includes('보양작업(현장)') || inheritedFieldList.includes('보양작업(고객기본)')) && (
                      <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>
                        [{inheritedFieldList.includes('보양작업(현장)') ? '현장 DB 상속' : '고객 기본 상속'}]
                      </span>
                    )}
                  </label>
                  <input type="text" value={protection} onChange={e => setProtection(e.target.value)} placeholder="예: 4면 망 포함 보양..." />
                </div>
              </div>

              {/* 🌟 고객사 기본값 등록 및 전체 현장 일괄 전파 체크 패널 */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px 16px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '12.5px'
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 600, color: 'var(--text-main)' }}>
                  <input
                    type="checkbox"
                    checked={isSetAsCustomerDefault}
                    onChange={e => setIsSetAsCustomerDefault(e.target.checked)}
                  />
                  <span>🏢 이 옵션·보양·스펙을 '{customerName || '해당 고객사'}' 기본 설정으로 등록 (다음 신규 현장에도 자동 적용)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 600, color: '#3b82f6' }}>
                  <input
                    type="checkbox"
                    checked={applyToAllSites}
                    onChange={e => setApplyToAllSites(e.target.checked)}
                  />
                  <span>⚡ '{customerName || '해당 고객사'}'의 등록된 모든 현장에도 이 옵션·보양을 동일하게 일괄 적용</span>
                </label>

                {/* 🌟 옵션 변경 시 현장 마스터 저장 확인 토글 (PC 버전) */}
                {currentMatchedSite && isOptionsDiff && (
                  <div style={{
                    padding: '8px 12px',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    borderRadius: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertTriangle size={14} />
                      <span>현장 기존 옵션과 변경사항 감지됨</span>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={saveOptionsToSite}
                        onChange={e => setSaveOptionsToSite(e.target.checked)}
                      />
                      <span>📍 변경된 옵션을 '{siteName || '해당 현장'}' 기본값으로 갱신 저장 (미체크 시 이번 출고 1회성 적용, 기존 현장 옵션 보존)</span>
                    </label>
                  </div>
                )}
              </div>

              {/* 💡 [텍스트 추출 감지 수량 안내 뱃지] */}
              {(() => {
                const detectedSpecs = STANDARD_SPECS.filter(s => !!checkedSpecs[s.id]);
                return (
                  <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 800, color: detectedSpecs.length > 0 ? '#16a34a' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ✨ 요청 텍스트 기반 감지 및 자동 동적 생성된 요구사항: <span style={{ color: 'var(--primary)', fontSize: '13px' }}>{detectedSpecs.length}개</span>
                  </div>
                );
              })()}

              {/* 21가지 표준 스펙 동적/전체 체크박스 선택 제어부 */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
                gap: '8px', 
                padding: '12px', 
                maxHeight: '320px', 
                overflowY: 'auto', 
                border: '1px solid var(--border-color)', 
                borderRadius: '8px', 
                backgroundColor: 'var(--bg-app)' 
              }}>
                {STANDARD_SPECS
                  .filter(spec => showAllSpecs || !!checkedSpecs[spec.id])
                  .map(spec => {
                  const isChecked = !!checkedSpecs[spec.id];
                  return (
                    <label 
                      key={spec.id} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        padding: '8px 10px', 
                        borderRadius: '6px', 
                        cursor: 'pointer',
                        fontSize: '12.5px',
                        backgroundColor: isChecked ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                        border: `1px solid ${isChecked ? '#16a34a' : 'var(--border-color)'}`,
                        boxShadow: isChecked ? '0 2px 6px rgba(34, 197, 94, 0.15)' : 'none',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <input 
                        type="checkbox" 
                        checked={isChecked} 
                        onChange={() => handleToggleSpec(spec.id)} 
                      />
                      <span style={{ 
                        color: isChecked ? '#15803d' : 'var(--text-secondary)',
                        fontWeight: isChecked ? '800' : 'normal' 
                      }}>
                        {getDynamicSpecLabel(spec, rawText)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 섹션 5: 회계 정산 */}
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                5. 정산 회계 및 특이사항
              </h4>
              <div className="mobile-grid-1col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label>매달 청구 마감일</label>
                  <input type="text" value={closingDay} onChange={e => setClosingDay(e.target.value)} placeholder="예: 20일" />
                </div>
                <div>
                  <label>결제 예정일</label>
                  <input type="text" value={paymentDay} onChange={e => setPaymentDay(e.target.value)} placeholder="예: 익월 말일" />
                </div>
              </div>
              <div style={{ marginTop: '10px' }}>
                <label>특이사항 / 메모</label>
                <input type="text" value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* 3단계: 서식 출력 및 미리보기 */}
      <div className="card" style={{ marginTop: '10px' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '62px' }}>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
            <FileText size={16} className="text-success" /> 3단계: 서식 출력 및 미리보기
          </h3>
        </div>

        <div style={{ minHeight: '300px', padding: '16px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          
          <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                
                {/* 🖨️ 로컬 프린터 지정 드롭다운 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    로컬 프린터 지정
                  </label>
                  <select
                    value={selectedPrinter}
                    onChange={(e) => handlePrinterChange(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)',
                      color: 'var(--text-main)',
                      fontWeight: '600',
                      minWidth: '200px',
                      cursor: 'pointer'
                    }}
                  >
                    {printers.length > 0 ? (
                      printers.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))
                    ) : (
                      <option value={selectedPrinter || 'Apeos C2060'}>
                        {selectedPrinter || 'Apeos C2060 (기본)'}
                      </option>
                    )}
                  </select>
                </div>

                {/* 🖨️ 출고의뢰서 인쇄 버튼 */}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handlePrint}
                  disabled={isAgentPrinting}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12.5px',
                    padding: '7px 14px',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    height: '33px'
                  }}
                >
                  <Printer size={14} />
                  {isAgentPrinting ? '인쇄 전송중...' : '출고의뢰서 인쇄'}
                </button>
              </div>

              {/* 실제 인쇄 타겟 컨테이너 (다크모드에서도 항상 백색 용지 + 검정 텍스트로 100% 선명하게 렌더링) */}
              <div id="dispatch-sheet-print" style={{ padding: '16px 20px', backgroundColor: '#ffffff', color: '#111827', borderRadius: '4px', border: '1px solid #cbd5e1', maxWidth: '800px', width: '100%', margin: '0 auto', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', boxSizing: 'border-box', overflow: 'hidden' }}>
                
                {/* 상단 헤더: 좌측 계약번호+출력일시 / 중앙 타이틀 / 우측 날인란 — flex 3분할 */}
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', borderBottom: '2px solid #1e1b4b', paddingBottom: '8px', marginBottom: '12px', gap: '8px' }}>

                  {/* 좌측: 계약번호 및 출력일시 (flex-shrink:0 고정, 공간 차지 최소화) */}
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: '#312e81', whiteSpace: 'nowrap' }}>
                      계약번호: <span style={{ color: contractNo ? '#0f172a' : '#94a3b8', fontWeight: '800' }}>{contractNo || '(저장 후 채번)'}</span>
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      출력일시: {(() => {
                        const now = new Date();
                        const y = now.getFullYear();
                        const mo = String(now.getMonth() + 1).padStart(2, '0');
                        const d = String(now.getDate()).padStart(2, '0');
                        const hh = String(now.getHours()).padStart(2, '0');
                        const mi = String(now.getMinutes()).padStart(2, '0');
                        const ss = String(now.getSeconds()).padStart(2, '0');
                        return `${y}.${mo}.${d} ${hh}:${mi}:${ss}`;
                      })()}
                    </div>
                  </div>

                  {/* 중앙: 문서 타이틀 (flex:1, 좌우 공간 자동 분배) */}
                  <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                    <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#1e1b4b', letterSpacing: '3px', whiteSpace: 'nowrap' }}>기연리프트 출고요청서</h1>
                  </div>

                  {/* 우측: 출고 완료자 날인란 — div 기반으로 flex 충돌 완전 해소 */}
                  <div style={{ flexShrink: 0, width: '76px', border: '1.5px solid #334155', overflow: 'hidden', borderRadius: '2px' }}>
                    <div style={{
                      backgroundColor: '#f1f5f9',
                      borderBottom: '1px solid #334155',
                      textAlign: 'center',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: '#1e293b',
                      padding: '2px 0',
                      whiteSpace: 'nowrap',
                    }}>
                      출고 완료자
                    </div>
                    <div style={{
                      height: '38px',
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      color: '#94a3b8',
                      fontWeight: '600',
                    }}>
                      (서 명)
                    </div>
                  </div>
                </div>

                {/* 1. 거래처 및 현장 기본정보 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>1. 거래처 및 현장 정보</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>고객사명</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '700', wordBreak: 'break-all', boxSizing: 'border-box' }}>{customerName || '-'}</td>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>현장명</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '700', wordBreak: 'break-all', boxSizing: 'border-box' }}>{siteName || '-'}</td>
                    </tr>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>상세 현장주소</th>
                      <td colSpan={3} style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', wordBreak: 'break-all', boxSizing: 'border-box' }}>{siteAddress || '-'}</td>
                    </tr>
                  </tbody>
                </table>

                {/* 2. 업무 관계자 정보 (청구담당자 제거, 영업/현장 1줄 50:50 대칭) */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>2. 업무 관계자 정보</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>영업담당자</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '600', wordBreak: 'break-all', boxSizing: 'border-box' }}>
                        {salespersonName || currentUser?.name || '-'} {salespersonPhone || currentUser?.phone ? `(${salespersonPhone || currentUser?.phone})` : ''}
                      </td>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>현장담당자</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '600', wordBreak: 'break-all', boxSizing: 'border-box' }}>
                        {siteContactName || '-'} {siteContactPhone ? `(${siteContactPhone})` : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* 3. 배송 배차 및 리프트 모델 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>3. 배송 배차 및 투입 장비</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>상차스케줄</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', wordBreak: 'break-all', boxSizing: 'border-box' }}>{loadingTime || '-'}</td>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>하차스케줄</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', wordBreak: 'break-all', boxSizing: 'border-box' }}>{unloadingTime || '-'}</td>
                    </tr>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>임대 투입 장비</th>
                      <td colSpan={3} style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '700', wordBreak: 'break-all', boxSizing: 'border-box' }}>
                        {equipments.map(e => `${e.modelName || '미지정'} * ${e.qty}대`).join(', ')} (총 {equipments.reduce((sum, e) => sum + (e.qty || 1), 0)}대)
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* 4. 장비 출하 스펙 요구사항 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>4. 장비 출하 스펙 요구사항 (현장 요청 검수 항목)</div>
                <div style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', marginBottom: '10px', backgroundColor: '#f8fafc', color: '#111827', boxSizing: 'border-box' }}>
                  {(() => {
                    const appliedSpecs = STANDARD_SPECS.filter(s => !!checkedSpecs[s.id]);
                    if (appliedSpecs.length === 0) {
                      return (
                        <div style={{ fontSize: '11.5px', color: '#64748b', padding: '2px 0' }}>
                          • 별도 특수 요청 스펙 없음 (기본 출하 표준 검수 적용)
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '11.5px' }}>
                        {appliedSpecs.map((s, idx) => (
                          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: '#111827', wordBreak: 'break-all' }}>
                            <span style={{ fontSize: '13px', color: '#475569', fontWeight: 400, lineHeight: 1 }}>□</span>
                            <span>{idx + 1}. {getDynamicSpecLabel(s, rawText)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* 5. 현장 특이사항 및 작업 지시 메모 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>5. 현장 특이사항 및 작업 지시</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '84%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>지시사항</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', wordBreak: 'break-all', boxSizing: 'border-box' }}>{note || '특이사항 없음'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

        </div>
      </div>

      {/* 실시간 프로세스 진행 릴레이 팝업 모달 */}
      {isProcessingModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="card" style={{
            width: '100%', maxWidth: '520px', padding: '28px', backgroundColor: '#0f172a',
            color: '#f8fafc', borderRadius: '16px', border: '1px solid #334155', boxSizing: 'border-box',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8' }}>
                <RefreshCw size={18} className={isProcessCompleted ? '' : 'animate-spin'} style={{ color: isProcessCompleted ? '#10b981' : '#38bdf8' }} />
                {isProcessCompleted ? '출고 요청 등록 완료' : '출고 프로세스 진행'}
              </h3>
              <span style={{ fontSize: '13px', fontWeight: '700', color: isProcessCompleted ? '#10b981' : '#38bdf8', padding: '2px 10px', borderRadius: '12px', backgroundColor: isProcessCompleted ? 'rgba(16,185,129,0.15)' : 'rgba(56,189,248,0.15)' }}>
                {progressPercent}%
              </span>
            </div>

            {/* 프로그레스 바 */}
            <div style={{ width: '100%', height: '10px', backgroundColor: '#1e293b', borderRadius: '5px', overflow: 'hidden', marginBottom: '20px' }}>
              <div style={{
                width: `${progressPercent}%`, height: '100%',
                backgroundColor: isProcessCompleted ? '#10b981' : '#3b82f6',
                backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,.2) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.2) 50%, rgba(255,255,255,.2) 75%, transparent 75%, transparent)',
                backgroundSize: '1rem 1rem',
                transition: 'width 0.3s ease-in-out'
              }}></div>
            </div>

            {/* 현재 진행 단계 가이드 메인 박스 */}
            <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '700', color: '#f1f5f9', borderLeft: isProcessCompleted ? '4px solid #10b981' : '4px solid #3b82f6', marginBottom: '16px' }}>
              {currentStepText}
            </div>

            {/* 단계별 로그 기록 콘솔 타임라인 */}
            <div style={{
              backgroundColor: '#020617', padding: '12px 14px', borderRadius: '8px',
              fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8', maxHeight: '160px',
              overflowY: 'auto', border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: '6px'
            }}>
              {progressLogs.map((log, idx) => (
                <div key={idx} style={{ color: idx === progressLogs.length - 1 ? '#38bdf8' : '#64748b' }}>
                  {log}
                </div>
              ))}
            </div>

            {isProcessCompleted && (
              <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '12.5px', color: '#94a3b8', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  ✅ 출고 지시 1건이 데이터베이스에 안전하게 등록되었습니다.<br />
                  [배차 관리] 담당자가 배차 차량 및 고유 장비 번호를 매핑할 예정입니다.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setIsProcessingModalOpen(false)}
                    style={{ padding: '10px 24px', backgroundColor: '#10b981', borderColor: '#10b981', fontWeight: '800' }}
                  >
                    확인 (출고 지시 완료)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
