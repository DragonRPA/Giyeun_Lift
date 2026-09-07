// src/services/callUploadService.ts
// ============================================================
// 통화 업로드 서비스 — 웹앱 & APK 공통 인터페이스
// ============================================================
import { supabase } from './db';

export type CallContext =
  | 'NEW_CUSTOMER'
  | 'ADDITIONAL'
  | 'EXCHANGE'
  | 'RETURN'
  | 'FIELD_AS'
  | 'TRANSPORT_NEGO'
  | 'SUBLEASE_NEGO';

export const CALL_CONTEXT_OPTIONS: { id: CallContext; label: string; color: string }[] = [
  { id: 'NEW_CUSTOMER',    label: '신규고객 출고',    color: '#7c3aed' },
  { id: 'ADDITIONAL',      label: '추가 출고',        color: '#2563eb' },
  { id: 'EXCHANGE',        label: '교체(대차)',        color: '#0891b2' },
  { id: 'RETURN',          label: '회수 요청',        color: '#dc2626' },
  { id: 'FIELD_AS',        label: '현장 AS',          color: '#d97706' },
  { id: 'TRANSPORT_NEGO',  label: '운송사 배차 협의',  color: '#059669' },
  { id: 'SUBLEASE_NEGO',   label: '전대 임차 협의',   color: '#6b7280' },
];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'MISSING';
export type DraftStatus     = 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'DISCARDED';
export type Urgency         = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EquipmentItem { modelName: string; qty: number; }

export interface ScoredField {
  value:      string;
  confidence: ConfidenceLevel;
  source?:    'DB' | 'STT' | 'PARSED' | 'MANUAL' | 'SUMMARY';
  confirmed:  boolean;
}

// DB Row → 앱 타입 매핑
export interface DraftDispatchOrder {
  id:                 string;
  ownerId:            string;
  sourceCallIds:      string[];
  context:            CallContext[];
  customerName:       ScoredField;
  siteName:           ScoredField;
  equipments:         EquipmentItem[];
  loadingDate:        ScoredField;
  loadingTime:        ScoredField;
  contactPerson:      ScoredField;
  contactPhone:       string;
  note:               string;
  isNewCustomer:      boolean;
  customerRegistered: boolean;
  status:             DraftStatus;
  urgency:            Urgency;
  createdAt:          string;
  submittedAt?:       string;
}

// ─── DB Row → DraftDispatchOrder 변환 ─────────────────────
function mapRow(row: Record<string, unknown>): DraftDispatchOrder {
  return {
    id:            row.id as string,
    ownerId:       row.owner_id as string,
    sourceCallIds: (row.source_call_ids as string[]) ?? [],
    context:       (row.context as CallContext[]) ?? [],
    customerName: {
      value:      (row.customer_name as string) ?? '',
      confidence: (row.customer_name_conf as ConfidenceLevel) ?? 'MISSING',
      source:     (row.customer_name_src as ScoredField['source']) ?? undefined,
      confirmed:  false,
    },
    siteName: {
      value:      (row.site_name as string) ?? '',
      confidence: (row.site_name_conf as ConfidenceLevel) ?? 'MISSING',
      confirmed:  false,
    },
    equipments:   (row.equipment_json as EquipmentItem[]) ?? [],
    loadingDate: {
      value:      (row.loading_date as string) ?? '',
      confidence: (row.loading_date_conf as ConfidenceLevel) ?? 'MISSING',
      confirmed:  false,
    },
    loadingTime: {
      value:      (row.loading_time as string) ?? '',
      confidence: (row.loading_time_conf as ConfidenceLevel) ?? 'MISSING',
      confirmed:  false,
    },
    contactPerson: {
      value:      (row.contact_person as string) ?? '',
      confidence: (row.contact_person_conf as ConfidenceLevel) ?? 'MISSING',
      confirmed:  false,
    },
    contactPhone:       (row.contact_phone as string) ?? '',
    note:               (row.note as string) ?? '',
    isNewCustomer:      (row.is_new_customer as boolean) ?? false,
    customerRegistered: (row.customer_registered as boolean) ?? false,
    status:             (row.status as DraftStatus) ?? 'DRAFT',
    urgency:            (row.urgency as Urgency) ?? 'LOW',
    createdAt:          row.created_at as string,
    submittedAt:        (row.submitted_at as string) ?? undefined,
  };
}

// ─── LocalDB 로컬 영구 보존 스토리지 (헌장 1.2, 5.2 무누락 보존) ─────
const LOCAL_DRAFTS_STORAGE_KEY = 'kiyeun_draft_dispatch_orders_local';

function getLocalDrafts(): DraftDispatchOrder[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LOCAL_DRAFTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('로컬 초안 스토리지 파싱 실패:', e);
    return [];
  }
}

function saveLocalDrafts(drafts: DraftDispatchOrder[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LOCAL_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch (e) {
    console.error('로컬 초안 스토리지 저장 실패:', e);
  }
}

// ─── 내 처리 대기 초안 목록 조회 ─────────────────────────
export async function fetchMyDrafts(): Promise<DraftDispatchOrder[]> {
  const localDrafts = getLocalDrafts().filter(d => d.status === 'DRAFT' || d.status === 'REVIEWING');

  if (!supabase) {
    return localDrafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  try {
    const { data, error } = await supabase
      .from('draft_dispatch_orders')
      .select('*')
      .in('status', ['DRAFT', 'REVIEWING'])
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Supabase fetchMyDrafts 원격 실패 (로컬 DB 유지):', error.message);
      return localDrafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const remoteDrafts = (data ?? []).map(mapRow);
    const remoteIds = new Set(remoteDrafts.map(d => d.id));
    const merged = [...remoteDrafts];
    for (const ld of localDrafts) {
      if (!remoteIds.has(ld.id)) {
        merged.push(ld);
      }
    }
    saveLocalDrafts(merged);
    return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err: any) {
    console.warn('Supabase fetchMyDrafts 연결 예외 (로컬 DB 유지):', err?.message);
    return localDrafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

// ─── 초안 신규 생성 및 DB 영구 저장 (헌장 1.2, 5.2 준수) ─────
export async function createDraftOrder(
  draft: Omit<DraftDispatchOrder, 'id' | 'createdAt'> & { id?: string }
): Promise<DraftDispatchOrder> {
  const newId = draft.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('draft_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)));
  const now = new Date().toISOString();

  const localOrder: DraftDispatchOrder = {
    ...draft,
    id: newId,
    createdAt: now,
  };

  // 1. 로컬 스토리지에 무누락 즉시 영구 저장 (F5 새로고침 시에도 증발 방지)
  const allDrafts = getLocalDrafts();
  const existingIdx = allDrafts.findIndex(d => d.id === newId);
  if (existingIdx >= 0) {
    allDrafts[existingIdx] = localOrder;
  } else {
    allDrafts.unshift(localOrder);
  }
  saveLocalDrafts(allDrafts);

  // 2. Supabase 원격 테이블 동기화 시도
  if (supabase) {
    try {
      const row = {
        id:                  newId,
        owner_id:            draft.ownerId,
        source_call_ids:     draft.sourceCallIds || [],
        context:             draft.context,
        customer_name:       draft.customerName.value,
        customer_name_conf:  draft.customerName.confidence,
        customer_name_src:   draft.customerName.source || 'MANUAL',
        site_name:           draft.siteName.value,
        site_name_conf:      draft.siteName.confidence,
        equipment_json:      draft.equipments,
        loading_date:        draft.loadingDate.value || null,
        loading_date_conf:   draft.loadingDate.confidence,
        loading_time:        draft.loadingTime.value || null,
        loading_time_conf:   draft.loadingTime.confidence,
        contact_person:      draft.contactPerson.value,
        contact_person_conf: draft.contactPerson.confidence,
        contact_phone:       draft.contactPhone,
        note:                draft.note,
        is_new_customer:     draft.isNewCustomer,
        customer_registered: draft.customerRegistered,
        status:              draft.status || 'DRAFT',
        urgency:             draft.urgency || 'LOW',
      };

      const { data, error } = await supabase
        .from('draft_dispatch_orders')
        .insert(row)
        .select()
        .single();

      if (!error && data) {
        await (supabase as any).awaitPendingWrites?.();
        const mapped = mapRow(data);
        const updatedDrafts = getLocalDrafts().map(d => d.id === newId ? mapped : d);
        saveLocalDrafts(updatedDrafts);
        return mapped;
      } else if (error) {
        console.warn('Supabase draft_dispatch_orders 원격 저장 실패 (로컬 DB 정상 보존):', error.message);
      }
    } catch (remoteErr: any) {
      console.warn('Supabase draft_dispatch_orders 통신 예외 (로컬 DB 정상 보존):', remoteErr?.message);
    }
  }

  return localOrder;
}

// ─── 초안 상태 업데이트 ───────────────────────────────────
export async function updateDraftField(
  draftId: string,
  updates: Partial<Record<string, unknown>>
): Promise<void> {
  // 1. 로컬 DB 즉시 반영
  const allDrafts = getLocalDrafts();
  const idx = allDrafts.findIndex(d => d.id === draftId);
  if (idx >= 0) {
    allDrafts[idx] = { ...allDrafts[idx], ...updates } as DraftDispatchOrder;
    saveLocalDrafts(allDrafts);
  }

  // 2. Supabase 원격 동기화 시도
  if (supabase) {
    try {
      const { error } = await supabase
        .from('draft_dispatch_orders')
        .update(updates)
        .eq('id', draftId);
      if (error) {
        console.warn('Supabase updateDraftField 실패 (로컬 DB 정상 반영):', error.message);
      } else {
        await (supabase as any).awaitPendingWrites?.();
      }
    } catch (e: any) {
      console.warn('Supabase updateDraftField 통신 예외 (로컬 DB 정상 반영):', e?.message);
    }
  }
}

// ─── 초안 제출 (출고 지시) ───────────────────────────────
export async function submitDraft(draftId: string): Promise<void> {
  const now = new Date().toISOString();
  // 1. 로컬 DB 갱신
  const allDrafts = getLocalDrafts();
  const idx = allDrafts.findIndex(d => d.id === draftId);
  if (idx >= 0) {
    allDrafts[idx].status = 'SUBMITTED';
    allDrafts[idx].submittedAt = now;
    saveLocalDrafts(allDrafts);
  }

  // 2. Supabase 원격 동기화
  if (supabase) {
    try {
      const { error } = await supabase
        .from('draft_dispatch_orders')
        .update({
          status:       'SUBMITTED',
          submitted_at: now,
        })
        .eq('id', draftId);
      if (error) {
        console.warn('Supabase submitDraft 실패 (로컬 DB 반영 완료):', error.message);
      }
    } catch (e: any) {
      console.warn('Supabase submitDraft 통신 예외:', e?.message);
    }
  }
}

// ─── 초안 폐기 ────────────────────────────────────────────
export async function discardDraft(draftId: string): Promise<void> {
  // 1. 로컬 DB 갱신
  const allDrafts = getLocalDrafts();
  const idx = allDrafts.findIndex(d => d.id === draftId);
  if (idx >= 0) {
    allDrafts[idx].status = 'DISCARDED';
    saveLocalDrafts(allDrafts);
  }

  // 2. Supabase 원격 동기화
  if (supabase) {
    try {
      const { error } = await supabase
        .from('draft_dispatch_orders')
        .update({ status: 'DISCARDED' })
        .eq('id', draftId);
      if (error) {
        console.warn('Supabase discardDraft 실패 (로컬 DB 반영 완료):', error.message);
      }
    } catch (e: any) {
      console.warn('Supabase discardDraft 통신 예외:', e?.message);
    }
  }
}

// ─── 복수 초안 병합 ──────────────────────────────────────
export async function mergeDrafts(
  draftIds: string[],
  mergedData: Partial<Record<string, unknown>>
): Promise<DraftDispatchOrder> {
  const allDrafts = getLocalDrafts();
  const targets = allDrafts.filter(d => draftIds.includes(d.id));

  const allSourceCalls = targets.flatMap(d => d.sourceCallIds || []);
  const allContexts = [...new Set(targets.flatMap(d => d.context || []))];
  const allEquipments = targets.flatMap(d => d.equipments || []);
  const maxUrgency = targets.some(d => d.urgency === 'HIGH')
    ? 'HIGH' : targets.some(d => d.urgency === 'MEDIUM')
      ? 'MEDIUM' : 'LOW';

  const newId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('draft_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
  const now = new Date().toISOString();

  const newMergedDraft: DraftDispatchOrder = {
    id:                 newId,
    ownerId:            targets[0]?.ownerId || '',
    sourceCallIds:      allSourceCalls,
    context:            allContexts,
    customerName:       (mergedData.customerName as ScoredField) || targets[0]?.customerName || { value: '', confidence: 'MISSING', confirmed: false },
    siteName:           (mergedData.siteName as ScoredField) || targets[0]?.siteName || { value: '', confidence: 'MISSING', confirmed: false },
    equipments:         allEquipments,
    loadingDate:        (mergedData.loadingDate as ScoredField) || targets[0]?.loadingDate || { value: '', confidence: 'MISSING', confirmed: false },
    loadingTime:        (mergedData.loadingTime as ScoredField) || targets[0]?.loadingTime || { value: '', confidence: 'MISSING', confirmed: false },
    contactPerson:      (mergedData.contactPerson as ScoredField) || targets[0]?.contactPerson || { value: '', confidence: 'MISSING', confirmed: false },
    contactPhone:       (mergedData.contactPhone as string) || targets[0]?.contactPhone || '',
    note:               (mergedData.note as string) || targets.map(t => t.note).filter(Boolean).join(' | '),
    isNewCustomer:      targets.some(t => t.isNewCustomer),
    customerRegistered: targets.some(t => t.customerRegistered),
    status:             'DRAFT',
    urgency:            maxUrgency,
    createdAt:          now,
  };

  // 1. 로컬 DB 갱신
  for (const d of allDrafts) {
    if (draftIds.includes(d.id)) {
      d.status = 'DISCARDED';
    }
  }
  allDrafts.unshift(newMergedDraft);
  saveLocalDrafts(allDrafts);

  // 2. Supabase 원격 동기화 시도
  if (supabase) {
    try {
      await supabase
        .from('draft_dispatch_orders')
        .insert({
          id:              newId,
          owner_id:        newMergedDraft.ownerId,
          source_call_ids: allSourceCalls,
          context:         allContexts,
          equipment_json:  allEquipments,
          urgency:         maxUrgency,
          merged_from:     draftIds,
          status:          'DRAFT',
          customer_name:   newMergedDraft.customerName.value,
          site_name:       newMergedDraft.siteName.value,
          contact_person:  newMergedDraft.contactPerson.value,
          contact_phone:   newMergedDraft.contactPhone,
          note:            newMergedDraft.note,
        });

      await supabase
        .from('draft_dispatch_orders')
        .update({ status: 'DISCARDED' })
        .in('id', draftIds);
    } catch (e: any) {
      console.warn('Supabase mergeDrafts 통신 예외 (로컬 DB 병합 완료):', e?.message);
    }
  }

  return newMergedDraft;
}

// ─── 음성 파일 업로드 (웹에서 직접 테스트용) ────────────
export async function uploadCallRecording(
  file: File,
  uploaderId: string,
  context: CallContext[],
  summaryText?: string
): Promise<string> {
  if (!supabase) throw new Error('Supabase 미연결');

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const storagePath = `${uploaderId}/${timestamp.slice(0, 8)}/${timestamp}.${file.name.split('.').pop()}`;

  // Storage 업로드
  const { error: uploadErr } = await supabase.storage
    .from('call-recordings')
    .upload(storagePath, file, { upsert: false });

  if (uploadErr) throw new Error(`업로드 실패: ${uploadErr.message}`);

  // call_uploads 레코드 INSERT → Edge Function 자동 트리거
  const { data: record, error: insertErr } = await supabase
    .from('call_uploads')
    .insert({
      uploader_id:   uploaderId,
      storage_path:  storagePath,
      file_name:     file.name,
      call_context:  context,
      summary_text:  summaryText ?? null,
      status:        'UPLOADED',
    })
    .select()
    .single();

  if (insertErr || !record) throw new Error(`업로드 이력 저장 실패: ${insertErr?.message}`);

  return record.id as string;
}

// ─── Realtime 구독 ────────────────────────────────────────
export function subscribeDraftUpdates(
  ownerId: string,
  onNewDraft: (draft: DraftDispatchOrder) => void
) {
  if (!supabase) return () => {};

  const channel = supabase
    .channel('draft-updates')
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'draft_dispatch_orders',
        filter: `owner_id=eq.${ownerId}`,
      },
      (payload) => {
        onNewDraft(mapRow(payload.new as Record<string, unknown>));
      }
    )
    .subscribe();

  return () => { supabase!.removeChannel(channel); };
}
