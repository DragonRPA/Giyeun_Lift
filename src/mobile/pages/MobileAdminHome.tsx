// src/mobile/pages/MobileAdminHome.tsx
import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Building2, Calendar, CheckCircle2, AlertCircle, ArrowRight, 
  Search, Phone, FileText, Check, Clock, Truck, Layers, Car, Fuel 
} from 'lucide-react';
import { MobileTabType } from '../MobileBottomNav';
import { db, BankTransaction } from '../../services/db';

interface MobileAdminHomeProps {
  onNavigate: (tab: MobileTabType) => void;
}

export const MobileAdminHome: React.FC<MobileAdminHomeProps> = ({ onNavigate }) => {
  const { 
    customers, 
    billings, 
    sites, 
    currentUser, 
    deliveries, 
    assets,
    bankTransactions,
    matchTransactionManual,
    showErrorModal
  } = useApp();
  const [toast, setToast] = useState<string | null>(null);

  // 전대 장비 및 주기장 유휴 누수 건수
  const subleaseAssets = useMemo(() => (assets || []).filter(a => a.ownerType === 'RENTED'), [assets]);
  const subleaseLeakCount = useMemo(() => {
    return subleaseAssets.filter(a => !a.actualRentReturnDate && a.status !== 'RENTED_RETURNED' && a.status !== 'RENTED').length;
  }, [subleaseAssets]);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // 1. 오늘/이번 주 마감 도래 업체 목록 및 D-Day 실연산 (헌장 1.1 & 과제 8)
  const closingDueCustomers = useMemo(() => {
    const today = new Date();
    const currentDay = today.getDate();
    return customers
      .map(c => {
        const closing = c.defaultBillingDay || c.defaultStatementClosingDay;
        if (!closing) return null;
        const diff = closing - currentDay;
        return {
          ...c,
          closingDay: closing,
          diffDays: diff,
          dDayText: diff === 0 ? 'D-Day' : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)} (경과)`
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null && Math.abs(item.diffDays) <= 5)
      .sort((a, b) => a.diffDays - b.diffDays)
      .slice(0, 5);
  }, [customers]);

  // 2. 미수 청구서
  const unpaidBillings = useMemo(() => {
    return billings
      .filter(b => Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0)) > 0)
      .map(b => {
        const cust = customers.find(c => c.id === b.customerId);
        return {
          ...b,
          customerName: cust?.name || '거래처',
          unpaidAmount: Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0))
        };
      })
      .slice(0, 5);
  }, [billings, customers]);

  // 3. 통장 실데이터 미매칭 입금 건 (헌장 1.2 & 과제 8)
  const unmatchedDeposits = useMemo(() => {
    return (bankTransactions || [])
      .filter(tx => (tx.depositAmount || 0) > 0 && !tx.matchedBillingId)
      .slice(0, 5);
  }, [bankTransactions]);

  // 통장 입금 실데이터 1:1 수납 매칭 승인 (헌장 5.2 준수)
  const handleBankMatchConfirm = async (tx: BankTransaction) => {
    try {
      const matchedCust = customers.find(c => 
        tx.senderName.includes(c.name) || c.name.includes(tx.senderName)
      );
      
      const activeBilling = matchedCust 
        ? billings.find(b => b.customerId === matchedCust.id && (b.totalAmount - (b.paidAmount || 0)) > 0)
        : billings.find(b => (b.totalAmount - (b.paidAmount || 0)) === tx.depositAmount);

      if (!activeBilling) {
        showErrorModal(`[${tx.senderName}] 매칭 대상 청구서를 자동으로 찾을 수 없습니다. PC 통장 대사 메뉴에서 수동 지정하십시오.`);
        return;
      }

      matchTransactionManual(tx.id, activeBilling.id, true);
      await db.awaitPendingWrites(); // 헌장 5.2 동기 검증
      triggerToast(`[${tx.senderName}] ₩${tx.depositAmount.toLocaleString()}원 매칭 승인 완료`);
    } catch (err: any) {
      showErrorModal(`매칭 승인 실패: ${err?.message || 'DB 에러'}`);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-24 p-4 font-sans text-slate-100">
      {/* 토스트 */}
      {toast && (
        <div 
          style={{
            position: 'fixed',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            padding: '10px 18px',
            borderRadius: '12px',
            backgroundColor: '#065f46',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: '700',
            boxShadow: '0 10px 25px rgba(0,0,0,0.4)'
          }}
        >
          {toast}
        </div>
      )}

      {/* ── 1. 상단 관리 피드 헤더 ── */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950/60 to-slate-950 border border-blue-500/30 rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-sky-400 tracking-wider flex items-center gap-1.5">
            <Building2 className="w-4 h-4" />
            <span>관리부 정산 & 수납 피드</span>
          </span>
          <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
          </span>
        </div>
        <h2 className="text-xl font-black text-white leading-tight">
          {currentUser?.name || '관리담당'}님,<br />
          마감 임박 <span className="text-sky-400 font-mono">{closingDueCustomers.length}개사</span> • 미수 채권 관리
        </h2>
      </div>

      {/* ── 전대 장비 운용 & 원사 반납 관제 퀵 배너 (신규) ── */}
      <div
        onClick={() => onNavigate('sublease')}
        className={`p-4 rounded-2xl border flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-lg ${
          subleaseLeakCount > 0 
            ? 'bg-gradient-to-r from-rose-950/60 via-slate-900 to-slate-900 border-rose-500/50 ring-1 ring-rose-500/30' 
            : 'bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950/40 border-slate-800'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            subleaseLeakCount > 0 
              ? 'bg-rose-600/20 border border-rose-500/40 text-rose-400' 
              : 'bg-sky-600/20 border border-sky-500/30 text-sky-400'
          }`}>
            <Layers className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>전대 장비 운용 & 반납 관제</span>
              <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                {subleaseAssets.length}대
              </span>
              {subleaseLeakCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white animate-pulse">
                  누수경보 {subleaseLeakCount}대
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              {subleaseLeakCount > 0 
                ? `🚨 주기장 미반납 유휴 장비 ${subleaseLeakCount}대 방치 중!` 
                : '외부 원사 임차 장비 및 반납 기한 관리'}
            </div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-slate-500" />
      </div>

      {/* ── 배차 상차 관제 퀵 배너 (관리부 이동 탑재) ── */}
      <div
        onClick={() => onNavigate('dispatch')}
        className="p-4 rounded-2xl bg-gradient-to-r from-blue-950/60 to-slate-900 border border-blue-500/30 flex items-center justify-between active:scale-98 transition-all cursor-pointer shadow-lg"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-sky-400">
            <Truck className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>배차 운송 & 상차 관제</span>
              <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                {(deliveries || []).filter(d => d.status === 'PENDING' || d.status === 'REQUESTED' || d.status === 'DISPATCHED').length}건
              </span>
            </div>
            <div className="text-xs text-slate-400">화물 트럭 기사 배정 및 상차 완료 승인</div>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-slate-500" />
      </div>

      {/* ── 2. 통장 입금 1:1 즉시 수납 매칭 카드 (실데이터 연동 - 과제 8) ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>통장 입금 1:1 수납 대사</span>
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">
            대사 대기 <span className="text-emerald-400 font-bold">{unmatchedDeposits.length}건</span>
          </span>
        </div>

        {unmatchedDeposits.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500 bg-slate-950 rounded-xl">
            미대사 통장 입금 내역이 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {unmatchedDeposits.map((tx) => (
              <div key={tx.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                <div className="min-w-0 pr-2">
                  <div className="font-bold text-white flex items-center gap-1.5 truncate">
                    <span className="text-sky-400 font-mono flex-shrink-0">[{tx.bankName || '통장'}]</span>
                    <span className="truncate">{tx.senderName || tx.counterparty || '미확인'}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                    입금: <span className="text-emerald-400 font-bold">₩{tx.depositAmount.toLocaleString()}원</span>
                    {tx.transactionDate && <span className="text-slate-500 ml-1.5">({tx.transactionDate.slice(5, 10)})</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleBankMatchConfirm(tx)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex-shrink-0 active:scale-95 transition-transform"
                >
                  매칭승인
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 3. 업체별 마감 도래 현황 (D-Day 실연산 - 과제 8) ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-sky-400" />
            <span>마감 도래 거래처 (D-Day)</span>
          </h3>
          <span className="text-[11px] text-sky-400">발송 관제</span>
        </div>

        {closingDueCustomers.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500 bg-slate-950 rounded-xl">
            이번 주 마감 도래 거래처가 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {closingDueCustomers.map(c => {
              return (
                <div key={c.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <span>{c.name}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                        c.diffDays === 0 
                          ? 'bg-rose-600 text-white animate-pulse' 
                          : c.diffDays > 0 
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' 
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {c.dDayText}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      약정 마감일: 매월 {c.closingDay}일 • 이메일: {c.repEmail || '미등록'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (c.repEmail) {
                        triggerToast(`[${c.name}] (${c.repEmail}) 청구명세서 발송 큐에 등록되었습니다.`);
                      } else {
                        triggerToast(`[${c.name}] 담당자 이메일이 미등록되어 있습니다. 고객관리에서 이메일을 등록하십시오.`);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600/80 hover:bg-blue-600 text-white font-bold text-xs active:scale-95"
                  >
                    명세서발송
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 4. 미수채권 관리 피드 ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            <span>미수금 회수 관리</span>
          </h3>
          <span className="text-[11px] text-slate-500">미수 건수 {unpaidBillings.length}건</span>
        </div>

        <div className="flex flex-col gap-2">
          {unpaidBillings.map(b => (
            <div key={b.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-white">{b.customerName}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">청구월: {b.billingYm || b.billingDate?.slice(0, 7) || '당월'}</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-rose-400">₩{b.unpaidAmount.toLocaleString()}원</div>
                <div className="text-[10px] text-slate-500">미납잔액</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5. 법인차량 주유영수증 촬영 ── */}
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
    </div>
  );
};
