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

// ─── 🧠 [스마트 키워드 파서] 통화 텍스트/삼성요약/메모에서 출고 파라미터 자동 추출 ──
export interface ParsedSummaryInfo {
  equipments: EquipmentItem[];
  customerName?: string;
  siteName?: string;
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

  // 1. 전화번호 추출 (텍스트 우선, 파일명 보조)
  const phoneMatch = rawText.match(/(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|02[-.\s]?\d{3,4}[-.\s]?\d{4}|0[3-6]\d[-.\s]?\d{3,4}[-.\s]?\d{4})/)
    || rawFile.match(/(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|02[-.\s]?\d{3,4}[-.\s]?\d{4}|0[3-6]\d[-.\s]?\d{3,4}[-.\s]?\d{4})/);
  
  if (phoneMatch) {
    const raw = phoneMatch[0].replace(/[-.\s]/g, '');
    if (raw.startsWith('02')) {
      result.contactPhone = raw.length === 9 ? `02-${raw.slice(2, 5)}-${raw.slice(5)}` : `02-${raw.slice(2, 6)}-${raw.slice(6)}`;
    } else if (raw.length === 11) {
      result.contactPhone = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
    } else if (raw.length === 10) {
      result.contactPhone = `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
    }
  } else if (rawFile) {
    const pFromFn = parsePhoneFromFileName(rawFile);
    if (pFromFn) result.contactPhone = pFromFn;
  }

  // 2. 담당자 이름 추출 (1~4글자 성씨 + 직책 대응)
  const explicitMatch = rawText.match(/(?:담당자|인수자|소장)\s*[:：]?\s*([가-힣]{2,4})/);
  const titleMatch = rawText.match(/([가-힣]{1,4}\s*(?:소장님?|반장님?|과장님?|부장님?|팀장님?|대리님?))/);
  if (titleMatch && titleMatch[0]) {
    const candidate = titleMatch[0].trim().replace(/님$/, '');
    if (!['내일', '모레', '아침', '오전', '오후', '현대', '삼성', '대우'].some(w => candidate.startsWith(w))) {
      result.contactPerson = candidate;
    }
  } else if (explicitMatch && explicitMatch[1]) {
    result.contactPerson = explicitMatch[1].trim();
  }

  // 3. 현장명 추출
  const siteMatch = rawText.match(/([가-힣a-zA-Z0-9]{2,15}\s*(?:현장|신축현장|PJ|플랜트))/);
  if (siteMatch && siteMatch[0]) {
    result.siteName = siteMatch[0].trim();
  }

  // 4. 날짜 추출
  const now = new Date();
  if (clean.includes('내일')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    result.loadingDate = d.toISOString().split('T')[0];
  } else if (clean.includes('모레') || clean.includes('내일모레')) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    result.loadingDate = d.toISOString().split('T')[0];
  } else if (clean.includes('오늘') || clean.includes('당일')) {
    result.loadingDate = now.toISOString().split('T')[0];
  } else {
    const ymdMatch = clean.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (ymdMatch) {
      result.loadingDate = `${ymdMatch[1]}-${String(ymdMatch[2]).padStart(2, '0')}-${String(ymdMatch[3]).padStart(2, '0')}`;
    } else {
      const mdMatch = clean.match(/(\d{1,2})월\s*(\d{1,2})일/);
      if (mdMatch) {
        const m = parseInt(mdMatch[1], 10);
        const d = parseInt(mdMatch[2], 10);
        result.loadingDate = `${now.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // 5. 시간 추출
  if (/ASAP|즉시|당장|긴급/i.test(clean)) {
    result.loadingTime = 'ASAP';
  } else {
    const timeMatch = clean.match(/(아침|새벽|오전|오후|낮|저녁)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/);
    if (timeMatch) {
      const ampm = timeMatch[1] || '';
      let hour = parseInt(timeMatch[2], 10);
      const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      if ((ampm === '오후' || ampm === '저녁' || ampm === '낮') && hour < 12) {
        hour += 12;
      }
      result.loadingTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } else {
      const colonTimeMatch = clean.match(/(\d{1,2}):(\d{2})/);
      if (colonTimeMatch) {
        result.loadingTime = `${String(colonTimeMatch[1]).padStart(2, '0')}:${colonTimeMatch[2]}`;
      }
    }
  }

  // 6. 🛡️ [WTT 검증 결함 해결] 장비 모델 및 수량 추출
  const countMap: Record<string, number> = {
    '한': 1, '일': 1, '하나': 1, '두': 2, '이': 2, '둘': 2,
    '세': 3, '삼': 3, '셋': 3, '네': 4, '사': 4, '넷': 4,
    '다섯': 5, '오': 5, '여섯': 6, '육': 6, '일곱': 7, '칠': 7,
    '여덟': 8, '팔': 8, '아홉': 9, '구': 9, '열': 10, '십': 10,
  };

  const detectedEquipments: EquipmentItem[] = [];
  // 텍스트가 있으면 텍스트만 스캔 (파일명의 전화번호/타임스탬프 오인식 방지)
  const textToScan = rawText.length > 0 ? rawText : rawFile.replace(/01[016789]\d{7,8}/g, '').replace(/\d{8}_\d{6}/g, '');

  const modelRegex = /(1930|2632|2646|3219|3226|3246|4047|4626|4632|0812|0808|1012|0608|1412|1612|19피트|26피트|32피트|40피트|46피트|53피트|19ft|26ft|32ft|40ft|46ft|53ft|sj3219|sj3226|sj4632|sj4740|gs1930|gs2632|gs3246|gs4047|\b19\b(?:\s*대)|\b26\b(?:\s*대)|\b32\b(?:\s*대))/gi;
  let m: RegExpExecArray | null;
  while ((m = modelRegex.exec(textToScan)) !== null) {
    const rawKey = m[0].toUpperCase();
    let modelName = '19ft';
    if (rawKey.includes('19') || rawKey.includes('0608')) modelName = '19ft';
    else if (rawKey.includes('26') || rawKey.includes('0812') || rawKey.includes('0808')) modelName = '26ft';
    else if (rawKey.includes('32') || rawKey.includes('1012')) modelName = '32ft';
    else if (rawKey.includes('40') || rawKey.includes('4047')) modelName = '40ft';
    else if (rawKey.includes('46') || rawKey.includes('1412')) modelName = '46ft';
    else if (rawKey.includes('53') || rawKey.includes('1612')) modelName = '53ft';

    // 🛡️ [버그 수정]: 모델 매칭 문자열 '이후'부터 슬라이스하여 모델명 숫자(19, 26 등)가 수량으로 오인식되는 결함 원천 차단!
    const afterMatch = textToScan.substring(m.index + m[0].length, m.index + m[0].length + 20);
    const countMatch = afterMatch.match(/^\s*(\d+)\s*(?:대|개)?/) 
      || afterMatch.match(/^\s*(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*대/)
      || afterMatch.match(/(\d+)\s*(?:대|개)/)
      || afterMatch.match(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*대/);

    let qty = 1;
    if (countMatch) {
      const rawNum = countMatch[1];
      if (countMap[rawNum]) qty = countMap[rawNum];
      else if (!isNaN(parseInt(rawNum, 10))) qty = Math.max(1, parseInt(rawNum, 10));
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

  // 7. 안전 옵션 탐색
  if (clean.includes('협착방지') || clean.includes('협착방지봉')) result.safetyOptions.push('협착방지봉');
  if (clean.includes('상부센서')) result.safetyOptions.push('상부센서');
  if (clean.includes('경광등')) result.safetyOptions.push('경광등');
  if (clean.includes('소화기')) result.safetyOptions.push('소화기');
  if (clean.includes('논마킹')) result.safetyOptions.push('논마킹 타이어');
  if (clean.includes('비닐보양') || clean.includes('도색보양') || clean.includes('보양')) result.safetyOptions.push('비닐보양');

  // 8. 🛡️ [대차 회수자산번호 추출] (예: "101호기", "105호기", "305호기")
  const assetMatches = clean.matchAll(/(\d{3,4})\s*호기/g);
  for (const am of assetMatches) {
    result.retrievalAssetIds.push(am[1]);
  }

  // 9. 🛡️ [운송비 부담 귀속선 추출]
  if (clean.includes('당사부담') || clean.includes('회사부담')) {
    result.paidBy = 'OURS';
  } else if (clean.includes('고객청구') || clean.includes('고객부담')) {
    result.paidBy = 'CUSTOMER';
  } else if (clean.includes('편도지원') || clean.includes('반반') || clean.includes('50%')) {
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

