// src/services/agentService.ts
// e-Bro ERP 로컬 사이드카 에이전트(eBroAgent) 단일 표준 메타데이터 및 통신 헬퍼

export const EXPECTED_AGENT_VERSION = 'v2.0.0.Build.1';
export const AGENT_DOWNLOAD_URL = '/downloads/eBroAgent.js';           // Node.js 경량 스크립트 (eBroAgent.js)
export const AGENT_EXE_URL = '/downloads/eBroAgent.exe';               // Node.js 독립 실행 파일
export const AGENT_LAUNCHER_URL = '/downloads/start-agent.bat';        // 실행 배치 파일
export const AGENT_KILL_BAT_URL = '/downloads/kill-agent.bat';
export const AGENT_CERT_URL = '/downloads/eBroAgent_Root.cer';         // 보안 인증서
export const AGENT_INSTALL_BAT_URL = '/downloads/install-cert.bat';     // 인증서 등록 배치 파일
export const NODEJS_INSTALL_URL = 'https://nodejs.org/en/download/';


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

/**
 * 로컬 에이전트 헬스체크 및 실시간 콜사인 동기화
 */
export async function checkLocalAgentHealth(callsign: string = 'admin'): Promise<AgentHealthInfo> {
  try {
    const res = await fetch(`http://127.0.0.1:5175/health?callsign=${encodeURIComponent(callsign)}`, {
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
    const res = await fetch('http://127.0.0.1:5175/api/restart', {
      method: 'POST',
      signal: AbortSignal.timeout(2000)
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}
