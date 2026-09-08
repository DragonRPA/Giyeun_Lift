// src/services/agentService.ts
// e-Bro ERP 로컬 사이드카 에이전트(eBroAgent) 단일 표준 메타데이터 및 통신 헬퍼

export const EXPECTED_AGENT_VERSION = 'v2.0.0.Build.1';
export const AGENT_DOWNLOAD_URL = '/downloads/BroAgent.js';            // Node.js 경량 스크립트 (BroAgent.js)
export const AGENT_BRO_JS_URL = '/downloads/BroAgent.js';               // BroAgent.js 직접 다운로드
export const AGENT_EBRO_JS_URL = '/downloads/eBroAgent.js';             // eBroAgent.js 호환 다운로드
export const AGENT_REG_BAT_URL = '/downloads/등록-원클릭실행.bat';       // 브라우저 원클릭 실행 프로토콜 등록기
export const AGENT_EXE_URL = '/downloads/eBroAgent.exe';               // Node.js 독립 실행 파일
export const AGENT_LAUNCHER_URL = '/downloads/start-agent.bat';        // 실행 배치 파일
export const AGENT_KILL_BAT_URL = '/downloads/kill-agent.bat';
export const AGENT_CERT_URL = '/downloads/eBroAgent_Root.cer';         // 보안 인증서
export const AGENT_INSTALL_BAT_URL = '/downloads/install-cert.bat';     // 인증서 등록 배치 파일
export const NODEJS_INSTALL_URL = 'https://nodejs.org/en/download/';
export const AGENT_PROTOCOL_URI = 'broagent://run';
export const AGENT_PROTOCOL_FALLBACK_URI = 'ebro://run';

/**
 * 🚀 브라우저(사이트)에서 로컬 에이전트(BroAgent.js) 원클릭 기동 트리거
 */
export function launchLocalAgentFromBrowser(): void {
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = AGENT_PROTOCOL_URI;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch (e) {}
    }, 2500);
  } catch (e) {
    window.location.href = AGENT_PROTOCOL_URI;
  }
}


export interface AgentHealthInfo {
  status: 'ONLINE' | 'OFFLINE';
  version?: string;
  callsign?: string;
  machineName?: string;
  archiveRoot?: string;
  driveMirrorDir?: string;
  uptimeSeconds?: number;
  timestamp?: string;
}

// 활성 에이전트 베이스 URL (127.0.0.1 ➔ localhost 자동 동적 폴백)
let activeAgentBaseUrl = 'http://127.0.0.1:5175';

export function getAgentBaseUrl(): string {
  return activeAgentBaseUrl;
}

/**
 * 로컬 에이전트 통신 헬퍼 (127.0.0.1 및 localhost 상호 폴백 지원)
 */
export async function fetchWithAgentFallback(path: string, init?: RequestInit): Promise<Response> {
  const candidateHosts = [
    activeAgentBaseUrl,
    activeAgentBaseUrl.includes('127.0.0.1') ? 'http://localhost:5175' : 'http://127.0.0.1:5175'
  ];

  let lastErr: any = null;
  for (const host of candidateHosts) {
    try {
      const res = await fetch(`${host}${path}`, init);
      if (res.ok || res.status < 500) {
        activeAgentBaseUrl = host;
        return res;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('로컬 에이전트 연결 실패');
}

/**
 * 로컬 에이전트 헬스체크 및 실시간 콜사인 동기화
 */
export async function checkLocalAgentHealth(callsign: string = 'admin'): Promise<AgentHealthInfo> {
  try {
    const res = await fetchWithAgentFallback(`/health?callsign=${encodeURIComponent(callsign)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      return {
        status: 'ONLINE',
        version: data.version || 'v1.0.0',
        callsign: data.callsign || callsign,
        machineName: data.machineName,
        archiveRoot: data.archiveRoot,
        driveMirrorDir: data.driveMirrorDir,
        uptimeSeconds: data.uptimeSeconds,
        timestamp: data.timestamp
      };
    }
  } catch (err) {
    // 오프라인
  }
  return { status: 'OFFLINE' };
}

/**
 * 에이전트 원클릭 핫 재시작
 */
export async function restartLocalAgent(): Promise<boolean> {
  try {
    const res = await fetchWithAgentFallback('/api/restart', {
      method: 'POST',
      signal: AbortSignal.timeout(2000)
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

