// src/mobile/components/MobileWalkieTalkieModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  Radio, Volume2, VolumeX, Mic, MicOff, Play, Square,
  X, Clock, Layers, MessageSquare, ListFilter, ArrowLeft, Bell, BellOff,
  FileText, ChevronRight, Plus, UserPlus, Users, Search, Check,
  Trash2, LogOut
} from 'lucide-react';
import { 
  walkieService, WalkieTalkieChannel, WalkieReceiveMode, WalkieMessage, soundEngine, TalkingStatus, WalkieSttEngine,
  WalkieChannel, DEFAULT_WALKIE_CHANNELS
} from '../../services/walkieTalkieService';
import { useApp } from '../../context/AppContext';
import { 
  loadVoiceOrderDraft, 
  saveVoiceOrderDraft, 
  mergeVoiceFragmentToDraft, 
  VoiceOrderDraft, 
  createEmptyDraft 
} from '../../services/voiceOrderDraftService';

interface MobileWalkieTalkieModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToDispatchOrder?: () => void;
}

export const MobileWalkieTalkieModal: React.FC<MobileWalkieTalkieModalProps> = ({
  isOpen,
  onClose,
  onNavigateToDispatchOrder
}) => {
  const { currentUser, customers, sites, users, currentTenant } = useApp();
  const activeUsers = (users || []).filter(u => u.status !== 'RETIRED');

  const [isMonologueOrderMode, setIsMonologueOrderMode] = useState<boolean>(false);
  const [currentOrderDraft, setCurrentOrderDraft] = useState<VoiceOrderDraft | null>(() => loadVoiceOrderDraft());

  const [activeTab, setActiveTab] = useState<'PTT' | 'LOGS'>('PTT');
  const [isPowerOn, setIsPowerOn] = useState<boolean>(() => walkieService.getIsPowerOn());
  const [currentChannel, setCurrentChannel] = useState<WalkieTalkieChannel>(() => walkieService.getCurrentChannel());
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [history, setHistory] = useState<WalkieMessage[]>(() => walkieService.getHistory());
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [recordDuration, setRecordDuration] = useState<number>(0);

  // 📡 동적 채널 목록 및 채널 모달 상태
  const [channels, setChannels] = useState<WalkieChannel[]>(() => walkieService.getChannels(currentUser?.id));
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);
  const [newChannelName, setNewChannelName] = useState<string>('');
  const [newChannelDesc, setNewChannelDesc] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [channelSearchQuery, setChannelSearchQuery] = useState<string>('');

  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteMemberIds, setInviteMemberIds] = useState<string[]>([]);
  const [inviteSearchQuery, setInviteSearchQuery] = useState<string>('');

  // 📜 스마트 바닥 스크롤 감지 및 제어
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);
  const isAtBottomRef = useRef<boolean>(true);

  // 🛠️ 디버그 로그 표시 토글 (기본값: OFF — 필요 시 켤 수 있음)
  const [showDebugLogs, setShowDebugLogs] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage && localStorage.getItem('walkie_show_debug') === 'true';
    } catch {
      return false;
    }
  });
  // 🎙️ STT 엔진 상태 ('GROQ' | 'BROWSER')
  const [sttEngine, setSttEngine] = useState<WalkieSttEngine>(() => walkieService.getSttEngine());

  // 🌟 순차 재생 큐 대기 건수
  const [queueLength, setQueueLength] = useState<number>(() => walkieService.getQueueLength());

  // 🌟 실시간 발언자 인디케이터 ("누가 말하고 있습니다")
  const [talkingStatus, setTalkingStatus] = useState<TalkingStatus | null>(() => walkieService.getCurrentTalkingStatus());
  const [receiveMode, setReceiveMode] = useState<WalkieReceiveMode>(() => walkieService.getReceiveMode());
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [sttStatus, setSttStatus] = useState<'IDLE' | 'LISTENING' | 'ERROR' | 'UNSUPPORTED'>('IDLE');
  const [sttErrorDetail, setSttErrorDetail] = useState<string>('');

  // 🔒 PTT 비동기 트리거 레이스 컨디션 원천 방지용 Refs
  const isTransmittingRef = useRef<boolean>(false);
  const isStartingRef = useRef<boolean>(false);
  const stopRequestedRef = useRef<boolean>(false);
  const durationTimerRef = useRef<any>(null);

  // 📜 대화 스크롤용 Refs
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const pttFeedContainerRef = useRef<HTMLDivElement | null>(null);

  // 초기화 및 실시간 메시지 / 발언 상태 / 큐 / 채널 리스너 등록
  useEffect(() => {
    if (!currentUser) return;

    walkieService.subscribe({
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      deptName: currentUser.department || currentTenant?.displayName || currentTenant?.tradeName || 'eBro'
    });

    setChannels(walkieService.getChannels(currentUser.id));

    const unMsg = walkieService.onMessage(() => {
      setHistory([...walkieService.getHistory()]);
    });

    const unHist = walkieService.onHistoryChange((newHist) => {
      setHistory([...newHist]);
    });

    const unQueue = walkieService.onQueueChange((len) => {
      setQueueLength(len);
    });

    const unTalking = walkieService.onTalkingStatusChange((status) => {
      setTalkingStatus(status);
    });

    const unRecMode = walkieService.onReceiveModeChange((mode) => {
      setReceiveMode(mode);
    });

    const unLiveStt = walkieService.onLiveTranscript((txt, status, err) => {
      setLiveTranscript(txt);
      setSttStatus(status);
      if (err) setSttErrorDetail(err);
    });

    const unEngine = walkieService.onSttEngineChange((eng) => {
      setSttEngine(eng);
    });

    const unChannels = walkieService.onChannelsChange(() => {
      setChannels(walkieService.getChannels(currentUser.id));
    });

    return () => {
      unMsg();
      unHist();
      unQueue();
      unTalking();
      unRecMode();
      unLiveStt();
      unEngine();
      unChannels();
    };
  }, [currentUser]);

  // 디버그 토글 핸들러
  const handleToggleDebug = () => {
    setShowDebugLogs(prev => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('walkie_show_debug', String(next));
        }
      } catch {}
      return next;
    });
  };

  // 🛠️ 현재 채널 메시지 및 디버그 메시지 필터링
  const currentChMessages = history.filter(m => {
    if (m.isDebug) return showDebugLogs;
    return m.channel === currentChannel;
  });

  // 모달 오픈 시 오디오 컨텍스트 언락 & 닫힐 때 오디오 정지
  useEffect(() => {
    if (isOpen) {
      walkieService.unlockAudio();
      setHistory([...walkieService.getHistory()]);
      if (currentUser) {
        setChannels(walkieService.getChannels(currentUser.id));
      }
    } else {
      walkieService.stopAudio();
      setPlayingMessageId(null);
    }
  }, [isOpen, currentUser]);

  // 스마트 스크롤: 스크롤 위치 감지
  const handleFeedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const threshold = 60;
    const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
    isAtBottomRef.current = atBottom;
    if (atBottom !== isAtBottom) {
      setIsAtBottom(atBottom);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (activeTab === 'PTT' && pttFeedContainerRef.current) {
      pttFeedContainerRef.current.scrollTo({
        top: pttFeedContainerRef.current.scrollHeight,
        behavior
      });
      isAtBottomRef.current = true;
      setIsAtBottom(true);
    }
    if (activeTab === 'LOGS' && logContainerRef.current) {
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior
      });
    }
  };

  // 채널 변경 또는 탭 변경 시 바닥으로 리셋
  useEffect(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    const timer = setTimeout(() => {
      scrollToBottom('auto');
    }, 60);
    return () => clearTimeout(timer);
  }, [currentChannel, activeTab]);

  // 새 메시지 유입 시: 사용자가 이미 바닥에 있거나 본인이 발언한 메시지일 때만 자동 바닥 스크롤!
  useEffect(() => {
    const latestMsg = history[0];
    const isMine = latestMsg && currentUser && latestMsg.senderId === currentUser.id;
    if (isAtBottomRef.current || isMine) {
      const timer = setTimeout(() => {
        scrollToBottom('smooth');
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [history]);

  // 전역 pointerup 안전망 (화면 밖 릴리즈 대응)
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isStartingRef.current) {
        stopRequestedRef.current = true;
      }
      if (isTransmittingRef.current) {
        finishRecordingAndSend();
      }
    };

    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerUp);

    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerUp);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, []);

  // 전원 토글
  const handleTogglePower = () => {
    const next = !isPowerOn;
    setIsPowerOn(next);
    walkieService.setPower(next);
    if (next) {
      walkieService.unlockAudio();
    }
  };

  // 수신 모드 1-Click 순환 변경 (실시간음성 -> 비프알림 -> 완전무음)
  const handleCycleReceiveMode = () => {
    const nextMode: WalkieReceiveMode = 
      receiveMode === 'VOICE' ? 'BEEP' : (receiveMode === 'BEEP' ? 'MUTE' : 'VOICE');
    walkieService.setReceiveMode(nextMode);
  };

  // 수신 모드 변경 (실시간음성 / 비프알림 / 완전무음)
  const handleSelectReceiveMode = (mode: WalkieReceiveMode) => {
    walkieService.setReceiveMode(mode);
  };

  // 채널 변경
  const handleSelectChannel = (ch: WalkieTalkieChannel) => {
    setCurrentChannel(ch);
    walkieService.setChannel(ch);
    soundEngine.playStartBeep();
  };

  // ── 🌟 토글형 PTT 터치 핸들러 (터치하고 말하고 다시 터치해서 종료 및 전송) ──
  const handleTogglePtt = async () => {
    if (!isPowerOn) return;

    if (isSomeoneElseTalking) {
      soundEngine.playErrorBeep();
      return;
    }

    // 1. 이미 발언 중이거나 마이크 기동 중인 경우: 다시 터치했으므로 즉시 종료 및 전송!
    if (isTransmittingRef.current || isStartingRef.current) {
      if (isStartingRef.current) {
        stopRequestedRef.current = true;
        return;
      }
      await finishRecordingAndSend();
      return;
    }

    // 2. 발언 시작 (첫 터치)
    walkieService.unlockAudio();
    isStartingRef.current = true;
    stopRequestedRef.current = false;

    const started = await walkieService.startRecording(
      currentUser ? {
        id: currentUser.id,
        name: currentUser.name,
        deptName: currentUser.department || currentTenant?.displayName || currentTenant?.tradeName || 'eBro'
      } : undefined,
      { sttOnly: isMonologueOrderMode }
    );

    isStartingRef.current = false;

    if (started) {
      if (stopRequestedRef.current) {
        await finishRecordingAndSend();
        return;
      }

      isTransmittingRef.current = true;
      setIsTransmitting(true);
      setRecordDuration(0);

      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      durationTimerRef.current = setInterval(() => {
        setRecordDuration(prev => {
          if (prev >= 45) {
            // 최대 45초 초과 시 자동 종료 및 전송 세이프가드
            finishRecordingAndSend();
            return 45;
          }
          return prev + 1;
        });
      }, 1000);
    }
  };

  // ── 송신 완료 및 전송 실행 함수 ──
  const finishRecordingAndSend = async () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    isTransmittingRef.current = false;
    setIsTransmitting(false);

    if (currentUser) {
      const sent = await walkieService.stopAndSend(
        {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
          deptName: currentUser.department || currentTenant?.displayName || currentTenant?.tradeName || 'eBro'
        },
        currentChannel
      );
      if (sent) {
        setHistory([...walkieService.getHistory()]);
        if (isMonologueOrderMode && sent.textTranscript) {
          const base = currentOrderDraft || loadVoiceOrderDraft() || createEmptyDraft();
          const { updatedDraft } = mergeVoiceFragmentToDraft(base, sent.textTranscript, customers, sites);
          setCurrentOrderDraft(updatedDraft);
          saveVoiceOrderDraft(updatedDraft);
        }
      }
    }
    setRecordDuration(0);
  };

  // 다시듣기 재생 (토글 정지 및 빈 오디오/오류 검증 피드백)
  const handlePlayAudio = async (msg: WalkieMessage) => {
    walkieService.unlockAudio();
    if (playingMessageId === msg.id) {
      walkieService.stopAudio();
      setPlayingMessageId(null);
      return;
    }
    if (!msg.audioBase64 || msg.audioBase64.trim().length < 50) {
      alert('음성 데이터가 비어있거나 저장되지 않은 메시지입니다.');
      return;
    }
    setPlayingMessageId(msg.id);
    try {
      await walkieService.playAudio(msg.audioBase64);
    } catch (e: any) {
      console.warn('Playback error:', e);
      alert('음성 재생 실패: ' + (e?.message || '알 수 없는 오류'));
    } finally {
      setPlayingMessageId(null);
    }
  };

  const formatSafeTime = (dateStr?: string, includeSeconds = false) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        ...(includeSeconds ? { second: '2-digit' } : {})
      });
    } catch {
      return '';
    }
  };

  const accessibleChannels = channels || [];
  const fallbackCh: WalkieChannel = DEFAULT_WALKIE_CHANNELS[0] || {
    id: 'DISPATCH',
    name: '출고배차',
    code: 'CH-01',
    desc: '주기장 상차 및 배차 기사 통신망',
    createdById: 'system',
    createdByName: '시스템',
    memberIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    isDefault: true
  };
  const currentChInfo = (accessibleChannels && accessibleChannels.find(c => c.id === currentChannel)) || (accessibleChannels && accessibleChannels[0]) || fallbackCh;
  const todayStr = walkieService.getTodayDateStr();

  // 다른 동료가 현재 채널에서 말하고 있는지 여부
  const isSomeoneElseTalking = Boolean(
    talkingStatus && 
    talkingStatus.isTalking && 
    talkingStatus.senderId !== currentUser?.id && 
    (talkingStatus.channel === currentChannel)
  );

  // 현재 채널이 접근 가능 목록에 없으면 첫 번째 유효 채널로 자동 전환 (모든 Hook은 조건부 return 이전에 항상 동일한 순서로 호출)
  useEffect(() => {
    if (!isOpen) return;
    if (accessibleChannels.length > 0 && !accessibleChannels.some(c => c.id === currentChannel)) {
      const fallback = accessibleChannels[0].id;
      setCurrentChannel(fallback);
      walkieService.setChannel(fallback);
    }
  }, [isOpen, accessibleChannels, currentChannel]);

  // ── Hook 규칙 준수: 모든 Hook 등록 후 최종적으로 isOpen 검사하여 언마운트 ──
  if (!isOpen) return null;

  return (
    <div 
      onTouchStart={() => walkieService.unlockAudio()}
      onClick={() => walkieService.unlockAudio()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: 'rgba(2, 6, 23, 0.85)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 6px'
      }}
    >
      {/* ── 무전기 본체 카드 (상하 여백 제거 & 화면 최대 활용) ── */}
      <div 
        style={{
          width: '100%',
          maxWidth: '440px',
          height: '100%',
          maxHeight: 'calc(100dvh - 8px)',
          backgroundColor: '#0f172a',
          border: '1.5px solid #334155',
          borderRadius: '18px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {/* 1. 상단 무전기 슬림 헤더 (공간 최소화) */}
        <div style={{
          padding: '6px 12px',
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Radio size={14} color={isPowerOn ? '#38bdf8' : '#64748b'} />
            <span style={{ fontSize: '13px', fontWeight: '900', color: '#f8fafc' }}>
              현장 무전기
            </span>
            {/* 전원 ON / OFF 버튼 */}
            <button
              type="button"
              onClick={handleTogglePower}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2.5px 7px',
                borderRadius: '9999px',
                border: 'none',
                backgroundColor: isPowerOn ? '#059669' : '#475569',
                color: '#ffffff',
                fontSize: '10.5px',
                fontWeight: '800',
                cursor: 'pointer'
              }}
            >
              {isPowerOn ? <Volume2 size={11} /> : <VolumeX size={11} />}
              <span>{isPowerOn ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {/* 수신 모드 1-Click 원터치 순환 버튼 (음성 ➔ 비프 ➔ 무음) */}
            <button
              type="button"
              onClick={handleCycleReceiveMode}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2.5px 7px',
                borderRadius: '6px',
                border: receiveMode === 'VOICE' ? '1px solid #10b981' : receiveMode === 'BEEP' ? '1px solid #f59e0b' : '1px solid #475569',
                backgroundColor: receiveMode === 'VOICE' ? 'rgba(16, 185, 129, 0.2)' : receiveMode === 'BEEP' ? 'rgba(245, 158, 11, 0.2)' : '#1e293b',
                color: receiveMode === 'VOICE' ? '#34d399' : receiveMode === 'BEEP' ? '#fbbf24' : '#94a3b8',
                fontSize: '10.5px',
                fontWeight: '800',
                cursor: 'pointer'
              }}
              title="수신 모드 전환 (음성 ➔ 비프 ➔ 무음)"
            >
              {receiveMode === 'VOICE' ? <Volume2 size={11} /> : receiveMode === 'BEEP' ? <Bell size={11} /> : <BellOff size={11} />}
              <span>{receiveMode === 'VOICE' ? '음성' : receiveMode === 'BEEP' ? '비프' : '무음'}</span>
            </button>

            {/* 독백의뢰 모드 토글 버튼 */}
            <button
              type="button"
              onClick={() => {
                const next = !isMonologueOrderMode;
                setIsMonologueOrderMode(next);
                if (next) {
                  setCurrentOrderDraft(loadVoiceOrderDraft() || createEmptyDraft());
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2.5px 7px',
                borderRadius: '6px',
                border: isMonologueOrderMode ? '1px solid #38bdf8' : '1px solid #334155',
                backgroundColor: isMonologueOrderMode ? '#0284c7' : '#0f172a',
                color: isMonologueOrderMode ? '#ffffff' : '#94a3b8',
                fontSize: '10.5px',
                fontWeight: '800',
                cursor: 'pointer'
              }}
              title="독백 모드로 출고의뢰 음성 조각 수집"
            >
              <FileText size={11} />
              <span>{isMonologueOrderMode ? '독백 ON' : '독백의뢰'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '2px',
                marginLeft: '2px'
              }}
              title="닫기"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 2. 채널 선택 바 (가로 스크롤 탭 + 새 채널 버튼) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '6px 8px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #1e293b',
          overflowX: 'auto',
          flexShrink: 0,
          scrollbarWidth: 'none'
        }}>
          {accessibleChannels.map(ch => {
            const isSelected = currentChannel === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => handleSelectChannel(ch.id)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '7px',
                  border: isSelected ? '1.5px solid #38bdf8' : '1px solid #1e293b',
                  backgroundColor: isSelected ? '#0369a1' : '#1e293b',
                  color: isSelected ? '#ffffff' : '#94a3b8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11.5px',
                  fontWeight: isSelected ? '900' : '700',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '9.5px', opacity: 0.8 }}>{ch.code}</span>
                <span>{ch.name}</span>
              </button>
            );
          })}

          {/* 새 채널 개설 버튼 */}
          <button
            type="button"
            onClick={() => {
              setNewChannelName('');
              setNewChannelDesc('');
              setSelectedMemberIds([]);
              setChannelSearchQuery('');
              setIsCreateChannelOpen(true);
            }}
            style={{
              padding: '5px 10px',
              borderRadius: '7px',
              border: '1px dashed #38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11.5px',
              fontWeight: '800',
              flexShrink: 0,
              whiteSpace: 'nowrap'
            }}
            title="새 채널 개설"
          >
            <Plus size={12} />
            <span>새 채널</span>
          </button>
        </div>

        {/* 2-1. 채널 서브헤더 (채널 정보 & 초대 버튼) */}
        <div style={{
          padding: '4px 10px',
          backgroundColor: '#090d16',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden' }}>
            <span style={{
              fontSize: '9.5px',
              fontWeight: '800',
              padding: '1px 5px',
              borderRadius: '4px',
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              flexShrink: 0
            }}>
              {currentChInfo.code}
            </span>
            <span style={{ fontSize: '11.5px', fontWeight: '800', color: '#f8fafc', whiteSpace: 'nowrap' }}>
              {currentChInfo.name}
            </span>
            <span style={{ fontSize: '10.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
              <Users size={11} />
              {currentChInfo.isDefault && (!currentChInfo.memberIds || currentChInfo.memberIds.length === 0)
                ? `전사 (${activeUsers.length}명)`
                : `${currentChInfo.memberIds?.length || 0}명`}
            </span>
            {currentChInfo.desc && (
              <span style={{ fontSize: '10.5px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                • {currentChInfo.desc}
              </span>
            )}
          </div>

          {/* 사원 초대 및 채널 삭제/나가기 버튼군 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {/* 사원 초대 버튼 */}
            <button
              type="button"
              onClick={() => {
                setInviteMemberIds([]);
                setInviteSearchQuery('');
                setIsInviteModalOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2px 7px',
                borderRadius: '5px',
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: '#38bdf8',
                fontSize: '10.5px',
                fontWeight: '700',
                cursor: 'pointer',
                flexShrink: 0,
                whiteSpace: 'nowrap'
              }}
              title="사원 초대"
            >
              <UserPlus size={11} />
              <span>초대</span>
            </button>

            {/* 비기본 채널: 개설자면 [채널 삭제], 초대멤버면 [채널 나가기] */}
            {!currentChInfo.isDefault && (
              currentChInfo.createdById === currentUser?.id ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`"${currentChInfo.name}" 채널을 삭제하시겠습니까?\n모든 사원의 목록에서 완전히 삭제됩니다.`)) {
                      walkieService.deleteChannel(currentChInfo.id, currentUser?.id || '');
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '2px 7px',
                    borderRadius: '5px',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#f87171',
                    fontSize: '10.5px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    flexShrink: 0,
                    whiteSpace: 'nowrap'
                  }}
                  title="채널 삭제"
                >
                  <Trash2 size={11} />
                  <span>삭제</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`"${currentChInfo.name}" 채널에서 나가시겠습니까?`)) {
                      walkieService.leaveChannel(currentChInfo.id, currentUser?.id || '');
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '2px 7px',
                    borderRadius: '5px',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    fontSize: '10.5px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    flexShrink: 0,
                    whiteSpace: 'nowrap'
                  }}
                  title="채널 나가기"
                >
                  <LogOut size={11} />
                  <span>나가기</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* ── [뷰 1] 실시간 무전 (PTT 화면) ── */}
        {activeTab === 'PTT' ? (
          <>
            {/* 3. 동적 상태 알림 바 (발언 중이거나 독백 모드일 때만 슬림 표출) */}
            {isTransmitting ? (
              <div style={{
                padding: '5px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.25)',
                borderBottom: '1px solid #ef4444',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#f87171',
                fontSize: '11.5px',
                fontWeight: '900',
                flexShrink: 0
              }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '9999px', backgroundColor: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
                <span>송신 중 ({recordDuration}s) [말씀하세요]</span>
              </div>
            ) : isSomeoneElseTalking ? (
              <div style={{
                padding: '5px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.25)',
                borderBottom: '1px solid #ef4444',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#f87171',
                fontSize: '11.5px',
                fontWeight: '900',
                flexShrink: 0
              }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '9999px', backgroundColor: '#ef4444', boxShadow: '0 0 8px #ef4444' }} />
                <span>🔴 [{talkingStatus?.senderName}] 발언 중...</span>
              </div>
            ) : isMonologueOrderMode ? (
              <div style={{
                padding: '5px 12px',
                backgroundColor: 'rgba(2, 132, 199, 0.15)',
                borderBottom: '1px solid rgba(56, 189, 248, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                flexShrink: 0
              }}>
                <div style={{ fontSize: '10.5px', color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: '#38bdf8', fontWeight: '800', marginRight: '4px' }}>📝 독백의뢰:</span>
                  {currentOrderDraft?.customerName || '고객사'} / {currentOrderDraft?.siteName || '현장'} | {currentOrderDraft?.orders?.map(o => `${o.modelName}(${o.count}대)`).join(', ') || '1930(1대)'}
                </div>
                {onNavigateToDispatchOrder && (
                  <button
                    type="button"
                    onClick={onNavigateToDispatchOrder}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '5px',
                      border: 'none',
                      backgroundColor: '#0284c7',
                      color: '#ffffff',
                      fontSize: '10px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                  >
                    작성 ➔
                  </button>
                )}
              </div>
            ) : null}

            {/* ── 실시간 당일 무전 피드 (화면 세로 영역의 대부분을 최대로 확보!) ── */}
            <div style={{
              flex: 1,
              minHeight: 0,
              backgroundColor: '#090d16',
              display: 'flex',
              flexDirection: 'column',
              padding: '6px 10px',
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexShrink: 0, gap: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <MessageSquare size={11} color="#38bdf8" />
                  <span>대화 피드 ({currentChMessages.length}건)</span>
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '3.5px', flexWrap: 'nowrap' }}>
                  {/* ⚡ Groq STT 단일 뱃지 */}
                  <span
                    style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid #10b981',
                      color: '#34d399',
                      padding: '2px 5.5px',
                      borderRadius: '5px',
                      fontSize: '9.5px',
                      fontWeight: '800',
                      whiteSpace: 'nowrap'
                    }}
                    title="Groq LPU Whisper (0.3초)"
                  >
                    ⚡ Groq STT
                  </span>

                  {/* 🐞 디버그 로그 ON/OFF 토글 버튼 */}
                  <button
                    type="button"
                    onClick={handleToggleDebug}
                    style={{
                      backgroundColor: showDebugLogs ? 'rgba(239, 68, 68, 0.2)' : '#1e293b',
                      border: showDebugLogs ? '1px solid #ef4444' : '1px solid #334155',
                      color: showDebugLogs ? '#f87171' : '#64748b',
                      padding: '2px 5.5px',
                      borderRadius: '5px',
                      fontSize: '9.5px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                    title="디버깅 로그 화면 출력 켜기 / 끄기"
                  >
                    {showDebugLogs ? '🐞 디버그ON' : '디버그OFF'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('LOGS')}
                    style={{
                      backgroundColor: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#38bdf8',
                      padding: '2px 6px',
                      borderRadius: '5px',
                      fontSize: '9.5px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    로그 ➔
                  </button>
                </div>
              </div>

              {currentChMessages.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#64748b' }}>
                  오늘 무전 내역이 없습니다. (하단 버튼을 터치하여 말씀하세요)
                </div>
              ) : (
                <div 
                  ref={pttFeedContainerRef}
                  onScroll={handleFeedScroll}
                  style={{ 
                    flex: 1,
                    minHeight: 0,
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '4px',
                    overflowY: 'auto',
                    paddingRight: '2px',
                    WebkitOverflowScrolling: 'touch',
                    touchAction: 'pan-y',
                    overscrollBehaviorY: 'contain'
                  }}
                >
                  {/* Latest messages at bottom (reverse order, no limit) */}
                  {currentChMessages.slice().reverse().map(msg => {
                    // ── [DEBUG] Console-style debug log entry ──
                    if (msg.isDebug) {
                      const ts = formatSafeTime(msg.createdAt, true);
                      const isErr = msg.textTranscript?.includes('ERROR') || msg.textTranscript?.includes('FAIL') || msg.textTranscript?.includes('EXCEPTION');
                      const isWarn = msg.textTranscript?.includes('WARNING') || msg.textTranscript?.includes('skipped');
                      const isOk = msg.textTranscript?.includes('OK') || msg.textTranscript?.includes('done') || msg.textTranscript?.includes('ready') || msg.textTranscript?.includes('sent') || msg.textTranscript?.includes('granted') || msg.textTranscript?.includes('started');
                      return (
                        <div
                          key={msg.id}
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: '#020617',
                            border: `1px solid ${isErr ? '#7f1d1d' : isWarn ? '#78350f' : '#1e3a5f'}`,
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            lineHeight: 1.4,
                            color: isErr ? '#f87171' : isWarn ? '#fbbf24' : isOk ? '#4ade80' : '#94a3b8',
                            wordBreak: 'break-all',
                            whiteSpace: 'pre-wrap'
                          }}
                        >
                          <span style={{ color: '#475569', marginRight: '6px' }}>{ts}</span>
                          {msg.textTranscript}
                        </div>
                      );
                    }

                    const isPlaying = playingMessageId === msg.id;
                    const isMine = msg.senderId === currentUser?.id;
                    const timeStr = formatSafeTime(msg.createdAt, false);
                    return (

                      <div
                        key={msg.id}
                        style={{
                          padding: '5px 8px',
                          borderRadius: '8px',
                          backgroundColor: isMine ? 'rgba(30, 58, 138, 0.35)' : '#1e293b',
                          border: isMine ? '1px solid #2563eb' : '1px solid #334155',
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '6px'
                        }}
                      >
                        {/* 좌측: [채널] 화자명 시간 💬 줄바꿈 허용 풀텍스트 */}
                        <div style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: '11px',
                          lineHeight: 1.35,
                          wordBreak: 'break-all',
                          whiteSpace: 'pre-wrap'
                        }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '0.5px 3.5px',
                            borderRadius: '3px',
                            backgroundColor: '#0f172a',
                            color: '#38bdf8',
                            fontSize: '9px',
                            fontWeight: '800',
                            marginRight: '4px',
                            verticalAlign: 'baseline'
                          }}>
                            {msg.channel}
                          </span>
                          <span style={{ fontSize: '10px', fontWeight: '700', color: isMine ? '#93c5fd' : '#cbd5e1', marginRight: '4px' }}>
                            {isMine ? '나' : msg.senderName}
                          </span>
                          <span style={{ fontSize: '9px', color: '#64748b', marginRight: '5px' }}>
                            {timeStr}
                          </span>
                          <span style={{
                            color: msg.textTranscript ? '#ffffff' : '#94a3b8',
                            fontWeight: msg.textTranscript ? '600' : '400'
                          }}>
                            {msg.textTranscript ? (
                              <span>
                                <span style={{ color: '#f8fafc', fontWeight: '600' }}>{msg.textTranscript}</span>
                                <span style={{ color: '#64748b', marginLeft: '4px', fontSize: '9px' }}>({msg.durationSec}s)</span>
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>({msg.durationSec}s)</span>
                            )}
                          </span>
                        </div>

                        {/* 우측: 초소형 '>' 재생 버튼 */}
                        <button
                          type="button"
                          onClick={() => handlePlayAudio(msg)}
                          title={isPlaying ? '정지' : `재생 (${msg.durationSec}s)`}
                          style={{
                            flexShrink: 0,
                            width: '20px',
                            height: '20px',
                            borderRadius: '5px',
                            border: 'none',
                            backgroundColor: isPlaying ? '#ef4444' : isMine ? '#2563eb' : '#0284c7',
                            color: '#ffffff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            marginTop: '1px'
                          }}
                        >
                          {isPlaying ? <Square size={8} fill="#ffffff" /> : <Play size={8} fill="#ffffff" style={{ marginLeft: '1px' }} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 스크롤이 위로 올라가 있을 때 플로팅 최신 메시지 이동 버튼 */}
              {!isAtBottom && currentChMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => scrollToBottom('smooth')}
                  style={{
                    position: 'absolute',
                    bottom: '10px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: '1px solid #38bdf8',
                    borderRadius: '9999px',
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: '800',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.6)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    zIndex: 20,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <span>↓ 최신 메시지</span>
                </button>
              )}
            </div>

            {/* ── 최하단 인체공학적 가로 와이드 PTT 버튼 (오른손 엄지 영역) ── */}
            <div style={{
              padding: '10px 14px 14px',
              backgroundColor: '#0f172a',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              {/* 발언 중 실시간 STT 라이브 버블 */}
              {isTransmitting && (
                <div style={{
                  padding: '6px 10px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(2, 6, 23, 0.95)',
                  border: sttStatus === 'ERROR' ? '1px solid #ef4444' : sttStatus === 'UNSUPPORTED' ? '1px solid #f59e0b' : '1px solid #38bdf8',
                  textAlign: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                }}>
                  {sttStatus === 'UNSUPPORTED' ? (
                    <span style={{ fontSize: '10.5px', color: '#fbbf24', fontWeight: '700' }}>
                      ⚠️ 브라우저 음성인식 미지원 (음성은 정상 녹음·전송됨)
                    </span>
                  ) : sttStatus === 'ERROR' ? (
                    <span style={{ fontSize: '10.5px', color: '#f87171', fontWeight: '700' }}>
                      ⚠️ 음성인식 대기중 ({sttErrorDetail || '마이크 확인'})
                    </span>
                  ) : liveTranscript ? (
                    <div style={{ fontSize: '12px', color: '#fef08a', fontWeight: '800', wordBreak: 'break-all' }}>
                      💬 "{liveTranscript}"
                    </div>
                  ) : (
                    <span style={{ fontSize: '11px', color: '#38bdf8' }}>
                      한국어 실시간 인식 중... (말씀하세요)
                    </span>
                  )}
                </div>
              )}

              {/* 가로 와이드 PTT 바 버튼 */}
              <button
                type="button"
                disabled={!isPowerOn}
                onClick={handleTogglePtt}
                style={{
                  width: '100%',
                  height: '52px',
                  borderRadius: '14px',
                  border: isTransmitting 
                    ? '2px solid #f87171' 
                    : isSomeoneElseTalking
                    ? '2px solid #f59e0b'
                    : isPowerOn 
                    ? '1.5px solid #38bdf8' 
                    : '1px solid #475569',
                  background: isTransmitting 
                    ? 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)' 
                    : isSomeoneElseTalking
                    ? 'linear-gradient(135deg, #78350f 0%, #451a03 100%)'
                    : isPowerOn 
                    ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' 
                    : '#334155',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: isPowerOn ? 'pointer' : 'not-allowed',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  boxShadow: isTransmitting 
                    ? '0 0 20px rgba(239, 68, 68, 0.7)' 
                    : isSomeoneElseTalking
                    ? '0 0 15px rgba(245, 158, 11, 0.4)'
                    : isPowerOn 
                    ? '0 4px 14px rgba(2, 132, 199, 0.35)' 
                    : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {isTransmitting ? (
                  <>
                    <Mic size={20} color="#ffffff" />
                    <span style={{ fontSize: '14.5px', fontWeight: '900', letterSpacing: '0.5px' }}>
                      발언 중 ({recordDuration}s) [터치하여 전송]
                    </span>
                  </>
                ) : isSomeoneElseTalking ? (
                  <>
                    <Volume2 size={20} color="#fde68a" />
                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#fef08a' }}>
                      [{talkingStatus?.senderName}] 발언 중... (잠시 대기)
                    </span>
                  </>
                ) : isPowerOn ? (
                  <>
                    <Radio size={20} color="#ffffff" />
                    <span style={{ fontSize: '14.5px', fontWeight: '800' }}>
                      터치하고 말하기
                    </span>
                    <span style={{ fontSize: '11px', opacity: 0.85, fontWeight: '500' }}>
                      (완료 시 다시 터치)
                    </span>
                  </>
                ) : (
                  <>
                    <MicOff size={18} color="#94a3b8" />
                    <span style={{ fontSize: '13.5px', fontWeight: '700', color: '#94a3b8' }}>
                      무전기 전원 OFF (상단 전원을 켜주세요)
                    </span>
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          // ── [뷰 2] 당일 대화 로그 타임라인 (카카오톡형 STT 말풍선 목록) ──
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#090d16',
            overflow: 'hidden'
          }}>
            {/* 로그 상단 바 */}
            <div style={{
              padding: '10px 16px',
              backgroundColor: '#1e293b',
              borderBottom: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <button
                type="button"
                onClick={() => setActiveTab('PTT')}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#38bdf8',
                  fontSize: '12px',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
              >
                <ArrowLeft size={14} />
                <span>무전기로 복귀</span>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  {currentChInfo.name} • {currentChMessages.length}건
                </span>

                {/* 🐞 디버그 로그 ON/OFF 토글 버튼 */}
                <button
                  type="button"
                  onClick={handleToggleDebug}
                  style={{
                    backgroundColor: showDebugLogs ? 'rgba(239, 68, 68, 0.2)' : '#0f172a',
                    border: showDebugLogs ? '1px solid #ef4444' : '1px solid #475569',
                    borderRadius: '5px',
                    color: showDebugLogs ? '#f87171' : '#94a3b8',
                    fontSize: '10px',
                    fontWeight: '700',
                    padding: '2.5px 6px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                  title="디버깅 로그 화면 출력 켜기 / 끄기"
                >
                  {showDebugLogs ? '🐞 디버그ON' : '디버그OFF'}
                </button>

                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('오늘의 무전 대화 기록을 모두 비우시겠습니까?')) {
                        walkieService.clearTodayHistory();
                      }
                    }}
                    style={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '5px',
                      color: '#cbd5e1',
                      fontSize: '10px',
                      padding: '2.5px 6px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    대화 비우기
                  </button>
                )}
              </div>
            </div>

            {/* 대화 말풍선 스크롤 영역 (최신 대화가 아래에 위치하도록 역전) */}
            <div 
              ref={logContainerRef}
              style={{
                flex: 1,
                padding: '14px 16px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              {currentChMessages.length === 0 ? (
                <div style={{
                  padding: '40px 16px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '12px',
                  lineHeight: 1.6
                }}>
                  <MessageSquare size={28} color="#334155" style={{ margin: '0 auto 8px' }} />
                  <div>이 채널의 무전 대화 기록이 없습니다.</div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
                    무전으로 말한 내용은 음성과 함께 실시간 텍스트로 자동 기록됩니다.
                  </div>
                </div>
              ) : (
                [...currentChMessages].reverse().map(msg => {
                  // ── [DEBUG] Console-style debug log entry ──
                  if (msg.isDebug) {
                    const ts = formatSafeTime(msg.createdAt, true);
                    const isErr = msg.textTranscript?.includes('ERROR') || msg.textTranscript?.includes('FAIL') || msg.textTranscript?.includes('EXCEPTION');
                    const isWarn = msg.textTranscript?.includes('WARNING') || msg.textTranscript?.includes('skipped');
                    const isOk = msg.textTranscript?.includes('OK') || msg.textTranscript?.includes('done') || msg.textTranscript?.includes('ready') || msg.textTranscript?.includes('sent') || msg.textTranscript?.includes('granted') || msg.textTranscript?.includes('started');
                    return (
                      <div
                        key={msg.id}
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: '#020617',
                          border: `1px solid ${isErr ? '#7f1d1d' : isWarn ? '#78350f' : '#1e3a5f'}`,
                          fontFamily: 'monospace',
                          fontSize: '10px',
                          lineHeight: 1.4,
                          color: isErr ? '#f87171' : isWarn ? '#fbbf24' : isOk ? '#4ade80' : '#94a3b8',
                          wordBreak: 'break-all',
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        <span style={{ color: '#475569', marginRight: '6px' }}>{ts}</span>
                        {msg.textTranscript}
                      </div>
                    );
                  }

                  const isPlaying = playingMessageId === msg.id;
                  const isMine = msg.senderId === currentUser?.id;
                  const timeStr = formatSafeTime(msg.createdAt, false);

                  return (
                    <div
                      key={msg.id}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '8px',
                        backgroundColor: isMine ? 'rgba(30, 58, 138, 0.35)' : '#1e293b',
                        border: isMine ? '1px solid #2563eb' : '1px solid #334155',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '6px'
                      }}
                    >
                      {/* 좌측: [채널] 화자명 시간 💬 줄바꿈 허용 풀텍스트 */}
                      <div style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: '11.5px',
                        lineHeight: 1.4,
                        wordBreak: 'break-all',
                        whiteSpace: 'pre-wrap'
                      }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.5px 4px',
                          borderRadius: '3px',
                          backgroundColor: '#0f172a',
                          color: '#38bdf8',
                          fontSize: '9px',
                          fontWeight: '800',
                          marginRight: '4px',
                          verticalAlign: 'baseline'
                        }}>
                          {msg.channel}
                        </span>
                        <span style={{ fontSize: '10.5px', fontWeight: '700', color: isMine ? '#93c5fd' : '#cbd5e1', marginRight: '4px' }}>
                          {isMine ? '나' : msg.senderName}
                        </span>
                        <span style={{ fontSize: '9.5px', color: '#64748b', marginRight: '6px' }}>
                          {timeStr}
                        </span>
                        <span style={{
                          color: msg.textTranscript ? '#ffffff' : '#94a3b8',
                          fontWeight: msg.textTranscript ? '600' : '400'
                        }}>
                          {msg.textTranscript ? (
                          <span>
                            <span style={{ color: '#f8fafc', fontWeight: '600' }}>{msg.textTranscript}</span>
                            <span style={{ color: '#64748b', marginLeft: '4px', fontSize: '9.5px' }}>({msg.durationSec}s)</span>
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>({msg.durationSec}s)</span>
                        )}
                        </span>
                      </div>

                      {/* 우측: 초소형 '>' 재생 버튼 */}
                      <button
                        type="button"
                        onClick={() => handlePlayAudio(msg)}
                        title={isPlaying ? '정지' : `재생 (${msg.durationSec}s)`}
                        style={{
                          flexShrink: 0,
                          width: '22px',
                          height: '22px',
                          borderRadius: '5px',
                          border: 'none',
                          backgroundColor: isPlaying ? '#ef4444' : isMine ? '#2563eb' : '#0284c7',
                          color: '#ffffff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          marginTop: '1px'
                        }}
                      >
                        {isPlaying ? <Square size={9} fill="#ffffff" /> : <Play size={9} fill="#ffffff" style={{ marginLeft: '1px' }} />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ── [모달 1] 새 채널 개설 다이얼로그 ── */}
        {isCreateChannelOpen && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 60,
            backgroundColor: '#0f172a',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* 모달 헤더 */}
            <div style={{
              padding: '10px 14px',
              backgroundColor: '#1e293b',
              borderBottom: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
              <span style={{ fontSize: '13px', fontWeight: '900', color: '#f8fafc' }}>
                새 채널 개설
              </span>
              <button
                type="button"
                onClick={() => setIsCreateChannelOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* 모달 본문 (수직 스택 폼) */}
            <div style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              {/* 채널명 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '800', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                  채널명 *
                </label>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  placeholder="예: 하남현장 출동팀, 주기장 보수팀"
                  style={{
                    padding: '8px 10px',
                    backgroundColor: '#090d16',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* 채널 설명 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '800', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                  채널 설명 (선택)
                </label>
                <input
                  type="text"
                  value={newChannelDesc}
                  onChange={e => setNewChannelDesc(e.target.value)}
                  placeholder="채널 용도 또는 작업 내용"
                  style={{
                    padding: '8px 10px',
                    backgroundColor: '#090d16',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* 참여 사원 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '11px', fontWeight: '800', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                    참여 사원 선택 ({selectedMemberIds.length}명 선택됨)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const selectable = activeUsers.filter(u => u.id !== currentUser?.id).map(u => u.id);
                      if (selectedMemberIds.length === selectable.length) {
                        setSelectedMemberIds([]);
                      } else {
                        setSelectedMemberIds(selectable);
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#38bdf8',
                      fontSize: '10.5px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    {selectedMemberIds.length === activeUsers.filter(u => u.id !== currentUser?.id).length ? '전체 해제' : '전체 선택'}
                  </button>
                </div>

                {/* 사원 검색 입력창 */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  backgroundColor: '#090d16',
                  border: '1px solid #334155',
                  borderRadius: '6px'
                }}>
                  <Search size={13} color="#64748b" />
                  <input
                    type="text"
                    value={channelSearchQuery}
                    onChange={e => setChannelSearchQuery(e.target.value)}
                    placeholder="사원명 또는 부서 검색"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#f8fafc',
                      fontSize: '11.5px',
                      outline: 'none',
                      width: '100%'
                    }}
                  />
                </div>

                {/* 사원 체크리스트 */}
                <div style={{
                  maxHeight: '190px',
                  overflowY: 'auto',
                  border: '1px solid #1e293b',
                  borderRadius: '6px',
                  backgroundColor: '#090d16',
                  padding: '4px'
                }}>
                  {activeUsers
                    .filter(u => u.id !== currentUser?.id)
                    .filter(u => !channelSearchQuery || u.name.includes(channelSearchQuery) || (u.department && u.department.includes(channelSearchQuery)))
                    .map(u => {
                      const isChecked = selectedMemberIds.includes(u.id);
                      return (
                        <div
                          key={u.id}
                          onClick={() => {
                            if (isChecked) {
                              setSelectedMemberIds(prev => prev.filter(id => id !== u.id));
                            } else {
                              setSelectedMemberIds(prev => [...prev, u.id]);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '7px 8px',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            backgroundColor: isChecked ? 'rgba(3, 105, 161, 0.25)' : 'transparent',
                            borderBottom: '1px solid #1e293b'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: '700', color: isChecked ? '#38bdf8' : '#e2e8f0' }}>
                              {u.name}
                            </span>
                            <span style={{ fontSize: '10px', color: '#64748b' }}>
                              {u.department || u.role || ''}
                            </span>
                          </div>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            readOnly
                            style={{ accentColor: '#0284c7', cursor: 'pointer' }}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* 모달 푸터 버튼 */}
            <div style={{
              padding: '10px 14px',
              backgroundColor: '#1e293b',
              borderTop: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '8px',
              flexShrink: 0
            }}>
              <button
                type="button"
                onClick={() => setIsCreateChannelOpen(false)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  backgroundColor: '#0f172a',
                  color: '#cbd5e1',
                  fontSize: '11.5px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                취소
              </button>
              <button
                type="button"
                disabled={!newChannelName.trim()}
                onClick={() => {
                  if (!currentUser || !newChannelName.trim()) return;
                  const created = walkieService.createChannel(
                    newChannelName.trim(),
                    newChannelDesc.trim(),
                    selectedMemberIds,
                    { id: currentUser.id, name: currentUser.name }
                  );
                  setChannels(walkieService.getChannels(currentUser.id));
                  setCurrentChannel(created.id);
                  walkieService.setChannel(created.id);
                  setIsCreateChannelOpen(false);
                  setNewChannelName('');
                  setNewChannelDesc('');
                  setSelectedMemberIds([]);
                }}
                style={{
                  padding: '7px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: newChannelName.trim() ? '#0284c7' : '#334155',
                  color: '#ffffff',
                  fontSize: '11.5px',
                  fontWeight: '800',
                  cursor: newChannelName.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                개설
              </button>
            </div>
          </div>
        )}

        {/* ── [모달 2] 사원 초대 다이얼로그 ── */}
        {isInviteModalOpen && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 60,
            backgroundColor: '#0f172a',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* 모달 헤더 */}
            <div style={{
              padding: '10px 14px',
              backgroundColor: '#1e293b',
              borderBottom: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
              <div>
                <span style={{ fontSize: '13px', fontWeight: '900', color: '#f8fafc' }}>
                  사원 초대
                </span>
                <span style={{ fontSize: '11px', color: '#38bdf8', marginLeft: '6px' }}>
                  [{currentChInfo.name}]
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* 모달 본문 */}
            <div style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              {/* 현재 참여 인원 현황 */}
              <div style={{
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: '#1e293b',
                fontSize: '11px',
                color: '#cbd5e1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span>현재 참여 인원</span>
                <span style={{ fontWeight: '800', color: '#38bdf8' }}>
                  {currentChInfo.isDefault && (!currentChInfo.memberIds || currentChInfo.memberIds.length === 0)
                    ? `전사 (${activeUsers.length}명)`
                    : `${currentChInfo.memberIds?.length || 0}명`}
                </span>
              </div>

              {currentChInfo.isDefault && (!currentChInfo.memberIds || currentChInfo.memberIds.length === 0) ? (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '12px', lineHeight: 1.6 }}>
                  <Users size={28} color="#38bdf8" style={{ margin: '0 auto 10px', display: 'block' }} />
                  <div style={{ color: '#f8fafc', fontWeight: '800', marginBottom: '4px' }}>전사 자동 참여 채널</div>
                  <div>기본 채널은 회사의 모든 임직원이 자동으로 소통에 참여하고 있습니다.</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
                    특정 인원만 참여하는 채널이 필요하신 경우 상단의 <b>[+ 새 채널]</b>을 통해 개설해 주세요.
                  </div>
                </div>
              ) : (
                <>
                  {/* 사원 검색 & 전체 선택 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '11px', fontWeight: '800', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                      초대할 사원 선택 ({inviteMemberIds.length}명 선택됨)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const selectable = activeUsers
                          .filter(u => !(currentChInfo.memberIds || []).includes(u.id))
                          .map(u => u.id);
                        if (inviteMemberIds.length === selectable.length) {
                          setInviteMemberIds([]);
                        } else {
                          setInviteMemberIds(selectable);
                        }
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#38bdf8',
                        fontSize: '10.5px',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      {inviteMemberIds.length === activeUsers.filter(u => !(currentChInfo.memberIds || []).includes(u.id)).length && inviteMemberIds.length > 0
                        ? '전체 해제'
                        : '전체 선택'}
                    </button>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    backgroundColor: '#090d16',
                    border: '1px solid #334155',
                    borderRadius: '6px'
                  }}>
                    <Search size={13} color="#64748b" />
                    <input
                      type="text"
                      value={inviteSearchQuery}
                      onChange={e => setInviteSearchQuery(e.target.value)}
                      placeholder="초대할 사원명 검색"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f8fafc',
                        fontSize: '11.5px',
                        outline: 'none',
                        width: '100%'
                      }}
                    />
                  </div>

                  {/* 초대 대상 사원 리스트 */}
                  <div style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    border: '1px solid #1e293b',
                    borderRadius: '6px',
                    backgroundColor: '#090d16',
                    padding: '4px'
                  }}>
                    {activeUsers
                      .filter(u => !(currentChInfo.memberIds || []).includes(u.id))
                      .filter(u => !inviteSearchQuery || u.name.includes(inviteSearchQuery) || (u.department && u.department.includes(inviteSearchQuery)))
                      .map(u => {
                        const isChecked = inviteMemberIds.includes(u.id);
                        return (
                          <div
                            key={u.id}
                            onClick={() => {
                              if (isChecked) {
                                setInviteMemberIds(prev => prev.filter(id => id !== u.id));
                              } else {
                                setInviteMemberIds(prev => [...prev, u.id]);
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '7px 8px',
                              borderRadius: '5px',
                              cursor: 'pointer',
                              backgroundColor: isChecked ? 'rgba(3, 105, 161, 0.25)' : 'transparent',
                              borderBottom: '1px solid #1e293b'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '11.5px', fontWeight: '700', color: isChecked ? '#38bdf8' : '#e2e8f0' }}>
                                {u.name}
                              </span>
                              <span style={{ fontSize: '10px', color: '#64748b' }}>
                                {u.department || u.role || ''}
                              </span>
                            </div>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                              style={{ accentColor: '#0284c7', cursor: 'pointer' }}
                            />
                          </div>
                        );
                      })}

                    {activeUsers.filter(u => !(currentChInfo.memberIds || []).includes(u.id)).length === 0 && (
                      <div style={{ padding: '20px 10px', textAlign: 'center', color: '#64748b', fontSize: '11.5px' }}>
                        모든 임직원이 이미 이 채널에 참여 중입니다.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 모달 푸터 버튼 */}
            <div style={{
              padding: '10px 14px',
              backgroundColor: '#1e293b',
              borderTop: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '8px',
              flexShrink: 0
            }}>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  backgroundColor: '#0f172a',
                  color: '#cbd5e1',
                  fontSize: '11.5px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                닫기
              </button>
              {!(currentChInfo.isDefault && (!currentChInfo.memberIds || currentChInfo.memberIds.length === 0)) && (
                <button
                  type="button"
                  disabled={inviteMemberIds.length === 0}
                  onClick={() => {
                    if (inviteMemberIds.length === 0) return;
                    walkieService.inviteMembers(currentChannel, inviteMemberIds);
                    setChannels(walkieService.getChannels(currentUser?.id));
                    setIsInviteModalOpen(false);
                    setInviteMemberIds([]);
                  }}
                  style={{
                    padding: '7px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: inviteMemberIds.length > 0 ? '#0284c7' : '#334155',
                    color: '#ffffff',
                    fontSize: '11.5px',
                    fontWeight: '800',
                    cursor: inviteMemberIds.length > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  초대 ({inviteMemberIds.length}명)
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
