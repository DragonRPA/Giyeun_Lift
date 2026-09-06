// src/components/CallAudioUploadModal.tsx
// ============================================================
// 통화 녹음 파일 직접 업로드 모달 (웹앱 전용)
// APK 설치 거부자/아이폰/PC 사용자 대응
// ============================================================
import React, { useState, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  CallContext,
  CALL_CONTEXT_OPTIONS,
  uploadCallRecording
} from '../services/callUploadService';
import { X, UploadCloud, FileAudio, Check, AlertCircle, Loader2 } from 'lucide-react';

interface CallAudioUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CallAudioUploadModal: React.FC<CallAudioUploadModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { currentUser } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [selectedContexts, setSelectedContexts] = useState<Set<CallContext>>(new Set(['ADDITIONAL']));
  const [summaryText, setSummaryText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = (selected: File | null) => {
    if (!selected) return;
    setErrorMsg(null);
    setFile(selected);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(URL.createObjectURL(selected));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type.startsWith('audio/') || droppedFile.name.match(/\.(m4a|mp3|wav|ogg|aac|amr|flac)$/i)) {
        handleFileChange(droppedFile);
      } else {
        setErrorMsg('오디오 파일(.m4a, .mp3, .wav 등)만 업로드할 수 있습니다.');
      }
    }
  }, [audioUrl]);

  const toggleContext = (ctx: CallContext) => {
    setSelectedContexts(prev => {
      const next = new Set(prev);
      if (next.has(ctx)) {
        if (next.size > 1) next.delete(ctx); // 최소 1개는 유지
      } else {
        next.add(ctx);
      }
      return next;
    });
  };

  const handleUpload = async () => {
    if (!file) {
      setErrorMsg('업로드할 음성 파일을 선택해 주세요.');
      return;
    }
    if (selectedContexts.size === 0) {
      setErrorMsg('업무 맥락을 최소 1개 선택해 주세요.');
      return;
    }

    setUploading(true);
    setErrorMsg(null);

    try {
      const uploaderId = currentUser?.id || 'anonymous_web_user';
      await uploadCallRecording(
        file,
        uploaderId,
        Array.from(selectedContexts),
        summaryText.trim() || undefined
      );

      // 성공 후 초기화
      setFile(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setSummaryText('');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('[CallAudioUpload] Upload failed:', err);
      setErrorMsg(err?.message || '파일 업로드에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col text-slate-100 animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        style={{ maxHeight: '95dvh' }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60 flex-shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
              <FileAudio className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">통화 녹음 파일 직접 업로드</h3>
              <p className="text-xs text-slate-400">웹에서 통화 녹음을 등록하여 AI 출고의뢰 초안을 자동 생성합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 — flex-1 + overflow-y:auto → 남은 높이 전부 사용, 스크롤 */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0">
          {/* 1. 파일 선택 영역 */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              1. 음성 파일 선택 <span className="text-red-400">*</span>
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
                isDragging
                  ? 'border-blue-500 bg-blue-500/10'
                  : file
                    ? 'border-emerald-500/50 bg-emerald-950/20'
                    : 'border-slate-700 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-800/70'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac,.amr"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />

              {file ? (
                <div className="w-full flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <Check className="w-5 h-5" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white break-all">{file.name}</p>
                    <p className="text-xs text-slate-400">
                      {(file.size / (1024 * 1024)).toFixed(2)} MB · 클릭하여 다른 파일로 변경
                    </p>
                  </div>
                  {audioUrl && (
                    <audio
                      src={audioUrl}
                      controls
                      className="w-full mt-2 h-9 rounded"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">클릭하여 파일 선택 또는 드래그</p>
                    <p className="text-xs text-slate-400 mt-0.5">.m4a, .mp3, .wav, .aac (스마트폰 녹음 파일)</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 2. 업무 맥락 선택 7종 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300">
                2. 통화 업무 맥락 선택 <span className="text-slate-400 font-normal">(복합 선택 가능)</span>
              </label>
              <span className="text-[11px] text-blue-400 font-medium">
                {selectedContexts.size}개 선택됨
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CALL_CONTEXT_OPTIONS.map((ctx) => {
                const isSelected = selectedContexts.has(ctx.id);
                return (
                  <button
                    key={ctx.id}
                    type="button"
                    onClick={() => toggleContext(ctx.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                      isSelected
                        ? 'border-blue-500 bg-blue-600/30 text-blue-200 shadow-sm'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}
                  >
                    {isSelected && <span className="mr-1">✓</span>}
                    {ctx.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. 녹음 텍스트 요약 / 메모 (선택사항) */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              3. 삼성 통화요약 텍스트 또는 통화 메모 <span className="text-slate-400 font-normal">(선택사항)</span>
            </label>
            <textarea
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
              placeholder="스마트폰에서 복사한 통화 요약 텍스트나 핵심 메모가 있다면 여기에 붙여넣어 주세요. (STT 결과와 교차 검증되어 신뢰도가 대폭 향상됩니다)"
              rows={3}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none font-sans"
            />
          </div>

          {/* 에러 메시지 */}
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* 푸터 — flex-shrink:0 으로 항상 하단 고정 표시 */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || !file}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white transition shadow-lg shadow-blue-900/30"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>업로드 & AI 분석 중...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>전송</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
export default CallAudioUploadModal;
