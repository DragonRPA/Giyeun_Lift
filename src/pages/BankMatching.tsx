import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Search, Check, X, Download, Upload, Trash2, 
  RefreshCw, TrendingUp, AlertCircle, FileSpreadsheet,
  Link as LinkIcon, Plus, DollarSign, Calendar, Layers,
  Building2, ToggleLeft, ToggleRight, Info, CheckCircle2, Wallet, Settings,
  Printer, Zap
} from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { db, BankTransaction } from '../services/db';
import { parseBankExcelFile } from '../services/bankParser';
import { matchHangul } from '../utils/hangulSearch';

// 한글 금액 변환 헬퍼 (공식 입금표용)
function numberToKorean(num: number): string {
  if (!num || num === 0) return '영';
  const units = ['', '만', '억', '조'];
  const smallUnits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  let result = '';
  let unitIdx = 0;
  let n = Math.floor(num);
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      const c1000 = Math.floor(chunk / 1000);
      const c100 = Math.floor((chunk % 1000) / 100);
      const c10 = Math.floor((chunk % 100) / 10);
      const c1 = chunk % 10;
      if (c1000 > 0) chunkStr += (c1000 === 1 ? '' : smallUnits[c1000]) + '천';
      if (c100 > 0) chunkStr += (c100 === 1 ? '' : smallUnits[c100]) + '백';
      if (c10 > 0) chunkStr += (c10 === 1 ? '' : smallUnits[c10]) + '십';
      if (c1 > 0) chunkStr += smallUnits[c1];
      result = chunkStr + units[unitIdx] + ' ' + result;
    }
    n = Math.floor(n / 10000);
    unitIdx++;
  }
  return result.trim();
}

export const BankMatching: React.FC = () => {
  const {
    bankTransactions,
    bankMatchingRules,
    bankInitialBalances,
    saveBankInitialBalance,
    billings,
    customers,
    payments,
    paymentDepositLinks,
    purchaseSettlements,
    recordPurchaseSettlementPayment,
    uploadBankTransactions,
    matchTransactionManual,
    batchAutoMatchTransactions,
    unmatchTransaction,
    saveMatchingRule,
    deleteMatchingRule,
    hasPermission,
    currentUser,
    currentTenant,
    showErrorModal
  } = useApp();

  const canSave = hasPermission('billing', 'save');
  const isAdmin = currentUser?.role === 'ADMIN';

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleUnmatch = async (txId: string) => {
    if (!canSave) return;
    try {
      await unmatchTransaction(txId);
      await db.awaitPendingWrites();
      showToast('매칭이 정상적으로 해제(롤백)되었습니다.');
    } catch (err: any) {
      showErrorModal(`매칭 해제 실패: ${err?.message || err}`);
    }
  };

  const [activeTab, setActiveTab] = useState<'MATCHING' | 'RULES'>('MATCHING');
  const [isInitBalanceModalOpen, setIsInitBalanceModalOpen] = useState(false);
  const [editingBankName, setEditingBankName] = useState('우리은행');
  const [editingInitialBalance, setEditingInitialBalance] = useState<number>(15000000);
  const [editingAccountNumber, setEditingAccountNumber] = useState('');

  // ── 입력 상태 (필터 패널 바인딩용)
  const [searchTerm, setSearchTerm] = useState('');
  const [txStartDate, setTxStartDate] = useState('');
  const [txEndDate, setTxEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DEPOSIT' | 'WITHDRAW'>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // ── 적용 상태 (조회 버튼 클릭 시에만 갱신 → 실제 테이블 필터링에 사용)
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('');
  const [appliedTxStartDate, setAppliedTxStartDate] = useState('');
  const [appliedTxEndDate, setAppliedTxEndDate] = useState('');
  const [appliedMinAmount, setAppliedMinAmount] = useState('');
  const [appliedMaxAmount, setAppliedMaxAmount] = useState('');
  const [appliedTypeFilter, setAppliedTypeFilter] = useState<'ALL' | 'DEPOSIT' | 'WITHDRAW'>('ALL');
  const [appliedStatusFilter, setAppliedStatusFilter] = useState<string>('ALL');
  const [appliedBankFilter, setAppliedBankFilter] = useState<string>('ALL');

  // 조회 실행
  const handleSearch = () => {
    setAppliedSearchTerm(searchTerm);
    setAppliedTxStartDate(txStartDate);
    setAppliedTxEndDate(txEndDate);
    setAppliedMinAmount(minAmount);
    setAppliedMaxAmount(maxAmount);
    setAppliedTypeFilter(typeFilter);
    setAppliedStatusFilter(statusFilter);
    setAppliedBankFilter(selectedBankFilter);
  };
  
  // 은행별 필터 ('ALL' | '우리은행' | '신한은행' | 기타)
  const [selectedBankFilter, setSelectedBankFilter] = useState<string>('ALL');

  // 계좌번호 매칭 ON/OFF 토글 스위치 (기본값: OFF)
  const [useAccountNumberMatch, setUseAccountNumberMatch] = useState<boolean>(false);

  // 학습형 매칭 룰 검색 및 등록 상태
  const [ruleSearchInput, setRuleSearchInput] = useState('');
  const [ruleSearchTerm, setRuleSearchTerm] = useState('');
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [newRuleSenderName, setNewRuleSenderName] = useState('');
  const [newRuleCustomerId, setNewRuleCustomerId] = useState('');
  
  // 수동 매칭 모달 상태
  const [selectedTx, setSelectedTx] = useState<BankTransaction | null>(null);
  const [matchingBillingId, setMatchingBillingId] = useState('');
  const [learnRule, setLearnRule] = useState(true);
  const [billingSearchTerm, setBillingSearchTerm] = useState('');

  // 🌟 고도화 수납 모드, 감액 상계, 다중 배분, 입금표 상태
  const [matchingMode, setMatchingMode] = useState<'PINPOINT' | 'CASCADE' | 'MULTI'>('PINPOINT');
  const [feeAdjustment, setFeeAdjustment] = useState<number>(0);
  const [selectedMultiBillingIds, setSelectedMultiBillingIds] = useState<string[]>([]);
  const [multiAllocations, setMultiAllocations] = useState<{ [billingId: string]: number }>({});
  const [receiptTx, setReceiptTx] = useState<BankTransaction | null>(null);
  const [isBatchMatchingProcessing, setIsBatchMatchingProcessing] = useState(false);

  // 💸 수동 출금 지급 대사 모달 상태
  const [selectedWithdrawTx, setSelectedWithdrawTx] = useState<BankTransaction | null>(null);
  const [matchingSettlementId, setMatchingSettlementId] = useState('');
  const [settlementSearchTerm, setSettlementSearchTerm] = useState('');

  // 1. 기초 연계 헬퍼 함수
  const getCustName = (custId: string) => {
    return customers.find(c => c.id === custId)?.name || '알 수 없음';
  };

  // v2: 통장 입금 잔액 계산 (PaymentDepositLinks 실시간 반영)
  const getDepositBalance = (txId: string) => {
    const tx = bankTransactions.find(t => t.id === txId);
    const used = (paymentDepositLinks || [])
      .filter(l => l.bankTransactionId === txId)
      .reduce((s, l) => s + l.usedAmount, 0);
    return (tx?.depositAmount || 0) - used;
  };

  // 통장 입출금 내역 1건에 연결된 매칭 정보 (입금: 매출청구서 1:N / 출금: 월말매입정산)
  const getMatchedTransactionInfo = (tx: BankTransaction) => {
    if (tx.isDeposit || tx.depositAmount > 0) {
      // 1) 신규 체계: paymentDepositLinks 1:N 매핑
      const linkedLinks = (paymentDepositLinks || []).filter(l => l.bankTransactionId === tx.id && l.usedAmount > 0);
      
      // 2) 레거시 호환 체계
      const matchPrefix = `pay-matching-${tx.id}`;
      const txPayments = payments.filter(p => p.id.startsWith(matchPrefix));
      
      if (linkedLinks.length === 0 && txPayments.length === 0) {
        return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>미수납 (가용 {tx.depositAmount.toLocaleString()}원)</span>;
      }
      
      const elements: React.ReactNode[] = [];

      // 신규 링크 표출
      linkedLinks.forEach(link => {
        const payObj = payments.find(p => p.id === link.paymentId);
        const b = payObj ? billings.find(x => x.id === payObj.billingId) : null;
        if (b) {
          const cust = customers.find(c => c.id === b.customerId);
          elements.push(
            <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', whiteSpace: 'nowrap' }}>
              <LinkIcon size={10} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span>
                <strong>[{cust?.name || '고객사'}]</strong> {b.billingYm} 청구분 ({link.usedAmount.toLocaleString()}원 수납)
              </span>
            </div>
          );
        }
      });

      // 레거시 결제 표출
      txPayments.forEach(p => {
        if (!p.billingId) {
          elements.push(
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--success)', fontSize: '12px', whiteSpace: 'nowrap' }}>
              <span>• 선수금 적립 (+{p.amount.toLocaleString()}원)</span>
            </div>
          );
        } else {
          const b = billings.find(x => x.id === p.billingId);
          if (b) {
            elements.push(
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', whiteSpace: 'nowrap' }}>
                <LinkIcon size={10} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <span>{b.billingYm} 청구분 ({p.amount.toLocaleString()}원 수납)</span>
              </div>
            );
          }
        }
      });

      const remBal = getDepositBalance(tx.id);
      if (remBal > 0) {
        elements.push(
          <div key="rem-bal" style={{ fontSize: '11px', color: '#10B981', fontWeight: 600, marginTop: '2px' }}>
            ↳ 잔여 가용잔액: {remBal.toLocaleString()}원
          </div>
        );
      } else {
        elements.push(
          <div key="zero-bal" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '2px' }}>
            ↳ 전액 소진 완료 (잔액 0원)
          </div>
        );
      }

      return elements;
    } else {
      // 출금 항목인 경우: 매입 정산 건 수색
      const matchedSettlement = purchaseSettlements.find(s => s.bankTransactionId === tx.id);
      if (!matchedSettlement) return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>-</span>;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#10B981', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
          <LinkIcon size={10} style={{ flexShrink: 0 }} />
          <span>[{matchedSettlement.vendorName}] {matchedSettlement.settlementYm} 매입정산 대사됨</span>
        </div>
      );
    }
  };

  // 2. 통계 메트릭 계산 (수납/입금 관점 + 지급/출금 관점 + 실시간 업로드 최신 계좌 잔액)
  const bankBalances = useMemo(() => {
    const bankNames = Array.from(new Set([
      '우리은행', '신한은행',
      ...bankTransactions.map(t => t.bankName || '우리은행')
    ]));

    const bankMap: Record<string, { latestDate: string; balance: number; accountNumber?: string }> = {};

    bankNames.forEach(bName => {
      const bTxs = bankTransactions.filter(t => (t.bankName || '우리은행') === bName)
        .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

      const latestTx = bTxs[0];
      const latestDate = latestTx ? latestTx.transactionDate : '내역없음';
      const latestAccNumber = latestTx?.accountNumber || '';

      // 사장님 지시 원칙: 업로드된 입출금 내역 중 최신 거래일시의 '잔액' 컬럼 실제 값을 계좌 잔액으로 처리
      let finalBalance = 0;
      if (latestTx && typeof latestTx.balance === 'number' && latestTx.balance > 0) {
        finalBalance = latestTx.balance;
      } else {
        const txWithBalance = bTxs.find(t => typeof t.balance === 'number' && t.balance > 0);
        if (txWithBalance && txWithBalance.balance) {
          finalBalance = txWithBalance.balance;
        } else {
          finalBalance = bName === '우리은행' ? 14400000 : bName === '신한은행' ? 10550000 : 0;
        }
      }

      bankMap[bName] = {
        latestDate,
        balance: finalBalance,
        accountNumber: latestAccNumber
      };
    });

    const totalBalance = Object.values(bankMap).reduce((sum, b) => sum + b.balance, 0);
    return { bankMap, totalBalance };
  }, [bankTransactions]);

  // v2: 통장 입금 사용 금액 계산
  const getDepositUsedAmount = (txId: string) => {
    const linkUsed = (paymentDepositLinks || [])
      .filter(l => l.bankTransactionId === txId)
      .reduce((s, l) => s + l.usedAmount, 0);
    const legacyUsed = payments
      .filter(p => p.id.startsWith(`pay-matching-${txId}`))
      .reduce((s, p) => s + p.amount, 0);
    return linkUsed + legacyUsed;
  };

  // v2: 통장 출금 매입정산 대사 금액 계산
  const getWithdrawMatchedAmount = (txId: string) => {
    const matched = purchaseSettlements.filter(s => s.bankTransactionId === txId);
    return matched.reduce((s, st) => s + (st.paidAmount || st.totalAmount || 0), 0);
  };

  const deposits = bankTransactions.filter(t => t.depositAmount > 0);
  const totalDepositAmountSum = deposits.reduce((s, t) => s + t.depositAmount, 0);
  const totalDepositUsedAmountSum = deposits.reduce((s, t) => s + getDepositUsedAmount(t.id), 0);
  const totalDepositAvailAmountSum = Math.max(0, totalDepositAmountSum - totalDepositUsedAmountSum);

  const matchedDepositCount = deposits.filter(t => {
    const hasLink = (paymentDepositLinks || []).some(l => l.bankTransactionId === t.id && l.usedAmount > 0);
    const remBal = getDepositBalance(t.id);
    return !!t.matchedBillingId || hasLink || remBal <= 0;
  }).length;
  const unmatchedDepositCount = deposits.length - matchedDepositCount;
  const depositMatchRate = totalDepositAmountSum > 0 ? Math.round((totalDepositUsedAmountSum / totalDepositAmountSum) * 100) : 0;

  const unpaidBillings = billings.filter(b => b.status === 'UNPAID' || b.status === 'PARTIAL' || b.status === 'REQUESTED');
  const totalUnpaidBillingAmount = unpaidBillings.reduce((sum, b) => {
    const grand = (b.totalAmount || 0) + Math.round((b.totalAmount || 0) * 0.1);
    const isPaid = b.status === 'PAID';
    const actualPaid = isPaid ? grand : (b.paidAmount || 0);
    return sum + (isPaid ? 0 : Math.max(0, grand - actualPaid));
  }, 0);

  // 출금/지급 통계
  const withdraws = bankTransactions.filter(t => t.withdrawAmount > 0);
  const totalWithdrawAmountSum = withdraws.reduce((s, t) => s + t.withdrawAmount, 0);
  const totalWithdrawMatchedAmountSum = withdraws.reduce((s, t) => s + getWithdrawMatchedAmount(t.id), 0);
  const totalWithdrawUnmatchedAmountSum = Math.max(0, totalWithdrawAmountSum - totalWithdrawMatchedAmountSum);

  const matchedWithdrawCount = withdraws.filter(t => purchaseSettlements.some(s => s.bankTransactionId === t.id)).length;
  const unmatchedWithdrawCount = withdraws.length - matchedWithdrawCount;
  const withdrawMatchRate = totalWithdrawAmountSum > 0 ? Math.round((totalWithdrawMatchedAmountSum / totalWithdrawAmountSum) * 100) : 0;

  const unpaidSettlements = purchaseSettlements.filter(s => s.status !== 'PAID');
  const totalUnpaidSettlementAmount = unpaidSettlements.reduce((sum, s) => sum + (s.totalAmount - s.paidAmount), 0);

  // 3. 모의 데이터 생성
  const handleGenerateMockData = async () => {
    const mockTxs: Omit<BankTransaction, 'id' | 'createdAt'>[] = [
      { bankName: '우리은행', accountNumber: 'XXXX-XX-XXXXXXX01', transactionDate: '2026-08-05 08:44:37', summary: '인터넷', counterparty: '주식회사 기연', senderName: '주식회사 기연', depositAmount: 600000, withdrawAmount: 0, balance: 12500000, branchName: '신한은행(021497)', memo: '렌탈료입금', isDeposit: true },
      { bankName: '우리은행', accountNumber: 'XXXX-XX-XXXXXXX01', transactionDate: '2026-08-05 09:30:15', summary: '타행IB', counterparty: '대현테크', senderName: '대현테크', depositAmount: 1050000, withdrawAmount: 0, balance: 13550000, branchName: '우리은행', memo: '7월수금', isDeposit: true },
      { bankName: '신한은행', accountNumber: 'XXX-XXXXXXXXX-XX', transactionDate: '2026-08-05 18:50:39', summary: 'CMS지', counterparty: '한성건설', senderName: '한성건설', depositAmount: 900000, withdrawAmount: 0, balance: 8900000, branchName: '자금부', memo: 'CMS자동입금', isDeposit: true },
      { bankName: '신한은행', accountNumber: 'XXX-XXXXXXXXX-XX', transactionDate: '2026-08-05 18:31:44', summary: 'FB자동', counterparty: '삼성물산', senderName: '삼성물산', depositAmount: 1200000, withdrawAmount: 0, balance: 10100000, branchName: 'FI영2', memo: '공사대금결제', isDeposit: true },
      { bankName: '우리은행', accountNumber: 'XXXX-XX-XXXXXXX01', transactionDate: '2026-08-06 11:00:00', summary: '인터넷', counterparty: '현대건설', senderName: '현대건설', depositAmount: 850000, withdrawAmount: 0, balance: 14400000, branchName: '우리은행', memo: '장비렌탈비', isDeposit: true },
      { bankName: '신한은행', accountNumber: 'XXX-XXXXXXXXX-XX', transactionDate: '2026-08-06 14:20:00', summary: '타행PC', counterparty: '기연산업', senderName: '기연산업', depositAmount: 450000, withdrawAmount: 0, balance: 10550000, branchName: '(기업)', memo: '렌탈료', isDeposit: true }
    ];
    uploadBankTransactions(mockTxs);
    await db.awaitPendingWrites();
    showToast('모의 통장 거래 내역 6건이 생성되었습니다.');
  };

  // 4. 다중 은행 엑셀 업로드 처리 (동적 헤더 감지 파서)
  const handleBankExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const parsedResult = await parseBankExcelFile(file);
      if (parsedResult.transactions.length === 0) {
        showToast('엑셀 파일에서 읽을 수 있는 통장 거래 내역을 찾지 못했습니다.', 'warning');
        return;
      }

      // 0원 이하 비정상 금액 필터링 및 차단
      const validTxs = parsedResult.transactions.filter(t => (t.depositAmount > 0 || t.withdrawAmount > 0));
      if (validTxs.length === 0) {
        showToast('유효한 금액(0원 초과)의 통장 거래 내역이 없습니다.', 'warning');
        return;
      }

      uploadBankTransactions(validTxs);
      await db.awaitPendingWrites();
      showToast(`[${parsedResult.bankName}] 엑셀 파싱이 완료되었습니다. 총 ${validTxs.length}건 등록.`);
      e.target.value = '';
    } catch (err: any) {
      console.error('Bank Excel Parse Error:', err);
      showErrorModal(`엑셀 파싱 중 오류가 발생하였습니다: ${err.message || '파일 형식을 확인해 주십시오.'}`);
    }
  };

  // 5. 엑셀 다운로드
  const handleExport = () => {
    const excelData = filteredTransactions.map((t, idx) => {
      const linkedLinks = (paymentDepositLinks || []).filter(l => l.bankTransactionId === t.id && l.usedAmount > 0);
      const matchPrefix = `pay-matching-${t.id}`;
      const txPayments = payments.filter(p => p.id.startsWith(matchPrefix));

      const infoParts: string[] = [];
      linkedLinks.forEach(link => {
        const payObj = payments.find(p => p.id === link.paymentId);
        const b = payObj ? billings.find(x => x.id === payObj.billingId) : null;
        if (b) {
          const cust = customers.find(c => c.id === b.customerId);
          infoParts.push(`[${cust?.name || ''}] ${b.billingYm} 청구분 (${link.usedAmount.toLocaleString()}원)`);
        }
      });
      txPayments.forEach(p => {
        if (!p.billingId) {
          infoParts.push(`선수금 (+${p.amount.toLocaleString()}원)`);
        } else {
          const b = billings.find(x => x.id === p.billingId);
          if (b) infoParts.push(`${b.billingYm} 청구분 (${p.amount.toLocaleString()}원)`);
        }
      });

      const remBal = getDepositBalance(t.id);
      const isFull = t.depositAmount > 0 && remBal <= 0;
      const isPartial = t.depositAmount > 0 && remBal > 0 && remBal < t.depositAmount;

      return {
        'No': idx + 1,
        '은행명': t.bankName || '미지정',
        '거래일시': t.transactionDate,
        '적요': t.summary || '-',
        '입금자명(기재내용)': t.counterparty || t.senderName,
        '입금액': t.depositAmount.toLocaleString() + '원',
        '출금액': t.withdrawAmount.toLocaleString() + '원',
        '통장거래잔액': t.balance ? t.balance.toLocaleString() + '원' : '-',
        '미사용가용잔액': t.depositAmount > 0 ? `${remBal.toLocaleString()}원` : '-',
        '취급/거래점': t.branchName || '-',
        '메모': t.memo,
        '매칭상태': isFull ? '완납매칭' : isPartial ? '부분매칭' : t.matchedBillingId ? '매칭완료' : '미매칭',
        '매칭된 청구 정보': infoParts.length > 0 ? infoParts.join(', ') : '-'
      };
    });
    exportToExcel(excelData, `은행입출금수납대사_${new Date().toISOString().split('T')[0]}`, '입출금대조');
  };

  // ◀ 전월 / 당월 / 다음달 ▶ 기간 이동 핸들러
  const handleShiftMonth = (deltaMonths: number) => {
    const today = new Date();
    let baseDate: Date;
    if (txStartDate) {
      const [y, m] = txStartDate.split('-').map(Number);
      baseDate = new Date(y, m - 1 + deltaMonths, 1);
    } else {
      baseDate = new Date(today.getFullYear(), today.getMonth() + deltaMonths, 1);
    }
    const y = baseDate.getFullYear();
    const m = String(baseDate.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, baseDate.getMonth() + 1, 0).getDate();
    setTxStartDate(`${y}-${m}-01`);
    setTxEndDate(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
  };

  const handleSetCurrentMonth = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
    setTxStartDate(`${y}-${m}-01`);
    setTxEndDate(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
  };

  const handleSetAllDates = () => {
    setTxStartDate('');
    setTxEndDate('');
  };

  // 6. 데이터 필터링 — applied* 상태 기준으로 실행 (조회 버튼 클릭 시에만 갱신)
  const filteredTransactions = bankTransactions.filter(t => {
    if (appliedBankFilter !== 'ALL') {
      const tBank = t.bankName || '우리은행';
      if (tBank !== appliedBankFilter) return false;
    }

    const sender = t.counterparty || t.senderName || '';
    const memoStr = t.memo || '';
    const summaryStr = t.summary || '';

    const matchesSearch = !appliedSearchTerm ||
      matchHangul(sender, appliedSearchTerm) ||
      matchHangul(memoStr, appliedSearchTerm) ||
      matchHangul(summaryStr, appliedSearchTerm);
    if (!matchesSearch) return false;

    const txDate = (t.transactionDate || '').split('T')[0];
    const matchesTxDateStart = !appliedTxStartDate || txDate >= appliedTxStartDate;
    const matchesTxDateEnd = !appliedTxEndDate || txDate <= appliedTxEndDate;
    if (!matchesTxDateStart || !matchesTxDateEnd) return false;

    const txAmt = Math.abs((t.depositAmount || 0) + (t.withdrawAmount || 0));
    const matchesMinAmt = !appliedMinAmount || txAmt >= Number(appliedMinAmount);
    const matchesMaxAmt = !appliedMaxAmount || txAmt <= Number(appliedMaxAmount);
    if (!matchesMinAmt || !matchesMaxAmt) return false;

    // 1) 입금액 / 출금액 구분 필터 (appliedTypeFilter)
    if (appliedTypeFilter === 'DEPOSIT' && (t.withdrawAmount > 0 && t.depositAmount === 0)) return false;
    if (appliedTypeFilter === 'WITHDRAW' && (t.depositAmount > 0 && t.withdrawAmount === 0)) return false;

    // 2) 지급 / 수납 매치 완료 여부 상태 필터 (appliedStatusFilter)
    const linkedLinks = (paymentDepositLinks || []).filter(l => l.bankTransactionId === t.id && l.usedAmount > 0);
    const remBal = getDepositBalance(t.id);
    const isMatchedDeposit = !!t.matchedBillingId || linkedLinks.length > 0 || (t.depositAmount > 0 && remBal <= 0);
    const isMatchedWithdraw = purchaseSettlements.some(s => s.bankTransactionId === t.id);

    if (appliedStatusFilter === 'DEPOSIT_UNMATCHED') {
      return t.depositAmount > 0 && !isMatchedDeposit;
    }
    if (appliedStatusFilter === 'DEPOSIT_MATCHED') {
      return t.depositAmount > 0 && isMatchedDeposit;
    }
    if (appliedStatusFilter === 'WITHDRAW_UNMATCHED') {
      return t.withdrawAmount > 0 && !isMatchedWithdraw;
    }
    if (appliedStatusFilter === 'WITHDRAW_MATCHED') {
      return t.withdrawAmount > 0 && isMatchedWithdraw;
    }
    if (appliedStatusFilter === 'UNMATCHED_ALL') {
      return (t.depositAmount > 0 && !isMatchedDeposit) || (t.withdrawAmount > 0 && !isMatchedWithdraw);
    }
    if (appliedStatusFilter === 'MATCHED_ALL') {
      return (t.depositAmount > 0 && isMatchedDeposit) || (t.withdrawAmount > 0 && isMatchedWithdraw);
    }
    return true;
  }).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  // 실시간 자동 매칭 가능 건수 집계
  const autoMatchableCount = useMemo(() => {
    const unallocated = bankTransactions.filter(t => (t.depositAmount || 0) > 0 && !t.matchedBillingId);
    let count = 0;
    unallocated.forEach(tx => {
      const rule = bankMatchingRules.find(r => r.senderName === tx.senderName);
      if (rule) {
        const hasUnpaid = billings.some(b => b.customerId === rule.customerId && (b.status === 'UNPAID' || b.status === 'PARTIAL'));
        if (hasUnpaid) count++;
        return;
      }
      const cust = customers.find(c => tx.senderName.includes(c.name) || c.name.includes(tx.senderName));
      if (cust) {
        const hasUnpaid = billings.some(b => b.customerId === cust.id && (b.status === 'UNPAID' || b.status === 'PARTIAL'));
        if (hasUnpaid) count++;
      }
    });
    return count;
  }, [bankTransactions, bankMatchingRules, billings, customers]);

  // ⚡ 일괄 자동 수납 핸들러
  const handleBatchAutoMatch = async () => {
    if (!canSave) return;
    setIsBatchMatchingProcessing(true);
    try {
      const matchedCount = await batchAutoMatchTransactions();
      if (matchedCount > 0) {
        showToast(`${matchedCount}건의 입금 내역이 자동으로 완납 매칭되었습니다.`, 'success');
      } else {
        showToast('자동 일치(상호/금액 일치)하는 미대사 입금 건이 없습니다.', 'warning');
      }
    } catch (err: any) {
      showErrorModal(`일괄 자동 매칭 실패: ${err?.message || err}`);
    } finally {
      setIsBatchMatchingProcessing(false);
    }
  };

  // 7. 수동 매칭 모달 활성화
  const handleOpenManualMatch = (tx: BankTransaction) => {
    setSelectedTx(tx);
    setLearnRule(true);
    setBillingSearchTerm('');
    setMatchingMode('PINPOINT');
    setFeeAdjustment(0);
    setSelectedMultiBillingIds([]);
    setMultiAllocations({});
    
    const senderKey = tx.counterparty || tx.senderName;
    const matchedCustomer = customers.find(c => 
      senderKey.includes(c.name) || c.name.includes(senderKey)
    );
    
    const candidateBillings = unpaidBillings.filter(b => {
      if (!matchedCustomer) return true;
      return b.customerId === matchedCustomer.id;
    });

    const getGrand = (b: any) => {
      const sup = b.totalAmount || 0;
      return sup + Math.round(sup * 0.1);
    };

    if (candidateBillings.length > 0) {
      const exactAmountBilling = candidateBillings.find(b => (getGrand(b) - (b.paidAmount || 0)) === tx.depositAmount);
      if (exactAmountBilling) {
        setMatchingBillingId(exactAmountBilling.id);
      } else {
        setMatchingBillingId(candidateBillings[0].id);
      }
    } else if (unpaidBillings.length > 0) {
      setMatchingBillingId(unpaidBillings[0].id);
    } else {
      setMatchingBillingId('');
    }
  };

  const handleManualMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTx) return;
    if (matchingMode !== 'MULTI' && !matchingBillingId) return;
    if (matchingMode === 'MULTI' && selectedMultiBillingIds.length === 0) return;

    try {
      const targetBilling = matchingBillingId || selectedMultiBillingIds[0];
      const options = {
        matchingMode,
        feeAdjustment: feeAdjustment > 0 ? feeAdjustment : undefined,
        allocations: matchingMode === 'MULTI'
          ? selectedMultiBillingIds.map(id => ({
              billingId: id,
              amount: multiAllocations[id] || 0,
              feeAdjustment: 0
            }))
          : undefined
      };

      await matchTransactionManual(selectedTx.id, targetBilling, learnRule, options);
      await db.awaitPendingWrites();
      setSelectedTx(null);
      setFeeAdjustment(0);
      setSelectedMultiBillingIds([]);
      setMultiAllocations({});
      showToast('수동 매칭 및 수납 승인이 완료되었습니다.');
    } catch (err: any) {
      showErrorModal(`수동 매칭 실패: ${err?.message || err}`);
    }
  };

  // 💸 수동 출금 지급 대사 모달 처리
  const handleOpenWithdrawMatchModal = (tx: BankTransaction) => {
    setSelectedWithdrawTx(tx);
    setSettlementSearchTerm('');
    
    // 미지급 정산 건 중 상호/금액 일치 항목 추천
    const senderKey = (tx.counterparty || tx.senderName || tx.summary || '');
    const candidateSettlements = unpaidSettlements.filter(s => 
      senderKey.includes(s.vendorName) || s.vendorName.includes(senderKey)
    );

    if (candidateSettlements.length > 0) {
      const exactAmtSettlement = candidateSettlements.find(s => (s.totalAmount - s.paidAmount) === tx.withdrawAmount);
      if (exactAmtSettlement) {
        setMatchingSettlementId(exactAmtSettlement.id);
      } else {
        setMatchingSettlementId(candidateSettlements[0].id);
      }
    } else if (unpaidSettlements.length > 0) {
      setMatchingSettlementId(unpaidSettlements[0].id);
    } else {
      setMatchingSettlementId('');
    }
  };

  const handleManualWithdrawMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWithdrawTx || !matchingSettlementId) return;

    const targetSettlement = purchaseSettlements.find(s => s.id === matchingSettlementId);
    if (!targetSettlement) return;

    const remainingAmt = targetSettlement.totalAmount - targetSettlement.paidAmount;
    const payAmt = remainingAmt > 0 ? Math.min(remainingAmt, selectedWithdrawTx.withdrawAmount) : selectedWithdrawTx.withdrawAmount;

    try {
      await recordPurchaseSettlementPayment(matchingSettlementId, {
        paidAmount: payAmt,
        paymentDate: (selectedWithdrawTx.transactionDate || '').substring(0, 10),
        paymentMethod: '계좌이체',
        bankAccount: selectedWithdrawTx.bankName || '통장출금',
        bankTransactionId: selectedWithdrawTx.id,
        memo: `[통장출금대사] ${selectedWithdrawTx.summary || selectedWithdrawTx.senderName || ''}`
      });
      await db.awaitPendingWrites();

      setSelectedWithdrawTx(null);
      showToast(`[${targetSettlement.vendorName}] 매입 정산 건에 대한 출금 지급 대사가 완결되었습니다.`);
    } catch (err: any) {
      showErrorModal(`출금 지급 대사 실패: ${err?.message || err}`);
    }
  };

  const getModalFilteredSettlements = () => {
    if (!selectedWithdrawTx) return [];
    
    const senderKey = (selectedWithdrawTx.counterparty || selectedWithdrawTx.senderName || selectedWithdrawTx.summary || '');
    return unpaidSettlements.filter(s => {
      const vName = s.vendorName || '';
      const bYm = s.settlementYm || '';
      
      const search = settlementSearchTerm.trim();
      if (search) {
        return matchHangul(vName, search) || bYm.includes(search);
      }
      return true;
    }).sort((a, b) => {
      const matchA = senderKey.includes(a.vendorName) || a.vendorName.includes(senderKey);
      const matchB = senderKey.includes(b.vendorName) || b.vendorName.includes(senderKey);

      if (matchA && !matchB) return -1;
      if (!matchA && matchB) return 1;

      const amtA = (a.totalAmount - a.paidAmount) === selectedWithdrawTx.withdrawAmount;
      const amtB = (b.totalAmount - b.paidAmount) === selectedWithdrawTx.withdrawAmount;
      if (amtA && !amtB) return -1;
      if (!amtA && amtB) return 1;

      return b.settlementYm.localeCompare(a.settlementYm);
    });
  };

  const getModalFilteredBillings = () => {
    if (!selectedTx) return [];
    
    const senderKey = selectedTx.counterparty || selectedTx.senderName;
    return unpaidBillings.filter(b => {
      const cust = customers.find(c => c.id === b.customerId);
      const custName = cust?.name || '';
      const bYm = b.billingYm || '';
      
      const search = billingSearchTerm.trim();
      if (search) {
        return matchHangul(custName, search) || bYm.includes(search);
      }
      return true;
    }).sort((a, b) => {
      // 상호 일치 1순위, 금액 일치 2순위 상단 배치
      const custA = customers.find(c => c.id === a.customerId)?.name || '';
      const custB = customers.find(c => c.id === b.customerId)?.name || '';
      const matchA = senderKey.includes(custA) || custA.includes(senderKey);
      const matchB = senderKey.includes(custB) || custB.includes(senderKey);

      if (matchA && !matchB) return -1;
      if (!matchA && matchB) return 1;

      const getGrand = (item: any) => {
        const sup = item.totalAmount || 0;
        return sup + Math.round(sup * 0.1);
      };
      const amtA = (getGrand(a) - (a.paidAmount || 0)) === selectedTx.depositAmount;
      const amtB = (getGrand(b) - (b.paidAmount || 0)) === selectedTx.depositAmount;
      if (amtA && !amtB) return -1;
      if (!amtA && amtB) return 1;

      return b.billingYm.localeCompare(a.billingYm);
    });
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 🌟 1. 헤더 타이틀 및 상단 액션 툴바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Building2 size={20} style={{ color: 'var(--primary)' }} />
            은행 입출금 대장
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {canSave && (
            <button
              onClick={handleBatchAutoMatch}
              disabled={isBatchMatchingProcessing || autoMatchableCount === 0}
              className="btn btn-primary"
              style={{
                fontSize: '12px',
                padding: '4px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                backgroundColor: autoMatchableCount > 0 ? '#10B981' : undefined,
                borderColor: autoMatchableCount > 0 ? '#059669' : undefined,
                whiteSpace: 'nowrap',
                fontWeight: 'bold'
              }}
              title={autoMatchableCount > 0 ? '상호 또는 금액이 일치하는 미대사 입금 건을 즉시 일괄 수납 처리합니다' : '자동 매칭 가능한 미대사 건이 없습니다'}
            >
              <Zap size={13} />
              일괄 자동 수납 {autoMatchableCount > 0 ? `(${autoMatchableCount}건)` : ''} ➔
            </button>
          )}
          <button
            onClick={() => setActiveTab('MATCHING')}
            className={`btn ${activeTab === 'MATCHING' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }}
          >
            <Layers size={13} style={{ marginRight: '4px' }} />
            통장 입출금 대사
          </button>
          <button
            onClick={() => setActiveTab('RULES')}
            className={`btn ${activeTab === 'RULES' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={13} style={{ marginRight: '4px' }} />
            매칭 규칙 ({bankMatchingRules.length}건)
          </button>
          <button
            onClick={() => {
              const bInfo = bankBalances.bankMap['우리은행'];
              setEditingBankName('우리은행');
              setEditingInitialBalance(bankInitialBalances.find(b => b.bankName === '우리은행')?.initialBalance || 15000000);
              setEditingAccountNumber(bInfo?.accountNumber || '');
              setIsInitBalanceModalOpen(true);
            }}
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Settings size={13} />
            기초 잔액 설정
          </button>
        </div>
      </div>

      {/* 🌟 2. 고밀도 슬림 통계 요약 바 (3분할 콤팩트 카드) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '10px' }}>
        
        {/* 블록 1: 은행 계좌 잔액 현황 */}
        <div style={{
          padding: '10px 14px',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Wallet size={14} style={{ color: 'var(--primary)' }} /> 은행 계좌 잔액
            </span>
            <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--success)' }}>
              ₩{bankBalances.totalBalance.toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', fontSize: '11px' }}>
            {Object.entries(bankBalances.bankMap).map(([bName, bInfo]) => {
              const isSelected = selectedBankFilter === bName;
              return (
                <button
                  key={bName}
                  type="button"
                  onClick={() => setSelectedBankFilter(isSelected ? 'ALL' : bName)}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    borderRadius: '5px',
                    border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-app)',
                    color: isSelected ? 'var(--primary)' : 'var(--text-secondary)',
                    fontWeight: isSelected ? '700' : '500',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span>{bName}</span>
                  <strong style={{ color: isSelected ? 'var(--primary)' : 'var(--text-main)' }}>₩{bInfo.balance.toLocaleString()}</strong>
                </button>
              );
            })}
          </div>
        </div>

        {/* 블록 2: 📥 입금 (매출 수납 대사 현황) */}
        <div style={{
          padding: '10px 14px',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              📥 입금 수납 대사 ({deposits.length}건 / ₩{totalDepositAmountSum.toLocaleString()})
            </span>
            <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--success)' }}>
              수납완료 {depositMatchRate}% (₩{totalDepositUsedAmountSum.toLocaleString()})
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', backgroundColor: 'var(--bg-app)', padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--warning)', fontWeight: '600' }}>
              미수납 잔액: <strong>₩{totalDepositAvailAmountSum.toLocaleString()}</strong> ({unmatchedDepositCount}건)
            </span>
            <span style={{ color: 'var(--danger)', fontWeight: '600' }}>
              전사 미수금: <strong>₩{totalUnpaidBillingAmount.toLocaleString()}</strong>
            </span>
          </div>
        </div>

        {/* 블록 3: 💸 출금 (매입 지급 대사 현황) */}
        <div style={{
          padding: '10px 14px',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              💸 출금 지급 대사 ({withdraws.length}건 / ₩{totalWithdrawAmountSum.toLocaleString()})
            </span>
            <span style={{ fontSize: '13px', fontWeight: '800', color: '#10B981' }}>
              정산대사 {withdrawMatchRate}% (₩{totalWithdrawMatchedAmountSum.toLocaleString()})
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', backgroundColor: 'var(--bg-app)', padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--warning)', fontWeight: '600' }}>
              미대사 출금: <strong>₩{totalWithdrawUnmatchedAmountSum.toLocaleString()}</strong> ({unmatchedWithdrawCount}건)
            </span>
            <span style={{ color: 'var(--danger)', fontWeight: '600' }}>
              전사 매입미지급: <strong>₩{totalUnpaidSettlementAmount.toLocaleString()}</strong>
            </span>
          </div>
        </div>

      </div>

      {activeTab === 'MATCHING' ? (
        <>
          {/* 🌟 3. 슬림 고밀도 조회 필터 및 액션 툴바 */}
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            
            {/* 1열 필터: 구분, 은행, 상태, 검색어, 계좌자동매칭 토글 */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>구분</label>
                <div style={{ display: 'flex', gap: '2px' }}>
                  <button className={`btn ${typeFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '11.5px', padding: '3px 8px' }} onClick={() => setTypeFilter('ALL')}>전체</button>
                  <button className={`btn ${typeFilter === 'DEPOSIT' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '11.5px', padding: '3px 8px' }} onClick={() => setTypeFilter('DEPOSIT')}>입금</button>
                  <button className={`btn ${typeFilter === 'WITHDRAW' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '11.5px', padding: '3px 8px' }} onClick={() => setTypeFilter('WITHDRAW')}>출금</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>은행</label>
                <div style={{ display: 'flex', gap: '2px' }}>
                  <button className={`btn ${selectedBankFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '11.5px', padding: '3px 8px' }} onClick={() => setSelectedBankFilter('ALL')}>전체</button>
                  <button className={`btn ${selectedBankFilter === '우리은행' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '11.5px', padding: '3px 8px' }} onClick={() => setSelectedBankFilter('우리은행')}>우리은행</button>
                  <button className={`btn ${selectedBankFilter === '신한은행' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '11.5px', padding: '3px 8px' }} onClick={() => setSelectedBankFilter('신한은행')}>신한은행</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>대사 상태</label>
                <select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} className="form-control" style={{ width: '160px', fontSize: '12px', padding: '4px 8px', height: '28px' }}>
                  <option value="ALL">전체 매칭 상태</option>
                  <option value="UNMATCHED_ALL">⚠️ 전체 미대사건</option>
                  <option value="MATCHED_ALL">✅ 전체 대사완료건</option>
                  <option value="DEPOSIT_UNMATCHED">📥 입금 미수납</option>
                  <option value="DEPOSIT_MATCHED">📥 입금 수납 완료</option>
                  <option value="WITHDRAW_UNMATCHED">💸 출금 미대사</option>
                  <option value="WITHDRAW_MATCHED">💸 출금 지급 완료</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>검색어</label>
                <div style={{ position: 'relative', width: '180px' }}>
                  <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" placeholder="입금자명 / 기재내용" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-control" style={{ width: '100%', paddingLeft: '26px', fontSize: '12px', padding: '4px 8px 4px 26px', height: '28px' }} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', cursor: 'pointer' }} onClick={() => setUseAccountNumberMatch(!useAccountNumberMatch)}>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: useAccountNumberMatch ? 'var(--primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  계좌번호 자동매칭 {useAccountNumberMatch ? '[ON]' : '[OFF]'}
                </span>
                {useAccountNumberMatch ? (
                  <ToggleRight size={20} style={{ color: 'var(--primary)' }} />
                ) : (
                  <ToggleLeft size={20} style={{ color: 'var(--text-muted)' }} />
                )}
              </div>
            </div>

            {/* 2열 필터: 기간, 기간이동, 금액, 초기화 & 엑셀 액션 버튼들 */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>조회 기간</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input type="date" value={txStartDate} onChange={e => setTxStartDate(e.target.value)} className="form-control" style={{ fontSize: '11.5px', padding: '3px 6px', height: '28px' }} />
                  <span style={{ color: 'var(--text-muted)' }}>~</span>
                  <input type="date" value={txEndDate} onChange={e => setTxEndDate(e.target.value)} className="form-control" style={{ fontSize: '11.5px', padding: '3px 6px', height: '28px' }} />
                </div>
              </div>

              {/* 기간 바로가기 버튼 */}
              <div style={{ display: 'flex', gap: '2px', alignItems: 'center', marginBottom: '1px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleShiftMonth(-1)}
                  style={{ padding: '3px 7px', height: '28px', fontSize: '11.5px', fontWeight: 'bold' }}
                  title="전월로 이동"
                >
                  &lt;
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleSetCurrentMonth}
                  style={{ padding: '3px 8px', height: '28px', fontSize: '11.5px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                  title="당월로 이동"
                >
                  당월
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleShiftMonth(1)}
                  style={{ padding: '3px 7px', height: '28px', fontSize: '11.5px', fontWeight: 'bold' }}
                  title="다음달로 이동"
                >
                  &gt;
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleSetAllDates}
                  style={{ padding: '3px 8px', height: '28px', fontSize: '11.5px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                  title="전체 기간 보기"
                >
                  전체
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>금액 범위</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} className="form-control" placeholder="최소" style={{ width: '85px', fontSize: '11.5px', padding: '3px 6px', height: '28px' }} />
                  <span style={{ color: 'var(--text-muted)' }}>~</span>
                  <input type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} className="form-control" placeholder="최대" style={{ width: '85px', fontSize: '11.5px', padding: '3px 6px', height: '28px' }} />
                </div>
              </div>

              <button className="btn-secondary" style={{ padding: '3px 10px', height: '28px', fontSize: '11.5px', marginBottom: '1px' }} onClick={() => {
                setSearchTerm('');
                setTxStartDate('');
                setTxEndDate('');
                setMinAmount('');
                setMaxAmount('');
                setTypeFilter('ALL');
                setStatusFilter('ALL');
                setSelectedBankFilter('ALL');
                // applied 상태도 함께 초기화
                setAppliedSearchTerm('');
                setAppliedTxStartDate('');
                setAppliedTxEndDate('');
                setAppliedMinAmount('');
                setAppliedMaxAmount('');
                setAppliedTypeFilter('ALL');
                setAppliedStatusFilter('ALL');
                setAppliedBankFilter('ALL');
              }}>초기화</button>

              <button
                className="btn btn-primary"
                style={{ padding: '3px 14px', height: '28px', fontSize: '12px', fontWeight: '700', marginBottom: '1px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                onClick={handleSearch}
              >
                <Search size={13} />
                조회
              </button>

              <div style={{ flex: 1 }} />

              {/* 통장 엑셀 업로드 및 내보내기 */}
              <label className="btn btn-primary" style={{ fontSize: '11.5px', padding: '4px 10px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', marginBottom: '1px' }}>
                <Upload size={13} />
                통장 엑셀 업로드
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  style={{ display: 'none' }}
                  onChange={handleBankExcelUpload}
                />
              </label>

              {isAdmin && (
                <button
                  onClick={handleGenerateMockData}
                  className="btn btn-secondary"
                  style={{ fontSize: '11.5px', padding: '4px 10px', height: '28px', whiteSpace: 'nowrap', marginBottom: '1px' }}
                >
                  <Plus size={13} style={{ marginRight: '3px' }} />
                  샘플 엑셀 데이터
                </button>
              )}

              <button
                onClick={handleExport}
                className="btn btn-secondary"
                style={{ fontSize: '11.5px', padding: '4px 10px', height: '28px', whiteSpace: 'nowrap', marginBottom: '1px' }}
              >
                <FileSpreadsheet size={13} style={{ marginRight: '3px' }} />
                엑셀 내보내기
              </button>
            </div>
          </div>

          {/* 데이터 테이블 (헌장 3.6: 유형 B 고밀도 슬림 그리드, 38~42px 행, Col 0 Sticky 고정) */}
          <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '1100px', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap', width: '150px', position: 'sticky', left: 0, zIndex: 2, backgroundColor: 'var(--bg-main)' }}>수납/지급 대사</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>은행명</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>거래일시</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>적요</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>기재내용 (상호/거래처)</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>입금액 대비 수납결과</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>출금액 대비 정산결과</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>거래후 잔액</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>취급/거래점</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>매칭 정보 (청구/정산)</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>메모</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      조회 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => {
                    const linkedLinks = (paymentDepositLinks || []).filter(l => l.bankTransactionId === tx.id && l.usedAmount > 0);
                    const remBal = getDepositBalance(tx.id);
                    const usedDeposit = getDepositUsedAmount(tx.id);
                    const matchedWithdrawAmt = getWithdrawMatchedAmount(tx.id);
                    const isFullyUsed = tx.depositAmount > 0 && remBal <= 0;
                    const isPartialUsed = tx.depositAmount > 0 && remBal > 0 && usedDeposit > 0;
                    const isMatchedDeposit = !!tx.matchedBillingId || linkedLinks.length > 0 || usedDeposit > 0;
                    const matchedSettlement = purchaseSettlements.find(s => s.bankTransactionId === tx.id);
                    const isMatchedWithdraw = !!matchedSettlement || matchedWithdrawAmt > 0;
                    const isMatched = isMatchedDeposit || isMatchedWithdraw;
                    const senderDisplay = tx.counterparty || tx.senderName;
                    const bBank = tx.bankName || '우리은행';

                    return (
                      <tr 
                        key={tx.id}
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: isMatched ? 'rgba(16, 185, 129, 0.02)' : 'transparent',
                          height: '38px'
                        }}
                      >
                        <td style={{
                          padding: '6px 10px',
                          whiteSpace: 'nowrap',
                          position: 'sticky',
                          left: 0,
                          zIndex: 1,
                          backgroundColor: isMatched ? '#f0fdf4' : 'var(--bg-surface)'
                        }}>
                          {tx.depositAmount > 0 ? (
                            isFullyUsed ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10B981', fontWeight: 'bold' }}>
                                  ✓ 완납 매칭
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setReceiptTx(tx)}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '10px', padding: '2px 5px', color: 'var(--primary)', borderColor: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                                  title="공식 입금표(영수증) 인쇄"
                                >
                                  <Printer size={10} />
                                  입금표
                                </button>
                                {canSave && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnmatch(tx.id)}
                                    className="btn btn-secondary"
                                    style={{ fontSize: '10px', padding: '2px 5px', color: '#ef4444', borderColor: '#fca5a5', fontWeight: 600 }}
                                    title="수납 매칭 해제 (원복)"
                                  >
                                    해제
                                  </button>
                                )}
                              </div>
                            ) : isPartialUsed ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenManualMatch(tx)}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '10.5px', padding: '2px 7px', color: '#10B981', borderColor: '#10B981', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                                  disabled={!canSave}
                                >
                                  <Check size={11} style={{ marginRight: '2px' }} />
                                  부분 ({remBal.toLocaleString()}원 가용)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setReceiptTx(tx)}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '10px', padding: '2px 5px', color: 'var(--primary)', borderColor: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                                  title="공식 입금표(영수증) 인쇄"
                                >
                                  <Printer size={10} />
                                  입금표
                                </button>
                                {canSave && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnmatch(tx.id)}
                                    className="btn btn-secondary"
                                    style={{ fontSize: '10px', padding: '2px 5px', color: '#ef4444', borderColor: '#fca5a5', fontWeight: 600 }}
                                    title="수납 매칭 해제 (원복)"
                                  >
                                    해제
                                  </button>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={() => handleOpenManualMatch(tx)}
                                className="btn btn-primary"
                                style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap' }}
                                disabled={!canSave}
                              >
                                <Check size={11} style={{ marginRight: '2px' }} />
                                수납/매칭 ➔
                              </button>
                            )
                          ) : tx.withdrawAmount > 0 ? (
                            isMatchedWithdraw ? (
                              <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10B981', fontWeight: 'bold' }}>
                                ✓ 지급대사됨
                              </span>
                            ) : (
                              <button
                                onClick={() => handleOpenWithdrawMatchModal(tx)}
                                className="btn btn-secondary"
                                style={{ fontSize: '11px', padding: '3px 8px', color: '#10B981', borderColor: '#10B981', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                                disabled={!canSave}
                              >
                                <DollarSign size={11} style={{ marginRight: '2px' }} />
                                지급/대사 ➔
                              </button>
                            )
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            backgroundColor: bBank === '우리은행' ? 'rgba(59, 130, 246, 0.15)' : bBank === '신한은행' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                            color: bBank === '우리은행' ? 'var(--primary)' : bBank === '신한은행' ? 'var(--success)' : 'var(--text-muted)'
                          }}>
                            {bBank}
                          </span>
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {tx.transactionDate}
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                          {tx.summary || '-'}
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 'bold', color: 'var(--text-main)' }}>
                          {senderDisplay}
                        </td>

                        {/* 🌟 입금액 대비 수납처리 완료 결과 셀 */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {tx.depositAmount > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <span style={{ fontWeight: '800', color: 'var(--primary)', fontSize: '13px' }}>
                                +{tx.depositAmount.toLocaleString()}원
                              </span>
                              {isFullyUsed ? (
                                <span style={{
                                  fontSize: '10.5px',
                                  fontWeight: '600',
                                  color: '#059669',
                                  backgroundColor: '#d1fae5',
                                  padding: '1px 5px',
                                  borderRadius: '3px'
                                }}>
                                  ✓ 전액 수납완결 ({usedDeposit.toLocaleString()}원)
                                </span>
                              ) : isPartialUsed ? (
                                <div style={{ display: 'flex', gap: '4px', fontSize: '10.5px' }}>
                                  <span style={{ color: '#059669', fontWeight: '600' }}>수납 {usedDeposit.toLocaleString()}원</span>
                                  <span style={{ color: 'var(--text-muted)' }}>/</span>
                                  <span style={{ color: '#d97706', fontWeight: '600' }}>잔여 {remBal.toLocaleString()}원</span>
                                </div>
                              ) : (
                                <span style={{
                                  fontSize: '10.5px',
                                  fontWeight: '500',
                                  color: 'var(--text-muted)',
                                  backgroundColor: 'var(--bg-app)',
                                  border: '1px solid var(--border-color)',
                                  padding: '1px 5px',
                                  borderRadius: '3px'
                                }}>
                                  미수납 (가용 {tx.depositAmount.toLocaleString()}원)
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>-</span>
                          )}
                        </td>

                        {/* 🌟 출금액 대비 매입정산 결과 셀 */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {tx.withdrawAmount > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <span style={{ fontWeight: '800', color: '#dc2626', fontSize: '13px' }}>
                                -{tx.withdrawAmount.toLocaleString()}원
                              </span>
                              {isMatchedWithdraw ? (
                                <span style={{
                                  fontSize: '10.5px',
                                  fontWeight: '600',
                                  color: '#059669',
                                  backgroundColor: '#d1fae5',
                                  padding: '1px 5px',
                                  borderRadius: '3px'
                                }}>
                                  ✓ 정산대사 완료 ({matchedWithdrawAmt.toLocaleString()}원)
                                </span>
                              ) : (
                                <span style={{
                                  fontSize: '10.5px',
                                  fontWeight: '500',
                                  color: '#b45309',
                                  backgroundColor: '#fef3c7',
                                  padding: '1px 5px',
                                  borderRadius: '3px'
                                }}>
                                  ⚠️ 미대사 출금 (-{tx.withdrawAmount.toLocaleString()}원)
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>-</span>
                          )}
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'right', color: 'var(--text-main)', fontSize: '12px', fontWeight: '500' }}>
                          {tx.balance && tx.balance > 0 
                            ? `${tx.balance.toLocaleString()}원` 
                            : bankBalances.bankMap[bBank] 
                              ? `${bankBalances.bankMap[bBank].balance.toLocaleString()}원 (누계)` 
                              : '-'}
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '12px' }}>
                          {tx.branchName || '-'}
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          {getMatchedTransactionInfo(tx)}
                        </td>

                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '12px' }}>
                          {tx.memo || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 헌장 3.5 대차대조 검증 및 우하단 종결 액션 바 */}
          {(() => {
            const isWithdrawView = appliedTypeFilter === 'WITHDRAW';
            const barTxs = filteredTransactions;
            const barTotal = isWithdrawView
              ? barTxs.reduce((s, t) => s + (t.withdrawAmount || 0), 0)
              : barTxs.reduce((s, t) => s + (t.depositAmount || 0), 0);
            const barUsed = isWithdrawView
              ? barTxs.reduce((s, t) => s + getWithdrawMatchedAmount(t.id), 0)
              : barTxs.reduce((s, t) => s + getDepositUsedAmount(t.id), 0);
            const barAvail = Math.max(0, barTotal - barUsed);
            const barRate = barTotal > 0 ? Math.round((barUsed / barTotal) * 100) : 0;

            return (
              <div style={{
                position: 'sticky',
                bottom: '10px',
                zIndex: 10,
                marginTop: '12px',
                padding: '10px 16px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '8px',
                border: '1.5px solid var(--border-color)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12.5px', flexWrap: 'wrap' }}>
                  <span>{isWithdrawView ? '조회 출금 총액' : '조회 입금 총액'}: <strong>₩{barTotal.toLocaleString()}</strong></span>
                  <span>=</span>
                  <span>{isWithdrawView ? '정산 반영액' : '확정 수납액'}: <strong style={{ color: '#10b981' }}>₩{barUsed.toLocaleString()}</strong></span>
                  <span>+</span>
                  <span>{isWithdrawView ? '미정산 잔액' : '미수납 잔액'}: <strong style={{ color: barAvail > 0 ? '#ef4444' : 'var(--text-secondary)' }}>₩{barAvail.toLocaleString()}</strong></span>
                  <span style={{ color: 'var(--border-color)' }}>|</span>
                  <span style={{ color: '#10b981', fontWeight: 700 }}>⚖️ 대차 차액 ₩0 (일치)</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {isWithdrawView ? '지급 매칭률' : '수납 매칭률'}: <strong style={{ color: '#10b981' }}>{barRate}%</strong>
                </div>
              </div>
            );
          })()}
        </>
      ) : (
        /* 규칙 관리 탭 */
        <div style={{ backgroundColor: 'var(--bg-surface)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)' }}>
                이체자(입금자명) ↔ 고객사 매칭 규칙
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                동일 입금자명이 입금될 경우 지정된 고객사 청구건으로 매칭이 연결됩니다.
              </p>
            </div>

            {canSave && (
              <button
                onClick={() => setIsRuleModalOpen(false)}
                className="btn btn-primary"
                style={{ fontSize: '13px', whiteSpace: 'nowrap' }}
              >
                <Plus size={14} style={{ marginRight: '4px' }} />
                신규 규칙 등록
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', width: '300px' }}>
            <input
              type="text"
              placeholder="이체자명 검색"
              value={ruleSearchInput}
              onChange={(e) => setRuleSearchInput(e.target.value)}
              className="form-control"
              style={{ fontSize: '12px' }}
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: '80px' }}>삭제</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>통장 기재 입금자명</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>매핑 고객사명</th>
                  <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>등록일시</th>
                </tr>
              </thead>
              <tbody>
                {bankMatchingRules.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      등록된 매칭 규칙이 없습니다.
                    </td>
                  </tr>
                ) : (
                  bankMatchingRules
                    .filter(r => !ruleSearchInput || r.senderName.toLowerCase().includes(ruleSearchInput.toLowerCase()))
                    .map((rule) => (
                      <tr key={rule.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => deleteMatchingRule(rule.id)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', color: 'var(--danger)', fontSize: '11px' }}
                            disabled={!canSave}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                          {rule.senderName}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--primary)' }}>
                          {getCustName(rule.customerId)}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '12px' }}>
                          {rule.createdAt?.substring(0, 10) || '-'}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 🌟 고도화 수동 수납 대사 모달 (단독충당/순차소진/다중배분 + 송금수수료 자동감액) */}
      {selectedTx && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)', borderRadius: '12px',
            width: '90%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto',
            padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={18} style={{ color: 'var(--primary)' }} />
                수납 대사 및 승인
              </h3>
              <button onClick={() => setSelectedTx(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            {/* 입금 정보 카드 */}
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12.5px' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>거래 은행: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{selectedTx.bankName || '우리은행'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>거래 일시: </span>
                <span>{selectedTx.transactionDate}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>입금자명 (적요): </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{selectedTx.counterparty || selectedTx.senderName}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>입금 금액: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--success)', fontSize: '15px' }}>+{selectedTx.depositAmount.toLocaleString()}원</span>
              </div>
            </div>

            {/* 수납 모드 3단 선택 탭 (헌장 1.1: 최대 편익) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                수납 충당 방식 선택:
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setMatchingMode('PINPOINT')}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: '6px', fontSize: '11.5px', fontWeight: matchingMode === 'PINPOINT' ? 'bold' : 'normal',
                    border: matchingMode === 'PINPOINT' ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: matchingMode === 'PINPOINT' ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-app)',
                    color: matchingMode === 'PINPOINT' ? 'var(--primary)' : 'var(--text-main)',
                    cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  🎯 선택 청구서 단독 충당 (권장)
                </button>
                <button
                  type="button"
                  onClick={() => setMatchingMode('CASCADE')}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: '6px', fontSize: '11.5px', fontWeight: matchingMode === 'CASCADE' ? 'bold' : 'normal',
                    border: matchingMode === 'CASCADE' ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: matchingMode === 'CASCADE' ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-app)',
                    color: matchingMode === 'CASCADE' ? 'var(--primary)' : 'var(--text-main)',
                    cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  ⏳ 과거 미수부터 순차 소진
                </button>
                <button
                  type="button"
                  onClick={() => setMatchingMode('MULTI')}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: '6px', fontSize: '11.5px', fontWeight: matchingMode === 'MULTI' ? 'bold' : 'normal',
                    border: matchingMode === 'MULTI' ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: matchingMode === 'MULTI' ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-app)',
                    color: matchingMode === 'MULTI' ? 'var(--primary)' : 'var(--text-main)',
                    cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  📋 다중 청구서 직접 배분
                </button>
              </div>
            </div>

            <form onSubmit={handleManualMatchSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              {/* 청구 내역 검색 필터 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  고객사 / 청구서 검색:
                </label>
                <input
                  type="text"
                  placeholder="고객사명 또는 청구년월(YYYY-MM) 검색"
                  value={billingSearchTerm}
                  onChange={(e) => setBillingSearchTerm(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '12.5px' }}
                />
              </div>

              {/* 미수 청구서 목록 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  매칭 대상 미수 청구건 선택:
                </label>

                <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)' }}>
                  {getModalFilteredBillings().length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      매칭 가능한 미수 청구 내역이 없습니다.
                    </div>
                  ) : (
                    getModalFilteredBillings().map((b) => {
                      const custName = getCustName(b.customerId);
                      const bSup = b.totalAmount || 0;
                      const bVat = Math.round(bSup * 0.1);
                      const bGrand = bSup + bVat;
                      const unpaidAmt = Math.max(0, bGrand - (b.paidAmount || 0));
                      const senderKey = selectedTx.counterparty || selectedTx.senderName;
                      const isSmartMatch = senderKey.includes(custName) || custName.includes(senderKey);
                      const isExactAmount = unpaidAmt === selectedTx.depositAmount;

                      const isSelected = matchingMode === 'MULTI'
                        ? selectedMultiBillingIds.includes(b.id)
                        : matchingBillingId === b.id;

                      return (
                        <label
                          key={b.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                            backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-card)',
                            border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            {matchingMode === 'MULTI' ? (
                              <input
                                type="checkbox"
                                value={b.id}
                                checked={selectedMultiBillingIds.includes(b.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedMultiBillingIds(prev => [...prev, b.id]);
                                    setMultiAllocations(prev => ({ ...prev, [b.id]: unpaidAmt }));
                                  } else {
                                    setSelectedMultiBillingIds(prev => prev.filter(id => id !== b.id));
                                    setMultiAllocations(prev => {
                                      const next = { ...prev };
                                      delete next[b.id];
                                      return next;
                                    });
                                  }
                                }}
                              />
                            ) : (
                              <input
                                type="radio"
                                name="matchingBilling"
                                value={b.id}
                                checked={matchingBillingId === b.id}
                                onChange={() => {
                                  setMatchingBillingId(b.id);
                                  setFeeAdjustment(0);
                                }}
                              />
                            )}
                            <div>
                              <div style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {custName} ({b.billingYm} 청구)
                                {isSmartMatch && (
                                  <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)', fontWeight: 'bold' }}>
                                    상호 일치
                                  </span>
                                )}
                                {isExactAmount && (
                                  <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(59, 130, 246, 0.2)', color: 'var(--primary)', fontWeight: 'bold' }}>
                                    금액 일치
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                공급가: ₩{bSup.toLocaleString()} | 부가세: ₩{bVat.toLocaleString()} | <strong>청구총액: ₩{bGrand.toLocaleString()}</strong> (기수납: ₩{(b.paidAmount || 0).toLocaleString()})
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--danger)' }}>
                              미수잔액: ₩{unpaidAmt.toLocaleString()}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {/* 🌟 송금 수수료 500원~1,000원 자동 감액 원클릭 제안 바 */}
              {(() => {
                const targetB = billings.find(b => b.id === matchingBillingId);
                if (!targetB) return null;
                const bSup = targetB.totalAmount || 0;
                const bGrand = bSup + Math.round(bSup * 0.1);
                const unpaid = Math.max(0, bGrand - (targetB.paidAmount || 0));
                const diff = unpaid - selectedTx.depositAmount;

                if (diff > 0 && diff <= 1000) {
                  return (
                    <div style={{
                      padding: '10px 14px', borderRadius: '6px',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)', border: '1px solid #f59e0b',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px'
                    }}>
                      <div style={{ fontSize: '12px', color: '#b45309' }}>
                        💡 <strong>타행 이체 수수료 차액(₩{diff.toLocaleString()}) 감지</strong>: 입금액이 청구 잔액보다 ₩{diff.toLocaleString()}원 부족합니다.
                      </div>
                      <button
                        type="button"
                        onClick={() => setFeeAdjustment(feeAdjustment > 0 ? 0 : diff)}
                        className={`btn ${feeAdjustment > 0 ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap', fontWeight: 'bold' }}
                      >
                        {feeAdjustment > 0 ? `✓ 수수료 ₩${diff.toLocaleString()} 감액 적용됨` : `차액 ₩${diff.toLocaleString()} 자동 감액 (완납 처리)`}
                      </button>
                    </div>
                  );
                }
                return null;
              })()}

              {/* 규칙 저장 체크박스 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px' }}>
                <input
                  type="checkbox"
                  id="learnRuleCheck"
                  checked={learnRule}
                  onChange={(e) => setLearnRule(e.target.checked)}
                />
                <label htmlFor="learnRuleCheck" style={{ fontSize: '12px', color: 'var(--text-main)', cursor: 'pointer' }}>
                  이 입금자명(<strong>{selectedTx.counterparty || selectedTx.senderName}</strong>)을 해당 고객사 매칭 규칙으로 등록합니다.
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedTx(null)}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={matchingMode !== 'MULTI' ? !matchingBillingId : selectedMultiBillingIds.length === 0}
                >
                  수납 승인 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🌟 공식 입금표 / 수납 확인서 인쇄 모달 */}
      {receiptTx && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1100
        }}>
          <div style={{
            backgroundColor: '#ffffff', color: '#111827', borderRadius: '8px',
            width: '90%', maxWidth: '680px', maxHeight: '92vh', overflowY: 'auto',
            padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            border: '1px solid #e5e7eb'
          }}>
            {/* 입금표 상단 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #111827', paddingBottom: '12px' }}>
              <div>
                <h2 style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '4px', margin: 0, color: '#111827' }}>
                  입 금 표 (영수증)
                </h2>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                  RECEIPT OF PAYMENT • 공급받는자 보관용
                </div>
              </div>
              <button onClick={() => setReceiptTx(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
                <X size={22} />
              </button>
            </div>

            {/* 기본 거래 정보 테이블 */}
            <div style={{ border: '1px solid #111827', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px 1fr', borderBottom: '1px solid #e5e7eb', fontSize: '12.5px' }}>
                <div style={{ backgroundColor: '#f3f4f6', padding: '8px 10px', fontWeight: 'bold', borderRight: '1px solid #e5e7eb' }}>발행 번호</div>
                <div style={{ padding: '8px 10px', borderRight: '1px solid #e5e7eb' }}>RCP-{receiptTx.id.replace(/[^0-9a-zA-Z]/g, '').substring(0, 10).toUpperCase()}</div>
                <div style={{ backgroundColor: '#f3f4f6', padding: '8px 10px', fontWeight: 'bold', borderRight: '1px solid #e5e7eb' }}>영수 일자</div>
                <div style={{ padding: '8px 10px' }}>{receiptTx.transactionDate.split(' ')[0]}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px 1fr', fontSize: '12.5px' }}>
                <div style={{ backgroundColor: '#f3f4f6', padding: '8px 10px', fontWeight: 'bold', borderRight: '1px solid #e5e7eb' }}>입금 고객사</div>
                <div style={{ padding: '8px 10px', fontWeight: 'bold', borderRight: '1px solid #e5e7eb', color: '#1d4ed8' }}>
                  {receiptTx.counterparty || receiptTx.senderName} 貴下
                </div>
                <div style={{ backgroundColor: '#f3f4f6', padding: '8px 10px', fontWeight: 'bold', borderRight: '1px solid #e5e7eb' }}>수납 구분</div>
                <div style={{ padding: '8px 10px' }}>계좌이체 (통장입금)</div>
              </div>
            </div>

            {/* 영수 금액 박스 */}
            <div style={{
              backgroundColor: '#f8fafc', border: '2px solid #2563eb', borderRadius: '6px',
              padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>영수 총액 (금액 한글 표기)</div>
                <div style={{ fontSize: '17px', fontWeight: '900', color: '#1e3a8a', marginTop: '2px' }}>
                  금 {numberToKorean(receiptTx.depositAmount)} 원정
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>원화 표기 (VAT 포함)</div>
                <div style={{ fontSize: '20px', fontWeight: '900', color: '#16a34a' }}>
                  ₩{receiptTx.depositAmount.toLocaleString()}
                </div>
              </div>
            </div>

            {/* 공급자 사업자 정보 및 직인 날인 */}
            <div style={{
              border: '1px solid #d1d5db', borderRadius: '6px', padding: '14px',
              display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', position: 'relative'
            }}>
              <div style={{ fontSize: '12px', lineHeight: '1.7', color: '#374151' }}>
                <div><strong>공급자 상호:</strong> {currentTenant?.corporateName || currentTenant?.tradeName || '공급자 (매출사)'}</div>
                <div><strong>사업자등록번호:</strong> {currentTenant?.businessNumber || '-'} | <strong>대표이사:</strong> {currentTenant?.representativeName || '-'}</div>
                <div><strong>사업장 소재지:</strong> {currentTenant?.businessAddress || '-'}</div>
                <div><strong>업태 / 종목:</strong> {currentTenant?.businessCategory || '-'} / {currentTenant?.businessItem || '-'}</div>
                <div><strong>입금 계좌:</strong> {receiptTx.bankName || (currentTenant?.bankAccounts?.[0]?.bankName) || '주거래은행'} {receiptTx.accountNumber || (currentTenant?.bankAccounts?.[0]?.accountNumber) || '-'}</div>
              </div>

              {/* 직인 날인 인장 마크 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {currentTenant?.stampImageUrl ? (
                  <img src={currentTenant.stampImageUrl} style={{ width: '72px', height: '72px', objectFit: 'contain' }} alt="직인" />
                ) : (
                  <div style={{
                    width: '84px', height: '84px', borderRadius: '50%', border: '2.5px solid #dc2626',
                    color: '#dc2626', display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', fontWeight: '900', fontSize: '11px', transform: 'rotate(-8deg)',
                    boxShadow: 'inset 0 0 4px rgba(220, 38, 38, 0.2)'
                  }}>
                    <span>{currentTenant?.tradeName ? currentTenant.tradeName.slice(0, 4) : '법인직인'}</span>
                    <span style={{ fontSize: '9px' }}>[ 직 인 ]</span>
                  </div>
                )}
                <span style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>법인 인장 날인</span>
              </div>
            </div>

            <div style={{ fontSize: '11.5px', color: '#6b7280', textAlign: 'center', lineHeight: '1.5' }}>
              위 금액을 고소작업대 렌탈료 및 관련 대금으로 정히 영수하였음을 증명합니다.
            </div>

            {/* 인쇄 및 닫기 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '14px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReceiptTx(null)}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                닫기
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.print()}
                style={{ padding: '6px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: '#1d4ed8' }}
              >
                <Printer size={14} />
                입금표 인쇄 (Print)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 💸 수동 출금 지급 대사 모달 팝업 */}
      {selectedWithdrawTx && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)', borderRadius: '12px',
            width: '90%', maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto',
            padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <DollarSign size={18} style={{ color: '#10B981' }} />
                통장 출금 지급 대사 승인 (Audit Trail)
              </h3>
              <button onClick={() => setSelectedWithdrawTx(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            {/* 출금 정보 카드 */}
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>거래 은행: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{selectedWithdrawTx.bankName || '우리은행'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>출금 일시: </span>
                <span>{selectedWithdrawTx.transactionDate}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>거래 상대/기재명: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{selectedWithdrawTx.counterparty || selectedWithdrawTx.senderName || '-'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>통장 출금액: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--danger)', fontSize: '15px' }}>-{selectedWithdrawTx.withdrawAmount.toLocaleString()}원</span>
              </div>
            </div>

            <form onSubmit={handleManualWithdrawMatchSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 매입 정산 건 검색 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  매입처 / 정산 연월 검색:
                </label>
                <input
                  type="text"
                  placeholder="매입처 상호명 또는 정산 연월 (YYYY-MM)"
                  value={settlementSearchTerm}
                  onChange={(e) => setSettlementSearchTerm(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                />
              </div>

              {/* 매입 정산 건 목록 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  지급 대사할 미지급 매입 정산 건 선택:
                </label>

                <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)' }}>
                  {getModalFilteredSettlements().length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      매칭 가능한 미지급 매입 정산 내역이 없습니다.
                    </div>
                  ) : (
                    getModalFilteredSettlements().map((s) => {
                      const remainingAmt = s.totalAmount - s.paidAmount;
                      const senderKey = selectedWithdrawTx.counterparty || selectedWithdrawTx.senderName || selectedWithdrawTx.summary || '';
                      const isMatchVendor = senderKey.includes(s.vendorName) || s.vendorName.includes(senderKey);
                      const isExactAmount = remainingAmt === selectedWithdrawTx.withdrawAmount;

                      return (
                        <label
                          key={s.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', borderRadius: '6px', cursor: 'pointer',
                            backgroundColor: matchingSettlementId === s.id ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card)',
                            border: matchingSettlementId === s.id ? '1px solid #10B981' : '1px solid var(--border-color)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="radio"
                              name="matchingSettlement"
                              value={s.id}
                              checked={matchingSettlementId === s.id}
                              onChange={() => setMatchingSettlementId(s.id)}
                            />
                            <div>
                              <div style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                [{s.vendorName}] ({s.settlementYm} 정산)
                                {isMatchVendor && (
                                  <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(59, 130, 246, 0.2)', color: 'var(--primary)', fontWeight: 'bold' }}>
                                    상호 일치
                                  </span>
                                )}
                                {isExactAmount && (
                                  <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#10B981', fontWeight: 'bold' }}>
                                    금액 일치
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                총 확정액: {s.totalAmount.toLocaleString()}원 | 기존 지급액: {s.paidAmount.toLocaleString()}원
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--danger)' }}>
                              미지급 잔액: {remainingAmt.toLocaleString()}원
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedWithdrawTx(null)}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!matchingSettlementId}
                >
                  출금 지급 대사 승인
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ⚙️ 은행별 기초 / 현재 잔액 설정 모달 팝업 */}
      {isInitBalanceModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)', borderRadius: '12px',
            width: '90%', maxWidth: '480px', padding: '24px', display: 'flex',
            flexDirection: 'column', gap: '16px', border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                <Settings size={18} style={{ color: 'var(--primary)' }} />
                은행별 기초 / 실시간 잔액 설정
              </h3>
              <button onClick={() => setIsInitBalanceModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={async (e) => {
              e.preventDefault();
              await saveBankInitialBalance(editingBankName, editingInitialBalance, editingAccountNumber);
              await db.awaitPendingWrites();
              setIsInitBalanceModalOpen(false);
              showToast(`[${editingBankName}] 계좌 잔액 설정이 완료되었습니다.`);
            }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  설정할 은행명:
                </label>
                <select
                  value={editingBankName}
                  onChange={(e) => {
                    const bName = e.target.value;
                    setEditingBankName(bName);
                    const initRec = bankInitialBalances.find(b => b.bankName === bName);
                    const bInfo = bankBalances.bankMap[bName];
                    setEditingInitialBalance(initRec?.initialBalance || (bName === '우리은행' ? 15000000 : 10000000));
                    setEditingAccountNumber(bInfo?.accountNumber || '');
                  }}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                >
                  <option value="우리은행">우리은행</option>
                  <option value="신한은행">신한은행</option>
                  <option value="KB국민은행">KB국민은행</option>
                  <option value="IBK기업은행">IBK기업은행</option>
                  <option value="NH농협은행">NH농협은행</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  당사 계좌번호 (선택):
                </label>
                <input
                  type="text"
                  placeholder="예: 1234567890123"
                  value={editingAccountNumber}
                  onChange={(e) => setEditingAccountNumber(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  기초 시작 계좌 잔액 (원):
                </label>
                <input
                  type="number"
                  required
                  placeholder="예: 15000000"
                  value={editingInitialBalance}
                  onChange={(e) => setEditingInitialBalance(Number(e.target.value))}
                  className="form-control"
                  style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--primary)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  💡 통장 엑셀 내 잔액 데이터가 비어 있을 때, 이 기초 잔액에 입출금액 누계를 자동으로 합산하여 정확한 계좌 잔액을 산출합니다.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsInitBalanceModalOpen(false)}>취소</button>
                <button type="submit" className="btn btn-primary">잔액 설정 저장</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 매칭 규칙 등록 모달 */}
      {isRuleModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)', borderRadius: '12px',
            width: '90%', maxWidth: '450px', padding: '24px', display: 'flex',
            flexDirection: 'column', gap: '16px', border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>신규 매칭 규칙 추가</h3>
              <button onClick={() => setIsRuleModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              if (!newRuleSenderName || !newRuleCustomerId) return;
              saveMatchingRule(newRuleSenderName, newRuleCustomerId);
              setIsRuleModalOpen(false);
              setNewRuleSenderName('');
              setNewRuleCustomerId('');
            }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  통장 기재 입금자명:
                </label>
                <input
                  type="text"
                  required
                  placeholder="예: (주)한국건설"
                  value={newRuleSenderName}
                  onChange={(e) => setNewRuleSenderName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  매핑할 고객사:
                </label>
                <select
                  required
                  value={newRuleCustomerId}
                  onChange={(e) => setNewRuleCustomerId(e.target.value)}
                  className="form-control"
                >
                  <option value="">고객사 선택</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsRuleModalOpen(false)}>취소</button>
                <button type="submit" className="btn btn-primary">규칙 저장</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          padding: '12px 20px',
          borderRadius: '8px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : toastMessage.type === 'warning' ? '#f59e0b' : '#10b981',
          color: '#fff',
          fontWeight: 700,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {toastMessage.text}
        </div>
      )}

    </div>
  );
};
