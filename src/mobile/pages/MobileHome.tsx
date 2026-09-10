// src/mobile/pages/MobileHome.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Wrench, Truck, CheckSquare, Search, Send, Building2, 
  ArrowRight, AlertTriangle, Clock, Plus, Boxes, ArrowDownToLine, Users, Car, Fuel, BookOpen,
  Smartphone, Download, UploadCloud, Layers, Package, Bell, FileText
} from 'lucide-react';
import { MobileTabType } from '../MobileBottomNav';
import { MobileDeptMode } from '../MobileHeader';
import { CallAudioUploadModal } from '../../components/CallAudioUploadModal';
import { findActiveTasksForUser } from '../../utils/taskHandoverPipeline';
import { Todo } from '../../services/db';

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
  const { 
    fieldAsTickets, 
    deliveries, 
    outboundInspections, 
    currentUser, 
    assets, 
    contracts, 
    contractAssets, 
    mechanicConsumableStocks, 
    customers, 
    currentTenant, 
    repairs, 
    consumables, 
    logout,
    todos,
    hasPermission,
    completeTodo,
    resolveExecutiveDirective
  } = useApp();

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // ── 로그인 사용자 직무 맞춤형 ToDo 필터링 (헌장 3.3 정책 준수) ──
  const userTodos = useMemo(() => {
    return findActiveTasksForUser(todos || [], currentUser, hasPermission);
  }, [todos, currentUser, hasPermission]);

  const resolveMobileTabForTask = (task: Todo): MobileTabType | null => {
    const url = task.actionUrl || '';
    const cat = task.taskCategory || '';
    const et = task.entityType || '';

    if (url.includes('dispatch_assign') || cat.includes('ASSIGN')) return 'assignment';
    if (url.includes('dispatch') || cat.includes('DISPATCH') || et === 'DELIVERY') return 'dispatch';
    if (url.includes('outbound_inspections') || cat.includes('INSPECTION') || et === 'INSPECTION') return 'inspection';
    if (url.includes('repairs') || cat.includes('AS') || cat.includes('REPAIR') || et === 'REPAIR') return 'as';
    if (url.includes('contract') || cat.includes('CONTRACT')) return 'my_contracts';
    if (url.includes('customers') || cat.includes('CUSTOMER')) return 'customers';
    if (url.includes('sales_order')) return 'sales_order';
    if (url.includes('vehicle_log')) return 'vehicle_log';
    if (url.includes('delinquency')) return 'delinquency';
    if (url.includes('consumables')) return 'consumable_stock';
    if (url.includes('assets')) return 'assets';
    return null;
  };

  const handleResolveDirective = async (task: Todo) => {
    const note = prompt('조치 결과 내용을 입력해주세요:', '현장 확인 및 조치 완료');
    if (note === null) return;
    await resolveExecutiveDirective(task.id, note || '조치 완료');
  };

  // ── KPI 집계 ───────────────────────────────────────────
  const availableAssetCount = assets.filter(a => a.status === 'AVAILABLE' && a.ownerType !== 'RENTED').length;
  const pendingAsTickets = fieldAsTickets.filter(
    (t) => t.status === 'REQUESTED' || t.status === 'SCHEDULED' || t.status === 'REVISIT' || t.status === 'IN_PROGRESS'
  );
  const pendingDeliveries = deliveries.filter(
    (d) => d.status === 'PENDING' || d.status === 'REQUESTED' || d.status === 'DISPATCHED'
  );
  const pendingInspections = outboundInspections.filter((ins) => ins.status === 'PENDING');
  const pendingAssignmentSlots = (contractAssets || []).filter((ca) => !ca.assetId).length;
  const activeContracts = contracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED');
  const yardRepairAssets = (assets || []).filter(a => {
    if (a.status === 'RENTED' || a.status === 'SOLD' || a.status === 'ASSIGNED') return false;
    const hasInboundDefect = (repairs || []).some(r => r.assetId === a.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');
    return hasInboundDefect || a.status === 'REPAIRING' || a.status === 'RENTED_RETURNED';
  });
  const inboundDefectCount = (assets || []).filter(a => 
    (repairs || []).some(r => r.assetId === a.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION')
  ).length;

  // 1. [영업부 전용 홈 화면]
  if (deptMode === 'SALES') {
    return (
      <div className="flex flex-col gap-4 pb-24 p-4 font-sans text-slate-100">
        {/* 직무 맞춤형 당면 과제 ToDo 피드 (헌장 3.3 준수 - 최상단 배치) */}
        {userTodos.length > 0 && (
          <div className="bg-slate-900 border-2 border-indigo-500/50 rounded-2xl p-4 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 flex-shrink-0">
                  <Bell className="w-4 h-4" />
                </div>
                <span className="text-sm font-black text-white" style={{ whiteSpace: 'nowrap' }}>
                  업무 목록
                </span>
              </div>
              <span className="text-xs font-black px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                {userTodos.length}건 대기
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              {userTodos.map((task) => {
                const isDirective = task.taskCategory === 'EXECUTIVE_DIRECTIVE';
                const isPackageResend = task.taskCategory === 'CONTRACT_PACKAGE_RESEND';
                const priorityBg = task.priority === 'URGENT' 
                  ? 'bg-red-500/20 text-red-300 border-red-500/30' 
                  : task.priority === 'HIGH' 
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' 
                  : 'bg-blue-500/20 text-blue-300 border-blue-500/30';

                return (
                  <div
                    key={task.id}
                    className={`p-3 rounded-xl border flex flex-col gap-2 ${
                      isDirective
                        ? 'bg-red-950/30 border-red-500/50'
                        : isPackageResend
                        ? 'bg-indigo-950/30 border-indigo-500/50'
                        : 'bg-slate-800/80 border-slate-700/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isDirective ? (
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-red-600 text-white flex items-center gap-1" style={{ whiteSpace: 'nowrap' }}>
                            ⚡ 특별지시
                          </span>
                        ) : isPackageResend ? (
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-indigo-600 text-white flex items-center gap-1" style={{ whiteSpace: 'nowrap' }}>
                            <FileText className="w-3 h-3" /> 패키지 재발송
                          </span>
                        ) : (
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${priorityBg}`} style={{ whiteSpace: 'nowrap' }}>
                            {task.priority || 'NORMAL'}
                          </span>
                        )}

                        {task.dueDate && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30" style={{ whiteSpace: 'nowrap' }}>
                            마감 {task.dueDate}
                          </span>
                        )}
                      </div>

                      {task.createdAt && (
                        <span className="text-[10px] text-slate-400 font-mono" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {task.createdAt.substring(5, 10)}
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="text-xs font-black text-white leading-snug">
                        {task.title}
                      </h4>
                      {task.content && (
                        <p className="text-[11px] text-slate-300 mt-1 leading-relaxed whitespace-pre-line">
                          {task.content}
                        </p>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
                        <span>발행: {task.senderName || '경영진'}</span>
                        {task.targetDept && <span>대상: {task.targetDept}</span>}
                      </div>
                    </div>

                    {/* 액션 버튼군 */}
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-700/50">
                      {/* 처리 이동 버튼 */}
                      {(() => {
                        const targetTab = resolveMobileTabForTask(task);
                        if (!targetTab) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => onNavigate(targetTab)}
                            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all"
                            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            <span>처리 이동</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        );
                      })()}

                      {/* 완료 처리 버튼 */}
                      {isDirective ? (
                        <button
                          type="button"
                          onClick={() => handleResolveDirective(task)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all"
                          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          <CheckSquare className="w-3 h-3" />
                          <span>보고 및 완료</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => completeTodo(task.id)}
                          className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all"
                          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          <CheckSquare className="w-3 h-3" />
                          <span>완료</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 상단 현장 피드 배너 */}
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

        {/* [핵심 1] 모바일 출고 간편 의뢰 대형 버튼 */}
        <button
          type="button"
          onClick={() => onNavigate('sales_order')}
          className="w-full py-4 px-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-base flex items-center justify-between shadow-xl shadow-blue-600/30 active:scale-98 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Send className="w-5 h-5 stroke-[2.5]" />
            </div>
            <span>모바일 출고 요청 작성</span>
          </div>
          <ArrowRight className="w-5 h-5" />
        </button>

        {/* [핵심 2] APK 미설치자/아이폰 대응: 통화 녹음 직접 업로드 카드 */}
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

        {/* [핵심 3] 법인차량 주유영수증 촬영 카드 */}
        <div
          onClick={() => onNavigate('vehicle_log')}
          className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>법인차량 주유영수증 촬영</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                  전사 공용
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">주유 영수증 촬영 및 등록 ➔ 주유 대장 자동 연동</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-amber-400" />
        </div>

        {/* [핵심 4] 고객 고장 AS 대리 접수 배너 */}
        <div
          onClick={() => onOpenCreateAs()}
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
            장비 할당 대기 <span className="text-blue-400">{pendingAssignmentSlots}대</span><br />
            출고 검수 대기 <span className="text-emerald-400">{pendingInspections.length}건</span>
          </h2>
        </div>

        {/* 계약 장비 할당 대형 버튼 (신규) */}
        <button
          type="button"
          onClick={() => onNavigate('assignment')}
          className="w-full py-4 px-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-base flex items-center justify-between shadow-xl shadow-blue-600/30 active:scale-98 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Layers className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="flex items-center gap-2">
              <span>계약 장비 할당</span>
              {pendingAssignmentSlots > 0 && (
                <span className="text-xs bg-white text-blue-700 px-2 py-0.5 rounded-full font-bold">
                  {pendingAssignmentSlots}대 미할당
                </span>
              )}
            </div>
          </div>
          <ArrowRight className="w-5 h-5" />
        </button>

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

        {/* 주기장 정비 스튜디오 바로가기 배너 */}
        <div
          onClick={() => onNavigate('as')}
          className="p-4 rounded-2xl bg-gradient-to-r from-red-950/40 to-slate-900 border border-red-500/30 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>주기장 정비입력</span>
                {yardRepairAssets.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold">
                    {yardRepairAssets.length}대 대기{inboundDefectCount > 0 ? ` (결함 ${inboundDefectCount})` : ''}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">입고 결함 점검, 소모품 투입 및 임대가능(AVAILABLE) 복원</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-red-400" />
        </div>

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

        {/* 주기장 소모품 재고조회 */}
        <div
          onClick={() => onNavigate('consumable_stock')}
          className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>주기장 소모품 재고조회</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                  {(consumables || []).length}종
                </span>
              </div>
              <div className="text-xs text-slate-400">출고 부속품, 충전기, 안전용품 및 부품 가용 수량 실시간 조회</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-amber-400" />
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
              <div className="text-sm font-bold text-white">출고 요청 접수 현황</div>
              <div className="text-xs text-slate-400">영업부 출고요청 파이프라인</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </div>

        {/* [법인차량] 주유영수증 등록 카드 */}
        <div
          onClick={() => onNavigate('vehicle_log')}
          className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>법인차량 주유영수증 촬영</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                  전사 공용
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">주유 영수증 촬영 및 등록 ➔ 주유 대장 자동 연동</div>
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
        onClick={() => onOpenCreateAs()}
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
            <div className="text-xs text-slate-400">보충 수령, 주기장 반납 및 실사 관리</div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-slate-500" />
      </div>

      {/* 주기장 입고 정비 스튜디오 바로가기 */}
      <div
        onClick={() => onNavigate('as')}
        className="p-4 rounded-2xl bg-gradient-to-r from-red-950/40 to-slate-900 border border-red-500/30 hover:border-red-500/50 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 flex-shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>주기장 정비입력</span>
              {yardRepairAssets.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold">
                  {yardRepairAssets.length}대 대기{inboundDefectCount > 0 ? ` (결함 ${inboundDefectCount})` : ''}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">입고 결함 장비 수리, 부품 투입 및 임대가능 복원</div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-red-400" />
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

      {/* [법인차량] 주유영수증 등록 카드 */}
      <div
        onClick={() => onNavigate('vehicle_log')}
        className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-500/40 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-md"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
            <Fuel className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>법인차량 주유영수증 촬영</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                전사 공용
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">주유 영수증 촬영 및 등록 ➔ 주유 대장 자동 연동</div>
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
