// src/pages/smart_dispatch4.tsx
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ 출고의뢰 (통합) — smart_dispatch4  (2026-09-06)                         │
// │                                                                         │
// │ [설계 결정사항]                                                          │
// │  1. 맥락 유형 7종 칩 선택 (복합 가능)                                    │
// │  2. 처리 대기 큐 — 신호등(긴급/주의/여유) 우선순위                        │
// │  3. Review Mode — 🟢자동확정/🟡확인필요/🔴입력필요/⬜MISSING             │
// │  4. 음성 Mic 버튼 제거 (텍스트 파싱만 유지)                               │
// │  5. 신규고객 2단계 흐름 (관리부 등록 전 배차 차단)                         │
// │  6. 중복 접수 경보 (알림만, 각자 진행 가능)                                │
// └─────────────────────────────────────────────────────────────────────────┘
import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Customer, CustomerSite, findCustomerByNormalizedName } from '../services/db';
import { EQUIPMENT_SPEC_MATRIX } from '../services/voiceOrderDraftService';
import { matchHangul } from '../utils/hangulSearch';
import {
  Plus, Minus, Trash2, ChevronDown, ChevronUp,
  Building2, MapPin, Package, Calendar,
  ClipboardPaste, ArrowRight, Info, Merge
} from 'lucide-react';

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
  source: 'DB' | 'STT' | 'PARSED' | 'MANUAL' | 'SUMMARY';
  confirmed: boolean;
}

interface EquipmentItem { modelName: string; qty: number; }

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
}

type ActiveTab = 'NEW' | 'QUEUE';
type BlockId = 'WHO' | 'WHERE' | 'WHAT' | 'WHEN';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

const CONTEXT_OPTIONS: { id: CallContext; label: string; color: string }[] = [
  { id: 'NEW_CUSTOMER',    label: '신규고객 출고',    color: '#7c3aed' },
  { id: 'ADDITIONAL',      label: '추가 출고',        color: '#2563eb' },
  { id: 'EXCHANGE',        label: '교체(대차)',        color: '#0891b2' },
  { id: 'RETURN',          label: '회수 요청',        color: '#dc2626' },
  { id: 'FIELD_AS',        label: '현장 AS',          color: '#d97706' },
  { id: 'TRANSPORT_NEGO',  label: '운송사 배차 협의',  color: '#059669' },
  { id: 'SUBLEASE_NEGO',   label: '전대 임차 협의',   color: '#6b7280' },
];

const FT_GROUPS = Array.from(new Set(EQUIPMENT_SPEC_MATRIX.map(i => i.ft)))
  .sort((a, b) => parseInt(a) - parseInt(b));

const getModelsByFt = (ft: string) => EQUIPMENT_SPEC_MATRIX.filter(i => i.ft === ft);

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

const UrgencyBadge: React.FC<{ urgency: DraftOrder['urgency'] }> = ({ urgency }) => {
  const map = {
    HIGH:   { dot: '🔴', label: '긴급', bg: '#fee2e2', color: '#dc2626' },
    MEDIUM: { dot: '🟡', label: '주의', bg: '#fef9c3', color: '#ca8a04' },
    LOW:    { dot: '🟢', label: '여유', bg: '#dcfce7', color: '#16a34a' },
  };
  const m = map[urgency];
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px',
      backgroundColor: m.bg, color: m.color, whiteSpace: 'nowrap'
    }}>
      {m.dot} {m.label}
    </span>
  );
};

const ConfidenceBadge: React.FC<{ field: ScoredField }> = ({ field }) => {
  const map: Record<ConfidenceLevel, { icon: string; color: string; label: string }> = {
    HIGH:    { icon: '🟢', color: '#16a34a', label: '자동확정' },
    MEDIUM:  { icon: '🟡', color: '#ca8a04', label: '확인필요' },
    LOW:     { icon: '🔴', color: '#dc2626', label: '입력필요' },
    MISSING: { icon: '⬜', color: '#6b7280', label: 'MISSING' },
  };
  const sourceLabelMap: Record<ScoredField['source'], string> = {
    DB: 'DB매칭', STT: 'STT추출', PARSED: '파싱', MANUAL: '수동', SUMMARY: '요약'
  };
  const m = map[field.confidence];
  return (
    <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <span style={{ fontSize: '11px', color: m.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.icon} {m.label}</span>
      <span style={{
        fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
        backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb', whiteSpace: 'nowrap'
      }}>
        {sourceLabelMap[field.source]}
      </span>
    </span>
  );
};

const ContextBadge: React.FC<{ ctx: CallContext }> = ({ ctx }) => {
  const opt = CONTEXT_OPTIONS.find(o => o.id === ctx);
  if (!opt) return null;
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px',
      backgroundColor: `${opt.color}18`, color: opt.color,
      border: `1px solid ${opt.color}40`, whiteSpace: 'nowrap'
    }}>
      {opt.label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────
const makeScoredField = (value: string, source: ScoredField['source'] = 'MANUAL'): ScoredField => ({
  value, source, confirmed: false,
  confidence: value ? 'MEDIUM' : 'MISSING',
});

const calcUrgency = (loadingDate: string): DraftOrder['urgency'] => {
  if (!loadingDate) return 'LOW';
  const diff = Math.floor((new Date(loadingDate).getTime() - Date.now()) / 86400000);
  if (diff <= 1) return 'HIGH';
  if (diff <= 3) return 'MEDIUM';
  return 'LOW';
};

const genId = () => `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export const SmartDispatch4: React.FC = () => {
  const {
    hasPermission, customers, sites, contacts, contracts,
    users
  } = useApp();

  const canSave = hasPermission('delivery', 'save');

  // ── 탭 ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('NEW');

  // ── 토스트 ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── 처리 대기 큐 ──────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<DraftOrder[]>([]);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);

  const sortedQueue = useMemo(() =>
    [...queue].sort((a, b) => {
      const urgOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (urgOrder[a.urgency] !== urgOrder[b.urgency]) return urgOrder[a.urgency] - urgOrder[b.urgency];
      return a.loadingDate.value.localeCompare(b.loadingDate.value);
    }), [queue]);

  const pendingCount = queue.filter(q => q.status === 'DRAFT').length;

  // ── 맥락 선택 ─────────────────────────────────────────────────────────────
  const [selectedContexts, setSelectedContexts] = useState<Set<CallContext>>(new Set(['ADDITIONAL']));

  const toggleContext = (ctx: CallContext) => {
    setSelectedContexts(prev => {
      const next = new Set(prev);
      if (next.has(ctx)) { next.delete(ctx); } else { next.add(ctx); }
      return next;
    });
  };

  const isNewCustomerMode = selectedContexts.has('NEW_CUSTOMER');

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

  const filteredCustomers = useMemo(() => {
    if (!customerQuery.trim()) return customers.slice(0, 20);
    return customers.filter(c => matchHangul(c.name, customerQuery)).slice(0, 20);
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

  // ── WHERE 블록 — 현장 ─────────────────────────────────────────────────────
  const [siteQuery, setSiteQuery] = useState('');
  const [selectedSite, setSelectedSite] = useState<CustomerSite | null>(null);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteAddress, setNewSiteAddress] = useState('');

  const filteredSites = useMemo(() => {
    const base = selectedCustomer
      ? sites.filter(s => s.customerId === selectedCustomer.id)
      : sites;
    if (!siteQuery.trim()) return base.slice(0, 20);
    return base.filter(s => matchHangul(s.name, siteQuery)).slice(0, 20);
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
  const totalQty = equipments.reduce((s, e) => s + e.qty, 0);

  // ── WHEN 블록 — 일정 ──────────────────────────────────────────────────────
  const [loadingDate, setLoadingDate] = useState('');
  const [loadingTimeVal, setLoadingTimeVal] = useState('08:00');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');

  // DB 상속
  const applyInheritance = useCallback((cust: Customer | null, site: CustomerSite | null) => {
    if (!cust) return;
    if (site?.contactName && site.contactName !== '미상') setContactPerson(site.contactName);
    if (site?.contact && site.contact !== '미상') setContactPhone(site.contact);
    const custContacts = contacts.filter(ct => ct.customerId === cust.id);
    if (custContacts.length > 0 && !contactPerson) {
      const sc = custContacts.find(ct => ct.position?.includes('현장') || ct.position?.includes('소장')) || custContacts[0];
      if (sc?.contact && sc.contact !== '미상') setContactPhone(sc.contact);
      if (sc?.name) setContactPerson(sc.name);
    }
  }, [contacts, contactPerson]);

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
    setOpenBlock('WHAT');
  };

  // ── 붙여넣기 파싱 ─────────────────────────────────────────────────────────
  const runParse = useCallback((text: string) => {
    if (!text.trim()) { showToast('텍스트를 입력하세요.', 'error'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const extractPhone = (s: string) => (s.match(/(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g) || [''])[0].replace(/\s+/g, '');
    const extractName = (s: string) => s.split(/01[016789]/)[0].replace(/[:\-]/g, '').replace(/선임|책임|담당자|소장|부장|팀장/g, '').trim();

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
        raw.split(/[\/,]/).forEach(p => {
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

    setPasteText('');
    setPasteZoneOpen(false);
    showToast('파싱 완료');
  }, [customers, sites, applyInheritance, showToast]);

  // ── 폼 초기화 ─────────────────────────────────────────────────────────────
  const resetForm = () => {
    setSelectedCustomer(null); setSelectedSite(null);
    setCustomerQuery(''); setSiteQuery('');
    setEquipments([]); setLoadingDate(''); setLoadingTimeVal('08:00');
    setContactPerson(''); setContactPhone(''); setNote('');
    setNewCustomerName(''); setNewCustomerPhone(''); setNewCustomerAddress('');
    setNewSiteName(''); setNewSiteAddress('');
    setSelectedContexts(new Set(['ADDITIONAL']));
    setOpenBlock('WHO');
  };

  // ── 출고 지시 (초안 큐 저장) ──────────────────────────────────────────────
  const handleSaveDraft = () => {
    if (selectedContexts.size === 0) { showToast('맥락 유형을 하나 이상 선택하세요.', 'error'); return; }
    if (isNewCustomerMode && !newCustomerName.trim()) { showToast('신규 고객사명을 입력하세요.', 'error'); return; }
    if (!isNewCustomerMode && !selectedCustomer) { showToast('고객사를 선택하세요.', 'error'); return; }
    const skipEquipCheck = selectedContexts.has('RETURN') || selectedContexts.has('FIELD_AS') ||
      selectedContexts.has('TRANSPORT_NEGO') || selectedContexts.has('SUBLEASE_NEGO');
    if (!skipEquipCheck && equipments.length === 0) { showToast('장비를 하나 이상 추가하세요.', 'error'); return; }

    const newDrafts: DraftOrder[] = Array.from(selectedContexts).map(ctx => {
      const siteConf: ConfidenceLevel = selectedSite ? 'HIGH' : 'MISSING';
      const siteSrc: ScoredField['source'] = selectedSite ? 'DB' : 'MANUAL';
      const loadConf: ConfidenceLevel = loadingDate ? 'HIGH' : 'MISSING';
      const timeConf: ConfidenceLevel = loadingTimeVal ? 'HIGH' : 'MISSING';
      return {
        id: genId(),
        context: [ctx],
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
        contactPhone: makeScoredField(contactPhone),
        note,
        status: 'DRAFT' as const,
        isNewCustomer: isNewCustomerMode,
        customerRegistered: !isNewCustomerMode,
        createdAt: new Date().toISOString(),
        urgency: calcUrgency(loadingDate),
      };
    });

    setQueue(prev => [...prev, ...newDrafts]);
    resetForm();
    showToast(`의뢰 초안 ${newDrafts.length}건 저장됨 → 처리 대기 큐`);
    setActiveTab('QUEUE');
  };

  // ── 병합 ─────────────────────────────────────────────────────────────────
  const handleMerge = () => {
    if (selectedQueueIds.size < 2) { showToast('2건 이상 선택하세요.', 'error'); return; }
    const selected = queue.filter(d => selectedQueueIds.has(d.id));
    const merged: DraftOrder = {
      id: genId(),
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

  // ── 제출 / 폐기 ──────────────────────────────────────────────────────────
  const handleSubmitDraft = (draft: DraftOrder) => {
    if (draft.isNewCustomer && !draft.customerRegistered) {
      showToast('신규 고객 정식 등록 전 배차 차단 — 관리부 등록 완료 후 처리 가능합니다.', 'error'); return;
    }
    setQueue(prev => prev.map(d => d.id === draft.id ? { ...d, status: 'SUBMITTED' } : d));
    showToast(`의뢰 제출 완료 (${draft.customerName.value})`);
  };

  const handleDiscardDraft = (id: string) => {
    if (!window.confirm(
      '다음 항목을 삭제합니다:\n① 출고의뢰 초안\n\n언제든 새 의뢰로 재작성 가능합니다.\n삭제하시겠습니까?'
    )) return;
    setQueue(prev => prev.map(d => d.id === id ? { ...d, status: 'DISCARDED' } : d));
    showToast('초안 폐기 완료');
  };

  // ── 공통 스타일 ───────────────────────────────────────────────────────────
  const S = {
    page: { padding: '12px 16px', maxWidth: '540px', margin: '0 auto', fontFamily: 'var(--font-sans, sans-serif)' } as React.CSSProperties,
    tabBar: { display: 'flex', borderBottom: '2px solid var(--border, #e5e7eb)', marginBottom: '16px' } as React.CSSProperties,
    tab: (active: boolean): React.CSSProperties => ({
      padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
      fontWeight: active ? 700 : 400, fontSize: '14px',
      color: active ? 'var(--primary, #2563eb)' : 'var(--text-muted, #6b7280)',
      borderBottom: active ? '2px solid var(--primary, #2563eb)' : '2px solid transparent',
      marginBottom: '-2px', whiteSpace: 'nowrap',
    }),
    block: { border: '1px solid var(--border, #e5e7eb)', borderRadius: '10px', marginBottom: '10px', overflow: 'hidden' } as React.CSSProperties,
    blockHeader: (open: boolean): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
      backgroundColor: open ? 'var(--primary-bg, #eff6ff)' : 'var(--surface, #fafafa)',
    }),
    blockTitle: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' } as React.CSSProperties,
    blockBody: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' } as React.CSSProperties,
    label: { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted, #6b7280)', whiteSpace: 'nowrap' } as React.CSSProperties,
    fieldStack: { display: 'flex', flexDirection: 'column', gap: '4px' } as React.CSSProperties,
    input: {
      width: '100%', padding: '8px 10px', fontSize: '14px',
      border: '1px solid var(--border, #d1d5db)', borderRadius: '7px',
      background: 'var(--surface-input, #fff)', boxSizing: 'border-box',
    } as React.CSSProperties,
    chipGrid: { display: 'flex', flexWrap: 'wrap', gap: '6px' } as React.CSSProperties,
    chip: (active: boolean, color?: string): React.CSSProperties => ({
      padding: '5px 11px', borderRadius: '16px',
      border: `1px solid ${active && color ? color : 'var(--border, #d1d5db)'}`,
      background: active && color ? `${color}18` : 'var(--surface, #f9fafb)',
      color: active && color ? color : 'var(--text, #374151)',
      fontWeight: active ? 700 : 400, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
    }),
    btnPrimary: {
      padding: '10px 18px', borderRadius: '8px', border: 'none',
      background: 'var(--primary, #2563eb)', color: '#fff',
      fontWeight: 700, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap',
    } as React.CSSProperties,
    btnDanger: {
      padding: '6px 12px', borderRadius: '8px', border: '1px solid #dc2626',
      background: '#fff', color: '#dc2626',
      fontWeight: 600, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
    } as React.CSSProperties,
    btnGhost: {
      padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)',
      background: 'var(--surface, #fafafa)', color: 'var(--text, #374151)',
      fontWeight: 600, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
    } as React.CSSProperties,
    queueCard: (urgency: DraftOrder['urgency']): React.CSSProperties => ({
      border: `1px solid ${urgency === 'HIGH' ? '#fca5a5' : urgency === 'MEDIUM' ? '#fde68a' : '#d1d5db'}`,
      borderRadius: '10px', marginBottom: '8px', overflow: 'hidden',
      background: urgency === 'HIGH' ? '#fff7f7' : urgency === 'MEDIUM' ? '#fffdf0' : '#fff',
    }),
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더: 새 의뢰 탭
  // ─────────────────────────────────────────────────────────────────────────
  const renderNewTab = () => (
    <div>
      {/* 텍스트 파싱 */}
      <div style={S.block}>
        <div style={S.blockHeader(pasteZoneOpen)} onClick={() => setPasteZoneOpen(p => !p)}>
          <span style={S.blockTitle}><ClipboardPaste size={15} />텍스트 붙여넣기 파싱</span>
          {pasteZoneOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
        {pasteZoneOpen && (
          <div style={S.blockBody}>
            <textarea
              value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder="카톡/문자/메일 내용 붙여넣기 후 [파싱 실행]"
              rows={6}
              style={{ ...S.input, resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={S.btnPrimary} onClick={() => runParse(pasteText)}>파싱 실행</button>
              <button style={S.btnGhost} onClick={() => { setPasteText(''); setPasteZoneOpen(false); }}>닫기</button>
            </div>
          </div>
        )}
      </div>

      {/* 맥락 유형 칩 */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ ...S.label, marginBottom: '6px' }}>맥락 유형 (복합 선택 가능)</div>
        <div style={S.chipGrid}>
          {CONTEXT_OPTIONS.map(opt => (
            <button key={opt.id} style={S.chip(selectedContexts.has(opt.id), opt.color)} onClick={() => toggleContext(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>
        {selectedContexts.size > 1 && (
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            복합 맥락: 의뢰 {selectedContexts.size}건이 동시 생성됩니다.
          </div>
        )}
      </div>

      {/* 신규 고객 안내 */}
      {isNewCustomerMode && (
        <div style={{
          background: '#f3e8ff', border: '1px solid #c4b5fd', borderRadius: '8px',
          padding: '10px 12px', fontSize: '13px', color: '#7c3aed',
          display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '10px',
        }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>
            <strong>신규 고객 2단계 흐름</strong><br />
            1단계: 기본 정보 입력 (영업사원)<br />
            2단계: 관리부 정식 등록 → 완료 후 배차 가능
          </div>
        </div>
      )}

      {/* WHO 블록 */}
      <div style={S.block}>
        <div style={S.blockHeader(openBlock === 'WHO')} onClick={() => toggleBlock('WHO')}>
          <span style={S.blockTitle}>
            <Building2 size={15} />WHO — 고객사
            {!isNewCustomerMode && selectedCustomer && <span style={{ fontWeight: 400, color: '#2563eb', fontSize: '13px' }}>✓ {selectedCustomer.name}</span>}
            {isNewCustomerMode && newCustomerName && <span style={{ fontWeight: 400, color: '#7c3aed', fontSize: '13px' }}>✓ {newCustomerName} (신규)</span>}
          </span>
          {openBlock === 'WHO' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
        {openBlock === 'WHO' && (
          <div style={S.blockBody}>
            {isNewCustomerMode ? (
              <>
                <div style={S.fieldStack}>
                  <label style={S.label}>고객사명 *</label>
                  <input style={S.input} value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} placeholder="고객사명 입력" />
                </div>
                <div style={S.fieldStack}>
                  <label style={S.label}>연락처</label>
                  <input style={S.input} value={newCustomerPhone} onChange={e => setNewCustomerPhone(e.target.value)} placeholder="010-0000-0000" inputMode="tel" />
                </div>
                <div style={S.fieldStack}>
                  <label style={S.label}>주소</label>
                  <input style={S.input} value={newCustomerAddress} onChange={e => setNewCustomerAddress(e.target.value)} placeholder="주소" />
                </div>
                <div style={{ fontSize: '12px', color: '#7c3aed', background: '#f3e8ff', borderRadius: '6px', padding: '7px 10px' }}>
                  ⚠ 관리부 정식 등록 전까지 배차 차단됩니다.
                </div>
              </>
            ) : (
              <>
                <div style={S.fieldStack}>
                  <label style={S.label}>고객사 검색</label>
                  <input style={S.input} value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} placeholder="초성 검색 가능" />
                </div>
                <div style={S.chipGrid}>
                  {filteredCustomers.map(c => (
                    <button key={c.id} style={S.chip(selectedCustomer?.id === c.id, '#2563eb')} onClick={() => handleSelectCustomer(c)}>
                      {c.name}
                    </button>
                  ))}
                </div>
                {duplicateAlert && (
                  <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: '7px', padding: '8px 10px', fontSize: '12px', color: '#92400e' }}>
                    ⚠ <strong>중복 접수 경보:</strong> 오늘 이미 {duplicateAlert.length}건의 초안이 있습니다. 각자 진행 가능합니다.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* WHERE 블록 */}
      <div style={S.block}>
        <div style={S.blockHeader(openBlock === 'WHERE')} onClick={() => toggleBlock('WHERE')}>
          <span style={S.blockTitle}>
            <MapPin size={15} />WHERE — 현장
            {!isNewCustomerMode && selectedSite && <span style={{ fontWeight: 400, color: '#2563eb', fontSize: '13px' }}>✓ {selectedSite.name}</span>}
            {isNewCustomerMode && newSiteName && <span style={{ fontWeight: 400, color: '#7c3aed', fontSize: '13px' }}>✓ {newSiteName}</span>}
          </span>
          {openBlock === 'WHERE' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
        {openBlock === 'WHERE' && (
          <div style={S.blockBody}>
            {isNewCustomerMode ? (
              <>
                <div style={S.fieldStack}>
                  <label style={S.label}>현장명</label>
                  <input style={S.input} value={newSiteName} onChange={e => setNewSiteName(e.target.value)} placeholder="현장명" />
                </div>
                <div style={S.fieldStack}>
                  <label style={S.label}>현장 주소</label>
                  <input style={S.input} value={newSiteAddress} onChange={e => setNewSiteAddress(e.target.value)} placeholder="현장 주소" />
                </div>
              </>
            ) : (
              <>
                <div style={S.fieldStack}>
                  <label style={S.label}>현장 검색</label>
                  <input style={S.input} value={siteQuery} onChange={e => setSiteQuery(e.target.value)}
                    placeholder={selectedCustomer ? `${selectedCustomer.name} 현장 검색` : '고객사 먼저 선택'}
                    disabled={!selectedCustomer} />
                </div>
                <div style={S.chipGrid}>
                  {filteredSites.map(s => (
                    <button key={s.id} style={S.chip(selectedSite?.id === s.id, '#0891b2')} onClick={() => handleSelectSite(s)}>
                      {s.name}
                    </button>
                  ))}
                  {selectedCustomer && filteredSites.length === 0 && (
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>등록된 현장 없음</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* WHAT 블록 */}
      <div style={S.block}>
        <div style={S.blockHeader(openBlock === 'WHAT')} onClick={() => toggleBlock('WHAT')}>
          <span style={S.blockTitle}>
            <Package size={15} />WHAT — 장비
            {totalQty > 0 && <span style={{ fontWeight: 400, color: '#2563eb', fontSize: '13px' }}>✓ 총 {totalQty}대</span>}
          </span>
          {openBlock === 'WHAT' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
        {openBlock === 'WHAT' && (
          <div style={S.blockBody}>
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
              {FT_GROUPS.map(ft => (
                <button key={ft} style={S.chip(activeFt === ft, '#2563eb')} onClick={() => setActiveFt(ft)}>{ft}</button>
              ))}
            </div>
            <div style={S.chipGrid}>
              {getModelsByFt(activeFt).map(item => (
                <button key={item.modelName} style={S.chip(equipments.some(e => e.modelName === item.modelName), '#2563eb')} onClick={() => addModel(item.modelName)}>
                  {item.modelName}
                </button>
              ))}
            </div>
            {equipments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {equipments.map((eq, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0f9ff', borderRadius: '7px', padding: '7px 10px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{eq.modelName}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button style={{ ...S.btnGhost, padding: '3px 8px' }} onClick={() => changeQty(idx, -1)}><Minus size={12} /></button>
                      <span style={{ fontWeight: 700, minWidth: '24px', textAlign: 'center' }}>{eq.qty}</span>
                      <button style={{ ...S.btnGhost, padding: '3px 8px' }} onClick={() => changeQty(idx, 1)}><Plus size={12} /></button>
                      <button style={{ ...S.btnDanger, padding: '3px 7px' }} onClick={() => changeQty(idx, -eq.qty)}><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* WHEN 블록 */}
      <div style={S.block}>
        <div style={S.blockHeader(openBlock === 'WHEN')} onClick={() => toggleBlock('WHEN')}>
          <span style={S.blockTitle}>
            <Calendar size={15} />WHEN — 일정
            {loadingDate && <span style={{ fontWeight: 400, color: '#2563eb', fontSize: '13px' }}>✓ {loadingDate} {loadingTimeVal}</span>}
          </span>
          {openBlock === 'WHEN' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
        {openBlock === 'WHEN' && (
          <div style={S.blockBody}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ ...S.fieldStack, flex: 1, minWidth: '140px' }}>
                <label style={S.label}>출고일</label>
                <input type="date" style={S.input} value={loadingDate} onChange={e => setLoadingDate(e.target.value)} />
              </div>
              <div style={{ ...S.fieldStack, flex: 1, minWidth: '110px' }}>
                <label style={S.label}>상차 시간</label>
                <input type="time" style={S.input} value={loadingTimeVal} onChange={e => setLoadingTimeVal(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ ...S.fieldStack, flex: 1, minWidth: '140px' }}>
                <label style={S.label}>담당자</label>
                <input style={S.input} value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="현장 담당자명" />
              </div>
              <div style={{ ...S.fieldStack, flex: 1, minWidth: '140px' }}>
                <label style={S.label}>연락처</label>
                <input style={S.input} value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="010-0000-0000" inputMode="tel" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 특이사항 */}
      <div style={{ ...S.fieldStack, marginBottom: '14px' }}>
        <label style={S.label}>특이사항</label>
        <textarea style={{ ...S.input, resize: 'vertical', minHeight: '60px' }} value={note} onChange={e => setNote(e.target.value)} placeholder="특이사항 (선택)" rows={2} />
      </div>

      {/* 출고 지시 */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button style={S.btnGhost} onClick={resetForm}>초기화</button>
        <button style={{ ...S.btnPrimary, opacity: canSave ? 1 : 0.5 }} onClick={handleSaveDraft} disabled={!canSave}>
          출고 지시 →
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더: 처리 대기 탭
  // ─────────────────────────────────────────────────────────────────────────
  const renderQueueTab = () => {
    const activeQueue = sortedQueue.filter(d => d.status !== 'DISCARDED' && d.status !== 'SUBMITTED');
    return (
      <div>
        {activeQueue.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: '14px' }}>
            처리 대기 중인 의뢰 없음
          </div>
        )}
        {selectedQueueIds.size > 0 && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '8px',
            padding: '8px 12px', marginBottom: '10px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1d4ed8' }}>{selectedQueueIds.size}건 선택됨</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {selectedQueueIds.size >= 2 && (
                <button style={{ ...S.btnGhost, fontSize: '12px', padding: '5px 10px' }} onClick={handleMerge}>
                  <Merge size={13} style={{ display: 'inline', marginRight: '4px' }} />병합하기
                </button>
              )}
              <button style={{ ...S.btnPrimary, fontSize: '12px', padding: '5px 10px' }}
                onClick={() => {
                  Array.from(selectedQueueIds).forEach(id => {
                    const d = queue.find(q => q.id === id);
                    if (d) handleSubmitDraft(d);
                  });
                  setSelectedQueueIds(new Set());
                }}>
                각각 처리
              </button>
              <button style={{ ...S.btnGhost, fontSize: '12px', padding: '5px 10px' }} onClick={() => setSelectedQueueIds(new Set())}>
                선택 해제
              </button>
            </div>
          </div>
        )}
        {activeQueue.map(draft => {
          const isExpanded = expandedDraftId === draft.id;
          const isSelected = selectedQueueIds.has(draft.id);
          return (
            <div key={draft.id} style={S.queueCard(draft.urgency)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', cursor: 'pointer' }}
                onClick={() => setExpandedDraftId(isExpanded ? null : draft.id)}>
                <input type="checkbox" checked={isSelected}
                  onChange={e => {
                    e.stopPropagation();
                    setSelectedQueueIds(prev => { const n = new Set(prev); if (n.has(draft.id)) n.delete(draft.id); else n.add(draft.id); return n; });
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '15px', height: '15px', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '3px' }}>
                    {draft.context.map(ctx => <ContextBadge key={ctx} ctx={ctx} />)}
                    <UrgencyBadge urgency={draft.urgency} />
                    {draft.isNewCustomer && !draft.customerRegistered && (
                      <span style={{ fontSize: '10px', background: '#f3e8ff', color: '#7c3aed', border: '1px solid #c4b5fd', borderRadius: '8px', padding: '1px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        신규(등록대기)
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {draft.customerName.value}
                    {draft.siteName.value && draft.siteName.value !== '미정' && (
                      <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '13px' }}> · {draft.siteName.value}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {draft.loadingDate.value && <span>📅 {draft.loadingDate.value} {draft.loadingTime.value}</span>}
                    {draft.equipments.length > 0 && <span>🏗 {draft.equipments.map(e => `${e.modelName}×${e.qty}`).join(', ')}</span>}
                  </div>
                </div>
                {isExpanded ? <ChevronUp size={15} style={{ flexShrink: 0 }} /> : <ChevronDown size={15} style={{ flexShrink: 0 }} />}
              </div>
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#fafafa' }}>
                  {[
                    { label: '고객사', field: draft.customerName },
                    { label: '현장', field: draft.siteName },
                    { label: '출고일', field: draft.loadingDate },
                    { label: '상차 시간', field: draft.loadingTime },
                    { label: '담당자', field: draft.contactPerson },
                    { label: '연락처', field: draft.contactPhone },
                  ].map(({ label, field }) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={S.label}>{label}</span>
                        <ConfidenceBadge field={field} />
                      </div>
                      <div style={{
                        padding: '7px 10px', borderRadius: '6px', fontSize: '14px',
                        background: field.confidence === 'MISSING' ? '#f3f4f6' : field.confirmed ? '#f0fdf4' : '#fff',
                        border: `1px solid ${field.confidence === 'MISSING' ? '#9ca3af' : field.confidence === 'HIGH' ? '#86efac' : field.confidence === 'MEDIUM' ? '#fde047' : '#fca5a5'}`,
                        color: field.confidence === 'MISSING' ? '#9ca3af' : '#111827',
                        fontStyle: field.confidence === 'MISSING' ? 'italic' : 'normal',
                      }}>
                        {field.value || '—'}
                      </div>
                    </div>
                  ))}
                  {draft.equipments.length > 0 && (
                    <div>
                      <div style={S.label}>장비</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '4px' }}>
                        {draft.equipments.map((eq, i) => (
                          <span key={i} style={{ background: '#e0f2fe', color: '#0369a1', borderRadius: '12px', padding: '3px 10px', fontSize: '12px', fontWeight: 600 }}>
                            {eq.modelName} ×{eq.qty}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {draft.note && (
                    <div>
                      <div style={S.label}>특이사항</div>
                      <div style={{ fontSize: '13px', color: '#374151', marginTop: '3px' }}>{draft.note}</div>
                    </div>
                  )}
                  {draft.isNewCustomer && !draft.customerRegistered && (
                    <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '7px', padding: '8px 10px', fontSize: '12px', color: '#92400e' }}>
                      ⛔ 관리부 정식 등록 완료 전 배차 차단
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button style={S.btnDanger} onClick={() => handleDiscardDraft(draft.id)}>
                      <Trash2 size={13} style={{ display: 'inline', marginRight: '4px' }} />폐기
                    </button>
                    <button
                      style={{ ...S.btnPrimary, opacity: (draft.isNewCustomer && !draft.customerRegistered) ? 0.4 : 1 }}
                      disabled={draft.isNewCustomer && !draft.customerRegistered}
                      onClick={() => handleSubmitDraft(draft)}>
                      <ArrowRight size={13} style={{ display: 'inline', marginRight: '4px' }} />출고 지시
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {queue.filter(d => d.status === 'SUBMITTED' || d.status === 'DISCARDED').length > 0 && (
          <div style={{ marginTop: '16px', fontSize: '12px', color: '#9ca3af', textAlign: 'center' }}>
            완료 {queue.filter(d => d.status === 'SUBMITTED').length}건 · 폐기 {queue.filter(d => d.status === 'DISCARDED').length}건
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 최종 렌더
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>출고의뢰</h2>
      </div>
      <div style={S.tabBar}>
        <button style={S.tab(activeTab === 'NEW')} onClick={() => setActiveTab('NEW')}>새 의뢰</button>
        <button style={S.tab(activeTab === 'QUEUE')} onClick={() => setActiveTab('QUEUE')}>
          처리 대기 {pendingCount > 0 && `(${pendingCount})`}
        </button>
      </div>
      {activeTab === 'NEW' ? renderNewTab() : renderQueueTab()}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'error' ? '#dc2626' : toast.type === 'info' ? '#2563eb' : '#16a34a',
          color: '#fff', padding: '10px 20px', borderRadius: '24px',
          fontSize: '13px', fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)', whiteSpace: 'nowrap',
        }}>
          {toast.text}
        </div>
      )}
    </div>
  );
};

export default SmartDispatch4;
