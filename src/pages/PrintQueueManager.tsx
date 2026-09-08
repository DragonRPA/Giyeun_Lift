// src/pages/PrintQueueManager.tsx
// 🖨️ 분산 무인 인쇄 큐 모니터 및 프린터 스테이션 관리 (전사 표준 헌장 카테고리 I, III, V 전면 준수)

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { PrintStation, PrintQueueItem } from '../services/db';
import {
  fetchLocalPrintersFromAgent,
  fetchLocalStationConfigFromAgent,
  saveStationConfigToAgent,
  LocalAgentPrintersResult
} from '../services/printQueueService';
import {
  Printer,
  Server,
  RefreshCw,
  Trash2,
  Play,
  XCircle,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  Layers,
  FileText,
  Edit2,
  Check,
  X
} from 'lucide-react';

export const PrintQueueManager: React.FC = () => {
  const {
    printStations,
    printQueue,
    registerPrintStation,
    deletePrintStation,
    enqueuePrintJob,
    retryPrintJob,
    cancelPrintJob,
    currentUser,
    refreshAllData
  } = useApp();

  const [activeTab, setActiveTab] = useState<'stations' | 'queue'>('stations');

  // 로컬 에이전트 탐색 상태
  const [agentStatus, setAgentStatus] = useState<LocalAgentPrintersResult>({
    online: false,
    printers: [],
    defaultPrinter: ''
  });
  const [isScanningAgent, setIsScanningAgent] = useState(false);

  // 스테이션 신규 등록/수정 폼 상태
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState('프린터1');
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [docTypeDefault, setDocTypeDefault] = useState<'DISPATCH_ORDER' | 'RETURN_ORDER' | 'ALL'>('DISPATCH_ORDER');
  const [machineName, setMachineName] = useState('');
  const [description, setDescription] = useState('');
  const [formFeedback, setFormFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 큐 필터 상태
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterDocType, setFilterDocType] = useState<string>('ALL');
  const [filterStation, setFilterStation] = useState<string>('ALL');

  // 서식 미리보기 모달
  const [previewItem, setPreviewItem] = useState<PrintQueueItem | null>(null);

  // 로컬 PC의 eBroAgent 프린터 목록 및 기존 설정 로드
  const scanLocalAgent = async () => {
    setIsScanningAgent(true);
    setFormFeedback(null);
    try {
      const result = await fetchLocalPrintersFromAgent();
      setAgentStatus(result);
      if (result.online) {
        if (result.machineName) {
          setMachineName(result.machineName);
        }
        if (result.defaultPrinter && !selectedPrinter) {
          setSelectedPrinter(result.defaultPrinter);
        }
        // 로컬 station_config.json에 이미 저장된 값 조회
        const localCfg = await fetchLocalStationConfigFromAgent();
        if (localCfg) {
          if (localCfg.stationName) setStationName(localCfg.stationName);
          if (localCfg.localPrinterName) setSelectedPrinter(localCfg.localPrinterName);
          if (localCfg.docTypeDefault) setDocTypeDefault(localCfg.docTypeDefault);
          if (localCfg.stationId) setEditingStationId(localCfg.stationId);
        }
      }
    } catch (err: any) {
      console.warn('Agent scan failed:', err);
    } finally {
      setIsScanningAgent(false);
    }
  };

  useEffect(() => {
    scanLocalAgent();
    // 10초마다 큐 및 스테이션 데이터 갱신
    const timer = setInterval(() => {
      refreshAllData();
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // 스테이션 저장 핸들러
  const handleSaveStation = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormFeedback(null);

    if (!stationName.trim()) {
      setFormFeedback({ type: 'error', message: '스테이션 명칭을 입력하십시오.' });
      return;
    }
    if (!selectedPrinter.trim()) {
      setFormFeedback({ type: 'error', message: '연결할 로컬 프린터를 선택하십시오.' });
      return;
    }

    try {
      const saved = await registerPrintStation({
        id: editingStationId || undefined,
        stationName: stationName.trim(),
        localPrinterName: selectedPrinter.trim(),
        machineName: machineName.trim() || agentStatus.machineName || '',
        docTypeDefault,
        description: description.trim()
      });

      // 로컬 에이전트에도 동시 저장
      await saveStationConfigToAgent({
        stationId: saved.id,
        stationName: saved.stationName,
        localPrinterName: saved.localPrinterName,
        docTypeDefault: saved.docTypeDefault,
        machineName: saved.machineName
      });

      setFormFeedback({ type: 'success', message: `스테이션 [${saved.stationName}] 설정이 저장되었습니다.` });
      setEditingStationId(null);
    } catch (err: any) {
      setFormFeedback({ type: 'error', message: `저장 실패: ${err.message || err}` });
    }
  };

  // 스테이션 편집 폼 로드
  const handleEditStation = (st: PrintStation) => {
    setEditingStationId(st.id);
    setStationName(st.stationName);
    setSelectedPrinter(st.localPrinterName);
    setDocTypeDefault(st.docTypeDefault || 'ALL');
    setMachineName(st.machineName || '');
    setDescription(st.description || '');
    setFormFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 테스트 인쇄 큐 전송 핸들러
  const handleSendTestPrint = async (station: PrintStation) => {
    if (!confirm(`스테이션 [${station.stationName}] (${station.localPrinterName})으로 테스트 인쇄를 발행하시겠습니까?`)) {
      return;
    }
    try {
      const testHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>테스트 인쇄 - ${station.stationName}</title>
  <style>
    body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; margin: 0; }
    .box { border: 2px solid #1e293b; padding: 24px; border-radius: 8px; }
    h1 { margin-top: 0; color: #0f172a; border-bottom: 2px solid #334155; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; font-weight: bold; width: 150px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>기연리프트 분산 인쇄 테스트</h1>
    <table>
      <tr><th>스테이션 명칭</th><td>${station.stationName}</td></tr>
      <tr><th>타겟 프린터</th><td>${station.localPrinterName}</td></tr>
      <tr><th>컴퓨터 명</th><td>${station.machineName || '-'}</td></tr>
      <tr><th>기본 문서</th><td>${station.docTypeDefault}</td></tr>
      <tr><th>발행 시각</th><td>${new Date().toLocaleString('ko-KR')}</td></tr>
      <tr><th>발행자</th><td>${currentUser?.name || '시스템 관리자'}</td></tr>
      <tr><th>결과 검증</th><td>출고/입고 원격 인쇄 통신 정상 작동 확인 완료</td></tr>
    </table>
  </div>
</body>
</html>`;

      await enqueuePrintJob({
        stationId: station.id,
        docType: station.docTypeDefault === 'RETURN_ORDER' ? 'RETURN_ORDER' : 'DISPATCH_ORDER',
        docNo: `TEST-${Date.now().toString().slice(-6)}`,
        title: `[테스트 인쇄] ${station.stationName}`,
        documentHtml: testHtml,
        requestedById: currentUser?.id,
        requestedByName: currentUser?.name
      });
      alert(`[${station.stationName}] 테스트 인쇄 큐가 발행되었습니다. 잠시 후 프린터에서 무인 출력됩니다.`);
    } catch (err: any) {
      alert(`테스트 인쇄 발행 실패: ${err.message || err}`);
    }
  };

  // 스테이션 온라인 여부 계산 (최근 60초 내 하트비트)
  const isStationOnline = (st: PrintStation) => {
    if (!st.lastHeartbeat) return false;
    const diffSec = (Date.now() - new Date(st.lastHeartbeat).getTime()) / 1000;
    return diffSec <= 60;
  };

  // 필터링된 대기열 목록
  const filteredQueue = useMemo(() => {
    return printQueue.filter(item => {
      if (filterStatus !== 'ALL' && item.status !== filterStatus) return false;
      if (filterDocType !== 'ALL' && item.docType !== filterDocType) return false;
      if (filterStation !== 'ALL' && item.stationId !== filterStation) return false;
      return true;
    });
  }, [printQueue, filterStatus, filterDocType, filterStation]);

  return (
    <div
      style={{
        padding: '24px',
        backgroundColor: 'var(--bg-app)',
        minHeight: '100%',
        color: 'var(--text-main)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        boxSizing: 'border-box'
      }}
    >
      {/* ═══ 상단 헤더 (헌장 3.1 무수식어 건조 명사 표준) ═══ */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--border-color)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              padding: '10px',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Printer size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', margin: 0, letterSpacing: '-0.3px' }}>
              프린트 큐 모니터
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '3px 0 0 0' }}>
              로컬 프린터 원격 무인 인쇄 및 스테이션 관리
            </p>
          </div>
        </div>

        {/* 로컬 에이전트 상태 바 & 재탐색 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'nowrap' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '700',
              whiteSpace: 'nowrap',
              backgroundColor: agentStatus.online ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              color: agentStatus.online ? '#10b981' : '#ef4444',
              border: `1px solid ${agentStatus.online ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: agentStatus.online ? '#10b981' : '#ef4444'
              }}
            />
            <span>
              {agentStatus.online
                ? `에이전트 연결됨 (${agentStatus.machineName || 'PC'})`
                : '에이전트 미연결'}
            </span>
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={scanLocalAgent}
            disabled={isScanningAgent}
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={12} className={isScanningAgent ? 'animate-spin' : ''} />
            <span>에이전트 재탐색</span>
          </button>
        </div>
      </div>

      {/* ═══ 탭 네비게이션 ═══ */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '2px'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('stations')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            fontSize: '14px',
            fontWeight: '700',
            cursor: 'pointer',
            border: 'none',
            borderBottom: activeTab === 'stations' ? '3px solid var(--primary)' : '3px solid transparent',
            backgroundColor: 'transparent',
            color: activeTab === 'stations' ? 'var(--primary)' : 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease'
          }}
        >
          <Server size={16} />
          <span>프린터 스테이션 ({printStations.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            fontSize: '14px',
            fontWeight: '700',
            cursor: 'pointer',
            border: 'none',
            borderBottom: activeTab === 'queue' ? '3px solid var(--primary)' : '3px solid transparent',
            backgroundColor: 'transparent',
            color: activeTab === 'queue' ? 'var(--primary)' : 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease'
          }}
        >
          <Layers size={16} />
          <span>인쇄 대기 대장 ({printQueue.length})</span>
        </button>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* 탭 1: 프린터 스테이션 관리 (유형 A: 마스터-디테일 스튜디오)               */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'stations' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: '20px',
            alignItems: 'start'
          }}
        >
          {/* ─── 좌측: 등록 스테이션 목록 ─── */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-color)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Server size={16} color="var(--primary)" />
                <h2 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)', margin: 0 }}>
                  등록 스테이션 목록
                </h2>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>
                총 {printStations.length}개소 등록
              </span>
            </div>

            {printStations.length === 0 ? (
              <div
                style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Printer size={36} style={{ opacity: 0.35, marginBottom: '6px' }} />
                <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  등록된 인쇄 스테이션이 없습니다.
                </div>
                <div style={{ fontSize: '12px' }}>
                  우측 폼에서 현재 PC의 로컬 프린터를 선택하여 스테이션을 등록하십시오.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {printStations.map(station => {
                  const online = isStationOnline(station);
                  const isEditing = editingStationId === station.id;

                  return (
                    <div
                      key={station.id}
                      style={{
                        padding: '16px',
                        borderRadius: '8px',
                        backgroundColor: isEditing ? 'rgba(79, 70, 229, 0.08)' : 'var(--bg-app)',
                        border: `1px solid ${isEditing ? 'var(--primary)' : 'var(--border-color)'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {/* 카드 상단 헤더 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>
                            {station.stationName}
                          </span>

                          {/* 온라인 상태 배지 */}
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: '700',
                              backgroundColor: online ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                              color: online ? '#10b981' : 'var(--text-muted)',
                              border: `1px solid ${online ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.3)'}`
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: online ? '#10b981' : 'var(--text-muted)'
                              }}
                            />
                            {online ? 'ONLINE' : 'OFFLINE'}
                          </span>

                          {/* 문서 구분 태그 */}
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: '700',
                              backgroundColor:
                                station.docTypeDefault === 'DISPATCH_ORDER'
                                  ? 'rgba(59, 130, 246, 0.15)'
                                  : station.docTypeDefault === 'RETURN_ORDER'
                                  ? 'rgba(168, 85, 247, 0.15)'
                                  : 'rgba(100, 116, 139, 0.15)',
                              color:
                                station.docTypeDefault === 'DISPATCH_ORDER'
                                  ? '#3b82f6'
                                  : station.docTypeDefault === 'RETURN_ORDER'
                                  ? '#a855f7'
                                  : 'var(--text-secondary)',
                              border: '1px solid var(--border-color)'
                            }}
                          >
                            {station.docTypeDefault === 'DISPATCH_ORDER' && '출고요청서 전용'}
                            {station.docTypeDefault === 'RETURN_ORDER' && '회수요청서 전용'}
                            {station.docTypeDefault === 'ALL' && '공용 서식'}
                          </span>
                        </div>

                        {/* 조치 버튼군 (상단 우측) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleSendTestPrint(station)}
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              fontWeight: '700',
                              whiteSpace: 'nowrap'
                            }}
                            title="테스트 인쇄 발행"
                          >
                            <Play size={11} />
                            <span>테스트 인쇄</span>
                          </button>

                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleEditStation(station)}
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              fontWeight: '700',
                              whiteSpace: 'nowrap'
                            }}
                            title="수정"
                          >
                            <Edit2 size={11} />
                            <span>수정</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`스테이션 [${station.stationName}]을 삭제하시겠습니까?`)) {
                                deletePrintStation(station.id);
                              }
                            }}
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              fontWeight: '700',
                              color: '#ef4444',
                              backgroundColor: 'transparent',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              whiteSpace: 'nowrap'
                            }}
                            title="삭제"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>

                      {/* 스테이션 상세 제원 그리드 */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                          gap: '6px',
                          fontSize: '12px',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: '700', color: 'var(--text-muted)', marginRight: '6px' }}>연결 프린터:</span>
                          <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>{station.localPrinterName}</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: '700', color: 'var(--text-muted)', marginRight: '6px' }}>컴퓨터명:</span>
                          <span>{station.machineName || '-'}</span>
                        </div>
                        {station.description && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ fontWeight: '700', color: 'var(--text-muted)', marginRight: '6px' }}>비고:</span>
                            <span>{station.description}</span>
                          </div>
                        )}
                        <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: 'var(--text-muted)' }}>
                          최근 하트비트: {station.lastHeartbeat ? new Date(station.lastHeartbeat).toLocaleString('ko-KR') : '-'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── 우측: 스테이션 등록 / 수정 스튜디오 (헌장 3.4 상하 스택 폼) ─── */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-color)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Printer size={16} color="var(--primary)" />
                <h2 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)', margin: 0 }}>
                  {editingStationId ? '스테이션 설정 수정' : '신규 스테이션 등록'}
                </h2>
              </div>
              {editingStationId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingStationId(null);
                    setStationName('프린터1');
                    setSelectedPrinter(agentStatus.defaultPrinter || '');
                    setDocTypeDefault('DISPATCH_ORDER');
                    setFormFeedback(null);
                  }}
                  style={{
                    fontSize: '12px',
                    color: 'var(--primary)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '700',
                    textDecoration: 'underline'
                  }}
                >
                  신규 등록 전환
                </button>
              )}
            </div>

            {/* 프리셋 버튼군 (건조 명사 표준) */}
            <div
              style={{
                padding: '12px',
                backgroundColor: 'var(--bg-app)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <span style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                기본 서식 프리셋
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setStationName('프린터1');
                    setDocTypeDefault('DISPATCH_ORDER');
                    setDescription('출고장 전담 프린터');
                  }}
                  style={{
                    padding: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: `1px solid ${stationName === '프린터1' ? 'var(--primary)' : 'var(--border-color)'}`,
                    backgroundColor: stationName === '프린터1' ? 'var(--primary)' : 'var(--bg-card)',
                    color: stationName === '프린터1' ? '#ffffff' : 'var(--text-main)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  프린터1 (출고요청)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStationName('프린터2');
                    setDocTypeDefault('RETURN_ORDER');
                    setDescription('입고장 전담 프린터');
                  }}
                  style={{
                    padding: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: `1px solid ${stationName === '프린터2' ? 'var(--primary)' : 'var(--border-color)'}`,
                    backgroundColor: stationName === '프린터2' ? 'var(--primary)' : 'var(--bg-card)',
                    color: stationName === '프린터2' ? '#ffffff' : 'var(--text-main)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  프린터2 (회수요청)
                </button>
              </div>
            </div>

            {/* 입력 폼 (헌장 3.4 상하 수직 스택) */}
            <form onSubmit={handleSaveStation} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* 1. 스테이션 명칭 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  스테이션 명칭
                </label>
                <input
                  type="text"
                  value={stationName}
                  onChange={e => setStationName(e.target.value)}
                  placeholder="예: 프린터1, 출고장 데스크, 사무실A4"
                  required
                />
              </div>

              {/* 2. 연결 로컬 프린터 드라이버 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                    연결 프린터
                  </label>
                  <button
                    type="button"
                    onClick={scanLocalAgent}
                    style={{
                      fontSize: '11px',
                      color: 'var(--primary)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: '700',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <RefreshCw size={10} /> 목록 갱신
                  </button>
                </div>

                {agentStatus.online && agentStatus.printers.length > 0 ? (
                  <select
                    value={selectedPrinter}
                    onChange={e => setSelectedPrinter(e.target.value)}
                    required
                  >
                    <option value="">-- 프린터 선택 --</option>
                    {agentStatus.printers.map(p => (
                      <option key={p} value={p}>
                        {p} {p === agentStatus.defaultPrinter ? '(기본 프린터)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={selectedPrinter}
                    onChange={e => setSelectedPrinter(e.target.value)}
                    placeholder="직접 프린터 명칭 입력"
                    required
                  />
                )}
              </div>

              {/* 3. 기본 전담 문서 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  문서 구분
                </label>
                <select
                  value={docTypeDefault}
                  onChange={e => setDocTypeDefault(e.target.value as any)}
                >
                  <option value="DISPATCH_ORDER">출고요청서 전용</option>
                  <option value="RETURN_ORDER">회수요청서 전용</option>
                  <option value="ALL">공용 (모든 문서 수신)</option>
                </select>
              </div>

              {/* 4. 컴퓨터 명칭 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  컴퓨터 식별명
                </label>
                <input
                  type="text"
                  value={machineName}
                  onChange={e => setMachineName(e.target.value)}
                  placeholder="컴퓨터 식별명"
                />
              </div>

              {/* 5. 비고 / 설명 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  비고
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="설치 위치 및 특이사항"
                />
              </div>

              {/* 피드백 메시지 */}
              {formFeedback && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor:
                      formFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    color: formFeedback.type === 'success' ? '#10b981' : '#ef4444',
                    border: `1px solid ${
                      formFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                    }`
                  }}
                >
                  {formFeedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  <span>{formFeedback.message}</span>
                </div>
              )}

              {/* 저장 제출 버튼 (Gutenberg 우하단 터미널 액션) */}
              <button
                type="submit"
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '13px',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '6px'
                }}
              >
                <Check size={14} />
                <span>{editingStationId ? '스테이션 설정 갱신' : '스테이션 저장'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* 탭 2: 인쇄 대기열 대장 (유형 B: 고밀도 그리드형 - 헌장 3.6 아키타입 B)       */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'queue' && (
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* 상단 필터 바 (헌장 3.5 좌상단 Scope & 우상단 Pipeline) */}
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-app)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>상태:</span>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  style={{ width: 'auto', padding: '6px 10px', fontSize: '12px', fontWeight: '700' }}
                >
                  <option value="ALL">전체 상태</option>
                  <option value="PENDING">대기중</option>
                  <option value="PRINTING">출력중</option>
                  <option value="COMPLETED">출력완료</option>
                  <option value="FAILED">출력오류</option>
                  <option value="CANCELLED">취소됨</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>문서:</span>
                <select
                  value={filterDocType}
                  onChange={e => setFilterDocType(e.target.value)}
                  style={{ width: 'auto', padding: '6px 10px', fontSize: '12px', fontWeight: '700' }}
                >
                  <option value="ALL">전체 문서</option>
                  <option value="DISPATCH_ORDER">출고요청서</option>
                  <option value="RETURN_ORDER">회수요청서</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>스테이션:</span>
                <select
                  value={filterStation}
                  onChange={e => setFilterStation(e.target.value)}
                  style={{ width: 'auto', padding: '6px 10px', fontSize: '12px', fontWeight: '700' }}
                >
                  <option value="ALL">전체 스테이션</option>
                  {printStations.map(st => (
                    <option key={st.id} value={st.id}>
                      {st.stationName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                조회 {filteredQueue.length}건
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => refreshAllData()}
                style={{ padding: '6px 10px', fontSize: '12px' }}
                title="새로고침"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          {/* 고밀도 대사 테이블 (헌장 3.2 줄바꿈 방지 적용) */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--bg-app)',
                    borderBottom: '2px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                    fontWeight: '700'
                  }}
                >
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>발행시각</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>문서구분</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>문서번호</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>제목</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>타겟 스테이션</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>요청자</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>상태</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>시도</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>오류</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>완료시각</th>
                  <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>조치</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      style={{
                        padding: '48px 20px',
                        textAlign: 'center',
                        color: 'var(--text-muted)'
                      }}
                    >
                      인쇄 대기 작업이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredQueue.map(item => {
                    const st = printStations.find(s => s.id === item.stationId);
                    return (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--text-main)'
                        }}
                      >
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                          {new Date(item.createdAt).toLocaleString('ko-KR', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontWeight: '700',
                              fontSize: '11px',
                              backgroundColor:
                                item.docType === 'DISPATCH_ORDER'
                                  ? 'rgba(59, 130, 246, 0.15)'
                                  : 'rgba(168, 85, 247, 0.15)',
                              color: item.docType === 'DISPATCH_ORDER' ? '#3b82f6' : '#a855f7',
                              border: '1px solid var(--border-color)'
                            }}
                          >
                            {item.docType === 'DISPATCH_ORDER' ? '출고요청' : '회수요청'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: '700' }}>
                          {item.docNo || '-'}
                        </td>
                        <td
                          style={{
                            padding: '9px 12px',
                            whiteSpace: 'nowrap',
                            fontWeight: '600',
                            maxWidth: '220px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          title={item.title}
                        >
                          {item.title}
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: '700' }}>{st?.stationName || item.stationId}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                            ({item.localPrinterName || st?.localPrinterName || '-'})
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                          {item.requestedByName || '-'}
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          {item.status === 'PENDING' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                color: '#f59e0b',
                                border: '1px solid rgba(245, 158, 11, 0.3)'
                              }}
                            >
                              <Clock size={11} /> 대기중
                            </span>
                          )}
                          {item.status === 'PRINTING' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                color: '#3b82f6',
                                border: '1px solid rgba(59, 130, 246, 0.3)'
                              }}
                            >
                              <RefreshCw size={11} className="animate-spin" /> 출력중
                            </span>
                          )}
                          {item.status === 'COMPLETED' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                color: '#10b981',
                                border: '1px solid rgba(16, 185, 129, 0.3)'
                              }}
                            >
                              <CheckCircle2 size={11} /> 완료
                            </span>
                          )}
                          {item.status === 'FAILED' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.3)'
                              }}
                            >
                              <AlertCircle size={11} /> 오류
                            </span>
                          )}
                          {item.status === 'CANCELLED' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: 'rgba(148, 163, 184, 0.15)',
                                color: 'var(--text-muted)',
                                border: '1px solid var(--border-color)'
                              }}
                            >
                              <XCircle size={11} /> 취소
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                          {item.attempts}
                        </td>
                        <td
                          style={{
                            padding: '9px 12px',
                            whiteSpace: 'nowrap',
                            color: '#ef4444',
                            maxWidth: '140px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          title={item.lastError || ''}
                        >
                          {item.lastError || '-'}
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                          {item.completedAt
                            ? new Date(item.completedAt).toLocaleTimeString('ko-KR')
                            : '-'}
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setPreviewItem(item)}
                              style={{ padding: '3px 8px', fontSize: '11px', fontWeight: '700' }}
                              title="서식 미리보기"
                            >
                              <Eye size={11} />
                              <span>미리보기</span>
                            </button>

                            {(item.status === 'FAILED' || item.status === 'COMPLETED') && (
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => retryPrintJob(item.id)}
                                style={{ padding: '3px 8px', fontSize: '11px', fontWeight: '700' }}
                                title="재출력"
                              >
                                <RefreshCw size={11} />
                                <span>재출력</span>
                              </button>
                            )}

                            {item.status === 'PENDING' && (
                              <button
                                type="button"
                                onClick={() => cancelPrintJob(item.id)}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  fontWeight: '700',
                                  color: '#ef4444',
                                  backgroundColor: 'transparent',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="출력 취소"
                              >
                                <XCircle size={11} />
                                <span>취소</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ 서식 미리보기 모달 ═══ */}
      {previewItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '850px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.35)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)', margin: 0 }}>
                  인쇄 서식 미리보기: {previewItem.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ flex: 1, padding: '16px', backgroundColor: '#e2e8f0', overflow: 'auto' }}>
              <iframe
                title="Document Preview"
                srcDoc={previewItem.documentHtml}
                style={{
                  width: '100%',
                  height: '650px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                }}
              />
            </div>

            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                backgroundColor: 'var(--bg-card)'
              }}
            >
              <button
                type="button"
                className="btn-primary"
                onClick={() => setPreviewItem(null)}
                style={{ padding: '8px 18px', fontSize: '12px' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
