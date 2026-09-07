// src/mobile/pages/MobileAssetSearch.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Search, RefreshCw, Layers, CheckCircle2, AlertTriangle, 
  XCircle, Clock, MapPin, ChevronRight, X, PhoneCall, Calendar, Wrench
} from 'lucide-react';
import { matchHangul } from '../../utils/hangulSearch';
import { getAssetStatusLabel } from '../../config/asset_status_config';

// 고소작업대 표준 6대 높이 규격 프리셋
interface SpecPreset {
  id: string;
  ft: string;
  subModels: string;
  workHeight: string;
  modelMatchRegex: RegExp;
}

const SPEC_PRESETS: SpecPreset[] = [
  {
    id: '19ft',
    ft: '19ft',
    subModels: '1330 / 3215 / 0608',
    workHeight: '작업높이 ~7.8m',
    modelMatchRegex: /(19|1330|3215|0608|1230)/i,
  },
  {
    id: '26ft',
    ft: '26ft',
    subModels: '0812 / 3219 / 2646',
    workHeight: '작업높이 ~9.8m',
    modelMatchRegex: /(26|0812|3219|2646|0808)/i,
  },
  {
    id: '32ft',
    ft: '32ft',
    subModels: '1012 / 3246',
    workHeight: '작업높이 ~11.8m',
    modelMatchRegex: /(32|1012|3246|1008)/i,
  },
  {
    id: '40ft',
    ft: '40ft',
    subModels: '1212 / 4047',
    workHeight: '작업높이 ~13.8m',
    modelMatchRegex: /(40|1212|4047|4069)/i,
  },
  {
    id: '46ft',
    ft: '46ft',
    subModels: '1412 / 4655',
    workHeight: '작업높이 ~15.8m',
    modelMatchRegex: /(46|1412|4655|1414)/i,
  },
  {
    id: '53ft',
    ft: '53ft',
    subModels: '1612 / 특수',
    workHeight: '작업높이 ~17.8m',
    modelMatchRegex: /(53|1612|1614|5390)/i,
  },
];

interface MobileAssetSearchProps {
  deptMode?: string;
  onNavigateToOrder?: (specFt: string) => void;
}

export const MobileAssetSearch: React.FC<MobileAssetSearchProps> = ({ deptMode, onNavigateToOrder }) => {
  const { assets, contracts, contractAssets, sites, refreshAllData, fullRefreshFromServer, currentTenant } = useApp();

  const defaultYard = currentTenant?.yards?.find((y: any) => y.isDefault) || currentTenant?.yards?.[0];
  const defaultYardName = defaultYard?.name || (currentTenant?.tradeName ? `${currentTenant.tradeName} 주기장` : '본사 주기장');

  // 검색 및 필터 상태
  const [searchTerm, setSearchTerm] = useState('');
  // 자사 보유 자산 전용 집계 (타사 재고 배제)
  const [yardFilter, setYardFilter] = useState<'ALL' | 'MAIN'>('ALL');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(() => new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

  // 특정 규격 선택 시 바텀시트 세부 목록
  const [selectedSpec, setSelectedSpec] = useState<SpecPreset | null>(null);

  // 1. 화면 활성화(Visibility/Focus) 시 0.3초 무조작 자동 최신화
  useEffect(() => {
    const handleSync = async () => {
      if (document.visibilityState === 'visible') {
        setIsSyncing(true);
        if (fullRefreshFromServer) {
          await fullRefreshFromServer();
        } else {
          refreshAllData();
        }
        setLastSyncTime(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        setIsSyncing(false);
      }
    };

    window.addEventListener('visibilitychange', handleSync);
    window.addEventListener('focus', handleSync);

    return () => {
      window.removeEventListener('visibilitychange', handleSync);
      window.removeEventListener('focus', handleSync);
    };
  }, [fullRefreshFromServer, refreshAllData]);

  // 수동 동기화 핸들러
  const handleManualSync = async () => {
    setIsSyncing(true);
    if (fullRefreshFromServer) {
      await fullRefreshFromServer();
    } else {
      refreshAllData();
    }
    setLastSyncTime(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setTimeout(() => setIsSyncing(false), 400);
  };

  // 2. 자사 보유 자산 풀 (타사 임차 장비 ownerType === 'RENTED' 제외)
  const yardFilteredAssets = useMemo(() => {
    return assets.filter(a => {
      // 타사 재고 배제: 자사 소유 자산만 대상
      if (a.ownerType === 'RENTED') return false;
      return true;
    });
  }, [assets]);

  // 3. 오늘 ~ 3일 이내 반납(입고) 예정 장비 매핑
  const upcomingReturns = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const targetLimit = new Date();
    targetLimit.setDate(targetLimit.getDate() + 3);
    const targetLimitStr = targetLimit.toISOString().split('T')[0];

    // 종료일이 오늘~3일 이내인 계약자산 목록 추출
    const returningMap: Record<string, { assetId?: string; expectedModel?: string; endDate: string; siteName: string }> = {};

    contractAssets.forEach(ca => {
      // 🟢 이미 반납 완료된 자산 제외 (허위 반납예정 집계 차단)
      if (ca.status === 'RETURNED' || ca.actualReturnDate) return;

      const contract = contracts.find(c => c.id === ca.contractId);
      const endDate = ca.endDate || contract?.endDate || '';
      if (endDate >= todayStr && endDate <= targetLimitStr) {
        const site = sites.find(s => s.id === contract?.siteId);
        const key = ca.assetId || ca.id;
        returningMap[key] = {
          assetId: ca.assetId,
          expectedModel: ca.expectedModel,
          endDate,
          siteName: site?.name || '현장'
        };
      }
    });

    return returningMap;
  }, [contracts, contractAssets, sites]);

  // 4. 규격(ft)별 가용 재고 집계
  const specStats = useMemo(() => {
    return SPEC_PRESETS.map(preset => {
      // 해당 규격에 매칭되는 자산들
      const matchedAssets = yardFilteredAssets.filter(a => {
        const m = (a.modelName || '').toLowerCase();
        return preset.modelMatchRegex.test(m);
      });

      // 가용(AVAILABLE) 대수
      const availableAssets = matchedAssets.filter(a => a.status === 'AVAILABLE');

      // 대여중(RENTED) 대수
      const rentedAssets = matchedAssets.filter(a => a.status === 'RENTED');

      // 반납 예정 대수
      const returnDueAssets = matchedAssets.filter(a => a.id && upcomingReturns[a.id]);

      return {
        ...preset,
        matchedAssets,
        availableAssets,
        rentedCount: rentedAssets.length,
        returnDueCount: returnDueAssets.length,
        availableCount: availableAssets.length,
      };
    });
  }, [yardFilteredAssets, upcomingReturns]);

  // 전체 가용 대수
  const totalAvailableCount = useMemo(() => {
    return yardFilteredAssets.filter(a => a.status === 'AVAILABLE').length;
  }, [yardFilteredAssets]);

  // 검색어 필터링된 개별 장비 목록 (바텀시트 또는 하단용)
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const q = searchTerm.trim();
    return yardFilteredAssets.filter(a => 
      (a.assetNo || '').toLowerCase().includes(q.toLowerCase()) ||
      matchHangul(a.modelName, q) ||
      (a.serialNo || '').toLowerCase().includes(q.toLowerCase())
    );
  }, [yardFilteredAssets, searchTerm]);

  return (
    <div className="flex flex-col gap-3.5 pb-28 p-4 font-sans selection:bg-blue-500 selection:text-white">
      {/* ── 1. 상단 컨트롤 타워 헤더 ── */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            가용 재고 현황
          </h2>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
            <span>동기화: {lastSyncTime}</span>
            <span>•</span>
            <strong className="text-emerald-400 font-bold">총 {totalAvailableCount}대 출고 가능</strong>
          </div>
        </div>

        {/* 원터치 수동 새로고침 버튼 */}
        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold active:scale-95 transition-all shadow-md"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? '조회중' : '새로고침'}</span>
        </button>
      </div>

      {/* ── 2. 검색창 & 주기장 칩 필터 ── */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="특정 장비번호(K10001) 또는 모델명 검색..."
            className="w-full rounded-2xl py-2.5 pl-10 pr-4 text-xs placeholder-slate-500 focus:outline-none"
            style={{
              backgroundColor: '#090d16',
              color: '#f8fafc',
              border: '1px solid #334155',
              colorScheme: 'dark'
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 주기장 안내 배지 (자사 자산 한정) */}
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            <span>{defaultYardName} (자사 보유 자산)</span>
          </span>
          <span className="text-emerald-400 font-bold">출고가능 {totalAvailableCount}대</span>
        </div>
      </div>

      {/* ── 3. 검색 결과 있을 때 즉시 노출 ── */}
      {searchTerm.trim() && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold text-slate-300 flex items-center justify-between px-1">
            <span>검색 결과 ({searchResults.length}대)</span>
            <button onClick={() => setSearchTerm('')} className="text-[11px] text-sky-400">닫기</button>
          </div>
          {searchResults.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">
              일치하는 장비가 없습니다.
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
              {searchResults.map(a => {
                const score = Number(a.maintenanceScore) || 0;
                return (
                  <div key={a.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-white flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-blue-400">{a.assetNo}</span>
                        <span>{a.modelName}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 whitespace-nowrap ${
                          score === 0
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}>
                          <Wrench className="w-2.5 h-2.5" />
                          <span>정비점수 {score}점</span>
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {defaultYardName}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border flex-shrink-0 ${
                      a.status === 'AVAILABLE'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : a.status === 'REPAIRING'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        : a.status === 'ASSIGNED'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : a.status === 'RENTED_RETURNED' || a.status === 'SOLD'
                        ? 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                        : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    }`}>
                      {getAssetStatusLabel(a.status)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 4. [핵심] 3초 스캔 신호등 가용재고 매트릭스 그리드 ── */}
      <div>
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-xs font-bold text-slate-300">규격별 가용 현황</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {specStats.map(stat => {
            // 가용 상태 색상 테마 계산
            const isAbundant = stat.availableCount >= 4;
            const isWarning = stat.availableCount > 0 && stat.availableCount < 4;
            const isSoldOut = stat.availableCount === 0;

            const themeBorder = isAbundant
              ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 to-slate-900'
              : isWarning
              ? 'border-amber-500/40 bg-gradient-to-br from-amber-950/40 to-slate-900'
              : 'border-slate-800 bg-slate-900/60 opacity-80';

            return (
              <div
                key={stat.id}
                onClick={() => setSelectedSpec(stat)}
                className={`p-3.5 rounded-2xl border ${themeBorder} flex flex-col justify-between gap-3 shadow-lg active:scale-97 transition-all cursor-pointer`}
              >
                {/* 카드 상단: 규격 */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-black text-white tracking-tight flex items-baseline gap-1 whitespace-nowrap">
                      <span>{stat.ft}</span>
                      <span className="text-[10px] font-normal text-slate-400">({stat.subModels})</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                      {stat.workHeight}
                    </div>
                  </div>
                </div>

                {/* 카드 중앙: 가용 대수 강조 (대형 폰트) */}
                <div className="flex items-baseline justify-between pt-1">
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className={`text-2xl font-black ${
                      isAbundant ? 'text-emerald-400' : isWarning ? 'text-amber-400' : 'text-slate-500'
                    }`}>
                      {stat.availableCount}
                    </span>
                    <span className="text-xs text-slate-300 font-bold whitespace-nowrap">대 가용</span>
                  </div>

                  {/* 입고/반납 예정 표시 */}
                  {stat.returnDueCount > 0 ? (
                    <span className="text-[10.5px] font-bold text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded-md border border-sky-800/80 whitespace-nowrap">
                      반납+{stat.returnDueCount}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">대여 {stat.rentedCount}대</span>
                  )}
                </div>

                {/* 카드 하단: 보유 및 대여 현황 요약 */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] whitespace-nowrap">
                  <span className="text-slate-400 whitespace-nowrap">총 보유</span>
                  <span className="font-bold text-slate-200 whitespace-nowrap">{stat.matchedAssets.length}대</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 5. 선택된 규격 세부 장비 바텀시트 모달 ── */}
      {selectedSpec && (() => {
        const specStat = specStats.find(s => s.id === selectedSpec.id);
        const availList = specStat?.availableAssets || [];
        const returningKeys = Object.keys(upcomingReturns);

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 border-t border-slate-700 rounded-t-3xl p-5 max-w-lg w-full max-h-[82vh] flex flex-col gap-4 shadow-2xl overflow-hidden">
              {/* 바텀시트 헤더 */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-white">{selectedSpec.ft} 상세 재고</h3>
                    <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 text-xs font-bold">
                      가용 {availList.length}대
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {selectedSpec.workHeight} ({selectedSpec.subModels})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSpec(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 스크롤 가능한 본문 */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
                {/* 1) 즉시 출고 가능 장비 섹션 */}
                <div>
                  <h4 className="text-xs font-bold text-emerald-400 mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    즉시 출고 가능 장비 ({availList.length}대)
                  </h4>
                  {availList.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-500">
                      현재 해당 규격의 임대 가능 자산이 없습니다. (타사 임차 검토 필요)
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {availList.map(asset => {
                        const score = Number(asset.maintenanceScore) || 0;
                        return (
                          <div
                            key={asset.id}
                            className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 font-mono font-bold text-xs">
                                  {asset.assetNo}
                                </span>
                                <span className="text-xs font-bold text-white">
                                  {asset.modelName}
                                </span>
                                {/* 🌟 정비점수 뱃지 */}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 whitespace-nowrap ${
                                  score === 0
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                }`}>
                                  <Wrench className="w-2.5 h-2.5" />
                                  <span>정비 {score}점{score === 0 ? ' (최상)' : ''}</span>
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                                <span>위치: <strong className="text-slate-300">{defaultYardName}</strong></span>
                                <span>•</span>
                                <span>상태: <strong className="text-emerald-400">출고검수 합격</strong></span>
                              </div>
                            </div>

                            <div className="text-right flex-shrink-0">
                              <div className="text-xs font-bold text-slate-200 font-mono">
                                {asset.serialNo || '자사보유'}
                              </div>
                              <div className="text-[10px] text-slate-500">{asset.manufacturer || '자사자산'}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2) 3일 이내 반납(입고) 예정 장비 섹션 */}
                {specStat && specStat.returnDueCount > 0 && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <h4 className="text-xs font-bold text-sky-400 mb-2 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      3일 이내 반납(입고) 예정 장비 ({specStat.returnDueCount}대)
                    </h4>
                    <div className="flex flex-col gap-2">
                      {specStat.matchedAssets
                        .filter(a => a.id && upcomingReturns[a.id])
                        .map(asset => {
                          const retInfo = upcomingReturns[asset.id];
                          const score = Number(asset.maintenanceScore) || 0;
                          return (
                            <div
                              key={asset.id}
                              className="p-2.5 rounded-xl bg-slate-950/40 border border-sky-900/40 flex items-center justify-between text-xs"
                            >
                              <div>
                                <div className="font-bold text-slate-200 flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono text-sky-400">{asset.assetNo}</span>
                                  <span>{asset.modelName}</span>
                                  <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold border whitespace-nowrap ${
                                    score === 0 
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                  }`}>
                                    정비 {score}점
                                  </span>
                                </div>
                                <div className="text-[10.5px] text-slate-400 mt-0.5">
                                  현장: {retInfo.siteName}
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded-lg bg-sky-500/20 text-sky-300 text-[11px] font-bold border border-sky-500/30 flex-shrink-0">
                                {retInfo.endDate} 입고예정
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* 바텀시트 하단 액션 버튼군 (헌장 2.1 영업부 전용 발주의뢰 R&R 격리) */}
              <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
                {(deptMode === 'SALES' || !deptMode) && onNavigateToOrder && (
                  <button
                    type="button"
                    onClick={() => {
                      const ft = selectedSpec.ft;
                      setSelectedSpec(null);
                      onNavigateToOrder(ft);
                    }}
                    className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs active:scale-98 transition-all shadow-lg flex items-center justify-center gap-1.5"
                  >
                    <span>{selectedSpec.ft} 출고 의뢰서 작성</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedSpec(null)}
                  className={`${(deptMode === 'SALES' || !deptMode) && onNavigateToOrder ? 'w-24' : 'w-full'} py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs active:scale-98 transition-all`}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
