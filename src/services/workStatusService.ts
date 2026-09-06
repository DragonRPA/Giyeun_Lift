// src/services/workStatusService.ts
// ============================================================
// 영업사원 출퇴근 상태 서비스
// 웹앱 ↔ APK 실시간 동기화 (Supabase Realtime)
// ============================================================
import { supabase } from './db';

export interface WorkStatus {
  userId:        string;
  isWorking:     boolean;
  workStartedAt: string | null;
  updatedAt:     string;
}

export interface ApkRelease {
  id:          string;
  version:     string;
  storagePath: string;
  fileSize:    number | null;
  releaseNote: string | null;
  isLatest:    boolean;
  createdAt:   string;
  downloadUrl?: string;
}

// ─── 출퇴근 상태 조회 ────────────────────────────────────
export async function getMyWorkStatus(): Promise<WorkStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('user_work_status')
    .select('*')
    .maybeSingle();
  if (error || !data) return null;
  return {
    userId:        data.user_id,
    isWorking:     data.is_working,
    workStartedAt: data.work_started_at,
    updatedAt:     data.updated_at,
  };
}

// ─── 출근 처리 ────────────────────────────────────────────
export async function clockIn(userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase 미연결');
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_work_status')
    .upsert({
      user_id:         userId,
      is_working:      true,
      work_started_at: now,
      updated_at:      now,
    }, { onConflict: 'user_id' });
  if (error) throw new Error(`출근 처리 실패: ${error.message}`);
}

// ─── 퇴근 처리 ────────────────────────────────────────────
export async function clockOut(userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase 미연결');
  const { error } = await supabase
    .from('user_work_status')
    .upsert({
      user_id:         userId,
      is_working:      false,
      work_started_at: null,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw new Error(`퇴근 처리 실패: ${error.message}`);
}

// ─── 실시간 구독 ──────────────────────────────────────────
export function subscribeWorkStatus(
  userId: string,
  onChange: (status: WorkStatus) => void
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`work-status-${userId}`)
    .on(
      'postgres_changes',
      {
        event:  '*',
        schema: 'public',
        table:  'user_work_status',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const d = payload.new as Record<string, unknown>;
        onChange({
          userId:        d.user_id as string,
          isWorking:     d.is_working as boolean,
          workStartedAt: d.work_started_at as string | null,
          updatedAt:     d.updated_at as string,
        });
      }
    )
    .subscribe();
  return () => { supabase!.removeChannel(channel); };
}

// ─── APK 최신 릴리즈 조회 ────────────────────────────────
export async function getLatestApkRelease(): Promise<ApkRelease | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('apk_releases')
    .select('*')
    .eq('is_latest', true)
    .maybeSingle();
  if (error || !data) return null;

  // 다운로드 URL 생성
  const { data: urlData } = supabase.storage
    .from('apk-releases')
    .getPublicUrl(data.storage_path);

  return {
    id:          data.id,
    version:     data.version,
    storagePath: data.storage_path,
    fileSize:    data.file_size,
    releaseNote: data.release_note,
    isLatest:    data.is_latest,
    createdAt:   data.created_at,
    downloadUrl: urlData?.publicUrl ?? undefined,
  };
}
