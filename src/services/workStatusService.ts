// src/services/workStatusService.ts
// ============================================================
// 영업사원 출퇴근 상태 서비스
// 웹앱 ↔ APK 실시간 동기화 (Supabase Realtime + LocalStorage Fallback)
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

export const FALLBACK_APK_RELEASE: ApkRelease = {
  id:          'release-v1.0.0',
  version:     'v1.0.0',
  storagePath: '/downloads/KiyeunCallCapture.apk',
  fileSize:    24701,
  releaseNote: '기연 통화 녹음 자동 캡처 및 출퇴근 동기화 모바일 패키지',
  isLatest:    true,
  createdAt:   '2026-09-06T00:00:00.000Z',
  downloadUrl: '/downloads/KiyeunCallCapture.apk',
};

const LOCAL_STORAGE_KEY_PREFIX = 'erp_user_work_status_';

function getLocalWorkStatus(userId: string): WorkStatus {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${userId}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (_) {}
  return {
    userId,
    isWorking: false,
    workStartedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function setLocalWorkStatus(status: WorkStatus): void {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${status.userId}`, JSON.stringify(status));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('work-status-changed', { detail: status }));
    }
  } catch (_) {}
}

// ─── 출퇴근 상태 조회 ────────────────────────────────────
export async function getMyWorkStatus(userId?: string): Promise<WorkStatus | null> {
  const targetUserId = userId || 'current_user';

  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('user_work_status')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        const remoteStatus: WorkStatus = {
          userId:        data.user_id,
          isWorking:     Boolean(data.is_working),
          workStartedAt: data.work_started_at,
          updatedAt:     data.updated_at,
        };
        setLocalWorkStatus(remoteStatus);
        return remoteStatus;
      }
    } catch (_) {
      // 테이블 미존재 또는 네트워크 오류 시 로컬 스토리지로 폴백
    }
  }

  return getLocalWorkStatus(targetUserId);
}

// ─── 출근 처리 ────────────────────────────────────────────
export async function clockIn(userId: string): Promise<WorkStatus> {
  const now = new Date().toISOString();
  const status: WorkStatus = {
    userId,
    isWorking:     true,
    workStartedAt: now,
    updatedAt:     now,
  };

  // 1) 로컬 스토리지 즉시 확정 및 이벤트 발송 (무음 실패 방지)
  setLocalWorkStatus(status);

  // 2) Supabase 원격 테이블 업서트 시도
  if (supabase) {
    try {
      await supabase
        .from('user_work_status')
        .upsert({
          user_id:         userId,
          is_working:      true,
          work_started_at: now,
          updated_at:      now,
        }, { onConflict: 'user_id' });
    } catch (e) {
      console.warn('Supabase 출근 원격 동기화 알림 (로컬 상태 유지):', e);
    }
  }

  return status;
}

// ─── 퇴근 처리 ────────────────────────────────────────────
export async function clockOut(userId: string): Promise<WorkStatus> {
  const now = new Date().toISOString();
  const status: WorkStatus = {
    userId,
    isWorking:     false,
    workStartedAt: null,
    updatedAt:     now,
  };

  // 1) 로컬 스토리지 즉시 확정 및 이벤트 발송
  setLocalWorkStatus(status);

  // 2) Supabase 원격 테이블 업서트 시도
  if (supabase) {
    try {
      await supabase
        .from('user_work_status')
        .upsert({
          user_id:         userId,
          is_working:      false,
          work_started_at: null,
          updated_at:      now,
        }, { onConflict: 'user_id' });
    } catch (e) {
      console.warn('Supabase 퇴근 원격 동기화 알림 (로컬 상태 유지):', e);
    }
  }

  return status;
}

// ─── 실시간 구독 ──────────────────────────────────────────
export function subscribeWorkStatus(
  userId: string,
  onChange: (status: WorkStatus) => void
): () => void {
  // 1) 브라우저 로컬 이벤트 구독
  const handleLocalChange = (e: Event) => {
    const customEvent = e as CustomEvent<WorkStatus>;
    if (customEvent.detail && (customEvent.detail.userId === userId || !userId)) {
      onChange(customEvent.detail);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('work-status-changed', handleLocalChange);
  }

  // 2) Supabase Realtime 채널 구독
  let channel: any = null;
  if (supabase && userId) {
    try {
      channel = supabase
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
            if (d && d.user_id) {
              const status: WorkStatus = {
                userId:        d.user_id as string,
                isWorking:     Boolean(d.is_working),
                workStartedAt: d.work_started_at as string | null,
                updatedAt:     d.updated_at as string,
              };
              onChange(status);
            }
          }
        )
        .subscribe();
    } catch (_) {}
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('work-status-changed', handleLocalChange);
    }
    if (channel && supabase) {
      try {
        supabase.removeChannel(channel);
      } catch (_) {}
    }
  };
}

// ─── APK 최신 릴리즈 조회 ────────────────────────────────
export async function getLatestApkRelease(): Promise<ApkRelease> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('apk_releases')
        .select('*')
        .eq('is_latest', true)
        .maybeSingle();

      if (!error && data) {
        const { data: urlData } = supabase.storage
          .from('apk-releases')
          .getPublicUrl(data.storage_path);

        return {
          id:          data.id,
          version:     data.version || FALLBACK_APK_RELEASE.version,
          storagePath: data.storage_path,
          fileSize:    data.file_size || FALLBACK_APK_RELEASE.fileSize,
          releaseNote: data.release_note || FALLBACK_APK_RELEASE.releaseNote,
          isLatest:    data.is_latest,
          createdAt:   data.created_at,
          downloadUrl: urlData?.publicUrl || FALLBACK_APK_RELEASE.downloadUrl,
        };
      }
    } catch (_) {}
  }

  return FALLBACK_APK_RELEASE;
}
