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

// ─── 통화 업로드 DB 레코드 인터페이스 ──────────────────────
export interface CallUploadRecord {
  id:                 string;
  uploaderId:         string;
  uploaderPhone?:     string;
  callerPhone?:       string;
  callDirection?:     'OUTGOING' | 'INCOMING';
  callEndedAt?:       string;
  durationSeconds?:   number;
  storagePath:        string;
  fileName:           string;
  callContext:        CallContext[];
  summaryText?:       string;
  status:             'UPLOADED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  retryCount:         number;
  errorMessage?:      string;
  draftId?:           string;
  customerId?:        string;
  createdAt:          string;
  processedAt?:       string;
  publicUrl?:         string;
}

// ─── 파이프라인 실시간 이벤트 로그 인터페이스 ───────────────
export interface PipelineLogRecord {
  id:             string;
  callUploadId?:  string;
  draftId?:       string;
  eventType:      string;
  level:          'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' | 'DEBUG';
  message:        string;
  payload?:       Record<string, unknown>;
  createdAt:      string;
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

// ─── 전화번호 파서 (파일명 또는 텍스트에서 010/02 등 전화번호 추출) ──
export function parsePhoneFromFileName(fileName: string): string {
  if (!fileName) return '';
  const digitsMatch = fileName.match(/(0\d{1,2}\d{7,8})/);
  if (digitsMatch) {
    const digits = digitsMatch[1];
    if (digits.startsWith('02')) {
      return digits.length === 9
        ? `02-${digits.slice(2, 5)}-${digits.slice(5)}`
        : `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
    } else if (digits.startsWith('01') && digits.length === 11) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    } else if (digits.length >= 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(digits.length - 4)}`;
    }
  }
  return '';
}

// ─── DB Row → CallUploadRecord 변환 ────────────────────────
export function mapUploadRow(row: Record<string, unknown>): CallUploadRecord {
  const storagePath = (row.storage_path as string) || '';
  let publicUrl = '';
  if (supabase && storagePath) {
    try {
      const { data } = supabase.storage.from('call-recordings').getPublicUrl(storagePath);
      publicUrl = data?.publicUrl || '';
    } catch {
      publicUrl = '';
    }
  }
  return {
    id:               row.id as string,
    uploaderId:       (row.uploader_id as string) || '',
    uploaderPhone:    (row.uploader_phone as string) || undefined,
    callerPhone:      (row.caller_phone as string) || undefined,
    callDirection:    (row.call_direction as 'OUTGOING' | 'INCOMING') || undefined,
    callEndedAt:      (row.call_ended_at as string) || undefined,
    durationSeconds:  (row.duration_seconds as number) || undefined,
    storagePath:      storagePath,
    fileName:         (row.file_name as string) || '',
    callContext:      ((row.call_context as CallContext[]) || []),
    summaryText:      (row.summary_text as string) || undefined,
    status:           (row.status as CallUploadRecord['status']) || 'UPLOADED',
    retryCount:       (row.retry_count as number) || 0,
    errorMessage:     (row.error_message as string) || undefined,
    draftId:          (row.draft_id as string) || undefined,
    customerId:       (row.customer_id as string) || undefined,
    createdAt:        (row.created_at as string) || new Date().toISOString(),
    processedAt:      (row.processed_at as string) || undefined,
    publicUrl:        publicUrl,
  };
}

// ─── DB Row → PipelineLogRecord 변환 ───────────────────────
export function mapLogRow(row: Record<string, unknown>): PipelineLogRecord {
  return {
    id:            row.id as string,
    callUploadId:  (row.call_upload_id as string) || undefined,
    draftId:       (row.draft_id as string) || undefined,
    eventType:     (row.event_type as string) || 'UNKNOWN',
    level:         (row.level as PipelineLogRecord['level']) || 'INFO',
    message:       (row.message as string) || '',
    payload:       (row.payload as Record<string, unknown>) || {},
    createdAt:     (row.created_at as string) || new Date().toISOString(),
  };
}

// ─── LocalDB 로컬 영구 보존 스토리지 (헌장 1.2, 5.2 무누락 보존) ─────
const LOCAL_DRAFTS_STORAGE_KEY = 'giyeun_draft_dispatch_orders_local';

function getLocalDrafts(): DraftDispatchOrder[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LOCAL_DRAFTS_STORAGE_KEY) || localStorage.getItem('kiyeun_draft_dispatch_orders_local');
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

// ─── 음성 파일 및 통화 텍스트 업로드 (웹/모바일/APK 공통) ────────────
export async function uploadCallRecording(
  file: File | null | undefined,
  uploaderId: string,
  context: CallContext[],
  summaryText?: string,
  autoGenerateDraft: boolean = true
): Promise<string> {
  if (!supabase) throw new Error('Supabase 미연결');

  let storagePath = '';
  let fileName = '';

  // 1. 음성 파일이 있는 경우 Storage 업로드 실행
  if (file) {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
    storagePath = `${uploaderId}/${timestamp.slice(0, 8)}/${timestamp}.${file.name.split('.').pop()}`;
    fileName = file.name;

    const { error: uploadErr } = await supabase.storage
      .from('call-recordings')
      .upload(storagePath, file, { upsert: false });

    if (uploadErr) throw new Error(`음성 파일 업로드 실패: ${uploadErr.message}`);
  } else {
    // 음성 파일 없이 텍스트(메모/카톡/삼성요약)만 있는 경우 (0초 직행 모드)
    if (!summaryText || !summaryText.trim()) {
      throw new Error('음성 파일 또는 통화 텍스트(메모) 중 하나는 필수입니다.');
    }
    const todayStr = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
    const preview = summaryText.trim().replace(/\n/g, ' ').slice(0, 20);
    fileName = `[텍스트 의뢰] ${preview}... (${todayStr})`;
  }

  // 2. call_uploads 레코드 INSERT
  const { data: record, error: insertErr } = await supabase
    .from('call_uploads')
    .insert({
      uploader_id:   uploaderId,
      storage_path:  storagePath || null,
      file_name:     fileName,
      call_context:  context,
      summary_text:  summaryText ?? null,
      status:        'UPLOADED',
    })
    .select()
    .single();

  if (insertErr || !record) throw new Error(`업로드 이력 저장 실패: ${insertErr?.message}`);

  // 3. 파이프라인 이벤트 실시간 로깅 (헌장 1.2 무누락 저장)
  try {
    await insertPipelineLog({
      callUploadId: record.id as string,
      eventType: file ? 'UPLOAD_RECEIVED' : 'TEXT_ORDER_RECEIVED',
      level: 'SUCCESS',
      message: file
        ? `통화 녹음 파일 업로드 완료: ${fileName} (${uploaderId})`
        : `통화 텍스트(메모) 의뢰 접수: ${fileName}`,
      payload: {
        storage_path: storagePath,
        file_name: fileName,
        uploader_id: uploaderId,
        call_context: context,
        has_file: !!file,
        size_bytes: file ? file.size : 0,
        text_length: summaryText?.length || 0,
      },
    });

    await insertPipelineLog({
      callUploadId: record.id as string,
      eventType: 'PIPELINE_PENDING',
      level: 'INFO',
      message: `처리 대기 큐 진입: STT 및 출고의뢰 초안 분석 대기 중`,
      payload: {
        upload_id: record.id,
        status: 'UPLOADED',
      },
    });
  } catch (logErr) {
    console.warn('파이프라인 로깅 경고:', logErr);
  }

  // 4. ⭐ [핵심 자동화] 업로드 완료 즉시 출고의뢰 초안 자동 생성 트리거 실행!
  if (autoGenerateDraft && record.id) {
    try {
      await convertUploadToDraft(record.id as string);
    } catch (draftErr: any) {
      console.warn('초안 자동 생성 경고 (수동 생성 가능):', draftErr?.message);
    }
  }

  return record.id as string;
}

// ─── 공용 스토리지 재생 URL 획득 ─────────────────────────
export function getCallAudioPublicUrl(storagePath: string): string {
  if (!supabase || !storagePath) return '';
  try {
    const { data } = supabase.storage.from('call-recordings').getPublicUrl(storagePath);
    return data?.publicUrl || '';
  } catch {
    return '';
  }
}

// ─── 전체 통화 업로드 목록 조회 ──────────────────────────
export async function fetchCallUploads(): Promise<CallUploadRecord[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('call_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('fetchCallUploads 실패:', error.message);
      return [];
    }
    return (data || []).map(mapUploadRow);
  } catch (err: any) {
    console.warn('fetchCallUploads 예외:', err?.message);
    return [];
  }
}

// ─── 파이프라인 이벤트 로그 조회 ───────────────────────────
export async function fetchPipelineLogs(limit = 100): Promise<PipelineLogRecord[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('call_pipeline_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('fetchPipelineLogs 실패:', error.message);
      return [];
    }
    return (data || []).map(mapLogRow);
  } catch (err: any) {
    console.warn('fetchPipelineLogs 예외:', err?.message);
    return [];
  }
}

// ─── 파이프라인 이벤트 로그 기록 ───────────────────────────
export async function insertPipelineLog(
  log: Omit<PipelineLogRecord, 'id' | 'createdAt'>
): Promise<PipelineLogRecord | null> {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('log_' + Date.now());
  const now = new Date().toISOString();
  const item: PipelineLogRecord = { ...log, id, createdAt: now };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('call_pipeline_logs')
        .insert({
          id,
          call_upload_id: log.callUploadId || null,
          draft_id:       log.draftId || null,
          event_type:     log.eventType,
          level:          log.level,
          message:        log.message,
          payload:        log.payload || {},
          created_at:     now,
        })
        .select()
        .single();
      if (!error && data) {
        return mapLogRow(data);
      }
    } catch (e: any) {
      console.warn('insertPipelineLog 예외:', e?.message);
    }
  }
  return item;
}

// ─── 통화 업로드 실시간 구독 (INSERT, UPDATE, DELETE) ─────
export function subscribeCallUploads(onUpdate: () => void) {
  if (!supabase) return () => {};

  const channel = supabase
    .channel('call-uploads-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'call_uploads',
      },
      () => {
        onUpdate();
      }
    )
    .subscribe();

  return () => { supabase!.removeChannel(channel); };
}

// ─── 파이프라인 실시간 로그 구독 ───────────────────────────
export function subscribePipelineLogs(onNewLog: (log: PipelineLogRecord) => void) {
  if (!supabase) return () => {};

  const channel = supabase
    .channel('call-pipeline-logs-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'call_pipeline_logs',
      },
      (payload) => {
        onNewLog(mapLogRow(payload.new as Record<string, unknown>));
      }
    )
    .subscribe();

  return () => { supabase!.removeChannel(channel); };
}

export interface ParsedSummaryInfo {
  equipments: EquipmentItem[];
  customerName?: string;
  siteName?: string;
  siteAddress?: string;
  contactPerson?: string;
  contactPhone?: string;
  loadingDate?: string;
  loadingTime?: string;
  safetyOptions: string[];
  retrievalAssetIds: string[];
  paidBy?: 'OURS' | 'CUSTOMER' | 'SPLIT';
}

export function parseCallSummaryText(text: string, fileName?: string): ParsedSummaryInfo {
  const result: ParsedSummaryInfo = {
    equipments: [],
    safetyOptions: [],
    retrievalAssetIds: [],
    paidBy: undefined,
  };

  const rawText = (text || '').trim();
  const rawFile = (fileName || '').trim();
  const clean = (rawText + ' ' + rawFile).trim();
  if (!clean) {
    result.equipments.push({ modelName: '19ft', qty: 1 });
    return result;
  }

  // ── [A. 라벨 기반 1순위 구조화 파싱 (밴드 및 정형 서식 대응)] ──
  // 1. 고객명 라벨
  const custLabelMatch = rawText.match(/(?:고객사명?|고객명|업체명?|상호명?|상호)\s*[:：]\s*([^\n\r]+)/i);
  if (custLabelMatch && custLabelMatch[1]) {
    result.customerName = custLabelMatch[1].trim();
  }

  // 2. 현장명 라벨 (개행 없는 한 줄 우선 매칭)
  const siteLabelMatch = rawText.match(/(?:현장명?|현장)(?!\s*상세|\s*주소|\s*담당)\s*[:：]\s*([^\n\r]+)/i);
  if (siteLabelMatch && siteLabelMatch[1]) {
    result.siteName = siteLabelMatch[1].trim();
  }

  // 3. 현장 상세 주소 라벨
  const addrLabelMatch = rawText.match(/(?:현장\s*상세\s*주소|현장상세주소|현장\s*주소|배송지)\s*[:：]\s*([^\n\r]+)/i);
  if (addrLabelMatch && addrLabelMatch[1]) {
    result.siteAddress = addrLabelMatch[1].trim();
  }

  // 4. 현장 담당자 라벨 (이름 및 전화번호 분리)
  const contactLabelMatch = rawText.match(/(?:현장\s*담당자?|현장담당|인수자)\s*[:：]\s*([^\n\r]+)/i);
  if (contactLabelMatch && contactLabelMatch[1]) {
    const rawContact = contactLabelMatch[1].trim();
    const pMatch = rawContact.match(/(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|02[-.\s]?\d{3,4}[-.\s]?\d{4}|0[3-6]\d[-.\s]?\d{3,4}[-.\s]?\d{4}|070[-.\s]?\d{4}[-.\s]?\d{4}|050\d[-.\s]?\d{3,4}[-.\s]?\d{4})/);
    if (pMatch) {
      result.contactPhone = pMatch[0].trim();
      const nameOnly = rawContact.replace(pMatch[0], '').replace(/[:\-]/g, '').trim();
      if (nameOnly) result.contactPerson = nameOnly;
    } else {
      result.contactPerson = rawContact;
    }
  }

  // 5. 전화번호 폴백 (라벨 미존재 시 본문/파일명 스캔)
  if (!result.contactPhone) {
    const phoneRegex = /(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|02[-.\s]?\d{3,4}[-.\s]?\d{4}|0[3-6]\d[-.\s]?\d{3,4}[-.\s]?\d{4}|070[-.\s]?\d{4}[-.\s]?\d{4}|050\d[-.\s]?\d{3,4}[-.\s]?\d{4})/;
    const phoneMatch = rawText.match(phoneRegex) || rawFile.match(phoneRegex);
    
    if (phoneMatch) {
      const raw = phoneMatch[0].replace(/[-.\s]/g, '');
      if (raw.startsWith('02')) {
        result.contactPhone = raw.length === 9 ? `02-${raw.slice(2, 5)}-${raw.slice(5)}` : `02-${raw.slice(2, 6)}-${raw.slice(6)}`;
      } else if (raw.startsWith('070') && raw.length === 11) {
        result.contactPhone = `070-${raw.slice(3, 7)}-${raw.slice(7)}`;
      } else if (raw.startsWith('050') && raw.length >= 11) {
        result.contactPhone = `${raw.slice(0, 4)}-${raw.slice(4, raw.length - 4)}-${raw.slice(raw.length - 4)}`;
      } else if (raw.length === 11) {
        result.contactPhone = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
      } else if (raw.length === 10) {
        result.contactPhone = `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
      } else {
        result.contactPhone = phoneMatch[0];
      }
    } else if (rawFile) {
      const pFromFn = parsePhoneFromFileName(rawFile);
      if (pFromFn) result.contactPhone = pFromFn;
    }
  }

  // 6. 담당자 이름 폴백 (라벨 미존재 시 직책 기반 유추)
  if (!result.contactPerson) {
    const explicitMatch = rawText.match(/(?:담당자|인수자|소장)\s*[:：]?\s*([가-힣]{2,4})/);
    const titleMatch = rawText.match(/([가-힣]{1,4}\s*(?:소장님?|반장님?|과장님?|부장님?|팀장님?|대리님?|책임|선임|차장|이사))/);
    if (titleMatch && titleMatch[0]) {
      const candidate = titleMatch[0].trim().replace(/님$/, '');
      if (!['내일', '모레', '아침', '오전', '오후', '현대', '삼성', '대우'].some(w => candidate.startsWith(w))) {
        result.contactPerson = candidate;
      }
    } else if (explicitMatch && explicitMatch[1]) {
      result.contactPerson = explicitMatch[1].trim();
    }
  }

  // 7. 현장명 폴백 (라벨 미존재 시 키워드 매칭, 개행문자 절대 미포함)
  if (!result.siteName) {
    const siteMatch = rawText.match(/([가-힣a-zA-Z0-9]{2,20}\s*(?:신축현장|신축공사|공사현장|물류센터|물류창고|물류단지|데이터센터|오피스텔|아파트|발전소|플랜트|빌딩|타워|공장|단지|창고|공항|팹동|PJT|PJ|현장|공사))/);
    if (siteMatch && siteMatch[0]) {
      result.siteName = siteMatch[0].trim();
    }
  }

  // ── [B. 날짜 추출 (스케줄 라벨 우선, MM.DD 점 날짜, 요일, 상대일 종합)] ──
  const now = new Date();
  const getFormattedDate = (target: Date) => target.toISOString().split('T')[0];

  const schedLabelMatch = rawText.match(/(?:상차시간|배송\s*스케줄|배송스케줄|하차시간|승계\s*시작일)\s*[:：]?\s*([^\n\r]+)/i);
  const schedText = schedLabelMatch ? schedLabelMatch[1].trim() : '';
  const dateScanTarget = schedText ? `${schedText} ${clean}` : clean;

  const weekdayMap: Record<string, number> = {
    '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0
  };

  // 1) MM.DD 또는 M.D 포맷 우선 확인 (예: "09.08(화)", "07.20 (월)", "8.12", "08.01일")
  const dotDateMatch = dateScanTarget.match(/(?:^|[^\d])(\d{1,2})\.(\d{1,2})(?:일)?(?:\s*\([월화수목금토일]\))?/);
  if (dotDateMatch) {
    const m = parseInt(dotDateMatch[1], 10);
    const d = parseInt(dotDateMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      result.loadingDate = `${now.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  } else if (clean.includes('오늘') || clean.includes('당일')) {
    result.loadingDate = getFormattedDate(now);
  } else if (clean.includes('내일모레') || clean.includes('모레')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    result.loadingDate = getFormattedDate(d);
  } else if (clean.includes('글피')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 3);
    result.loadingDate = getFormattedDate(d);
  } else if (clean.includes('내일')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    result.loadingDate = getFormattedDate(d);
  } else if (/다음\s*주\s*([월화수목금토일])(?:요일)?/.test(dateScanTarget)) {
    const wMatch = dateScanTarget.match(/다음\s*주\s*([월화수목금토일])(?:요일)?/);
    if (wMatch && weekdayMap[wMatch[1]] !== undefined) {
      const targetDay = weekdayMap[wMatch[1]];
      const currentDay = now.getDay();
      let diff = (targetDay - currentDay + 7) % 7;
      if (diff === 0) diff = 7;
      const d = new Date(now);
      d.setDate(d.getDate() + diff + 7);
      result.loadingDate = getFormattedDate(d);
    }
  } else if (/이번\s*주\s*([월화수목금토일])(?:요일)?/.test(dateScanTarget)) {
    const wMatch = dateScanTarget.match(/이번\s*주\s*([월화수목금토일])(?:요일)?/);
    if (wMatch && weekdayMap[wMatch[1]] !== undefined) {
      const targetDay = weekdayMap[wMatch[1]];
      const currentDay = now.getDay();
      const diff = targetDay - currentDay;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      result.loadingDate = getFormattedDate(d);
    }
  } else if (/([월화수목금토일])요일/.test(dateScanTarget)) {
    const wMatch = dateScanTarget.match(/([월화수목금토일])요일/);
    if (wMatch && weekdayMap[wMatch[1]] !== undefined) {
      const targetDay = weekdayMap[wMatch[1]];
      const currentDay = now.getDay();
      let diff = (targetDay - currentDay + 7) % 7;
      if (diff === 0) diff = 7;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      result.loadingDate = getFormattedDate(d);
    }
  } else if (clean.includes('월말') || clean.includes('이달말') || clean.includes('이번달 말')) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    result.loadingDate = getFormattedDate(d);
  } else if (clean.includes('익월초') || clean.includes('다음달 초')) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    result.loadingDate = getFormattedDate(d);
  } else {
    const ymdMatch = dateScanTarget.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (ymdMatch) {
      result.loadingDate = `${ymdMatch[1]}-${String(ymdMatch[2]).padStart(2, '0')}-${String(ymdMatch[3]).padStart(2, '0')}`;
    } else {
      const mdMatch = dateScanTarget.match(/(\d{1,2})월\s*(\d{1,2})일/);
      if (mdMatch) {
        const m = parseInt(mdMatch[1], 10);
        const d = parseInt(mdMatch[2], 10);
        result.loadingDate = `${now.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      } else {
        const slashMdMatch = dateScanTarget.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:[^\d]|$)/);
        if (slashMdMatch) {
          const m = parseInt(slashMdMatch[1], 10);
          const d = parseInt(slashMdMatch[2], 10);
          if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            result.loadingDate = `${now.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          }
        }
      }
    }
  }

  // ── [C. 시간 추출 (반/30분, 첫차, 오전/오후 중 등 종합)] ──
  const timeScanTarget = schedText || clean;
  if (/ASAP|즉시|당장|긴급/i.test(timeScanTarget)) {
    result.loadingTime = 'ASAP';
  } else if (/첫차|새벽일찍/i.test(timeScanTarget)) {
    result.loadingTime = '07:00';
  } else if (/오전\s*중/i.test(timeScanTarget)) {
    result.loadingTime = '10:00';
  } else if (/오후\s*중/i.test(timeScanTarget)) {
    result.loadingTime = '14:00';
  } else {
    const timeMatch = timeScanTarget.match(/(아침|새벽|오전|오후|낮|저녁)?\s*(\d{1,2})시(?:\s*(\d{1,2})분|\s*(반))?/);
    if (timeMatch) {
      const ampm = timeMatch[1] || '';
      let hour = parseInt(timeMatch[2], 10);
      let minute = 0;
      if (timeMatch[4] === '반') {
        minute = 30;
      } else if (timeMatch[3]) {
        minute = parseInt(timeMatch[3], 10);
      }
      if ((ampm === '오후' || ampm === '저녁' || ampm === '낮') && hour < 12) {
        hour += 12;
      }
      result.loadingTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } else {
      const colonTimeMatch = timeScanTarget.match(/(\d{1,2}):(\d{2})/);
      if (colonTimeMatch) {
        result.loadingTime = `${String(colonTimeMatch[1]).padStart(2, '0')}:${colonTimeMatch[2]}`;
      }
    }
  }

  // ── [D. 장비 모델 및 수량 추출 (라벨 우선, * 곱하기, 외산/소형/붐 매핑)] ──
  const modelLabelMatch = rawText.match(/모델명\s*[:：]\s*([^\n\r]+)/i);
  const modelTextToScan = modelLabelMatch ? modelLabelMatch[1].trim() : (rawText.length > 0 ? rawText : rawFile.replace(/01[016789]\d{7,8}/g, '').replace(/\d{8}_\d{6}/g, ''));

  // 중간발판 분리
  if (/중간발판/i.test(modelTextToScan)) {
    result.safetyOptions.push('중간발판');
  }

  const countMap: Record<string, number> = {
    '한': 1, '일': 1, '하나': 1, '두': 2, '이': 2, '둘': 2,
    '세': 3, '삼': 3, '셋': 3, '네': 4, '사': 4, '넷': 4,
    '다섯': 5, '오': 5, '여섯': 6, '육': 6, '일곱': 7, '칠': 7,
    '여덟': 8, '팔': 8, '아홉': 9, '구': 9, '열': 10, '십': 10,
  };

  const detectedEquipments: EquipmentItem[] = [];

  const modelRegex = /(1330L?|ES1330L?|1432|GS1432|3215|SJ3215|1230|1230ES|1930|2632|2646|3219|3226|3246|4047|4626|4632|4655|GS4655|0812|0808|1012|0608|1412|1612|JCPT1008AC|JCPT1012AC|JCPT\d{4}|S0808E|S0812E|S1212E|0608ME|0808E|1012E|GTJZ0808E|Z45|19피트|26피트|32피트|40피트|46피트|53피트|19ft|26ft|32ft|40ft|46ft|53ft|sj3219|sj3226|sj4632|sj4740|gs1930|gs2632|gs3246|gs4047|(?<!\d)(?:19|26|32|40|46|53)(?!\d)(?:\s*(?:피트|ft|짜리))?(?=\s*(?:\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)?\s*(?:대|개)))/gi;

  let m: RegExpExecArray | null;
  while ((m = modelRegex.exec(modelTextToScan)) !== null) {
    const rawKey = m[0].toUpperCase();
    let modelName = '19ft';
    
    if (rawKey.includes('1330')) modelName = '13ft';
    else if (rawKey.includes('1432')) modelName = '14ft';
    else if (rawKey.includes('3215') || rawKey.includes('1230')) modelName = '15ft';
    else if (rawKey.includes('19') || rawKey.includes('0608')) modelName = '19ft';
    else if (rawKey.includes('26') || rawKey.includes('0812') || rawKey.includes('0808') || rawKey.includes('1008')) modelName = '26ft';
    else if (rawKey.includes('32') || rawKey.includes('1012')) modelName = '32ft';
    else if (rawKey.includes('40') || rawKey.includes('4047') || rawKey.includes('1212')) modelName = '40ft';
    else if (rawKey.includes('46') || rawKey.includes('4655') || rawKey.includes('1412')) modelName = '46ft';
    else if (rawKey.includes('53') || rawKey.includes('1612')) modelName = '53ft';
    else if (rawKey.includes('Z45')) modelName = 'Z45 (굴절붐)';

    // 후방 슬라이스에서 수량 파싱 (* N, x N, N대, 한대 등)
    const afterMatch = modelTextToScan.substring(m.index + m[0].length, m.index + m[0].length + 25);
    
    let qty = 1;
    const multiplyMatch = afterMatch.match(/^\s*[*xX]\s*(\d+)/);
    if (multiplyMatch) {
      qty = Math.max(1, parseInt(multiplyMatch[1], 10));
    } else {
      const countMatch = afterMatch.match(/^\s*(\d+)\s*(?:대|개)?/) 
        || afterMatch.match(/^\s*(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*대/)
        || afterMatch.match(/(\d+)\s*(?:대|개)/)
        || afterMatch.match(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*대/);
      if (countMatch) {
        const rawNum = countMatch[1];
        if (countMap[rawNum]) qty = countMap[rawNum];
        else if (!isNaN(parseInt(rawNum, 10))) qty = Math.max(1, parseInt(rawNum, 10));
      }
    }

    const existing = detectedEquipments.find(e => e.modelName === modelName);
    if (existing) {
      existing.qty += qty;
    } else {
      detectedEquipments.push({ modelName, qty });
    }
  }

  // 장비가 언급되었으나 모델 특정 불가, 또는 음성 파일만 올라온 경우 기본 19ft 1대 보장
  if (detectedEquipments.length === 0) {
    detectedEquipments.push({ modelName: '19ft', qty: 1 });
  }

  result.equipments = detectedEquipments;

  // ── [E. 안전 옵션 탐색 (공백, 변형어, 오타, 밴드 옵션 허용)] ──
  if (/(?:협착|협작)\s*방지\s*봉?|협착난간대/i.test(clean)) result.safetyOptions.push('협착방지봉');
  if (/(?:상부|상단)\s*센서/i.test(clean)) result.safetyOptions.push('상부센서');
  if (/(?:경광등|경광\s*램프|경보등)/i.test(clean)) result.safetyOptions.push('경광등');
  if (/소화기|소화기함/i.test(clean)) result.safetyOptions.push('소화기');
  if (/(?:논\s*마킹|넌\s*마킹|노마킹|백색\s*바퀴)\s*(?:타이어|바퀴)?/i.test(clean)) result.safetyOptions.push('논마킹 타이어');
  if (/(?:비닐|도색|바닥)?\s*보양(?:작업)?/i.test(clean)) result.safetyOptions.push('비닐보양');
  if (/(?:과부하\s*(?:방지|경보|경보장치))/i.test(clean)) result.safetyOptions.push('과부하방지장치');
  if (/감지봉/i.test(clean)) result.safetyOptions.push('감지봉');
  if (/함석/i.test(clean)) result.safetyOptions.push('함석');

  result.safetyOptions = Array.from(new Set(result.safetyOptions));

  // ── [F. 🛡️ 대차 회수자산번호 추출] ──
  const assetMatches = clean.matchAll(/([A-Za-z0-9]{1,5}(?:-[A-Za-z0-9]{1,4})?)\s*호기/g);
  for (const am of assetMatches) {
    result.retrievalAssetIds.push(am[1]);
  }

  // ── [G. 🛡️ 운송비 부담 귀속선 추출] ──
  if (/(?:당사\s*부담|회사\s*부담|우리가\s*(?:낼게|부담|부담할게|부담함|냄)|무료\s*(?:배차|운송|지원)?|서비스\s*배차|지원\s*배차)/i.test(clean)) {
    result.paidBy = 'OURS';
  } else if (/(?:고객\s*(?:청구|부담)|현장\s*(?:청구|부담)|업체\s*(?:청구|부담)|사장님\s*(?:한테|에게)?\s*청구|손님\s*부담)/i.test(clean)) {
    result.paidBy = 'CUSTOMER';
  } else if (/(?:편도\s*지원|반반|50%|반씩|1\/2|절반)/i.test(clean)) {
    result.paidBy = 'SPLIT';
  }

  return result;
}

// ─── 업로드된 통화 파일 ➔ 출고의뢰 초안 즉시 변환 ─────────
export async function convertUploadToDraft(
  uploadId: string
): Promise<DraftDispatchOrder> {
  if (!supabase) throw new Error('Supabase 미연결');

  // 1. 업로드 정보 로드
  const { data: upload, error: fetchErr } = await supabase
    .from('call_uploads')
    .select('*')
    .eq('id', uploadId)
    .single();

  if (fetchErr || !upload) throw new Error(`업로드 기록 조회 실패: ${fetchErr?.message}`);

  // 🧠 [스마트 키워드 파싱] 텍스트 요약 및 파일명으로부터 파라미터 추출
  const parsed = parseCallSummaryText(upload.summary_text || '', upload.file_name);
  const phone = upload.caller_phone || parsed.contactPhone || parsePhoneFromFileName(upload.file_name);
  const context = (upload.call_context as CallContext[]) || ['ADDITIONAL'];

  // 2. 고객 매칭 시도 (전화번호 기준 + 상호 텍스트 매칭)
  let matchedCustomerName = parsed.customerName || '';
  let customerFound = false;
  if (phone) {
    const rawDigits = phone.replace(/[^0-9]/g, '');
    try {
      const { data: custs } = await supabase
        .from('customers')
        .select('id, name')
        .or(`phone.ilike.%${rawDigits}%,tel.ilike.%${rawDigits}%`)
        .limit(1);
      if (custs && custs.length > 0) {
        matchedCustomerName = custs[0].name;
        customerFound = true;
      }
    } catch { /* ignore */ }
  }

  // 3. DraftDispatchOrder 생성 (지능형 파싱 결과 즉시 바인딩)
  const finalEquipments = parsed.equipments.length > 0 ? parsed.equipments : [{ modelName: '19ft', qty: 1 }];
  const finalDate = parsed.loadingDate || new Date().toISOString().slice(0, 10);
  const finalTime = parsed.loadingTime || '08:00';

  // 🛡️ [메타데이터 직렬화] 대차 회수대상, 운송비 귀속선, 안전옵션 100% 보존
  const noteSegments: string[] = [];
  if (upload.summary_text) noteSegments.push(`[통화요약] ${upload.summary_text}`);
  else noteSegments.push(`[통화 녹음 파일] ${upload.file_name}`);

  if (parsed.retrievalAssetIds.length > 0) {
    noteSegments.push(`[대차회수대상] ${parsed.retrievalAssetIds.join(', ')}`);
  }
  if (parsed.paidBy) {
    noteSegments.push(`[운송비부담] ${parsed.paidBy === 'OURS' ? '당사부담' : parsed.paidBy === 'CUSTOMER' ? '고객청구' : '편도지원'}`);
  }
  if (parsed.siteAddress) {
    noteSegments.push(`[현장주소] ${parsed.siteAddress}`);
  }
  if (parsed.safetyOptions.length > 0) {
    noteSegments.push(`[안전옵션] ${parsed.safetyOptions.join(', ')}`);
  }

  const finalNote = noteSegments.join(' | ');

  const newDraft = await createDraftOrder({
    ownerId: upload.uploader_id || 'sys-admin',
    sourceCallIds: [upload.id],
    context: context,
    customerName: {
      value: matchedCustomerName,
      confidence: customerFound ? 'HIGH' : parsed.customerName ? 'MEDIUM' : 'MISSING',
      source: customerFound ? 'DB' : upload.summary_text ? 'SUMMARY' : 'MANUAL',
      confirmed: customerFound,
    },
    siteName: {
      value: parsed.siteName || '',
      confidence: parsed.siteName ? 'MEDIUM' : 'MISSING',
      confirmed: false,
    },
    equipments: finalEquipments,
    loadingDate: {
      value: finalDate,
      confidence: parsed.loadingDate ? 'HIGH' : 'MEDIUM',
      confirmed: false,
    },
    loadingTime: {
      value: finalTime,
      confidence: parsed.loadingTime ? 'HIGH' : 'LOW',
      confirmed: false,
    },
    contactPerson: {
      value: parsed.contactPerson || '',
      confidence: parsed.contactPerson ? 'HIGH' : 'MISSING',
      confirmed: false,
    },
    contactPhone: phone,
    note: finalNote,
    isNewCustomer: !customerFound,
    customerRegistered: customerFound,
    status: 'DRAFT',
    urgency: parsed.loadingDate && parsed.loadingDate <= new Date().toISOString().slice(0, 10) ? 'HIGH' : 'LOW',
  });

  // 4. call_uploads 상태를 PROCESSED 로 갱신
  await supabase
    .from('call_uploads')
    .update({
      status: 'PROCESSED',
      draft_id: newDraft.id,
      processed_at: new Date().toISOString(),
    })
    .eq('id', uploadId);

  // 5. 로깅 (무누락 DB 저장)
  await insertPipelineLog({
    callUploadId: uploadId,
    draftId: newDraft.id,
    eventType: 'AUTO_DRAFT_CREATED',
    level: 'SUCCESS',
    message: `출고의뢰 초안이 자동 생성되었습니다. (의뢰ID: ${newDraft.id.slice(0, 8)}..., 장비: ${finalEquipments.map(e => `${e.modelName}×${e.qty}`).join(', ')}, 연락처: ${phone || '미지정'})`,
    payload: {
      upload_id: uploadId,
      draft_id: newDraft.id,
      file_name: upload.file_name,
      phone,
      customer: matchedCustomerName || '(미상)',
      equipments: finalEquipments,
    },
  });

  return newDraft;
}

// ─── 통화 업로드 항목 삭제 ─────────────────────────────────
export async function deleteCallUpload(uploadId: string, storagePath?: string): Promise<void> {
  if (!supabase) return;

  try {
    if (storagePath) {
      await supabase.storage.from('call-recordings').remove([storagePath]);
    }
  } catch (e: any) {
    console.warn('스토리지 파일 삭제 예외:', e?.message);
  }

  const { error } = await supabase.from('call_uploads').delete().eq('id', uploadId);
  if (error) {
    console.warn('call_uploads 삭제 실패:', error.message);
  } else {
    await insertPipelineLog({
      callUploadId: uploadId,
      eventType: 'UPLOAD_DELETED',
      level: 'INFO',
      message: `통화 녹음 업로드 항목(${uploadId.slice(0, 8)}...)이 삭제되었습니다.`,
      payload: { upload_id: uploadId, storage_path: storagePath },
    });
  }
}

// ─── Realtime 초안 구독 ────────────────────────────────────
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

