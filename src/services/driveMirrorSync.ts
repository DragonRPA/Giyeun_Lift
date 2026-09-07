// src/services/driveMirrorSync.ts
// e-Bro ERP Cloudflare R2 ➔ 로컬 PC (C:\eBroAgent\drive_mirror\) 단방향 미러링 동기화 엔진
// 원칙: CF R2가 유일한 마스터 원본(SSOT), 로컬 drive_mirror는 항상 CF R2를 따라가는 읽기 전용 사본

import { GoogleConfig } from './db';

export interface MirrorSyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  files: Array<{ name: string; size: number }>;
  message: string;
}

export interface MirrorProgressState {
  isActive: boolean;
  phase: 'IDLE' | 'SCANNING' | 'DOWNLOADING' | 'TRANSFERRING' | 'COMPLETED' | 'ERROR';
  currentFile: string;
  currentIndex: number;
  totalCount: number;
  percent: number;
  message: string;
}

type MirrorProgressListener = (state: MirrorProgressState) => void;
const listeners: Set<MirrorProgressListener> = new Set();

let currentState: MirrorProgressState = {
  isActive: false,
  phase: 'IDLE',
  currentFile: '',
  currentIndex: 0,
  totalCount: 0,
  percent: 0,
  message: ''
};

export function subscribeMirrorProgress(listener: MirrorProgressListener): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => listeners.delete(listener);
}

function updateProgress(partial: Partial<MirrorProgressState>) {
  currentState = { ...currentState, ...partial };
  listeners.forEach(fn => {
    try { fn(currentState); } catch (e) {}
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * CF R2 버킷 전체 파일 목록을 Vercel /api/r2 프록시를 통해 조회
 */
async function listR2AllFiles(config?: GoogleConfig): Promise<Array<{ key: string; size: number }>> {
  const params = new URLSearchParams({
    action: 'list',
    accountId: config?.r2AccountId || '35014a2514680107d74e1e68d96e6c32',
    bucketName: config?.r2BucketName || 'kiyeun-storage',
    accessKeyId: config?.r2AccessKeyId || '03cdb7560d37242de608a5db2a976030',
    secretAccessKey: config?.r2SecretAccessKey || 'b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986'
  });

  const res = await fetch(`/api/r2?${params.toString()}`, {
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) throw new Error(`R2 목록 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'R2 목록 조회 실패');
  return data.files || [];
}

/**
 * CF R2 공개 URL을 통해 파일 직접 다운로드
 */
async function downloadFromR2(publicDomain: string, key: string): Promise<ArrayBuffer | null> {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = `${publicDomain.replace(/\/$/, '')}/${encodedKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      return ab.byteLength > 0 ? ab : null;
    }
  } catch (e) {}
  return null;
}

const DEFAULT_CF_PUBLIC_DOMAIN = 'https://pub-a2fd3c2ae0cc450b8ebe34baf1b051e1.r2.dev';

const CF_MANIFEST_FILES: Array<{ key: string; size: number }> = [
  { key: '00.거래명세서양식.xlsx', size: 65463 },
  { key: '10.통장사본.pdf', size: 313193 },
  { key: 'Basic_Doc/4.제원표_JCPT0607DCS.pdf', size: 94837 },
  { key: 'Basic_Doc/5.인증서JCPT0607DCS(2016년4월25일).pdf', size: 228081 },
  { key: 'Basic_Doc/6.0607 하부작동법.pdf', size: 137173 },
  { key: 'Basic_Doc/6.DINGLI_상부조작방법.pdf', size: 142216 },
  { key: 'Basic_Doc/7.JCPT0807,0607_비상하강 작동법.pdf', size: 124459 },
  { key: 'Basic_Doc/거래명세서양식.xlsx', size: 65565 },
  { key: 'Basic_Doc/견적서_양식.pdf', size: 8430 },
  { key: 'Basic_Doc/고소작업대_안전점검결과서_양식.html', size: 8323 },
  { key: 'Basic_Doc/고소작업대_임대차계약서_양식.html', size: 9003 },
  { key: 'Basic_Doc/렌탈견적서_양식.html', size: 8306 },
  { key: 'Basic_Doc/통장사본.pdf', size: 162239 }
];

/**
 * CF R2 버킷 전체 파일을 로컬 에이전트로 미러링
 * - CF R2가 원본(SSOT), 로컬은 항상 원본을 단방향으로 덮어씌우는 사본
 * - 구글 드라이브, Apps Script, 내장 HTML 템플릿 일체 사용 안 함
 */
export async function executeDriveMirrorSync(
  config?: GoogleConfig,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<MirrorSyncResult> {
  const publicDomain = config?.r2PublicDomain?.trim() || DEFAULT_CF_PUBLIC_DOMAIN;
  const r2BucketName = config?.r2BucketName?.trim() || 'kiyeun-storage';

  // 🌟 1순위: 로컬 에이전트 자체 실시간 SigV4 동기화 엔진 직접 가동
  try {
    updateProgress({
      isActive: true,
      phase: 'SCANNING',
      currentFile: '로컬 에이전트 실시간 스캔 중...',
      currentIndex: 0,
      totalCount: 0,
      percent: 30,
      message: '로컬 에이전트가 Cloudflare R2 버킷을 실시간 스캔 및 다운로드 중...'
    });
    onProgress?.('로컬 에이전트 실시간 버킷 스캔 및 다운로드 요청 중...', 0, 0);

    const agentRes = await fetch('http://127.0.0.1:5175/api/trigger-sync', {
      method: 'POST',
      signal: AbortSignal.timeout(20000)
    });

    if (agentRes.ok) {
      const data = await agentRes.json();
      const statusRes = await getLocalMirrorStatus();
      updateProgress({
        isActive: false,
        phase: 'COMPLETED',
        percent: 100,
        message: data.message || '동기화 완료'
      });
      return {
        success: true,
        syncedCount: statusRes.files?.length || 0,
        failedCount: 0,
        files: statusRes.files || [],
        message: data.message || 'Cloudflare R2 버킷 실시간 동기화가 완료되었습니다.'
      };
    }
  } catch (agentErr) {
    console.warn('로컬 에이전트 직접 동기화 실패, 브라우저 직접 수신으로 대체:', agentErr);
  }

  // 2순위: 브라우저 직접 수신 모드 (에이전트 구버전 또는 응답 지연 시 폴백)
  updateProgress({
    isActive: true,
    phase: 'SCANNING',
    currentFile: 'CF R2 버킷 파일 목록 조회 중...',
    currentIndex: 0,
    totalCount: 0,
    percent: 5,
    message: `CF R2 [${r2BucketName}] 버킷 전체 목록 스캔 중...`
  });

  let r2Files: Array<{ key: string; size: number }> = [];
  try {
    r2Files = await listR2AllFiles(config);
  } catch (err: any) {
    console.warn('Vercel R2 API 목록 조회 실패, 내장 매니페스트로 자동 전환:', err);
    r2Files = CF_MANIFEST_FILES;
  }

  if (r2Files.length === 0) {
    r2Files = CF_MANIFEST_FILES;
  }


  updateProgress({
    phase: 'DOWNLOADING',
    totalCount: r2Files.length,
    percent: 10,
    message: `CF R2에서 ${r2Files.length}개 파일 수신 시작...`
  });

  const payloadFiles: Array<{ name: string; base64Content: string; modifiedTime: string }> = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < r2Files.length; i++) {
    const file = r2Files[i];
    updateProgress({
      phase: 'DOWNLOADING',
      currentFile: file.key,
      currentIndex: i + 1,
      percent: Math.min(85, Math.round(((i + 1) / r2Files.length) * 75) + 10),
      message: `[${i + 1}/${r2Files.length}] ${file.key} 수신 중...`
    });
    onProgress?.(`[${i + 1}/${r2Files.length}] ${file.key}`, i + 1, r2Files.length);

    if (file.key.endsWith('/')) {
      payloadFiles.push({
        name: file.key,
        base64Content: '',
        modifiedTime: new Date().toISOString()
      });
      successCount++;
      continue;
    }

    try {
      const ab = await downloadFromR2(publicDomain, file.key);
      if (ab) {
        payloadFiles.push({
          name: file.key,
          base64Content: arrayBufferToBase64(ab),
          modifiedTime: new Date().toISOString()
        });
        successCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      failCount++;
    }
  }

  if (payloadFiles.length === 0) {
    const msg = 'CF R2 파일 다운로드에 모두 실패했습니다.';
    updateProgress({ isActive: false, phase: 'ERROR', message: msg });
    return { success: false, syncedCount: 0, failedCount: failCount, files: [], message: msg };
  }

  // 로컬 에이전트로 전송 (CF ➔ 로컬 단방향 덮어쓰기)
  updateProgress({
    phase: 'TRANSFERRING',
    currentFile: '로컬 에이전트 전송 중...',
    percent: 90,
    message: `로컬 C:\\eBroAgent\\drive_mirror\\ 에 ${payloadFiles.length}개 저장 중...`
  });

  try {
    const agentRes = await fetch('http://127.0.0.1:5175/api/sync-drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payloadFiles })
    });

    if (!agentRes.ok) throw new Error(`에이전트 오류 HTTP ${agentRes.status}`);

    const agentData = await agentRes.json();
    const finalMsg = `✅ CF R2 ${payloadFiles.length}개 파일이 C:\\eBroAgent\\drive_mirror\\ 에 미러링되었습니다.`;

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
    const errMsg = `로컬 에이전트 전송 실패: ${err?.message || err}`;
    updateProgress({ isActive: true, phase: 'ERROR', message: errMsg });
    setTimeout(() => {
      updateProgress({ isActive: false, phase: 'IDLE' });
    }, 5000);
    return {
      success: false,
      syncedCount: 0,
      failedCount: payloadFiles.length,
      files: [],
      message: errMsg
    };
  }
}

/**
 * 에이전트 로컬 미러링 폴더 내 파일 현황 조회
 */
export async function getLocalMirrorStatus(): Promise<{ success: boolean; files: Array<{ name: string; size: number; modifiedTime: string }>; mirrorPath?: string }> {
  try {
    const res = await fetch('http://127.0.0.1:5175/api/mirror-status', {
      method: 'GET',
      signal: AbortSignal.timeout(1500)
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {}
  return { success: false, files: [] };
}


