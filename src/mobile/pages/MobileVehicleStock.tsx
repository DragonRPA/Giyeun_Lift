// src/mobile/pages/MobileVehicleStock.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Boxes, Search, Plus, Minus, ArrowDownLeft, ArrowUpRight, 
  Zap, RotateCcw, CheckCircle2, AlertTriangle, Clock, 
  ClipboardList, X, Filter, Wrench, Truck, ChevronRight,
  ChevronDown, Check, UserCheck
} from 'lucide-react';
import { Consumable, MechanicConsumableStock, ConsumableLog, CollectedPart, User, db } from '../../services/db';
import { matchHangul } from '../../utils/hangulSearch';

export type StockProcessType = 'RESTOCK' | 'RETURN' | 'USE' | 'DEFECTIVE' | 'ADJUST';

export const MobileVehicleStock: React.FC = () => {
  const { 
    currentUser, 
    users, 
    consumables, 
    mechanicConsumableStocks, 
    consumableLogs,
    transferConsumableToMechanic,
    returnConsumableToHq,
    createStocktakingAudit,
    assets,
    customers,
    sites,
    refreshAllData,
    showErrorModal
  } = useApp();

  // 1. 최고관리자 (개발자/총괄관리자) 판별 (헌장 2.1)
  const isAdmin = useMemo(() => {
    return Boolean(
      currentUser?.role === 'ADMIN' ||
      currentUser?.id === 'u-1' ||
      currentUser?.loginId === 'admin' ||
      currentUser?.name?.includes('관리자') ||
      currentUser?.name?.includes('개발자')
    );
  }, [currentUser]);

  // 2. 전체 AS팀원 및 정비 인력 목록 전수 추출 (헌장 5.3 SSOT)
  const asTeamMembers = useMemo(() => {
    const asDeptIds = new Set(
      (db.departments || [])
        .filter(d => d.name?.includes('AS') || d.name?.includes('정비'))
        .map(d => d.id)
    );
    asDeptIds.add('DEPT-0000005'); // 표준 AS팀 부서 ID

    // AS팀 소속원, 정비 역할, 또는 AS/정비 부서명 사용자 전수 필터링
    const asList = (users || []).filter(u => {
      const isAsDept = u.departmentId && asDeptIds.has(u.departmentId);
      const isAsName = Boolean(u.department?.includes('AS') || u.department?.includes('정비'));
      const isMechanicRole = u.role === 'MECHANIC';
      const isTesterMechanic = u.id === 'usr-tester-mechanic';
      return isAsDept || isAsName || isMechanicRole || isTesterMechanic;
    });

    // 정렬: 팀장/매니저 우선 후 이름순
    asList.sort((a, b) => {
      if (a.role === 'MANAGER' && b.role !== 'MANAGER') return -1;
      if (b.role === 'MANAGER' && a.role !== 'MANAGER') return 1;
      return a.name.localeCompare(b.name, 'ko');
    });

    // 관리자 본인이 AS팀 목록에 없을 경우 맨 앞에 추가하여 본인 차량도 선택 가능하도록 보장
    const result: User[] = [];
    if (currentUser && !asList.some(u => u.id === currentUser.id)) {
      result.push(currentUser);
    }
    result.push(...asList);

    return result;
  }, [users, currentUser]);

  const [selectedMechanicId, setSelectedMechanicId] = useState<string>(currentUser?.id || '');
  const [isMechanicSheetOpen, setIsMechanicSheetOpen] = useState<boolean>(false);

  // currentUser가 준비되거나 관리자/일반사용자 상태 전환 시 본인 차량으로 기본 동기화
  useEffect(() => {
    if (currentUser?.id) {
      if (!selectedMechanicId || (!isAdmin && selectedMechanicId !== currentUser.id)) {
        setSelectedMechanicId(currentUser.id);
      }
    }
  }, [currentUser?.id, isAdmin]);

  // 일반 임직원은 본인 차량으로 강제 고정, 최고관리자만 선택된 기사 차량 반영
  const effectiveMechanicId = useMemo(() => {
    if (!isAdmin) {
      return currentUser?.id || '';
    }
    return selectedMechanicId || currentUser?.id || asTeamMembers[0]?.id || '';
  }, [isAdmin, currentUser?.id, selectedMechanicId, asTeamMembers]);

  const activeMechanic = useMemo(() => {
    return (users || []).find(u => u.id === effectiveMechanicId) || currentUser;
  }, [users, effectiveMechanicId, currentUser]);

  // 2. 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'ALL' | 'LOADED' | 'EMPTY'>('ALL');
  const [activeMainTab, setActiveMainTab] = useState<'STOCK' | 'LOGS'>('STOCK');

  // 3. 재고 처리 모달 상태
  const [processingConsumable, setProcessingConsumable] = useState<Consumable | null>(null);
  const [processType, setProcessType] = useState<StockProcessType>('RESTOCK');
  const [processQty, setProcessQty] = useState<number>(1);
  const [processMemo, setProcessMemo] = useState<string>('');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedAssetNo, setSelectedAssetNo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [defectiveCondition, setDefectiveCondition] = useState<'REPAIRABLE' | 'SCRAP'>('REPAIRABLE');

  // 4. 차량 적재 재고 집계 (일반 사원은 본인 차량, 관리자는 선택 기사 차량)
  const myStocksMap = useMemo(() => {
    const map = new Map<string, MechanicConsumableStock>();
    (mechanicConsumableStocks || [])
      .filter(s => s.mechanicId === effectiveMechanicId)
      .forEach(s => map.set(s.consumableId, s));
    return map;
  }, [mechanicConsumableStocks, effectiveMechanicId]);

  // 차량 요약 지표
  const stockSummary = useMemo(() => {
    let totalLoadedItems = 0;
    let totalLoadedQty = 0;
    let totalValue = 0;

    (consumables || []).forEach(c => {
      const ms = myStocksMap.get(c.id);
      const qty = ms?.stockQty || 0;
      if (qty > 0) {
        totalLoadedItems += 1;
        totalLoadedQty += qty;
        totalValue += qty * (c.unitPrice || 0);
      }
    });

    return { totalLoadedItems, totalLoadedQty, totalValue };
  }, [consumables, myStocksMap]);

  // 필터링된 소모품 목록
  const filteredConsumables = useMemo(() => {
    return (consumables || []).filter(c => {
      const ms = myStocksMap.get(c.id);
      const vQty = ms?.stockQty || 0;

      // 탭 필터
      if (filterTab === 'LOADED' && vQty <= 0) return false;
      if (filterTab === 'EMPTY' && vQty > 0) return false;

      // 검색 필터 (초성 및 일반 매칭)
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const m = c.modelName.toLowerCase();
        const s = (c.supplier || '').toLowerCase();
        const matchName = m.includes(q) || matchHangul(c.modelName, searchQuery);
        const matchSupp = s.includes(q) || matchHangul(c.supplier || '', searchQuery);
        if (!matchName && !matchSupp) return false;
      }

      return true;
    }).sort((a, b) => {
      const aQty = myStocksMap.get(a.id)?.stockQty || 0;
      const bQty = myStocksMap.get(b.id)?.stockQty || 0;
      if (aQty !== bQty) return bQty - aQty; // 적재 수량 많은 순
      return a.modelName.localeCompare(b.modelName);
    });
  }, [consumables, myStocksMap, filterTab, searchQuery]);

  // 차량 최근 수불 로그
  const myLogs = useMemo(() => {
    return (consumableLogs || [])
      .filter(l => l.mechanicId === effectiveMechanicId || l.fromLocation?.includes(activeMechanic?.name || '') || l.toLocation?.includes(activeMechanic?.name || ''))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 30);
  }, [consumableLogs, effectiveMechanicId, activeMechanic]);

  // 모달 열기 헬퍼
  const openProcessModal = (consumable: Consumable, type: StockProcessType) => {
    setProcessingConsumable(consumable);
    setProcessType(type);
    setProcessQty(1);
    setProcessMemo('');
    setSelectedSiteId('');
    setSelectedAssetNo('');
    setDefectiveCondition('REPAIRABLE');
  };

  // 모달 제출 처리
  const handleSubmitProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!processingConsumable) return;
    if (processType !== 'ADJUST' && processQty <= 0) {
      showErrorModal('수량은 1개 이상이어야 합니다.');
      return;
    }
    if (processType === 'ADJUST' && processQty < 0) {
      showErrorModal('재고 실사 수량은 0개 이상이어야 합니다.');
      return;
    }

    setIsSubmitting(true);
    const ms = myStocksMap.get(processingConsumable.id);
    const vQty = ms?.stockQty || 0;
    const hqQty = processingConsumable.stockQty || 0;
    const mechName = activeMechanic?.name || '정비사';

    try {
      if (processType === 'RESTOCK') {
        // [유형 1: 본사창고 보충 수령]
        if (hqQty < processQty) {
          throw new Error(`주기장 잔여 재고 수량(${hqQty}개)이 부족합니다.`);
        }
        await transferConsumableToMechanic(
          effectiveMechanicId, 
          processingConsumable.id, 
          processQty, 
          processMemo || `[차량 보충] ${mechName} 탑차 보충 수령 (${processQty}개)`
        );
      } else if (processType === 'RETURN') {
        // [유형 2: 본사창고 반납]
        if (vQty < processQty) {
          throw new Error(`차량 보유 수량(${vQty}개)을 초과하여 반납할 수 없습니다.`);
        }
        await returnConsumableToHq(
          effectiveMechanicId,
          processingConsumable.id,
          processQty,
          processMemo || `[차량 반납] ${mechName} 탑차 ➔ 본사창고 반납 (${processQty}개)`
        );
      } else if (processType === 'USE') {
        // [유형 3: 현장 AS 즉시 소모]
        if (vQty < processQty) {
          throw new Error(`차량 보유 수량(${vQty}개)이 부족합니다.`);
        }
        // 차량 재고 차감
        if (ms) {
          db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', ms.id, {
            stockQty: ms.stockQty - processQty,
            updatedAt: new Date().toISOString()
          });
        }
        // 로그 기록
        db.insertRow<ConsumableLog>('consumableLogs', {
          consumableId: processingConsumable.id,
          type: 'OUTBOUND',
          quantity: processQty,
          unitPrice: processingConsumable.unitPrice,
          userId: currentUser?.id,
          mechanicId: effectiveMechanicId,
          fromLocation: `${mechName} 차량`,
          toLocation: selectedSiteId ? `현장 (${selectedSiteId})` : '현장 AS 긴급소모',
          targetAssetId: selectedAssetNo,
          actionDate: new Date().toISOString().split('T')[0],
          description: processMemo || `[현장 소모] ${processingConsumable.modelName} ${processQty}개 소모 (${selectedAssetNo ? `장비 ${selectedAssetNo}` : '현장조치'})`,
          createdAt: new Date().toISOString()
        });
        await db.awaitPendingWrites();
        refreshAllData();
      } else if (processType === 'DEFECTIVE') {
        // [유형 4: 고품 회수 및 본사 격리 등록]
        const disp = defectiveCondition === 'REPAIRABLE' ? 'REBUILD' : 'SCRAP';
        if (vQty >= processQty) {
          await returnConsumableToHq(
            effectiveMechanicId,
            processingConsumable.id,
            processQty,
            processMemo || `[고품 수거] ${mechName} 차량 ➔ 고품 격리 (${disp})`,
            true,
            disp
          );
        } else {
          // 차량 전산에 없던 현장 고품 즉시 수거 격리
          const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
          db.insertRow<CollectedPart>('collectedParts', {
            id: `col-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            partNo: `COL-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`,
            consumableId: processingConsumable.id,
            modelName: processingConsumable.modelName,
            mechanicId: effectiveMechanicId,
            mechanicName: mechName,
            quantity: processQty,
            disposition: disp,
            status: 'RECEIVED',
            receivedDate: new Date().toISOString().split('T')[0],
            memo: processMemo || `[현장 고품 수거] ${mechName} (${disp})`,
            createdAt: new Date().toISOString()
          });
          db.insertRow<ConsumableLog>('consumableLogs', {
            consumableId: processingConsumable.id,
            type: 'ADJUST',
            quantity: processQty,
            unitPrice: 0,
            userId: currentUser?.id,
            mechanicId: effectiveMechanicId,
            fromLocation: '현장 고품 탈거',
            toLocation: `고품 격리실 (${disp})`,
            targetAssetId: selectedAssetNo,
            actionDate: new Date().toISOString().split('T')[0],
            description: `[고품 회수 격리] ${processingConsumable.modelName} ${processQty}개 (${disp})${processMemo ? ` - ${processMemo}` : ''}`,
            createdAt: new Date().toISOString()
          });
          await db.awaitPendingWrites();
          refreshAllData();
        }
      } else if (processType === 'ADJUST') {
        // [유형 5: 차량 실사 수량 보정]
        const newQty = processQty;
        const diff = newQty - vQty;
        if (ms) {
          db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', ms.id, {
            stockQty: newQty,
            updatedAt: new Date().toISOString()
          });
        } else {
          db.insertRow<MechanicConsumableStock>('mechanicConsumableStocks', {
            id: `mcs-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            mechanicId: effectiveMechanicId,
            consumableId: processingConsumable.id,
            stockQty: newQty,
            updatedAt: new Date().toISOString()
          });
        }

        db.insertRow<ConsumableLog>('consumableLogs', {
          consumableId: processingConsumable.id,
          type: 'ADJUST',
          quantity: Math.abs(diff),
          unitPrice: processingConsumable.unitPrice,
          userId: currentUser?.id,
          mechanicId: effectiveMechanicId,
          fromLocation: `${mechName} 차량`,
          toLocation: `${mechName} 차량 실사보정`,
          actionDate: new Date().toISOString().split('T')[0],
          description: `[실사 보정] ${vQty}개 ➔ ${newQty}개 (${diff >= 0 ? `+${diff}` : diff}개) - 사유: ${processMemo || '실물 수량 실사'}`,
          createdAt: new Date().toISOString()
        });
        await db.awaitPendingWrites();
        refreshAllData();
      }

      setProcessingConsumable(null);
    } catch (err: any) {
      showErrorModal(err?.message || '재고 처리 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-24 p-3.5 font-sans text-slate-100 min-h-full">
      
      {/* 1. 상단 탑차 요약 대시보드 카드 */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 border border-amber-500/30 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-bold text-amber-400 tracking-wider whitespace-nowrap block">
                서비스 탑차 재고
              </span>
              <h2 className="text-sm font-black text-white whitespace-nowrap truncate flex items-center gap-1.5">
                <span>{activeMechanic?.name || currentUser?.name || '본인'} 기사 탑차</span>
                {effectiveMechanicId === currentUser?.id && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full flex-shrink-0">
                    본인
                  </span>
                )}
              </h2>
            </div>
          </div>

          {/* 최고관리자(개발자) 전용: 전 AS팀원 차량 전환 버튼 (일반 임직원 화면에는 완전히 미노출) */}
          {isAdmin && asTeamMembers.length > 0 && (
            <div className="flex flex-col items-end flex-shrink-0">
              <span className="text-[9px] text-amber-400/80 font-semibold mb-0.5 whitespace-nowrap">
                AS팀원 선택
              </span>
              <button
                type="button"
                onClick={() => setIsMechanicSheetOpen(true)}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-750 border border-amber-500/50 text-xs text-amber-200 font-bold rounded-xl px-2.5 py-1.5 active:scale-95 transition-all shadow-md cursor-pointer"
                title="AS팀원 차량 선택"
              >
                <UserCheck className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span className="truncate max-w-[100px] whitespace-nowrap">
                  {activeMechanic?.id === currentUser?.id ? `${activeMechanic?.name || '본인'} (본인)` : `${activeMechanic?.name || '팀원'} 기사`}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              </button>
            </div>
          )}
        </div>

        {/* 3대 핵심 수치 지표 */}
        <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-800/80">
          <div className="flex flex-col items-center bg-slate-950/50 rounded-xl p-2 border border-slate-800/60">
            <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">적재 품목</span>
            <span className="text-base font-black text-amber-400 mt-0.5 whitespace-nowrap">
              {stockSummary.totalLoadedItems}
              <span className="text-[10px] text-slate-400 font-normal ml-0.5">종</span>
            </span>
          </div>

          <div className="flex flex-col items-center bg-slate-950/50 rounded-xl p-2 border border-slate-800/60">
            <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">총 보유 수량</span>
            <span className="text-base font-black text-white mt-0.5 whitespace-nowrap">
              {stockSummary.totalLoadedQty}
              <span className="text-[10px] text-slate-400 font-normal ml-0.5">개</span>
            </span>
          </div>

          <div className="flex flex-col items-center bg-slate-950/50 rounded-xl p-2 border border-slate-800/60">
            <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">적재 자산가치</span>
            <span className="text-xs font-black text-emerald-400 mt-1 truncate max-w-full whitespace-nowrap">
              {stockSummary.totalValue > 0 ? `₩${Math.round(stockSummary.totalValue / 10000).toLocaleString('ko-KR')}만원` : '₩0원'}
            </span>
          </div>
        </div>

        {/* 모바일 차량 재고실사 전표 원클릭 발의 액션 */}
        <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">차량 전산-실물 재고 감사</span>
          <button
            type="button"
            onClick={async () => {
              const mechName = activeMechanic?.name || '정비사';
              try {
                const audit = await createStocktakingAudit('VEHICLE', effectiveMechanicId, `${mechName} 차량 모바일 현장 실사`);
                showErrorModal(`✅ 차량 실사 전표(${audit.auditNo})가 성공적으로 발행되었습니다.\n\n전산 재고가 스냅샷으로 고정되었으며, 관리자 검토 후 최종 확정됩니다.`, '차량 실사 전표 발행 완료');
              } catch (err: any) {
                showErrorModal(err?.message || '실사 전표 생성 실패');
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/40 text-xs font-bold hover:bg-blue-600/30 flex items-center gap-1.5 transition-colors"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>차량 재고실사 전표 발의</span>
          </button>
        </div>
      </div>

      {/* 2. 뷰 전환 탭: 부품 재고 vs 수불 이력 */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveMainTab('STOCK')}
          className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeMainTab === 'STOCK'
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Boxes className="w-3.5 h-3.5" />
          <span>소모품 재고 목록 ({filteredConsumables.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMainTab('LOGS')}
          className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeMainTab === 'LOGS'
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>수불/이동 이력 ({myLogs.length})</span>
        </button>
      </div>

      {activeMainTab === 'STOCK' ? (
        <>
          {/* 3. 검색창 및 수량 상태 필터 */}
          <div className="flex flex-col gap-2">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="부품명 또는 공급사 검색 (초성 지원)..."
                className="w-full rounded-xl p-3 pl-9 text-xs placeholder-slate-500 focus:outline-none border"
                style={{
                  backgroundColor: '#090d16',
                  color: '#f8fafc',
                  borderColor: '#334155',
                  colorScheme: 'dark'
                }}
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 필터 칩 */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => setFilterTab('ALL')}
                className={`text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap flex-shrink-0 font-bold transition-colors ${
                  filterTab === 'ALL'
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                전체 품목 ({consumables.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('LOADED')}
                className={`text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap flex-shrink-0 font-bold transition-colors ${
                  filterTab === 'LOADED'
                    ? 'bg-amber-600 text-white border-amber-500'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                차량 적재중 ({stockSummary.totalLoadedItems})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('EMPTY')}
                className={`text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap flex-shrink-0 font-bold transition-colors ${
                  filterTab === 'EMPTY'
                    ? 'bg-rose-600 text-white border-rose-500'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                미적재/소진 ({consumables.length - stockSummary.totalLoadedItems})
              </button>
            </div>
          </div>

          {/* 4. 고밀도 부품 리스트 카드 */}
          <div className="flex flex-col gap-2.5">
            {filteredConsumables.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-500 text-xs">
                검색 조건에 일치하는 소모품이 없습니다.
              </div>
            ) : (
              filteredConsumables.map((c) => {
                const ms = myStocksMap.get(c.id);
                const vQty = ms?.stockQty || 0;
                const hqQty = c.stockQty || 0;

                return (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex flex-col gap-2.5 shadow-md"
                  >
                    {/* 상단: 부품명 및 재고 수치 뱃지 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white truncate">
                          {c.modelName}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 whitespace-nowrap">
                          <span>단가 ₩{(c.unitPrice || 0).toLocaleString()}</span>
                          {c.supplier && <span className="text-slate-500">• {c.supplier}</span>}
                        </div>
                      </div>

                      {/* 재고 상태 뱃지 */}
                      <div className="flex flex-col items-end flex-shrink-0 gap-1">
                        <span className={`text-xs px-2.5 py-1 rounded-lg font-black font-mono border whitespace-nowrap ${
                          vQty > 0
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          차량 {vQty} {c.unit || '개'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                          본사 {hqQty}개 보유
                        </span>
                      </div>
                    </div>

                    {/* 하단: 원터치 4대 처리 액션 버튼군 */}
                    <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-slate-800/80">
                      {/* 1. 보충 수령 */}
                      <button
                        type="button"
                        onClick={() => openProcessModal(c, 'RESTOCK')}
                        className="py-1.5 px-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-all whitespace-nowrap"
                      >
                        <Plus className="w-3 h-3 text-blue-400 shrink-0" />
                        <span>보충</span>
                      </button>

                      {/* 2. 본사 반납 */}
                      <button
                        type="button"
                        disabled={vQty <= 0}
                        onClick={() => openProcessModal(c, 'RETURN')}
                        className={`py-1.5 px-1 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-all whitespace-nowrap border ${
                          vQty > 0
                            ? 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/30'
                            : 'bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed'
                        }`}
                      >
                        <ArrowDownLeft className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>반납</span>
                      </button>

                      {/* 3. 현장 소모 */}
                      <button
                        type="button"
                        disabled={vQty <= 0}
                        onClick={() => openProcessModal(c, 'USE')}
                        className={`py-1.5 px-1 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-all whitespace-nowrap border ${
                          vQty > 0
                            ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border-rose-500/30'
                            : 'bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed'
                        }`}
                      >
                        <Zap className="w-3 h-3 text-rose-400 shrink-0" />
                        <span>소모</span>
                      </button>

                      {/* 4. 실사/보정 */}
                      <button
                        type="button"
                        onClick={() => openProcessModal(c, 'ADJUST')}
                        className="py-1.5 px-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 text-[11px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-all whitespace-nowrap"
                      >
                        <Wrench className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>실사</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* 5. 수불 및 이동 이력 탭 */
        <div className="flex flex-col gap-2">
          {myLogs.length === 0 ? (
            <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-500 text-xs">
              기록된 소모품 수불 이력이 없습니다.
            </div>
          ) : (
            myLogs.map((log) => {
              const c = (consumables || []).find(item => item.id === log.consumableId);
              const isPlus = log.type === 'TRANSFER_TO_VEHICLE' || (log.type === 'ADJUST' && log.description?.includes('+'));

              return (
                <div
                  key={log.id}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold ${
                      log.type === 'TRANSFER_TO_VEHICLE'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : log.type === 'RETURN_TO_HQ'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : log.type === 'OUTBOUND'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}>
                      {log.type === 'TRANSFER_TO_VEHICLE' ? <Plus className="w-4 h-4" /> :
                       log.type === 'RETURN_TO_HQ' ? <ArrowDownLeft className="w-4 h-4" /> :
                       log.type === 'OUTBOUND' ? <Zap className="w-4 h-4" /> : <Wrench className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">
                        {c?.modelName || '소모품'}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {log.description || log.fromLocation}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className={`font-mono font-black text-xs ${
                      isPlus ? 'text-blue-400' : 'text-rose-400'
                    }`}>
                      {isPlus ? `+${log.quantity}` : `-${log.quantity}`}개
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {log.actionDate || log.createdAt?.split('T')[0]}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 📋 6. 통합 재고 처리 모달 */}
      {processingConsumable && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl">
            
            {/* 헤더 */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-amber-400 tracking-wider">탑차 소모품 처리</span>
                <h3 className="text-sm font-black text-white truncate">
                  {processingConsumable.modelName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProcessingConsumable(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 5대 처리 유형 탭 선택 */}
            <div className="grid grid-cols-5 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 text-[11px]">
              <button
                type="button"
                onClick={() => setProcessType('RESTOCK')}
                className={`py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  processType === 'RESTOCK' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                보충수령
              </button>
              <button
                type="button"
                onClick={() => setProcessType('RETURN')}
                className={`py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  processType === 'RETURN' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                본사반납
              </button>
              <button
                type="button"
                onClick={() => setProcessType('USE')}
                className={`py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  processType === 'USE' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                현장소모
              </button>
              <button
                type="button"
                onClick={() => setProcessType('DEFECTIVE')}
                className={`py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  processType === 'DEFECTIVE' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                고품회수
              </button>
              <button
                type="button"
                onClick={() => setProcessType('ADJUST')}
                className={`py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  processType === 'ADJUST' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                실사보정
              </button>
            </div>

            {/* 현재 상황 안내 */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs flex items-center justify-between">
              <div>
                <span className="text-slate-400">차량 현재고: </span>
                <strong className="text-white font-mono font-bold">
                  {myStocksMap.get(processingConsumable.id)?.stockQty || 0}개
                </strong>
              </div>
              <div>
                <span className="text-slate-400">본사 잔여재고: </span>
                <strong className="text-emerald-400 font-mono font-bold">
                  {processingConsumable.stockQty || 0}개
                </strong>
              </div>
            </div>

            <form onSubmit={handleSubmitProcess} className="flex flex-col gap-3.5">
              {/* 수량 입력 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                  {processType === 'ADJUST' ? '실물 확인 수량 (최종 개수)' : '처리 수량'}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setProcessQty(Math.max(1, processQty - 1))}
                    className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-white active:scale-95 font-bold"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={processType === 'ADJUST' ? 0 : 1}
                    value={processQty}
                    onChange={(e) => setProcessQty(Math.max(0, parseInt(e.target.value) || 0))}
                    className="flex-1 text-center font-mono font-black text-lg rounded-xl p-2 border"
                    style={{
                      backgroundColor: '#090d16',
                      color: '#f8fafc',
                      borderColor: '#334155',
                      colorScheme: 'dark'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setProcessQty(processQty + 1)}
                    className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-white active:scale-95 font-bold"
                  >
                    +
                  </button>
                </div>

                {/* 퀵 수량 버튼 */}
                <div className="flex items-center gap-1.5 pt-1">
                  {[1, 2, 5, 10].map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setProcessQty(q)}
                      className="flex-1 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 hover:bg-slate-700"
                    >
                      {q}개
                    </button>
                  ))}
                  {processType === 'RETURN' && (
                    <button
                      type="button"
                      onClick={() => setProcessQty(myStocksMap.get(processingConsumable.id)?.stockQty || 0)}
                      className="py-1 px-2 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-800/40 text-[11px] font-bold"
                    >
                      전량
                    </button>
                  )}
                  {processType === 'RESTOCK' && (
                    <button
                      type="button"
                      onClick={() => setProcessQty(processingConsumable.stockQty || 0)}
                      className="py-1 px-2 rounded-lg bg-blue-950/60 text-blue-300 border border-blue-800/40 text-[11px] font-bold"
                    >
                      본사 전량
                    </button>
                  )}
                </div>
              </div>

              {/* 현장소모 추가 입력: 현장 및 장비 매핑 */}
              {processType === 'USE' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                      장비 번호 (선택)
                    </label>
                    <input
                      type="text"
                      value={selectedAssetNo}
                      onChange={(e) => setSelectedAssetNo(e.target.value)}
                      placeholder="예: 102호기"
                      className="w-full rounded-xl p-2.5 text-xs border"
                      style={{
                        backgroundColor: '#090d16',
                        color: '#f8fafc',
                        borderColor: '#334155',
                        colorScheme: 'dark'
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                      현장명 (선택)
                    </label>
                    <input
                      type="text"
                      value={selectedSiteId}
                      onChange={(e) => setSelectedSiteId(e.target.value)}
                      placeholder="예: 판교 현장"
                      className="w-full rounded-xl p-2.5 text-xs border"
                      style={{
                        backgroundColor: '#090d16',
                        color: '#f8fafc',
                        borderColor: '#334155',
                        colorScheme: 'dark'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* 고품회수 상태 선택 */}
              {processType === 'DEFECTIVE' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                    탈거 고품 상태
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDefectiveCondition('REPAIRABLE')}
                      className={`py-2 rounded-xl text-xs font-bold border ${
                        defectiveCondition === 'REPAIRABLE'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      재생 수리 대상 (RMA)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDefectiveCondition('SCRAP')}
                      className={`py-2 rounded-xl text-xs font-bold border ${
                        defectiveCondition === 'SCRAP'
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      폐기 대상 (파손/수명종료)
                    </button>
                  </div>
                </div>
              )}

              {/* 처리 사유 / 메모 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                  {processType === 'ADJUST' ? '실사 보정 사유' : '메모 / 조치 내용'}
                </label>
                <input
                  type="text"
                  value={processMemo}
                  onChange={(e) => setProcessMemo(e.target.value)}
                  placeholder={
                    processType === 'RESTOCK' ? '보충 사유 (예: 주간 기본 적재)' :
                    processType === 'RETURN' ? '반납 사유 (예: 과잉 재고 반납)' :
                    processType === 'USE' ? '사용 내역 (예: 리밋센서 파손 교체)' :
                    processType === 'DEFECTIVE' ? '고품 증상 (예: 모터 코일 탄내)' : '실사 보정 사유'
                  }
                  className="w-full rounded-xl p-2.5 text-xs border"
                  style={{
                    backgroundColor: '#090d16',
                    color: '#f8fafc',
                    borderColor: '#334155',
                    colorScheme: 'dark'
                  }}
                />
              </div>

              {/* 하단 버튼 */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProcessingConsumable(null)}
                  className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`flex-1 py-3 rounded-xl text-white text-xs font-black shadow-lg ${
                    processType === 'RESTOCK' ? 'bg-blue-600 hover:bg-blue-500' :
                    processType === 'RETURN' ? 'bg-amber-600 hover:bg-amber-500' :
                    processType === 'USE' ? 'bg-rose-600 hover:bg-rose-500' :
                    processType === 'DEFECTIVE' ? 'bg-purple-600 hover:bg-purple-500' : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                >
                  {isSubmitting ? '처리 중...' : '재고 처리 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 📱 대안 2: 전사 표준 다크 커스텀 바텀시트 (AS팀원 차량 선택 모달) ── */}
      {isMechanicSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border-t border-slate-700 rounded-t-3xl p-5 max-w-md w-full max-h-[75vh] flex flex-col gap-3.5 shadow-2xl overflow-hidden">
            {/* 시트 헤더 */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0">
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white whitespace-nowrap">AS팀원 탑차 차량 선택</h3>
                  <p className="text-[10.5px] text-slate-400 whitespace-nowrap">차량 적재 재고를 조회 및 관리할 팀원을 선택하십시오</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMechanicSheetOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 팀원 리스트 */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-0.5">
              {asTeamMembers.map(m => {
                const isSelected = m.id === effectiveMechanicId;
                const isSelf = m.id === currentUser?.id;
                // 해당 기사의 현재 차량 적재 품목수 계산
                const loadedCount = (mechanicConsumableStocks || [])
                  .filter(s => s.mechanicId === m.id && s.stockQty > 0).length;

                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      setSelectedMechanicId(m.id);
                      setIsMechanicSheetOpen(false);
                    }}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500/60 text-white shadow-md'
                        : 'bg-slate-950/60 border-slate-800 hover:bg-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                        isSelected 
                          ? 'bg-amber-500 text-slate-950 shadow' 
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}>
                        {m.name.slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="font-bold text-xs text-white">{m.name}</span>
                          {isSelf && (
                            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9.5px] font-bold whitespace-nowrap">
                              본인
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 whitespace-nowrap">
                            {m.role === 'MANAGER' ? '팀장' : '기사'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                          <span className="text-amber-400 font-mono font-bold">{loadedCount}종 적재중</span>
                          <span>•</span>
                          <span>AS팀</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isSelected ? (
                        <div className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border border-slate-700 bg-slate-900" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
