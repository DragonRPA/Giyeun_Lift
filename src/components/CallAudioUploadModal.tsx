// src/components/CallAudioUploadModal.tsx
// ============================================================
// 통화 녹음 파일 직접 업로드 모달 (웹앱 전용)
// APK 설치 거부자/아이폰/PC 사용자 대응
// z-index: 9100 (MobileBottomNav z-index:9000 초과 필수)
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
    const fileName = selected.name.toLowerCase();
    const isAudioExt = /\.(m4a|mp3|wav|ogg|aac|amr|flac|wma|3gp|m4r)$/i.test(fileName);
    const isAudioMime = selected.type && selected.type.startsWith('audio/');

    // 오디오 확장자도 아니고 오디오 MIME도 아닌 경우 안내
    if (!isAudioExt && !isAudioMime && selected.type) {
      setErrorMsg('오디오 파일(.m4a, .mp3, .wav 등)만 업로드할 수 있습니다.');
      return;
    }

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
        if (next.size > 1) next.delete(ctx);
      } else {
        next.add(ctx);
      }
      return next;
    });
  };

  const handleUpload = async () => {
    if (!file && !summaryText.trim()) {
      setErrorMsg('음성 파일을 선택하거나 통화 텍스트(메모)를 입력해 주세요.');
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

  // MobileBottomNav z-index:9000 위에 표시되어야 하므로 9100 사용
  // 하단 내비바 높이(~64px) + safe-area 를 paddingBottom으로 보정
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9100,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f172a',
          borderTop: '1px solid #1e293b',
          borderRadius: '16px 16px 0 0',
          width: '100%',
          maxHeight: 'calc(100dvh - 56px)', // 헤더 높이 제외
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── 헤더 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #1e293b', background: 'rgba(2,6,23,0.7)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(37,99,235,0.18)', border: '1px solid rgba(59,130,246,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileAudio style={{ width: 16, height: 16, color: '#60a5fa' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', lineHeight: 1.3 }}>통화 녹음 파일 직접 업로드</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>AI 출고 요청 초안 자동 생성</div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            style={{ padding: 6, borderRadius: 8, background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* ── 본문 (스크롤) ── */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1, minHeight: 0 }}>

          {/* 1. 파일 선택 */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>1. 음성 파일 선택</span>
              <span style={{ fontSize: 10, fontWeight: 400, color: '#94a3b8' }}>음성 또는 텍스트 중 하나 필수</span>
            </div>

            {/* 네이티브 파일 인풋 (Visually Hidden: 모바일 브라우저/웹뷰 터치 연동 100% 호환) */}
            <input
              id="call-audio-file-input"
              ref={fileInputRef}
              type="file"
              accept="audio/*,audio/mp4,audio/x-m4a,audio/m4a,audio/mpeg,audio/wav,audio/aac,audio/amr,.m4a,.mp3,.wav,.aac,.amr,*/*"
              style={{
                position: 'absolute',
                width: '1px',
                height: '1px',
                padding: 0,
                margin: '-1px',
                overflow: 'hidden',
                clip: 'rect(0, 0, 0, 0)',
                whiteSpace: 'nowrap',
                border: 0,
                opacity: 0,
                pointerEvents: 'none',
              }}
              onClick={e => {
                (e.target as HTMLInputElement).value = '';
              }}
              onChange={e => {
                if (e.target.files && e.target.files[0]) {
                  handleFileChange(e.target.files[0]);
                }
              }}
            />

            {!file ? (
              <label
                htmlFor="call-audio-file-input"
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${isDragging ? '#3b82f6' : '#334155'}`,
                  borderRadius: 12,
                  padding: '20px 14px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: isDragging ? 'rgba(59,130,246,0.08)' : 'rgba(30,41,59,0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'all 0.2s',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(59,130,246,0.12)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UploadCloud style={{ width: 22, height: 22 }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>탭하여 음성/녹음 파일 선택</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    .m4a · .mp3 · .wav · .aac · .amr
                  </div>
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, background: 'rgba(15,23,42,0.6)', padding: '3px 8px', borderRadius: 6 }}>
                  스마트폰: [내 파일] ➔ [Recordings] ➔ [Call]
                </div>
              </label>
            ) : (
              <div
                style={{
                  border: '2px solid #10b981',
                  borderRadius: 12,
                  padding: '16px 14px',
                  background: 'rgba(16,185,129,0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(16,185,129,0.2)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Check style={{ width: 20, height: 20 }} />
                  </div>
                  <div style={{ textAlign: 'center', maxWidth: '100%' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', wordBreak: 'break-all' }}>{file.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                  </div>
                  {audioUrl && (
                    <audio src={audioUrl} controls style={{ width: '100%', height: 38, borderRadius: 8, marginTop: 4 }} />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4, width: '100%' }}>
                  <label
                    htmlFor="call-audio-file-input"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#93c5fd',
                      textAlign: 'center',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      userSelect: 'none',
                    }}
                  >
                    <span>다른 파일로 변경</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (audioUrl) URL.revokeObjectURL(audioUrl);
                      setAudioUrl(null);
                    }}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      background: 'rgba(239,68,68,0.15)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: '#fca5a5',
                      cursor: 'pointer',
                    }}
                  >
                    제거
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2. 업무 맥락 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>2. 통화 업무 맥락 <span style={{ fontWeight: 400, color: '#64748b' }}>(복합 선택)</span></div>
              <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 600 }}>{selectedContexts.size}개 선택됨</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CALL_CONTEXT_OPTIONS.map(ctx => {
                const sel = selectedContexts.has(ctx.id);
                return (
                  <button
                    key={ctx.id}
                    type="button"
                    onClick={() => toggleContext(ctx.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      border: `1px solid ${sel ? '#3b82f6' : '#334155'}`,
                      background: sel ? 'rgba(37,99,235,0.25)' : '#1e293b',
                      color: sel ? '#93c5fd' : '#94a3b8',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sel && '✓ '}{ctx.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. 통화 메모 / 텍스트 의뢰 */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>3. 통화 텍스트 / 삼성 AI 요약 / 카톡 의뢰</span>
              <span style={{ fontSize: 10, fontWeight: 400, color: '#60a5fa' }}>파일 없이 텍스트만으로 초안 생성 가능</span>
            </div>
            <textarea
              value={summaryText}
              onChange={e => setSummaryText(e.target.value)}
              placeholder="삼성 통화요약, 고객 카톡 발주문, 또는 핵심 통화 메모를 붙여넣으세요. (예: 고촌 현대 현장 19피트 2대 내일 아침 8시 김반장)"
              rows={4}
              style={{ width: '100%', background: 'rgba(30,41,59,0.8)', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#e2e8f0', outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5 }}
            />
          </div>

          {/* 에러 */}
          {errorMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(127,29,29,0.4)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', fontSize: 11 }}>
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* ── 푸터 (항상 고정, 내비바 위로 표시) ── */}
        {/* paddingBottom: 내비바 높이(64px) + safe-area */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 10,
          padding: '14px 20px',
          paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid #1e293b',
          background: 'rgba(2,6,23,0.85)',
          flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            style={{ padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}
          >
            취소
          </button>
          {(() => {
            const canSubmit = !uploading && (!!file || summaryText.trim().length > 0) && selectedContexts.size > 0;
            return (
              <button
                type="button"
                onClick={handleUpload}
                disabled={!canSubmit}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 700,
                  background: !canSubmit ? '#1e3a5f' : '#2563eb',
                  border: 'none', color: !canSubmit ? '#64748b' : '#fff',
                  cursor: !canSubmit ? 'not-allowed' : 'pointer',
                  boxShadow: canSubmit ? '0 4px 16px rgba(37,99,235,0.35)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {uploading ? (
                  <>
                    <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
                    <span>{file ? '업로드 및 초안 생성 중...' : '초안 자동 생성 중...'}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud style={{ width: 16, height: 16 }} />
                    <span>{file ? '전송 (초안 자동생성)' : '텍스트 의뢰 전송 (초안 자동생성)'}</span>
                  </>
                )}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
export default CallAudioUploadModal;
