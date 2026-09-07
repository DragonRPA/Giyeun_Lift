// src/components/PipelineConsole.tsx
import React, { useState, useRef, useEffect } from 'react';
import { PipelineLogRecord } from '../services/callUploadService';
import { Terminal, ChevronUp, ChevronDown, Activity, Trash2 } from 'lucide-react';

interface PipelineConsoleProps {
  logs: PipelineLogRecord[];
  onClearLogs: () => void;
  onSendTestLog: () => void;
}

export const PipelineConsole: React.FC<PipelineConsoleProps> = ({
  logs,
  onClearLogs,
  onSendTestLog,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'SUCCESS' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter(l => (filter === 'ALL' ? true : l.level === filter));
  const latestLog = logs[0];

  // 로그 추가 시 자동 스크롤
  useEffect(() => {
    if (isExpanded) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, isExpanded]);

  return (
    <div className="flex-shrink-0 z-40 bg-slate-950 border-t border-slate-800 shadow-2xl transition-all duration-200">
      {/* 1. 아코디언 헤더 (40px 고정) */}
      <div
        className="h-10 px-4 bg-slate-900/90 hover:bg-slate-800 cursor-pointer flex items-center justify-between border-b border-slate-800/60 select-none"
        onClick={() => setIsExpanded(p => !p)}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-black text-slate-200">파이프라인 로그</span>
          </div>

          <span className="text-[11px] font-mono text-slate-400 flex-shrink-0">({logs.length}건)</span>

          {/* 접힌 상태일 때 최신 1건 티커 표출 */}
          {!isExpanded && latestLog && (
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 max-w-xl truncate">
              <span className="text-slate-600">|</span>
              <span className="font-mono text-[10.5px] text-slate-500">[{new Date(latestLog.createdAt).toLocaleTimeString('ko-KR')}]</span>
              <span className="truncate text-slate-300">{latestLog.message}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isExpanded && (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              {(['ALL', 'SUCCESS', 'INFO', 'WARN', 'ERROR'] as const).map(lvl => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setFilter(lvl)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                    filter === lvl ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lvl}
                </button>
              ))}
              <button
                type="button"
                onClick={onSendTestLog}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold ml-1 flex items-center gap-1"
                title="진단 신호 전송"
              >
                <Activity className="w-3 h-3 text-emerald-400" />
                <span>테스트</span>
              </button>
              <button
                type="button"
                onClick={onClearLogs}
                className="p-1 rounded text-slate-500 hover:text-rose-400 ml-0.5"
                title="로그 비우기"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
          <button
            type="button"
            className="p-1 text-slate-400 hover:text-white"
            onClick={(e) => { e.stopPropagation(); setIsExpanded(p => !p); }}
            title={isExpanded ? '접기' : '펼치기'}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2. 아코디언 본문 (Expanded 시 240px 터미널 전개) */}
      {isExpanded && (
        <div className="h-60 overflow-y-auto p-3 bg-slate-950 font-mono text-[11px] leading-relaxed flex flex-col gap-1 text-slate-300 dispatch4-scrollbar">
          {filteredLogs.length === 0 ? (
            <div className="py-8 text-center text-slate-600 text-xs">표시할 파이프라인 이벤트 로그가 없습니다.</div>
          ) : (
            filteredLogs.map(log => (
              <div key={log.id} className="flex items-start gap-2 hover:bg-slate-900/50 px-1.5 py-0.5 rounded">
                <span className="text-slate-500 text-[10px] flex-shrink-0 font-mono">
                  [{new Date(log.createdAt).toLocaleTimeString('ko-KR')}]
                </span>
                <span className={`text-[9.5px] font-bold px-1.5 rounded flex-shrink-0 ${
                  log.level === 'SUCCESS' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                  log.level === 'ERROR' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                  log.level === 'WARN' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                  'bg-blue-950 text-blue-400 border border-blue-800'
                }`}>
                  {log.level}
                </span>
                <span className="text-slate-400 text-[10px] font-semibold flex-shrink-0">[{log.eventType}]</span>
                <span className="text-slate-200 flex-1 break-all">{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
};
