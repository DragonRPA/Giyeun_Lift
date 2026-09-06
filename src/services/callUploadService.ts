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

// ─── 내 처리 대기 초안 목록 조회 ─────────────────────────
export async function fetchMyDrafts(): Promise<DraftDispatchOrder[]> {
  if (!supabase) throw new Error('Supabase 미연결');

  const { data, error } = await supabase
    .from('draft_dispatch_orders')
    .select('*')
    .in('status', ['DRAFT', 'REVIEWING'])
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

// ─── 초안 신규 생성 및 DB 영구 저장 (헌장 1.2, 5.2 준수) ─────
export async function createDraftOrder(
  draft: Omit<DraftDispatchOrder, 'id' | 'createdAt'> & { id?: string }
): Promise<DraftDispatchOrder> {
  if (!supabase) throw new Error('Supabase 미연결');

  const row = {
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

  if (error || !data) throw new Error(`초안 DB 저장 실패: ${error?.message}`);
  await (supabase as any).awaitPendingWrites?.();
  return mapRow(data);
}

// ─── 초안 상태 업데이트 ───────────────────────────────────
export async function updateDraftField(
  draftId: string,
  updates: Partial<Record<string, unknown>>
): Promise<void> {
  if (!supabase) throw new Error('Supabase 미연결');
  const { error } = await supabase
    .from('draft_dispatch_orders')
    .update(updates)
    .eq('id', draftId);
  if (error) throw new Error(error.message);
  await (supabase as any).awaitPendingWrites?.();
}

// ─── 초안 제출 (출고 지시) ───────────────────────────────
export async function submitDraft(draftId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase 미연결');
  const { error } = await supabase
    .from('draft_dispatch_orders')
    .update({
      status:       'SUBMITTED',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', draftId);
  if (error) throw new Error(error.message);
}

// ─── 초안 폐기 ────────────────────────────────────────────
export async function discardDraft(draftId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase 미연결');
  const { error } = await supabase
    .from('draft_dispatch_orders')
    .update({ status: 'DISCARDED' })
    .eq('id', draftId);
  if (error) throw new Error(error.message);
}

// ─── 복수 초안 병합 ──────────────────────────────────────
export async function mergeDrafts(
  draftIds: string[],
  mergedData: Partial<Record<string, unknown>>
): Promise<DraftDispatchOrder> {
  if (!supabase) throw new Error('Supabase 미연결');

  // 병합 대상 조회
  const { data: drafts, error: fetchErr } = await supabase
    .from('draft_dispatch_orders')
    .select('*')
    .in('id', draftIds);

  if (fetchErr || !drafts?.length) throw new Error('병합 대상 조회 실패');

  const allSourceCalls = drafts.flatMap((d: Record<string, unknown>) =>
    (d.source_call_ids as string[]) ?? []
  );
  const allContexts = [...new Set(drafts.flatMap((d: Record<string, unknown>) =>
    (d.context as string[]) ?? []
  ))];
  const allEquipments = drafts.flatMap((d: Record<string, unknown>) =>
    (d.equipment_json as EquipmentItem[]) ?? []
  );
  const maxUrgency = drafts.some((d: Record<string, unknown>) => d.urgency === 'HIGH')
    ? 'HIGH' : drafts.some((d: Record<string, unknown>) => d.urgency === 'MEDIUM')
      ? 'MEDIUM' : 'LOW';

  // 새 병합 초안 생성
  const { data: merged, error: insertErr } = await supabase
    .from('draft_dispatch_orders')
    .insert({
      owner_id:        drafts[0].owner_id,
      source_call_ids: allSourceCalls,
      context:         allContexts,
      equipment_json:  allEquipments,
      urgency:         maxUrgency,
      merged_from:     draftIds,
      status:          'DRAFT',
      ...mergedData,
    })
    .select()
    .single();

  if (insertErr || !merged) throw new Error(`병합 초안 생성 실패: ${insertErr?.message}`);

  // 원본 초안 DISCARDED
  await supabase
    .from('draft_dispatch_orders')
    .update({ status: 'DISCARDED' })
    .in('id', draftIds);

  return mapRow(merged);
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
