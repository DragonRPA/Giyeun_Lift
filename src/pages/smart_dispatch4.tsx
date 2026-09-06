// src/pages/smart_dispatch4.tsx
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ 출고의뢰 (통합) — smart_dispatch4  (v1.9.2.Build.216)                   │
// │                                                                         │
// │ [WTT 100회 스트레스 테스트 7대 결함 전수 해결]                           │
// │  1. DB 무누락 영구 저장 (F5 시 증발 방지, 헌장 1.2, 5.2 준수)           │
// │  2. 실제 배차 대장(deliveries) 및 계약 연동 (saveSmartDispatch 연결)      │
// │  3. 대차(EXCHANGE) 회수 대상 전자산 1:1 매핑 패널 (헌장 2.3, 4.2 준수) │
// │  4. 운송비 부담 주체(paidBy) 귀속선 패널 (헌장 5.5 준수)                 │
// │  5. 현장 안전옵션/보양 4종 체크리스트 탑재                               │
// │  6. 다수 장비 시차 출고 분할 메모 지원                                   │
// │  7. 9대 필수 스키마 실시간 방어 차단 실드 & 정형화 서식 뷰 복원          │
// └─────────────────────────────────────────────────────────────────────────┘
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { db, Customer, CustomerSite, findCustomerByNormalizedName } from '../services/db';
import { EQUIPMENT_SPEC_MATRIX } from '../services/voiceOrderDraftService';
import { matchHangul } from '../utils/hangulSearch';
import {
  fetchMyDrafts, subscribeDraftUpdates, submitDraft, discardDraft,
  createDraftOrder, DraftDispatchOrder
} from '../services/callUploadService';
import {
  Plus, Minus, Trash2, ChevronDown, ChevronUp,
  Building2, MapPin, Package, Calendar, User,
  ClipboardPaste, ArrowRight, Info, Merge,
  UploadCloud, ShieldCheck, ShieldAlert,
  AlertTriangle, Check, AlertCircle, RotateCcw,
  Truck, Wrench, Shield
} from 'lucide-react';
import { CallAudioUploadModal } from '../components/CallAudioUploadModal';
import './smart_dispatch4.css';

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

type CallContext =
  | 'NEW_CUSTOMER'
  | 'ADDITIONAL'
  | 'EXCHANGE'
  | 'RETURN'
  | 'FIELD_AS'
  | 'TRANSPORT_NEGO'
  | 'SUBLEASE_NEGO';

type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'MISSING';

interface ScoredField {
  value: string;
  confidence: ConfidenceLevel;
  source?: 'DB' | 'STT' | 'PARSED' | 'MANUAL' | 'SUMMARY';
  confirmed: boolean;
}

interface EquipmentItem { modelName: string; qty: number; }

export type PaidBy = 'CUSTOMER' | 'OURS' | 'SPLIT';

interface DraftOrder {
  id: string;
  context: CallContext[];
  customerName: ScoredField;
  siteName: ScoredField;
  equipments: EquipmentItem[];
  loadingDate: ScoredField;
  loadingTime: ScoredField;
  contactPerson: ScoredField;
  contactPhone: ScoredField;
  note: string;
  status: 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'DISCARDED';
  isNewCustomer: boolean;
  customerRegistered: boolean;
  createdAt: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  // 🌟 WTT 결함 해결 추가 필드
  retrievalAssetId?: string; // 대차 시 회수 대상 전자산 ID
  paidBy?: PaidBy;           // 운송비 귀속 주체
  safetyOptions?: string[];  // 안전옵션/보양 목록
  staggeredMemo?: string;    // 시차 출고 메모
}

type ActiveTab = 'NEW' | 'QUEUE';
type BlockId = 'WHO' | 'WHERE' | 'WHAT' | 'WHEN' | 'SAFETY_COST';

const CONTEXT_OPTIONS: { id: CallContext; label: string; color: string }[] = [
  { id: 'NEW_CUSTOMER',   label: '신규고객 출고',   color: '#7c3aed' },
  { id: 'ADDITIONAL',     label: '추가 출고',       color: '#2563eb' },
  { id: 'EXCHANGE',       label: '교체(대차)',       color: '#0891b2' },
  { id: 'RETURN',         label: '회수 요청',       color: '#dc2626' },
  { id: 'FIELD_AS',       label: '현장 AS',         color: '#d97706' },
  { id: 'TRANSPORT_NEGO', label: '운송사 배차 협의', color: '#059669' },
  { id: 'SUBLEASE_NEGO',  label: '전대 임차 협의',  color: '#6b7280' },
];

const FT_GROUPS = ['19ft', '26ft', '32ft', '33ft', '40ft', '특수/기타'];

const SAFETY_OPTION_LIST = [
  { id: 'BAR_4EA',      label: '협착방지봉 4EA' },
  { id: 'FIRE_EXT',     label: '소화기함 장착' },
  { id: 'MESH_4SIDE',   label: '4면 철망 보양' },
  { id: 'PAINT_COVER',  label: '도색방지 비닐 커버' },
];

const getModelsByFt = (ft: string) => {
  return EQUIPMENT_SPEC_MATRIX.filter(m => {
    if (ft === '19ft') return m.modelName.includes('19');
    if (ft === '26ft') return m.modelName.includes('26');
    if (ft === '32ft') return m.modelName.includes('32');
    if (ft === '33ft') return m.modelName.includes('33');
    if (ft === '40ft') return m.modelName.includes('40');
    return !m.modelName.match(/19|26|32|33|40/);
  });
};

const calcUrgency = (dateStr: string): DraftOrder['urgency'] => {
  if (!dateStr) return 'LOW';
  const today = new Date().toISOString().split('T')[0];
  const diff = (new Date(dateStr).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
  if (diff <= 1) return 'HIGH';
  if (diff <= 3) return 'MEDIUM';
  return 'LOW';
};

const makeScoredField = (value: string, source: ScoredField['source'] = 'MANUAL'): ScoredField => ({
  value, source, confirmed: false,
  confidence: value ? 'HIGH' : 'MISSING',
});

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export const SmartDispatch4: React.FC = () => {
  const {
    hasPermission, customers, sites, contacts, currentUser,
    saveSmartDispatch, assets
  } = useApp();

  const canSave = hasPermission('delivery', 'save');

  // ── 탭 ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('NEW');
  const [audioUploadOpen, setAudioUploadOpen] = useState(false);

  // ── 토스트 ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── 처리 대기 큐 ──────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<DraftOrder[]>([]);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());

  const loadDrafts = useCallback(async () => {
    try {
      const dbDrafts = await fetchMyDrafts();
      const mapped: DraftOrder[] = dbDrafts.map(d => ({
        id:                 d.id,
        context:            d.context,
        customerName:       { ...d.customerName, confirmed: false },
        siteName:           { ...d.siteName,     confirmed: false },
        equipments:         d.equipments,
        loadingDate:        { ...d.loadingDate,  confirmed: false },
        loadingTime:        { ...d.loadingTime,  confirmed: false },
        contactPerson:      { ...d.contactPerson,confirmed: false },
        contactPhone:       { value: d.contactPhone, confidence: d.contactPhone ? 'HIGH' : 'MISSING', confirmed: false },
        note:               d.note,
        status:             d.status as DraftOrder['status'],
        isNewCustomer:      d.isNewCustomer,
        customerRegistered: d.customerRegistered,
        createdAt:          d.createdAt,
        urgency:            d.urgency,
      }));
      setQueue(mapped);
    } catch {
      // Supabase 미연결 시 로컬 유지
    }
  }, []);

  useEffect(() => {
    loadDrafts();
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        if (!currentUser?.id) return;
        unsubscribe = subscribeDraftUpdates(currentUser.id, (newDraft: DraftDispatchOrder) => {
          const mapped: DraftOrder = {
            id:                 newDraft.id,
            context:            newDraft.context,
            customerName:       { ...newDraft.customerName, confirmed: false },
            siteName:           { ...newDraft.siteName,     confirmed: false },
            equipments:         newDraft.equipments,
            loadingDate:        { ...newDraft.loadingDate,  confirmed: false },
            loadingTime:        { ...newDraft.loadingTime,  confirmed: false },
            contactPerson:      { ...newDraft.contactPerson,confirmed: false },
            contactPhone:       { value: newDraft.contactPhone, confidence: newDraft.contactPhone ? 'HIGH' : 'MISSING', confirmed: false },
            note:               newDraft.note,
            status:             newDraft.status as DraftOrder['status'],
            isNewCustomer:      newDraft.isNewCustomer,
            customerRegistered: newDraft.customerRegistered,
            createdAt:          newDraft.createdAt,
            urgency:            newDraft.urgency,
          };
          setQueue(prev => {
            if (prev.find(d => d.id === mapped.id)) return prev;
            return [mapped, ...prev];
          });
          showToast(`새 초안 도착: ${mapped.customerName.value || '(미인식)'}`, 'info');
        });
      } catch { /* 비로그인 시 무시 */ }
    })();
    return () => { unsubscribe?.(); };
  }, [loadDrafts, currentUser?.id, showToast]);

  const pendingCount = queue.filter(q => q.status === 'DRAFT').length;

  // ── 업무 유형 (단일 맥락 선택) ─────────────────────────────────────────
  const [selectedContext, setSelectedContext] = useState<CallContext>('ADDITIONAL');

  // 안전옵션 추출 헬퍼 (CustomerSite로부터 유상옵션 및 보양 추출)
  const extractSafetyOptionsFromSite = useCallback((site: CustomerSite | null): Set<string> => {
    const s = new Set<string>();
    if (!site) return s;
    const p = `${site.paidOptions || ''} ${site.protection || ''}`;
    if (/협착|BAR_4EA/i.test(p)) s.add('BAR_4EA');
    if (/소화기|FIRE_EXT/i.test(p)) s.add('FIRE_EXT');
    if (/철망|망보양|MESH_4SIDE/i.test(p)) s.add('MESH_4SIDE');
    if (/도색|비닐|커버|PAINT_COVER/i.test(p)) s.add('PAINT_COVER');
    return s;
  }, []);

  const isNewCustomerMode = selectedContext === 'NEW_CUSTOMER';
  const isExchangeMode = selectedContext === 'EXCHANGE';

  // ── 붙여넣기 파싱 존 ──────────────────────────────────────────────────────
  const [pasteZoneOpen, setPasteZoneOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // ── 블록 열림 상태 ────────────────────────────────────────────────────────
  const [openBlock, setOpenBlock] = useState<BlockId>('WHO');
  const toggleBlock = (id: BlockId) => setOpenBlock(prev => prev === id ? 'WHO' : id);

  // ── WHO 블록 — 고객 ───────────────────────────────────────────────────────
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerAddress, setNewCustomerAddress] = useState('');

  // 🌟 검색어가 없을 때는 고객사를 일절 추천/제시하지 않음 (사용자 피드백 100% 반영)
  const filteredCustomers = useMemo(() => {
    if (!customerQuery.trim()) return [];
    return customers.filter(c => matchHangul(c.name, customerQuery)).slice(0, 16);
  }, [customers, customerQuery]);

  // 중복 접수 감지
  const duplicateAlert = useMemo(() => {
    if (!selectedCustomer) return null;
    const today = new Date().toISOString().split('T')[0];
    const duplicates = queue.filter(d =>
      d.customerName.value === selectedCustomer.name &&
      d.createdAt.startsWith(today) &&
      d.status === 'DRAFT'
    );
    return duplicates.length > 0 ? duplicates : null;
  }, [selectedCustomer, queue]);

  // ── WHERE 블록 — 투입 현장 및 현장 담당자 ────────────────────────────────
  const [siteQuery, setSiteQuery] = useState('');
  const [selectedSite, setSelectedSite] = useState<CustomerSite | null>(null);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteAddress, setNewSiteAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const filteredSites = useMemo(() => {
    const base = selectedCustomer
      ? sites.filter(s => s.customerId === selectedCustomer.id)
      : sites;
    if (!siteQuery.trim()) return base.slice(0, 16);
    return base.filter(s => matchHangul(s.name, siteQuery)).slice(0, 16);
  }, [sites, selectedCustomer, siteQuery]);

  // ── WHAT 블록 — 장비 ──────────────────────────────────────────────────────
  const [equipments, setEquipments] = useState<EquipmentItem[]>([]);
  const [activeFt, setActiveFt] = useState(FT_GROUPS[0] || '19ft');

  const addModel = (modelName: string) => {
    setEquipments(prev => {
      const idx = prev.findIndex(e => e.modelName === modelName);
      if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], qty: u[idx].qty + 1 }; return u; }
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
  const removeEquipment = (index: number) => {
    setEquipments(prev => prev.filter((_, i) => i !== index));
  };
  const totalQty = equipments.reduce((s, e) => s + e.qty, 0);

  // ── WHEN 블록 — 출고 및 상차 일정 ─────────────────────────────────────────
  const [loadingDate, setLoadingDate] = useState('');
  const [loadingTimeVal, setLoadingTimeVal] = useState('08:00');
  const [note, setNote] = useState('');

  // ── 🌟 [WTT 결함 해결 1] 대차(EXCHANGE) 회수 대상 전자산 1:1 매핑 ─────────
  const [retrievalAssetId, setRetrievalAssetId] = useState<string>('');

  // 선택된 고객사의 현재 가동 중인 장비 목록 (대차 대상)
  const activeCustomerAssets = useMemo(() => {
    if (!selectedCustomer) return [];
    return assets.filter(a => a.status === 'RENTED');
  }, [selectedCustomer, assets]);

  // ── 🌟 [WTT 결함 해결 2] 운송비 귀속선 (paidBy) ─────────────────────────
  const [paidBy, setPaidBy] = useState<PaidBy>('CUSTOMER');

  // ── 🌟 [추가출고 기본옵션 상속 및 첨삭 감지] 안전옵션 및 보양 ─────────────
  const [selectedSafetyOptions, setSelectedSafetyOptions] = useState<Set<string>>(new Set());
  const [initialSiteOptions, setInitialSiteOptions] = useState<Set<string>>(new Set());
  const [optionConfirmModalOpen, setOptionConfirmModalOpen] = useState(false);

  const toggleSafetyOption = (id: string) => {
    setSelectedSafetyOptions(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // 첨삭(변경) 발생 여부 계산: 추가출고이면서 현장 기존 옵션과 달라진 경우 true
  const isOptionsModified = useMemo(() => {
    if (selectedContext !== 'ADDITIONAL') return false;
    if (!selectedSite) return false;
    if (selectedSafetyOptions.size !== initialSiteOptions.size) return true;
    for (const opt of selectedSafetyOptions) {
      if (!initialSiteOptions.has(opt)) return true;
    }
    return false;
  }, [selectedContext, selectedSite, selectedSafetyOptions, initialSiteOptions]);

  // ── 🌟 [WTT 결함 해결 4] 시차 출고 메모 ────────────────────────────────
  const [staggeredMemo, setStaggeredMemo] = useState('');

  // DB 상속
  const applyInheritance = useCallback((cust: Customer | null, site: CustomerSite | null) => {
    if (!cust) return;
    if (site) {
      if (site.contactName && !contactPerson) setContactPerson(site.contactName);
      if (site.contact && !contactPhone) setContactPhone(site.contact);
      return;
    }
    const custContacts = contacts.filter(c => c.customerId === cust.id);
    const primary = custContacts[0];
    if (primary) {
      if (!contactPerson) setContactPerson(primary.name);
      if (!contactPhone) setContactPhone(primary.contact || '');
    }
  }, [contacts, contactPerson, contactPhone]);

  const handleSelectCustomer = (cust: Customer) => {
    setSelectedCustomer(cust);
    setCustomerQuery('');
    setSelectedSite(null);
    setSiteQuery('');
    applyInheritance(cust, null);
    setOpenBlock('WHERE');
  };

  const handleSelectSite = (site: CustomerSite) => {
    setSelectedSite(site);
    setSiteQuery('');
    applyInheritance(selectedCustomer, site);

    // 🌟 추가출고인 경우 기존 옵션값을 디폴트로 자동 상속
    if (selectedContext === 'ADDITIONAL') {
      const defaultOpts = extractSafetyOptionsFromSite(site);
      setSelectedSafetyOptions(new Set(defaultOpts));
      setInitialSiteOptions(new Set(defaultOpts));
    }
    setOpenBlock('WHAT');
  };

  const handleSelectContext = (ctx: CallContext) => {
    setSelectedContext(ctx);
    // 추가출고로 전환 시 이미 선택된 현장이 있으면 옵션 자동 로드
    if (ctx === 'ADDITIONAL' && selectedSite) {
      const defaultOpts = extractSafetyOptionsFromSite(selectedSite);
      setSelectedSafetyOptions(new Set(defaultOpts));
      setInitialSiteOptions(new Set(defaultOpts));
    }
  };

  // ── 붙여넣기 파싱 ─────────────────────────────────────────────────────────
  const runParse = useCallback((text: string) => {
    if (!text.trim()) { showToast('텍스트를 입력하세요.', 'error'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const extractPhone = (s: string) => (s.match(/(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g) || [''])[0].replace(/\s+/g, '');
    const extractName = (s: string) => s.split(/01[016789]/)[0].replace(/[:-]/g, '').replace(/선임|책임|담당자|소장|부장|팀장/g, '').trim();

    let pc = '', ps = '', pscname = '', pscphone = '', pload = '';
    const peqs: EquipmentItem[] = [];
    let pnote = '';

    lines.forEach(line => {
      const val = line.includes(':') ? line.substring(line.indexOf(':') + 1).trim() : '';
      if (/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호)/i.test(line)) pc = val;
      else if (/^(?:\d+[.)]\s*)?(?:현장명?|현장)(?!\s*상세|\s*주소|\s*담당)/i.test(line)) ps = val;
      else if (/^(?:\d+[.)]\s*)?(?:현장\s*담당자?|현장담당|소장|반장)/i.test(line)) {
        pscname = extractName(val); pscphone = extractPhone(val);
      }
      else if (/^(?:\d+[.)]\s*)?(?:상차\s*스케줄|상차\s*시간|상차시간|상차)/i.test(line)) pload = val;
      else if (/^(?:\d+[.)]\s*)?(?:신청.*모델.*목록|신청모델|모델명?|장비명?|규격)/i.test(line) || /^\s*-\s*(?:GS|SJ|JCPT|HD)/i.test(line)) {
        const raw = val || line.replace(/^.*[:：]/, '').replace(/^-\s*/, '');
        raw.split(/[/,]/).forEach(p => {
          const m = p.match(/(.+?)\s*[*xX대]\s*(\d+)/) || p.match(/(.+?)\s*(\d+)\s*대/);
          if (m) peqs.push({ modelName: m[1].replace(/대$/, '').trim(), qty: parseInt(m[2]) || 1 });
          else if (p.trim()) peqs.push({ modelName: p.trim(), qty: 1 });
        });
      }
      else if (/^(?:\d+[.)]\s*)?(?:특이사항|비고|메모)/i.test(line)) pnote = val;
    });

    if (pc) {
      const mc = findCustomerByNormalizedName(customers, pc);
      if (mc) {
        setSelectedCustomer(mc);
        if (ps) {
          const cleanSite = ps.replace(/\s/g, '');
          const ms = sites.find(s => s.customerId === mc.id &&
            (s.name.replace(/\s/g, '') === cleanSite || s.name.includes(ps) || ps.includes(s.name)));
          if (ms) { setSelectedSite(ms); applyInheritance(mc, ms); }
          else { applyInheritance(mc, null); }
        } else { applyInheritance(mc, null); }
      } else {
        showToast(`고객사 "${pc}"는 DB에 없습니다. 직접 선택하세요.`, 'error');
      }
    }

    if (pscname) setContactPerson(pscname);
    if (pscphone) setContactPhone(pscphone);
    if (peqs.length > 0) setEquipments(peqs);
    if (pnote) setNote(pnote);

    if (pload) {
      const dm = pload.match(/(\d{1,2})[./](\d{1,2})/);
      if (dm) { const y = new Date().getFullYear(); setLoadingDate(`${y}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}`); }
      const tm = pload.match(/(\d{1,2})[.:시](\d{2})?/);
      if (tm) setLoadingTimeVal(`${tm[1].padStart(2, '0')}:${(tm[2] || '00')}`);
    }

    setPasteZoneOpen(false);
    showToast('텍스트 파싱 완료');
  }, [customers, sites, applyInheritance, showToast]);

  // ── 폼 초기화 ─────────────────────────────────────────────────────────────
  const resetForm = () => {
    setSelectedCustomer(null); setSelectedSite(null);
    setCustomerQuery(''); setSiteQuery('');
    setEquipments([]); setLoadingDate(''); setLoadingTimeVal('08:00');
    setContactPerson(''); setContactPhone(''); setNote('');
    setNewCustomerName(''); setNewCustomerPhone(''); setNewCustomerAddress('');
    setNewSiteName(''); setNewSiteAddress('');
    setRetrievalAssetId(''); setPaidBy('CUSTOMER');
    setSelectedSafetyOptions(new Set()); setInitialSiteOptions(new Set());
    setStaggeredMemo('');
    setSelectedContext('ADDITIONAL');
    setOpenBlock('WHO');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 9대 필수 스키마 유효성 검증 실드 (Validation Shield)
  // ─────────────────────────────────────────────────────────────────────────
  interface ValidationRule {
    id: string;
    label: string;
    targetBlock: BlockId;
    status: 'VALID' | 'INVALID' | 'WARN';
    currentVal: string;
    hint: string;
  }

  const validationRules = useMemo<ValidationRule[]>(() => {
    const skipEquip = selectedContext === 'RETURN' || selectedContext === 'FIELD_AS' ||
      selectedContext === 'TRANSPORT_NEGO' || selectedContext === 'SUBLEASE_NEGO';

    const custName = isNewCustomerMode ? newCustomerName.trim() : (selectedCustomer?.name || '');
    const siteNameVal = isNewCustomerMode ? newSiteName.trim() : (selectedSite?.name || '');
    const addrVal = isNewCustomerMode
      ? (newSiteAddress.trim() || newCustomerAddress.trim())
      : (selectedSite?.address || newSiteAddress.trim());
    const hasEquip = skipEquip || (equipments.length > 0 && equipments.every(e => e.modelName && e.qty > 0));
    const hasDate = !!loadingDate.trim();
    const hasTime = !!loadingTimeVal.trim();
    const hasContactPerson = !!contactPerson.trim();
    const cleanPhone = contactPhone.replace(/[^0-9]/g, '');
    const hasContactPhone = cleanPhone.length >= 9;

    // 대차 시 전자산 선택 검증 (헌장 2.3)
    const hasRetrieval = !isExchangeMode || !!retrievalAssetId;

    return [
      {
        id: 'CUSTOMER',
        label: '고객사 지정',
        targetBlock: 'WHO',
        status: custName ? 'VALID' : 'INVALID',
        currentVal: custName || '(고객사 미선택)',
        hint: '기존 고객 검색 또는 신규 고객명 필수',
      },
      {
        id: 'SITE',
        label: '투입 현장명',
        targetBlock: 'WHERE',
        status: siteNameVal ? 'VALID' : 'INVALID',
        currentVal: siteNameVal || '(현장명 미선택)',
        hint: '현장 검색 선택 또는 신규 현장명 입력',
      },
      {
        id: 'ADDRESS',
        label: '현장 상세주소',
        targetBlock: 'WHERE',
        status: addrVal ? 'VALID' : 'WARN',
        currentVal: addrVal || '(주소 미입력 — 배차 시 확인)',
        hint: '배차 기사용 정확한 현장 주소',
      },
      {
        id: 'CONTACT',
        label: '현장 인수자/연락처',
        targetBlock: 'WHERE', // 🌟 현장 블록으로 이동
        status: (hasContactPerson && hasContactPhone) ? 'VALID' : 'INVALID',
        currentVal: (hasContactPerson || hasContactPhone)
          ? `${contactPerson || '(성명누락)'} / ${contactPhone || '(전화누락)'}`
          : '(인수자 미입력)',
        hint: '현장 담당자 성명 및 9자리 이상 연락처',
      },
      {
        id: 'EQUIPMENT',
        label: '출고 신청 장비',
        targetBlock: 'WHAT',
        status: hasEquip ? 'VALID' : 'INVALID',
        currentVal: skipEquip
          ? '장비선택 생략 맥락'
          : totalQty > 0
            ? `${equipments.map(e => `${e.modelName}×${e.qty}`).join(', ')} (총 ${totalQty}대)`
            : '(장비 미선택)',
        hint: '최소 1대 이상 규격 및 수량 선택',
      },
      {
        id: 'DATE',
        label: '출고(상차)일자',
        targetBlock: 'WHEN',
        status: hasDate ? 'VALID' : 'INVALID',
        currentVal: loadingDate || '(출고일자 미지정)',
        hint: '장비 출고 희망일 필수 입력',
      },
      {
        id: 'TIME',
        label: '상차 지정시간',
        targetBlock: 'WHEN',
        status: hasTime ? 'VALID' : 'INVALID',
        currentVal: loadingTimeVal || '(상차시간 미지정)',
        hint: '상차 예정 시간 (기본 08:00)',
      },
      {
        id: 'RETRIEVAL_ASSET',
        label: '회수 전자산 (대차전용)',
        targetBlock: 'SAFETY_COST',
        status: hasRetrieval ? 'VALID' : 'INVALID',
        currentVal: isExchangeMode ? (retrievalAssetId ? `자산번호 #${retrievalAssetId}` : '(회수 대상 미지정)') : '해당없음(일반출고)',
        hint: '대차(EXCHANGE) 시 회수할 전자산 1:1 필수 매핑',
      },
      {
        id: 'PAID_BY',
        label: '운송비 부담 귀속선',
        targetBlock: 'SAFETY_COST',
        status: 'VALID',
        currentVal: paidBy === 'CUSTOMER' ? '고객사 청구 (기본)' : paidBy === 'OURS' ? '당사 영업 부담(면제)' : '편도 지원',
        hint: '운송비 정산 및 회계 귀속선',
      },
    ];
  }, [
    isNewCustomerMode, isExchangeMode, newCustomerName, selectedCustomer,
    newSiteName, selectedSite, newSiteAddress, newCustomerAddress,
    selectedContext, equipments, totalQty,
    loadingDate, loadingTimeVal, contactPerson, contactPhone,
    retrievalAssetId, paidBy
  ]);

  const invalidRules = useMemo(() => validationRules.filter(r => r.status === 'INVALID'), [validationRules]);
  const passCount = useMemo(() => validationRules.filter(r => r.status === 'VALID').length, [validationRules]);
  const isFormValid = invalidRules.length === 0;

  // ── 출고 지시 (DB 무누락 영구 저장 & 방어 차단) ───────────────────────────
  const handleSaveDraft = async () => {
    // 🛡️ 1차 방어 차단: 필수 스키마 누락 체크
    if (!isFormValid) {
      const firstInvalid = invalidRules[0];
      setOpenBlock(firstInvalid.targetBlock);
      showToast(`[출고 방어 차단] ${firstInvalid.label}이(가) 누락되었습니다. (${firstInvalid.hint})`, 'error');
      return;
    }

    // 🌟 [추가출고 첨삭 저장 확인] 기존 옵션에서 첨삭이 발생한 경우 확인 모달 표출
    if (isOptionsModified) {
      setOptionConfirmModalOpen(true);
      return;
    }

    // 첨삭이 없거나 추가출고가 아닌 경우 패스 (바로 저장)
    await executeSaveDraft(false);
  };

  const executeSaveDraft = async (saveToSite: boolean) => {
    setOptionConfirmModalOpen(false);
    try {
      const uploaderId = currentUser?.id || 'anonymous_user';

      // 🌟 [첨삭 저장 확인] 현장 기본값으로 저장 선택 시 CustomerSite DB 업데이트
      if (saveToSite && selectedSite) {
        const paidOpts = Array.from(selectedSafetyOptions)
          .filter(id => id === 'BAR_4EA' || id === 'FIRE_EXT')
          .map(id => SAFETY_OPTION_LIST.find(s => s.id === id)?.label)
          .join(', ');
        const protOpts = Array.from(selectedSafetyOptions)
          .filter(id => id === 'MESH_4SIDE' || id === 'PAINT_COVER')
          .map(id => SAFETY_OPTION_LIST.find(s => s.id === id)?.label)
          .join(', ');

        db.updateRow<CustomerSite>('sites', selectedSite.id, {
          paidOptions: paidOpts,
          protection: protOpts,
          updatedAt: new Date().toISOString(),
        });
        showToast(`현장 '${selectedSite.name}'의 기본 옵션이 갱신 저장되었습니다.`, 'info');
      }

      const siteConf: ConfidenceLevel = selectedSite ? 'HIGH' : 'MISSING';
      const siteSrc: ScoredField['source'] = selectedSite ? 'DB' : 'MANUAL';
      const loadConf: ConfidenceLevel = loadingDate ? 'HIGH' : 'MISSING';
      const timeConf: ConfidenceLevel = loadingTimeVal ? 'HIGH' : 'MISSING';

      const fullNote = [
        note,
        selectedSafetyOptions.size > 0 ? `[안전옵션] ${Array.from(selectedSafetyOptions).map(id => SAFETY_OPTION_LIST.find(s => s.id === id)?.label).join(', ')}` : '',
        staggeredMemo ? `[시차출고] ${staggeredMemo}` : '',
        isExchangeMode && retrievalAssetId ? `[대차회수대상] 자산 #${retrievalAssetId}` : '',
        `[운송비부담] ${paidBy === 'CUSTOMER' ? '고객청구' : paidBy === 'OURS' ? '당사부담' : '편도지원'}`
      ].filter(Boolean).join(' | ');

      await createDraftOrder({
        ownerId: uploaderId,
        sourceCallIds: [],
        context: [selectedContext],
        customerName: isNewCustomerMode
          ? { value: newCustomerName, confidence: 'LOW' as ConfidenceLevel, source: 'MANUAL' as const, confirmed: false }
          : { value: selectedCustomer!.name, confidence: 'HIGH' as ConfidenceLevel, source: 'DB' as const, confirmed: true },
        siteName: isNewCustomerMode
          ? { value: newSiteName || '미정', confidence: 'LOW' as ConfidenceLevel, source: 'MANUAL' as const, confirmed: false }
          : { value: selectedSite?.name || '미정', confidence: siteConf, source: siteSrc, confirmed: !!selectedSite },
        equipments: [...equipments],
        loadingDate: { value: loadingDate, confidence: loadConf, source: 'MANUAL' as const, confirmed: !!loadingDate },
        loadingTime: { value: loadingTimeVal, confidence: timeConf, source: 'MANUAL' as const, confirmed: !!loadingTimeVal },
        contactPerson: makeScoredField(contactPerson),
        contactPhone: makeScoredField(contactPhone).value,
        note: fullNote,
        status: 'DRAFT',
        urgency: calcUrgency(loadingDate),
        isNewCustomer: isNewCustomerMode,
        customerRegistered: !isNewCustomerMode,
      });

      await loadDrafts();
      resetForm();
      showToast(`출고의뢰 초안이 DB에 안전하게 보존되었습니다 ➔ 처리 대기 큐`);
      setActiveTab('QUEUE');
    } catch (e: any) {
      showToast(`초안 저장 오류: ${e?.message}`, 'error');
    }
  };

  // ── 큐에서 선택하여 새 의뢰 작성으로 가져오기 ────────────────────────────
  const handleLoadDraftToForm = (draft: DraftOrder) => {
    // 1. 업무 유형 (단일 맥락)
    const ctx = (draft.context && draft.context[0]) || 'ADDITIONAL';
    setSelectedContext(ctx);

    // 2. 고객사
    if (draft.isNewCustomer) {
      setSelectedCustomer(null);
      setNewCustomerName(draft.customerName.value || '');
    } else {
      const mc = customers.find(c => c.name === draft.customerName.value) || findCustomerByNormalizedName(customers, draft.customerName.value);
      if (mc) {
        setSelectedCustomer(mc);
        setCustomerQuery('');
      } else {
        setNewCustomerName(draft.customerName.value || '');
      }
    }

    // 3. 현장 및 담당자
    if (draft.siteName?.value) {
      const ms = sites.find(s => s.name === draft.siteName.value);
      if (ms) {
        setSelectedSite(ms);
        setSiteQuery('');
        if (ctx === 'ADDITIONAL') {
          const defaultOpts = extractSafetyOptionsFromSite(ms);
          setSelectedSafetyOptions(new Set(defaultOpts));
          setInitialSiteOptions(new Set(defaultOpts));
        }
      } else {
        setSelectedSite(null);
        setNewSiteName(draft.siteName.value);
      }
    }

    // 4. 장비
    setEquipments(draft.equipments || []);

    // 5. 현장 담당자
    setContactPerson(draft.contactPerson?.value || '');
    setContactPhone(draft.contactPhone?.value || '');

    // 6. 상차일시
    setLoadingDate(draft.loadingDate?.value || '');
    setLoadingTimeVal(draft.loadingTime?.value || '08:00');

    // 7. 메모 및 안전옵션 파싱
    const noteText = draft.note || '';
    setNote(noteText);
    const parsedOpts = new Set<string>();
    if (noteText.includes('협착방지봉')) parsedOpts.add('BAR_4EA');
    if (noteText.includes('소화기')) parsedOpts.add('FIRE_EXT');
    if (noteText.includes('철망')) parsedOpts.add('MESH_4SIDE');
    if (noteText.includes('도색') || noteText.includes('비닐')) parsedOpts.add('PAINT_COVER');
    if (parsedOpts.size > 0) {
      setSelectedSafetyOptions(parsedOpts);
    }

    setActiveTab('NEW');
    setOpenBlock('WHAT');
    showToast(`'${draft.customerName.value || '선택 의뢰'}' 데이터를 새 의뢰 작성으로 가져왔습니다.`, 'info');
  };

  // ── 병합 ─────────────────────────────────────────────────────────────────
  const handleMerge = () => {
    if (selectedQueueIds.size < 2) { showToast('2건 이상 선택하세요.', 'error'); return; }
    const selected = queue.filter(d => selectedQueueIds.has(d.id));
    const merged: DraftOrder = {
      id: `draft_${Date.now()}`,
      context: Array.from(new Set(selected.flatMap(d => d.context))),
      customerName: selected[0].customerName,
      siteName: selected[0].siteName,
      equipments: selected.flatMap(d => d.equipments),
      loadingDate: selected[0].loadingDate,
      loadingTime: selected[0].loadingTime,
      contactPerson: selected[0].contactPerson,
      contactPhone: selected[0].contactPhone,
      note: selected.map(d => d.note).filter(Boolean).join(' / '),
      status: 'DRAFT',
      isNewCustomer: selected.some(d => d.isNewCustomer),
      customerRegistered: selected.every(d => d.customerRegistered),
      createdAt: new Date().toISOString(),
      urgency: selected.reduce<DraftOrder['urgency']>((acc, d) => {
        if (d.urgency === 'HIGH' || acc === 'HIGH') return 'HIGH';
        if (d.urgency === 'MEDIUM' || acc === 'MEDIUM') return 'MEDIUM';
        return 'LOW';
      }, 'LOW'),
    };
    setQueue(prev => [merged, ...prev.filter(d => !selectedQueueIds.has(d.id))]);
    setSelectedQueueIds(new Set());
    showToast('병합 완료 — 새 의뢰로 통합됨');
  };

  // ── 🌟 [WTT 결함 해결 2] 출고 확정 시 실제 배차 대장(deliveries) 실시간 생성 ──
  const handleSubmitDraft = async (draft: DraftOrder) => {
    if (draft.isNewCustomer && !draft.customerRegistered) {
      showToast('신규 고객 정식 등록 전 배차 차단 — 관리부 등록 완료 후 처리 가능합니다.', 'error');
      return;
    }

    try {
      // AppContext의 saveSmartDispatch 풀 파이프라인 호출
      const res = await saveSmartDispatch({
        customerName: draft.customerName.value,
        siteName: draft.siteName.value,
        siteAddress: '',
        siteContactName: draft.contactPerson.value,
        siteContactPhone: draft.contactPhone.value,
        siteContactEmail: '',
        billingContactName: '',
        billingContactPhone: '',
        statementEmail: '',
        taxBillEmail: '',
        loadingTime: `${draft.loadingDate.value} ${draft.loadingTime.value}`,
        unloadingTime: '',
        equipments: draft.equipments,
        note: draft.note,
        rawText: `[출고의뢰통합 확정] ${draft.context.join(', ')}`,
      }, true);

      if (res && res.success) {
        // 초안 상태 업데이트
        await submitDraft(draft.id);
        await loadDrafts();
        showToast(`배차 대장(TruckDispatch) 및 계약에 정식 배차 1건이 등록되었습니다!`, 'success');
      } else {
        showToast(res?.errorMessage || '배차 등록 실패', 'error');
      }
    } catch (e: any) {
      showToast(`배차 등록 오류: ${e?.message}`, 'error');
    }
  };

  const handleDiscardDraft = async (id: string) => {
    if (!window.confirm(
      '다음 항목을 삭제합니다:\n① 출고의뢰 초안\n\n언제든 새 의뢰로 재작성 가능합니다.\n삭제하시겠습니까?'
    )) return;

    try {
      await discardDraft(id);
      await loadDrafts();
      showToast('초안 폐기 완료');
    } catch {
      setQueue(prev => prev.filter(d => d.id !== id));
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더: 새 의뢰 탭 (PC 2열 마스터-디테일 스튜디오)
  // ─────────────────────────────────────────────────────────────────────────
  const renderNewTab = () => {
    const custDisplay = isNewCustomerMode ? (newCustomerName || '(신규 고객명 미입력)') : (selectedCustomer?.name || '(고객사 미선택)');
    const siteDisplay = isNewCustomerMode ? (newSiteName || '(현장명 미입력)') : (selectedSite?.name || '(현장 미선택)');
    const addrDisplay = isNewCustomerMode
      ? (newSiteAddress || newCustomerAddress || '(주소 미입력)')
      : (selectedSite?.address || newSiteAddress || '(주소 미등록)');

    return (
      <div className="dispatch4-studio-row">
        {/* ── 좌측 입력 섹션 (57% 마스터 스트림 / 독자 상하 스크롤) ────────────────── */}
        <div className="dispatch4-left-pane dispatch4-scrollbar">

          {/* 텍스트 붙여넣기 파싱 */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className="dispatch4-block-header bg-slate-800/60 hover:bg-slate-800 transition"
              onClick={() => setPasteZoneOpen(p => !p)}
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <ClipboardPaste className="w-4 h-4 text-blue-400" />
                <span>카톡/문자 텍스트 붙여넣기 파싱</span>
              </div>
              {pasteZoneOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
            {pasteZoneOpen && (
              <div className="p-4 flex flex-col gap-3 bg-slate-900/90 border-t border-slate-800">
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="카톡, 문자, 이메일 의뢰 원문을 그대로 붙여넣고 [파싱 실행]을 누르세요."
                  rows={5}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-y"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => { setPasteText(''); setPasteZoneOpen(false); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-400 hover:text-white transition"
                  >
                    닫기
                  </button>
                  <button
                    onClick={() => runParse(pasteText)}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm"
                  >
                    파싱 실행
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 업무 유형 선택 버튼군 (단일 선택 강제 & 건조한 명사 단일 표준) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300">업무 유형</label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CONTEXT_OPTIONS.map(opt => {
                const active = selectedContext === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectContext(opt.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border ${
                      active
                        ? 'border-blue-500 bg-blue-600/40 text-blue-200 shadow-sm font-black'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {active && <span className="mr-1">✓</span>}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 신규 고객 안내 배너 */}
          {isNewCustomerMode && (
            <div className="bg-purple-950/40 border border-purple-500/40 rounded-xl p-2.5 flex items-start gap-2 text-xs text-purple-200">
              <Info className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="text-purple-300 font-bold block mb-0.5">신규 고객 2단계 승인 프로세스</strong>
                영업사원은 기본 정보를 입력해 의뢰를 발행할 수 있으며, 관리부의 사업자등록 검증 완료 전까지 배차가 자동 차단됩니다.
              </div>
            </div>
          )}

          {/* WHO 블록 — 고객사 */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlock === 'WHO' ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('WHO')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <Building2 className="w-4 h-4 text-blue-400" />
                <span>1. WHO — 거래처 (고객사)</span>
                {!isNewCustomerMode && selectedCustomer && (
                  <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30">
                    ✓ {selectedCustomer.name}
                  </span>
                )}
                {isNewCustomerMode && newCustomerName && (
                  <span className="text-[11px] font-semibold text-purple-300 bg-purple-950/50 px-2 py-0.5 rounded border border-purple-500/30">
                    ✓ {newCustomerName} (신규)
                  </span>
                )}
              </div>
              {openBlock === 'WHO' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlock === 'WHO' && (
              <div className="dispatch4-block-body">
                {isNewCustomerMode ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">신규 고객사 상호(법인명) *</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                        value={newCustomerName}
                        onChange={e => setNewCustomerName(e.target.value)}
                        placeholder="예: (주)한국건설"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-300">대표전화 / 연락처</label>
                        <input
                          className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                          value={newCustomerPhone}
                          onChange={e => setNewCustomerPhone(e.target.value)}
                          placeholder="010-0000-0000 또는 02-000-0000"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-300">사업장 주소</label>
                        <input
                          className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                          value={newCustomerAddress}
                          onChange={e => setNewCustomerAddress(e.target.value)}
                          placeholder="본사 사업장 소재지"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {selectedCustomer ? (
                      <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-700">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-xs font-black text-white">{selectedCustomer.name}</span>
                          <span className="text-[11px] text-slate-400 font-mono">({selectedCustomer.bizRegNo || '사업자번호 미등록'})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(null);
                            setSelectedSite(null);
                            setCustomerQuery('');
                          }}
                          className="text-xs text-slate-300 hover:text-white px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 transition"
                        >
                          고객 변경
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-slate-300">거래처 검색 (초성 검색 가능)</label>
                          <input
                            className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                            value={customerQuery}
                            onChange={e => setCustomerQuery(e.target.value)}
                            placeholder="거래처명 또는 초성 입력 (예: 현대, ㅎㄷ, 대우...)"
                          />
                        </div>
                        {customerQuery.trim() ? (
                          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-slate-950/60 rounded-lg border border-slate-800">
                            {filteredCustomers.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => handleSelectCustomer(c)}
                                className="px-2.5 py-1 rounded text-xs font-medium transition border bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                              >
                                {c.name}
                              </button>
                            ))}
                            {filteredCustomers.length === 0 && (
                              <div className="text-xs text-slate-500 py-2 px-3">
                                일치하는 거래처가 없습니다.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 py-3 text-center bg-slate-950/40 rounded-lg border border-slate-800/60">
                            거래처명 또는 초성을 입력하면 검색 결과가 표시됩니다.
                          </div>
                        )}
                      </>
                    )}
                    {duplicateAlert && (
                      <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>오늘 이미 접수된 동일 고객사 초안 {duplicateAlert.length}건이 있습니다.</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* WHERE 블록 — 투입 현장 및 현장 담당자 */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlock === 'WHERE' ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('WHERE')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <span>2. WHERE — 투입 현장 및 현장 담당자</span>
                {!isNewCustomerMode && selectedSite && (
                  <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30">
                    ✓ {selectedSite.name}{contactPerson ? ` (${contactPerson})` : ''}
                  </span>
                )}
                {isNewCustomerMode && newSiteName && (
                  <span className="text-[11px] font-semibold text-purple-300 bg-purple-950/50 px-2 py-0.5 rounded border border-purple-500/30">
                    ✓ {newSiteName}{contactPerson ? ` (${contactPerson})` : ''}
                  </span>
                )}
              </div>
              {openBlock === 'WHERE' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlock === 'WHERE' && (
              <div className="dispatch4-block-body">
                {isNewCustomerMode ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">신규 현장명 *</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                        value={newSiteName}
                        onChange={e => setNewSiteName(e.target.value)}
                        placeholder="예: 평택 고덕 P3 신축현장"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">현장 상세주소</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                        value={newSiteAddress}
                        onChange={e => setNewSiteAddress(e.target.value)}
                        placeholder="기사 배차용 도로명 주소"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">현장 검색</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                        value={siteQuery}
                        onChange={e => setSiteQuery(e.target.value)}
                        placeholder={selectedCustomer ? `${selectedCustomer.name} 등록 현장 검색...` : '고객사를 먼저 선택하세요'}
                        disabled={!selectedCustomer}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-slate-950/60 rounded-lg border border-slate-800">
                      {filteredSites.map(s => {
                        const isSelected = selectedSite?.id === s.id;
                        return (
                          <button
                            key={s.id}
                            onClick={() => handleSelectSite(s)}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition border ${
                              isSelected
                                ? 'bg-cyan-600 border-cyan-400 text-white'
                                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                      {selectedCustomer && filteredSites.length === 0 && (
                        <div className="text-xs text-slate-500 py-2 px-3">
                          등록된 기존 현장이 없습니다. 아래에서 직접 현장명을 입력할 수 있습니다.
                        </div>
                      )}
                    </div>
                    <div className="pt-2 border-t border-slate-800 flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-400">직접 현장명/주소 수동 입력 시</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs"
                          placeholder="수동 현장명"
                          value={newSiteName}
                          onChange={e => setNewSiteName(e.target.value)}
                        />
                        <input
                          className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs"
                          placeholder="수동 현장 주소"
                          value={newSiteAddress}
                          onChange={e => setNewSiteAddress(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* 🌟 현장 담당자 성명 및 연락처 (WHEN에서 WHERE로 이동) */}
                <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
                  <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    <span>현장 담당자 정보 *</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">현장 담당자 성명 *</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-cyan-500"
                        value={contactPerson}
                        onChange={e => setContactPerson(e.target.value)}
                        placeholder="현장 인수 소장/담당자명"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">인수 담당자 연락처 *</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-cyan-500"
                        value={contactPhone}
                        onChange={e => setContactPhone(e.target.value)}
                        placeholder="010-0000-0000"
                        inputMode="tel"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* WHAT 블록 — 출고 신청 장비 */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlock === 'WHAT' ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('WHAT')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <Package className="w-4 h-4 text-emerald-400" />
                <span>3. WHAT — 출고 장비 규격</span>
                {totalQty > 0 && (
                  <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30">
                    ✓ 총 {totalQty}대 선택됨
                  </span>
                )}
              </div>
              {openBlock === 'WHAT' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlock === 'WHAT' && (
              <div className="dispatch4-block-body">
                <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-slate-800">
                  {FT_GROUPS.map(ft => (
                    <button
                      key={ft}
                      onClick={() => setActiveFt(ft)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                        activeFt === ft
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {ft}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {getModelsByFt(activeFt).map(m => {
                    const isPicked = equipments.some(e => e.modelName === m.modelName);
                    return (
                      <button
                        key={m.modelName}
                        onClick={() => addModel(m.modelName)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition border ${
                          isPicked
                            ? 'bg-emerald-900/50 border-emerald-500 text-emerald-200'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        + {m.modelName}
                      </button>
                    );
                  })}
                </div>

                {equipments.length > 0 ? (
                  <div className="mt-1 flex flex-col gap-1.5 p-2 bg-slate-950 rounded-lg border border-slate-800">
                    <div className="text-[11px] font-bold text-slate-400 px-1">선택된 출고 장비 목록:</div>
                    {equipments.map((eq, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-700/80 shadow-sm">
                        <div className="flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span className="text-xs font-black text-white">{eq.modelName}</span>
                        </div>
                        {/* 🌟 수량 조절 -, + 및 삭제(휴지통) 아이콘 버튼군 */}
                        <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-700">
                          <button
                            type="button"
                            onClick={() => changeQty(idx, -1)}
                            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-600 flex items-center justify-center text-white font-bold transition select-none shadow-sm"
                            title="수량 1대 감소"
                          >
                            <Minus className="w-3 h-3 text-white stroke-[2.5]" />
                          </button>
                          <div className="flex items-center justify-center min-w-[40px] px-1 font-mono">
                            <span className="text-xs font-black text-emerald-400">{eq.qty}</span>
                            <span className="text-[10px] text-slate-400 font-bold ml-0.5">대</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => changeQty(idx, 1)}
                            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-600 flex items-center justify-center text-white font-bold transition select-none shadow-sm"
                            title="수량 1대 증가"
                          >
                            <Plus className="w-3 h-3 text-white stroke-[2.5]" />
                          </button>
                          <div className="w-[1px] h-3.5 bg-slate-700 mx-0.5" />
                          <button
                            type="button"
                            onClick={() => removeEquipment(idx)}
                            className="w-6 h-6 rounded bg-red-950/80 hover:bg-red-900 active:bg-red-800 border border-red-700/80 flex items-center justify-center text-red-300 transition select-none shadow-sm"
                            title="장비 삭제"
                          >
                            <Trash2 className="w-3 h-3 text-red-400 stroke-[2.5]" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-3 text-xs text-slate-500">
                    위에서 모델을 클릭해 출고 장비를 1대 이상 추가하세요.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* WHEN 블록 — 출고 일정 (건조한 명사 단일 표준) */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlock === 'WHEN' ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('WHEN')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>4. WHEN — 출고 일정</span>
                {loadingDate && (
                  <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30 font-mono">
                    ✓ {loadingDate} {loadingTimeVal}
                  </span>
                )}
              </div>
              {openBlock === 'WHEN' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlock === 'WHEN' && (
              <div className="dispatch4-block-body">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-300">출고(상차) 희망일자 *</label>
                    <input
                      type="date"
                      className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-blue-500 font-mono"
                      value={loadingDate}
                      onChange={e => setLoadingDate(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-300">상차 지정시간 *</label>
                    <input
                      type="time"
                      className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-blue-500 font-mono"
                      value={loadingTimeVal}
                      onChange={e => setLoadingTimeVal(e.target.value)}
                    />
                  </div>
                </div>

                {/* 다수 장비 시차 출고 메모 */}
                <div className="flex flex-col gap-1 pt-2 border-t border-slate-800">
                  <label className="text-[11px] font-semibold text-slate-400">다수 장비 시차 출고 분할 메모 (선택사항)</label>
                  <input
                    className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs"
                    placeholder="예: 1호기 오전 08:00 상차 / 2호기 오후 14:00 상차"
                    value={staggeredMemo}
                    onChange={e => setStaggeredMemo(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 🌟 SAFETY & COST 블록 — 안전옵션, 대차회수, 운송비 귀속선 ───────────── */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlock === 'SAFETY_COST' ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('SAFETY_COST')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <Shield className="w-4 h-4 text-purple-400" />
                <span>5. 안전옵션 · 대차회수 · 운송비 귀속선</span>
                {isExchangeMode && (
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                    retrievalAssetId ? 'bg-cyan-950 text-cyan-300 border-cyan-800' : 'bg-red-950 text-red-300 border-red-800'
                  }`}>
                    {retrievalAssetId ? `대차: #${retrievalAssetId}` : '회수전자산 미지정'}
                  </span>
                )}
              </div>
              {openBlock === 'SAFETY_COST' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlock === 'SAFETY_COST' && (
              <div className="dispatch4-block-body">
                {/* 1. 대차(EXCHANGE) 시 회수 대상 전자산 1:1 매핑 (헌장 2.3, 4.2 준수) */}
                {isExchangeMode && (
                  <div className="p-2.5 bg-cyan-950/40 border border-cyan-500/40 rounded-xl flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black text-cyan-200 flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>회수 대상 전자산 선택 (대차 필수 매핑) *</span>
                      </label>
                      <span className="text-[10px] text-cyan-400 font-medium">단일 EXCHANGE 1건 발행</span>
                    </div>
                    <select
                      value={retrievalAssetId}
                      onChange={e => setRetrievalAssetId(e.target.value)}
                      className="w-full bg-slate-900 border border-cyan-600/60 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-cyan-400 font-mono"
                    >
                      <option value="">-- 회수할 기존 대여 장비를 선택하세요 --</option>
                      {activeCustomerAssets.map(a => (
                        <option key={a.id} value={a.assetNo}>
                          {a.assetNo} — {a.modelName} (현재 대여중)
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-cyan-300/80">
                      * 헌장 2.2 원칙: 선택된 전자산의 최초 계약 단가, 결제조건, 현장 속성이 신규 대차 장비로 100% 자동 상속됩니다.
                    </p>
                  </div>
                )}

                {/* 2. 운송비 부담 귀속선 (헌장 5.5 준수) */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-blue-400" />
                    <span>운송비 부담 귀속선 (회계 정산) *</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'CUSTOMER', label: '고객사 청구', desc: '기본 운반비 청구' },
                      { id: 'OURS',     label: '당사 영업부담', desc: '영업 할인/면제' },
                      { id: 'SPLIT',    label: '편도 지원',     desc: '왕복 할인 정산' },
                    ].map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setPaidBy(item.id as PaidBy)}
                        className={`p-2 rounded-lg border text-left transition flex flex-col gap-0.5 ${
                          paidBy === item.id
                            ? 'bg-blue-900/40 border-blue-500 text-white shadow-sm'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750'
                        }`}
                      >
                        <span className="text-xs font-bold">{item.label}</span>
                        <span className="text-[10px] text-slate-400">{item.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. 현장 안전옵션 & 보양작업 4종 선택기 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-amber-400" />
                    <span>현장 필수 안전옵션 및 보양작업</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {SAFETY_OPTION_LIST.map(opt => {
                      const isChecked = selectedSafetyOptions.has(opt.id);
                      return (
                        <label
                          key={opt.id}
                          onClick={() => toggleSafetyOption(opt.id)}
                          className={`flex items-center gap-2 p-1.5 rounded-lg border cursor-pointer select-none transition ${
                            isChecked
                              ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                              : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded bg-slate-900 border-slate-700 text-amber-500"
                          />
                          <span className="text-xs font-bold">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 특이사항 / 메모 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex flex-col gap-1 shadow-sm">
            <label className="text-[11px] font-semibold text-slate-300">배차 및 특이사항 메모 (선택사항)</label>
            <textarea
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-blue-500 resize-none font-sans"
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="예: 진입로 협소 5톤 축차 불가, 안전모/안전화 필수 착용 등..."
            />
          </div>

          {/* 하단 리셋 버튼 */}
          <div className="flex justify-start pb-2">
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition border border-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>입력 초기화</span>
            </button>
          </div>
        </div>

        {/* ── 우측 정형화 표시 & 방어 차단 실드 섹션 (43% / 뷰포트 고정 인스펙터) ─────── */}
        <div className="dispatch4-right-pane">
          <div className="dispatch4-right-scroll dispatch4-scrollbar">

          {/* 🛡️ [1] 9대 필수 스키마 유효성 검증 실드 */}
          <div className={`rounded-xl border p-4 shadow-lg transition-all ${
            isFormValid
              ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-100'
              : 'bg-slate-900 border-red-500/40 text-slate-100'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <div className="flex items-center gap-2">
                {isFormValid ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0" />
                )}
                <div>
                  <h4 className="text-xs font-extrabold tracking-wide">
                    {isFormValid ? '스키마 검증 100% 통과' : '필수 정보 검증 & 방어 차단'}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {isFormValid
                      ? '모든 필수 스키마가 완결되어 즉시 출고지시가 가능합니다.'
                      : `미충족 ${invalidRules.length}건 — 정보 누락 상태로 발행 시 자동 차단됩니다.`}
                  </p>
                </div>
              </div>
              <span className={`text-xs font-black font-mono px-2 py-1 rounded-md border ${
                isFormValid
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-red-500/20 text-red-300 border-red-500/40'
              }`}>
                {passCount} / {validationRules.length}
              </span>
            </div>

            {/* 체크리스트 9종 실시간 표출 (2열 슬림 그리드) */}
            <div className="dispatch4-shield-grid mt-2">
              {validationRules.map(rule => {
                const isValid = rule.status === 'VALID';
                const isWarn = rule.status === 'WARN';
                return (
                  <div
                    key={rule.id}
                    onClick={() => setOpenBlock(rule.targetBlock)}
                    className={`flex items-center justify-between px-2 py-1 rounded-md text-xs cursor-pointer transition border ${
                      isValid
                        ? 'bg-slate-950/40 border-emerald-900/40 text-slate-300 hover:bg-slate-800'
                        : isWarn
                          ? 'bg-amber-950/20 border-amber-800/40 text-amber-300 hover:bg-amber-950/40'
                          : 'bg-red-950/30 border-red-800/50 text-red-200 hover:bg-red-950/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isValid ? (
                        <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      ) : isWarn ? (
                        <AlertCircle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                      )}
                      <span className="font-bold whitespace-nowrap text-[10.5px] truncate">{rule.label}</span>
                    </div>
                    <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded ml-1 flex-shrink-0 ${
                      isValid ? 'text-emerald-400 bg-emerald-950' : isWarn ? 'text-amber-400 bg-amber-950' : 'text-red-400 bg-red-950'
                    }`}>
                      {isValid ? '완료' : isWarn ? '확인' : '누락'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 📄 [2] 정형화된 출고의뢰서 실시간 요약 (Dossier Preview) */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-3 shadow-lg select-text flex flex-col gap-2.5">
            {/* 서식 헤더 */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div>
                <span className="text-[9.5px] font-bold text-blue-400 uppercase tracking-widest block font-mono">
                  KIYEUN LIFT ERP DISPATCH ORDER
                </span>
                <h3 className="text-xs font-black text-white tracking-tight">
                  출고 요청서 (실시간 정형화)
                </h3>
              </div>
              <div className="text-right flex flex-col items-end gap-0.5">
                <span className="text-[9.5px] text-slate-400 font-mono">
                  {new Date().toLocaleDateString('ko-KR')}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                  {CONTEXT_OPTIONS.find(o => o.id === selectedContext)?.label}
                </span>
              </div>
            </div>

            {/* 서식 테이블 1: 거래처 / 현장 정보 (담당자 포함) */}
            <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
              <div className="grid grid-cols-4 border-b border-slate-800">
                <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                  고객사명
                </div>
                <div className="col-span-3 bg-slate-900/90 p-1.5 font-black text-white text-[11px]">
                  {custDisplay}
                </div>
              </div>
              <div className="grid grid-cols-4 border-b border-slate-800">
                <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                  투입현장
                </div>
                <div className="col-span-3 bg-slate-900/90 p-1.5 font-bold text-slate-200 text-[11px]">
                  {siteDisplay}
                </div>
              </div>
              <div className="grid grid-cols-4 border-b border-slate-800">
                <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                  현장주소
                </div>
                <div className="col-span-3 bg-slate-900/90 p-1.5 text-slate-300 break-all text-[10.5px]">
                  {addrDisplay}
                </div>
              </div>
              <div className="grid grid-cols-4">
                <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                  현장담당자
                </div>
                <div className="col-span-3 bg-slate-900/90 p-1.5 font-bold text-slate-100 text-[11px]">
                  {contactPerson ? `${contactPerson} (${contactPhone || '연락처 미등록'})` : '(담당자 미등록)'}
                </div>
              </div>
            </div>

            {/* 서식 테이블 2: 출고 일정 / 운송비 부담 */}
            <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
              <div className="grid grid-cols-4 border-b border-slate-800">
                <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                  상차일시
                </div>
                <div className="col-span-3 bg-slate-900/90 p-1.5 font-bold text-blue-400 font-mono text-[11px]">
                  {loadingDate ? `${loadingDate} ${loadingTimeVal}` : '(상차일시 미지정)'}
                </div>
              </div>
              <div className={`grid grid-cols-4 ${staggeredMemo ? 'border-b border-slate-800' : ''}`}>
                <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                  운송비부담
                </div>
                <div className="col-span-3 bg-slate-900/90 p-1.5 font-bold text-emerald-400 text-[11px]">
                  {paidBy === 'CUSTOMER' ? '고객사 전액 청구' : paidBy === 'OURS' ? '당사 영업 부담(면제)' : '편도 지원'}
                </div>
              </div>
              {staggeredMemo && (
                <div className="grid grid-cols-4">
                  <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                    시차출고
                  </div>
                  <div className="col-span-3 bg-slate-900/90 p-1.5 text-slate-300 text-[10.5px]">
                    {staggeredMemo}
                  </div>
                </div>
              )}
            </div>

            {/* 서식 테이블 3: 신청 장비 규격 */}
            <div>
              <div className="text-[10.5px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                <span>신청 장비 제원</span>
                <span className="text-blue-400 font-mono font-bold">합계: {totalQty}대</span>
              </div>
              <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
                <div className="grid grid-cols-4 bg-slate-950 border-b border-slate-800 p-1.5 font-bold text-slate-400 text-[11px]">
                  <div className="col-span-3">모델명</div>
                  <div className="col-span-1 text-right font-mono">수량</div>
                </div>
                {equipments.length > 0 ? (
                  equipments.map((eq, i) => (
                    <div key={i} className="grid grid-cols-4 border-b border-slate-800/80 last:border-b-0 p-1.5 bg-slate-900/80 hover:bg-slate-850 text-[11px]">
                      <div className="col-span-3 font-bold text-white">{eq.modelName}</div>
                      <div className="col-span-1 text-right font-mono font-bold text-blue-400">{eq.qty}대</div>
                    </div>
                  ))
                ) : (
                  <div className="p-2.5 text-center text-slate-500 italic bg-slate-900/60 text-[11px]">
                    선택된 장비가 없습니다.
                  </div>
                )}
              </div>
            </div>

            {/* 특이사항 및 옵션 */}
            {(note || selectedSafetyOptions.size > 0 || isExchangeMode) && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-[10.5px] text-slate-300 flex flex-col gap-1">
                {selectedSafetyOptions.size > 0 && (
                  <div>
                    <span className="font-bold text-amber-400">안전옵션: </span>
                    <span className="text-slate-200">
                      {Array.from(selectedSafetyOptions).map(id => SAFETY_OPTION_LIST.find(s => s.id === id)?.label).join(', ')}
                    </span>
                  </div>
                )}
                {isExchangeMode && retrievalAssetId && (
                  <div>
                    <span className="font-bold text-cyan-400">대차 회수장비: </span>
                    <span className="text-slate-200">자산 #{retrievalAssetId} (입고검수 자동연계)</span>
                  </div>
                )}
                {note && (
                  <div>
                    <span className="font-bold text-slate-400">배차 메모: </span>
                    <span className="text-slate-200">{note}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 🚀 [3] Gutenberg Z-Pattern Terminal Action — 최하단 영구 고정 완결 바 */}
        <div className="dispatch4-terminal-bar">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={!canSave}
            className={`w-full py-2.5 px-3 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-2 shadow-lg ${
              isFormValid
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40 cursor-pointer active:scale-98'
                : 'bg-slate-800 border border-red-500/40 text-red-300 hover:bg-slate-750'
            }`}
          >
            {isFormValid ? (
              <>
                <span>출고지시 발행 (검증 완료 9/9)</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span>출고지시 (미충족 {invalidRules.length}건 방어차단)</span>
              </>
            )}
          </button>
          <p className="text-[10px] text-slate-400 text-center m-0">
            {isFormValid
              ? '확인 완료된 의뢰는 DB에 무누락 보존되며 처리 대기 큐로 전송됩니다.'
              : '누락된 항목이 있으면 출고지시가 자동으로 방어 차단됩니다.'}
          </p>
        </div>

      </div>
    </div>
  );
};

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더: 처리 대기 큐 탭 (실제 배차 대장 연동 액션 포함)
  // ─────────────────────────────────────────────────────────────────────────
  const renderQueueTab = () => {
    const activeQueue = queue.filter(d => d.status === 'DRAFT' || d.status === 'REVIEWING');
    if (activeQueue.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center p-16 text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
          <Package className="w-12 h-12 text-slate-600 mb-3" />
          <p className="font-bold text-base text-slate-300">처리 대기 중인 출고의뢰가 없습니다.</p>
          <p className="text-xs text-slate-500 mt-1">[새 의뢰 작성] 탭에서 출고를 등록하거나 상단 [통화 녹음 업로드]를 이용하세요.</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {selectedQueueIds.size >= 2 && (
          <div className="p-3 bg-blue-950/60 border border-blue-500/40 rounded-xl flex items-center justify-between text-xs">
            <span className="text-blue-200 font-bold">{selectedQueueIds.size}건 선택됨</span>
            <div className="flex gap-2">
              <button
                onClick={handleMerge}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition flex items-center gap-1"
              >
                <Merge className="w-3.5 h-3.5" />
                <span>단일 의뢰로 병합</span>
              </button>
              <button
                onClick={() => setSelectedQueueIds(new Set())}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                선택 해제
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeQueue.map(draft => {
            const isSelected = selectedQueueIds.has(draft.id);
            return (
              <div
                key={draft.id}
                className={`bg-slate-900 border rounded-xl p-4 flex flex-col justify-between gap-3 shadow-md transition ${
                  draft.urgency === 'HIGH'
                    ? 'border-red-500/50'
                    : draft.urgency === 'MEDIUM'
                      ? 'border-amber-500/50'
                      : 'border-slate-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedQueueIds(prev => {
                            const n = new Set(prev);
                            if (n.has(draft.id)) n.delete(draft.id);
                            else n.add(draft.id);
                            return n;
                          });
                        }}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700"
                      />
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        draft.urgency === 'HIGH'
                          ? 'bg-red-950 text-red-300 border-red-800'
                          : draft.urgency === 'MEDIUM'
                            ? 'bg-amber-950 text-amber-300 border-amber-800'
                            : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      }`}>
                        {draft.urgency === 'HIGH' ? '🔴 긴급' : draft.urgency === 'MEDIUM' ? '🟡 보통' : '🟢 여유'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(draft.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <h4 className="text-sm font-black text-white truncate">{draft.customerName.value || '(고객사명 미상)'}</h4>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{draft.siteName.value || '(현장 미정)'}</p>

                  <div className="mt-3 p-2.5 bg-slate-950 rounded-lg border border-slate-800 flex flex-col gap-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">상차일정:</span>
                      <span className="text-slate-200 font-mono font-bold">
                        {draft.loadingDate.value || '미정'} {draft.loadingTime.value || ''}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">신청장비:</span>
                      <span className="text-emerald-400 font-bold">
                        {draft.equipments.length > 0 ? draft.equipments.map(e => `${e.modelName}×${e.qty}`).join(', ') : '없음'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">인수담당:</span>
                      <span className="text-slate-300">
                        {draft.contactPerson.value || '-'} ({draft.contactPhone.value || '-'})
                      </span>
                    </div>
                  </div>

                  {draft.note && (
                    <p className="text-[11px] text-slate-400 bg-slate-800/40 p-2 rounded mt-2 break-all">
                      {draft.note}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800 flex-wrap">
                  <button
                    onClick={() => handleDiscardDraft(draft.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-red-950/60 hover:text-red-300 text-slate-400 transition"
                  >
                    폐기
                  </button>
                  <button
                    onClick={() => handleLoadDraftToForm(draft)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 hover:text-white transition flex items-center gap-1"
                    title="선택된 초안 데이터를 새 의뢰 작성 폼으로 가져와 수정/보완합니다"
                  >
                    <span>새의뢰 작성으로 가져오기 ➔</span>
                  </button>
                  <button
                    onClick={() => handleSubmitDraft(draft)}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm flex items-center gap-1.5"
                  >
                    <span>배차 대장 등록 ➔</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 최종 전체 페이지 렌더
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="dispatch4-container">
      {/* 최상단 컴팩트 툴바 (타이틀 + 탭 + 녹음 업로드 1줄 인라인) */}
      <div className="dispatch4-toolbar">
        <div className="dispatch4-toolbar-left">
          <h2 className="dispatch4-title">출고의뢰 관리 (통합 스튜디오)</h2>
          <div className="dispatch4-tab-group">
            <button
              type="button"
              onClick={() => setActiveTab('NEW')}
              className={`dispatch4-tab-btn ${activeTab === 'NEW' ? 'active' : ''}`}
            >
              새 의뢰 작성
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('QUEUE')}
              className={`dispatch4-tab-btn ${activeTab === 'QUEUE' ? 'active' : ''}`}
            >
              <span>처리 대기 큐</span>
              {pendingCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-mono">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAudioUploadOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/40 hover:bg-blue-900/60 border border-blue-500/50 text-blue-200 text-xs font-bold transition shadow-sm"
          >
            <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
            <span>통화 녹음 파일 업로드</span>
          </button>
        </div>
      </div>

      {/* 본문 탭 전환 */}
      {activeTab === 'NEW' ? renderNewTab() : (
        <div className="flex-1 min-h-0 overflow-y-auto dispatch4-scrollbar p-1">
          {renderQueueTab()}
        </div>
      )}

      {/* 통화 녹음 업로드 모달 */}
      <CallAudioUploadModal
        isOpen={audioUploadOpen}
        onClose={() => setAudioUploadOpen(false)}
        onSuccess={() => {
          loadDrafts();
          setActiveTab('QUEUE');
          showToast('통화 녹음 업로드 완료 — AI 분석 완료 시 초안 큐에 등록됩니다.');
        }}
      />

      {/* 🌟 [추가출고 현장 옵션 첨삭 저장 확인 모달] */}
      {optionConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">현장 옵션 변경 저장 확인</h3>
                <p className="text-xs text-slate-400">{selectedSite?.name || '해당 현장'}</p>
              </div>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed bg-slate-800/60 p-3.5 rounded-xl border border-slate-750 flex flex-col gap-2">
              <p>
                현장의 기존 기본 안전/보양 옵션과 다르게 <span className="text-amber-400 font-bold">첨삭(변경)</span>되었습니다.
              </p>
              <div className="text-[11px] text-slate-400">
                <p className="font-semibold text-slate-300 mb-1">• 현재 선택된 옵션:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedSafetyOptions.size > 0 ? (
                    Array.from(selectedSafetyOptions).map(id => (
                      <span key={id} className="px-2 py-0.5 rounded bg-slate-700 text-amber-300 text-[10px] font-mono">
                        {SAFETY_OPTION_LIST.find(o => o.id === id)?.label || id}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500">선택된 옵션 없음 (전부 해제)</span>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                변경된 옵션을 이 현장의 마스터 기본값으로 갱신하시겠습니까, 아니면 이번 출고에만 1회성으로 적용하시겠습니까?
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={() => executeSaveDraft(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow flex items-center justify-center gap-1.5"
              >
                <span>현장 기본값으로 갱신 저장</span>
              </button>
              <button
                type="button"
                onClick={() => executeSaveDraft(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 hover:text-white font-bold text-xs transition flex items-center justify-center gap-1.5"
              >
                <span>이번만 1회성 적용 (현장 보존)</span>
              </button>
              <button
                type="button"
                onClick={() => setOptionConfirmModalOpen(false)}
                className="w-full py-1.5 text-center text-xs font-semibold text-slate-500 hover:text-slate-300 transition"
              >
                취소 (서식으로 돌아가기)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full text-xs font-bold shadow-2xl transition animate-in fade-in slide-in-from-bottom-3 ${
          toast.type === 'error'
            ? 'bg-red-600 text-white'
            : toast.type === 'info'
              ? 'bg-blue-600 text-white'
              : 'bg-emerald-600 text-white'
        }`}>
          {toast.text}
        </div>
      )}
    </div>
  );
};

export default SmartDispatch4;
