// src/mobile/pages/MobileMyContracts.tsx
import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Building2, MapPin, Phone, Calendar, Clock, Layers, 
  Search, ChevronRight, AlertCircle, Wrench, X, Copy, Navigation
} from 'lucide-react';
import { matchHangul } from '../../utils/hangulSearch';
import { launchNavigation, copyToClipboard } from '../../utils/nativeLauncher';
import { formatContractEndDate, isIndefiniteEndDate } from '../../services/db';

interface MobileMyContractsProps {
  onOpenCreateAsForAsset?: (assetNo: string, siteId: string) => void;
}

export const MobileMyContracts: React.FC<MobileMyContractsProps> = ({ onOpenCreateAsForAsset }) => {
  const { contracts, contractAssets, customers, sites, assets, currentUser } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [selectedContract, setSelectedContract] = useState<any | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // 더블터치 감지용 Ref
  const lastTapRef = useRef<{ time: number; id: string }>({ time: 0, id: '' });

  const handleCardTap = (c: any) => {
    const now = Date.now();
    if (lastTapRef.current.id === c.id && (now - lastTapRef.current.time) < 350) {
      setSelectedContract(c);
      lastTapRef.current = { time: 0, id: '' };
    } else {
      lastTapRef.current = { time: now, id: c.id };
    }
  };

  // 오늘 날짜
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // 계약 리스트 정제
  const myContractList = useMemo(() => {
    // 1. 활성 계약 필터링
    return contracts
      .filter(c => {
        if (filterStatus === 'ACTIVE' && c.status !== 'ACTIVE' && c.status !== 'EXTENDED') {
          return false;
        }
        if (searchTerm.trim()) {
          const q = searchTerm.trim();
          const cust = customers.find(cu => cu.id === c.customerId);
          const site = sites.find(s => s.id === c.siteId);
          const custName = cust?.name || '';
          const siteName = site?.name || '';
          const contractNo = c.contractNo || '';
          return matchHangul(custName, q) || matchHangul(siteName, q) || contractNo.toLowerCase().includes(q.toLowerCase());
        }
        return true;
      })
      .map(c => {
        const cust = customers.find(cu => cu.id === c.customerId);
        const site = sites.find(s => s.id === c.siteId);
        // 계약에 매핑된 자산들
        const myCas = contractAssets.filter(ca => ca.contractId === c.id);
        const assignedAssets = myCas.map(ca => {
          const ast = assets.find(a => a.id === ca.assetId);
          return {
            caId: ca.id,
            assetNo: ast?.assetNo || ca.expectedModel || '미지정',
            modelName: ast?.modelName || ca.expectedModel || '-',
            status: ast?.status || 'ASSIGNED'
          };
        });

        // 만료 D-Day 계산
        let dDayText = '';
        let isUrgent = false;
        if (c.endDate && !isIndefiniteEndDate(c.endDate)) {
          const diffDays = Math.ceil((new Date(c.endDate).getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) {
            dDayText = `만료도과 (${Math.abs(diffDays)}일)`;
            isUrgent = true;
          } else if (diffDays <= 3) {
            dDayText = `만료임박 (D-${diffDays})`;
            isUrgent = true;
          } else {
            dDayText = `D-${diffDays}`;
          }
        } else {
          dDayText = '미정';
        }

        return {
          ...c,
          customerName: cust?.name || '거래처',
          siteName: site?.name || '현장',
          siteAddress: site?.address || '',
          siteContact: site?.contactName || '',
          sitePhone: site?.contact || '',
          assignedAssets,
          dDayText,
          isUrgent
        };
      });
  }, [contracts, contractAssets, customers, sites, assets, filterStatus, searchTerm, todayStr]);

  return (
    <div className="flex flex-col gap-3.5 pb-24 p-4 font-sans text-slate-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-400" />
            <span>내 계약 & 투입 현장</span>
          </h2>
          <div className="text-[11px] text-slate-400 mt-0.5">
            가동 중 계약 {myContractList.length}건
          </div>
        </div>

        {/* 상태 필터 토글 */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setFilterStatus('ACTIVE')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
              filterStatus === 'ACTIVE'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400'
            }`}
          >
            가동중
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('ALL')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
              filterStatus === 'ALL'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400'
            }`}
          >
            전체
          </button>
        </div>
      </div>

      {/* 검색창 */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="거래처명, 현장명, 계약번호 검색..."
          className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-9 pr-4 text-xs text-white placeholder-slate-500"
        />
      </div>

      {/* 계약 목록 */}
      <div className="flex flex-col gap-3">
        {myContractList.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">
            조회된 계약 내역이 없습니다.
          </div>
        ) : (
          myContractList.map(c => (
            <div 
              key={c.id} 
              onClick={() => handleCardTap(c)}
              onDoubleClick={() => setSelectedContract(c)}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 active:border-blue-500/50 rounded-2xl p-4 flex flex-col gap-3 shadow-lg cursor-pointer transition-all select-none"
            >
              {/* 상단: 고객사 & 현장명 & D-Day & 상세 버튼 */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-bold text-blue-400">{c.customerName}</div>
                  <h3 className="text-sm font-black text-white mt-0.5">{c.siteName}</h3>
                  {c.siteAddress && (
                    <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
                      <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      <span className="line-clamp-1">{c.siteAddress}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {c.dDayText && (
                    <span className={`px-2 py-0.5 rounded-lg text-[10.5px] font-black border whitespace-nowrap ${
                      c.isUrgent
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    }`}>
                      {c.dDayText}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedContract(c);
                    }}
                    className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-all flex-shrink-0"
                    title="현장 상세 보기"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 투입 장비 목록 */}
              <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex flex-col gap-1.5">
                <div className="text-[11px] font-bold text-slate-400 flex items-center justify-between">
                  <span>투입 장비 ({c.assignedAssets.length}대)</span>
                  <span className="text-[10px] text-slate-500">{c.startDate} ~ {formatContractEndDate(c.endDate)}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-1">
                  {c.assignedAssets.length === 0 ? (
                    <span className="text-[11px] text-slate-500">배정 진행 중...</span>
                  ) : (
                    c.assignedAssets.map((ast, i) => (
                      <span 
                        key={i}
                        className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-slate-200 flex items-center gap-1"
                      >
                        <span className="text-sky-400">{ast.assetNo}</span>
                        <span className="text-[10px] text-slate-400 font-sans font-normal">({ast.modelName})</span>
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* 현장 담당자 및 원터치 전화걸기 */}
              {c.sitePhone && (
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-xs">
                  <span className="text-slate-400">
                    현장소장: <strong className="text-slate-200">{c.siteContact || '담당자'}</strong>
                  </span>
                  <a
                    href={`tel:${c.sitePhone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30 active:scale-95 transition-all flex-shrink-0"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>통화하기</span>
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── 현장 상세 모달 (카드 더블터치 시 오픈) ── */}
      {selectedContract && (() => {
        const siteObj = sites.find(s => s.id === selectedContract.siteId);
        return (
          <div 
            className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3"
            onClick={() => setSelectedContract(null)}
          >
            <div 
              className="w-full max-w-md max-h-[88dvh] bg-slate-900 border border-slate-700 rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 모달 헤더 */}
              <div className="px-4 py-3.5 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1.5 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400 flex-shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="text-[11px] font-bold text-blue-400 truncate">
                        {selectedContract.customerName}
                      </div>
                      {customers.find(cu => cu.id === selectedContract.customerId)?.transactionStatus === 'BLOCKED' && (
                        <span className="px-1.5 py-0.2 text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded flex-shrink-0">
                          출고제한
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-black text-white truncate">
                      {selectedContract.siteName}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedContract(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-all flex-shrink-0"
                  title="닫기"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 모달 본문 (스크롤) */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 text-xs">
                
                {/* 1. 계약 기본 정보 카드 */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400">계약 정보</span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                      selectedContract.status === 'ACTIVE'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}>
                      {selectedContract.status === 'ACTIVE' ? '가동중' : selectedContract.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11.5px] mt-1">
                    <div>
                      <div className="text-[10px] text-slate-500">계약번호</div>
                      <div className="font-mono font-bold text-slate-200 truncate">{selectedContract.contractNo}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">계약기간</div>
                      <div className="font-bold text-slate-200">
                        {selectedContract.startDate} ~ {formatContractEndDate(selectedContract.endDate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">청구 마감일</div>
                      <div className="font-bold text-slate-200">매월 {selectedContract.billingDay || 30}일</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">약정 결제일</div>
                      <div className="font-bold text-slate-200">매월 {selectedContract.paymentDueDay || 25}일</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">월 렌탈료 (단가합)</div>
                      <div className="font-mono font-bold text-emerald-400">
                        ₩{((selectedContract.items || []).reduce((s: number, it: any) => s + (it.monthlyRentalFee || 0), 0) || selectedContract.monthlyRentalFee || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">일 렌탈료 (단가합)</div>
                      <div className="font-mono font-bold text-slate-300">
                        ₩{((selectedContract.items || []).reduce((s: number, it: any) => s + (it.dailyRentalFee || 0), 0) || selectedContract.dailyRentalFee || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">만료 상태</div>
                      <div className="font-bold text-amber-300">{selectedContract.dDayText || '-'}</div>
                    </div>
                  </div>
                </div>

                {/* 2. 현장 도로명 주소 & 원터치 길안내 */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
                  <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-blue-400" />
                    <span>현장 위치</span>
                  </div>
                  <div className="text-xs text-slate-200 leading-relaxed break-all bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                    {selectedContract.siteAddress || '등록된 도로명 주소가 없습니다.'}
                  </div>

                  {selectedContract.siteAddress && (
                    <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => launchNavigation(selectedContract.siteAddress, 'TMAP')}
                        className="flex items-center justify-center gap-1 py-2 px-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-bold text-[11px] active:scale-95 transition-all"
                      >
                        <Navigation className="w-3 h-3" />
                        <span>T맵</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => launchNavigation(selectedContract.siteAddress, 'KAKAO')}
                        className="flex items-center justify-center gap-1 py-2 px-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-bold text-[11px] active:scale-95 transition-all"
                      >
                        <Navigation className="w-3 h-3" />
                        <span>카카오내비</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyToClipboard(selectedContract.siteAddress);
                          if (ok) {
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }
                        }}
                        className="flex items-center justify-center gap-1 py-2 px-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-[11px] active:scale-95 transition-all"
                      >
                        <Copy className="w-3 h-3" />
                        <span>{isCopied ? '복사완료' : '주소복사'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 3. 현장 담당자 및 원터치 통화 */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
                  <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-emerald-400" />
                    <span>현장 담당자</span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                    <div>
                      <div className="font-bold text-slate-200">
                        {selectedContract.siteContact || '담당자 미지정'}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {selectedContract.sitePhone || '연락처 미등록'}
                      </div>
                    </div>
                    {selectedContract.sitePhone && (
                      <a
                        href={`tel:${selectedContract.sitePhone}`}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs shadow-md active:scale-95 transition-all flex-shrink-0"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>통화</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* 4. 투입 장비 목록 & 개별 AS 접수 */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-sky-400" />
                      <span>투입 장비 ({selectedContract.assignedAssets.length}대)</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 mt-1">
                    {selectedContract.assignedAssets.length === 0 ? (
                      <div className="text-center py-4 text-slate-500 text-xs">
                        배정된 장비가 없습니다.
                      </div>
                    ) : (
                      selectedContract.assignedAssets.map((ast: any, idx: number) => (
                        <div 
                          key={idx}
                          className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-sm text-sky-400">
                              {ast.assetNo}
                            </span>
                            <span className="text-[11px] text-slate-300">
                              {ast.modelName}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                              {ast.status}
                            </span>
                          </div>

                          {onOpenCreateAsForAsset && ast.assetNo !== '미지정' && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenCreateAsForAsset(ast.assetNo, selectedContract.siteId);
                                setSelectedContract(null);
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-[11px] font-bold active:scale-95 transition-all"
                            >
                              <Wrench className="w-3 h-3" />
                              <span>AS접수</span>
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 5. 현장 특이사항 / 옵션 (있을 경우만) */}
                {(siteObj?.paidOptions || siteObj?.protection) && (
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
                    <div className="text-[11px] font-bold text-slate-400">현장 특이사항</div>
                    {siteObj?.paidOptions && (
                      <div className="text-xs text-slate-300">
                        <span className="text-slate-500 mr-2">유상옵션:</span>
                        {siteObj.paidOptions}
                      </div>
                    )}
                    {siteObj?.protection && (
                      <div className="text-xs text-slate-300">
                        <span className="text-slate-500 mr-2">보양작업:</span>
                        {siteObj.protection}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 모달 푸터 */}
              <div className="px-4 py-3 bg-slate-800/90 border-t border-slate-700 flex justify-end flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedContract(null)}
                  className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs transition-all active:scale-98"
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
