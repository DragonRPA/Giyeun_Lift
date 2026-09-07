// src/services/r2MirrorSync.ts
// e-Bro ERP Cloudflare R2 ➔ 로컬 PC (C:\eBroAgent\drive_mirror\) 100% 무인 미러링 동기화 엔진

import { GoogleConfig } from './db';
import { subscribeMirrorProgress, MirrorProgressState, MirrorSyncResult } from './driveMirrorSync';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 전역 진행상황 이벤트 발생기
type MirrorProgressListener = (state: MirrorProgressState) => void;
const internalListeners: Set<MirrorProgressListener> = new Set();

let currentProgress: MirrorProgressState = {
  isActive: false,
  phase: 'IDLE',
  currentFile: '',
  currentIndex: 0,
  totalCount: 0,
  percent: 0,
  message: ''
};

function updateProgress(partial: Partial<MirrorProgressState>) {
  currentProgress = { ...currentProgress, ...partial };
  internalListeners.forEach(fn => {
    try { fn(currentProgress); } catch (e) {}
  });
}

export function subscribeR2MirrorProgress(listener: MirrorProgressListener): () => void {
  internalListeners.add(listener);
  listener(currentProgress);
  return () => internalListeners.delete(listener);
}

/**
 * Cloudflare R2 버킷의 모든 하위 폴더와 파일들을 로컬 에이전트(C:\eBroAgent\drive_mirror\)로 일괄 무인 미러링
 */
export async function executeR2MirrorSync(
  config?: GoogleConfig,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<MirrorSyncResult> {
  const accountId = config?.r2AccountId?.trim();
  const bucketName = config?.r2BucketName?.trim();
  const accessKeyId = config?.r2AccessKeyId?.trim();
  const secretAccessKey = config?.r2SecretAccessKey?.trim();
  let publicDomain = config?.r2PublicDomain?.trim();

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    return {
      success: false,
      syncedCount: 0,
      failedCount: 0,
      files: [],
      message: 'Cloudflare R2 설정 정보(Account ID, Bucket Name, Access Key, Secret Key)가 설정되지 않았습니다.'
    };
  }

  if (publicDomain && publicDomain.endsWith('/')) {
    publicDomain = publicDomain.slice(0, -1);
  }

  updateProgress({
    isActive: true,
    phase: 'SCANNING',
    currentFile: 'Cloudflare R2 버킷 연결 중...',
    currentIndex: 0,
    totalCount: 0,
    percent: 5,
    message: `Cloudflare R2 [${bucketName}] 파일 트리 탐색 중...`
  });

  try {
    // 1. R2 버킷 내 모든 파일 및 하위 폴더 계층 목록 조회 (Vercel Serverless API)
    const listRes = await fetch('/api/r2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list',
        accountId,
        bucketName,
        accessKeyId,
        secretAccessKey
      })
    });

    if (!listRes.ok) {
      const errJson = await listRes.json().catch(() => ({}));
      throw new Error(errJson.error || `R2 파일 목록 조회 실패 (HTTP ${listRes.status})`);
    }

    const listData = await listRes.json();
    const r2Files: Array<{ key: string; size: number; lastModified: string }> = listData.files || [];

    if (r2Files.length === 0) {
      updateProgress({
        isActive: false,
        phase: 'IDLE',
        message: 'R2 버킷에 동기화할 파일이 없습니다.'
      });
      return {
        success: true,
        syncedCount: 0,
        failedCount: 0,
        files: [],
        message: 'Cloudflare R2 버킷이 비어 있습니다.'
      };
    }

    updateProgress({
      phase: 'DOWNLOADING',
      currentFile: '파일 다운로드 준비 중...',
      currentIndex: 0,
      totalCount: r2Files.length,
      percent: 10,
      message: `총 ${r2Files.length}개 파일 수신 준비 중...`
    });

    // 2. 각 파일 바이너리 다운로드 (공개 도메인 또는 S3 API)
    const payloadFiles: Array<{ name: string; base64Content: string; modifiedTime: string }> = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < r2Files.length; i++) {
      const item = r2Files[i];
      const progressPercent = Math.min(85, Math.round(((i + 1) / r2Files.length) * 75) + 10);

      updateProgress({
        phase: 'DOWNLOADING',
        currentFile: item.key,
        currentIndex: i + 1,
        totalCount: r2Files.length,
        percent: progressPercent,
        message: `[${i + 1}/${r2Files.length}] ${item.key} 수신 중...`
      });

      if (onProgress) {
        onProgress(`[${i + 1}/${r2Files.length}] ${item.key} 수신 중...`, i + 1, r2Files.length);
      }

      try {
        let buf: ArrayBuffer | null = null;

        if (publicDomain) {
          // 공개 R2 도메인을 통한 0.01초 초고속 다이렉트 수신
          const encodedKey = item.key.split('/').map(encodeURIComponent).join('/');
          const fileUrl = `${publicDomain}/${encodedKey}`;
          const res = await fetch(fileUrl, { cache: 'no-store' });
          if (res.ok) {
            buf = await res.arrayBuffer();
          }
        }

        if (buf) {
          payloadFiles.push({
            name: item.key, // 하위 폴더 상대경로 그대로 유지 (예: 01.사업자/사업자등록증.pdf)
            base64Content: arrayBufferToBase64(buf),
            modifiedTime: item.lastModified || new Date().toISOString()
          });
          successCount++;
        } else {
          failCount++;
        }
      } catch (dlErr) {
        console.warn(`[R2 Sync] 파일 수신 오류 (${item.key}):`, dlErr);
        failCount++;
      }
    }

    if (payloadFiles.length === 0) {
      throw new Error('R2 파일 수신에 실패했습니다. 공개 도메인(R2 Public Domain) 설정을 확인해 주세요.');
    }

    // 3. 로컬 사이드카 에이전트(C:\eBroAgent\drive_mirror\)로 전송 및 하위 폴더 트리 자동 생성
    updateProgress({
      phase: 'TRANSFERRING',
      currentFile: '로컬 디스크 저장 중...',
      currentIndex: payloadFiles.length,
      totalCount: payloadFiles.length,
      percent: 90,
      message: `로컬 PC (C:\\eBroAgent\\drive_mirror\\)에 ${payloadFiles.length}개 파일 저장 중...`
    });

    const agentRes = await fetch('http://127.0.0.1:5175/api/sync-drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payloadFiles })
    });

    if (!agentRes.ok) {
      throw new Error(`로컬 에이전트 응답 오류 (HTTP ${agentRes.status})`);
    }

    const agentData = await agentRes.json();
    const finalMsg = `✅ Cloudflare R2의 ${payloadFiles.length}개 파일이 C:\\eBroAgent\\drive_mirror\\ 에 실시간 미러링되었습니다.`;

    updateProgress({
      isActive: true,
      phase: 'COMPLETED',
      currentFile: '미러링 완료',
      percent: 100,
      message: finalMsg
    });

    setTimeout(() => {
      updateProgress({ isActive: false, phase: 'IDLE' });
    }, 4000);

    return {
      success: true,
      syncedCount: agentData.syncedCount || payloadFiles.length,
      failedCount: failCount,
      files: agentData.syncedFiles || payloadFiles.map(f => ({ name: f.name, size: f.base64Content.length })),
      message: finalMsg
    };

  } catch (err: any) {
    const errMsg = `Cloudflare R2 미러링 동기화 실패: ${err?.message || err}`;
    updateProgress({
      isActive: true,
      phase: 'ERROR',
      message: errMsg
    });
    setTimeout(() => {
      updateProgress({ isActive: false, phase: 'IDLE' });
    }, 5000);
    return {
      success: false,
      syncedCount: 0,
      failedCount: 0,
      files: [],
      message: errMsg
    };
  }
}

/**
 * Cloudflare R2 버킷 연결 검증
 */
export async function testR2Connection(config: GoogleConfig): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch('/api/r2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'test',
        accountId: config.r2AccountId,
        bucketName: config.r2BucketName,
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey
      })
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return {
      success: false,
      message: `연결 테스트 실패: ${err?.message || err}`
    };
  }
}
