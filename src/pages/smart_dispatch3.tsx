// src/pages/smart_dispatch3.tsx
// ┌─────────────────────────────────────────────────────────────────┐
// │ 출고의뢰3 — 근본 재설계 (2026-09-06)                            │
// │                                                                 │
// │ [설계 원칙]                                                     │
// │  1. 4문 구조 (WHO / WHERE / WHAT / WHEN) — 자연 사고 순서      │
// │  2. 고객사/현장 → DB 칩 선택 (자유 입력 아님, 오타 제거)        │
// │  3. 날짜/시간 → 네이티브 피커 (키보드 없음)                     │
// │  4. STT → 필드별 짧은 발화 (품질 문제 해결)                    │
// │  5. 세부정보 → DB 자동 상속 + 기본 숨김 (확인만)               │
// │  6. 붙여넣기 파싱 → 보조 수단 (관리부용, 접기/펼치기)           │
// └─────────────────────────────────────────────────────────────────┘
import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { findCustomerByNormalizedName, STANDARD_SPECS } from '../services/db';
import { Customer, CustomerSite } from '../services/db';
import { isOptionsChangedFromSite, EQUIPMENT_SPEC_MATRIX } from '../services/voiceOrderDraftService';
import { matchHangul } from '../utils/hangulSearch';
import {
  Mic, MicOff, Plus, Minus, Trash2, CheckCircle2, AlertTriangle,
  ShoppingCart, RotateCcw, Zap, ChevronDown, ChevronUp,
  Building2, MapPin, Package, Calendar, Settings, ClipboardPaste
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────
interface EquipmentItem { modelName: string; qty: number; }

// ft별 모델 목록 (배열 기반)
const FT_GROUPS = Array.from(new Set(EQUIPMENT_SPEC_MATRIX.map(i => i.ft)))
  .sort((a, b) => parseInt(a) - parseInt(b));
const getModelsByFt = (ft: string) => EQUIPMENT_SPEC_MATRIX.filter(i => i.ft === ft);

// 블록 아이디
type BlockId = 'WHO' | 'WHERE' | 'WHAT' | 'WHEN' | 'DETAILS';

// 입력 출처 추적 (신뢰도 배지용)
type FieldSource = 'user' | 'db' | 'parsed' | 'voice';

interface FieldValue<T = string> { value: T; source: FieldSource; }

// ─────────────────────────────────────────────────────────────────────────────
// 공통 스타일 헬퍼
// ─────────────────────────────────────────────────────────────────────────────
const sourceBadge = (source: FieldSource) => {
  const map: Record<FieldSource, { label: string; color: string }> = {
    db:     { label: 'DB 상속', color: '#16a34a' },
    parsed: { label: '파싱', color: '#2563eb' },
    voice:  { label: '음성', color: '#7c3aed' },
    user:   { label: '직접 입력', color: '#9ca3af' },
  };
  const m = map[source];
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
      backgroundColor: `${m.color}18`, color: m.color, border: `1px solid ${m.color}40`
    }}>
      {m.label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export const SmartDispatch3: React.FC = () => {
  const {
    hasPermission, saveSmartDispatch, assets, products, showErrorModal,
    users, contracts, currentUser, customers, contacts, sites, billings
  } = useApp();
  const canSave = hasPermission('delivery', 'save');

  // ── 토스트 ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  // ── 붙여넣기 파싱 존 ────────────────────────────────────────────────────
  const [pasteZoneOpen, setPasteZoneOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // ── 블록 열림 상태 ────────────────────────────────────────────────────────
  const [openBlock, setOpenBlock] = useState<BlockId>('WHO');
  const toggleBlock = (id: BlockId) => setOpenBlock(prev => prev === id ? 'WHO' : id);

  // ── 블록 1: WHO — 고객사 ────────────────────────────────────────────────
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSource, setCustomerSource] = useState<FieldSource>('user');
  const [voiceFieldActive, setVoiceFieldActive] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const filteredCustomers = useMemo(() => {
    if (!customerQuery.trim()) return customers.slice(0, 20);
    return customers.filter(c => matchHangul(c.name, customerQuery)).slice(0, 20);
  }, [customers, customerQuery]);

  // ── 블록 2: WHERE — 현장 ────────────────────────────────────────────────
  const [siteQuery, setSiteQuery] = useState('');
  const [selectedSite, setSelectedSite] = useState<CustomerSite | null>(null);
  const [siteSource, setSiteSource] = useState<FieldSource>('user');

  const filteredSites = useMemo(() => {
    const base = selectedCustomer
      ? sites.filter(s => s.customerId === selectedCustomer.id)
      : sites;
    if (!siteQuery.trim()) return base.slice(0, 20);
    return base.filter(s => matchHangul(s.name, siteQuery)).slice(0, 20);
  }, [sites, selectedCustomer, siteQuery]);

  // ── 블록 3: WHAT — 장비 ────────────────────────────────────────────────
  const [equipments, setEquipments] = useState<EquipmentItem[]>([]);
  const [activeFt, setActiveFt] = useState(FT_GROUPS[0] || '19ft');

  const totalQty = equipments.reduce((s, e) => s + e.qty, 0);

  const addModel = (modelName: string) => {
    setEquipments(prev => {
      const idx = prev.findIndex(e => e.modelName === modelName);
      if (idx >= 0) {
        const u = [...prev]; u[idx] = { ...u[idx], qty: u[idx].qty + 1 }; return u;
      }
      return [...prev, { modelName, qty: 1 }];
    });
  };
  const changeQty = (index: number, delta: number) => {
    setEquipments(prev => {
      const u = [...prev];
      const q = (u[index].qty || 1) + delta;
      if (q <= 0) return prev.filter((_, i) => i !== index);
      u[index] = { ...u[index], qty: q };
      return u;
    });
  };

  // ── 블록 4: WHEN — 일정 ────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const [loadingDate, setLoadingDate] = useState('');
  const [loadingTimeVal, setLoadingTimeVal] = useState('08:00');
  const [unloadingDate, setUnloadingDate] = useState('');
  const [unloadingTimeVal, setUnloadingTimeVal] = useState('');

  const loadingDisplay = loadingDate
    ? `${loadingDate} ${loadingTimeVal}` : '';
  const unloadingDisplay = unloadingDate
    ? `${unloadingDate}${unloadingTimeVal ? ' ' + unloadingTimeVal : ''}` : '';

  // ── 세부정보 (DB 자동 상속) ───────────────────────────────────────────
  const [salespersonName, setSalespersonName] = useState('');
  const [salespersonPhone, setSalespersonPhone] = useState('');
  const [siteContactName, setSiteContactName] = useState('');
  const [siteContactPhone, setSiteContactPhone] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [billingContactName, setBillingContactName] = useState('');
  const [billingContactPhone, setBillingContactPhone] = useState('');
  const [taxBillEmail, setTaxBillEmail] = useState('');
  const [statementEmail, setStatementEmail] = useState('');
  const [paidOptions, setPaidOptions] = useState('');
  const [protection, setProtection] = useState('');
  const [checkedSpecs, setCheckedSpecs] = useState<Record<string, boolean>>({});
  const [closingDay, setClosingDay] = useState('');
  const [paymentDay, setPaymentDay] = useState('');
  const [note, setNote] = useState('');
  const [saveOptionsToSite, setSaveOptionsToSite] = useState(true);
  const [isSetAsCustomerDefault, setIsSetAsCustomerDefault] = useState(false);
  const [applyToAllSites, setApplyToAllSites] = useState(false);
  const [inheritedFields, setInheritedFields] = useState<string[]>([]);

  // 연체 감지
  const [overdueAck, setOverdueAck] = useState(false);
  const matchedOverdue = useMemo(() => {
    if (!selectedCustomer) return null;
    const cb = billings.filter(b => b.customerId === selectedCustomer.id && b.status !== 'PAID' && (b.totalAmount - b.paidAmount) > 0);
    const sum = cb.reduce((s, b) => s + (b.totalAmount - b.paidAmount), 0);
    if (sum <= 0 && selectedCustomer.transactionStatus !== 'BLOCKED') return null;
    return { sum, count: cb.length, isBlocked: selectedCustomer.transactionStatus === 'BLOCKED' };
  }, [selectedCustomer, billings]);

  const currentMatchedSite = useMemo(() => {
    if (!selectedCustomer || !selectedSite) return null;
    return sites.find(s => s.id === selectedSite.id) || null;
  }, [selectedCustomer, selectedSite, sites]);

  const isOptionsDiff = useMemo(() =>
    isOptionsChangedFromSite(currentMatchedSite, paidOptions, protection, checkedSpecs)
  , [currentMatchedSite, paidOptions, protection, checkedSpecs]);

  // ── 자동 상속 ────────────────────────────────────────────────────────────
  const applyInheritance = useCallback((cust: Customer | null, site: CustomerSite | null) => {
    const inherited: string[] = [];
    if (!cust) return;

    // 고객 마스터
    if (!taxBillEmail && cust.repEmail && cust.repEmail !== '미상') { setTaxBillEmail(cust.repEmail); inherited.push('계산서 메일'); }
    if (!closingDay) { const d = cust.defaultBillingDay || 30; setClosingDay((d === 30 || d === 31) ? '말일' : `${d}일`); inherited.push('마감일'); }
    if (!paymentDay) { const p = cust.paymentDueDay || 25; setPaymentDay(`익월 ${p}일`); inherited.push('결제일'); }
    if (!paidOptions && cust.defaultPaidOptions) { setPaidOptions(cust.defaultPaidOptions); inherited.push('유상옵션'); }
    if (!protection && cust.defaultProtection) { setProtection(cust.defaultProtection); inherited.push('보양작업'); }

    // 현장 정보
    if (site) {
      if (!siteAddress && site.address && site.address !== '미상') { setSiteAddress(site.address); inherited.push('현장 주소'); }
      if (!siteContactName && site.contactName && site.contactName !== '미상') { setSiteContactName(site.contactName); inherited.push('현장담당자'); }
      if (!siteContactPhone && site.contact && site.contact !== '미상') { setSiteContactPhone(site.contact); inherited.push('현장 연락처'); }
      if (site.paidOptions) { setPaidOptions(site.paidOptions); }
      if (site.protection) { setProtection(site.protection); }
    }

    // 담당자 DB 상속
    const custContacts = contacts.filter(ct => ct.customerId === cust.id);
    if (custContacts.length > 0) {
      if (!siteContactPhone) {
        const sc = custContacts.find(ct => ct.position?.includes('현장') || ct.position?.includes('소장')) || custContacts[0];
        if (sc && sc.contact && sc.contact !== '미상') { setSiteContactPhone(sc.contact); if (!siteContactName && sc.name) setSiteContactName(sc.name); inherited.push('현장담당자(연락처)'); }
      }
      const bc = custContacts.find(ct => ct.position?.includes('청구') || ct.position?.includes('경리'));
      if (bc) {
        if (!billingContactName && bc.name) { setBillingContactName(bc.name); inherited.push('청구담당자'); }
        if (!billingContactPhone && bc.contact && bc.contact !== '미상') { setBillingContactPhone(bc.contact); }
        if (!taxBillEmail && bc.email && bc.email !== '미상') { setTaxBillEmail(bc.email); }
      }
    }

    // 최근 계약 영업담당자
    if (!salespersonName) {
      const lc = contracts.filter(c => c.customerId === cust.id && (c.contractType || 'RENTAL') === 'RENTAL')
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      if (lc?.salespersonId) {
        const su = users.find(u => u.id === lc.salespersonId);
        if (su) { setSalespersonName(su.name); setSalespersonPhone(su.phone || ''); inherited.push('영업담당자'); }
      }
    }

    if (inherited.length > 0) setInheritedFields(inherited);
  }, [contacts, contracts, users,
    taxBillEmail, closingDay, paymentDay, paidOptions, protection,
    siteAddress, siteContactName, siteContactPhone, billingContactName, billingContactPhone, salespersonName]);

  // 고객 선택 핸들러
  const handleSelectCustomer = (cust: Customer, source: FieldSource = 'user') => {
    setSelectedCustomer(cust);
    setCustomerSource(source);
    setCustomerQuery('');
    setSelectedSite(null);
    setSiteQuery('');
    setInheritedFields([]);
    applyInheritance(cust, null);
    // 고객 선택 후 WHERE 블록으로 자동 이동
    setOpenBlock('WHERE');
  };

  // 현장 선택 핸들러
  const handleSelectSite = (site: CustomerSite, source: FieldSource = 'user') => {
    setSelectedSite(site);
    setSiteSource(source);
    setSiteQuery('');
    applyInheritance(selectedCustomer, site);
    // 현장 선택 후 WHAT 블록으로 자동 이동
    setOpenBlock('WHAT');
  };

  // ── 필드별 STT ────────────────────────────────────────────────────────────
  const startVoice = (fieldId: string, onResult: (text: string) => void) => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      showToast('이 브라우저는 음성 인식을 지원하지 않습니다.', 'error'); return;
    }
    if (voiceFieldActive === fieldId) {
      recognitionRef.current?.stop();
      setVoiceFieldActive(null); return;
    }
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const r = new SpeechRecognition();
    r.lang = 'ko-KR'; r.continuous = false; r.interimResults = false;
    r.onresult = (e: any) => { const t = e.results[0]?.[0]?.transcript || ''; if (t) onResult(t); };
    r.onend = () => setVoiceFieldActive(null);
    r.onerror = () => setVoiceFieldActive(null);
    recognitionRef.current = r;
    r.start();
    setVoiceFieldActive(fieldId);
  };

  const MicButton: React.FC<{ fieldId: string; onResult: (t: string) => void; size?: 'sm' | 'md' }> =
    ({ fieldId, onResult, size = 'sm' }) => {
      const active = voiceFieldActive === fieldId;
      return (
        <button type="button"
          onClick={() => startVoice(fieldId, onResult)}
          title="음성 입력"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: size === 'md' ? '36px' : '28px', height: size === 'md' ? '36px' : '28px',
            borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
            backgroundColor: active ? '#ef4444' : 'var(--primary)',
            color: '#fff',
            animation: active ? 'pulse 1s infinite' : 'none'
          }}>
          {active ? <MicOff size={size === 'md' ? 15 : 12} /> : <Mic size={size === 'md' ? 15 : 12} />}
        </button>
      );
    };

  // ── 붙여넣기 파싱 ─────────────────────────────────────────────────────────
  const runParse = useCallback((text: string) => {
    if (!text.trim()) { showToast('텍스트를 입력하세요.', 'error'); return; }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const extractEmails = (s: string) => (s.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).join('/');
    const extractPhone = (s: string) => (s.match(/(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g) || [''])[0].replace(/\s+/g, '');
    const extractName = (s: string) => s.split(/01[016789]/)[0].replace(/[:\-]/g, '').replace(/선임|책임|담당자|소장|부장|팀장/g, '').trim();

    let pc = '', ps = '', paddr = '', pscname = '', pscphone = '', pbcname = '', pbcphone = '';
    let ptaxmail = '', pstatemail = '', pload = '', punload = '';
    let peqs: EquipmentItem[] = [];
    let popts = '', pprot = '', pclose = '', ppay = '', pnote = '';

    lines.forEach(line => {
      const val = line.includes(':') ? line.substring(line.indexOf(':') + 1).trim() : '';
      if (/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호)/i.test(line)) pc = val;
      else if (/^(?:\d+[.)]\s*)?(?:현장\s*상세\s*주소|현장\s*주소|주소|배송지)/i.test(line)) paddr = val;
      else if (/^(?:\d+[.)]\s*)?(?:현장\s*담당자?|현장담당|소장|반장)/i.test(line) && !line.includes('청구') && !line.includes('영업')) { pscname = extractName(val); pscphone = extractPhone(val); }
      else if (/^(?:\d+[.)]\s*)?(?:현장명?|현장)(?!\s*상세|\s*주소|\s*담당)/i.test(line)) ps = val;
      else if (/^(?:\d+[.)]\s*)?(?:청구\s*담당자?|경리|회계)/i.test(line)) { pbcname = extractName(val); pbcphone = extractPhone(val); const e = extractEmails(val); if (e) ptaxmail = e; }
      else if (/^(?:\d+[.)]\s*)?(?:계산서\s*메일|세금계산서)/i.test(line)) { const e = extractEmails(val || line); ptaxmail = e || val; }
      else if (/^(?:\d+[.)]\s*)?(?:거래명세서.*메일|명세서\s*메일)/i.test(line)) pstatemail = extractEmails(val || line);
      else if (/^(?:\d+[.)]\s*)?(?:상차\s*스케줄|상차\s*시간|상차시간|상차)/i.test(line)) pload = val;
      else if (/^(?:\d+[.)]\s*)?(?:하차\s*스케줄|하차\s*시간|하차시간|하차|도착)/i.test(line)) punload = val;
      else if (/^(?:\d+[.)]\s*)?(?:신청.*모델.*목록|신청모델|모델명?|장비명?|규격)/i.test(line) || /^\s*-\s*(?:GS|SJ|JCPT|HD)/i.test(line)) {
        const raw = val || line.replace(/^.*[:：]/,'').replace(/^-\s*/,'');
        raw.split(/[\/,]/).forEach(p => {
          const m = p.match(/(.+?)\s*[*xX대]\s*(\d+)/) || p.match(/(.+?)\s*(\d+)\s*대/);
          if (m) peqs.push({ modelName: m[1].replace(/대$/,'').trim(), qty: parseInt(m[2]) || 1 });
          else if (p.trim()) peqs.push({ modelName: p.trim(), qty: 1 });
        });
      }
      else if (/^(?:\d+[.)]\s*)?(?:유상\s*옵션|옵션)/i.test(line) && !line.includes('요구')) popts = val;
      else if (/^(?:\d+[.)]\s*)?(?:보양\s*작업|보양)/i.test(line)) pprot = val;
      else if (/^(?:\d+[.)]\s*)?(?:마감일)/i.test(line)) pclose = val;
      else if (/^(?:\d+[.)]\s*)?(?:결제일|입금일)/i.test(line)) ppay = val;
      else if (/^(?:\d+[.)]\s*)?(?:특이사항|비고|메모)/i.test(line)) pnote = val;
    });

    // 고객사 자동 매핑
    if (pc) {
      const mc = findCustomerByNormalizedName(customers, pc);
      if (mc) {
        setSelectedCustomer(mc); setCustomerSource('parsed');
        if (ps) {
          const cleanSite = ps.replace(/\s/g, '');
          const ms = sites.find(s => s.customerId === mc.id &&
            (s.name.replace(/\s/g,'') === cleanSite || s.name.includes(ps) || ps.includes(s.name)));
          if (ms) { setSelectedSite(ms); setSiteSource('parsed'); applyInheritance(mc, ms); }
          else { applyInheritance(mc, null); }
        } else { applyInheritance(mc, null); }
      } else {
        showToast(`고객사 "${pc}"는 DB에 없습니다. 직접 선택하세요.`, 'error');
      }
    }

    if (paddr) setSiteAddress(paddr);
    if (pscname) setSiteContactName(pscname);
    if (pscphone) setSiteContactPhone(pscphone);
    if (pbcname) setBillingContactName(pbcname);
    if (pbcphone) setBillingContactPhone(pbcphone);
    if (ptaxmail) setTaxBillEmail(ptaxmail);
    if (pstatemail) setStatementEmail(pstatemail);
    if (peqs.length > 0) setEquipments(peqs);
    if (popts) setPaidOptions(popts);
    if (pprot) setProtection(pprot);
    if (pclose) setClosingDay(pclose);
    if (ppay) setPaymentDay(ppay);
    if (pnote) setNote(pnote);

    // 스케줄 텍스트 파싱 (날짜 추출 시도)
    const tryDate = (s: string) => {
      const m = s.match(/(\d{1,2})[./](\d{1,2})/);
      if (m) { const y = new Date().getFullYear(); return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; }
      return '';
    };
    const tryTime = (s: string) => {
      const m = s.match(/(\d{1,2})[.:시](\d{2})?/);
      if (m) return `${m[1].padStart(2,'0')}:${(m[2] || '00')}`;
      if (/오전|아침/i.test(s)) return '08:00';
      if (/오후|낮/i.test(s)) return '14:00';
      return '';
    };
    if (pload) { const d = tryDate(pload); const t = tryTime(pload); if (d) setLoadingDate(d); if (t) setLoadingTimeVal(t); }
    if (punload) { const d = tryDate(punload); const t = tryTime(punload); if (d) setUnloadingDate(d); if (t) setUnloadingTimeVal(t); }

    // 스펙 자동 감지
    const cleanedText = text.replace(/\s+/g, '');
    const specs: Record<string, boolean> = {};
    STANDARD_SPECS.forEach(spec => { specs[spec.id] = spec.keywords.some(kw => cleanedText.includes(kw.replace(/\s+/g, ''))); });
    setCheckedSpecs(specs);

    setPasteText('');
    setPasteZoneOpen(false);
    showToast('파싱 완료');
  }, [customers, sites, applyInheritance]);

  // ── 저장 ─────────────────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingOpen, setProcessingOpen] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [stepText, setStepText] = useState('');
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [processCompleted, setProcessCompleted] = useState(false);
  const [savedContractNo, setSavedContractNo] = useState('');

  const uniqueModels = useMemo(() => Array.from(new Set(assets.map(a => a.modelName).filter(Boolean))).sort(), [assets]);

  const findSuggestedModel = (input: string): string | null => {
    const c = input.replace(/[\s\-_]/g, '').toLowerCase();
    const found = uniqueModels.find(m => { const mc = m.replace(/[\s\-_]/g, '').toLowerCase(); return mc.includes(c) || c.includes(mc); });
    if (found) return found;
    const n = input.match(/\d{3,4}/);
    return n ? (uniqueModels.find(m => m.includes(n[0])) || null) : null;
  };

  const handleSave = async () => {
    if (isSubmitting) return;
    if (!canSave) { showToast('저장 권한이 없습니다.', 'error'); return; }
    if (!selectedCustomer) { showToast('고객사를 선택하세요.', 'error'); setOpenBlock('WHO'); return; }
    if (!selectedSite && !siteAddress) { showToast('현장을 선택하거나 주소를 입력하세요.', 'error'); setOpenBlock('WHERE'); return; }
    if (selectedCustomer.transactionStatus === 'BLOCKED') { showToast('🚫 거래 불가(BLOCKED) 거래처입니다.', 'error'); return; }
    if (matchedOverdue && matchedOverdue.sum > 0 && !overdueAck) { showToast('연체 확인 체크박스에 동의하세요.', 'error'); return; }
    if (!siteAddress.trim()) { showToast('현장 주소를 입력하세요.', 'error'); setOpenBlock('DETAILS'); return; }
    if (!siteContactPhone.trim()) { showToast('현장 담당자 연락처를 입력하세요.', 'error'); setOpenBlock('DETAILS'); return; }
    if (equipments.length === 0) { showToast('장비를 선택하세요.', 'error'); setOpenBlock('WHAT'); return; }

    setIsSubmitting(true);
    try {
      const officialModels = uniqueModels.length > 0 ? uniqueModels : products.map((p: any) => p.modelName);
      const updatedEqs = [...equipments];
      for (let i = 0; i < updatedEqs.length; i++) {
        const eq = updatedEqs[i];
        if (!eq.modelName?.trim()) continue;
        if (!officialModels.some(m => m === eq.modelName)) {
          const s = findSuggestedModel(eq.modelName);
          if (s) { updatedEqs[i].modelName = s; showToast(`모델명 [${s}] 자동 보정`); }
          else { showToast(`'${eq.modelName}'은 등록 모델이 아닙니다.`, 'error'); return; }
        }
      }

      const data = {
        customerName: selectedCustomer.name,
        siteName: selectedSite?.name || '',
        siteAddress, salespersonName, salespersonPhone,
        siteContactName, siteContactPhone, siteContactEmail: '',
        billingContactName, billingContactPhone, statementEmail, taxBillEmail,
        loadingTime: loadingDisplay, unloadingTime: unloadingDisplay,
        equipments: updatedEqs, note, rawText: note,
        paidOptions, protection, checkedSpecs, saveOptionsToSite,
        isSetAsCustomerDefault, applyToAllSites, closingDay, paymentDay
      };

      setProgressLogs([]); setProgressPct(0);
      setStepText('🚀 출고 파이프라인 가동 중...');
      setProcessCompleted(false); setProcessingOpen(true);

      const onProgress = (logText: string, pct: number) => {
        setProgressPct(pct); setStepText(logText);
        setProgressLogs(prev => [...prev, logText]);
      };

      let result = await saveSmartDispatch(data, false, onProgress);
      if (result.requiresConfirm) {
        setProgressLogs([]); setProgressPct(0);
        result = await saveSmartDispatch(data, true, onProgress);
      }
      if (result.errorMessage) { setProcessingOpen(false); showErrorModal(result.errorMessage, '오류'); return; }
      if (result.success) { setProcessCompleted(true); if (result.contractNo) setSavedContractNo(result.contractNo); }
    } catch (err: any) { console.error(err); }
    finally { setIsSubmitting(false); }
  };

  // ── 초기화 ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setCustomerQuery(''); setSelectedCustomer(null); setCustomerSource('user');
    setSiteQuery(''); setSelectedSite(null); setSiteSource('user');
    setEquipments([]); setActiveFt(FT_GROUPS[0] || '19ft');
    setLoadingDate(''); setLoadingTimeVal('08:00'); setUnloadingDate(''); setUnloadingTimeVal('');
    setSalespersonName(''); setSalespersonPhone('');
    setSiteContactName(''); setSiteContactPhone(''); setSiteAddress('');
    setBillingContactName(''); setBillingContactPhone('');
    setTaxBillEmail(''); setStatementEmail('');
    setPaidOptions(''); setProtection(''); setCheckedSpecs({});
    setClosingDay(''); setPaymentDay(''); setNote('');
    setInheritedFields([]); setOverdueAck(false); setSavedContractNo('');
    setPasteText(''); setPasteZoneOpen(false);
    setOpenBlock('WHO');
    showToast('초기화 완료');
  };

  // ── 블록 완료 상태 ────────────────────────────────────────────────────────
  const whoComplete = !!selectedCustomer;
  const whereComplete = !!selectedSite || !!siteAddress;
  const whatComplete = equipments.length > 0;
  const whenComplete = !!loadingDate;

  const BlockHeader: React.FC<{
    id: BlockId; icon: React.ReactNode; label: string;
    complete: boolean; summary?: string;
  }> = ({ id, icon, label, complete, summary }) => (
    <button type="button"
      onClick={() => toggleBlock(id)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
        borderBottom: openBlock === id ? '1px solid var(--border-color)' : 'none',
        textAlign: 'left'
      }}>
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: complete ? '#10b981' : 'var(--border-color)',
        color: complete ? '#fff' : 'var(--text-muted)'
      }}>
        {complete ? <CheckCircle2 size={16} /> : icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--text-main)' }}>{label}</div>
        {summary && <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 600, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</div>}
      </div>
      {openBlock === id ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
    </button>
  );

  const labelSt: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block', whiteSpace: 'nowrap' };
  const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column' };

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '860px' }}>

      {/* 토스트 */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          padding: '12px 20px', borderRadius: '8px', fontWeight: 700, fontSize: '13.5px',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          backgroundColor: toast.type === 'success' ? '#10b981' : '#ef4444'
        }}>{toast.text}</div>
      )}

      {/* ── 헤더 ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontWeight: 800, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            출고 요청 (재설계)
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', backgroundColor: '#fef9c3', color: '#a16207' }}>v3 A/B</span>
          </h2>
          <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: 0 }}>
            4문 구조 (WHO → WHERE → WHAT → WHEN) · DB 칩 선택 · 네이티브 피커
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={handleReset}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '13px' }}>
            <RotateCcw size={13} /> 초기화
          </button>
          {canSave && (
            <button type="button" className="btn-primary" onClick={handleSave} disabled={isSubmitting}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 16px', fontSize: '13px', fontWeight: 800 }}>
              <Zap size={14} /> 출고 지시
            </button>
          )}
        </div>
      </div>

      {/* ── 연체 경보 ────────────────────────────────────────────────────── */}
      {matchedOverdue && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px',
          backgroundColor: matchedOverdue.isBlocked ? '#fef2f2' : '#fffbeb',
          border: `1px solid ${matchedOverdue.isBlocked ? '#f87171' : '#fcd34d'}`,
          color: matchedOverdue.isBlocked ? '#991b1b' : '#92400e'
        }}>
          <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <AlertTriangle size={14} />
            {matchedOverdue.isBlocked ? '🚫 거래 불가 (BLOCKED)' : '⚠️ 연체 채권 경고'}
          </div>
          {!matchedOverdue.isBlocked && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 700, marginTop: '4px' }}>
              <input type="checkbox" checked={overdueAck} onChange={e => setOverdueAck(e.target.checked)} />
              미납 {matchedOverdue.count}건 (₩{matchedOverdue.sum.toLocaleString()}) — 수금 책임 인지 확인
            </label>
          )}
        </div>
      )}

      {/* ── 붙여넣기 파싱 존 (보조 수단) ────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <button type="button"
          onClick={() => setPasteZoneOpen(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
            padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: pasteZoneOpen ? '1px solid var(--border-color)' : 'none'
          }}>
          <ClipboardPaste size={15} color="var(--text-muted)" />
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            카톡/메신저 줄글 붙여넣기 파싱 (관리부 보조 도구)
          </span>
          {pasteZoneOpen ? <ChevronUp size={14} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
            : <ChevronDown size={14} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />}
        </button>
        {pasteZoneOpen && (
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              onPaste={e => {
                const t = e.clipboardData.getData('text');
                if (t.includes('\n')) { e.preventDefault(); runParse(t); }
              }}
              placeholder="카카오톡 출고 요청 텍스트를 붙여넣으면 즉시 파싱됩니다."
              rows={4}
              style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', padding: '8px', width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
              <button type="button" className="btn-primary"
                onClick={() => runParse(pasteText)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', fontSize: '12px', fontWeight: 800 }}>
                <Zap size={13} /> 파싱 실행
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 진행 표시바 ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {([
          { id: 'WHO', label: '고객사', done: whoComplete },
          { id: 'WHERE', label: '현장', done: whereComplete },
          { id: 'WHAT', label: '장비', done: whatComplete },
          { id: 'WHEN', label: '일정', done: whenComplete },
        ] as { id: BlockId; label: string; done: boolean }[]).map((item, i) => (
          <React.Fragment key={item.id}>
            <button type="button"
              onClick={() => setOpenBlock(item.id)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: '6px', border: 'none', cursor: 'pointer',
                backgroundColor: item.done ? '#dcfce7' : openBlock === item.id ? 'var(--primary)' : 'var(--bg-card)',
                color: item.done ? '#15803d' : openBlock === item.id ? '#fff' : 'var(--text-muted)',
                fontWeight: 700, fontSize: '12px',
                borderBottom: `3px solid ${item.done ? '#16a34a' : openBlock === item.id ? 'var(--primary)' : 'var(--border-color)'}`
              }}>
              {item.done ? '✓ ' : ''}{item.label}
            </button>
            {i < 3 && <div style={{ width: '16px', height: '2px', backgroundColor: 'var(--border-color)', flexShrink: 0 }} />}
          </React.Fragment>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          블록 1: WHO — 고객사 선택
      ════════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <BlockHeader id="WHO" icon={<Building2 size={14} />} label="1. 고객사"
          complete={whoComplete}
          summary={selectedCustomer ? `${selectedCustomer.name} ${sourceBadge(customerSource) ? '' : ''}` : undefined}
        />
        {selectedCustomer && openBlock !== 'WHO' && (
          <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)' }}>
              {selectedCustomer.name}
            </span>
            {sourceBadge(customerSource)}
            <button type="button" onClick={() => { setSelectedCustomer(null); setSelectedSite(null); setOpenBlock('WHO'); }}
              style={{ marginLeft: 'auto', fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
              변경
            </button>
          </div>
        )}
        {openBlock === 'WHO' && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                autoFocus
                type="text" value={customerQuery}
                onChange={e => setCustomerQuery(e.target.value)}
                placeholder="고객사명 검색 (초성 OK)"
                style={{ flex: 1, padding: '9px 12px', borderRadius: '6px', border: '1.5px solid var(--primary)', fontSize: '14px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
              />
              <MicButton fieldId="customer" size="md" onResult={t => {
                setCustomerQuery(t); setCustomerSource('voice');
                const mc = findCustomerByNormalizedName(customers, t) || customers.find(c => matchHangul(c.name, t));
                if (mc) handleSelectCustomer(mc, 'voice');
              }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
              {filteredCustomers.map(c => (
                <button key={c.id} type="button"
                  onClick={() => handleSelectCustomer(c)}
                  style={{
                    padding: '7px 14px', borderRadius: '20px', border: '1.5px solid var(--border-color)',
                    cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    backgroundColor: selectedCustomer?.id === c.id ? 'var(--primary)' : 'var(--bg-app)',
                    color: selectedCustomer?.id === c.id ? '#fff' : 'var(--text-main)'
                  }}>
                  {c.name}
                  {c.transactionStatus === 'BLOCKED' && <span style={{ color: '#ef4444', marginLeft: '4px' }}>🚫</span>}
                </button>
              ))}
              {filteredCustomers.length === 0 && (
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', padding: '8px' }}>검색 결과 없음</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          블록 2: WHERE — 현장 선택
      ════════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <BlockHeader id="WHERE" icon={<MapPin size={14} />} label="2. 현장"
          complete={whereComplete}
          summary={selectedSite ? selectedSite.name : (siteAddress || undefined)}
        />
        {selectedSite && openBlock !== 'WHERE' && (
          <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)' }}>{selectedSite.name}</span>
            {sourceBadge(siteSource)}
            {selectedSite.address && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{selectedSite.address}</span>}
            <button type="button" onClick={() => { setSelectedSite(null); setOpenBlock('WHERE'); }}
              style={{ marginLeft: 'auto', fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
              변경
            </button>
          </div>
        )}
        {openBlock === 'WHERE' && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {!selectedCustomer && (
              <div style={{ padding: '10px 12px', borderRadius: '6px', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', fontSize: '12.5px', color: '#c2410c', fontWeight: 600 }}>
                먼저 고객사를 선택하세요.
              </div>
            )}
            {selectedCustomer && (
              <>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text" value={siteQuery}
                    onChange={e => setSiteQuery(e.target.value)}
                    placeholder={`${selectedCustomer.name}의 현장 검색`}
                    style={{ flex: 1, padding: '9px 12px', borderRadius: '6px', border: '1.5px solid var(--primary)', fontSize: '14px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  />
                  <MicButton fieldId="site" size="md" onResult={t => {
                    setSiteQuery(t);
                    const ms = filteredSites.find(s => matchHangul(s.name, t) || s.name.includes(t));
                    if (ms) handleSelectSite(ms, 'voice');
                  }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                  {filteredSites.map(s => (
                    <button key={s.id} type="button"
                      onClick={() => handleSelectSite(s)}
                      style={{
                        padding: '7px 14px', borderRadius: '20px', border: '1.5px solid var(--border-color)',
                        cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                        backgroundColor: selectedSite?.id === s.id ? 'var(--primary)' : 'var(--bg-app)',
                        color: selectedSite?.id === s.id ? '#fff' : 'var(--text-main)'
                      }}>
                      {s.name}
                      {s.address && s.address !== '미상' && (
                        <span style={{ fontSize: '10.5px', opacity: 0.6, marginLeft: '4px' }}>{s.address.substring(0, 12)}</span>
                      )}
                    </button>
                  ))}
                  {filteredSites.length === 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '4px' }}>
                      등록된 현장 없음 — 아래에 주소 직접 입력
                    </div>
                  )}
                </div>
                {/* 신규 현장: 주소 직접 입력 */}
                <div style={fieldWrap}>
                  <label style={labelSt}>신규 현장 주소 직접 입력 <span style={{ color: '#ef4444' }}>*</span></label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="text" value={siteAddress} onChange={e => setSiteAddress(e.target.value)}
                      placeholder="예: 경기도 평택시 고덕면 고덕산단로 123"
                      style={{ flex: 1 }} />
                    <MicButton fieldId="siteAddr" onResult={t => setSiteAddress(t)} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          블록 3: WHAT — 장비 선택
      ════════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <BlockHeader id="WHAT" icon={<Package size={14} />} label="3. 장비"
          complete={whatComplete}
          summary={whatComplete ? `${equipments.map(e => `${e.modelName}×${e.qty}`).join(' + ')} (총 ${totalQty}대)` : undefined}
        />
        {openBlock === 'WHAT' && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* ft 탭 */}
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {FT_GROUPS.map(ft => (
                <button key={ft} type="button"
                  onClick={() => setActiveFt(ft)}
                  style={{
                    padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                    border: '1px solid var(--border-color)', cursor: 'pointer',
                    backgroundColor: activeFt === ft ? 'var(--primary)' : 'var(--bg-app)',
                    color: activeFt === ft ? '#fff' : 'var(--text-secondary)'
                  }}>
                  {ft}
                </button>
              ))}
            </div>
            {/* 모델 칩 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {getModelsByFt(activeFt).map(item => {
                const existing = equipments.find(e => e.modelName === item.modelName);
                return (
                  <button key={item.modelName} type="button"
                    onClick={() => addModel(item.modelName)}
                    style={{
                      padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700,
                      border: `2px solid ${existing ? 'var(--primary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      backgroundColor: existing ? 'rgba(79,70,229,0.1)' : 'var(--bg-app)',
                      color: existing ? 'var(--primary)' : 'var(--text-secondary)',
                    }}>
                    <div style={{ fontSize: '12px', fontWeight: 800 }}>{item.modelName}</div>
                    <div style={{ fontSize: '10.5px', opacity: 0.7 }}>{item.displayName.split('(')[1]?.replace(')','') || ''}</div>
                    {existing && (
                      <span style={{ display: 'inline-block', marginTop: '3px', backgroundColor: 'var(--primary)', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '11px' }}>
                        {existing.qty}대
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* 직접 입력 */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input type="text" list="sd3-models" id="sd3-manual" placeholder="직접 모델명 입력 (Enter)"
                style={{ flex: 1 }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) { addModel(v); (e.target as HTMLInputElement).value = ''; }
                  }
                }} />
              <datalist id="sd3-models">{uniqueModels.map(m => <option key={m} value={m} />)}</datalist>
              <button type="button" className="btn-secondary"
                onClick={() => {
                  const inp = document.getElementById('sd3-manual') as HTMLInputElement;
                  if (inp?.value.trim()) { addModel(inp.value.trim()); inp.value = ''; }
                }}
                style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                <Plus size={12} /> 추가
              </button>
              <MicButton fieldId="equipment" onResult={t => {
                const m = EQUIPMENT_SPEC_MATRIX.find(item =>
                  item.modelNumberAliases.some(a => t.includes(a)) || t.includes(item.modelName)
                );
                if (m) addModel(m.modelName);
                else showToast(`"${t}" 에서 모델을 인식하지 못했습니다.`, 'error');
              }} />
            </div>
            {/* 장바구니 */}
            {equipments.length > 0 && (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-app)' }}>
                <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 800 }}>
                  <ShoppingCart size={14} color="var(--primary)" />
                  신청 장바구니 — 총 {totalQty}대
                  <button type="button" onClick={() => setEquipments([])}
                    style={{ marginLeft: 'auto', fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                    비우기
                  </button>
                </div>
                {equipments.map((eq, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderBottom: i < equipments.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: 700 }}>{eq.modelName}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <button type="button" onClick={() => changeQty(i, -1)}
                        style={{ width: '26px', height: '26px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Minus size={12} />
                      </button>
                      <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 800, fontSize: '15px' }}>{eq.qty}</span>
                      <button type="button" onClick={() => changeQty(i, 1)}
                        style={{ width: '26px', height: '26px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Plus size={12} />
                      </button>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>대</span>
                    </div>
                    <button type="button" onClick={() => setEquipments(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {equipments.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary"
                  onClick={() => setOpenBlock('WHEN')}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 700 }}>
                  일정 입력으로 이동 (총 {totalQty}대) →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          블록 4: WHEN — 일정 (네이티브 피커)
      ════════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <BlockHeader id="WHEN" icon={<Calendar size={14} />} label="4. 일정"
          complete={whenComplete}
          summary={whenComplete ? `상차 ${loadingDisplay}${unloadingDisplay ? ' / 하차 ' + unloadingDisplay : ''}` : undefined}
        />
        {openBlock === 'WHEN' && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* 상차 */}
            <div>
              <label style={{ ...labelSt, color: 'var(--primary)' }}>상차 (출발지 상차) <span style={{ color: '#ef4444' }}>*</span></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="date" value={loadingDate} min={todayStr}
                    onChange={e => setLoadingDate(e.target.value)}
                    style={{ flex: 1, padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', cursor: 'pointer' }} />
                  <input type="time" value={loadingTimeVal}
                    onChange={e => setLoadingTimeVal(e.target.value)}
                    style={{ width: '100px', padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', cursor: 'pointer' }} />
                </div>
                <MicButton fieldId="loadingTime" onResult={t => {
                  const dm = t.match(/(\d{1,2})[./](\d{1,2})/);
                  if (dm) { const y = new Date().getFullYear(); setLoadingDate(`${y}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`); }
                  const tm = t.match(/(\d{1,2})[.:시](\d{2})?/);
                  if (tm) setLoadingTimeVal(`${tm[1].padStart(2,'0')}:${tm[2] || '00'}`);
                  else if (/오전|아침/i.test(t)) setLoadingTimeVal('08:00');
                  else if (/오후/i.test(t)) setLoadingTimeVal('14:00');
                }} />
              </div>
            </div>
            {/* 하차 */}
            <div>
              <label style={labelSt}>하차 (현장 도착)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="date" value={unloadingDate} min={loadingDate || todayStr}
                    onChange={e => setUnloadingDate(e.target.value)}
                    style={{ flex: 1, padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', cursor: 'pointer' }} />
                  <input type="time" value={unloadingTimeVal}
                    onChange={e => setUnloadingTimeVal(e.target.value)}
                    style={{ width: '100px', padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', cursor: 'pointer' }} />
                </div>
                <MicButton fieldId="unloadingTime" onResult={t => {
                  const dm = t.match(/(\d{1,2})[./](\d{1,2})/);
                  if (dm) { const y = new Date().getFullYear(); setUnloadingDate(`${y}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`); }
                }} />
              </div>
            </div>
            {/* 특이사항 */}
            <div style={fieldWrap}>
              <label style={labelSt}>특이사항 / 메모</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="text" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1 }} />
                <MicButton fieldId="note" onResult={t => setNote(prev => prev ? `${prev}. ${t}` : t)} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          블록 5: DETAILS — 자동 상속 세부정보 (기본 숨김)
      ════════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <BlockHeader id="DETAILS" icon={<Settings size={14} />} label="세부 정보 (DB 자동 상속)"
          complete={false}
          summary={inheritedFields.length > 0 ? `자동 상속: ${inheritedFields.join(' · ')}` : '담당자·청구·스펙 정보'}
        />
        {openBlock === 'DETAILS' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* 상속 배지 */}
            {inheritedFields.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '6px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: '12px', fontWeight: 700 }}>
                <CheckCircle2 size={14} />
                DB 자동 상속: {inheritedFields.join(' · ')}
              </div>
            )}

            {/* 담당자 정보 */}
            <div>
              <h5 style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--primary)', marginBottom: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>담당자 정보</h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                {([
                  ['영업담당자', salespersonName, setSalespersonName, '홍길동'],
                  ['영업담당자 연락처', salespersonPhone, setSalespersonPhone, '010-0000-0000'],
                  ['현장담당자', siteContactName, setSiteContactName, '김소장'],
                  ['현장담당자 연락처 *', siteContactPhone, setSiteContactPhone, '010-0000-0000'],
                  ['청구담당자', billingContactName, setBillingContactName, '이대리'],
                  ['청구담당자 연락처', billingContactPhone, setBillingContactPhone, '010-0000-0000'],
                  ['거래명세서 메일', statementEmail, setStatementEmail, 'site@co.kr'],
                  ['계산서 메일', taxBillEmail, setTaxBillEmail, 'tax@co.kr'],
                ] as [string, string, (v: string) => void, string][]).map(([label, val, setter, ph]) => (
                  <div key={label} style={fieldWrap}>
                    <label style={labelSt}>{label}</label>
                    <input type="text" value={val} onChange={e => setter(e.target.value)} placeholder={`예: ${ph}`}
                      style={{ borderColor: label.includes('*') && !val ? '#fca5a5' : undefined }} />
                  </div>
                ))}
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={labelSt}>현장 주소 <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="text" value={siteAddress} onChange={e => setSiteAddress(e.target.value)}
                    placeholder="예: 경기도 평택시 고덕면 고덕산단로 123"
                    style={{ borderColor: !siteAddress ? '#fca5a5' : undefined }} />
                </div>
              </div>
            </div>

            {/* 옵션/스펙 */}
            <div>
              <h5 style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--primary)', marginBottom: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>옵션 및 스펙</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div style={fieldWrap}>
                  <label style={labelSt}>유상 옵션</label>
                  <input type="text" value={paidOptions} onChange={e => setPaidOptions(e.target.value)} placeholder="예: 3면 함석" />
                </div>
                <div style={fieldWrap}>
                  <label style={labelSt}>보양작업 조건</label>
                  <input type="text" value={protection} onChange={e => setProtection(e.target.value)} placeholder="예: 4면 망 보양" />
                </div>
              </div>
              {/* 스펙 체크 */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn-secondary" style={{ padding: '2px 7px', fontSize: '11px' }} onClick={() => { const u: Record<string,boolean>= {}; STANDARD_SPECS.forEach(s => { u[s.id] = true; }); setCheckedSpecs(u); }}>전체선택</button>
                <button type="button" className="btn-secondary" style={{ padding: '2px 7px', fontSize: '11px' }} onClick={() => setCheckedSpecs({})}>전체해제</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '5px' }}>
                {STANDARD_SPECS.map(spec => {
                  const on = !!checkedSpecs[spec.id];
                  return (
                    <label key={spec.id} style={{
                      display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                      backgroundColor: on ? 'rgba(34,197,94,0.12)' : 'transparent',
                      border: `1px solid ${on ? '#16a34a' : 'var(--border-color)'}`,
                    }}>
                      <input type="checkbox" checked={on} onChange={() => setCheckedSpecs(p => ({ ...p, [spec.id]: !p[spec.id] }))} />
                      <span style={{ color: on ? '#15803d' : 'var(--text-secondary)', fontWeight: on ? 800 : 'normal' }}>{spec.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 옵션 변경 저장 여부 */}
            {currentMatchedSite && isOptionsDiff && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, color: '#f59e0b', padding: '8px 12px', backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.4)' }}>
                <input type="checkbox" checked={saveOptionsToSite} onChange={e => setSaveOptionsToSite(e.target.checked)} />
                📍 변경된 옵션을 '{selectedSite?.name}' 현장 기본값으로 갱신
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}>
              <input type="checkbox" checked={isSetAsCustomerDefault} onChange={e => setIsSetAsCustomerDefault(e.target.checked)} />
              🏢 이 옵션·스펙을 '{selectedCustomer?.name || '고객사'}' 기본 설정으로 등록
            </label>

            {/* 정산 */}
            <div>
              <h5 style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--primary)', marginBottom: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>정산 정보 (자동 상속)</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={fieldWrap}>
                  <label style={labelSt}>청구 마감일{inheritedFields.includes('마감일') && <span style={{ color: '#16a34a', marginLeft: '4px', fontSize: '10px' }}>[DB]</span>}</label>
                  <input type="text" value={closingDay} onChange={e => setClosingDay(e.target.value)} placeholder="예: 말일" />
                </div>
                <div style={fieldWrap}>
                  <label style={labelSt}>결제 예정일{inheritedFields.includes('결제일') && <span style={{ color: '#16a34a', marginLeft: '4px', fontSize: '10px' }}>[DB]</span>}</label>
                  <input type="text" value={paymentDay} onChange={e => setPaymentDay(e.target.value)} placeholder="예: 익월 25일" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 최종 요약 + 출고 지시 CTA ───────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
        padding: '14px 18px', backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: '10px', flexWrap: 'wrap'
      }}>
        <div style={{ fontSize: '12.5px', lineHeight: '1.6' }}>
          {selectedCustomer && <div style={{ fontWeight: 800, color: 'var(--text-main)' }}>{selectedCustomer.name} {selectedSite ? `/ ${selectedSite.name}` : ''}</div>}
          {totalQty > 0 && <div style={{ color: 'var(--primary)', fontWeight: 700 }}>{equipments.map(e => `${e.modelName}×${e.qty}`).join(' + ')} (총 {totalQty}대)</div>}
          {loadingDate && <div style={{ color: 'var(--text-muted)' }}>상차 {loadingDisplay}{unloadingDisplay ? ` / 하차 ${unloadingDisplay}` : ''}</div>}
          {!selectedCustomer && <span style={{ color: 'var(--text-muted)' }}>고객사·현장·장비·일정을 선택하세요</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={handleReset} style={{ padding: '8px 14px', fontSize: '13px' }}>초기화</button>
          {canSave && (
            <button type="button" className="btn-primary" onClick={handleSave} disabled={isSubmitting}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '13px', fontWeight: 800 }}>
              <Zap size={15} /> 출고 지시
            </button>
          )}
        </div>
      </div>

      {/* ── 진행 모달 ─────────────────────────────────────────────────────── */}
      {processingOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '32px 36px', minWidth: '400px', maxWidth: '560px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ marginBottom: '20px', fontSize: '16px', fontWeight: 800 }}>
              {processCompleted ? `✅ 출고 지시 완료${savedContractNo ? ` (${savedContractNo})` : ''}` : '🚀 출고 파이프라인 진행 중...'}
            </h3>
            <div style={{ marginBottom: '16px', height: '6px', backgroundColor: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', backgroundColor: '#10b981', borderRadius: '3px', width: `${progressPct}%`, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', fontWeight: 600 }}>{stepText}</div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: '1.6' }}>
              {progressLogs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            {processCompleted && (
              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-primary" onClick={() => { setProcessingOpen(false); handleReset(); }} style={{ padding: '8px 20px', fontWeight: 800 }}>
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
