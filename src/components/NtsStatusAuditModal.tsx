// src/components/NtsStatusAuditModal.tsx
// 전사 등록 고객사/매입처 국세청 홈택스 사업자 휴폐업 전수 점검 및 렌탈 자산 보호 스튜디오

import React, { useState, useMemo, useRef } from 'react';
import { 
  X, Building2, Layers, Search, RefreshCw, AlertCircle, 
  CheckCircle2, ShieldAlert, Download, Play, Check, Truck, AlertTriangle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db, Customer, Vendor, DelinquencyActionLog, Todo } from '../services/db';
import { checkBatchNtsStatus, NtsStatusResult, formatBizNo } from '../services/ntsBusinessService';
import { exportToExcel } from '../services/excel';

interface NtsStatusAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTarget?: 'CUSTOMER' | 'VENDOR';
}

export const NtsStatusAuditModal: React.FC<NtsStatusAuditModalProps> = ({
  isOpen,
  onClose,
  initialTarget = 'CUSTOMER'
}) => {
  const { customers, vendors, assets, currentUser, saveCustomer, saveVendor, refreshAllData, showErrorModal } = useApp();

  const [targetType, setTargetType] = useState<'CUSTOMER' | 'VENDOR'>(initialTarget);
  const [filterType, setFilterType] = useState<'ALL' | 'CLOSED' | 'RENTED_RISK' | 'ACTIVE'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ processed: 0, total: 0 });
  const [scanResults, setScanResults] = useState<Map<string, NtsStatusResult>>(new Map());
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  // 1. 대상 목록 정제
  const targetItems = useMemo(() => {
    if (targetType === 'CUSTOMER') {
      return customers.map(c => {
        const cleanNo = (c.bizRegNo || '').replace(/[^0-9]/g, '');
        const rentedAssets = assets.filter(a => a.currentCustomerId === c.id && a.status === 'RENTED');
        const nts = scanResults.get(cleanNo);

        return {
          id: c.id,
          name: c.name,
          bizRegNo: c.bizRegNo,
          cleanNo,
          representative: c.representative,
          isClosed: c.isClosed,
          transactionStatus: c.transactionStatus,
          closedDate: c.closedDate,
          taxType: c.taxType,
          rentedCount: rentedAssets.length,
          rentedAssets,
          nts,
          rawEntity: c
        };
      });
    } else {
      return vendors.map(v => {
        const cleanNo = (v.bizRegNo || '').replace(/[^0-9]/g, '');
        const nts = scanResults.get(cleanNo);

        return {
          id: v.id,
          name: v.name,
          bizRegNo: v.bizRegNo,
          cleanNo,
          representative: v.representative,
          isClosed: !v.isActive,
          transactionStatus: v.isActive ? 'ALLOWED' : 'BLOCKED',
          closedDate: v.closedDate,
          taxType: v.taxType,
          rentedCount: 0,
          rentedAssets: [],
          nts,
          rawEntity: v
        };
      });
    }
  }, [targetType, customers, vendors, assets, scanResults]);

  // 2. 검색 및 필터링
  const filteredItems = useMemo(() => {
    return targetItems.filter(item => {
      const matchText = !searchTerm || 
        item.name.includes(searchTerm) || 
        item.cleanNo.includes(searchTerm) || 
        (item.representative || '').includes(searchTerm);

      if (!matchText) return false;

      const isNtsClosed = item.nts?.status === 'CLOSED' || (!item.nts && item.isClosed);
      const isRentedRisk = isNtsClosed && item.rentedCount > 0;

      if (filterType === 'CLOSED') return isNtsClosed;
      if (filterType === 'RENTED_RISK') return isRentedRisk;
      if (filterType === 'ACTIVE') return item.nts?.status === 'ACTIVE' || (!item.nts && !item.isClosed);
      return true;
    });
  }, [targetItems, searchTerm, filterType]);

  // 3. 상단 통계
  const stats = useMemo(() => {
    let active = 0;
    let closed = 0;
    let rentedRisk = 0;
    let suspended = 0;

    targetItems.forEach(item => {
      const status = item.nts?.status || (item.isClosed ? 'CLOSED' : 'ACTIVE');
      if (status === 'ACTIVE') active++;
      else if (status === 'CLOSED') {
        closed++;
        if (item.rentedCount > 0) rentedRisk++;
      } else if (status === 'SUSPENDED') {
        suspended++;
      }
    });

    return { total: targetItems.length, active, closed, rentedRisk, suspended };
  }, [targetItems]);

  // 4. 전수 점검 실행 (100건 단위 일괄 호출)
  const handleStartScan = async () => {
    if (isScanning) return;
    setIsScanning(true);

    const allBizNos = targetItems.map(i => i.cleanNo).filter(no => no.length === 10);
    setScanProgress({ processed: 0, total: allBizNos.length });

    try {
      const resultMap = await checkBatchNtsStatus(allBizNos, (processed, total) => {
        setScanProgress({ processed, total });
      });

      setScanResults(resultMap);
    } catch (err: any) {
      showErrorModal(`국세청 전수 상태 조회 중 오류: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  };

  // 5. 단건 폐업 조치 (출고차단 + 긴급 자산회수 ToDo 발행 + 감사로그)
  const handleApplySingleRestriction = async (item: typeof targetItems[0]) => {
    try {
      const closedDt = item.nts?.closedDate || item.closedDate || new Date().toISOString().slice(0, 10);
      const taxTp = item.nts?.taxType || item.taxType;

      if (targetType === 'CUSTOMER') {
        const cust = item.rawEntity as Customer;
        await saveCustomer({
          ...cust,
          isClosed: true,
          transactionStatus: 'BLOCKED',
          closedDate: closedDt,
          taxType: taxTp,
          businessStatus: 'CLOSED',
          lastStatusCheckDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        // 1) 사법 감사 로그 영구 기록
        db.insertRow<DelinquencyActionLog>('delinquencyActionLogs', {
          customerId: cust.id,
          actionType: 'LEGAL',
          actionDetails: `[국세청 전수점검] 폐업 확인(폐업일: ${closedDt})에 따른 직권 출고제한(BLOCKED) 조치 발효`,
          recordedBy: currentUser?.name || '시스템',
          mandateType: 'CEO_AUTO_MANDATE',
          createdAt: new Date().toISOString()
        });

        // 2) 가동 장비가 있는 경우 긴급 회수 ToDo 자동 발행
        if (item.rentedCount > 0) {
          db.insertRow<Todo>('todos', {
            userId: currentUser?.id || 'admin',
            targetType: 'DEPT',
            targetDept: '출고배차부',
            type: 'URGENT',
            priority: 'URGENT',
            title: `[🚨긴급] 폐업 고객사 가동장비 회수 지시: ${cust.name}`,
            content: `국세청 조회 결과 [${cust.name}]의 폐업(폐업일: ${closedDt})이 공식 확인되었습니다. 현재 현장에 투입된 ${item.rentedCount}대의 렌탈 자산에 대해 즉시 회수 배차 및 임대료 채권 회수를 집행하십시오.`,
            relatedEntityId: cust.id,
            isCompleted: false,
            createdAt: new Date().toISOString()
          });
        }
      } else {
        const vnd = item.rawEntity as Vendor;
        await saveVendor({
          ...vnd,
          isActive: false,
          closedDate: closedDt,
          taxType: taxTp,
          businessStatus: 'CLOSED',
          lastStatusCheckDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      await db.awaitPendingWrites();
      await refreshAllData();

      setAppliedIds(prev => new Set(prev).add(item.id));
    } catch (err: any) {
      showErrorModal(`상태 반영 실패: ${err?.message || err}`);
    }
  };

  // 6. 폐업 감지 전건 일괄 출고제한 및 회수 지시
  const handleApplyAllRestrictions = async () => {
    const closedItems = targetItems.filter(i => {
      const isNtsClosed = i.nts?.status === 'CLOSED';
      return isNtsClosed && !appliedIds.has(i.id);
    });

    if (closedItems.length === 0) return;

    for (const item of closedItems) {
      await handleApplySingleRestriction(item);
    }
  };

  // 7. 결과 엑셀 다운로드
  const handleExportExcel = () => {
    const excelData = targetItems.map((item, idx) => ({
      'No': idx + 1,
      '구분': targetType === 'CUSTOMER' ? '매출처(고객사)' : '매입처(협력사)',
      '거래처명': item.name,
      '사업자등록번호': formatBizNo(item.cleanNo),
      '대표자': item.representative || '-',
      '국세청상태': item.nts?.statusLabel || (item.isClosed ? '폐업자(ERP)' : '계속사업자'),
      '과세유형': item.nts?.taxType || item.taxType || '-',
      '폐업일자': item.nts?.closedDate || item.closedDate || '-',
      'ERP거래상태': item.transactionStatus === 'BLOCKED' ? '출고제한' : '정상거래',
      '가동장비수': item.rentedCount > 0 ? `${item.rentedCount}대 (위험)` : '0대',
      '최근조회일시': item.nts?.checkedAt?.slice(0, 16).replace('T', ' ') || '-'
    }));

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    exportToExcel(excelData, `국세청_휴폐업_전수점검결과_${dateStr}`, '전수점검');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl h-[92vh] max-h-[900px] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        
        {/* ─── ① 헤더 (Scope & Title) ─── */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-950/80 border border-blue-800/80 text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight whitespace-nowrap">
                  국세청 홈택스 사업자 휴폐업 전수 점검
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-300">
                  자산 부실/잠적 방어 스튜디오
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                등록된 전 거래처의 사업자 상태를 국세청 공적 전산과 1:1 대사하여 폐업 업체를 탐지하고 대여 장비를 긴급 보호합니다.
              </p>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose}
            disabled={isScanning}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ─── ② 파이프라인 및 필터 바 ─── */}
        <div className="px-5 py-3 bg-slate-900 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          {/* 좌측: 대상 선택 및 필터 탭 */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                disabled={isScanning}
                onClick={() => setTargetType('CUSTOMER')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  targetType === 'CUSTOMER'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>매출처 고객사 ({customers.length})</span>
              </button>
              <button
                type="button"
                disabled={isScanning}
                onClick={() => setTargetType('VENDOR')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  targetType === 'VENDOR'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>매입처 협력사 ({vendors.length})</span>
              </button>
            </div>

            {/* 필터 칩 */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setFilterType('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
                  filterType === 'ALL'
                    ? 'bg-slate-800 text-white border-slate-600'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                전체보기
              </button>
              <button
                type="button"
                onClick={() => setFilterType('RENTED_RISK')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap flex items-center gap-1 ${
                  filterType === 'RENTED_RISK'
                    ? 'bg-rose-950 text-rose-300 border-rose-700 font-black'
                    : 'bg-slate-950/60 text-rose-400 border-slate-800 hover:border-rose-900'
                }`}
              >
                <Truck className="w-3 h-3" />
                <span>장비 가동 중 폐업사 ({stats.rentedRisk})</span>
              </button>
              <button
                type="button"
                onClick={() => setFilterType('CLOSED')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
                  filterType === 'CLOSED'
                    ? 'bg-rose-900/60 text-rose-200 border-rose-600'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                폐업사 ({stats.closed})
              </button>
              <button
                type="button"
                onClick={() => setFilterType('ACTIVE')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
                  filterType === 'ACTIVE'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                정상 계속사 ({stats.active})
              </button>
            </div>
          </div>

          {/* 우측: 실행 버튼 및 검색창 */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="상호, 사업자번호 검색"
                className="pl-8 pr-3 py-1 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44"
              />
            </div>

            <button
              type="button"
              disabled={isScanning || targetItems.length === 0}
              onClick={handleStartScan}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition-all whitespace-nowrap disabled:opacity-40"
            >
              <Play className={`w-3.5 h-3.5 fill-current ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? `점검 중 (${scanProgress.processed}/${scanProgress.total})` : '국세청 전수 점검 시작'}</span>
            </button>
          </div>
        </div>

        {/* ─── ③ 진행 HUD 및 4대 KPI 요약 바 ─── */}
        <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap flex-shrink-0 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-sans text-[11px]">검사 대상:</span>
            <strong className="text-white">{stats.total}개사</strong>
            {scanResults.size > 0 && (
              <span className="text-slate-500 text-[11px]">
                (국세청 대사 완료: {scanResults.size}개사)
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-800 text-[11px] font-bold">
              정상 <strong>{stats.active}</strong>
            </span>
            <span className="px-2 py-0.5 rounded-md bg-amber-950 text-amber-300 border border-amber-800 text-[11px] font-bold">
              휴업 <strong>{stats.suspended}</strong>
            </span>
            <span className="px-2 py-0.5 rounded-md bg-rose-950 text-rose-300 border border-rose-800 text-[11px] font-bold">
              폐업 <strong>{stats.closed}</strong>
            </span>
            {stats.rentedRisk > 0 && (
              <span className="px-2.5 py-0.5 rounded-md bg-rose-600 text-white text-[11px] font-black animate-pulse flex items-center gap-1 shadow">
                <AlertTriangle className="w-3 h-3" />
                <span>가동장비 위험 {stats.rentedRisk}개사</span>
              </span>
            )}
          </div>
        </div>

        {/* ─── ④ 고밀도 실시간 대사 그리드 테이블 ─── */}
        <div className="flex-1 min-h-0 overflow-auto bg-slate-900/60 relative">
          <table className="w-full text-left border-collapse font-sans text-xs">
            <thead className="bg-slate-950 text-slate-400 font-bold sticky top-0 z-10 border-b border-slate-800">
              <tr className="h-9">
                <th className="px-3 py-1 text-center w-12 whitespace-nowrap flex-shrink-0">No.</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">거래처명</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">사업자등록번호</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">대표자</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">국세청 공식 상태</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">과세유형</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">폐업일자</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">대여중 장비</th>
                <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">ERP 상태</th>
                <th className="px-3 py-1 text-right whitespace-nowrap flex-shrink-0">원클릭 방어 조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-normal text-slate-300">
              {filteredItems.map((item, idx) => {
                const isNtsClosed = item.nts?.status === 'CLOSED';
                const isNtsActive = item.nts?.status === 'ACTIVE';
                const isNtsSuspended = item.nts?.status === 'SUSPENDED';
                const hasRentedRisk = (isNtsClosed || item.isClosed) && item.rentedCount > 0;
                const isAlreadyApplied = appliedIds.has(item.id) || item.transactionStatus === 'BLOCKED';

                return (
                  <tr 
                    key={item.id}
                    className={`h-9 hover:bg-slate-800/50 transition-colors ${
                      hasRentedRisk ? 'bg-rose-950/20' : ''
                    }`}
                  >
                    <td className="px-3 py-1 text-center font-mono text-slate-500 whitespace-nowrap">
                      {idx + 1}
                    </td>

                    <td className="px-3 py-1 font-bold text-white whitespace-nowrap max-w-[170px] truncate">
                      {item.name}
                    </td>

                    <td className="px-3 py-1 font-mono text-slate-300 whitespace-nowrap">
                      {formatBizNo(item.cleanNo)}
                    </td>

                    <td className="px-3 py-1 whitespace-nowrap">
                      {item.representative || '-'}
                    </td>

                    {/* 국세청 공식 상태 배지 */}
                    <td className="px-3 py-1 whitespace-nowrap">
                      {isNtsClosed ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-950 border border-rose-800 text-rose-300">
                          <AlertCircle className="w-3 h-3" />
                          <span>폐업자</span>
                        </span>
                      ) : isNtsSuspended ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-950 border border-amber-800 text-amber-300">
                          <span>휴업자</span>
                        </span>
                      ) : isNtsActive ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-950 border border-emerald-800 text-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>계속사업자</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-slate-500 bg-slate-800/60">
                          <span>{item.isClosed ? '폐업(기록)' : '미조회'}</span>
                        </span>
                      )}
                    </td>

                    {/* 과세유형 */}
                    <td className="px-3 py-1 text-slate-400 text-[11px] whitespace-nowrap max-w-[140px] truncate">
                      {item.nts?.taxType || item.taxType || '-'}
                    </td>

                    {/* 폐업일자 */}
                    <td className="px-3 py-1 font-mono text-slate-300 whitespace-nowrap">
                      {item.nts?.closedDate || item.closedDate || '-'}
                    </td>

                    {/* 가동 장비수 */}
                    <td className="px-3 py-1 whitespace-nowrap">
                      {item.rentedCount > 0 ? (
                        <span className={`px-2 py-0.5 rounded-full font-mono font-bold text-[11px] flex items-center gap-1 ${
                          isNtsClosed || item.isClosed
                            ? 'bg-rose-600 text-white font-black animate-pulse'
                            : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        }`}>
                          <Truck className="w-3 h-3" />
                          <span>{item.rentedCount}대 가동</span>
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px] font-mono">0대</span>
                      )}
                    </td>

                    {/* ERP 거래상태 */}
                    <td className="px-3 py-1 whitespace-nowrap">
                      {item.transactionStatus === 'BLOCKED' ? (
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 text-[10px] font-bold">
                          출고제한
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 text-[10px]">
                          정상거래
                        </span>
                      )}
                    </td>

                    {/* 원클릭 방어 조치 버튼 */}
                    <td className="px-3 py-1 text-right whitespace-nowrap">
                      {isNtsClosed && !isAlreadyApplied ? (
                        <button
                          type="button"
                          onClick={() => handleApplySingleRestriction(item)}
                          className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1 active:scale-95 shadow ml-auto"
                        >
                          <ShieldAlert className="w-3 h-3" />
                          <span>출고제한/회수 지시</span>
                        </button>
                      ) : isAlreadyApplied ? (
                        <span className="text-slate-500 text-[11px] flex items-center justify-end gap-0.5">
                          <Check className="w-3 h-3 text-emerald-400" /> 조치완료
                        </span>
                      ) : (
                        <span className="text-slate-600 text-[11px]">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ─── ⑤ 우하단 마감 바 (Terminal Action) ─── */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
            <span>표시: <strong className="text-white">{filteredItems.length}개사</strong></span>
            {stats.rentedRisk > 0 && (
              <span className="text-rose-400 font-bold">
                (🚨 장비 가동 중 폐업 {stats.rentedRisk}개사 즉시 회수 필요)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {stats.closed > 0 && (
              <button
                type="button"
                onClick={handleApplyAllRestrictions}
                className="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 shadow active:scale-95 transition-all whitespace-nowrap"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>폐업 감지사 전건 출고제한/회수 일괄 적용</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>결과 엑셀 다운로드</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold active:scale-95 transition-all whitespace-nowrap"
            >
              확인 및 닫기
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
