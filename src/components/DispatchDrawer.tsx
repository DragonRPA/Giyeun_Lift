// src/components/DispatchDrawer.tsx
import React, { useEffect } from 'react';
import { CallUploadRecord, DraftDispatchOrder, CALL_CONTEXT_OPTIONS } from '../services/callUploadService';
import { X, Phone, Package, Calendar, MapPin, Truck, ShieldCheck, ArrowRight, Trash2, Zap, RefreshCw, User } from 'lucide-react';
import { useScrollLock } from '../hooks/useScrollLock';

interface DispatchDrawerProps {
  isOpen: boolean;
  mode: 'UPLOAD' | 'DRAFT' | null;
  upload: CallUploadRecord | null;
  draft: DraftDispatchOrder | null;
  isConverting?: boolean;
  onClose: () => void;
  onConvertToDraft?: (uploadId: string) => void;
  onLoadUploadToForm?: (upload: CallUploadRecord) => void;
  onDeleteUpload?: (upload: CallUploadRecord) => void;
  onSubmitDraft?: (draft: DraftDispatchOrder) => void;
  onLoadDraftToForm?: (draft: DraftDispatchOrder) => void;
  onDiscardDraft?: (draftId: string) => void;
}

export const DispatchDrawer: React.FC<DispatchDrawerProps> = ({
  isOpen,
  mode,
  upload,
  draft,
  isConverting = false,
  onClose,
  onConvertToDraft,
  onLoadUploadToForm,
  onDeleteUpload,
  onSubmitDraft,
  onLoadDraftToForm,
  onDiscardDraft,
}) => {
  useScrollLock(isOpen);

  // 키보드 ESC 단축키 바인딩
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || (!upload && !draft)) return null;

  return (
    <div className="fixed inset-0 z-[9150] flex justify-end">
      {/* 1. 배경 오버레이 (클릭 시 닫힘) */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 2. 드로어 메인 패널 (560px 고밀도 인스펙터) */}
      <aside
        className="relative z-[9200] w-full max-w-[560px] h-full bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250 select-text"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        {/* 드로어 헤더 */}
        <header className="flex-shrink-0 h-14 px-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {mode === 'UPLOAD' ? (
              <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
                <Phone className="w-4 h-4" />
              </div>
            ) : (
              <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Package className="w-4 h-4" />
              </div>
            )}
            <div>
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <span>{mode === 'UPLOAD' ? '통화 녹음 상세' : '출고의뢰 초안 상세'}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  {mode === 'UPLOAD' ? (upload?.id.slice(0, 8) ?? '') : (draft?.id.slice(0, 8) ?? '')}
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">ESC 키로 닫기</span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              aria-label="드로어 닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 드로어 바디 (독립 스크롤 영역) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-4 dispatch4-scrollbar overscroll-contain">
          {mode === 'UPLOAD' && upload && (
            <>
              {/* 상태 및 맥락 태그 */}
              <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-black px-2.5 py-1 rounded border ${
                    upload.status === 'UPLOADED'
                      ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                      : upload.status === 'PROCESSING'
                        ? 'bg-blue-950/80 text-blue-300 border-blue-800'
                        : upload.status === 'PROCESSED'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                          : 'bg-rose-950/80 text-rose-300 border-rose-800'
                  }`}>
                    {upload.status === 'UPLOADED' ? '대기중' : upload.status === 'PROCESSING' ? '분석중' : upload.status === 'PROCESSED' ? '초안생성완료' : '오류'}
                  </span>
                  {(upload.callContext || []).map(ctx => {
                    const opt = CALL_CONTEXT_OPTIONS.find(o => o.id === ctx);
                    return (
                      <span
                        key={ctx}
                        className="text-xs font-bold px-2 py-0.5 rounded text-white"
                        style={{ backgroundColor: opt?.color || '#475569' }}
                      >
                        {opt?.label || ctx}
                      </span>
                    );
                  })}
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {new Date(upload.createdAt).toLocaleString('ko-KR')}
                </span>
              </div>

              {/* 음성 플레이어 섹션 */}
              {upload.publicUrl ? (
                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span>통화 녹음 원음 청취</span>
                    <span className="text-[10px] text-slate-400 font-mono">{upload.fileName}</span>
                  </div>
                  <audio controls src={upload.publicUrl} className="w-full h-8" preload="metadata" />
                </div>
              ) : (
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-400">
                  녹음 재생 URL이 등록되지 않았습니다. ({upload.fileName})
                </div>
              )}

              {/* 통화 메타데이터 카드 */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px] mb-0.5">발신자 연락처</span>
                  <span className="font-mono font-bold text-blue-300 text-sm">{upload.callerPhone || '미인식'}</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px] mb-0.5">업로더 ID</span>
                  <span className="font-mono text-slate-300">{upload.uploaderId}</span>
                </div>
              </div>

              {/* 통화 요약 텍스트 */}
              {upload.summaryText ? (
                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-amber-300">AI 통화 요약</span>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    {upload.summaryText}
                  </p>
                </div>
              ) : (
                <div className="p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/80 text-xs text-slate-400">
                  저장된 요약 메모가 없습니다.
                </div>
              )}
            </>
          )}

          {mode === 'DRAFT' && draft && (
            <>
              {/* 고객사 & 긴급도 */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 flex-wrap gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400 block">고객사</span>
                    <h4 className="text-sm font-black text-white">{draft.customerName.value || '(고객사 미정)'}</h4>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      draft.urgency === 'HIGH'
                        ? 'bg-red-950 text-red-300 border-red-800'
                        : draft.urgency === 'MEDIUM'
                          ? 'bg-amber-950 text-amber-300 border-amber-800'
                          : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    }`}>
                      {draft.urgency === 'HIGH' ? '긴급' : draft.urgency === 'MEDIUM' ? '보통' : '여유'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {new Date(draft.createdAt).toLocaleString('ko-KR')}
                    </span>
                  </div>
                </div>

                {/* 현장 정보 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px]">현장명</span>
                    <span className="font-bold text-slate-200">{draft.siteName.value || '미정'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">상차일정</span>
                    <span className="font-mono font-bold text-amber-400">
                      {draft.loadingDate.value || '미정'} {draft.loadingTime.value || ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">현장인수자</span>
                    <span className="text-slate-200">
                      {draft.contactPerson.value || '-'} ({typeof (draft as any).contactPhone === 'string' ? (draft as any).contactPhone : ((draft as any).contactPhone?.value || '-')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">등록상태</span>
                    <span className="font-semibold text-emerald-300">{draft.status}</span>
                  </div>
                </div>

                {/* 신청 장비 목록 */}
                <div className="border-t border-slate-800 pt-2.5">
                  <span className="text-[11px] font-bold text-slate-400 block mb-1.5">신청 장비 규격</span>
                  {draft.equipments.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {draft.equipments.map((eq, i) => (
                        <span key={i} className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-emerald-300">
                          {eq.modelName} × {eq.qty}대
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">등록된 장비 규격이 없습니다.</span>
                  )}
                </div>

                {/* 메모 */}
                {draft.note && (
                  <div className="border-t border-slate-800 pt-2.5">
                    <span className="text-[11px] font-bold text-slate-400 block mb-1">참조 메모</span>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-900 p-2.5 rounded-lg border border-slate-800 break-all">
                      {draft.note}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 드로어 푸터 (Gutenberg Action 바 영구 고정) */}
        <footer className="flex-shrink-0 p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2">
          {mode === 'UPLOAD' && upload && (
            <>
              <button
                type="button"
                onClick={() => onDeleteUpload?.(upload)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/70 hover:border-rose-600 transition flex items-center gap-1.5 shadow-sm"
                title="통화 녹음 파일 및 업로드 기록 삭제"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>삭제</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onLoadUploadToForm?.(upload)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white transition"
                >
                  새의뢰 폼으로 복사
                </button>
                <button
                  type="button"
                  disabled={isConverting}
                  onClick={() => onConvertToDraft?.(upload.id)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-black bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white transition flex items-center gap-1.5 shadow-md"
                >
                  {isConverting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>초안 생성 중...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 text-amber-300" />
                      <span>초안 생성 ➔</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {mode === 'DRAFT' && draft && (
            <>
              <button
                type="button"
                onClick={() => onDiscardDraft?.(draft.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/70 hover:border-rose-600 transition flex items-center gap-1.5 shadow-sm"
                title="해당 초안 폐기"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>폐기</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onLoadDraftToForm?.(draft)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 hover:text-white transition"
                >
                  새의뢰 작성으로 가져오기 ➔
                </button>
                <button
                  type="button"
                  onClick={() => onSubmitDraft?.(draft)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5 shadow-md"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>배차 대장 등록 ➔</span>
                </button>
              </div>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
};
