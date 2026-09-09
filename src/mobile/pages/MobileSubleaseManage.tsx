// src/mobile/pages/MobileSubleaseManage.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Asset, Vendor, ContractAsset, db } from '../../services/db';
import { 
  Layers, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Truck, 
  Check, 
  Plus, 
  X, 
  Building2, 
  MapPin, 
  Calendar, 
  ArrowLeft,
  Phone,
  Clock,
  ChevronDown,
  ArrowRight,
  Send
} from 'lucide-react';
import { MobileTabType } from '../MobileBottomNav';

interface MobileSubleaseManageProps {
  onNavigate?: (tab: MobileTabType) => void;
  onBack?: () => void;
}

export const MobileSubleaseManage: React.FC<MobileSubleaseManageProps> = ({
  onNavigate,
  onBack,
}) => {
  const { 
    assets, 
    vendors, 
    contracts, 
    contractAssets,
    customers, 
    sites, 
    registerRentedAsset, 
    returnRentedAsset, 
    refreshAllData,
    currentUser,
    showErrorModal 
  } = useApp();

  // 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DEPLOYED' | 'IDLE' | 'RETURNED'>('ALL');
  const [selectedVendorFilter, setSelectedVendorFilter] = useState<string>('ALL');

  // 신규 등록 바텀시트 상태
  const [isRegisterSheetOpen, setIsRegisterSheetOpen] = useState(false);
  const [newVendorId, setNewVendorId] = useState('');
  const [newCustomVendor, setNewCustomVendor] = useState('');
  const [newVendorAssetNo, setNewVendorAssetNo] = useState('');
  const [newAssetNo, setNewAssetNo] = useState('');
  const [newModelName, setNewModelName] = useState('GS-1930');
  const [newRentStart, setNewRentStart] = useState(() => new Date().toISOString().split('T')[0]);
  const [newMonthlyRentFee, setNewMonthlyRentFee] = useState<number>(450000);
  const [isRegistering, setIsRegistering] = useState(false);

  // 임차처 반납 마감 바텀시트 상태
  const [isReturnSheetOpen, setIsReturnSheetOpen] = useState(false);
  const [targetAssetForReturn, setTargetAssetForReturn] = useState<Asset | null>(null);
  const [actualReturnDate, setActualReturnDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isReturning, setIsReturning] = useState(false);

  // 현장 투입 매핑 모달 상태 (헌장 2.2 & 과제 10)
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [targetAssetForDeploy, setTargetAssetForDeploy] = useState<Asset | null>(null);
  const [deployCustomerId, setDeployCustomerId] = useState('');
  const [deploySiteId, setDeploySiteId] = useState('');
  const [deployStartDate, setDeployStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [deployMonthlyRent, setDeployMonthlyRent] = useState<number>(400000);
  const [isDeploying, setIsDeploying] = useState(false);

  // 성공 피드백 토스트
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 고객사 선택 시 현장 및 최근 계약 단가 자동 상속 (헌장 2.2)
  const handleDeployCustomerChange = (custId: string) => {
    setDeployCustomerId(custId);
    const custSites = sites.filter(s => s.customerId === custId);
    if (custSites.length > 0) setDeploySiteId(custSites[0].id);
    else setDeploySiteId('');

    const custContractIds = contracts.filter(c => c.customerId === custId).map(c => c.id);
    const recentCa = contractAssets
      .filter(ca => custContractIds.includes(ca.contractId) && ca.monthlyRentalFee > 0)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    if (recentCa && recentCa.monthlyRentalFee) {
      setDeployMonthlyRent(recentCa.monthlyRentalFee);
    } else {
      setDeployMonthlyRent(400000);
    }
  };

  // 현장 투입 매핑 실행 (헌장 1.2, 1.3, 2.2, 5.2 준수)
  const handleConfirmDeploy = async () => {
    if (!targetAssetForDeploy || !deployCustomerId) {
      showErrorModal('투입할 고객사를 선택하십시오.');
      return;
    }
    setIsDeploying(true);
    try {
      let targetContract = contracts.find(
        c => c.customerId === deployCustomerId && c.status === 'ACTIVE' && (!deploySiteId || c.siteId === deploySiteId)
      );
      let contractId = targetContract?.id;

      if (!contractId) {
        const custObj = customers.find(c => c.id === deployCustomerId);
        const newContract = db.insertRow<any>('contracts', {
          contractNo: `CT-SUB-${Date.now().toString().slice(-6)}`,
          customerId: deployCustomerId,
          customerName: custObj?.name || '고객사',
          siteId: deploySiteId || undefined,
          startDate: deployStartDate,
          endDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          billingDay: 30,
          lateInterestRate: 0,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          salespersonName: currentUser?.name || '관리부',
        });
        contractId = newContract.id;
      }

      if (!contractId) {
        showErrorModal('계약 생성에 실패하였습니다.');
        return;
      }

      const sanitizedDeployMonthlyRent = Math.max(0, Number(deployMonthlyRent) || 0);
      db.insertRow<ContractAsset>('contractAssets', {
        contractId,
        assetId: targetAssetForDeploy.id,
        startDate: deployStartDate,
        endDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        monthlyRentalFee: sanitizedDeployMonthlyRent,
        dailyRentalFee: Math.round(sanitizedDeployMonthlyRent / 30),
        status: 'RENTED',
        createdAt: new Date().toISOString(),
      });

      db.updateRow<Asset>('assets', targetAssetForDeploy.id, {
        status: 'RENTED',
        currentCustomerId: deployCustomerId,
        currentSiteId: deploySiteId || undefined,
        note: `[전대 직결 투입] ${deployStartDate} 현장 투입 매핑`,
        updatedAt: new Date().toISOString(),
      });

      const custName = customers.find(c => c.id === deployCustomerId)?.name || '';
      const sName = sites.find(s => s.id === deploySiteId)?.name || '';
      db.insertRow<any>('assetInOutLogs', {
        assetId: targetAssetForDeploy.id,
        assetNo: targetAssetForDeploy.assetNo,
        type: 'OUTBOUND',
        date: deployStartDate,
        customerId: deployCustomerId,
        customerName: custName,
        siteId: deploySiteId || undefined,
        siteName: sName,
        note: `전대 장비 고객사 현장 투입 매핑 출고 (${custName} - ${sName})`,
        createdAt: new Date().toISOString(),
      });

      await db.awaitPendingWrites();
      await refreshAllData();
      setIsDeployModalOpen(false);
      setTargetAssetForDeploy(null);
      showToast(`${targetAssetForDeploy.assetNo} 장비가 ${custName} 현장으로 정상 투입 매핑되었습니다.`);
    } catch (err: any) {
      showErrorModal(`현장 투입 매핑 실패: ${err?.message || err}`);
    } finally {
      setIsDeploying(false);
    }
  };

  // 임차처 공급자 목록 (type === 'RENTAL' 또는 types 포함)
  const rentalVendors = useMemo(() => {
    return vendors.filter(v => v.type === 'RENTAL' || (v.types && v.types.includes('RENTAL')) || v.name.includes('렌탈') || v.name.includes('네트웍스'));
  }, [vendors]);

  // 전대 자산(ownerType === 'RENTED') 목록 및 가공
  const subleaseList = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return assets
      .filter(a => a.ownerType === 'RENTED')
      .map(a => {
        // 소속 계약 및 고객사/현장 탐색
        const contract = contracts.find(c => c.id === a.currentCustomerId || c.customerId === a.currentCustomerId);
        const customer = customers.find(cu => cu.id === a.currentCustomerId);
        const site = sites.find(s => s.id === a.currentSiteId);

        // 임차처명 결정 (vendorId 또는 renter)
        let vendorName = a.renter || '임차처 미지정';
        if (a.vendorId) {
          const v = vendors.find(item => item.id === a.vendorId);
          if (v) vendorName = v.name;
        }

        // 운용 상태 판정
        // 1. 반납완료: actualRentReturnDate가 있거나 status === 'RENTED_RETURNED'
        const isReturnedToVendor = !!a.actualRentReturnDate || a.status === 'RENTED_RETURNED';

        // 2. 고객사 현장 가동중: status === 'RENTED'
        const isDeployedToCustomer = a.status === 'RENTED' && !isReturnedToVendor;

        // 3. 🚨 주기장 유휴 누수 위험: 임차처에 아직 안 돌려줬는데(미반납), 현장에도 안 나가있는 상태(AVAILABLE or ASSIGNED or REPAIRING)
        const isIdleLeakRisk = !isReturnedToVendor && !isDeployedToCustomer;

        // 유휴 누수 일수 계산 (당일 입고 시 0일 보정 - 과제 10)
        let idleDays = 0;
        let leakAmount = 0;
        if (isIdleLeakRisk && a.rentStart) {
          // 임차 시작일 기준 또는 계약 종료일 기준
          const baseDate = a.contractEnd ? new Date(a.contractEnd) : new Date(a.rentStart);
          baseDate.setHours(0, 0, 0, 0);
          const diffTime = today.getTime() - baseDate.getTime();
          idleDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
          const dailyFee = a.dailyRentFee || Math.floor((a.monthlyRentFee || 0) / 30);
          leakAmount = idleDays * dailyFee;
        }

        return {
          ...a,
          vendorName,
          customerName: customer?.name || (a.currentCustomerId ? '현장 가동중' : '미투입'),
          siteName: site?.name || '',
          isReturnedToVendor,
          isDeployedToCustomer,
          isIdleLeakRisk,
          idleDays,
          leakAmount,
        };
      });
  }, [assets, contracts, customers, sites, vendors]);

  // 필터링된 전대 자산 목록
  const filteredSubleaseList = useMemo(() => {
    return subleaseList.filter(item => {
      // 탭 필터
      if (statusFilter === 'DEPLOYED' && !item.isDeployedToCustomer) return false;
      if (statusFilter === 'IDLE' && !item.isIdleLeakRisk) return false;
      if (statusFilter === 'RETURNED' && !item.isReturnedToVendor) return false;

      // 임차처 필터
      if (selectedVendorFilter !== 'ALL' && item.vendorId !== selectedVendorFilter && item.vendorName !== selectedVendorFilter) {
        return false;
      }

      // 검색어 필터
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchAssetNo = item.assetNo.toLowerCase().includes(q);
        const matchVendorAssetNo = (item.vendorAssetNo || '').toLowerCase().includes(q);
        const matchModel = item.modelName.toLowerCase().includes(q);
        const matchVendor = item.vendorName.toLowerCase().includes(q);
        const matchCustomer = item.customerName.toLowerCase().includes(q);
        const matchSite = item.siteName.toLowerCase().includes(q);
        if (!matchAssetNo && !matchVendorAssetNo && !matchModel && !matchVendor && !matchCustomer && !matchSite) {
          return false;
        }
      }

      return true;
    });
  }, [subleaseList, statusFilter, selectedVendorFilter, searchQuery]);

  // 2x2 KPI 지표 산출
  const totalSubleaseCount = subleaseList.length;
  const deployedCount = subleaseList.filter(i => i.isDeployedToCustomer).length;
  const idleLeakItems = subleaseList.filter(i => i.isIdleLeakRisk);
  const idleLeakCount = idleLeakItems.length;
  const totalLeakAmount = idleLeakItems.reduce((sum, i) => sum + i.leakAmount, 0);
  const totalMonthlyCost = subleaseList
    .filter(i => !i.isReturnedToVendor)
    .reduce((sum, i) => sum + (i.monthlyRentFee || 0), 0);

  // [액션 1] 임차 장비 신규 등록 제출
  const handleRegisterSubmit = async () => {
    const finalRenter = newVendorId ? (vendors.find(v => v.id === newVendorId)?.name || '임차처') : newCustomVendor.trim();
    if (!finalRenter) {
      showErrorModal('임차처를 선택하거나 직접 입력하십시오.', '입력 오류');
      return;
    }

    const cleanAssetNo = (newAssetNo.trim() || newVendorAssetNo.trim()).toUpperCase();
    if (!cleanAssetNo) {
      showErrorModal('관리번호 또는 임차처 번호를 입력하십시오.', '입력 오류');
      return;
    }

    setIsRegistering(true);
    try {
      const sanitizedMonthlyFee = Math.max(0, Number(newMonthlyRentFee) || 0);
      await registerRentedAsset({
        assetNo: cleanAssetNo,
        vendorAssetNo: newVendorAssetNo.trim().toUpperCase() || cleanAssetNo,
        vendorId: newVendorId || undefined,
        renter: finalRenter,
        modelName: newModelName.trim(),
        rentStart: newRentStart,
        monthlyRentFee: sanitizedMonthlyFee,
        dailyRentFee: Math.floor(sanitizedMonthlyFee / 30),
      });

      showToast(`${cleanAssetNo} 임차 장비가 등록되었습니다. (임대가능 가용재고 편입)`);
      setIsRegisterSheetOpen(false);
      // 폼 초기화
      setNewVendorAssetNo('');
      setNewAssetNo('');
      setNewCustomVendor('');
    } catch (err: any) {
      // showErrorModal은 registerRentedAsset 내부에서 이미 호출됨
    } finally {
      setIsRegistering(false);
    }
  };

  // [액션 2] 임차처 반납 마감 바텀시트 오픈
  const handleOpenReturnModal = (asset: Asset) => {
    if (asset.status === 'RENTED' || (asset as any).isDeployedToCustomer) {
      showErrorModal(`자산 ${asset.assetNo}은 현재 고객사 현장에 대여중(RENTED)입니다. 현장 회수 입고 전에는 임차처 반납이 불가합니다.`, '반납 차단');
      return;
    }
    setTargetAssetForReturn(asset);
    setActualReturnDate(new Date().toISOString().split('T')[0]);
    setIsReturnSheetOpen(true);
  };

  // [액션 3] 임차처 반납 마감 확정 실행
  const handleConfirmReturn = async () => {
    if (!targetAssetForReturn) return;
    if (targetAssetForReturn.status === 'RENTED') {
      showErrorModal(`자산 ${targetAssetForReturn.assetNo}은 현재 고객사에 대여중입니다. 회수 입고 전에는 임차처 반납이 불가합니다.`, '반납 차단');
      return;
    }
    if (!actualReturnDate) {
      showErrorModal('실제 반납 일자를 입력하십시오.', '입력 오류');
      return;
    }

    setIsReturning(true);
    try {
      await returnRentedAsset(targetAssetForReturn.id, actualReturnDate);
      showToast(`${targetAssetForReturn.assetNo} 임차처 반납 마감이 완료되었습니다.`);
      setIsReturnSheetOpen(false);
      setTargetAssetForReturn(null);
    } catch (err: any) {
      // showErrorModal은 returnRentedAsset 내부에서 처리됨
    } finally {
      setIsReturning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-28 p-3 sm:p-4 font-sans text-slate-100 max-w-full">
      {/* 토스트 알림 */}
      {toastMessage && (
        <div 
          style={{
            position: 'fixed',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            padding: '12px 20px',
            borderRadius: '12px',
            backgroundColor: '#059669',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: '700',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            whiteSpace: 'nowrap'
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* 헤더 바 */}
      <div className="flex items-center justify-between py-1 border-b border-slate-800">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <span>전대 장비 관리</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-sky-400 border border-blue-500/30">
                관리부
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">외부 임차 장비 운용 및 누수 차단 관제</p>
          </div>
        </div>

        {/* 임차 장비 등록 버튼 */}
        <button
          type="button"
          onClick={() => setIsRegisterSheetOpen(true)}
          className="py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-blue-600/30 active:scale-95 transition-all whitespace-nowrap flex-shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>임차 장비 등록</span>
        </button>
      </div>

      {/* ── 1. 2x2 KPI 요약 그리드 ── */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* 전체 전대 장비 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span className="whitespace-nowrap flex-shrink-0">전대 장비 총계</span>
            <Layers className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-mono font-black text-white">{totalSubleaseCount}</span>
            <span className="text-xs text-slate-400">대 보유</span>
          </div>
        </div>

        {/* 고객사 현장 가동 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span className="whitespace-nowrap flex-shrink-0">현장 투입 가동</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-mono font-black text-emerald-400">{deployedCount}</span>
            <span className="text-xs text-slate-400">대 매출창출</span>
          </div>
        </div>

        {/* 🚨 주기장 반납대기 누수 위험 */}
        <div className={`rounded-2xl p-3.5 flex flex-col justify-between shadow-lg border transition-all ${
          idleLeakCount > 0 
            ? 'bg-rose-950/40 border-rose-500/60 ring-1 ring-rose-500/30' 
            : 'bg-slate-900 border-slate-800'
        }`}>
          <div className="flex items-center justify-between text-xs font-bold">
            <span className={`whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${idleLeakCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>주기장 반납대기</span>
            </span>
            {idleLeakCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white animate-pulse whitespace-nowrap flex-shrink-0">
                누수 경보
              </span>
            )}
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1.5">
              <span className={`text-2xl font-mono font-black ${idleLeakCount > 0 ? 'text-rose-400' : 'text-white'}`}>
                {idleLeakCount}
              </span>
              <span className="text-xs text-slate-400">대 방치</span>
            </div>
            {idleLeakCount > 0 && (
              <div className="text-[11px] font-mono text-rose-300 mt-1 truncate">
                손실: -₩{totalLeakAmount.toLocaleString()}원
              </div>
            )}
          </div>
        </div>

        {/* 월 예상 매입 임차료 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span className="whitespace-nowrap flex-shrink-0">월 예상 임차료</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-mono font-black text-slate-200">
              ₩{(Math.round(totalMonthlyCost / 10000)).toLocaleString()}만
            </span>
            <span className="text-[10px] text-slate-500">/월 원가</span>
          </div>
        </div>
      </div>

      {/* ── 2. 검색창 & 임차처 필터 ── */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="관리번호, 임차처번호, 모델명, 현장 검색"
            className="w-full py-2.5 pl-9 pr-3 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 4대 세그먼트 탭 필터 (nowrap & shrink-0 준수) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full scrollbar-none">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all ${
              statusFilter === 'ALL' 
                ? 'bg-sky-600 text-white' 
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            전체 {totalSubleaseCount}
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('DEPLOYED')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all flex items-center gap-1 ${
              statusFilter === 'DEPLOYED' 
                ? 'bg-emerald-600 text-white' 
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>현장 가동중 {deployedCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('IDLE')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all flex items-center gap-1 ${
              statusFilter === 'IDLE' 
                ? 'bg-rose-600 text-white' 
                : idleLeakCount > 0 
                  ? 'bg-rose-950/60 text-rose-400 border border-rose-800/80 hover:bg-rose-900' 
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>반납대기 {idleLeakCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('RETURNED')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all ${
              statusFilter === 'RETURNED' 
                ? 'bg-slate-700 text-white' 
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            반납완료 {subleaseList.filter(i => i.isReturnedToVendor).length}
          </button>
        </div>
      </div>

      {/* ── 3. 전대 자산 목록 (Card Dossier) ── */}
      <div className="flex flex-col gap-3">
        {filteredSubleaseList.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col items-center gap-2">
            <Layers className="w-8 h-8 text-slate-600" />
            <div className="text-sm font-bold text-slate-400">조건에 일치하는 전대 장비가 없습니다.</div>
            <div className="text-xs text-slate-500">검색어 또는 상태 필터를 조정하십시오.</div>
          </div>
        ) : (
          filteredSubleaseList.map((asset) => (
            <div
              key={asset.id}
              className={`p-4 rounded-2xl border flex flex-col gap-3 transition-all shadow-lg ${
                asset.isIdleLeakRisk
                  ? 'bg-slate-900/95 border-rose-500/60 ring-1 ring-rose-500/20'
                  : asset.isDeployedToCustomer
                    ? 'bg-slate-900 border-slate-800'
                    : 'bg-slate-950/80 border-slate-800/60 opacity-80'
              }`}
            >
              {/* 상단 임차처 및 관리번호 헤더 */}
              <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-sky-400 px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-800 whitespace-nowrap flex-shrink-0">
                      {asset.vendorName}
                    </span>
                    <span className="font-mono font-black text-white text-base truncate">
                      {asset.assetNo}
                    </span>
                    {asset.vendorAssetNo && asset.vendorAssetNo !== asset.assetNo && (
                      <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap flex-shrink-0">
                        (임차처번호: {asset.vendorAssetNo})
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-bold text-slate-300 mt-1 flex items-center gap-2">
                    <span>{asset.modelName}</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      월 ₩{(asset.monthlyRentFee || 0).toLocaleString()}원
                    </span>
                  </div>
                </div>

                {/* 상태 뱃지 */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {asset.isIdleLeakRisk ? (
                    <span className="px-2 py-1 rounded-lg bg-rose-600 text-white font-black text-xs flex items-center gap-1 shadow-md shadow-rose-950 whitespace-nowrap flex-shrink-0 animate-pulse">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>반납대기 {asset.idleDays}일째</span>
                    </span>
                  ) : asset.isDeployedToCustomer ? (
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-bold text-[11px] flex items-center gap-1 whitespace-nowrap flex-shrink-0">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>현장 가동중</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 font-medium text-[11px] whitespace-nowrap flex-shrink-0">
                      임차처 반납완료
                    </span>
                  )}
                </div>
              </div>

              {/* 본문 세부 내역 */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {/* 투입 현장 / 고객사 */}
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap flex-shrink-0">투입 현장 / 거래처</span>
                  <div className="font-bold text-slate-200 truncate flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{asset.customerName}</span>
                  </div>
                  {asset.siteName && (
                    <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      <span className="truncate">{asset.siteName}</span>
                    </div>
                  )}
                </div>

                {/* 차입 및 반납 일정 */}
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap flex-shrink-0">임차 계약 기간</span>
                  <div className="font-mono text-slate-300 text-[11px] truncate flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-500 flex-shrink-0" />
                    <span>{asset.rentStart || '시작일 미등록'}</span>
                  </div>
                  <div className="font-mono text-[11px] truncate">
                    {asset.actualRentReturnDate ? (
                      <span className="text-slate-400">반납: {asset.actualRentReturnDate}</span>
                    ) : asset.isIdleLeakRisk ? (
                      <span className="text-rose-400 font-bold">누수 손실: -₩{asset.leakAmount.toLocaleString()}원</span>
                    ) : (
                      <span className="text-sky-400">일할단가: ₩{(asset.dailyRentFee || 0).toLocaleString()}원/일</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 하단 원터치 액션 버튼군 (현장투입 매핑 추가 - 과제 10) */}
              <div className="flex items-center gap-2 pt-1">
                {asset.isIdleLeakRisk ? (
                  <div className="grid grid-cols-3 gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => {
                        setTargetAssetForDeploy(asset);
                        setDeployCustomerId('');
                        setDeploySiteId('');
                        setDeployStartDate(new Date().toISOString().split('T')[0]);
                        setDeployMonthlyRent(asset.monthlyRentFee || 400000);
                        setIsDeployModalOpen(true);
                      }}
                      className="py-2 px-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-md active:scale-95 transition-all whitespace-nowrap"
                    >
                      <Send className="w-3 h-3" />
                      <span>현장투입</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigate && onNavigate('dispatch')}
                      className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition-all whitespace-nowrap"
                    >
                      <Truck className="w-3 h-3 text-sky-400" />
                      <span>배차의뢰</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenReturnModal(asset)}
                      className="py-2 px-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-md active:scale-95 transition-all whitespace-nowrap"
                    >
                      <Check className="w-3 h-3" />
                      <span>반납마감</span>
                    </button>
                  </div>
                ) : asset.isDeployedToCustomer ? (
                  <div className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>현장 대여중 (회수 필요)</span>
                    </span>
                    <button
                      type="button"
                      disabled
                      title="대여중인 자산은 회수 전 임차처 반납이 불가합니다"
                      className="py-1.5 px-3 rounded-lg bg-slate-800 text-slate-500 font-bold text-xs cursor-not-allowed opacity-60 whitespace-nowrap"
                    >
                      임차처 반납 불가
                    </button>
                  </div>
                ) : (
                  <div className="w-full py-1.5 text-center text-xs text-slate-500 font-medium">
                    임차처 최종 반납 처리 완료 (정산 마감됨)
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── 4. 임차처 장비 신규등록 다크 바텀시트 ── */}
      {isRegisterSheetOpen && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            animation: 'fadeIn 0.2s ease-out'
          }}
          onClick={() => setIsRegisterSheetOpen(false)}
        >
          <div 
            style={{
              backgroundColor: '#0f172a',
              borderTopLeftRadius: '24px',
              borderTopRightRadius: '24px',
              borderTop: '1px solid #334155',
              padding: '20px 16px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.6)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 타이틀 바 */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-black text-white">임차 장비 신규 등록</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">외부 타사 차입 장비 반입 및 관리번호 등록</p>
              </div>
              <button
                type="button"
                onClick={() => setIsRegisterSheetOpen(false)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 입력 폼 (상하 세로 스택 - 헌장 3.4 준수) */}
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[55vh] pr-0.5">
              {/* 임차처 선택 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                  임차처
                </label>
                <select
                  value={newVendorId}
                  onChange={(e) => setNewVendorId(e.target.value)}
                  className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
                >
                  <option value="">직접 입력 (협력사 미지정)</option>
                  {rentalVendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                {!newVendorId && (
                  <input
                    type="text"
                    value={newCustomVendor}
                    onChange={(e) => setNewCustomVendor(e.target.value)}
                    placeholder="임차처 상호명 직접 입력 (예: 한솔렌탈)"
                    className="w-full mt-1 py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                )}
              </div>

              {/* 임차처 번호 & 관리 번호 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                    임차처 번호
                  </label>
                  <input
                    type="text"
                    value={newVendorAssetNo}
                    onChange={(e) => setNewVendorAssetNo(e.target.value)}
                    placeholder="예: HS-1902"
                    className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                    당사 관리번호
                  </label>
                  <input
                    type="text"
                    value={newAssetNo}
                    onChange={(e) => setNewAssetNo(e.target.value)}
                    placeholder="미입력 시 임차처번호 사용"
                    className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* 모델명 & 시작일 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                    장비 모델 규격
                  </label>
                  <select
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="GS-1930">GS-1930 (19ft)</option>
                    <option value="2646">2646 (26ft 광폭)</option>
                    <option value="3246">3246 (32ft)</option>
                    <option value="4047">4047 (40ft)</option>
                    <option value="GS-1530">GS-1530 (15ft)</option>
                    <option value="GTJZ0608ME">GTJZ0608ME</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                    임차 시작일
                  </label>
                  <input
                    type="date"
                    value={newRentStart}
                    onChange={(e) => setNewRentStart(e.target.value)}
                    className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* 차입 단가 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0 flex items-center justify-between">
                  <span>임차처 월 차입단가 (매입원가)</span>
                  <span className="text-[11px] font-mono text-sky-400">
                    일할: ₩{Math.floor(newMonthlyRentFee / 30).toLocaleString()}원/일
                  </span>
                </label>
                <input
                  type="number"
                  step="10000"
                  value={newMonthlyRentFee}
                  onChange={(e) => setNewMonthlyRentFee(Number(e.target.value))}
                  placeholder="예: 450000"
                  className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* 제출 버튼 */}
            <div className="pt-2">
              <button
                type="button"
                disabled={isRegistering}
                onClick={handleRegisterSubmit}
                className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-blue-600/30 active:scale-98 transition-all"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>{isRegistering ? '등록 처리 중...' : '임차 장비 등록 완료 (가용자산 편입)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. 임차처 반납 마감 다크 바텀시트 ── */}
      {isReturnSheetOpen && targetAssetForReturn && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            animation: 'fadeIn 0.2s ease-out'
          }}
          onClick={() => setIsReturnSheetOpen(false)}
        >
          <div 
            style={{
              backgroundColor: '#0f172a',
              borderTopLeftRadius: '24px',
              borderTopRightRadius: '24px',
              borderTop: '1px solid #334155',
              padding: '20px 16px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.6)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 타이틀 바 */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-black text-white">임차처 반납 마감 승인</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">실제 반납일 확정 및 임차료 지급 마감</p>
              </div>
              <button
                type="button"
                onClick={() => setIsReturnSheetOpen(false)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 대상 장비 요약 */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-400">{targetAssetForReturn.renter || '임차처'}</span>
                <span className="font-mono font-black text-white">{targetAssetForReturn.assetNo}</span>
              </div>
              <div className="text-slate-400 text-[11px]">
                모델: {targetAssetForReturn.modelName} • 차입 시작일: {targetAssetForReturn.rentStart || '미등록'}
              </div>
            </div>

            {/* 실제 반납일 입력 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
                실제 임차처 반납일
              </label>
              <input
                type="date"
                value={actualReturnDate}
                onChange={(e) => setActualReturnDate(e.target.value)}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-rose-500"
              />
            </div>

            {/* 마감 확정 안내 */}
            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-900/60 text-xs text-rose-300 flex flex-col gap-1">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>반납 마감 시 주의사항</span>
              </div>
              <div className="text-[11px] text-rose-300/80 leading-relaxed">
                반납이 확정되면 자산 상태가 [임차처 반납완료]로 종결되며, 추가 임차료 계상이 중단되고 월말 매입 정산서에 확정 일수로 전송됩니다.
              </div>
            </div>

            {/* 제출 버튼 */}
            <div className="pt-2">
              <button
                type="button"
                disabled={isReturning}
                onClick={handleConfirmReturn}
                className="w-full py-3.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-rose-600/30 active:scale-98 transition-all"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>{isReturning ? '반납 마감 처리 중...' : '임차처 반납 확정 마감 실행'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 현장 투입 매핑 모달 (헌장 2.2, 3.4 & 과제 10) */}
      {isDeployModalOpen && targetAssetForDeploy && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-in slide-in-from-bottom duration-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <span className="font-black text-sm text-white flex items-center gap-1.5">
                  <Send className="w-4 h-4 text-sky-400" />
                  <span>전대 장비 현장 투입 매핑</span>
                </span>
                <div className="text-xs text-slate-400 mt-0.5">
                  {targetAssetForDeploy.assetNo} {targetAssetForDeploy.modelName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDeployModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 대상 고객사 선택 (헌장 3.4 상하 세로 스택) */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300 whitespace-nowrap">
                투입 고객사 *
              </label>
              <select
                value={deployCustomerId}
                onChange={(e) => handleDeployCustomerChange(e.target.value)}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="">고객사를 선택하십시오...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.representative ? `(대표: ${c.representative})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* 현장 선택 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300 whitespace-nowrap">
                투입 현장
              </label>
              <select
                value={deploySiteId}
                onChange={(e) => setDeploySiteId(e.target.value)}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="">현장 선택 (선택사항)...</option>
                {sites
                  .filter((s) => !deployCustomerId || s.customerId === deployCustomerId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.address ? `(${s.address})` : ''}
                    </option>
                  ))}
              </select>
            </div>

            {/* 투입 시작일 및 월 임대료 (헌장 2.2 계약 속성 상속) */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap">
                  투입 일자
                </label>
                <input
                  type="date"
                  value={deployStartDate}
                  onChange={(e) => setDeployStartDate(e.target.value)}
                  className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap">
                  월 렌탈료 (상속단가)
                </label>
                <input
                  type="number"
                  value={deployMonthlyRent}
                  onChange={(e) => setDeployMonthlyRent(parseInt(e.target.value, 10) || 0)}
                  className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* 안내 배너 */}
            <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-900/60 text-xs text-blue-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span>확인 시 자산 상태가 [대여중]으로 전환되며 계약 속성이 자동 상속됩니다.</span>
            </div>

            {/* 제출 버튼 */}
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setIsDeployModalOpen(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs active:scale-95"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isDeploying || !deployCustomerId}
                onClick={handleConfirmDeploy}
                className="flex-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg active:scale-95 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isDeploying ? '매핑 등록 중...' : '현장 투입 매핑 완료'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
