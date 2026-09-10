// src/mobile/pages/MobileYardConsumableStock.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  ArrowLeft, Search, RefreshCw, Boxes, AlertTriangle, 
  CheckCircle2, Package, Filter, ChevronRight, X, Clock, 
  Layers, Truck, Wrench, ShieldAlert, Sparkles, Building2
} from 'lucide-react';
import { matchHangul } from '../../utils/hangulSearch';
import { Consumable, MechanicConsumableStock, ConsumableLog } from '../../services/db';

interface MobileYardConsumableStockProps {
  onBack: () => void;
}

export const MobileYardConsumableStock: React.FC<MobileYardConsumableStockProps> = ({ onBack }) => {
  const { 
    consumables, 
    mechanicConsumableStocks, 
    consumableLogs, 
    users, 
    refreshAllData, 
    fullRefreshFromServer,
    currentTenant 
  } = useApp();

  const defaultYardName = currentTenant?.yards?.find((y: any) => y.isDefault)?.name || 
    (currentTenant?.tradeName ? `${currentTenant.tradeName} 주기장` : '본사 주기장');

  // 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stockStatusFilter, setStockStatusFilter] = useState<'ALL' | 'IN_STOCK' | 'OUT_OF_STOCK'>('ALL');
  const [selectedConsumable, setSelectedConsumable] = useState<Consumable | null>(null);

  // 실시간 동기화 상태
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(() => 
    new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  // 화면 활성화(Visibility/Focus) 시 0.3초 자동 최신화
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

  // 기사별 소모품 차량 적재 현황 매핑
  const vehicleStocksByConsumable = useMemo(() => {
    const map = new Map<string, { totalVehicleQty: number; mechanics: { mechanicId: string; name: string; qty: number }[] }>();

    (mechanicConsumableStocks || []).forEach(ms => {
      if (ms.stockQty <= 0) return;
      const current = map.get(ms.consumableId) || { totalVehicleQty: 0, mechanics: [] };
      const mechUser = (users || []).find(u => u.id === ms.mechanicId);
      current.totalVehicleQty += ms.stockQty;
      current.mechanics.push({
        mechanicId: ms.mechanicId,
        name: mechUser?.name || '정비사',
        qty: ms.stockQty
      });
      map.set(ms.consumableId, current);
    });

    return map;
  }, [mechanicConsumableStocks, users]);

  // 카테고리 목록 동적 추출
  const categories = useMemo(() => {
    const set = new Set<string>();
    (consumables || []).forEach(c => {
      if (c.category?.trim()) set.add(c.category.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [consumables]);

  // 필터링된 소모품 목록
  const filteredConsumables = useMemo(() => {
    return (consumables || []).filter(c => {
      // 1. 카테고리 필터
      if (selectedCategory !== 'ALL' && c.category !== selectedCategory) {
        return false;
      }

      // 2. 재고 상태 필터
      const yardQty = c.stockQty || 0;
      if (stockStatusFilter === 'IN_STOCK' && yardQty <= 0) return false;
      if (stockStatusFilter === 'OUT_OF_STOCK' && yardQty > 0) return false;

      // 3. 검색어 필터 (초성 검색 지원)
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const name = (c.modelName || '').toLowerCase();
        const supplier = (c.supplier || '').toLowerCase();
        const cat = (c.category || '').toLowerCase();

        const matchName = name.includes(q) || matchHangul(c.modelName || '', searchQuery);
        const matchSupp = supplier.includes(q) || matchHangul(c.supplier || '', searchQuery);
        const matchCat = cat.includes(q) || matchHangul(c.category || '', searchQuery);

        if (!matchName && !matchSupp && !matchCat) return false;
      }

      return true;
    }).sort((a, b) => {
      // 주기장 재고 많은 순, 재고 같으면 품목명 순
      const aQty = a.stockQty || 0;
      const bQty = b.stockQty || 0;
      if (aQty !== bQty) return bQty - aQty;
      return (a.modelName || '').localeCompare(b.modelName || '', 'ko');
    });
  }, [consumables, selectedCategory, stockStatusFilter, searchQuery]);

  // 통계 요약 지표
  const summary = useMemo(() => {
    let inStockKinds = 0;
    let outOfStockKinds = 0;
    let totalYardQty = 0;
    let totalVehicleQty = 0;

    (consumables || []).forEach(c => {
      const q = c.stockQty || 0;
      if (q > 0) inStockKinds += 1;
      else outOfStockKinds += 1;
      totalYardQty += q;

      const vInfo = vehicleStocksByConsumable.get(c.id);
      if (vInfo) totalVehicleQty += vInfo.totalVehicleQty;
    });

    return {
      totalKinds: (consumables || []).length,
      inStockKinds,
      outOfStockKinds,
      totalYardQty,
      totalVehicleQty
    };
  }, [consumables, vehicleStocksByConsumable]);

  // 선택된 소모품의 최근 수불 이력 (최근 5건)
  const selectedLogs = useMemo(() => {
    if (!selectedConsumable) return [];
    return (consumableLogs || [])
      .filter(l => l.consumableId === selectedConsumable.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 5);
  }, [consumableLogs, selectedConsumable]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans pb-28">
      {/* 1. 상단 네비게이션 헤더 */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 active:scale-95 transition-all border border-slate-700/60"
            aria-label="뒤로가기"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-1.5">
              <Boxes className="w-5 h-5 text-amber-400" />
              <h1 className="text-lg font-black text-white tracking-tight">주기장 소모품 재고</h1>
            </div>
            <p className="text-[11px] text-slate-400">{defaultYardName} 부속품 및 소모품 가용 수량</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 active:scale-95 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="font-mono text-[11px]">{lastSyncTime}</span>
        </button>
      </header>

      {/* 2. 상단 요약 통계 카드 */}
      <div className="p-4 flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-2">
          {/* 총 품목 */}
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-bold text-slate-400">총 품목</span>
            <span className="text-lg font-black text-white font-mono mt-1">
              {summary.totalKinds}<span className="text-xs font-normal text-slate-400 ml-0.5">종</span>
            </span>
          </div>

          {/* 보유 품목 */}
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-emerald-500/30 flex flex-col justify-between">
            <span className="text-[11px] font-bold text-emerald-400">보유 품목</span>
            <span className="text-lg font-black text-emerald-400 font-mono mt-1">
              {summary.inStockKinds}<span className="text-xs font-normal text-slate-400 ml-0.5">종</span>
            </span>
          </div>

          {/* 품절/부족 */}
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-red-500/30 flex flex-col justify-between">
            <span className="text-[11px] font-bold text-red-400">품절/부족</span>
            <span className="text-lg font-black text-red-400 font-mono mt-1">
              {summary.outOfStockKinds}<span className="text-xs font-normal text-slate-400 ml-0.5">종</span>
            </span>
          </div>

          {/* 주기장 총재고 */}
          <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-950/40 to-slate-900 border border-amber-500/40 flex flex-col justify-between">
            <span className="text-[11px] font-bold text-amber-300">주기장 총수량</span>
            <span className="text-lg font-black text-amber-300 font-mono mt-1">
              {summary.totalYardQty}<span className="text-xs font-normal text-slate-400 ml-0.5">개</span>
            </span>
          </div>
        </div>

        {/* 3. 검색창 */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="소모품명, 공급처, 분류 초성 검색 (예: ㅊㅈㄱ, ㅂㅌㄹ)"
            className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-700/80 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 4. 필터 칩 바 */}
        <div className="flex flex-col gap-2">
          {/* 재고 상태 칩 */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
            <button
              type="button"
              onClick={() => setStockStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all flex-shrink-0 ${
                stockStatusFilter === 'ALL'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              전체 ({summary.totalKinds})
            </button>
            <button
              type="button"
              onClick={() => setStockStatusFilter('IN_STOCK')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all flex-shrink-0 ${
                stockStatusFilter === 'IN_STOCK'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              재고 보유 ({summary.inStockKinds})
            </button>
            <button
              type="button"
              onClick={() => setStockStatusFilter('OUT_OF_STOCK')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all flex-shrink-0 ${
                stockStatusFilter === 'OUT_OF_STOCK'
                  ? 'bg-red-500 text-white shadow-md shadow-red-500/20'
                  : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              품절/부족 ({summary.outOfStockKinds})
            </button>
          </div>

          {/* 카테고리 칩 (동적) */}
          {categories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
              <button
                type="button"
                onClick={() => setSelectedCategory('ALL')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all flex-shrink-0 ${
                  selectedCategory === 'ALL'
                    ? 'bg-slate-700 text-white font-bold'
                    : 'bg-slate-900 text-slate-500 border border-slate-800'
                }`}
              >
                전체 분류
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all flex-shrink-0 ${
                    selectedCategory === cat
                      ? 'bg-amber-600 text-white font-bold'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 5. 소모품 목록 리스트 */}
        <div className="flex flex-col gap-2.5 mt-1">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>검색 결과: <strong className="text-amber-400">{filteredConsumables.length}</strong>건</span>
            <span className="text-[11px] text-slate-500">터치 시 상세 및 분산현황</span>
          </div>

          {filteredConsumables.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col items-center justify-center gap-2">
              <Boxes className="w-10 h-10 text-slate-600 stroke-[1.5]" />
              <p className="text-sm font-bold text-slate-400">조건에 일치하는 소모품이 없습니다.</p>
              <p className="text-xs text-slate-500">검색어 또는 필터 조건을 다시 확인하세요.</p>
            </div>
          ) : (
            filteredConsumables.map(c => {
              const yardQty = c.stockQty || 0;
              const isOutOfStock = yardQty <= 0;
              const vInfo = vehicleStocksByConsumable.get(c.id);
              const vehicleQty = vInfo?.totalVehicleQty || 0;
              const unit = c.unit || '개';

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedConsumable(c)}
                  className={`p-3.5 rounded-2xl border transition-all active:scale-98 cursor-pointer shadow-sm flex flex-col gap-2 ${
                    isOutOfStock
                      ? 'bg-slate-900/50 border-red-900/40 hover:border-red-500/40'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* 상단: 품목명 & 주기장 수량 */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {c.category && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold border border-slate-700 flex-shrink-0">
                            {c.category}
                          </span>
                        )}
                        <h3 className="text-sm font-bold text-white truncate leading-tight">
                          {c.modelName}
                        </h3>
                      </div>
                      {c.supplier && (
                        <p className="text-[11px] text-slate-400 mt-1 truncate">
                          공급처: {c.supplier}
                        </p>
                      )}
                    </div>

                    {/* 주기장 보유 수량 배지 */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-[10px] font-semibold text-slate-400">주기장 재고</div>
                      <div className={`text-base font-black font-mono leading-tight ${
                        isOutOfStock ? 'text-red-400' : 'text-emerald-400'
                      }`}>
                        {isOutOfStock ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full font-bold">
                            품절 (0{unit})
                          </span>
                        ) : (
                          <span>{yardQty}<span className="text-xs font-normal text-slate-400 ml-0.5">{unit}</span></span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 하단: 보조 지표 바 (차량 적재, 수리중, 단가) */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                    <div className="flex items-center gap-2">
                      {vehicleQty > 0 ? (
                        <span className="flex items-center gap-1 text-blue-400 font-medium">
                          <Truck className="w-3 h-3" />
                          차량분산 {vehicleQty}{unit}
                        </span>
                      ) : (
                        <span className="text-slate-500">차량적재 없음</span>
                      )}

                      {(c.repairingQty || 0) > 0 && (
                        <span className="flex items-center gap-1 text-amber-400 font-medium">
                          <Wrench className="w-3 h-3" />
                          수리중 {c.repairingQty}{unit}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-slate-300 font-mono">
                      {c.unitPrice > 0 ? (
                        <span>₩{c.unitPrice.toLocaleString()}</span>
                      ) : (
                        <span className="text-slate-500">단가미등록</span>
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 6. 상세 바텀시트 모달 */}
      {selectedConsumable && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center animate-fadeIn"
          onClick={() => setSelectedConsumable(null)}
        >
          <div 
            className="w-full max-w-lg bg-slate-900 border-t border-slate-700 rounded-t-3xl p-5 flex flex-col gap-4 max-h-[85vh] overflow-y-auto shadow-2xl animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 드래그 핸들 */}
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto -mt-1 mb-1" />

            {/* 헤더 */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {selectedConsumable.category && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                      {selectedConsumable.category}
                    </span>
                  )}
                  <h2 className="text-lg font-black text-white">{selectedConsumable.modelName}</h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  공급처: {selectedConsumable.supplier || '미기재'} | 규격단위: {selectedConsumable.unit || '개'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedConsumable(null)}
                className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 재고 현황 카드 3단 */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-center">
                <div className="text-[11px] font-bold text-slate-400">주기장 재고</div>
                <div className={`text-xl font-black font-mono mt-1 ${
                  (selectedConsumable.stockQty || 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {selectedConsumable.stockQty || 0}
                  <span className="text-xs font-normal text-slate-400 ml-0.5">{selectedConsumable.unit || '개'}</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-center">
                <div className="text-[11px] font-bold text-slate-400">차량 적재 합계</div>
                <div className="text-xl font-black text-blue-400 font-mono mt-1">
                  {vehicleStocksByConsumable.get(selectedConsumable.id)?.totalVehicleQty || 0}
                  <span className="text-xs font-normal text-slate-400 ml-0.5">{selectedConsumable.unit || '개'}</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-center">
                <div className="text-[11px] font-bold text-slate-400">수리중 수량</div>
                <div className="text-xl font-black text-amber-400 font-mono mt-1">
                  {selectedConsumable.repairingQty || 0}
                  <span className="text-xs font-normal text-slate-400 ml-0.5">{selectedConsumable.unit || '개'}</span>
                </div>
              </div>
            </div>

            {/* 비고 메모 */}
            {selectedConsumable.note && (
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300">
                <span className="font-bold text-slate-400 block mb-0.5">특이사항/비고:</span>
                {selectedConsumable.note}
              </div>
            )}

            {/* 기사 차량별 적재 현황 */}
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-blue-400" />
                기사 차량별 분산 적재 현황
              </h4>
              {(() => {
                const vInfo = vehicleStocksByConsumable.get(selectedConsumable.id);
                if (!vInfo || vInfo.mechanics.length === 0) {
                  return (
                    <div className="p-3 rounded-xl bg-slate-800/40 text-center text-xs text-slate-500">
                      정비 차량에 적재된 수량이 없습니다.
                    </div>
                  );
                }
                return (
                  <div className="flex flex-col gap-1.5">
                    {vInfo.mechanics.map(m => (
                      <div key={m.mechanicId} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-xs">
                        <span className="font-medium text-white">{m.name} 차량</span>
                        <span className="font-mono font-bold text-blue-400">{m.qty}{selectedConsumable.unit || '개'} 적재</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* 최근 입출고 수불 내역 */}
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                최근 입출고 수불 내역 (최근 5건)
              </h4>
              {selectedLogs.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-800/40 text-center text-xs text-slate-500">
                  수불 기록이 없습니다.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {selectedLogs.map(l => {
                    const isPlus = l.type === 'INBOUND' || l.type === 'RETURN_TO_HQ';
                    return (
                      <div key={l.id} className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between text-xs">
                        <div className="flex flex-col">
                          <span className="text-[11px] text-slate-400">
                            {l.actionDate || l.createdAt?.split('T')[0] || '-'} | {l.description || l.type}
                          </span>
                        </div>
                        <span className={`font-mono font-bold ${isPlus ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {isPlus ? '+' : '-'}{l.quantity}{selectedConsumable.unit || '개'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 닫기 버튼 */}
            <button
              type="button"
              onClick={() => setSelectedConsumable(null)}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm mt-2 transition-all border border-slate-700"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
