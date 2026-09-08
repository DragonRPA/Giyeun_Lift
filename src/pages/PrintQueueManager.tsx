// src/pages/PrintQueueManager.tsx
// 🖨️ 분산 무인 인쇄 큐 모니터 및 프린터 스테이션 관리 (헌장 1.1, 1.2, 3.1 명사 표준 준수)

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
  Plus,
  Trash2,
  Play,
  XCircle,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  Laptop,
  Layers,
  FileText
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

  // 미리보기 모달
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
    <div className="p-6 bg-slate-50 min-h-screen">
      {/* 상단 헤더 (헌장 3.1 무수식어 건조 명사 표준) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-200 mb-6 gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-800 text-white rounded-lg shadow-sm">
            <Printer size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">프린트 큐 모니터</h1>
            <p className="text-xs text-slate-500 mt-0.5">현장 분산 로컬 프린터 원격 무인 출력 및 스테이션 관리</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={scanLocalAgent}
            disabled={isScanningAgent}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw size={13} className={isScanningAgent ? 'animate-spin' : ''} />
            에이전트 재탐색
          </button>
          <div className={`px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1.5 border ${
            agentStatus.online
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : 'bg-rose-50 text-rose-700 border-rose-300'
          }`}>
            <span className={`w-2 h-2 rounded-full ${agentStatus.online ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            {agentStatus.online ? `로컬 에이전트 연결됨 (${agentStatus.machineName || 'PC'})` : '로컬 에이전트 미연결'}
          </div>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex border-b border-slate-200 mb-6 bg-white rounded-t-lg px-4 pt-2 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('stations')}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'stations'
              ? 'border-slate-800 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Server size={15} />
          프린트 스테이션 현황 ({printStations.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'queue'
              ? 'border-slate-800 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Layers size={15} />
          인쇄 대기열 대장 ({printQueue.length})
        </button>
      </div>

      {/* 탭 1: 프린트 스테이션 현황 */}
      {activeTab === 'stations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 좌측: 등록된 스테이션 목록 (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Server size={16} className="text-slate-600" />
                  <h2 className="font-bold text-sm text-slate-800">등록 스테이션 목록</h2>
                </div>
                <span className="text-xs text-slate-400">총 {printStations.length}개소 등록</span>
              </div>

              {printStations.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  <Printer size={32} className="mx-auto mb-2 opacity-30" />
                  등록된 인쇄 스테이션이 없습니다. 우측 폼에서 현재 PC를 등록하십시오.
                </div>
              ) : (
                <div className="space-y-3">
                  {printStations.map(station => {
                    const online = isStationOnline(station);
                    return (
                      <div
                        key={station.id}
                        className={`p-4 border rounded-lg transition-all ${
                          editingStationId === station.id
                            ? 'border-blue-500 bg-blue-50/30'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3">
                            <div className={`p-2.5 rounded-lg text-white mt-0.5 ${
                              online ? 'bg-emerald-600' : 'bg-slate-400'
                            }`}>
                              <Printer size={18} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-base text-slate-900">{station.stationName}</h3>
                                <span className={`px-2 py-0.5 text-xs font-bold rounded flex items-center gap-1 border ${
                                  online
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-100 text-slate-500 border-slate-200'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                  {online ? 'ONLINE' : 'OFFLINE'}
                                </span>
                                <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-700 rounded font-semibold border border-slate-200">
                                  {station.docTypeDefault === 'DISPATCH_ORDER' && '출고요청서 전담'}
                                  {station.docTypeDefault === 'RETURN_ORDER' && '입고요청서 전담'}
                                  {station.docTypeDefault === 'ALL' && '공용 서식'}
                                </span>
                              </div>
                              <div className="text-xs text-slate-600 mt-1.5 space-y-0.5">
                                <div><span className="font-semibold text-slate-500">로컬 프린터:</span> {station.localPrinterName}</div>
                                <div><span className="font-semibold text-slate-500">호스트 명:</span> {station.machineName || '-'}</div>
                                {station.description && (
                                  <div><span className="font-semibold text-slate-500">설명:</span> {station.description}</div>
                                )}
                                <div className="text-[11px] text-slate-400 pt-1">
                                  최근 하트비트: {station.lastHeartbeat ? new Date(station.lastHeartbeat).toLocaleTimeString('ko-KR') : '-'}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1.5 items-end">
                            <button
                              type="button"
                              onClick={() => handleSendTestPrint(station)}
                              className="px-2.5 py-1 bg-slate-800 text-white hover:bg-slate-900 rounded text-xs font-semibold flex items-center gap-1"
                            >
                              <Play size={11} />
                              테스트 인쇄
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditStation(station)}
                                className="px-2 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded text-xs"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`스테이션 [${station.stationName}]을 삭제하시겠습니까?`)) {
                                    deletePrintStation(station.id);
                                  }
                                }}
                                className="px-2 py-1 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 rounded text-xs"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 우측: 현재 PC 스테이션 등록/수정 폼 (5 cols) - 헌장 3.4 상하 스택 레이아웃 */}
          <div className="lg:col-span-5">
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm sticky top-4">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Laptop size={16} className="text-slate-600" />
                  <h2 className="font-bold text-sm text-slate-800">
                    {editingStationId ? '스테이션 설정 수정' : '현재 PC 스테이션 등록'}
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
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    신규 등록으로 전환
                  </button>
                )}
              </div>

              {/* 퀵 셋업 버튼군 */}
              <div className="mb-4 p-3 bg-slate-50 rounded border border-slate-200">
                <span className="text-xs font-semibold text-slate-600 block mb-2">원터치 스테이션 서식 지정:</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStationName('프린터1');
                      setDocTypeDefault('DISPATCH_ORDER');
                      setDescription('출고장 전담 프린터');
                    }}
                    className={`py-1.5 px-2 rounded text-xs font-bold border text-center transition-all ${
                      stationName === '프린터1'
                        ? 'bg-blue-600 text-white border-blue-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    프린터1 (출고요청서)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStationName('프린터2');
                      setDocTypeDefault('RETURN_ORDER');
                      setDescription('입고장 전담 프린터');
                    }}
                    className={`py-1.5 px-2 rounded text-xs font-bold border text-center transition-all ${
                      stationName === '프린터2'
                        ? 'bg-blue-600 text-white border-blue-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    프린터2 (입고요청서)
                  </button>
                </div>
              </div>

              <form onSubmit={handleSaveStation} className="space-y-4">
                {/* 스테이션 명칭 */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">스테이션 명칭 (식별자)</label>
                  <input
                    type="text"
                    value={stationName}
                    onChange={e => setStationName(e.target.value)}
                    placeholder="예: 프린터1, 프린터2, 주기장 출고 데스크"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800"
                    required
                  />
                </div>

                {/* 로컬 프린터 선택 */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">로컬 프린터 선택</label>
                    <button
                      type="button"
                      onClick={scanLocalAgent}
                      className="text-[11px] text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <RefreshCw size={10} />
                      목록 새로고침
                    </button>
                  </div>

                  {agentStatus.online && agentStatus.printers.length > 0 ? (
                    <select
                      value={selectedPrinter}
                      onChange={e => setSelectedPrinter(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800 bg-white"
                      required
                    >
                      <option value="">-- 로컬 프린터 선택 --</option>
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
                      placeholder="에이전트 미연결 시 직접 프린터 이름 입력"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800"
                      required
                    />
                  )}
                  <p className="text-[11px] text-slate-500">
                    현재 컴퓨터에 Windows 드라이버로 연결된 물리 프린터 이름입니다.
                  </p>
                </div>

                {/* 기본 처리 문서 유형 */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">기본 전담 문서 서식</label>
                  <select
                    value={docTypeDefault}
                    onChange={e => setDocTypeDefault(e.target.value as any)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800 bg-white"
                  >
                    <option value="DISPATCH_ORDER">출고요청서 전담 (사무실 출고요청 발행 시 자동 라우팅)</option>
                    <option value="RETURN_ORDER">입고요청서 전담 (사무실 입고요청 발행 시 자동 라우팅)</option>
                    <option value="ALL">공용 (모든 문서 수신 허용)</option>
                  </select>
                </div>

                {/* 호스트 컴퓨터 명칭 */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">호스트 컴퓨터 명</label>
                  <input
                    type="text"
                    value={machineName}
                    onChange={e => setMachineName(e.target.value)}
                    placeholder="자동 탐색되거나 수동 입력"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50 focus:outline-none"
                  />
                </div>

                {/* 설치 위치 및 설명 */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">설치 위치 및 부가 설명</label>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="예: 1주기장 출고 사무실 1번 PC"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800"
                  />
                </div>

                {formFeedback && (
                  <div className={`p-3 rounded text-xs font-semibold flex items-center gap-2 ${
                    formFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}>
                    {formFeedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    {formFeedback.message}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-colors"
                >
                  <Printer size={15} />
                  {editingStationId ? '스테이션 설정 갱신' : '스테이션 등록 및 에이전트 동기화'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 탭 2: 인쇄 대기열 대장 (고밀도 그리드형 - 헌장 3.6 아키타입 B) */}
      {activeTab === 'queue' && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          {/* 상단 필터 바 */}
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">상태:</span>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-semibold"
                >
                  <option value="ALL">전체 상태</option>
                  <option value="PENDING">대기중 (PENDING)</option>
                  <option value="PRINTING">출력중 (PRINTING)</option>
                  <option value="COMPLETED">출력완료 (COMPLETED)</option>
                  <option value="FAILED">출력실패 (FAILED)</option>
                  <option value="CANCELLED">취소됨 (CANCELLED)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">문서:</span>
                <select
                  value={filterDocType}
                  onChange={e => setFilterDocType(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-semibold"
                >
                  <option value="ALL">전체 문서</option>
                  <option value="DISPATCH_ORDER">출고요청서</option>
                  <option value="RETURN_ORDER">입고요청서</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">스테이션:</span>
                <select
                  value={filterStation}
                  onChange={e => setFilterStation(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-semibold"
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

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-semibold">
                조회 결과: {filteredQueue.length}건
              </span>
              <button
                type="button"
                onClick={() => refreshAllData()}
                className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-100 text-slate-700"
                title="새로고침"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {/* 고밀도 대사 테이블 (헌장 3.2 줄바꿈 방지 적용) */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <th className="p-2.5 whitespace-nowrap">발행시각</th>
                  <th className="p-2.5 whitespace-nowrap">문서구분</th>
                  <th className="p-2.5 whitespace-nowrap">문서번호</th>
                  <th className="p-2.5 whitespace-nowrap">문서제목</th>
                  <th className="p-2.5 whitespace-nowrap">타겟 스테이션</th>
                  <th className="p-2.5 whitespace-nowrap">요청자</th>
                  <th className="p-2.5 whitespace-nowrap">상태</th>
                  <th className="p-2.5 whitespace-nowrap">시도</th>
                  <th className="p-2.5 whitespace-nowrap">오류내용</th>
                  <th className="p-2.5 whitespace-nowrap">완료시각</th>
                  <th className="p-2.5 whitespace-nowrap text-center">조치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQueue.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-400">
                      인쇄 대기열 작업이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredQueue.map(item => {
                    const st = printStations.find(s => s.id === item.stationId);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-2.5 whitespace-nowrap font-mono text-slate-600">
                          {new Date(item.createdAt).toLocaleDateString('ko-KR', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded font-bold ${
                            item.docType === 'DISPATCH_ORDER'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {item.docType === 'DISPATCH_ORDER' ? '출고요청' : '입고요청'}
                          </span>
                        </td>
                        <td className="p-2.5 whitespace-nowrap font-mono text-slate-700">
                          {item.docNo || '-'}
                        </td>
                        <td className="p-2.5 whitespace-nowrap font-semibold text-slate-800 max-w-[200px] truncate" title={item.title}>
                          {item.title}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className="font-bold text-slate-700">{st?.stationName || item.stationId}</span>
                          <span className="text-slate-400 ml-1">({item.localPrinterName || st?.localPrinterName || '-'})</span>
                        </td>
                        <td className="p-2.5 whitespace-nowrap text-slate-600">
                          {item.requestedByName || '-'}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          {item.status === 'PENDING' && (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold flex items-center gap-1 w-max">
                              <Clock size={11} /> 대기중
                            </span>
                          )}
                          {item.status === 'PRINTING' && (
                            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold flex items-center gap-1 w-max animate-pulse">
                              <RefreshCw size={11} className="animate-spin" /> 출력중
                            </span>
                          )}
                          {item.status === 'COMPLETED' && (
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1 w-max">
                              <CheckCircle2 size={11} /> 완료
                            </span>
                          )}
                          {item.status === 'FAILED' && (
                            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold flex items-center gap-1 w-max">
                              <AlertCircle size={11} /> 오류
                            </span>
                          )}
                          {item.status === 'CANCELLED' && (
                            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-600 font-bold flex items-center gap-1 w-max">
                              <XCircle size={11} /> 취소
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 whitespace-nowrap text-center text-slate-600">
                          {item.attempts}
                        </td>
                        <td className="p-2.5 whitespace-nowrap text-rose-600 max-w-[150px] truncate" title={item.lastError || ''}>
                          {item.lastError || '-'}
                        </td>
                        <td className="p-2.5 whitespace-nowrap font-mono text-slate-500">
                          {item.completedAt
                            ? new Date(item.completedAt).toLocaleTimeString('ko-KR')
                            : '-'}
                        </td>
                        <td className="p-2.5 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setPreviewItem(item)}
                              className="px-2 py-1 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded text-[11px] font-semibold flex items-center gap-1"
                              title="서식 미리보기"
                            >
                              <Eye size={11} />
                              미리보기
                            </button>

                            {(item.status === 'FAILED' || item.status === 'COMPLETED') && (
                              <button
                                type="button"
                                onClick={() => retryPrintJob(item.id)}
                                className="px-2 py-1 bg-slate-800 text-white hover:bg-slate-900 rounded text-[11px] font-semibold flex items-center gap-1"
                                title="재출력 큐 전송"
                              >
                                <RefreshCw size={11} />
                                재출력
                              </button>
                            )}

                            {item.status === 'PENDING' && (
                              <button
                                type="button"
                                onClick={() => cancelPrintJob(item.id)}
                                className="px-2 py-1 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded text-[11px] font-semibold flex items-center gap-1"
                                title="출력 취소"
                              >
                                <XCircle size={11} />
                                취소
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

      {/* 서식 미리보기 모달 */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-slate-700" />
                <h3 className="font-bold text-sm text-slate-900">
                  인쇄 서식 미리보기: {previewItem.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="p-1 hover:bg-slate-200 rounded text-slate-500"
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="flex-1 p-4 bg-slate-200 overflow-auto">
              <iframe
                title="Document Preview"
                srcDoc={previewItem.documentHtml}
                className="w-full h-[650px] bg-white border border-slate-300 shadow-sm"
              />
            </div>
            <div className="p-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded text-xs font-bold"
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
