// src/mobile/components/MobileApkMonitorModal.tsx
// ============================================================
// APK 다운로드 및 작동 모니터링 모달
// 전사 표준 헌장 3.1 (무수식어 건조 표준) 준수
// ============================================================
import React from 'react';
import { 
  X, Smartphone, Download, UploadCloud, CheckCircle2, 
  Clock, User, RefreshCw, AlertCircle, PhoneCall
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { WorkStatus, ApkRelease, FALLBACK_APK_RELEASE } from '../../services/workStatusService';

interface MobileApkMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  workStatus: WorkStatus | null;
  isWorkLoading: boolean;
  onToggleWork: () => void;
  onOpenAudioUpload: () => void;
  apkRelease?: ApkRelease | null;
}

export const MobileApkMonitorModal: React.FC<MobileApkMonitorModalProps> = ({
  isOpen,
  onClose,
  workStatus,
  isWorkLoading,
  onToggleWork,
  onOpenAudioUpload,
  apkRelease
}) => {
  const { currentUser } = useApp();

  if (!isOpen) return null;

  const isWorking = workStatus?.isWorking ?? false;
  const startedAt = workStatus?.workStartedAt
    ? new Date(workStatus.workStartedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const release = apkRelease || FALLBACK_APK_RELEASE;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 (헌장 3.1 무수식어 건조 표준) */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isWorking ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">APK 다운로드 및 모니터링</h2>
              <p className="text-[10px] text-slate-400">통화 녹음 패키지 및 출퇴근 상태</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="p-4 overflow-y-auto space-y-4">
          {/* 1. 작동 상태 카드 */}
          <div className={`p-3.5 rounded-xl border ${
            isWorking 
              ? 'bg-emerald-950/40 border-emerald-600/40' 
              : 'bg-slate-800/60 border-slate-700'
          }`}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-bold text-slate-300">작동 상태</span>
              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isWorking 
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                  : 'bg-slate-700 text-slate-400'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  isWorking ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`} />
                <span>{isWorking ? 'APK 활성 (통화 녹음 수집 중)' : 'APK 대기 (퇴근 상태)'}</span>
              </div>
            </div>

            <div className="space-y-1.5 text-[11px] text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> 로그인 사용자
                </span>
                <span className="font-semibold text-white">
                  {currentUser?.name || '담당자'} ({currentUser?.role === 'ADMIN' ? '개발자' : currentUser?.role === 'MECHANIC' ? '정비기사' : '임직원'})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> 출근 시각
                </span>
                <span className="font-mono text-white">
                  {startedAt || '퇴근 상태 (기록 없음)'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <PhoneCall className="w-3.5 h-3.5" /> 통화 감지 백그라운드
                </span>
                <span className={isWorking ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                  {isWorking ? '자동 감지 활성' : '정지됨'}
                </span>
              </div>
            </div>

            {/* 출퇴근 전환 버튼 */}
            <div className="mt-3">
              <button
                type="button"
                onClick={onToggleWork}
                disabled={isWorkLoading}
                className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                  isWorking
                    ? 'bg-red-950/60 border-red-500/50 text-red-300 hover:bg-red-900/60'
                    : 'bg-emerald-900/60 border-emerald-500/50 text-emerald-300 hover:bg-emerald-800/60'
                }`}
              >
                <span className="text-sm">{isWorkLoading ? '⏳' : isWorking ? '⚫' : '🟢'}</span>
                <span>{isWorkLoading ? '처리 중...' : isWorking ? '퇴근 처리' : '출근 처리'}</span>
              </button>
            </div>
          </div>

          {/* 2. APK 다운로드 카드 */}
          <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-950/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-300 flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> 안드로이드 APK 설치 파일
              </span>
              <span className="text-[10px] font-mono text-blue-400 bg-blue-900/50 px-2 py-0.5 rounded border border-blue-500/40">
                {release.version}
              </span>
            </div>

            <div className="text-[11px] text-slate-300 space-y-1 bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
              <div className="flex justify-between">
                <span className="text-slate-400">파일명</span>
                <span className="font-mono text-white">CallTransfer.apk</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">파일 크기</span>
                <span className="font-mono text-white">약 24.1 KB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">지원 환경</span>
                <span className="text-white">Android 8.0 이상 (ARM64/x86)</span>
              </div>
            </div>

            {/* 다운로드 실행 링크 */}
            <a
              href={`${release.downloadUrl || '/downloads/CallTransfer.apk'}?v=${encodeURIComponent(release.version || '2.0.0')}`}
              download="CallTransfer.apk"
              className="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>APK 다운로드 ({release.version})</span>
            </a>
            <p className="text-[10px] text-slate-400 text-center">
              다운로드 후 알림창 또는 다운로드 폴더에서 탭하여 설치를 진행하세요.
            </p>
          </div>

          {/* 3. 웹 직접 업로드 카드 (APK 미설치 / 아이폰 대응) */}
          <div className="p-3.5 rounded-xl border border-slate-700 bg-slate-850/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                <UploadCloud className="w-3.5 h-3.5 text-amber-400" /> 통화 녹음 직접 업로드
              </span>
              <span className="text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-600/30">
                아이폰 / 미설치 대응
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              APK 앱을 설치하지 않았거나 아이폰 사용자의 경우, 기기에 저장된 통화 녹음 파일(.m4a, .mp3)을 웹에서 직접 등록할 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAudioUpload();
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors"
            >
              <UploadCloud className="w-4 h-4 text-amber-400" />
              <span>통화 녹음 파일 선택 업로드</span>
            </button>
          </div>
        </div>

        {/* 하단 닫기 */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
