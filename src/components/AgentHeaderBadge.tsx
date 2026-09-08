import React, { useState, useEffect, useRef } from 'react';
import { Bot, Download, RefreshCw, Shield, ChevronDown, CheckCircle2, AlertTriangle, X, Cloud, FolderCheck, HardDrive, Play } from 'lucide-react';
import { EXPECTED_AGENT_VERSION, AGENT_DOWNLOAD_URL, AGENT_BRO_JS_URL, AGENT_REG_BAT_URL, AGENT_LAUNCHER_URL, AGENT_CERT_URL, AGENT_INSTALL_BAT_URL, NODEJS_INSTALL_URL, launchLocalAgentFromBrowser, restartLocalAgent, fetchWithAgentFallback } from '../services/agentService';
import { executeDriveMirrorSync, getLocalMirrorStatus, subscribeMirrorProgress, MirrorProgressState } from '../services/driveMirrorSync';
import { useApp } from '../context/AppContext';

interface Props {
  currentUser?: {
    loginId?: string;
    name?: string;
  } | null;
}

export const AgentHeaderBadge: React.FC<Props> = ({ currentUser }) => {
  const { googleConfigs, hasPermission } = useApp();
  const [agentStatus, setAgentStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [agentCallsign, setAgentCallsign] = useState<string>('');
  const [isRestarting, setIsRestarting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState('');
  const [isOpenMenu, setIsOpenMenu] = useState(false);

  // 에이전트 배지 권한 없는 직무는 즉시 비노출 (영업·관리·경영 등)
  const canShowAgentBadge = hasPermission('agent_badge', 'view');

  // 미러링 상태
  const [mirrorProgress, setMirrorProgress] = useState<MirrorProgressState>({
    isActive: false,
    phase: 'IDLE',
    currentFile: '',
    currentIndex: 0,
    totalCount: 0,
    percent: 0,
    message: ''
  });
  const [mirrorFiles, setMirrorFiles] = useState<Array<{ name: string; size: number; modifiedTime: string }>>([]);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // 미러링 진행상황 구독
  useEffect(() => {
    return subscribeMirrorProgress(setMirrorProgress);
  }, []);

  // 3초 주기 헬스체크 및 실시간 콜사인 바인딩
  useEffect(() => {
    let isMounted = true;
    const check = async () => {
      try {
        const userCallsign = currentUser?.loginId || currentUser?.name || 'admin';
        const res = await fetchWithAgentFallback(`/health?callsign=${encodeURIComponent(userCallsign)}`, {
          method: 'GET',
          signal: AbortSignal.timeout(1500),
          cache: 'no-store'
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setAgentStatus('ONLINE');
            setAgentVersion(data.version || '');
            setAgentCallsign(data.callsign || userCallsign);
          }

          // 로컬 미러링 현황 경량 조회 (0.01초 로컬 질의)
          const mStatus = await getLocalMirrorStatus();
          if (isMounted && mStatus.success) {
            setMirrorFiles(mStatus.files || []);
          }

          return;
        }
      } catch (e) {}
      if (isMounted) {
        setAgentStatus('OFFLINE');
        setAgentVersion('');
        setAgentCallsign('');
        setMirrorFiles([]);
      }
    };

    check();
    const interval = setInterval(check, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [currentUser, googleConfigs]);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpenMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isLatest = agentStatus === 'ONLINE' && agentVersion === EXPECTED_AGENT_VERSION;
  const isOutdated = agentStatus === 'ONLINE' && !isLatest;

  // 1단계: 인증서 다운로드
  const handleDownloadCert = () => {
    try {
      const link1 = document.createElement('a');
      link1.href = AGENT_CERT_URL;
      link1.download = 'eBroAgent_Root.cer';
      document.body.appendChild(link1);
      link1.click();
      document.body.removeChild(link1);

      setTimeout(() => {
        const link2 = document.createElement('a');
        link2.href = AGENT_INSTALL_BAT_URL;
        link2.download = 'install-cert.bat';
        document.body.appendChild(link2);
        link2.click();
        document.body.removeChild(link2);
      }, 300);
    } catch (e) {
      alert('인증서 다운로드 실패');
    }
  };

  // 2단계: 에이전트 파일 다운로드 (eBroAgent.js + start-agent.bat)
  const handleDownloadAgent = () => {
    setIsDownloading(true);
    try {
      // eBroAgent.js 다운로드
      const link1 = document.createElement('a');
      link1.href = AGENT_DOWNLOAD_URL;
      link1.download = 'eBroAgent.js';
      document.body.appendChild(link1);
      link1.click();
      document.body.removeChild(link1);
      // 배치 파일 다운로드
      setTimeout(() => {
        const link2 = document.createElement('a');
        link2.href = AGENT_LAUNCHER_URL;
        link2.download = 'start-agent.bat';
        document.body.appendChild(link2);
        link2.click();
        document.body.removeChild(link2);
      }, 300);
    } catch (e) {
      alert('에이전트 다운로드 실패');
    } finally {
      setTimeout(() => setIsDownloading(false), 1500);
    }
  };

  // 사이트에서 로컬 에이전트 실행 트리거
  const handleLaunchAgent = () => {
    setIsLaunching(true);
    setLaunchMsg('실행 명령 전송 중...');
    launchLocalAgentFromBrowser();

    let attempts = 0;
    const maxAttempts = 12; // 6초간 0.5초 간격 폴링
    const poller = setInterval(async () => {
      attempts++;
      try {
        const userCallsign = currentUser?.loginId || currentUser?.name || 'admin';
        const res = await fetchWithAgentFallback(`/health?callsign=${encodeURIComponent(userCallsign)}`, {
          method: 'GET',
          signal: AbortSignal.timeout(1000),
          cache: 'no-store'
        });
        if (res.ok) {
          clearInterval(poller);
          setIsLaunching(false);
          setLaunchMsg('연결 완료');
          setAgentStatus('ONLINE');
          const data = await res.json();
          setAgentVersion(data.version || '');
          setAgentCallsign(data.callsign || userCallsign);
          setTimeout(() => {
            setLaunchMsg('');
            setIsOpenMenu(false);
          }, 1500);
          return;
        }
      } catch (e) {}

      if (attempts >= maxAttempts) {
        clearInterval(poller);
        setIsLaunching(false);
        setLaunchMsg('미실행 시 실행 등록 파일(2단계) 1회 실행 필요');
      }
    }, 500);
  };

  // 핫 재시작
  const handleRestart = async () => {
    setIsRestarting(true);
    await restartLocalAgent();
    setTimeout(() => {
      setIsRestarting(false);
      setIsOpenMenu(false);
    }, 2000);
  };

  // 버전 약식 변환 헬퍼 (예: v1.100.0.Build.217 -> v1.100)
  const toShortVer = (ver: string) => {
    if (!ver) return '';
    const match = ver.match(/v\d+\.\d+/);
    return match ? match[0] : ver.split('.Build')[0];
  };

  const shortCurrent = toShortVer(agentVersion);
  const shortExpected = toShortVer(EXPECTED_AGENT_VERSION);

  return (
    // 에이전트 배지 권한 없는 직무(영업·관리·경영 등)는 전체 비노출
    canShowAgentBadge ? (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* 🟢 최신 정상 상태 배지 (콜사인 생략 & 약식 버전 & 미러링 진행 중 동적 표시) */}
      {isLatest && (
        <button
          type="button"
          onClick={() => setIsOpenMenu(!isOpenMenu)}
          style={{
            padding: '5px 10px',
            borderRadius: '20px',
            background: mirrorProgress.isActive && mirrorProgress.phase !== 'COMPLETED' ? 'rgba(37, 99, 235, 0.15)' : 'rgba(34, 197, 94, 0.15)',
            border: `1px solid ${mirrorProgress.isActive && mirrorProgress.phase !== 'COMPLETED' ? 'rgba(37, 99, 235, 0.4)' : 'rgba(34, 197, 94, 0.4)'}`,
            color: mirrorProgress.isActive && mirrorProgress.phase !== 'COMPLETED' ? '#2563eb' : '#15803d',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            fontWeight: '800',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease'
          }}
          title={`에이전트 ${agentVersion} 정상 가동 중 (클릭 시 관리)`}
        >
          {mirrorProgress.isActive && mirrorProgress.phase !== 'COMPLETED' ? (
            <>
              <RefreshCw size={11} className="animate-spin" color="#2563eb" />
              <span>미러링 ({mirrorProgress.currentIndex}/{mirrorProgress.totalCount || '?'})</span>
            </>
          ) : (
            <>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></span>
              <span>에이전트 {shortCurrent}</span>
            </>
          )}
          <ChevronDown size={11} />
        </button>
      )}

      {/* 🟡 구버전 가동 중 배지 (버전 차이 약식 표기: v1.98 ➔ v1.100) */}
      {isOutdated && (
        <button
          type="button"
          onClick={() => setIsOpenMenu(!isOpenMenu)}
          style={{
            padding: '5px 10px',
            borderRadius: '20px',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.5)',
            color: '#b45309',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            fontWeight: '800',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease'
          }}
          title={`에이전트 업데이트 필요 (현재: ${agentVersion} ➔ 최신: ${EXPECTED_AGENT_VERSION})`}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }}></span>
          <span>{shortCurrent || '구버전'} ➔ {shortExpected}</span>
          <ChevronDown size={11} />
        </button>
      )}

      {/* 🔴 미실행 (오프라인) 상태 배지 */}
      {agentStatus === 'OFFLINE' && (
        <button
          type="button"
          onClick={() => setIsOpenMenu(!isOpenMenu)}
          style={{
            padding: '5px 10px',
            borderRadius: '20px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#b91c1c',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            fontWeight: '800',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease'
          }}
          title={`로컬 에이전트 미실행 (최신: ${EXPECTED_AGENT_VERSION})`}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }}></span>
          <span>에이전트 미실행</span>
          <ChevronDown size={11} />
        </button>
      )}

      {/* ═══ 클릭 시 열리는 미니 팝오버 메뉴 ═══ */}
      {isOpenMenu && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 9999,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '16px',
          width: '320px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
          color: 'var(--text-primary)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '800' }}>
              <Bot size={16} color="var(--primary)" />
              로컬 사이드카 에이전트 상태
            </div>
            <button type="button" onClick={() => setIsOpenMenu(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={14} />
            </button>
          </div>

          {/* 상태 정보 표기 */}
          <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>연결 상태:</span>
              <span style={{ fontWeight: '800', color: agentStatus === 'ONLINE' ? '#16a34a' : '#dc2626' }}>
                {agentStatus === 'ONLINE' ? '🟢 가동중 (ONLINE)' : '🔴 미실행 (OFFLINE)'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>현재 버전:</span>
              <span style={{ fontWeight: '700' }}>{agentVersion || '없음'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>최신 요구 버전:</span>
              <span style={{ fontWeight: '800', color: 'var(--primary)' }}>{EXPECTED_AGENT_VERSION}</span>
            </div>
            {agentCallsign && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>작업자(콜사인):</span>
                <span style={{ fontWeight: '700' }}>{agentCallsign}</span>
              </div>
            )}
          </div>

          {/* ⚠️ 에이전트 콘솔 창이 켜져 있는데 미연결로 뜰 때 브라우저 보안 안내 */}
          {agentStatus === 'OFFLINE' && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '11px',
              lineHeight: '1.55'
            }}>
              <div style={{ fontWeight: '800', color: '#dc2626', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <AlertTriangle size={13} />
                콘솔 창이 켜져 있는데 미연결로 표시될 때 조치법
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>
                Chrome/Edge 로컬 루프백 보안 차단 또는 콘솔 일시정지 상태입니다:
                <div style={{ marginTop: '5px', color: 'var(--text-main)', fontSize: '11px', background: 'var(--bg-card)', padding: '6px 8px', borderRadius: '5px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div>
                    <b>1.</b> 주소창 좌측 <b>[설정/조정 아이콘]</b> 클릭 ➔ <b>[기기의 앱 (Apps on device)]</b>을 <b>[허용(ON)]</b>으로 변경 (안 보이면 [사이트 설정] 클릭 후 허용)
                  </div>
                  <div>
                    <b>2.</b> 검은색 콘솔 창 제목에 <b>'선택'</b> 글자가 있으면 마우스 클릭으로 일시정지된 상태입니다. 콘솔 창을 클릭 후 <b>[Enter]</b> 또는 <b>[Esc]</b>를 1회 누르세요.
                  </div>
                  <div style={{ color: '#16a34a', fontWeight: '800' }}>
                    <b>3.</b> <b>[F5]</b> 새로고침 시 즉시 🟢 정상 연결 완료!
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 📁 로컬 미러링(동기화) 현황 섹션 (ONLINE일 때) */}
          {agentStatus === 'ONLINE' && (
            <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: '800', display: 'flex', alignItems: 'center', gap: '5px', color: '#16a34a' }}>
                  <HardDrive size={13} />
                  CF 로컬 미러링 ({mirrorFiles.length}개)
                </span>
                <button
                  type="button"
                  disabled={isSyncingDrive}
                  onClick={async () => {
                    setIsSyncingDrive(true);
                    setSyncMessage('CF 버킷 실시간 동기화 중...');
                    try {
                      const agentRes = await fetchWithAgentFallback('/api/trigger-sync', {
                        method: 'POST',
                        signal: AbortSignal.timeout(15000)
                      });
                      if (agentRes.ok) {
                        const data = await agentRes.json();
                        const mStatus = await getLocalMirrorStatus();
                        if (mStatus.success) setMirrorFiles(mStatus.files || []);
                        setSyncMessage(data.message || '동기화 완료');
                      } else {
                        const res = await executeDriveMirrorSync(googleConfigs?.[0], (msg) => setSyncMessage(msg));
                        const mStatus = await getLocalMirrorStatus();
                        if (mStatus.success) setMirrorFiles(mStatus.files || []);
                        setSyncMessage(res.message);
                      }
                    } catch (e: any) {
                      const res = await executeDriveMirrorSync(googleConfigs?.[0], (msg) => setSyncMessage(msg));
                      const mStatus = await getLocalMirrorStatus();
                      if (mStatus.success) setMirrorFiles(mStatus.files || []);
                      setSyncMessage(res.message);
                    } finally {
                      setIsSyncingDrive(false);
                      setTimeout(() => setSyncMessage(''), 4000);
                    }
                  }}
                  style={{
                    padding: '3px 7px',
                    fontSize: '11px',
                    fontWeight: '700',
                    borderRadius: '4px',
                    background: 'rgba(22,163,74,0.12)',
                    color: '#16a34a',
                    border: '1px solid rgba(22,163,74,0.3)',
                    cursor: isSyncingDrive ? 'wait' : 'pointer'
                  }}
                >
                  {isSyncingDrive ? '동기화 중...' : '⚡ 지금 동기화'}
                </button>
              </div>

              {syncMessage && (
                <div style={{ fontSize: '11px', color: syncMessage.startsWith('⚠️') ? '#ef4444' : '#16a34a', fontWeight: '700', margin: '4px 0' }}>
                  {syncMessage}
                </div>
              )}

              {mirrorFiles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '100px', overflowY: 'auto', marginTop: '4px' }}>
                  {mirrorFiles.map((f, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '200px' }}>📄 {f.name}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{(f.size / 1024).toFixed(1)} KB</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  아직 미러링된 파일이 없습니다. [⚡ 지금 동기화]를 눌러주세요.
                </div>
              )}
            </div>
          )}

          {/* 액션 버튼 그룹 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {agentStatus === 'OFFLINE' && (
              <>
                {/* 🚀 브라우저(사이트)에서 로컬 에이전트 실행 */}
                <button
                  type="button"
                  disabled={isLaunching}
                  onClick={handleLaunchAgent}
                  style={{
                    width: '100%',
                    padding: '10px',
                    fontSize: '13px',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    border: 'none',
                    borderRadius: '7px',
                    color: '#fff',
                    cursor: isLaunching ? 'wait' : 'pointer',
                    boxShadow: '0 2px 6px rgba(37,99,235,0.35)'
                  }}
                >
                  <Play size={14} fill="#fff" />
                  {isLaunching ? '실행 명령 전송 중...' : '사이트에서 에이전트 실행'}
                </button>
                {launchMsg && (
                  <div style={{ fontSize: '11px', textAlign: 'center', color: launchMsg.includes('완료') ? '#16a34a' : '#b45309', fontWeight: '700' }}>
                    {launchMsg}
                  </div>
                )}

                {/* 1단계: 에이전트 파일 다운로드 */}
                <a
                  href={AGENT_BRO_JS_URL}
                  download="BroAgent.js"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '12px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '7px',
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                    boxSizing: 'border-box'
                  }}
                >
                  <Download size={13} color="var(--primary)" />
                  1단계: 에이전트 파일 다운로드 (BroAgent.js)
                </a>

                {/* 2단계: 브라우저 실행 등록 */}
                <a
                  href={AGENT_REG_BAT_URL}
                  download="등록-원클릭실행.bat"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '12px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '7px',
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                    boxSizing: 'border-box'
                  }}
                >
                  <Download size={13} color="#0284c7" />
                  2단계: 브라우저 실행 등록 파일 (.bat)
                </a>

                {/* 3단계: Node.js 설치 링크 */}
                <a
                  href={NODEJS_INSTALL_URL}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    fontSize: '11px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'transparent',
                    border: '1px dashed var(--border-color)',
                    borderRadius: '7px',
                    color: 'var(--text-muted)',
                    textDecoration: 'none',
                    boxSizing: 'border-box'
                  }}
                >
                  3단계: Node.js 설치 (미설치 PC 전용)
                </a>
              </>
            )}

            {isOutdated && (
              <button
                type="button"
                className="btn-primary"
                disabled={isDownloading}
                onClick={handleDownloadAgent}
                style={{ width: '100%', padding: '9px 10px', fontSize: '12.5px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: 'none', color: '#fff' }}
              >
                <Download size={14} />
                {isDownloading ? '다운로드 중...' : `📥 최신 에이전트 (${EXPECTED_AGENT_VERSION}) 받기`}
              </button>
            )}


            {agentStatus === 'ONLINE' && (
              <button
                type="button"
                className="btn-secondary"
                disabled={isRestarting}
                onClick={handleRestart}
                style={{ width: '100%', padding: '8px 10px', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <RefreshCw size={13} className={isRestarting ? 'animate-spin' : ''} />
                {isRestarting ? '에이전트 재기동 중...' : '🔄 에이전트 1초 핫 재시작'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    ) : null
  );
};
