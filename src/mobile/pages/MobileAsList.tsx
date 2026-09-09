// src/mobile/pages/MobileAsList.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Search, Plus, Wrench, MapPin, User, Phone, Package, AlertTriangle, Clock, Image as ImageIcon, ChevronRight } from 'lucide-react';
import { safePhoneCall, resolveSiteDetailedAddress } from '../../utils/nativeLauncher';
import { Asset, Repair, InboundDefectDetail } from '../../services/db';
import { MobileYardRepairModal } from '../components/MobileYardRepairModal';

interface MobileAsListProps {
  onSelectTicket: (ticketId: string) => void;
  onOpenCreate: () => void;
  initialMode?: 'FIELD_AS' | 'YARD_REPAIR';
}

export const MobileAsList: React.FC<MobileAsListProps> = ({
  onSelectTicket,
  onOpenCreate,
  initialMode = 'FIELD_AS',
}) => {
  const { fieldAsTickets, repairs, assets, sites, customers, contracts, contractAssets, refreshAllData } = useApp();
  
  // ── 상단 탭 모드: 'FIELD_AS' (현장 출동) vs 'YARD_REPAIR' (주기장 정비) ──
  const [activeMode, setActiveMode] = useState<'FIELD_AS' | 'YARD_REPAIR'>(initialMode);

  // 공통 검색어
  const [searchTerm, setSearchTerm] = useState('');

  // 현장 AS 상태 필터
  const [fieldStatusFilter, setFieldStatusFilter] = useState<'ALL' | 'UNRESOLVED' | 'COMPLETED'>('UNRESOLVED');

  // 주기장 정비 상태 필터: 'ALL' | 'INBOUND_DEFECT' | 'REPAIRING' | 'UNRESOLVED'
  const [yardFilter, setYardFilter] = useState<'ALL' | 'INBOUND_DEFECT' | 'REPAIRING' | 'UNRESOLVED'>('ALL');

  // 주기장 정비 모달 상태
  const [selectedYardAsset, setSelectedYardAsset] = useState<Asset | null>(null);
  const [selectedYardRepair, setSelectedYardRepair] = useState<Repair | null>(null);
  const [isYardModalOpen, setIsYardModalOpen] = useState(false);

  // 1. 주기장 정비 대상 자산 집계
  const yardAssets = useMemo(() => {
    return (assets || []).filter(a => {
      if (a.status === 'RENTED' || a.status === 'SOLD' || a.status === 'ASSIGNED') return false;
      const hasInboundDefect = (repairs || []).some(r => r.assetId === a.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');
      const isRepairing = a.status === 'REPAIRING';
      const isReturned = a.status === 'RENTED_RETURNED';
      const isUnresolved = (repairs || []).some(r => r.assetId === a.id && r.status === 'UNRESOLVED');
      return hasInboundDefect || isRepairing || isReturned || isUnresolved;
    });
  }, [assets, repairs]);

  // 입고 결함 자산 건수
  const inboundDefectCount = useMemo(() => {
    return (assets || []).filter(a => 
      (repairs || []).some(r => r.assetId === a.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION')
    ).length;
  }, [assets, repairs]);

  // 주기장 필터링된 자산 목록
  const filteredYardAssets = useMemo(() => {
    return yardAssets.filter(asset => {
      const pendingInbound = (repairs || []).find(r => r.assetId === asset.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');
      const unresolvedRepair = (repairs || []).find(r => r.assetId === asset.id && r.status === 'UNRESOLVED');

      if (yardFilter === 'INBOUND_DEFECT' && !pendingInbound) return false;
      if (yardFilter === 'REPAIRING' && asset.status !== 'REPAIRING') return false;
      if (yardFilter === 'UNRESOLVED' && !unresolvedRepair) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchAsset = (asset.assetNo || '').toLowerCase().includes(q);
        const matchModel = (asset.modelName || '').toLowerCase().includes(q);
        const matchMemo = (asset.memo || '').toLowerCase().includes(q);
        const matchInbound = pendingInbound?.inboundNo ? pendingInbound.inboundNo.toLowerCase().includes(q) : false;
        const matchDetails = pendingInbound?.details ? pendingInbound.details.toLowerCase().includes(q) : false;
        if (!matchAsset && !matchModel && !matchMemo && !matchInbound && !matchDetails) return false;
      }

      return true;
    });
  }, [yardAssets, yardFilter, searchTerm, repairs]);

  // 현장 AS 필터링된 티켓 목록
  const filteredFieldTickets = useMemo(() => {
    return fieldAsTickets.filter((ticket) => {
      if (fieldStatusFilter === 'UNRESOLVED') {
        if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELED') return false;
      } else if (fieldStatusFilter === 'COMPLETED') {
        if (ticket.status !== 'COMPLETED') return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchAsset = (ticket.assetNo || '').toLowerCase().includes(q);
        const matchCustomer = (ticket.customerName || '').toLowerCase().includes(q);
        const matchSite = (ticket.siteName || '').toLowerCase().includes(q);
        const matchIssue = (ticket.issueDescription || '').toLowerCase().includes(q);
        const matchMechanic = (ticket.mechanicName || '').toLowerCase().includes(q);
        const matchAddress = (ticket.siteAddress || '').toLowerCase().includes(q);
        const matchReporter = (ticket.reporterName || '').toLowerCase().includes(q);
        if (!matchAsset && !matchCustomer && !matchSite && !matchIssue && !matchMechanic && !matchAddress && !matchReporter) return false;
      }

      return true;
    });
  }, [fieldAsTickets, fieldStatusFilter, searchTerm]);

  // 주기장 정비 모달 열기 핸들러
  const handleOpenYardRepair = (asset: Asset) => {
    const pendingInbound = (repairs || []).find(r => r.assetId === asset.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');
    const unresolvedRepair = (repairs || []).find(r => r.assetId === asset.id && r.status === 'UNRESOLVED');
    const generalPending = (repairs || []).find(r => r.assetId === asset.id && (r.status === 'PENDING' || r.status === 'IN_PROGRESS'));

    setSelectedYardAsset(asset);
    setSelectedYardRepair(pendingInbound || unresolvedRepair || generalPending || null);
    setIsYardModalOpen(true);
  };

  const handleYardRepairCompleted = () => {
    setIsYardModalOpen(false);
    setSelectedYardAsset(null);
    setSelectedYardRepair(null);
    refreshAllData();
  };

  return (
    <div className="flex flex-col gap-3 pb-24 p-4 font-sans text-slate-100">
      {/* ── 상단 2대 탭 전환: [현장 AS 출동] vs [주기장 입고정비] ── */}
      <div className="flex items-center p-1 rounded-2xl bg-slate-900 border border-slate-800 gap-1 shadow-md">
        <button
          type="button"
          onClick={() => {
            setActiveMode('FIELD_AS');
            setSearchTerm('');
          }}
          className={`flex-1 py-2.5 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
            activeMode === 'FIELD_AS'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Wrench className="w-4 h-4" />
          <span>현장 AS 출동 ({fieldAsTickets.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveMode('YARD_REPAIR');
            setSearchTerm('');
          }}
          className={`flex-1 py-2.5 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
            activeMode === 'YARD_REPAIR'
              ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>주기장 입고정비 ({yardAssets.length})</span>
          {inboundDefectCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white text-red-600 font-black">
              {inboundDefectCount}
            </span>
          )}
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 1. 현장 AS 출동 모드 뷰                                      */}
      {/* ──────────────────────────────────────────────────────────── */}
      {activeMode === 'FIELD_AS' ? (
        <>
          {/* 상단 타이틀 & 등록 버튼 */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Wrench className="w-4 h-4 text-blue-400" />
              현장 AS 티켓 ({filteredFieldTickets.length})
            </h2>
            <button
              onClick={onOpenCreate}
              className="flex items-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 active:scale-95 transition-transform"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              신규 접수
            </button>
          </div>

          {/* 검색창 */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="장비번호, 고객사, 현장명, 고장증상 검색..."
              className="w-full rounded-2xl py-3 pl-10 pr-4 text-xs placeholder-slate-500 focus:outline-none border"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                borderColor: '#334155',
                colorScheme: 'dark'
              }}
            />
          </div>

          {/* 상태 필터 탭 */}
          <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setFieldStatusFilter('UNRESOLVED')}
              className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                fieldStatusFilter === 'UNRESOLVED'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              미완료 (출동/대기)
            </button>
            <button
              onClick={() => setFieldStatusFilter('ALL')}
              className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                fieldStatusFilter === 'ALL'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              전체 보기
            </button>
            <button
              onClick={() => setFieldStatusFilter('COMPLETED')}
              className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                fieldStatusFilter === 'COMPLETED'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              조치 완료
            </button>
          </div>

          {/* 티켓 카드 피드 */}
          <div className="flex flex-col gap-2.5">
            {filteredFieldTickets.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm bg-slate-900/50 rounded-2xl border border-slate-800">
                해당 조건의 AS 티켓이 없습니다.
              </div>
            ) : (
              filteredFieldTickets.map((ticket) => {
                const resolvedAddress = resolveSiteDetailedAddress({
                  siteAddress: ticket.siteAddress,
                  siteId: ticket.siteId,
                  siteName: ticket.siteName,
                  contractId: ticket.contractId,
                  assetNo: ticket.assetNo,
                  assetId: ticket.assetId,
                  customerName: ticket.customerName,
                  locationDetail: ticket.locationDetail,
                  customerSites: sites || [],
                  contracts: contracts || [],
                  contractAssets: contractAssets || [],
                  customers: customers || [],
                });

                const matchedSite = (sites || []).find(
                  (s) => s.id === ticket.siteId || (ticket.siteName && s.name === ticket.siteName)
                );
                const contactName = ticket.reporterName?.trim() || matchedSite?.contactName?.trim() || '';
                const contactPhone = ticket.reporterContact?.trim() || matchedSite?.contact?.trim() || '';

                return (
                  <div
                    key={ticket.id}
                    onClick={() => onSelectTicket(ticket.id)}
                    className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 active:scale-98 transition-all cursor-pointer flex flex-col gap-2.5 shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-black font-mono border border-blue-500/30">
                          {ticket.assetNo || '장비번호미상'}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">
                          {ticket.modelName || ''}
                        </span>
                      </div>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                          ticket.status === 'COMPLETED'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : ticket.status === 'REVISIT'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            : ticket.status === 'SCHEDULED'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-slate-700 text-slate-300 border-slate-600'
                        }`}
                      >
                        {ticket.status === 'COMPLETED'
                          ? '조치완료'
                          : ticket.status === 'REVISIT'
                          ? '재방문'
                          : ticket.status === 'SCHEDULED'
                          ? '방문예정'
                          : '접수대기'}
                      </span>
                    </div>

                    <div className="text-sm font-black text-white">
                      {ticket.customerName || '고객사'} {ticket.siteName ? `· ${ticket.siteName}` : ''}
                    </div>

                    <div className="flex items-start gap-1.5 text-xs text-slate-300 bg-slate-950/40 p-2 rounded-xl border border-slate-800/60">
                      <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                      <span className="leading-snug">
                        {resolvedAddress || '현장 주소 미등록'}
                        {ticket.locationDetail ? (
                          <span className="text-amber-300 ml-1.5 font-bold">[{ticket.locationDetail}]</span>
                        ) : null}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-950/40 p-2 rounded-xl border border-slate-800/60">
                      <div className="flex items-center gap-1.5 truncate">
                        <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="font-bold text-white truncate">
                          {contactName || '현장 담당자 미지정'}
                        </span>
                        {contactPhone && (
                          <span className="text-slate-400 font-mono text-[11px] truncate">
                            ({contactPhone})
                          </span>
                        )}
                      </div>
                      {contactPhone && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            safePhoneCall(contactPhone);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-black flex items-center gap-1 shrink-0 active:scale-95 transition-all shadow-sm"
                        >
                          <Phone className="w-3 h-3 text-emerald-400" />
                          <span>통화</span>
                        </button>
                      )}
                    </div>

                    <div className="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                      <span className="text-slate-500 font-bold mr-1">고장:</span>
                      {ticket.issueDescription || ticket.issueCategory || '고장 점검 요청'}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60 font-mono">
                      <span>접수: {ticket.requestDate || ''}</span>
                      <span>기사: {ticket.mechanicName || '미배정'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* ──────────────────────────────────────────────────────────── */
        /* 2. 주기장 입고정비 모드 뷰 (새로 신설된 핵심 스튜디오)      */
        /* ──────────────────────────────────────────────────────────── */
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-red-400" />
              주기장 정비 대상 ({filteredYardAssets.length}대)
            </h2>
            <span className="text-xs text-slate-400 font-bold">
              입고결함 <span className="text-red-400">{inboundDefectCount}대</span>
            </span>
          </div>

          {/* 검색창 */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="자산번호, 모델명, 입고번호 검색..."
              className="w-full rounded-2xl py-3 pl-10 pr-4 text-xs placeholder-slate-500 focus:outline-none border"
              style={{
                backgroundColor: '#090d16',
                color: '#f8fafc',
                borderColor: '#334155',
                colorScheme: 'dark'
              }}
            />
          </div>

          {/* 필터 칩 */}
          <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setYardFilter('ALL')}
              className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                yardFilter === 'ALL'
                  ? 'bg-red-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              전체 ({yardAssets.length})
            </button>
            <button
              onClick={() => setYardFilter('INBOUND_DEFECT')}
              className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                yardFilter === 'INBOUND_DEFECT'
                  ? 'bg-red-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              입고불량 ({inboundDefectCount})
            </button>
            <button
              onClick={() => setYardFilter('REPAIRING')}
              className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                yardFilter === 'REPAIRING'
                  ? 'bg-red-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              정비중
            </button>
            <button
              onClick={() => setYardFilter('UNRESOLVED')}
              className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                yardFilter === 'UNRESOLVED'
                  ? 'bg-red-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              소모품대기
            </button>
          </div>

          {/* 주기장 정비 대상 자산 카드 피드 */}
          <div className="flex flex-col gap-2.5">
            {filteredYardAssets.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm bg-slate-900/50 rounded-2xl border border-slate-800">
                정비가 필요한 주기장 자산이 없습니다.
              </div>
            ) : (
              filteredYardAssets.map((asset) => {
                const pendingInbound = (repairs || []).find(r => r.assetId === asset.id && r.status === 'PENDING' && r.source === 'INBOUND_INSPECTION');
                const unresolvedRepair = (repairs || []).find(r => r.assetId === asset.id && r.status === 'UNRESOLVED');

                let defectList: InboundDefectDetail[] = [];
                if (pendingInbound?.defectsJson) {
                  try {
                    const parsed = JSON.parse(pendingInbound.defectsJson);
                    if (Array.isArray(parsed)) defectList = parsed;
                  } catch (e) {}
                }

                return (
                  <div
                    key={asset.id}
                    onClick={() => handleOpenYardRepair(asset)}
                    className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-red-500/50 active:scale-98 transition-all cursor-pointer flex flex-col gap-2.5 shadow-md"
                  >
                    {/* 상단 장비 및 상태 뱃지 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-black font-mono border border-red-500/30">
                          {asset.assetNo}
                        </span>
                        <span className="text-xs text-white font-bold">{asset.modelName}</span>
                        <span className="text-[10px] text-slate-400">
                          {asset.ownerType === 'RENTED' ? '타사임차' : '자사보유'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {pendingInbound ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                            🚨 입고불량
                          </span>
                        ) : unresolvedRepair ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            ⏸️ 소모품대기
                          </span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-300 border border-slate-700">
                            {asset.status === 'REPAIRING' ? '정비중' : '입고검수'}
                          </span>
                        )}

                        {(asset.maintenanceScore || 0) > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-mono font-black bg-red-900/60 text-red-200 border border-red-700">
                            +{asset.maintenanceScore}점
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 입고 결함 항목 배지들 */}
                    {defectList.length > 0 && (
                      <div className="p-2.5 rounded-xl bg-red-950/20 border border-red-500/20 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] text-red-300 font-bold">
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                            적발 결함 ({defectList.length}건)
                          </span>
                          {pendingInbound?.inboundNo && (
                            <span className="font-mono text-[10px] text-slate-400">{pendingInbound.inboundNo}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {defectList.map((d, idx) => (
                            <span key={idx} className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-red-500/30 text-white">
                              {d.checkitemName} <strong className="text-red-400">+{d.score}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 부품 대기 사유 노출 */}
                    {unresolvedRepair?.unresolvedReason && (
                      <div className="text-xs text-amber-300 bg-amber-950/30 p-2 rounded-xl border border-amber-500/30 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>보류사유: {unresolvedRepair.unresolvedReason}</span>
                      </div>
                    )}

                    {/* 하단 터치 가이드 바 */}
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                      <span>최근 메모: {asset.memo || '이상 없음'}</span>
                      <span className="text-red-400 font-bold flex items-center gap-0.5">
                        정비 스튜디오 열기 <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* 🛠️ 모바일 주기장 정비 전용 모달 */}
      <MobileYardRepairModal
        isOpen={isYardModalOpen}
        asset={selectedYardAsset}
        pendingRepair={selectedYardRepair}
        onClose={() => setIsYardModalOpen(false)}
        onCompleted={handleYardRepairCompleted}
      />
    </div>
  );
};
