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
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { db, Customer, CustomerSite, findCustomerByNormalizedName, STANDARD_SPECS, StandardOption } from '../services/db';
import { EQUIPMENT_SPEC_MATRIX } from '../services/voiceOrderDraftService';
import { matchHangul } from '../utils/hangulSearch';
import {
  fetchMyDrafts, subscribeDraftUpdates, submitDraft, discardDraft,
  createDraftOrder, DraftDispatchOrder, mergeDrafts,
  CallUploadRecord, PipelineLogRecord,
  fetchCallUploads, fetchPipelineLogs, insertPipelineLog,
  subscribeCallUploads, subscribePipelineLogs,
  convertUploadToDraft, deleteCallUpload, parsePhoneFromFileName,
  CALL_CONTEXT_OPTIONS
} from '../services/callUploadService';
import {
  Plus, Minus, Trash2, ChevronDown, ChevronUp,
  Building2, MapPin, Package, Calendar, User,
  ClipboardPaste, ArrowRight, Info, Merge,
  UploadCloud, ShieldCheck, ShieldAlert,
  AlertTriangle, Check, AlertCircle, RotateCcw,
  Truck, Wrench, Shield, RefreshCw, Save, X, Search,
  FolderOpen, Zap, Phone, Terminal, Activity
} from 'lucide-react';
import { CallAudioUploadModal } from '../components/CallAudioUploadModal';
import { PipelineConsole } from '../components/PipelineConsole';
import './smart_dispatch4.css';

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

type CallContext =
  | 'NEW_CUSTOMER'
  | 'ADDITIONAL'
  | 'EXCHANGE';

type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'MISSING';

interface ScoredField {
  value: string;
  confidence: ConfidenceLevel;
  source?: 'DB' | 'STT' | 'PARSED' | 'MANUAL' | 'SUMMARY';
  confirmed: boolean;
}

interface EquipmentItem { modelName: string; qty: number; }

export type PaidBy = 'CUSTOMER' | 'OURS' | 'SPLIT';

export const VEHICLE_TYPE_OPTIONS = ['1.4T', '2.5T', '3.5T', '5T', '5T장축', '8.5T', '11T', '노배드', '셀프로더'];

interface DraftOrder {
  id: string;
  context: CallContext[];
  customerName: ScoredField;
  siteName: ScoredField;
  siteAddress?: string;
  equipments: EquipmentItem[];
  loadingDate: ScoredField;
  loadingTime: ScoredField;
  unloadingDate?: string;
  unloadingTimeType?: 'ASAP' | 'MORNING' | 'AFTERNOON' | 'EXACT' | null;
  unloadingTimeVal?: string;
  contactPerson: ScoredField;
  contactPhone: ScoredField;
  note: string;
  status: 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'DISCARDED';
  isNewCustomer: boolean;
  customerRegistered: boolean;
  createdAt: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  retrievalAssetIds?: string[];
  paidBy?: PaidBy | null;
  safetyOptions?: string[];
  staggeredMemo?: string;
  sourceCallIds?: string[];
  vehicleType?: string;
}

type ActiveTab = 'NEW' | 'QUEUE';
type BlockId = 'WHO' | 'WHERE' | 'WHAT' | 'WHEN' | 'SAFETY_COST';

const CONTEXT_OPTIONS: { id: CallContext; label: string; color: string }[] = [
  { id: 'NEW_CUSTOMER',   label: '신규고객 출고',   color: '#7c3aed' },
  { id: 'ADDITIONAL',     label: '기존현장 출고',   color: '#2563eb' },
  { id: 'EXCHANGE',       label: '교체(대차)',       color: '#0891b2' },
];

const FT_GROUPS = ['19ft', '26ft', '32ft', '33ft', '40ft', '특수/기타'];

export const QUICK_OPTION_SUGGESTIONS = [
  '협착방지', '상부센서', '경광등', '소화기', '논마킹', '비닐보양'
];

const getModelsByFt = (ft: string) => {
  return EQUIPMENT_SPEC_MATRIX.filter(m => {
    if (ft === '특수/기타') {
      return !['19ft', '26ft', '32ft', '33ft', '40ft'].includes(m.ft);
    }
    return m.ft === ft;
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
    hasPermission, customers, sites, contacts, currentUser, currentTenant,
    saveSmartDispatch, assets, deliveries, standardOptions
  } = useApp();

  const canSave = hasPermission('smart_dispatch', 'save') || hasPermission('delivery', 'save');

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

  // ── 통화 업로드 및 실시간 파이프라인 로그 ──────────────────────────────────
  const [callUploads, setCallUploads] = useState<CallUploadRecord[]>([]);
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLogRecord[]>([]);
  const [logFilter, setLogFilter] = useState<'ALL' | 'SUCCESS' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [isConvertingId, setIsConvertingId] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── 좌우 2열 분할 스튜디오 선택 상태 관리 ──────────────────────────────
  const [viewFilter, setViewFilter] = useState<'ALL' | 'UPLOADS_ONLY' | 'DRAFTS_ONLY'>('ALL');
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const selectedUpload = useMemo(() => callUploads.find(u => u.id === selectedUploadId) || null, [callUploads, selectedUploadId]);
  const selectedDraft = useMemo(() => queue.find(d => d.id === selectedDraftId) || null, [queue, selectedDraftId]);

  // 🌟 [메모 직렬화 파서] DB note 필드에 보존된 배차 핵심 파라미터 역직렬화
  const parseNoteMeta = useCallback((noteText: string) => {
    let siteAddress = '';
    let unloadingDate = '';
    let unloadingTimeVal = '';
    let unloadingTimeType: 'ASAP' | 'MORNING' | 'AFTERNOON' | 'EXACT' | null = null;
    let paidBy: PaidBy | undefined = undefined;
    const retrievalAssetIds: string[] = [];
    const safetyOptions: string[] = [];
    let staggeredMemo = '';
    let vehicleType = '';

    const parts = (noteText || '').split(' | ');
    parts.forEach(p => {
      if (p.startsWith('[하차일정]')) {
        const rest = p.replace('[하차일정]', '').trim();
        const match = rest.match(/(\d{4}-\d{2}-\d{2})/);
        if (match) unloadingDate = match[1];
        if (rest.includes('ASAP')) unloadingTimeType = 'ASAP';
        else if (rest.includes('오전')) unloadingTimeType = 'MORNING';
        else if (rest.includes('오후')) unloadingTimeType = 'AFTERNOON';
        else {
          const timeMatch = rest.match(/(\d{1,2}:\d{2})/);
          if (timeMatch) { unloadingTimeType = 'EXACT'; unloadingTimeVal = timeMatch[1]; }
        }
      } else if (p.startsWith('[운송비부담]')) {
        if (p.includes('고객청구')) paidBy = 'CUSTOMER';
        else if (p.includes('당사부담')) paidBy = 'OURS';
        else if (p.includes('편도지원')) paidBy = 'SPLIT';
      } else if (p.startsWith('[시차출고]')) {
        staggeredMemo = p.replace('[시차출고]', '').trim();
      } else if (p.startsWith('[대차회수대상]')) {
        if (p.includes('모름')) {
          retrievalAssetIds.push('UNKNOWN');
        } else {
          const ids = p.replace('[대차회수대상]', '').replace(/자산|#/g, '').split(',').map(s => s.trim()).filter(Boolean);
          retrievalAssetIds.push(...ids);
        }
      } else if (p.startsWith('[차종]')) {
        vehicleType = p.replace('[차종]', '').trim();
      } else if (p.startsWith('[현장상세주소]') || p.startsWith('[현장주소]')) {
        siteAddress = p.replace(/^\[(?:현장상세주소|현장주소)\]/, '').trim();
      } else if (p.startsWith('[옵션]') || p.startsWith('[안전옵션]')) {
        const optStr = p.replace(/^\[(?:옵션|안전옵션)\]/, '').trim();
        const items = optStr.split(/[,/|]/).map(s => s.trim()).filter(Boolean);
        safetyOptions.push(...items);
      }
    });

    return { siteAddress, unloadingDate, unloadingTimeType, unloadingTimeVal, paidBy, retrievalAssetIds, safetyOptions, staggeredMemo, vehicleType };
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const dbDrafts = await fetchMyDrafts();
      const mapped: DraftOrder[] = dbDrafts.map(d => {
        const meta = parseNoteMeta(d.note);
        return {
          id:                 d.id,
          context:            (d.context || []).filter(c => c === 'ADDITIONAL' || c === 'NEW_CUSTOMER' || c === 'EXCHANGE') as CallContext[],
          customerName:       { ...d.customerName, confirmed: false },
          siteName:           { ...d.siteName,     confirmed: false },
          siteAddress:        meta.siteAddress,
          equipments:         d.equipments,
          loadingDate:        { ...d.loadingDate,  confirmed: false },
          loadingTime:        { ...d.loadingTime,  confirmed: false },
          unloadingDate:      meta.unloadingDate,
          unloadingTimeType:  meta.unloadingTimeType,
          unloadingTimeVal:   meta.unloadingTimeVal,
          contactPerson:      { ...d.contactPerson,confirmed: false },
          contactPhone:       { value: d.contactPhone, confidence: d.contactPhone ? 'HIGH' : 'MISSING', confirmed: false },
          note:               d.note,
          status:             d.status as DraftOrder['status'],
          isNewCustomer:      d.isNewCustomer,
          customerRegistered: d.customerRegistered,
          createdAt:          d.createdAt,
          urgency:            d.urgency,
          retrievalAssetIds:  meta.retrievalAssetIds,
          paidBy:             meta.paidBy,
          safetyOptions:      meta.safetyOptions,
          staggeredMemo:      meta.staggeredMemo,
          sourceCallIds:      d.sourceCallIds || [],
          vehicleType:        meta.vehicleType,
        };
      });
      setQueue(mapped);
    } catch {
      // Supabase 미연결 시 로컬 유지
    }
  }, [parseNoteMeta]);

  const loadUploadsAndLogs = useCallback(async () => {
    try {
      const [uploads, logs] = await Promise.all([
        fetchCallUploads(),
        fetchPipelineLogs(100)
      ]);
      setCallUploads(uploads);
      setPipelineLogs(logs);
    } catch (e) {
      console.warn('통화 업로드 및 파이프라인 로그 로드 실패:', e);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
    loadUploadsAndLogs();

    // 1. 통화 업로드 실시간 구독 (INSERT, UPDATE, DELETE)
    const unsubUploads = subscribeCallUploads(() => {
      loadUploadsAndLogs();
      loadDrafts();
    });

    // 2. 파이프라인 실시간 로그 구독 (INSERT)
    const unsubLogs = subscribePipelineLogs((newLog) => {
      setPipelineLogs(prev => [newLog, ...prev.filter(l => l.id !== newLog.id)].slice(0, 150));
    });

    // 3. 의뢰 초안 실시간 구독
    let unsubDrafts: (() => void) | undefined;
    (async () => {
      try {
        if (!currentUser?.id) return;
        unsubDrafts = subscribeDraftUpdates(currentUser.id, (newDraft: DraftDispatchOrder) => {
          const meta = parseNoteMeta(newDraft.note);
          const mapped: DraftOrder = {
            id:                 newDraft.id,
            context:            (newDraft.context || []).filter(c => c === 'ADDITIONAL' || c === 'NEW_CUSTOMER' || c === 'EXCHANGE') as CallContext[],
            customerName:       { ...newDraft.customerName, confirmed: false },
            siteName:           { ...newDraft.siteName,     confirmed: false },
            siteAddress:        meta.siteAddress,
            equipments:         newDraft.equipments,
            loadingDate:        { ...newDraft.loadingDate,  confirmed: false },
            loadingTime:        { ...newDraft.loadingTime,  confirmed: false },
            unloadingDate:      meta.unloadingDate,
            unloadingTimeType:  meta.unloadingTimeType,
            unloadingTimeVal:   meta.unloadingTimeVal,
            contactPerson:      { ...newDraft.contactPerson,confirmed: false },
            contactPhone:       { value: newDraft.contactPhone, confidence: newDraft.contactPhone ? 'HIGH' : 'MISSING', confirmed: false },
            note:               newDraft.note,
            status:             newDraft.status as DraftOrder['status'],
            isNewCustomer:      newDraft.isNewCustomer,
            customerRegistered: newDraft.customerRegistered,
            createdAt:          newDraft.createdAt,
            urgency:            newDraft.urgency,
            retrievalAssetIds:  meta.retrievalAssetIds,
            paidBy:             meta.paidBy,
            safetyOptions:      meta.safetyOptions,
            staggeredMemo:      meta.staggeredMemo,
            sourceCallIds:      newDraft.sourceCallIds || [],
            vehicleType:        meta.vehicleType,
          };
          setQueue(prev => {
            if (prev.find(d => d.id === mapped.id)) return prev;
            return [mapped, ...prev];
          });
          showToast(`새 초안 도착: ${mapped.customerName.value || '(미인식)'}`, 'info');
        });
      } catch { /* 비로그인 시 무시 */ }
    })();
    return () => {
      unsubUploads?.();
      unsubLogs?.();
      unsubDrafts?.();
    };
  }, [loadDrafts, loadUploadsAndLogs, currentUser?.id, showToast, parseNoteMeta]);

  const pendingCount = queue.filter(q => q.status === 'DRAFT').length;

  // ── 업무 유형 (단일 맥락 선택, 🌟 기본값 null: 아무것도 자동 선택되지 않음) ──
  const [selectedContext, setSelectedContext] = useState<CallContext | null>(null);

  // 🏷️ 옵션 분할 헬퍼 (천단위 금액 쉼표 30,000원 및 옵션명 내부 슬래시 '협착방지봉 / 상부센서' 보존)
  const parseOptionString = (str?: string): string[] => {
    if (!str) return [];
    return str
      .split(/(?:,(?!\d{3}(?:[^\d]|$))|[;\n]+)/)
      .map(s => s.trim())
      .filter(s => Boolean(s) && s !== '-' && s !== 'NONE' && s !== '없음');
  };

  // 🛡️ 보양/유상옵션 정밀 분류 헬퍼
  const isProtectionOption = useCallback((label: string): boolean => {
    const protDefs = (standardOptions || []).filter(o => o.category === 'PROTECTION').map(o => o.name);
    if (protDefs.includes(label)) return true;
    if (/보양|비닐보양|바닥보양|완충/i.test(label) && !/조이스틱|커버|센서|스위치/i.test(label)) return true;
    return false;
  }, [standardOptions]);

  // 🌟 [현장 마스터 + 고객사 기본상속 + 과거 배차 이력 종합 옵션 자동 로드]
  const loadSiteSafetyOptions = useCallback((site: CustomerSite | null, cust: Customer | null) => {
    const inherited = new Set<string>();

    // ── 1순위: 선택된 현장 마스터 직접 등록 옵션 ──────────────────────────────
    if (site) {
      if (site.paidOptions) {
        parseOptionString(site.paidOptions).forEach(opt => inherited.add(opt));
      }
      if (site.protection && site.protection !== 'NONE' && site.protection !== '-') {
        parseOptionString(site.protection).forEach(opt => inherited.add(opt));
      }
      if (site.checkedSpecs) {
        Object.entries(site.checkedSpecs).forEach(([k, v]) => {
          if (v) {
            const specDef = STANDARD_SPECS.find(s => s.id === k);
            if (specDef) inherited.add(specDef.label);
          }
        });
      }
    }

    // ── 2순위: 고객사 기본 상속 옵션 (현장 옵션이 비어있거나 현장 미선택 시) ───
    if (inherited.size === 0 && cust) {
      if (cust.defaultPaidOptions) {
        parseOptionString(cust.defaultPaidOptions).forEach(opt => inherited.add(opt));
      }
      if (cust.defaultProtection && cust.defaultProtection !== 'NONE' && cust.defaultProtection !== '-') {
        parseOptionString(cust.defaultProtection).forEach(opt => inherited.add(opt));
      }
      const custSpecs = cust.defaultCheckedSpecs || (cust as any).defaultSpecs;
      if (custSpecs) {
        Object.entries(custSpecs).forEach(([k, v]) => {
          if (v) {
            const specDef = STANDARD_SPECS.find(s => s.id === k);
            if (specDef) inherited.add(specDef.label);
          }
        });
      }
    }

    // ── 3순위: 과거 배차 대장(deliveries) 이력 자동 탐색 ──────────────────────
    if (inherited.size === 0 && (site || cust)) {
      const siteAddrs = site?.address?.trim();
      const custId = cust?.id;
      const pastDelivery = (deliveries || []).find(d => 
        (siteAddrs && d.destinationAddress && d.destinationAddress.includes(siteAddrs)) ||
        (custId && d.billableCustomerId === custId) ||
        (site?.name && d.cargoItems && d.cargoItems.includes(site.name))
      );
      if (pastDelivery) {
        const text = `${pastDelivery.cargoItems || ''} ${pastDelivery.closingMemo || ''} ${pastDelivery.memo || ''}`;
        const match = text.match(/\[(?:옵션|안전옵션)\]\s*([^|\]]+)/);
        if (match && match[1]) {
          parseOptionString(match[1]).forEach(item => {
            inherited.add(item);
          });
        }
      }
    }

    setSelectedSafetyOptions(new Set(inherited));
    setInitialSiteOptions(new Set(inherited));
    return inherited;
  }, [deliveries]);

  const inheritPastSafetyOptions = loadSiteSafetyOptions;

  const isNewCustomerMode = selectedContext === 'NEW_CUSTOMER';
  const isExchangeMode = selectedContext === 'EXCHANGE';

  // ── 붙여넣기 파싱 존 ──────────────────────────────────────────────────────
  const [pasteZoneOpen, setPasteZoneOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const txtFileInputRef = useRef<HTMLInputElement>(null);

  // 텍스트 파일(.txt, .csv, .log 등) 불러오기 핸들러 (출고 요청 메뉴 기능 연동)
  const handleTextFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text !== undefined && text !== null) {
        setPasteText(text);
        setPasteZoneOpen(true);
        showToast(`파일 '${file.name}'의 텍스트 내용을 불러왔습니다.`);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // ── 블록 열림 상태 (기본 접힘 & 개별 토글 & 전체 펼치기/접기) ──────────
  const [openBlocks, setOpenBlocks] = useState<Set<BlockId>>(new Set<BlockId>([]));
  const toggleBlock = (id: BlockId) => setOpenBlocks(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const openSingleBlock = (id: BlockId) => setOpenBlocks(prev => new Set(prev).add(id));
  const setOpenBlock = openSingleBlock;
  const toggleAllBlocks = () => setOpenBlocks(prev => prev.size === 5 ? new Set() : new Set<BlockId>(['WHO', 'WHERE', 'WHAT', 'WHEN', 'SAFETY_COST']));

  // ── WHO 블록 — 고객 ───────────────────────────────────────────────────────
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerAddress, setNewCustomerAddress] = useState('');

  // ── WHERE 블록 — 투입 현장 및 현장 담당자 ────────────────────────────────
  const [siteQuery, setSiteQuery] = useState('');
  const [selectedSite, setSelectedSite] = useState<CustomerSite | null>(null);
  const [selectedSiteAddress, setSelectedSiteAddress] = useState('');
  const [isRegisteringNewSite, setIsRegisteringNewSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteAddress, setNewSiteAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // ── 추가출고 옵션 첨삭 확인 모달 상태 ────────────────────────────────────
  const [optionConfirmModalOpen, setOptionConfirmModalOpen] = useState(false);

  // 🌟 검색어가 없을 때는 고객사를 일절 추천/제시하지 않음 (사용자 피드백 100% 반영)
  const filteredCustomers = useMemo(() => {
    if (!customerQuery.trim()) return [];
    return customers.filter(c => matchHangul(c.name, customerQuery)).slice(0, 16);
  }, [customers, customerQuery]);

  // 🌟 [고객 지정 전 현장 노출 완전 차단] 고객사 미선택 시 현장 목록 일절 노출 금지!
  const filteredSites = useMemo(() => {
    if (!selectedCustomer) return [];
    const base = sites.filter(s => s.customerId === selectedCustomer.id);
    if (!siteQuery.trim()) return base.slice(0, 16);
    return base.filter(s => matchHangul(s.name, siteQuery)).slice(0, 16);
  }, [sites, selectedCustomer, siteQuery]);

  // 중복 접수 감지 (큐 + 배차 대장 동시 검사)
  const duplicateAlert = useMemo(() => {
    if (!selectedCustomer) return null;
    const today = new Date().toISOString().split('T')[0];
    const draftDups = queue.filter(d =>
      d.customerName.value === selectedCustomer.name &&
      d.createdAt.startsWith(today) &&
      d.status === 'DRAFT'
    );
    if (draftDups.length > 0) return draftDups;

    const deliveryDups = deliveries.filter(d =>
      (d.requestDate?.startsWith(today) || d.createdAt?.startsWith(today)) &&
      (d.destinationAddress?.includes(selectedCustomer.name) || (selectedSite && d.destinationAddress?.includes(selectedSite.name)))
    );
    if (deliveryDups.length > 0) {
      return deliveryDups.map(del => ({
        id: del.id,
        context: ['ADDITIONAL' as CallContext],
        customerName: { value: selectedCustomer.name, confidence: 'HIGH' as ConfidenceLevel, confirmed: true },
        siteName: { value: del.destinationAddress || '', confidence: 'HIGH' as ConfidenceLevel, confirmed: true },
        equipments: [],
        loadingDate: { value: del.scheduledDate || today, confidence: 'HIGH' as ConfidenceLevel, confirmed: true },
        loadingTime: { value: del.loadingTimeSlot || '오전', confidence: 'HIGH' as ConfidenceLevel, confirmed: true },
        contactPerson: { value: del.driverName || '', confidence: 'HIGH' as ConfidenceLevel, confirmed: true },
        contactPhone: { value: del.driverContact || '', confidence: 'HIGH' as ConfidenceLevel, confirmed: true },
        note: del.memo || '',
        status: 'SUBMITTED' as const,
        isNewCustomer: false,
        customerRegistered: true,
        createdAt: del.createdAt || today,
        urgency: 'LOW' as const,
      }));
    }
    return null;
  }, [selectedCustomer, selectedSite, queue, deliveries]);

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
  const setModelQty = (index: number, qty: number) => {
    if (qty <= 0) return;
    setEquipments(prev => {
      const u = [...prev];
      u[index] = { ...u[index], qty };
      return u;
    });
  };
  const removeEquipment = (index: number) => {
    setEquipments(prev => prev.filter((_, i) => i !== index));
  };
  const totalQty = equipments.reduce((s, e) => s + e.qty, 0);

  // ── WHEN 블록 — 상차 vs 하차 일정 및 시간 구분 (ASAP/오전/오후/직접지정) ───
  const [loadingDate, setLoadingDate] = useState('');
  const [loadingTimeType, setLoadingTimeType] = useState<'ASAP' | 'MORNING' | 'AFTERNOON' | 'EXACT' | null>(null);
  const [loadingTimeVal, setLoadingTimeVal] = useState('');

  const [unloadingDate, setUnloadingDate] = useState('');
  const [unloadingTimeType, setUnloadingTimeType] = useState<'ASAP' | 'MORNING' | 'AFTERNOON' | 'EXACT' | null>(null);
  const [unloadingTimeVal, setUnloadingTimeVal] = useState('');

  const [note, setNote] = useState('');

  // ── 🌟 [대차 회수 대상 전자산 다수 매핑 및 "모름" 지원] ────────────────────
  const [retrievalAssetIds, setRetrievalAssetIds] = useState<string[]>([]);
  const retrievalAssetId = retrievalAssetIds[0] || '';

  const isUnknownRetrieval = useMemo(() => {
    return retrievalAssetIds.includes('UNKNOWN') || retrievalAssetIds.includes('모름');
  }, [retrievalAssetIds]);

  const toggleUnknownRetrieval = () => {
    setRetrievalAssetIds(prev => {
      const isAlready = prev.includes('UNKNOWN') || prev.includes('모름');
      if (isAlready) return [];
      return ['UNKNOWN'];
    });
  };

  const toggleRetrievalAsset = (assetNo: string) => {
    setRetrievalAssetIds(prev => {
      const withoutUnknown = prev.filter(id => id !== 'UNKNOWN' && id !== '모름');
      return withoutUnknown.includes(assetNo)
        ? withoutUnknown.filter(id => id !== assetNo)
        : [...withoutUnknown, assetNo];
    });
  };

  // 선택된 고객사의 현재 가동 중인 장비 목록 (대차 대상 - 멀티테넌시 고객 격리)
  const activeCustomerAssets = useMemo(() => {
    if (!selectedCustomer) return [];
    return assets.filter(a => a.status === 'RENTED' && a.currentCustomerId === selectedCustomer.id);
  }, [selectedCustomer, assets]);

  // ── 🌟 [운송비 귀속선: 기본값 null, 사용자 직접 선택 강제] ───────────────
  const [paidBy, setPaidBy] = useState<PaidBy | null>(null);
  const [vehicleType, setVehicleType] = useState<string>('5T');

  // ── 🌟 [고객 요청 옵션: 있는 그대로 기록하는 자유 태그 + 현장 연동] ───────
  const [newOptionInput, setNewOptionInput] = useState<string>('');
  const [selectedSafetyOptions, setSelectedSafetyOptions] = useState<Set<string>>(new Set());
  const [initialSiteOptions, setInitialSiteOptions] = useState<Set<string>>(new Set());
  const [saveOptionsToSite, setSaveOptionsToSite] = useState<boolean>(true);

  // 🌟 전사 표준 옵션 마스터 및 자주 쓰는 키워드 통합 추천 칩
  const availableOptionSuggestions = useMemo(() => {
    const list: string[] = [];
    (standardOptions || [])
      .filter(o => o.isActive && o.category !== 'SPEC' && o.name !== 'NONE' && !o.name.startsWith('NONE'))
      .forEach(o => {
        if (!list.includes(o.name)) list.push(o.name);
      });
    QUICK_OPTION_SUGGESTIONS.forEach(q => {
      if (!list.some(item => item.includes(q) || q.includes(item))) {
        list.push(q);
      }
    });
    return list;
  }, [standardOptions]);

  const toggleOptionTag = (tag: string) => {
    setSelectedSafetyOptions(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleAddOption = (customVal?: string) => {
    const val = (customVal || newOptionInput).trim();
    if (!val) return;
    setSelectedSafetyOptions(prev => new Set(prev).add(val));
    if (!customVal) setNewOptionInput('');
  };

  const handleRemoveOption = (tag: string) => {
    setSelectedSafetyOptions(prev => {
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
  };

  const handleReloadSiteOptions = () => {
    if (selectedSite) {
      const loaded = loadSiteSafetyOptions(selectedSite, selectedCustomer);
      if (loaded.size > 0) {
        showToast(`현장 '${selectedSite.name}'의 옵션 (${loaded.size}건)을 불러왔습니다.`, 'success');
      } else {
        showToast(`현장 '${selectedSite.name}'에 등록된 옵션이 없습니다.`, 'info');
      }
    } else if (selectedCustomer) {
      const loaded = loadSiteSafetyOptions(null, selectedCustomer);
      if (loaded.size > 0) {
        showToast(`고객사 '${selectedCustomer.name}'의 기본 옵션 (${loaded.size}건)을 불러왔습니다.`, 'success');
      } else {
        showToast(`고객사 '${selectedCustomer.name}'에 등록된 기본 옵션이 없습니다.`, 'info');
      }
    } else {
      showToast('선택된 고객사 또는 현장이 없습니다.', 'error');
    }
  };

  const handleSaveOptionsToCurrentSite = async () => {
    if (!selectedSite) {
      showToast('선택된 현장이 없습니다. 현장을 먼저 선택하세요.', 'error');
      return;
    }
    const optionLabels = Array.from(selectedSafetyOptions);
    const paidOpts = optionLabels.filter(label => !isProtectionOption(label)).join(', ');
    const protOpts = optionLabels.filter(label => isProtectionOption(label)).join(', ') || 'NONE';

    try {
      db.updateRow<CustomerSite>('sites', selectedSite.id, {
        paidOptions: paidOpts,
        protection: protOpts,
        address: selectedSiteAddress || selectedSite.address,
        updatedAt: new Date().toISOString(),
      });
      await db.awaitPendingWrites();
      setInitialSiteOptions(new Set(selectedSafetyOptions));
      showToast(`[${selectedSite.name}] 현장 옵션 및 주소가 성공적으로 저장되었습니다.`, 'success');
    } catch (e: any) {
      showToast(`현장 옵션 저장 실패: ${e?.message}`, 'error');
    }
  };

  // 첨삭(변경) 발생 여부 계산: 현장 기존 옵션과 달라진 경우 true
  const isOptionsModified = useMemo(() => {
    if (!selectedSite || selectedContext !== 'ADDITIONAL') return false;
    if (selectedSafetyOptions.size !== initialSiteOptions.size) return true;
    for (const opt of selectedSafetyOptions) {
      if (!initialSiteOptions.has(opt)) return true;
    }
    return false;
  }, [selectedContext, selectedSite, selectedSafetyOptions, initialSiteOptions]);

  // ── 🌟 [다수 장비 시차 출고 메모] ───────────────────────────────────────
  const [staggeredMemo, setStaggeredMemo] = useState('');

  // DB 상속 (현장/고객 변경 시 담당자 및 연락처 100% 자동 동기화)
  const applyInheritance = useCallback((cust: Customer | null, site: CustomerSite | null) => {
    if (!cust) {
      setContactPerson('');
      setContactPhone('');
      return;
    }
    const custContacts = contacts.filter(c => c.customerId === cust.id);
    const primary = custContacts[0];

    if (site) {
      // 1순위: 현장 마스터 등록 담당자 및 연락처
      // 2순위: 거래처 기본 담당자 및 연락처
      const targetName = site.contactName || (primary ? primary.name : '');
      const targetPhone = site.contact || (primary ? primary.contact || '' : '');
      setContactPerson(targetName);
      setContactPhone(targetPhone);
      return;
    }

    // 현장 미선택 시 거래처 기본 담당자로 설정
    if (primary) {
      setContactPerson(primary.name || '');
      setContactPhone(primary.contact || '');
    } else {
      setContactPerson('');
      setContactPhone('');
    }
  }, [contacts]);

  const handleSelectCustomer = (cust: Customer) => {
    setSelectedCustomer(cust);
    setCustomerQuery('');
    setSelectedSite(null);
    setSelectedSiteAddress('');
    setIsRegisteringNewSite(false);
    setSiteQuery('');
    applyInheritance(cust, null);
    loadSiteSafetyOptions(null, cust);
    setOpenBlock('WHERE');
  };

  const handleSelectSite = (site: CustomerSite) => {
    setSelectedSite(site);
    setSelectedSiteAddress(site.address || '');
    setIsRegisteringNewSite(false);
    setSiteQuery('');
    applyInheritance(selectedCustomer, site);

    // 🌟 과거 기록(현장 마스터 또는 배차 대장)에서 옵션 자동 승계
    loadSiteSafetyOptions(site, selectedCustomer);
    setOpenBlock('WHAT');
  };

  const handleSelectContext = (ctx: CallContext) => {
    setSelectedContext(prev => {
      const next = prev === ctx ? null : ctx;
      if (next === 'NEW_CUSTOMER') {
        setSelectedCustomer(null);
        setSelectedSite(null);
        setSelectedSiteAddress('');
        setIsRegisteringNewSite(false);
        setContactPerson('');
        setContactPhone('');
      }
      return next;
    });
    if (selectedSite) {
      loadSiteSafetyOptions(selectedSite, selectedCustomer);
    }
  };


  // ── 폼 데이터 변환 (추출) 엔진 — 9대 스키마 상관관계 100% 매핑 ───────────
  const runParse = useCallback((text: string) => {
    if (!text.trim()) { showToast('텍스트를 입력하세요.', 'error'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // 전화번호 추출 Helper
    const extractPhone = (s: string) => {
      const m = s.match(/(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g);
      return m ? m[0].replace(/\s+/g, '') : '';
    };

    // 담당자 성명 추출 Helper
    const extractName = (s: string) => {
      let namePart = s.split(/01[016789]/)[0] || s;
      namePart = namePart.split(/[a-zA-Z0-9._%+-]+@/)[0] || namePart;
      return namePart.replace(/[:：\-]/g, '').replace(/선임|책임|담당자|소장|부장|과장|대리|팀장|반장|인수자/g, '').trim();
    };

    // 날짜 추출 Helper (YYYY-MM-DD 또는 M/D, MM.DD)
    const extractDate = (s: string): string => {
      const full = s.match(/(\d{4})[./년\s-](\d{1,2})[./월\s-](\d{1,2})/);
      if (full) {
        return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
      }
      const md = s.match(/(\d{1,2})[./월\s-](\d{1,2})/);
      if (md) {
        const y = new Date().getFullYear();
        return `${y}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
      }
      return '';
    };

    // 시간 추출 Helper (HH:mm)
    const extractTime = (s: string): { type: 'ASAP' | 'MORNING' | 'AFTERNOON' | 'EXACT' | null; val: string } => {
      if (/ASAP|즉시|당일|최우선|긴급/i.test(s)) return { type: 'ASAP', val: '' };
      if (/오전/i.test(s) && !/\d{1,2}[.:시]/.test(s)) return { type: 'MORNING', val: '' };
      if (/오후/i.test(s) && !/\d{1,2}[.:시]/.test(s)) return { type: 'AFTERNOON', val: '' };
      const tm = s.match(/(\d{1,2})[.:시](\d{2})?/);
      if (tm) {
        let hour = parseInt(tm[1], 10);
        if (/오후/i.test(s) && hour < 12) hour += 12;
        const min = tm[2] || '00';
        return { type: 'EXACT', val: `${String(hour).padStart(2, '0')}:${min}` };
      }
      return { type: null, val: '' };
    };

    let pc = '', ps = '', paddr = '', pscname = '', pscphone = '';
    let ploadDate = '', ploadTimeStr = '';
    let punloadDate = '', punloadTimeStr = '';
    const peqs: EquipmentItem[] = [];
    let ppaidby: PaidBy | null = null;
    let pretrieval: string[] = [];
    let pnote = '';
    let pstaggered = '';

    lines.forEach(line => {
      const val = line.includes(':')
        ? line.substring(line.indexOf(':') + 1).trim()
        : (line.includes('：') ? line.substring(line.indexOf('：') + 1).trim() : '');

      // 1. 고객사명 / 업체 / 상호 / 발주처
      if (/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|발주처)/i.test(line)) {
        pc = val || line.replace(/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|발주처)\s*[:：]?\s*/i, '');
      }
      // 2. 현장 상세 주소 / 배송지 / 도착지 (현장명보다 먼저 매칭)
      else if (/^(?:\d+[.)]\s*)?(?:현장\s*상세\s*주소|현장상세주소|현장\s*주소|주소|배송지|도착지)/i.test(line)) {
        paddr = val || line.replace(/^(?:\d+[.)]\s*)?(?:현장\s*상세\s*주소|현장상세주소|현장\s*주소|주소|배송지|도착지)\s*[:：]?\s*/i, '');
      }
      // 3. 현장 담당자 / 소장 / 반장 / 인수자
      else if (/^(?:\d+[.)]\s*)?(?:현장\s*담당자?|현장담당|소장|반장|인수자|현장소장|현장반장)/i.test(line) && !line.includes('청구') && !line.includes('영업')) {
        pscname = extractName(val || line);
        pscphone = extractPhone(val || line);
      }
      // 4. 현장명 / 현장
      else if (/^(?:\d+[.)]\s*)?(?:현장명?|현장)(?!\s*상세|\s*주소|\s*담당|\s*소장|\s*도착)/i.test(line)) {
        ps = val || line.replace(/^(?:\d+[.)]\s*)?(?:현장명?|현장)\s*[:：]?\s*/i, '');
      }
      // 5. 상차/출고 날짜
      else if (/^(?:\d+[.)]\s*)?(?:출고\s*일자|출고일|상차\s*일자|상차일|작업\s*일자|작업일|일자|날짜)/i.test(line) && !line.includes('시간')) {
        const d = extractDate(val || line);
        if (d) ploadDate = d;
      }
      // 6. 상차/출고 시간
      else if (/^(?:\d+[.)]\s*)?(?:상차\s*시간|상차시간|출고\s*시간|출고시간|상차\s*스케줄|상차)/i.test(line)) {
        const d = extractDate(val || line);
        if (d) ploadDate = d;
        ploadTimeStr = val || line.replace(/^.*[:：]\s*/, '');
      }
      // 7. 하차/도착 날짜
      else if (/^(?:\d+[.)]\s*)?(?:하차\s*일자|하차일|도착\s*일자|도착일)/i.test(line) && !line.includes('시간')) {
        const d = extractDate(val || line);
        if (d) punloadDate = d;
      }
      // 8. 하차/도착 시간
      else if (/^(?:\d+[.)]\s*)?(?:하차\s*시간|하차시간|하차\s*스케줄|하차|도착\s*시간|도착시간|도착\s*일시|현장도착)/i.test(line)) {
        const d = extractDate(val || line);
        if (d) punloadDate = d;
        punloadTimeStr = val || line.replace(/^.*[:：]\s*/, '');
      }
      // 7. 신청 모델 / 장비 규격 및 수량
      else if (/^(?:\d+[.)]\s*)?(?:신청.*모델.*목록|신청모델|모델명?|장비명?|규격|기종|장비)/i.test(line) || /^\s*-\s*(?:GS|SJ|JCPT|HD|고소)/i.test(line)) {
        const raw = val || line.replace(/^.*[:：]/, '').replace(/^-\s*/, '');
        raw.split(/[/,]/).forEach(p => {
          const m = p.match(/(.+?)\s*[*xX대]\s*(\d+)/) || p.match(/(.+?)\s*(\d+)\s*대/);
          if (m) peqs.push({ modelName: m[1].replace(/대$/, '').trim(), qty: parseInt(m[2]) || 1 });
          else if (p.trim()) peqs.push({ modelName: p.trim(), qty: 1 });
        });
      }
      // 8. 운송비 부담 귀속선
      else if (/^(?:\d+[.)]\s*)?(?:운송비\s*부담|운송비|배차비|용차비)/i.test(line)) {
        const target = (val || line).toLowerCase();
        if (target.includes('당사') || target.includes('기연') || target.includes('당사부담') || target.includes('우리')) ppaidby = 'OURS';
        else if (target.includes('고객') || target.includes('업체') || target.includes('거래처') || target.includes('착불')) ppaidby = 'CUSTOMER';
        else if (target.includes('반반') || target.includes('50') || target.includes('절반')) ppaidby = 'SPLIT';
      }
      // 9. 대차 회수 장비 / 기존 장비
      else if (/^(?:\d+[.)]\s*)?(?:회수\s*장비|회수\s*자산|기존\s*장비|대차\s*장비|교체\s*장비)/i.test(line)) {
        const target = val || line.replace(/^.*[:：]\s*/, '');
        if (target.includes('모름') || target.includes('확인필요')) {
          pretrieval = ['UNKNOWN'];
        } else {
          const nums = target.match(/\d{3,5}/g);
          if (nums && nums.length > 0) pretrieval = nums;
        }
      }
      // 10. 특이사항 / 비고 / 메모
      else if (/^(?:\d+[.)]\s*)?(?:특이사항|비고|메모|요청사항)/i.test(line)) {
        pnote = val || line.replace(/^.*[:：]\s*/, '');
      }
      // 11. 시차 출고 메모
      else if (/^(?:\d+[.)]\s*)?(?:시차|순차|게이트\s*진입)/i.test(line)) {
        pstaggered = val || line.replace(/^.*[:：]\s*/, '');
      }
    });

    // ── 텍스트 전체 자연어 스캔 보강 (업무유형, 운송비, 안전옵션) ─────────
    const textLower = text.toLowerCase().replace(/\s+/g, '');

    // 업무 유형 자동 판별
    let targetContext: CallContext = 'ADDITIONAL'; // 기본: 기존현장 출고
    if (/대차|교체|맞교환|회수후출고/i.test(text)) {
      targetContext = 'EXCHANGE';
    } else if (/신규고객|신규업체|첫거래|신규출고/i.test(text)) {
      targetContext = 'NEW_CUSTOMER';
    }
    setSelectedContext(targetContext);

    // 운송비 귀속선 보강
    if (!ppaidby) {
      if (/당사부담|기연부담|당사비용|당사지출/i.test(textLower)) ppaidby = 'OURS';
      else if (/고객부담|거래처부담|업체부담|착불/i.test(textLower)) ppaidby = 'CUSTOMER';
      else if (/반반|50:50|절반/i.test(textLower)) ppaidby = 'SPLIT';
    }
    if (ppaidby) setPaidBy(ppaidby);

    // 안전옵션 & 보양 자동 감지
    const detectedSafety = new Set<string>();
    if (/과부하/i.test(textLower)) detectedSafety.add('과부하방지장치');
    if (/협착|감지봉|상부센서/i.test(textLower)) detectedSafety.add('협착방지대');
    if (/경광등/i.test(textLower)) detectedSafety.add('경광등');
    if (/소화기/i.test(textLower)) detectedSafety.add('소화기');
    if (/러버패드|바닥보양|패드/i.test(textLower)) detectedSafety.add('러버패드');
    if (/타이어커버|바퀴커버/i.test(textLower)) detectedSafety.add('타이어커버');
    if (/도색|도장/i.test(textLower)) detectedSafety.add('도색');
    if (/함석|철망/i.test(textLower)) detectedSafety.add('함석/철망');
    if (/발판|보조발판/i.test(textLower)) detectedSafety.add('보조발판');
    if (detectedSafety.size > 0) {
      setSelectedSafetyOptions(prev => new Set([...prev, ...detectedSafety]));
    }

    // 고객사 & 현장 매칭 + 상세주소 연동 (스키마 정합성)
    if (pc) {
      const mc = findCustomerByNormalizedName(customers, pc);
      if (mc) {
        setSelectedCustomer(mc);
        if (ps) {
          const cleanSite = ps.replace(/\s/g, '');
          const ms = sites.find(s => s.customerId === mc.id &&
            (s.name.replace(/\s/g, '') === cleanSite || s.name.includes(ps) || ps.includes(s.name)));
          if (ms) {
            setSelectedSite(ms);
            setSelectedSiteAddress(paddr || ms.address || '');
            applyInheritance(mc, ms);
            loadSiteSafetyOptions(ms, mc);
          } else {
            setIsRegisteringNewSite(true);
            setNewSiteName(ps);
            if (paddr) setNewSiteAddress(paddr);
            applyInheritance(mc, null);
            loadSiteSafetyOptions(null, mc);
          }
        } else {
          if (paddr) setSelectedSiteAddress(paddr);
          applyInheritance(mc, null);
          loadSiteSafetyOptions(null, mc);
        }
      } else {
        // DB 미등록 고객사일 경우 신규 고객 모드로 자동 지원
        setSelectedContext('NEW_CUSTOMER');
        setNewCustomerName(pc);
        if (ps) setNewSiteName(ps);
        if (paddr) {
          setNewSiteAddress(paddr);
          setNewCustomerAddress(paddr);
        }
      }
    } else if (paddr) {
      setSelectedSiteAddress(paddr);
    }

    // 담당자 및 연락처
    if (pscname) setContactPerson(pscname);
    if (pscphone) setContactPhone(pscphone);

    // 장비 목록
    if (peqs.length > 0) setEquipments(peqs);

    // 상차 일정 및 시간
    if (ploadDate) setLoadingDate(ploadDate);
    if (ploadTimeStr) {
      const lt = extractTime(ploadTimeStr);
      if (lt.type) {
        setLoadingTimeType(lt.type);
        if (lt.val) setLoadingTimeVal(lt.val);
      }
    }

    // 하차 일정 및 시간
    if (punloadDate) setUnloadingDate(punloadDate);
    else if (ploadDate) setUnloadingDate(ploadDate);

    if (punloadTimeStr) {
      const ut = extractTime(punloadTimeStr);
      if (ut.type) {
        setUnloadingTimeType(ut.type);
        if (ut.val) setUnloadingTimeVal(ut.val);
      }
    }

    // 대차 회수 장비
    if (pretrieval.length > 0) {
      setRetrievalAssetIds(pretrieval);
    }

    // 메모
    if (pnote) setNote(pnote);
    if (pstaggered) setStaggeredMemo(pstaggered);

    setPasteZoneOpen(false);
    showToast('폼 데이터 변환 완료 — 9대 필수 스키마 실드가 자동 반영되었습니다.');
  }, [customers, sites, applyInheritance, loadSiteSafetyOptions, showToast]);

  // ── 폼 초기화 ─────────────────────────────────────────────────────────────
  const resetForm = () => {
    setSelectedCustomer(null); setSelectedSite(null);
    setSelectedSiteAddress(''); setIsRegisteringNewSite(false);
    setCustomerQuery(''); setSiteQuery('');
    setEquipments([]);
    setLoadingDate(''); setLoadingTimeVal(''); setLoadingTimeType(null);
    setUnloadingDate(''); setUnloadingTimeVal(''); setUnloadingTimeType(null);
    setContactPerson(''); setContactPhone(''); setNote('');
    setNewCustomerName(''); setNewCustomerPhone(''); setNewCustomerAddress('');
    setNewSiteName(''); setNewSiteAddress('');
    setRetrievalAssetIds([]); setPaidBy(null);
    setSelectedSafetyOptions(new Set()); setInitialSiteOptions(new Set());
    setNewOptionInput('');
    setStaggeredMemo('');
    setSelectedContext(null);
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
    const hasContext = selectedContext !== null;

    const custName = isNewCustomerMode ? newCustomerName.trim() : (selectedCustomer?.name || '');
    const siteNameVal = (isNewCustomerMode || isRegisteringNewSite ? newSiteName : (selectedSite?.name || '')).trim();
    const addrVal = isNewCustomerMode
      ? (newSiteAddress || newCustomerAddress || '').trim()
      : isRegisteringNewSite
        ? newSiteAddress.trim()
        : (selectedSiteAddress || selectedSite?.address || '').trim();
    const hasEquip = hasContext && (equipments.length > 0 && equipments.every(e => e.modelName && e.qty > 0));
    const hasDate = !!loadingDate.trim();
    const hasTime = loadingTimeType === 'ASAP' || loadingTimeType === 'MORNING' || loadingTimeType === 'AFTERNOON' || (loadingTimeType === 'EXACT' && !!loadingTimeVal.trim());
    const hasContactPerson = !!contactPerson.trim();
    const cleanPhone = contactPhone.replace(/[^0-9]/g, '');
    const hasContactPhone = cleanPhone.length >= 9;

    const timeDisplay = !loadingTimeType
      ? '(상차시간 미지정)'
      : loadingTimeType === 'ASAP'
        ? 'ASAP (최우선)'
        : loadingTimeType === 'MORNING'
          ? '오전'
          : loadingTimeType === 'AFTERNOON'
            ? '오후'
            : loadingTimeVal || '(시간 직접입력 필요)';

    const rules: ValidationRule[] = [
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
        targetBlock: 'WHERE',
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
        currentVal: !hasContext
          ? '(업무유형 먼저 선택)'
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
        currentVal: timeDisplay,
        hint: '상차 예정 시간 (ASAP, 오전, 오후 또는 시간지정)',
      },
    ];

    // 🌟 대차(EXCHANGE) 업무일 때만 회수 전자산 검증 항목 추가 (일반 출고 시 거짓 녹색불 방지)
    if (isExchangeMode) {
      rules.push({
        id: 'RETRIEVAL_ASSET',
        label: '회수 전자산 (대차전용)',
        targetBlock: 'SAFETY_COST',
        status: retrievalAssetIds.length > 0 ? 'VALID' : 'INVALID',
        currentVal: retrievalAssetIds.length > 0
          ? (isUnknownRetrieval ? '모름 (현장 확인 후 회수)' : `자산 #${retrievalAssetIds.join(', #')} (총 ${retrievalAssetIds.length}대)`)
          : '(회수 대상 미지정)',
        hint: '대차(EXCHANGE) 시 회수할 전자산 (관리번호 모를 시 "모름" 선택 가능)',
      });
    }

    return rules;
  }, [
    isNewCustomerMode, isExchangeMode, isRegisteringNewSite, newCustomerName, selectedCustomer,
    newSiteName, selectedSite, selectedSiteAddress, newSiteAddress, newCustomerAddress,
    selectedContext, equipments, totalQty,
    loadingDate, loadingTimeType, loadingTimeVal, contactPerson, contactPhone,
    retrievalAssetIds, isUnknownRetrieval
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
        const optionLabels = Array.from(selectedSafetyOptions);
        const paidOpts = optionLabels.filter(label => !isProtectionOption(label)).join(', ');
        const protOpts = optionLabels.filter(label => isProtectionOption(label)).join(', ') || 'NONE';

        db.updateRow<CustomerSite>('sites', selectedSite.id, {
          paidOptions: paidOpts,
          protection: protOpts,
          address: selectedSiteAddress || selectedSite.address,
          updatedAt: new Date().toISOString(),
        });
        await db.awaitPendingWrites();
        showToast(`현장 '${selectedSite.name}'의 기본 옵션이 갱신 저장되었습니다.`, 'info');
      }

      const siteConf: ConfidenceLevel = selectedSite ? 'HIGH' : 'MISSING';
      const siteSrc: ScoredField['source'] = selectedSite ? 'DB' : 'MANUAL';
      const loadConf: ConfidenceLevel = loadingDate ? 'HIGH' : 'MISSING';
      const timeStr = loadingTimeType === 'ASAP'
        ? 'ASAP'
        : loadingTimeType === 'MORNING'
          ? '오전'
          : loadingTimeType === 'AFTERNOON'
            ? '오후'
            : loadingTimeVal || '08:00';
      const timeConf: ConfidenceLevel = loadingTimeType ? 'HIGH' : 'MISSING';
      const effectiveAddress = isNewCustomerMode
        ? (newSiteAddress || newCustomerAddress || '').trim()
        : isRegisteringNewSite
          ? newSiteAddress.trim()
          : (selectedSiteAddress || selectedSite?.address || '').trim();

      const fullNote = [
        note,
        unloadingDate ? `[하차일정] ${unloadingDate} ${unloadingTimeType === 'ASAP' ? 'ASAP' : unloadingTimeType === 'MORNING' ? '오전' : unloadingTimeType === 'AFTERNOON' ? '오후' : unloadingTimeVal || ''}`.trim() : '',
        selectedSafetyOptions.size > 0 ? `[옵션] ${Array.from(selectedSafetyOptions).join(', ')}` : '',
        staggeredMemo ? `[시차출고] ${staggeredMemo}` : '',
        isExchangeMode && retrievalAssetIds.length > 0
          ? (isUnknownRetrieval ? '[대차회수대상] 모름 (현장 확인 후 회수)' : `[대차회수대상] 자산 #${retrievalAssetIds.join(', #')}`)
          : '',
        effectiveAddress ? `[현장상세주소] ${effectiveAddress}` : '',
        vehicleType ? `[차종] ${vehicleType}` : '',
      ].filter(Boolean).join(' | ');

      await createDraftOrder({
        ownerId: uploaderId,
        sourceCallIds: [],
        context: selectedContext ? [selectedContext] : [],
        customerName: isNewCustomerMode
          ? { value: newCustomerName, confidence: 'LOW' as ConfidenceLevel, source: 'MANUAL' as const, confirmed: false }
          : { value: selectedCustomer!.name, confidence: 'HIGH' as ConfidenceLevel, source: 'DB' as const, confirmed: true },
        siteName: isNewCustomerMode || isRegisteringNewSite
          ? { value: newSiteName || '미정', confidence: 'LOW' as ConfidenceLevel, source: 'MANUAL' as const, confirmed: false }
          : { value: selectedSite?.name || '미정', confidence: siteConf, source: siteSrc, confirmed: !!selectedSite },
        equipments: [...equipments],
        loadingDate: { value: loadingDate, confidence: loadConf, source: 'MANUAL' as const, confirmed: !!loadingDate },
        loadingTime: { value: timeStr, confidence: timeConf, source: 'MANUAL' as const, confirmed: !!timeStr },
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
    let matchedCustomer: Customer | null = null;
    if (draft.isNewCustomer) {
      setSelectedCustomer(null);
      setNewCustomerName(draft.customerName.value || '');
    } else {
      const mc = customers.find(c => c.name === draft.customerName.value) || findCustomerByNormalizedName(customers, draft.customerName.value);
      if (mc) {
        matchedCustomer = mc;
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
        setSelectedSiteAddress(draft.siteAddress || ms.address || '');
        setIsRegisteringNewSite(false);
        setSiteQuery('');
        loadSiteSafetyOptions(ms, matchedCustomer);
      } else {
        setSelectedSite(null);
        setSelectedSiteAddress('');
        setIsRegisteringNewSite(true);
        setNewSiteName(draft.siteName.value);
        setNewSiteAddress(draft.siteAddress || '');
        if (matchedCustomer) {
          loadSiteSafetyOptions(null, matchedCustomer);
        }
      }
    } else {
      setSelectedSite(null);
      setSelectedSiteAddress('');
      setIsRegisteringNewSite(false);
      if (matchedCustomer) {
        loadSiteSafetyOptions(null, matchedCustomer);
      }
    }
    if (draft.siteAddress && !draft.siteName?.value) {
      setNewSiteAddress(draft.siteAddress);
    }

    // 4. 장비
    setEquipments(draft.equipments || []);

    // 5. 현장 담당자
    setContactPerson(draft.contactPerson?.value || '');
    const cPhone = typeof draft.contactPhone === 'string' ? draft.contactPhone : (draft.contactPhone as any)?.value || '';
    setContactPhone(cPhone);

    // 6. 상차일시 및 시간 구분
    setLoadingDate(draft.loadingDate?.value || '');
    const ltv = draft.loadingTime?.value || '';
    if (ltv === 'ASAP') { setLoadingTimeType('ASAP'); setLoadingTimeVal(''); }
    else if (ltv === '오전') { setLoadingTimeType('MORNING'); setLoadingTimeVal(''); }
    else if (ltv === '오후') { setLoadingTimeType('AFTERNOON'); setLoadingTimeVal(''); }
    else if (ltv) { setLoadingTimeType('EXACT'); setLoadingTimeVal(ltv); }
    else { setLoadingTimeType(null); setLoadingTimeVal(''); }

    // 6-2. 하차일시 및 시간 구분
    setUnloadingDate(draft.unloadingDate || '');
    setUnloadingTimeType(draft.unloadingTimeType || null);
    setUnloadingTimeVal(draft.unloadingTimeVal || '');

    // 6-3. 대차 회수장비, 운송비 귀속선, 차종, 시차출고
    setRetrievalAssetIds(draft.retrievalAssetIds || []);
    setPaidBy(draft.paidBy || null);
    setStaggeredMemo(draft.staggeredMemo || '');
    setVehicleType(draft.vehicleType || '5T');

    // 7. 메모 및 안전옵션 파싱
    const noteText = draft.note || '';
    setNote(noteText);
    if (draft.safetyOptions && draft.safetyOptions.length > 0) {
      setSelectedSafetyOptions(new Set(draft.safetyOptions));
    } else {
      const parsedOpts = new Set<string>();
      if (noteText.includes('협착방지봉') || noteText.includes('상부센서')) parsedOpts.add('협착방지봉 / 상부센서 (4EA)');
      if (noteText.includes('소화기')) parsedOpts.add('소화기함 / 분말소화기');
      if (noteText.includes('철망')) parsedOpts.add('4면 철망 (안전 낙하방지망)');
      if (noteText.includes('인버터')) parsedOpts.add('인버터 설치');
      if (noteText.includes('논마킹') || noteText.includes('백색타이어')) parsedOpts.add('백색 논마킹 타이어');
      if (noteText.includes('보양')) parsedOpts.add('4면 철망 보양');
      if (parsedOpts.size > 0) {
        setSelectedSafetyOptions(parsedOpts);
      }
    }

    setActiveTab('NEW');
    setOpenBlock('WHAT');
    showToast(`'${draft.customerName.value || '선택 의뢰'}' 데이터를 새 의뢰 작성으로 가져왔습니다.`, 'info');
  };

  // ── 병합 ─────────────────────────────────────────────────────────────────
  const handleMerge = async () => {
    if (selectedQueueIds.size < 2) { showToast('2건 이상 선택하세요.', 'error'); return; }
    const selected = queue.filter(d => selectedQueueIds.has(d.id));

    // 🛡️ [고객사 일치 검증 가드]
    const firstCustomer = selected[0].customerName.value;
    if (selected.some(d => d.customerName.value !== firstCustomer)) {
      showToast('서로 다른 거래처(고객사)의 의뢰 초안은 하나로 병합할 수 없습니다.', 'error');
      return;
    }

    // 🛡️ [동일 규격 장비 수량 합산 (SUM)]
    const modelQtyMap = new Map<string, number>();
    selected.flatMap(d => d.equipments || []).forEach(e => {
      modelQtyMap.set(e.modelName, (modelQtyMap.get(e.modelName) || 0) + (Number(e.qty) || 1));
    });
    const mergedEquipments: EquipmentItem[] = Array.from(modelQtyMap.entries()).map(([modelName, qty]) => ({ modelName, qty }));

    try {
      await mergeDrafts(Array.from(selectedQueueIds), {
        customerName: selected[0].customerName,
        siteName: selected[0].siteName,
        equipments: mergedEquipments,
        loadingDate: selected[0].loadingDate,
        loadingTime: selected[0].loadingTime,
        contactPerson: selected[0].contactPerson,
        contactPhone: typeof selected[0].contactPhone === 'string' ? selected[0].contactPhone : selected[0].contactPhone?.value || '',
        note: selected.map(d => d.note).filter(Boolean).join(' / '),
      });
      await loadDrafts();
      setSelectedQueueIds(new Set());
      showToast('병합 완료 — 동일 모델 수량 합산 및 단일 의뢰로 통합 저장되었습니다.');
    } catch (e: any) {
      showToast(`병합 실패: ${e?.message}`, 'error');
    }
  };

  // ── 🌟 [WTT 결함 해결 2] 출고 확정 시 실제 배차 대장(deliveries) 실시간 생성 ──
  const handleSubmitDraft = async (draft: DraftOrder) => {
    if (draft.isNewCustomer && !draft.customerRegistered) {
      showToast('신규 고객 정식 등록 전 배차 차단 — 관리부 등록 완료 후 처리 가능합니다.', 'error');
      return;
    }

    if (!canSave) {
      showToast('출고의뢰 및 배차 등록 권한이 없습니다.', 'error');
      return;
    }

    // 🛡️ [현장 상세 주소 복원/해결]
    const custObj = customers.find(c => c.name === draft.customerName.value);
    const siteObj = custObj ? sites.find(s => s.customerId === custObj.id && (s.name === draft.siteName.value || s.name.includes(draft.siteName.value))) : null;
    const resolvedAddress = (draft.siteAddress || siteObj?.address || '').trim();

    if (!resolvedAddress) {
      showToast('현장 상세주소가 누락되었습니다. [새의뢰 작성으로 가져오기]를 눌러 주소를 보완해주세요.', 'error');
      return;
    }

    const contactPhoneVal = typeof draft.contactPhone === 'string' ? draft.contactPhone : (draft.contactPhone as any)?.value || '';
    if (!contactPhoneVal) {
      showToast('현장 담당자 연락처가 누락되었습니다. [새의뢰 작성으로 가져오기]를 눌러 연락처를 보완해주세요.', 'error');
      return;
    }

    try {
      const unloadingStr = draft.unloadingDate
        ? `${draft.unloadingDate} ${draft.unloadingTimeVal || (draft.unloadingTimeType === 'ASAP' ? 'ASAP' : draft.unloadingTimeType === 'MORNING' ? '오전' : draft.unloadingTimeType === 'AFTERNOON' ? '오후' : '')}`.trim()
        : `${draft.loadingDate.value} ${draft.loadingTime.value}`.trim();

      const isExchange = draft.context?.includes('EXCHANGE');

      // AppContext의 saveSmartDispatch 풀 파이프라인 호출
      const res = await saveSmartDispatch({
        customerName: draft.customerName.value,
        siteName: draft.siteName.value,
        siteAddress: resolvedAddress,
        siteContactName: draft.contactPerson.value,
        siteContactPhone: contactPhoneVal,
        siteContactEmail: '',
        billingContactName: '',
        billingContactPhone: '',
        statementEmail: '',
        taxBillEmail: '',
        loadingTime: `${draft.loadingDate.value} ${draft.loadingTime.value}`.trim(),
        unloadingTime: unloadingStr,
        equipments: draft.equipments,
        note: draft.note,
        rawText: `[출고의뢰통합 확정] ${draft.context.join(', ')}`,
        vehicleType: draft.vehicleType || '5T',
        paidBy: draft.paidBy || undefined,
        billableToCustomer: false,
        type: isExchange ? 'EXCHANGE' : 'OUTBOUND',
        retrievalAssetIds: draft.retrievalAssetIds || [],
        paidOptions: draft.safetyOptions?.join(', ') || '',
      } as any, true);

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
    try {
      await discardDraft(id);
      await loadDrafts();
      showToast('초안이 폐기되었습니다.', 'info');
    } catch {
      setQueue(prev => prev.filter(d => d.id !== id));
      showToast('초안이 큐에서 제거되었습니다.', 'info');
    }
  };

  // ── 통화 파일 ➔ 초안 즉시 생성 ─────────────────────────────
  const handleConvertUploadToDraft = async (uploadId: string) => {
    try {
      setIsConvertingId(uploadId);
      const newDraft = await convertUploadToDraft(uploadId);
      await Promise.all([loadDrafts(), loadUploadsAndLogs()]);
      showToast(`출고의뢰 초안이 생성되었습니다. (ID: ${newDraft.id.slice(0, 8)}...)`, 'success');
    } catch (err: any) {
      showToast(`초안 생성 실패: ${err?.message}`, 'error');
    } finally {
      setIsConvertingId(null);
    }
  };

  // ── 통화 파일 ➔ 새 의뢰 작성 폼으로 로드 ──────────────────
  const handleLoadUploadToForm = (upload: CallUploadRecord) => {
    const phone = upload.callerPhone || parsePhoneFromFileName(upload.fileName);
    const rawCtx = (upload.callContext && upload.callContext[0]) ? upload.callContext[0] : 'ADDITIONAL';
    const ctx: CallContext = (rawCtx === 'NEW_CUSTOMER' || rawCtx === 'EXCHANGE') ? rawCtx : 'ADDITIONAL';

    // 1. 업무 맥락 설정
    setSelectedContext(ctx);

    // 2. 전화번호 매칭 시도
    if (phone) {
      const cleanDigits = phone.replace(/[^0-9]/g, '');
      const matchedCust = customers.find(c => {
        const p1 = (c.repContact || '').replace(/[^0-9]/g, '');
        return p1 && cleanDigits && (p1.includes(cleanDigits) || cleanDigits.includes(p1));
      });
      if (matchedCust) {
        setSelectedContext(ctx);
        setSelectedCustomer(matchedCust);
        setNewCustomerName('');
      } else {
        setSelectedContext('NEW_CUSTOMER');
        setSelectedCustomer(null);
        setNewCustomerName('');
      }
      setContactPhone(phone);
    }

    // 3. 파일 참조 메모
    const fileMemo = `[통화 녹음 파일 연계] ${upload.fileName}${upload.summaryText ? ` | ${upload.summaryText}` : ''}`;
    setNote(fileMemo);

    // 4. 탭 전환
    setActiveTab('NEW');
    setOpenBlock('WHO');
    showToast(`통화 파일(${upload.fileName}) 데이터를 새 의뢰 폼으로 로드했습니다.`, 'info');
  };

  // ── 통화 파일 업로드 항목 삭제 ─────────────────────────────
  const handleDeleteUpload = async (upload: CallUploadRecord) => {
    if (!window.confirm(`통화 녹음 [${upload.fileName}] 항목을 삭제하시겠습니까?\n(스토리지 파일 및 업로드 기록이 삭제됩니다)`)) return;
    try {
      setCallUploads(prev => prev.filter(u => u.id !== upload.id));
      await deleteCallUpload(upload.id, upload.storagePath);
      await loadUploadsAndLogs();
      showToast(`통화 녹음 항목(${upload.fileName})이 삭제되었습니다.`, 'info');
    } catch (err: any) {
      await loadUploadsAndLogs();
      showToast(`삭제 실패: ${err?.message}`, 'error');
    }
  };

  // ── 파이프라인 디버깅용 실시간 테스트 로그 발행 ────────────
  const handleSendTestLog = async () => {
    try {
      await insertPipelineLog({
        eventType: 'DEBUG_SIGNAL',
        level: 'INFO',
        message: `실시간 파이프라인 모니터 수동 진단 신호 (${new Date().toLocaleTimeString('ko-KR')})`,
        payload: {
          testBy: currentUser?.id || 'sys-admin',
          source: 'smart_dispatch4',
          activeTab,
          pendingDrafts: queue.length,
          callUploadsCount: callUploads.length,
        },
      });
      showToast('테스트 이벤트 로그를 전송했습니다.', 'info');
    } catch (e: any) {
      showToast(`로그 전송 실패: ${e?.message}`, 'error');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더: 새 의뢰 탭 (PC 2열 마스터-디테일 스튜디오)
  // ─────────────────────────────────────────────────────────────────────────
  const renderNewTab = () => {
    const custDisplay = isNewCustomerMode ? (newCustomerName || '(신규 고객명 미입력)') : (selectedCustomer?.name || '(고객사 미선택)');
    const siteDisplay = isNewCustomerMode
      ? (newSiteName || '(신규 현장명 미입력)')
      : isRegisteringNewSite
        ? (newSiteName || '(신규 현장명 미입력)')
        : (selectedSite?.name || '(현장 미선택)');
    const addrDisplay = isNewCustomerMode
      ? (newSiteAddress || newCustomerAddress || '(주소 미입력)')
      : isRegisteringNewSite
        ? (newSiteAddress || '(신규 현장주소 미입력)')
        : (selectedSiteAddress || selectedSite?.address || '(주소 미등록)');

    return (
      <div className="dispatch4-studio-row">
        {/* ── 좌측 입력 섹션 (57% 마스터 스트림 / 독자 상하 스크롤) ────────────────── */}
        <div className="dispatch4-left-pane dispatch4-scrollbar">

          {/* 블록 제어 바 */}
          <div className="flex items-center justify-between px-1 py-0.5 text-xs text-slate-400">
            <span className="text-[11px] font-semibold text-slate-400">
              5단계 의뢰 서식 ({openBlocks.size}/5 블록 열림)
            </span>
            <button
              type="button"
              onClick={toggleAllBlocks}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-850 hover:bg-slate-750 text-slate-300 hover:text-white transition border border-slate-750 shadow-sm"
            >
              {openBlocks.size === 5 ? '전체 블록 접기' : '전체 블록 펼치기'}
            </button>
          </div>

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
                  placeholder="카톡, 문자, 이메일 의뢰 원문을 붙여넣거나 [파일 불러오기]를 실행한 뒤 [폼 데이터 변환 (추출)]을 누르세요."
                  rows={5}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-y"
                />
                <div className="flex items-center justify-between">
                  {/* 파일 불러오기 버튼 (이미지 1 기능 연동) */}
                  <div className="flex items-center gap-2">
                    <input
                      ref={txtFileInputRef}
                      type="file"
                      accept=".txt,.csv,.log,text/plain"
                      style={{ display: 'none' }}
                      onChange={handleTextFileChange}
                    />
                    <button
                      type="button"
                      onClick={() => txtFileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 hover:border-amber-500/50 transition shadow-sm cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                      <span>파일 불러오기</span>
                    </button>
                  </div>

                  {/* 우측 닫기 & 폼 데이터 변환(추출) 버튼 */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setPasteText(''); setPasteZoneOpen(false); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      닫기
                    </button>
                    <button
                      type="button"
                      onClick={() => runParse(pasteText)}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>폼 데이터 변환 (추출)</span>
                    </button>
                  </div>
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
                openBlocks.has('WHO') ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
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
              {openBlocks.has('WHO') ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlocks.has('WHO') && (
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
                            setSelectedSiteAddress('');
                            setContactPerson('');
                            setContactPhone('');
                            setCustomerQuery('');
                            setSiteQuery('');
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
                openBlocks.has('WHERE') ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('WHERE')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <span>2. WHERE — 투입 현장 및 현장 담당자</span>
                {!isNewCustomerMode && isRegisteringNewSite && (
                  <span className="text-[11px] font-semibold text-purple-300 bg-purple-950/50 px-2 py-0.5 rounded border border-purple-500/30">
                    + [신규현장] {newSiteName || '현장명 입력대기'}{contactPerson ? ` (${contactPerson})` : ''}
                  </span>
                )}
                {!isNewCustomerMode && !isRegisteringNewSite && selectedSite && (
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
              {openBlocks.has('WHERE') ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlocks.has('WHERE') && (
              <div className="dispatch4-block-body">
                {isNewCustomerMode ? (
                  /* 1. 신규 고객사 모드: 신규 현장명/주소/담당자 */
                  <div className="flex flex-col gap-3">
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
                      <label className="text-xs font-semibold text-slate-300">현장 상세주소 *</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-blue-500"
                        value={newSiteAddress}
                        onChange={e => setNewSiteAddress(e.target.value)}
                        placeholder="기사 배차용 도로명 주소 (예: 경기도 평택시 고덕면 ...)"
                      />
                    </div>
                    <div className="pt-2 border-t border-slate-800 flex flex-col gap-2">
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
                ) : !selectedCustomer ? (
                  /* 2. 고객사 미선택 시 안내 */
                  <div className="p-5 bg-slate-950/60 border border-slate-800 rounded-xl text-center flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                    <MapPin className="w-5 h-5 text-slate-500" />
                    <span className="font-bold text-slate-300">고객사를 먼저 선택하십시오</span>
                    <span className="text-[11px] text-slate-500">1. WHO 블록에서 거래처(고객사)를 지정하면 해당 고객사의 등록 현장 목록이 표시됩니다.</span>
                  </div>
                ) : isRegisteringNewSite ? (
                  /* 3. 신규 현장 등록 모드 (퀵카드/버튼 클릭 시) */
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between p-2.5 bg-purple-950/40 border border-purple-800/60 rounded-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-purple-300">신규 현장 등록</span>
                        <span className="text-[11px] text-slate-400">({selectedCustomer.name})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsRegisteringNewSite(false);
                          setNewSiteName('');
                          setNewSiteAddress('');
                          applyInheritance(selectedCustomer, null);
                        }}
                        className="flex items-center gap-1 text-[11px] font-bold text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>기존현장 목록</span>
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">신규 현장명 *</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-purple-500"
                        value={newSiteName}
                        onChange={e => setNewSiteName(e.target.value)}
                        placeholder="예: 송도 바이오클러스터 4공구"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-300">신규 현장 상세주소 *</label>
                      <input
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-purple-500"
                        value={newSiteAddress}
                        onChange={e => setNewSiteAddress(e.target.value)}
                        placeholder="배차 기사용 정확한 도로명 주소"
                      />
                    </div>
                    <div className="pt-2 border-t border-slate-800 flex flex-col gap-2">
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
                ) : selectedSite ? (
                  /* 4. 기존 현장 선택 완료 상태 (수동 입력창 완전 은폐, 주소 인라인 보정 지원) */
                  <div className="flex flex-col gap-3">
                    <div className="p-3 bg-slate-950/80 border border-cyan-500/50 rounded-xl flex flex-col gap-2.5">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-cyan-400" />
                          <span className="font-extrabold text-white text-sm">{selectedSite.name}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                            기존 등록 현장
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSite(null);
                            setSelectedSiteAddress('');
                            setSiteQuery('');
                            applyInheritance(selectedCustomer, null);
                          }}
                          className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-red-300 px-2 py-1 rounded bg-slate-850 hover:bg-slate-800 border border-slate-750 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>현장 변경</span>
                        </button>
                      </div>

                      {/* 현장 상세주소 (인라인 확인 및 수정) */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                          <span>현장 상세주소 (배차 기사용) *</span>
                          <span className="text-[10px] text-slate-500">필요 시 수정 가능</span>
                        </label>
                        <input
                          className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-cyan-500"
                          value={selectedSiteAddress}
                          onChange={e => setSelectedSiteAddress(e.target.value)}
                          placeholder="배차 기사용 현장 주소"
                        />
                      </div>

                      {/* 현장 담당자 정보 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-slate-300">현장 담당자 성명 *</label>
                          <input
                            className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-cyan-500"
                            value={contactPerson}
                            onChange={e => setContactPerson(e.target.value)}
                            placeholder="현장 인수 소장/담당자명"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-slate-300">인수 담당자 연락처 *</label>
                          <input
                            className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-cyan-500"
                            value={contactPhone}
                            onChange={e => setContactPhone(e.target.value)}
                            placeholder="010-0000-0000"
                            inputMode="tel"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 5. 현장 선택 대기 상태 (검색 인풋 + [신규현장 등록] 버튼 + 기존 현장 칩) */
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-cyan-500"
                          value={siteQuery}
                          onChange={e => setSiteQuery(e.target.value)}
                          placeholder={`${selectedCustomer.name} 등록 현장 검색 (초성 가능)...`}
                        />
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsRegisteringNewSite(true);
                          setSelectedSite(null);
                          setSelectedSiteAddress('');
                          setNewSiteName('');
                          setNewSiteAddress('');
                          setContactPerson('');
                          setContactPhone('');
                          if (selectedCustomer) {
                            loadSiteSafetyOptions(null, selectedCustomer);
                          }
                        }}
                        className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-purple-900/60 hover:bg-purple-800/70 text-purple-200 border border-purple-600/70 whitespace-nowrap transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>신규현장 등록</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1.5 bg-slate-950/60 rounded-lg border border-slate-800">
                      {filteredSites.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectSite(s)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition border bg-slate-850 border-slate-750 text-slate-200 hover:bg-slate-750 hover:border-cyan-500/50 hover:text-white flex items-center gap-1.5"
                        >
                          <Building2 className="w-3 h-3 text-cyan-400" />
                          <span>{s.name}</span>
                          {s.address && (
                            <span className="text-[10px] text-slate-400 max-w-[120px] truncate">({s.address})</span>
                          )}
                        </button>
                      ))}
                      {filteredSites.length === 0 && (
                        <div className="text-xs text-slate-400 py-4 px-3 text-center w-full flex flex-col items-center gap-1">
                          <span>일치하는 현장이 없습니다.</span>
                          <span className="text-[11px] text-purple-400">우측 상단의 [+ 신규현장 등록] 버튼을 눌러 새 현장을 추가하세요.</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* WHAT 블록 — 출고 신청 장비 */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlocks.has('WHAT') ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
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
              {openBlocks.has('WHAT') ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlocks.has('WHAT') && (
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
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-bold text-slate-400">
                        선택된 출고 장비 목록 ({equipments.length}종 / 총 {totalQty}대):
                      </span>
                    </div>
                    {equipments.map((eq, idx) => {
                      const spec = EQUIPMENT_SPEC_MATRIX.find(s => s.modelName === eq.modelName);
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between bg-slate-900 hover:bg-slate-850 px-3 py-2 rounded-lg border border-slate-700/80 shadow-sm transition-colors gap-2"
                        >
                          {/* 좌측: 장비 모델명, 제원 힌트 배지(ft, 협폭/광폭) */}
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="w-6 h-6 rounded bg-emerald-950/70 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                              <Package size={13} className="text-emerald-400" style={{ width: 13, height: 13, display: 'block' }} />
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                              <span className="text-xs font-black text-white tracking-tight truncate">{eq.modelName}</span>
                              {spec?.ft && (
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 flex-shrink-0">
                                  {spec.ft}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* 우측: 고밀도 엔터프라이즈 수량 조절기 & 삭제 액션 */}
                          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 shadow-inner flex-shrink-0">
                            {/* 감산 버튼 [-] */}
                            <button
                              type="button"
                              onClick={() => changeQty(idx, -1)}
                              disabled={eq.qty <= 1}
                              className="dispatch4-qty-btn"
                              title={eq.qty <= 1 ? "최소 수량은 1대입니다 (삭제는 우측 휴지통)" : "수량 1대 감소"}
                              aria-label="수량 1대 감소"
                            >
                              <Minus size={14} strokeWidth={2.5} color="currentColor" style={{ width: 14, height: 14, display: 'block' }} />
                            </button>

                            {/* 수량 직접 입력 및 '대' 단위 */}
                            <div className="flex items-center justify-center min-w-[52px] px-0.5">
                              <input
                                type="number"
                                min={1}
                                max={999}
                                value={eq.qty}
                                onChange={e => setModelQty(idx, parseInt(e.target.value) || 1)}
                                className="dispatch4-qty-input"
                                title="수량 직접 입력"
                                aria-label={`${eq.modelName} 수량`}
                              />
                              <span className="text-[11px] text-slate-400 font-bold ml-1 select-none">대</span>
                            </div>

                            {/* 가산 버튼 [+] */}
                            <button
                              type="button"
                              onClick={() => changeQty(idx, 1)}
                              className="dispatch4-qty-btn"
                              title="수량 1대 증가"
                              aria-label="수량 1대 증가"
                            >
                              <Plus size={14} strokeWidth={2.5} color="currentColor" style={{ width: 14, height: 14, display: 'block' }} />
                            </button>

                            {/* 세로 구분선 */}
                            <div className="w-[1px] h-4 bg-slate-700/80 mx-0.5 flex-shrink-0" />

                            {/* 삭제 버튼 [휴지통] */}
                            <button
                              type="button"
                              onClick={() => removeEquipment(idx)}
                              className="dispatch4-delete-btn group"
                              title={`${eq.modelName} 출고 목록에서 삭제`}
                              aria-label={`${eq.modelName} 삭제`}
                            >
                              <Trash2 size={14} strokeWidth={2.2} color="currentColor" style={{ width: 14, height: 14, display: 'block' }} className="transition-colors group-hover:text-red-400" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-4 px-3 bg-slate-950/60 rounded-lg border border-dashed border-slate-800 flex flex-col items-center justify-center gap-1.5 text-xs text-slate-500">
                    <Package size={20} className="text-slate-600" />
                    <span>상단 규격 탭(19ft, 26ft 등)에서 모델을 클릭하여 출고 장비를 추가하세요.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* WHEN 블록 — 상차 vs 하차 일정 및 시간 구분 (ASAP/오전/오후/직접지정) */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlocks.has('WHEN') ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('WHEN')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>4. WHEN — 출고 및 하차 일정</span>
                {loadingDate && (
                  <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30 font-mono">
                    ✓ 상차: {loadingDate} {loadingTimeType === 'ASAP' ? '[ASAP]' : loadingTimeType === 'MORNING' ? '[오전]' : loadingTimeType === 'AFTERNOON' ? '[오후]' : loadingTimeVal || ''}
                  </span>
                )}
              </div>
              {openBlocks.has('WHEN') ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlocks.has('WHEN') && (
              <div className="dispatch4-block-body">
                {/* 상차 일정 */}
                <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5" />
                      <span>상차 (출고) 희망일시 *</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-300">상차 희망일자 *</label>
                      <input
                        type="date"
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-blue-500 font-mono"
                        value={loadingDate}
                        onChange={e => {
                          setLoadingDate(e.target.value);
                          if (!unloadingDate) setUnloadingDate(e.target.value);
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-300">상차 시간 구분 *</label>
                      <div className="dispatch4-slot-group">
                        {[
                          { id: 'ASAP', label: '⚡ ASAP (최우선)' },
                          { id: 'MORNING', label: '🌅 오전' },
                          { id: 'AFTERNOON', label: '🌇 오후' },
                          { id: 'EXACT', label: '⏰ 시간지정' },
                        ].map(slot => (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => {
                              setLoadingTimeType(slot.id as any);
                              if (slot.id !== 'EXACT') setLoadingTimeVal('');
                              else if (!loadingTimeVal) setLoadingTimeVal('08:00');
                            }}
                            className={`dispatch4-slot-btn ${loadingTimeType === slot.id ? 'active' : ''}`}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                      {loadingTimeType === 'EXACT' && (
                        <input
                          type="time"
                          className="bg-slate-800 border border-blue-500 text-white rounded-lg p-1.5 text-xs font-mono mt-1"
                          value={loadingTimeVal}
                          onChange={e => setLoadingTimeVal(e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* 하차 일정 */}
                <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>하차 (현장 도착) 희망일시</span>
                    </label>
                    <span className="text-[10px] text-slate-500">미지정 시 상차 직송으로 간주</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-300">하차 희망일자</label>
                      <input
                        type="date"
                        className="bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-cyan-500 font-mono"
                        value={unloadingDate}
                        onChange={e => setUnloadingDate(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-300">하차 시간 구분</label>
                      <div className="dispatch4-slot-group">
                        {[
                          { id: 'ASAP', label: '⚡ ASAP' },
                          { id: 'MORNING', label: '🌅 오전' },
                          { id: 'AFTERNOON', label: '🌇 오후' },
                          { id: 'EXACT', label: '⏰ 시간지정' },
                        ].map(slot => (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => {
                              setUnloadingTimeType(slot.id as any);
                              if (slot.id !== 'EXACT') setUnloadingTimeVal('');
                              else if (!unloadingTimeVal) setUnloadingTimeVal('13:00');
                            }}
                            className={`dispatch4-slot-btn ${unloadingTimeType === slot.id ? 'active' : ''}`}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                      {unloadingTimeType === 'EXACT' && (
                        <input
                          type="time"
                          className="bg-slate-800 border border-cyan-500 text-white rounded-lg p-1.5 text-xs font-mono mt-1"
                          value={unloadingTimeVal}
                          onChange={e => setUnloadingTimeVal(e.target.value)}
                        />
                      )}
                    </div>
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

          {/* 🌟 SAFETY & COST 블록 — 안전옵션, 대차회수 ───────────── */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm">
            <div
              className={`dispatch4-block-header ${
                openBlocks.has('SAFETY_COST') ? 'bg-blue-950/40 border-b border-blue-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}
              onClick={() => toggleBlock('SAFETY_COST')}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                <Shield className="w-4 h-4 text-purple-400" />
                <span>5. {isExchangeMode ? '안전옵션 · 대차회수' : '안전옵션'}</span>
                {isExchangeMode && (
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                    retrievalAssetIds.length > 0 ? 'bg-cyan-950 text-cyan-300 border-cyan-800' : 'bg-red-950 text-red-300 border-red-800'
                  }`}>
                    {retrievalAssetIds.length > 0
                      ? (isUnknownRetrieval ? '회수: 모름(현장확인)' : `회수: ${retrievalAssetIds.length}대`)
                      : '회수자산 필수'}
                  </span>
                )}
              </div>
              {openBlocks.has('SAFETY_COST') ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openBlocks.has('SAFETY_COST') && (
              <div className="dispatch4-block-body">
                {/* 1. 대차(EXCHANGE) 시 회수 대상 전자산 다수 매핑 지원 */}
                {isExchangeMode && (
                  <div className="p-2.5 bg-cyan-950/40 border border-cyan-500/40 rounded-xl flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black text-cyan-200 flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>회수 대상 전자산 선택 (복수 선택 또는 "모름" 선택) *</span>
                      </label>
                      {retrievalAssetIds.length > 0 && (
                        <span className="text-[10px] text-cyan-300 font-mono font-bold">
                          {isUnknownRetrieval ? '미확정 (현장확인)' : `${retrievalAssetIds.length}대 선택됨`}
                        </span>
                      )}
                    </div>

                    {/* 🌟 "모름 (현장 확인 후 회수)" 퀵 선택 카드 */}
                    <div
                      onClick={toggleUnknownRetrieval}
                      className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer select-none transition ${
                        isUnknownRetrieval
                          ? 'bg-amber-950/60 border-amber-500 text-amber-200 shadow-sm'
                          : 'bg-slate-900 border-slate-750 text-slate-300 hover:bg-slate-850 hover:border-slate-650'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isUnknownRetrieval}
                          onChange={toggleUnknownRetrieval}
                          className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0"
                        />
                        <span className="font-black text-xs text-amber-300">모름 (현장 확인 후 회수)</span>
                        <span className="text-[11px] text-slate-400">현장에서 반납할 장비 관리번호를 모르는 경우 선택</span>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        isUnknownRetrieval ? 'bg-amber-900/80 text-amber-200 border-amber-650' : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        미확정
                      </span>
                    </div>

                    {activeCustomerAssets.length > 0 ? (
                      <div className="dispatch4-exchange-list">
                        {activeCustomerAssets.map(a => {
                          const isChecked = retrievalAssetIds.includes(a.assetNo);
                          return (
                            <label
                              key={a.id}
                              className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer select-none transition ${
                                isChecked
                                  ? 'bg-cyan-950/70 border-cyan-400 text-cyan-100'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850 hover:text-slate-200'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleRetrievalAsset(a.assetNo)}
                                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                                />
                                <span className="font-mono font-bold text-xs text-white">#{a.assetNo}</span>
                                <span className="text-xs">{a.modelName}</span>
                              </div>
                              <span className="text-[10px] text-cyan-400/80 font-mono">현재 대여중</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 py-2.5 text-center bg-slate-950/60 rounded-lg border border-slate-850">
                        {selectedCustomer ? '선택된 고객사에 대여 중인 장비가 없습니다. (상단 "모름" 선택 가능)' : '고객사를 먼저 선택하십시오.'}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. 운송비 부담 귀속선 선택기 */}
                {/* 2. 고객 요청 옵션 및 작업 요구사항 */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-amber-400" />
                      <span>고객 요청 옵션 및 작업 요구사항</span>
                      {selectedSafetyOptions.size > 0 && (
                        <span className="text-[10px] text-amber-400 font-bold bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/50">
                          {selectedSafetyOptions.size}개 등록됨
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleReloadSiteOptions}
                        disabled={!selectedSite && !selectedCustomer}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        title={selectedSite ? "현장 마스터 및 고객사 기본값에서 옵션 불러오기" : selectedCustomer ? "고객사 기본 옵션 불러오기" : "고객사 또는 현장을 먼저 선택하십시오"}
                      >
                        <RefreshCw className="w-3 h-3 text-cyan-400" />
                        <span>현장옵션 불러오기</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveOptionsToCurrentSite}
                        disabled={!selectedSite}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-bold bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 hover:text-white border border-emerald-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        title="현재 등록된 옵션을 이 현장의 기본 옵션으로 영구 저장"
                      >
                        <Save className="w-3 h-3 text-emerald-400" />
                        <span>현장옵션 저장</span>
                      </button>
                    </div>
                  </div>

                  {/* 등록된 옵션 태그 목록 */}
                  {selectedSafetyOptions.size > 0 ? (
                    <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950/60 rounded-lg border border-slate-800">
                      {Array.from(selectedSafetyOptions).map(opt => (
                        <span
                          key={opt}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-950/70 border border-amber-500/60 text-amber-200"
                        >
                          <span>{opt}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(opt)}
                            className="text-amber-400/80 hover:text-red-400 transition"
                            title="옵션 삭제"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 p-2.5 bg-slate-950/40 rounded-lg border border-slate-850 text-center">
                      등록된 고객 요청 옵션이 없습니다. (아래 입력창에 직접 입력하거나 추천 칩 클릭)
                    </div>
                  )}

                  {/* 추천 키워드 칩 (타이핑 단축) */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-semibold">자주 쓰는 요청:</span>
                    {availableOptionSuggestions.map(tag => {
                      const isAdded = selectedSafetyOptions.has(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleOptionTag(tag)}
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition ${
                            isAdded
                              ? 'bg-amber-900/60 border-amber-500 text-amber-200'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750 hover:text-white'
                          }`}
                        >
                          {isAdded ? `✓ ${tag}` : `+ ${tag}`}
                        </button>
                      );
                    })}
                  </div>

                  {/* 영업사원 고객 요구사항 있는 그대로 직접 입력 */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <input
                      type="text"
                      value={newOptionInput}
                      onChange={e => setNewOptionInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddOption();
                        }
                      }}
                      placeholder="고객 요구사항 있는 그대로 입력 (예: 협착봉, 비닐보양, 무분진, 충전선 연장 등)..."
                      className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddOption()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-slate-950 transition flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>추가</span>
                    </button>
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

          {/* 🌟 Gutenberg Z-Pattern 왼쪽 하단 집계 및 감사 요약 바 */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs mt-1">
            <div className="flex items-center gap-2.5">
              <div>
                <span className="text-slate-500 text-[10px] block">출고 신청</span>
                <span className="font-bold text-emerald-400 font-mono text-xs">{totalQty}대</span>
              </div>
              {isExchangeMode && (
                <>
                  <div className="w-px h-5 bg-slate-800" />
                  <div>
                    <span className="text-slate-500 text-[10px] block">회수 대상</span>
                    <span className="font-bold text-cyan-400 font-mono text-xs">
                      {isUnknownRetrieval ? '모름(현장확인)' : `${retrievalAssetIds.length}대`}
                    </span>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-slate-850 hover:bg-slate-750 text-slate-400 hover:text-white transition border border-slate-750"
            >
              <RotateCcw className="w-3 h-3" />
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
                  {(currentTenant?.tradeName || 'E-BRO LIFT').toUpperCase()} ERP DISPATCH ORDER
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
                  {CONTEXT_OPTIONS.find(o => o.id === selectedContext)?.label || '의뢰목적 미선택'}
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
                  {loadingDate
                    ? `${loadingDate} ${loadingTimeType === 'ASAP' ? '[ASAP]' : loadingTimeType === 'MORNING' ? '[오전]' : loadingTimeType === 'AFTERNOON' ? '[오후]' : loadingTimeVal || ''}`
                    : '(상차일시 미지정)'}
                </div>
              </div>
              <div className={`grid grid-cols-4 ${staggeredMemo ? 'border-b border-slate-800' : ''}`}>
                <div className="col-span-1 bg-slate-950 p-1.5 font-bold text-slate-400 border-r border-slate-800 flex items-center text-[11px]">
                  하차일시
                </div>
                <div className="col-span-3 bg-slate-900/90 p-1.5 font-bold text-cyan-400 font-mono text-[11px]">
                  {unloadingDate || loadingDate
                    ? `${unloadingDate || loadingDate} ${unloadingTimeType === 'ASAP' ? '[ASAP]' : unloadingTimeType === 'MORNING' ? '[오전]' : unloadingTimeType === 'AFTERNOON' ? '[오후]' : unloadingTimeVal || '(상차직송)'}`
                    : '(하차일시 미지정)'}
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
            {(note || selectedSafetyOptions.size > 0 || (isExchangeMode && retrievalAssetIds.length > 0)) && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-[10.5px] text-slate-300 flex flex-col gap-1">
                {selectedSafetyOptions.size > 0 && (
                  <div>
                    <span className="font-bold text-amber-400">요청옵션: </span>
                    <span className="text-slate-200">
                      {Array.from(selectedSafetyOptions).join(', ')}
                    </span>
                  </div>
                )}
                {isExchangeMode && retrievalAssetIds.length > 0 && (
                  <div>
                    <span className="font-bold text-cyan-400">대차 회수장비: </span>
                    <span className="text-slate-200">
                      {isUnknownRetrieval
                        ? '모름 (기사 현장 확인 후 회수)'
                        : `자산 #${retrievalAssetIds.join(', #')} (총 ${retrievalAssetIds.length}대, 회수)`}
                    </span>
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
  // 렌더: 처리 대기 큐 탭 (4형 기준정보 드로어형: 2단 파이프라인 그리드 + 우측 드로어)
  // ─────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  // 렌더: 처리 대기 큐 탭 (좌우 2열 분할 스튜디오: 좌측 통화녹음 + 우측 출고초안 + 하단 콘솔)
  // ─────────────────────────────────────────────────────────────────────────
  const renderQueueTab = () => {
    const activeQueue = queue.filter(d => d.status === 'DRAFT' || d.status === 'REVIEWING');
    const showUploads = viewFilter === 'ALL' || viewFilter === 'UPLOADS_ONLY';
    const showDrafts = viewFilter === 'ALL' || viewFilter === 'DRAFTS_ONLY';

    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-slate-950">
        {/* 1. 상단 컴팩트 툴바 (40px) */}
        <div className="flex-shrink-0 px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          {/* 좌측: 뷰 필터 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setViewFilter('ALL')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${
                  viewFilter === 'ALL' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                좌우 1:1 분할
              </button>
              <button
                type="button"
                onClick={() => setViewFilter('UPLOADS_ONLY')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${
                  viewFilter === 'UPLOADS_ONLY' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>통화 녹음만</span>
                <span className="font-mono text-[10px] px-1 rounded bg-slate-800/80 text-amber-300 font-bold">{callUploads.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewFilter('DRAFTS_ONLY')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${
                  viewFilter === 'DRAFTS_ONLY' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>출고 초안만</span>
                <span className="font-mono text-[10px] px-1 rounded bg-slate-800/80 text-blue-300 font-bold">{activeQueue.length}</span>
              </button>
            </div>
            {selectedQueueIds.size >= 2 && (
              <button
                type="button"
                onClick={handleMerge}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition"
              >
                <Merge className="w-3.5 h-3.5" />
                <span>선택 {selectedQueueIds.size}건 병합</span>
              </button>
            )}
          </div>

          {/* 우측: 액션 버튼 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                loadDrafts();
                loadUploadsAndLogs();
                showToast('데이터를 새로고침했습니다.', 'info');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
              <span>새로고침</span>
            </button>
            <button
              type="button"
              onClick={() => setAudioUploadOpen(true)}
              className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>녹음 파일 등록</span>
            </button>
          </div>
        </div>

        {/* 2. 메인 마스터 작업대 (좌우 2열 분할) */}
        <div className="dispatch4-master-stage">
          {/* ◀ 좌단: 통화 녹음 대장 */}
          {showUploads && (
            <div className={`dispatch4-grid-section ${viewFilter === 'ALL' ? 'left-panel' : ''}`}>
              <div className="dispatch4-section-header">
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-white font-bold">통화 녹음 대장</span>
                  <span className="px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 font-mono text-[10px] font-bold">
                    {callUploads.length}건
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  {selectedUpload ? `선택: ${selectedUpload.callerPhone || selectedUpload.fileName}` : '행 클릭 시 상세 표출'}
                </span>
              </div>

              <div className="dispatch4-table-container dispatch4-scrollbar">
                <table className="dispatch4-table">
                  <thead>
                    <tr>
                      <th style={{ width: 46, textAlign: 'center' }}>선택</th>
                      <th style={{ width: 60 }}>상태</th>
                      <th style={{ width: 95 }}>수신일시</th>
                      <th style={{ width: 110 }}>발신번호</th>
                      <th style={{ width: 85 }}>업무유형</th>
                      <th>요약 / 파일명</th>
                      <th style={{ width: 85, textAlign: 'center' }}>초안변환</th>
                      <th style={{ width: 45, textAlign: 'center' }}>삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callUploads.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-slate-500">
                          대기 중인 통화 녹음 파일이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      callUploads.map(upload => {
                        const phone = upload.callerPhone || parsePhoneFromFileName(upload.fileName);
                        const isSelected = selectedUploadId === upload.id;
                        const isConverting = isConvertingId === upload.id;
                        return (
                          <tr
                            key={upload.id}
                            onClick={() => setSelectedUploadId(prev => prev === upload.id ? null : upload.id)}
                            className={`cursor-pointer transition ${isSelected ? 'selected' : ''}`}
                          >
                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => setSelectedUploadId(prev => prev === upload.id ? null : upload.id)}
                                className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold border ${
                                  isSelected ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                                }`}
                              >
                                {isSelected ? '선택됨' : '선택'}
                              </button>
                            </td>
                            <td>
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                                upload.status === 'UPLOADED'
                                  ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                                  : upload.status === 'PROCESSING'
                                    ? 'bg-blue-950/80 text-blue-300 border-blue-800'
                                    : upload.status === 'PROCESSED'
                                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                      : 'bg-rose-950/80 text-rose-300 border-rose-800'
                              }`}>
                                {upload.status === 'UPLOADED' ? '대기' : upload.status === 'PROCESSING' ? '분석중' : upload.status === 'PROCESSED' ? '완료' : '오류'}
                              </span>
                            </td>
                            <td className="font-mono text-slate-400 text-[11px]">
                              {new Date(upload.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="font-mono font-bold text-blue-300">
                              {phone || '-'}
                            </td>
                            <td>
                              <div className="flex items-center gap-1 flex-wrap">
                                {(upload.callContext || []).map(ctx => {
                                  const opt = CALL_CONTEXT_OPTIONS.find(o => o.id === ctx);
                                  return (
                                    <span
                                      key={ctx}
                                      className="text-[10px] font-bold px-1.5 py-0.2 rounded text-white"
                                      style={{ backgroundColor: opt?.color || '#475569' }}
                                    >
                                      {opt?.label || ctx}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="text-slate-300 max-w-[220px] truncate" title={upload.summaryText || upload.fileName}>
                              {upload.summaryText || upload.fileName}
                            </td>
                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                disabled={isConverting}
                                onClick={() => handleConvertUploadToDraft(upload.id)}
                                className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white font-bold text-[10.5px] transition flex items-center justify-center gap-1 mx-auto"
                              >
                                {isConverting ? (
                                  <>
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    <span>생성중</span>
                                  </>
                                ) : (
                                  <>
                                    <Zap className="w-3 h-3 text-amber-300" />
                                    <span>초안 ➔</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => handleDeleteUpload(upload)}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/60 transition"
                                title="삭제"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* ◀ 좌단 하단: 선택된 통화 상세 인스펙터 */}
              {selectedUpload ? (
                <div className="dispatch4-panel-inspector dispatch4-scrollbar">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-white flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-blue-400" />
                        <span>{selectedUpload.callerPhone || parsePhoneFromFileName(selectedUpload.fileName) || '발신 미상'}</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        ({new Date(selectedUpload.createdAt).toLocaleString('ko-KR')})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedUploadId(null)}
                      className="text-slate-500 hover:text-white text-xs font-bold"
                      title="선택 해제"
                    >
                      닫기 ✕
                    </button>
                  </div>

                  {selectedUpload.publicUrl ? (
                    <audio controls src={selectedUpload.publicUrl} className="w-full h-7" preload="metadata" />
                  ) : (
                    <div className="text-[11px] text-slate-400 bg-slate-950 p-1.5 rounded">
                      재생 URL 미등록 ({selectedUpload.fileName})
                    </div>
                  )}

                  {selectedUpload.summaryText ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px] font-bold text-blue-300">
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-blue-400" />
                          <span>모바일 통화 텍스트 (삼성 AI 요약 / 녹음 메모)</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {selectedUpload.summaryText.length}자
                        </span>
                      </div>
                      <div className="text-xs text-slate-200 bg-slate-950 p-2.5 rounded-lg border border-blue-900/40 max-h-28 overflow-y-auto leading-relaxed whitespace-pre-wrap font-sans dispatch4-scrollbar selection:bg-blue-600">
                        {selectedUpload.summaryText}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 bg-slate-950/60 p-2 rounded border border-slate-800/40 text-center">
                      등록된 모바일 통화 텍스트(메모) 없음
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => handleDeleteUpload(selectedUpload)}
                      className="px-2.5 py-1 rounded text-[11px] font-bold text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 transition flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3 text-rose-400" />
                      <span>삭제</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleLoadUploadToForm(selectedUpload)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold border border-slate-700 transition"
                      >
                        새의뢰 폼으로 복사
                      </button>
                      <button
                        type="button"
                        disabled={isConvertingId === selectedUpload.id}
                        onClick={() => handleConvertUploadToDraft(selectedUpload.id)}
                        className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold transition flex items-center gap-1 shadow-sm"
                      >
                        <Zap className="w-3 h-3 text-amber-300" />
                        <span>초안 생성 ➔</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-shrink-0 px-3 py-2 bg-slate-950 border-t border-slate-800/60 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>통화 녹음 행을 선택하면 오디오 청취 및 상세 요약이 표시됩니다.</span>
                  {callUploads.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedUploadId(callUploads[0].id)}
                      className="text-blue-400 hover:underline font-bold text-[10.5px]"
                    >
                      첫 번째 녹음 선택
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ▶ 우단: 출고의뢰 초안 대장 */}
          {showDrafts && (
            <div className={`dispatch4-grid-section ${viewFilter === 'ALL' ? 'right-panel' : ''}`}>
              <div className="dispatch4-section-header">
                <div className="flex items-center gap-2">
                  <Package className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-white font-bold">출고의뢰 초안 대장</span>
                  <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 font-mono text-[10px] font-bold">
                    {activeQueue.length}건
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  {selectedDraft ? `선택: ${selectedDraft.customerName.value || '미정'}` : '행 클릭 시 상세 제원 표출'}
                </span>
              </div>

              <div className="dispatch4-table-container dispatch4-scrollbar">
                <table className="dispatch4-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36, textAlign: 'center' }}>선택</th>
                      <th style={{ width: 55 }}>긴급도</th>
                      <th style={{ width: 95 }}>접수일시</th>
                      <th style={{ width: 120 }}>고객사명</th>
                      <th style={{ width: 130 }}>투입 현장명</th>
                      <th style={{ width: 120 }}>신청 장비</th>
                      <th style={{ width: 110 }}>상차일정</th>
                      <th style={{ width: 100 }}>인수담당</th>
                      <th style={{ width: 85, textAlign: 'center' }}>배차등록</th>
                      <th style={{ width: 45, textAlign: 'center' }}>폐기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeQueue.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center py-8 text-slate-500">
                          대기 중인 출고의뢰 초안이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      activeQueue.map(draft => {
                        const isSelected = selectedDraftId === draft.id;
                        const isChecked = selectedQueueIds.has(draft.id);
                        return (
                          <tr
                            key={draft.id}
                            onClick={() => setSelectedDraftId(prev => prev === draft.id ? null : draft.id)}
                            className={`cursor-pointer transition ${isSelected ? 'selected' : ''}`}
                          >
                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedQueueIds(prev => {
                                    const n = new Set(prev);
                                    if (n.has(draft.id)) n.delete(draft.id);
                                    else n.add(draft.id);
                                    return n;
                                  });
                                }}
                                className="w-3.5 h-3.5 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0"
                              />
                            </td>
                            <td>
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                                draft.urgency === 'HIGH'
                                  ? 'bg-red-950 text-red-300 border-red-800'
                                  : draft.urgency === 'MEDIUM'
                                    ? 'bg-amber-950 text-amber-300 border-amber-800'
                                    : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              }`}>
                                {draft.urgency === 'HIGH' ? '긴급' : draft.urgency === 'MEDIUM' ? '보통' : '여유'}
                              </span>
                            </td>
                            <td className="font-mono text-slate-400 text-[11px]">
                              {new Date(draft.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="font-bold text-white max-w-[120px] truncate" title={draft.customerName.value || ''}>
                              {draft.customerName.value || '(미상)'}
                            </td>
                            <td className="text-slate-300 max-w-[130px] truncate" title={draft.siteName.value || ''}>
                              {draft.siteName.value || '(현장 미정)'}
                            </td>
                            <td className="text-emerald-400 font-bold max-w-[120px] truncate">
                              {draft.equipments.length > 0 ? draft.equipments.map(e => `${e.modelName}×${e.qty}`).join(', ') : '없음'}
                            </td>
                            <td className="font-mono text-slate-200 text-[11px]">
                              {draft.loadingDate.value || '미정'} {draft.loadingTime.value || ''}
                            </td>
                            <td className="text-slate-300 text-[11px] max-w-[100px] truncate">
                              {draft.contactPerson.value || '-'}
                            </td>
                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => handleLoadDraftToForm(draft)}
                                className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10.5px] transition shadow-sm"
                                title="출고의뢰 작성 폼으로 초안 데이터 로드"
                              >
                                {draft.context.includes('ADDITIONAL') ? '추가출고 작성 ➔' : draft.context.includes('EXCHANGE') ? '대차의뢰 작성 ➔' : '출고의뢰 작성 ➔'}
                              </button>
                            </td>
                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => handleDiscardDraft(draft.id)}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/60 transition"
                                title="폐기"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* ▶ 우단 하단: 선택된 초안 상세 인스펙터 */}
              {selectedDraft ? (
                <div className="dispatch4-panel-inspector dispatch4-scrollbar">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-white">
                        {selectedDraft.customerName.value || '(고객사 미정)'} ➔ {selectedDraft.siteName.value || '(현장 미정)'}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                        selectedDraft.urgency === 'HIGH' ? 'bg-red-950 text-red-300 border-red-800' : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      }`}>
                        {selectedDraft.urgency === 'HIGH' ? '긴급' : '보통'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDraftId(null)}
                      className="text-slate-500 hover:text-white text-xs font-bold"
                      title="선택 해제"
                    >
                      닫기 ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/70 p-2 rounded border border-slate-800">
                    <div>
                      <span className="text-slate-500 block text-[10px]">현장 주소</span>
                      <span className="text-slate-200 truncate block">{selectedDraft.siteAddress || '(주소 미등록)'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">인수 담당자</span>
                      <span className="text-slate-200">
                        {selectedDraft.contactPerson.value || '-'} ({typeof selectedDraft.contactPhone === 'string' ? selectedDraft.contactPhone : (selectedDraft.contactPhone as any)?.value || '-'})
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">상차/하차 일정</span>
                      <span className="text-amber-300 font-mono">
                        {selectedDraft.loadingDate.value} {selectedDraft.loadingTime.value || ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">신청 장비 제원</span>
                      <span className="text-emerald-400 font-bold">
                        {selectedDraft.equipments.map(e => `${e.modelName}×${e.qty}대`).join(', ') || '없음'}
                      </span>
                    </div>
                  </div>

                  {/* 📄 원본 통화 텍스트 대조 (초안 완성도 검증 뷰) */}
                  {(() => {
                    const linkedUpload = callUploads.find(u => (selectedDraft.sourceCallIds || []).includes(u.id));
                    const rawText = linkedUpload?.summaryText || (selectedDraft.note && selectedDraft.note.includes('[통화요약]') ? selectedDraft.note.replace(/^\[통화요약\]\s*/, '').split(' | ')[0] : null);
                    if (!rawText) return null;
                    return (
                      <div className="flex flex-col gap-1 bg-slate-950 p-2.5 rounded-lg border border-emerald-900/40">
                        <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400">
                          <span className="flex items-center gap-1">
                            <span>📄 원본 통화 텍스트 대조</span>
                            <span className="text-[10px] font-normal text-slate-400">(모바일 등록 원문)</span>
                          </span>
                          {linkedUpload && (
                            <span className="text-[10px] font-mono text-slate-400">
                              {linkedUpload.callerPhone || linkedUpload.fileName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-200 max-h-24 overflow-y-auto leading-relaxed whitespace-pre-wrap font-sans dispatch4-scrollbar selection:bg-emerald-600">
                          {rawText}
                        </div>
                      </div>
                    );
                  })()}

                  {(selectedDraft.safetyOptions?.length || selectedDraft.note) ? (
                    <div className="text-[11px] text-slate-300 bg-slate-950/50 p-1.5 rounded border border-slate-850 truncate">
                      {selectedDraft.safetyOptions && selectedDraft.safetyOptions.length > 0 && (
                        <span className="text-amber-400 font-bold mr-2">[옵션: {selectedDraft.safetyOptions.join(', ')}]</span>
                      )}
                      {selectedDraft.note && <span className="text-slate-300">{selectedDraft.note}</span>}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => handleDiscardDraft(selectedDraft.id)}
                      className="px-2.5 py-1 rounded text-[11px] font-bold text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 transition flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3 text-rose-400" />
                      <span>폐기</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleLoadDraftToForm(selectedDraft)}
                        className="px-3.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black transition flex items-center gap-1 shadow-sm"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>{selectedDraft.context.includes('ADDITIONAL') ? '추가출고 작성 ➔' : selectedDraft.context.includes('EXCHANGE') ? '대차의뢰 작성 ➔' : '출고의뢰 작성 ➔'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSubmitDraft(selectedDraft)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-300 text-[11px] font-bold border border-slate-700 transition flex items-center gap-1"
                        title="주소/연락처가 완비된 경우 배차 대장으로 바로 등록"
                      >
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>배차 바로등록</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-shrink-0 px-3 py-2 bg-slate-950 border-t border-slate-800/60 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>출고 초안 행을 선택하면 상세 제원 및 배차 대장 등록이 활성화됩니다.</span>
                  {activeQueue.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDraftId(activeQueue[0].id)}
                      className="text-emerald-400 hover:underline font-bold text-[10.5px]"
                    >
                      첫 번째 초안 선택
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. 하단 실시간 파이프라인 로그 모니터 아코디언 */}
        <PipelineConsole
          logs={pipelineLogs}
          onClearLogs={() => setPipelineLogs([])}
          onSendTestLog={handleSendTestLog}
        />
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
          <h2 className="dispatch4-title">출고의뢰</h2>
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
              <span>처리 대기</span>
              {(pendingCount > 0 || callUploads.length > 0) && (
                <span className="px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-mono">
                  {callUploads.length > 0 ? `통화 ${callUploads.length} · 초안 ${pendingCount}` : pendingCount}
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
            <span>녹음 파일 등록</span>
          </button>
        </div>
      </div>

      {/* 본문 탭 전환 */}
      {activeTab === 'NEW' ? renderNewTab() : renderQueueTab()}

      {/* 통화 녹음 업로드 모달 */}
      <CallAudioUploadModal
        isOpen={audioUploadOpen}
        onClose={() => setAudioUploadOpen(false)}
        onSuccess={() => {
          loadDrafts();
          loadUploadsAndLogs();
          setActiveTab('QUEUE');
          showToast('통화 녹음 업로드 완료 — 처리 대기 큐 및 이벤트 로그에 등록되었습니다.');
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
                        {id}
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
