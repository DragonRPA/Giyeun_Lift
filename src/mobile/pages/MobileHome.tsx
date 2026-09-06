// src/mobile/pages/MobileHome.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Wrench, Truck, CheckSquare, Search, Send, Building2, 
  ArrowRight, AlertTriangle, Clock, Plus, Boxes, ArrowDownToLine, Users, Car, BookOpen,
  Smartphone, Download, UploadCloud
} from 'lucide-react';
import { MobileTabType } from '../MobileBottomNav';
import { MobileDeptMode } from '../MobileHeader';
import { clockIn, clockOut, getMyWorkStatus, getLatestApkRelease, subscribeWorkStatus, WorkStatus, ApkRelease } from '../../services/workStatusService';
import { CallAudioUploadModal } from '../../components/CallAudioUploadModal';

interface MobileHomeProps {
  deptMode: MobileDeptMode;
  onNavigate: (tab: MobileTabType) => void;
  onOpenAsDetail: (ticketId: string) => void;
  onOpenCreateAs: () => void;
}

export const MobileHome: React.FC<MobileHomeProps> = ({
  deptMode,
  onNavigate,
  onOpenAsDetail,
  onOpenCreateAs,
}) => {
  const { fieldAsTickets, deliveries, outboundInspections, currentUser, assets, contracts, mechanicConsumableStocks, customers } = useApp();

  // ── 출퇴근 상태 ────────────────────────────────────────
  const [workStatus, setWorkStatus] = useState<WorkStatus | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [apkRelease, setApkRelease] = useState<ApkRelease | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  useEffect(() => {
    if (deptMode !== 'SALES') return;
    getMyWorkStatus().then(s => setWorkStatus(s));
    getLatestApkRelease().then(r => setApkRelease(r));
    if (!currentUser?.id) return;
    const unsub = subscribeWorkStatus(currentUser.id, s => setWorkStatus(s));
    return unsub;
  }, [deptMode, currentUser?.id]);

  const handleWorkToggle = useCallback(async () => {
    if (!currentUser?.id || workLoading) return;
    setWorkLoading(true);
    try {
      if (workStatus?.isWorking) {
        await clockOut(currentUser.id);
      } else {
        await clockIn(currentUser.id);
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setWorkLoading(false);
    }
  }, [currentUser?.id, workStatus, workLoading]);

  // ── KPI 집계 ───────────────────────────────────────────
  const availableAssetCount = assets.filter(a => a.status === 'AVAILABLE' && a.ownerType !== 'RENTED').length;
  const pendingAsTickets = fieldAsTickets.filter(
    (t) => t.status === 'REQUESTED' || t.status === 'SCHEDULED' || t.status === 'REVISIT' || t.status === 'IN_PROGRESS'
  );
  const pendingDeliveries = deliveries.filter(
    (d) => d.status === 'PENDING' || d.status === 'REQUESTED' || d.status === 'DISPATCHED'
  );
  const pendingInspections = outboundInspections.filter((ins) => ins.status === 'PENDING');
  const activeContracts = contracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED');

  // ── 출근/퇴근 카드 (공통) ─────────────────────────────
  const WorkStatusCard = () => {
    const isWorking = workStatus?.isWorking ?? false;
    const startedAt = workStatus?.workStartedAt
      ? new Date(workStatus.workStartedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : null;

    return (
      <div className="flex gap-3">
        {/* 출근/퇴근 토글 */}
        <button
          onClick={handleWorkToggle}
          disabled={workLoading}
          className={`flex-1 flex flex-col items-center justify-center gap-1.5 rounded-2xl py-4 border-2 transition-all active:scale-95 ${
            isWorking
              ? 'bg-emerald-900/60 border-emerald-500 shadow-[0_0_16px_rgba(34,197,94,0.3)]'
              : 'bg-slate-800 border-slate-600'
          }`}
        >
          <span className="text-3xl">{workLoading ? '⏳' : isWorking ? '🟢' : '⚫'}</span>
          <span className={`text-sm font-black ${isWorking ? 'text-emerald-300' : 'text-slate-300'}`}>
            {isWorking ? '출근 중' : '퇴근'}
          </span>
          {isWorking && startedAt && (
            <span className="text-[10px] text-emerald-400 font-mono">since {startedAt}</span>
          )}
          {!isWorking && (
            <span className="text-[10px] text-slate-500">탭하여 출근</span>
          )}
        </button>

        {/* APK 다운로드 */}
        <div className="flex flex-col gap-2 w-[120px]">
          <a
            href={apkRelease?.downloadUrl ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-col items-center justify-center gap-1 rounded-2xl py-3 border transition-all active:scale-95 ${
              apkRelease?.downloadUrl
                ? 'bg-blue-900/50 border-blue-500/60 text-blue-300'
                : 'bg-slate-800 border-slate-700 text-slate-500 pointer-events-none'
            }`}
          >
            <Download className="w-5 h-5" />
            <span className="text-[11px] font-bold">통화캡처 APK</span>
            <span className="text-[10px] opacity-70">
              {apkRelease?.version ?? '준비중'}
            </span>
          </a>
          <div className={`flex items-center justify-center gap-1 rounded-xl py-2 border text-[10px] font-bold ${
            isWorking
              ? 'bg-emerald-950 border-emerald-800/60 text-emerald-400'
              : 'bg-slate-900 border-slate-700 text-slate-500'
          }`}>
            <Smartphone className="w-3 h-3" />
            {isWorking ? 'APK 활성' : 'APK 대기'}
          </div>
        </div>
      </div>
    );
  };

  // 1. [영업부 전용 홈 화면]
  if (deptMode === 'SALES') {
    return (
      <div className="flex flex-col gap-4 pb-24 p-4 font-sans text-slate-100">
        {/* 출근/퇴근 + APK 다운로드 카드 */}
        <WorkStatusCard />

        {/* APK 미설치자/아이폰 대응: 통화 녹음 직접 업로드 카드 */}
        <div
          onClick={() => setIsUploadModalOpen(true)}
          className="cursor-pointer bg-gradient-to-r from-blue-950/70 to-slate-900 border border-blue-500/40 rounded-2xl p-3.5 flex items-center justify-between shadow-md active:scale-98 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0 text-blue-400">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-black text-white flex items-center gap-1.5">
                <span>통화 녹음 파일 직접 업로드</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold">
                  웹 직접 등록
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                APK 미설치 단말 · 스마트폰 녹음 파일 선택 즉시 AI 분석
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-blue-400 flex-shrink-0" />
        </div>

        {/* 상단 ToDo 카드 */}
        <div className="bg-gradient-to-br from-blue-900/60 to-slate-900 border border-blue-500/30 rounded-3xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-blue-400 tracking-wider">영업 현장 피드</span>
            <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
            </span>
          </div>
          <h2 className="text-xl font-black text-white leading-tight">
            {currentUser?.name || '영업담당'}님,<br />
            가동 계약 <span className="text-blue-400">{activeContracts.length}건</span> 운용 중
          </h2>
        </div>

        {/* [핵심 1] 자사 가용재고 3초 스캔 카드 */}
        <div 
          onClick={() => onNavigate('assets')}
          className="cursor-pointer bg-slate-900 border border-emerald-500/40 rounded-2xl p-4 flex items-center justify-between shadow-lg active:scale-98 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <Search className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="text-sm font-black text-white flex items-center gap-1.5">
                <span>자사 가용 재고 현황</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                  본사 모현
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                출고 가능 자산 <strong className="text-emerald-400 font-bold">{availableAssetCount}대</strong> (6대 규격 신호등)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-xl border border-emerald-500/20">
            <span>조회</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* [핵심 2] 모바일 출고 간편 의뢰 대형 버튼 */}
        <button
          type="button"
          onClick={() => onNavigate('sales_order')}
          className="w-full py-4 px-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-base flex items-center justify-between shadow-xl shadow-blue-600/30 active:scale-98 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Send className="w-5 h-5 stroke-[2.5]" />
            </div>
            <span>모바일 출고 의뢰 작성</span>
          </div>
          <ArrowRight className="w-5 h-5" />
        </button>

        {/* [핵심 3] 고객사 및 거래처 관리 배너 (경영진 연동 기능) */}
        <div
          onClick={() => onNavigate('customers')}
          className="p-4 rounded-2xl bg-slate-900 border border-indigo-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-lg"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>고객사 및 거래처 관리</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold">
                  {customers.length}개사
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">대표자 직통전화, 현장 목록, 결제약정 확인</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-indigo-400" />
        </div>

        {/* [법인차량] 차량운행일지 / 주유영수증 촬영 카드 */}
        <div
          onClick={() => onNavigate('vehicle_log')}
          className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>차량운행일지 / 주유영수증</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                  전사 공용
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">계기판 & 주유영수증 촬영 ➔ 국세청 서식 자동 연동</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-amber-400" />
        </div>

        {/* [핵심 4] 내 계약 & 투입현장 조회 배너 */}
        <div
          onClick={() => onNavigate('my_contracts')}
          className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between active:scale-98 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">내 계약 & 투입 현장</div>
              <div className="text-xs text-slate-400">현장별 투입 장비 번호 및 소장 연락처</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </div>

        {/* [핵심 4] 고객 긴급 AS 대리 접수 배너 */}
        <div
          onClick={onOpenCreateAs}
          className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between active:scale-98 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">고객 고장 AS 대리 접수</div>
              <div className="text-xs text-slate-400">유선 클레임 수신 시 현장 즉시 접수</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </div>

        <CallAudioUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          onSuccess={() => {
            alert('통화 녹음 파일이 업로드되었습니다.\nAI 분석 완료 후 출고의뢰 대기 큐에 초안으로 등록됩니다.');
          }}
        />
      </div>
    );
  }

  // 2. [출고/자산팀 전용 홈 화면]
  if (deptMode === 'OUTBOUND') {
    return (
      <div className="flex flex-col gap-4 pb-24 p-4 font-sans text-slate-100">
        <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-500/30 rounded-3xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-400 tracking-wider">주기장 출고 피드</span>
            <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
            </span>
          </div>
          <h2 className="text-xl font-black text-white leading-tight">
            출고 검수 대기 <span className="text-emerald-400">{pendingInspections.length}건</span><br />
            임대 가능 자산 <span className="text-sky-400">{availableAssetCount}대</span>
          </h2>
        </div>

        {/* 출고 검수(PDI) 마감 대형 버튼 (헌장 1.3 준수) */}
        <button
          type="button"
          onClick={() => onNavigate('inspection')}
          className="w-full py-4 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base flex items-center justify-between shadow-xl shadow-emerald-600/30 active:scale-98 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <CheckSquare className="w-5 h-5 stroke-[2.5]" />
            </div>
            <span>출고 검수 승인 마감 (PDI)</span>
          </div>
          <ArrowRight className="w-5 h-5" />
        </button>

        {/* 장비 입고 등록 대형 버튼 (신규) */}
        <button
          type="button"
          onClick={() => onNavigate('inbound_register')}
          className="w-full py-4 px-5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-black text-base flex items-center justify-between shadow-xl shadow-teal-600/30 active:scale-98 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <ArrowDownToLine className="w-5 h-5 stroke-[2.5]" />
            </div>
            <span>회수 장비 입고 등록</span>
          </div>
          <ArrowRight className="w-5 h-5" />
        </button>

        {/* 주기장 자산 조회 */}
        <div
          onClick={() => onNavigate('assets')}
          className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between active:scale-98 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400">
              <Search className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">주기장 자산 상태 조회</div>
              <div className="text-xs text-slate-400">임대가능 자산 {availableAssetCount}대</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </div>

        {/* 출고 의뢰 조회 */}
        <div
          onClick={() => onNavigate('sales_order')}
          className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between active:scale-98 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">출고 의뢰 접수 현황</div>
              <div className="text-xs text-slate-400">영업부 출고요청 파이프라인</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </div>

        {/* [법인차량] 차량운행일지 / 주유영수증 촬영 카드 */}
        <div
          onClick={() => onNavigate('vehicle_log')}
          className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>차량운행일지 / 주유영수증</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                  전사 공용
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">계기판 & 주유영수증 촬영 ➔ 국세청 서식 자동 연동</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-amber-400" />
        </div>

        {/* [장비 매뉴얼] 장비 매뉴얼 라이브러리 바로가기 */}
        <div
          onClick={() => onNavigate('manual_viewer')}
          className="p-4 rounded-2xl bg-slate-900 border border-blue-500/30 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>장비 매뉴얼 라이브러리</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold">
                  출고·정비
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">파츠북, 에러코드 진단표, 전기/유압 회로도 열람</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-blue-400" />
        </div>
      </div>
    );
  }

  // 3. [AS팀 전용 홈 화면 - 기본]
  return (
    <div className="flex flex-col gap-4 pb-24 p-4 font-sans text-slate-100">
      <div className="bg-gradient-to-br from-amber-950/60 to-slate-900 border border-amber-500/30 rounded-3xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-amber-400 tracking-wider">현장 AS 출동 피드</span>
          <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
          </span>
        </div>
        <h2 className="text-xl font-black text-white leading-tight">
          {currentUser?.name || '정비기사'}님,<br />
          출동 당면 과제 <span className="text-amber-400">{pendingAsTickets.length}건</span>
        </h2>
      </div>

      {/* 1-Click 긴급 AS 등록 버튼 */}
      <button
        type="button"
        onClick={onOpenCreateAs}
        className="w-full py-4 px-5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-black text-base flex items-center justify-between shadow-xl shadow-amber-600/30 active:scale-98 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <Plus className="w-6 h-6 stroke-[3]" />
          </div>
          <span>현장 AS 신규 등록</span>
        </div>
        <ArrowRight className="w-5 h-5" />
      </button>

      {/* 긴급 출동 대상 AS 목록 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>오늘 출동 티켓 ({pendingAsTickets.length}건)</span>
          </h3>
          <button
            type="button"
            onClick={() => onNavigate('as')}
            className="text-xs text-sky-400 font-semibold"
          >
            전체보기 ➔
          </button>
        </div>

        {pendingAsTickets.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-500 text-xs">
            대기 중인 AS 출동 건이 없습니다.
          </div>
        ) : (
          pendingAsTickets.slice(0, 3).map((ticket) => (
            <div
              key={ticket.id}
              onClick={() => onOpenAsDetail(ticket.id)}
              className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 active:scale-98 transition-all cursor-pointer flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-black font-mono border border-blue-500/30">
                    {ticket.assetNo || '장비번호미상'}
                  </span>
                  <span className="text-xs text-slate-400">{ticket.modelName || ''}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  {ticket.status === 'SCHEDULED' ? '방문예정' : ticket.status === 'REVISIT' ? '재방문' : '접수'}
                </span>
              </div>
              <div className="text-sm font-bold text-white line-clamp-1">
                {ticket.siteName ? `[${ticket.siteName}] ` : ''}{ticket.customerName || '고객사'}
              </div>
              <div className="text-xs text-slate-400 line-clamp-1">
                증상: {ticket.issueDescription || ticket.issueCategory || '고장 점검 요청'}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 본인 차량 소모품 재고 조회 */}
      <div
        onClick={() => onNavigate('vehicle_stock')}
        className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>내 차량 소모품 재고</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold">
                {(mechanicConsumableStocks || [])
                  .filter(s => s.mechanicId === currentUser?.id && s.stockQty > 0)
                  .reduce((sum, s) => sum + s.stockQty, 0)}개 적재
              </span>
            </div>
            <div className="text-xs text-slate-400">보충 수령, 본사 반납 및 실사 관리</div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-slate-500" />
      </div>

      {/* 가용 자산 빠른 조회 */}
      <div
        onClick={() => onNavigate('assets')}
        className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between active:scale-98 transition-all cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">가용 자산 조회</div>
            <div className="text-xs text-slate-400">규격별 출고 가능 자산 ({availableAssetCount}대)</div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-slate-500" />
      </div>

      {/* [법인차량] 차량운행일지 / 주유영수증 촬영 카드 */}
      <div
        onClick={() => onNavigate('vehicle_log')}
        className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
            <Car className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>차량운행일지 / 주유영수증</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                전사 공용
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">계기판 & 주유영수증 촬영 ➔ 국세청 서식 자동 연동</div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-amber-400" />
      </div>

      {/* [장비 매뉴얼] 장비 매뉴얼 라이브러리 바로가기 */}
      <div
        onClick={() => onNavigate('manual_viewer')}
        className="p-4 rounded-2xl bg-slate-900 border border-blue-500/30 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>장비 매뉴얼 라이브러리</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold">
                현장 AS 필수
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">파츠북, 에러코드 진단표, 전기/유압 회로도 열람</div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-blue-400" />
      </div>
    </div>
  );
};
