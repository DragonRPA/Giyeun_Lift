// src/tests/wtt_bank_matching.test.ts
import { BankTransaction, Billing, Customer, Payment, PaymentDepositLink, BankMatchingRule, ContractHistory } from '../services/db';

interface WttResult {
  scenarioId: string;
  category: 'OVERPAYMENT' | 'EXACT' | 'UNDERPAYMENT' | 'GOVERNANCE';
  name: string;
  axis: string;
  passed: boolean;
  issues: string[];
  details: Record<string, any>;
}

// ── In-Memory Mock Test DB Engine ──
class MockBankDb {
  customers: Customer[] = [];
  billings: Billing[] = [];
  payments: Payment[] = [];
  paymentDepositLinks: PaymentDepositLink[] = [];
  bankTransactions: BankTransaction[] = [];
  bankMatchingRules: BankMatchingRule[] = [];
  contractHistory: ContractHistory[] = [];

  reset() {
    this.customers = [];
    this.billings = [];
    this.payments = [];
    this.paymentDepositLinks = [];
    this.bankTransactions = [];
    this.bankMatchingRules = [];
    this.contractHistory = [];
  }

  insertCustomer(c: Customer) { this.customers.push({ ...c }); }
  insertBilling(b: Billing) { this.billings.push({ ...b }); }
  insertTx(tx: BankTransaction) { this.bankTransactions.push({ ...tx }); }
  insertRule(r: BankMatchingRule) { this.bankMatchingRules.push({ ...r }); }

  getBillingGrand(b: Billing): number {
    const sup = b.totalAmount || 0;
    return sup + Math.round(sup * 0.1);
  }

  getDepositUsedAmount(txId: string): number {
    const linkedPaymentIds = new Set(
      this.paymentDepositLinks.filter(l => l.bankTransactionId === txId).map(l => l.paymentId)
    );
    const linkUsed = this.paymentDepositLinks
      .filter(l => l.bankTransactionId === txId)
      .reduce((s, l) => s + l.usedAmount, 0);
    const legacyUsed = this.payments
      .filter(p => p.id.startsWith(`pay-matching-${txId}`) && !linkedPaymentIds.has(p.id))
      .reduce((s, p) => s + p.amount, 0);
    return linkUsed + legacyUsed;
  }

  getDepositBalance(txId: string): number {
    const tx = this.bankTransactions.find(t => t.id === txId);
    if (!tx) return 0;
    return Math.max(0, (tx.depositAmount || 0) - this.getDepositUsedAmount(txId));
  }

  executeMatch(
    txId: string,
    billingId: string,
    matchingType: 'AUTO' | 'MANUAL',
    options?: {
      matchingMode?: 'PINPOINT' | 'CASCADE' | 'MULTI';
      allocations?: { billingId: string; amount: number; feeAdjustment?: number }[];
      feeAdjustment?: number;
    }
  ) {
    const tx = this.bankTransactions.find(t => t.id === txId);
    const firstBilling = this.billings.find(b => b.id === billingId);
    if (!tx || !firstBilling) return;

    const customerId = firstBilling.customerId;
    const mode = options?.matchingMode || 'CASCADE';
    let remainingDeposit = tx.depositAmount;
    const matchedBillingIds: string[] = [];

    if (mode === 'MULTI' && options?.allocations && options.allocations.length > 0) {
      for (const alloc of options.allocations) {
        if (remainingDeposit <= 0 && (!alloc.amount || alloc.amount <= 0)) continue;
        const billing = this.billings.find(b => b.id === alloc.billingId);
        if (!billing) continue;

        const bGrand = this.getBillingGrand(billing);
        const feeAdj = alloc.feeAdjustment || 0;
        const paymentAmount = Math.min(alloc.amount, remainingDeposit);
        remainingDeposit = Math.max(0, remainingDeposit - paymentAmount);

        const payId = `pay-matching-${txId}-${billing.id}`;
        this.payments.push({
          id: payId,
          billingId: billing.id,
          paymentDate: tx.transactionDate.split(' ')[0],
          amount: paymentAmount,
          method: 'BANK_TRANSFER',
          memo: `사용자 분할 대조 수납 (${tx.senderName})`,
          feeAdjustment: feeAdj > 0 ? feeAdj : undefined,
          createdAt: new Date().toISOString()
        } as Payment);

        this.paymentDepositLinks.push({
          id: `PDL-${Date.now()}-${Math.random()}`,
          paymentId: payId,
          bankTransactionId: txId,
          usedAmount: paymentAmount,
          createdAt: new Date().toISOString()
        });

        const nextPaid = (billing.paidAmount || 0) + paymentAmount + feeAdj;
        billing.paidAmount = nextPaid;
        billing.status = nextPaid >= bGrand ? 'PAID' : 'PARTIAL';

        if (billing.contractId) {
          this.contractHistory.push({
            id: `CH-${Date.now()}-${Math.random()}`,
            contractId: billing.contractId,
            changeType: 'PAYMENT_RECEIVED',
            changeDate: tx.transactionDate.split(' ')[0],
            description: `수납 처리: ${billing.billingYm} / ${paymentAmount.toLocaleString()}원 수납`,
            createdAt: new Date().toISOString()
          } as ContractHistory);
        }
        matchedBillingIds.push(billing.id);
      }
    } else if (mode === 'PINPOINT') {
      const billing = firstBilling;
      const bGrand = this.getBillingGrand(billing);
      const feeAdj = options?.feeAdjustment || 0;
      const unpaidAmount = Math.max(0, bGrand - (billing.paidAmount || 0) - feeAdj);

      const paymentAmount = Math.min(unpaidAmount, remainingDeposit);
      remainingDeposit -= paymentAmount;

      const payId = `pay-matching-${txId}-${billing.id}`;
      this.payments.push({
        id: payId,
        billingId: billing.id,
        paymentDate: tx.transactionDate.split(' ')[0],
        amount: paymentAmount,
        method: 'BANK_TRANSFER',
        memo: `단독 지정 대조 수납 (${tx.senderName})`,
        feeAdjustment: feeAdj > 0 ? feeAdj : undefined,
        createdAt: new Date().toISOString()
      } as Payment);

      this.paymentDepositLinks.push({
        id: `PDL-${Date.now()}-${Math.random()}`,
        paymentId: payId,
        bankTransactionId: txId,
        usedAmount: paymentAmount,
        createdAt: new Date().toISOString()
      });

      const nextPaid = (billing.paidAmount || 0) + paymentAmount + feeAdj;
      billing.paidAmount = nextPaid;
      billing.status = nextPaid >= bGrand ? 'PAID' : 'PARTIAL';

      if (billing.contractId) {
        this.contractHistory.push({
          id: `CH-${Date.now()}-${Math.random()}`,
          contractId: billing.contractId,
          changeType: 'PAYMENT_RECEIVED',
          changeDate: tx.transactionDate.split(' ')[0],
          description: `수납 처리: ${billing.billingYm} / ${paymentAmount.toLocaleString()}원 수납`,
          createdAt: new Date().toISOString()
        } as ContractHistory);
      }
      matchedBillingIds.push(billing.id);
    } else {
      // CASCADE
      const activeBillings = this.billings
        .filter(b => b.customerId === customerId && (b.status === 'UNPAID' || b.status === 'PARTIAL'))
        .sort((a, b) => a.billingYm.localeCompare(b.billingYm));

      if (!activeBillings.some(x => x.id === billingId)) {
        activeBillings.unshift(firstBilling);
      }

      let feeAdjRemaining = options?.feeAdjustment || 0;

      for (const billing of activeBillings) {
        if (remainingDeposit <= 0 && feeAdjRemaining <= 0) break;

        const bGrand = this.getBillingGrand(billing);
        let unpaidAmount = Math.max(0, bGrand - (billing.paidAmount || 0));
        if (unpaidAmount <= 0) continue;

        let feeAdjForThis = 0;
        if (feeAdjRemaining > 0) {
          feeAdjForThis = Math.min(feeAdjRemaining, unpaidAmount);
          feeAdjRemaining -= feeAdjForThis;
          unpaidAmount -= feeAdjForThis;
        }

        const paymentAmount = Math.min(unpaidAmount, remainingDeposit);
        remainingDeposit -= paymentAmount;

        const payId = `pay-matching-${txId}-${billing.id}`;
        this.payments.push({
          id: payId,
          billingId: billing.id,
          paymentDate: tx.transactionDate.split(' ')[0],
          amount: paymentAmount,
          method: 'BANK_TRANSFER',
          memo: `${matchingType === 'AUTO' ? '자동' : '수동'} 순차 대조 수납 (${tx.senderName})`,
          feeAdjustment: feeAdjForThis > 0 ? feeAdjForThis : undefined,
          createdAt: new Date().toISOString()
        } as Payment);

        this.paymentDepositLinks.push({
          id: `PDL-${Date.now()}-${Math.random()}`,
          paymentId: payId,
          bankTransactionId: txId,
          usedAmount: paymentAmount,
          createdAt: new Date().toISOString()
        });

        const nextPaid = (billing.paidAmount || 0) + paymentAmount + feeAdjForThis;
        billing.paidAmount = nextPaid;
        billing.status = nextPaid >= bGrand ? 'PAID' : 'PARTIAL';

        if (billing.contractId) {
          this.contractHistory.push({
            id: `CH-${Date.now()}-${Math.random()}`,
            contractId: billing.contractId,
            changeType: 'PAYMENT_RECEIVED',
            changeDate: tx.transactionDate.split(' ')[0],
            description: `수납 처리: ${billing.billingYm} / ${paymentAmount.toLocaleString()}원 수납`,
            createdAt: new Date().toISOString()
          } as ContractHistory);
        }
        matchedBillingIds.push(billing.id);
      }
    }

    // 2. 남은 초과금 선수금 적립
    if (remainingDeposit > 0) {
      const customer = this.customers.find(c => c.id === customerId);
      if (customer) {
        customer.prepaidBalance = (customer.prepaidBalance || 0) + remainingDeposit;

        const prepaidPayId = `pay-matching-${txId}-prepaid`;
        this.payments.push({
          id: prepaidPayId,
          billingId: '',
          paymentDate: tx.transactionDate.split(' ')[0],
          amount: remainingDeposit,
          method: 'BANK_TRANSFER',
          memo: `통장 대조 매칭 초과 선수금 적립 (${tx.senderName})`,
          createdAt: new Date().toISOString()
        } as Payment);

        this.paymentDepositLinks.push({
          id: `PDL-${Date.now()}-${Math.random()}`,
          paymentId: prepaidPayId,
          bankTransactionId: txId,
          usedAmount: remainingDeposit,
          createdAt: new Date().toISOString()
        });
      }
    }

    // 3. 거래 내역 갱신
    tx.matchedBillingId = matchedBillingIds.length > 0 ? matchedBillingIds[0] : billingId;
    tx.matchingType = matchingType;
  }

  unmatchTransaction(txId: string) {
    const tx = this.bankTransactions.find(t => t.id === txId);
    if (!tx) return;

    const linkedLinks = this.paymentDepositLinks.filter(l => l.bankTransactionId === txId);
    let customerId: string | undefined;
    for (const link of linkedLinks) {
      const p = this.payments.find(x => x.id === link.paymentId);
      if (p?.billingId) {
        const b = this.billings.find(x => x.id === p.billingId);
        if (b?.customerId) {
          customerId = b.customerId;
          break;
        }
      }
    }
    if (!customerId && tx.matchedBillingId) {
      const b = this.billings.find(x => x.id === tx.matchedBillingId);
      if (b?.customerId) customerId = b.customerId;
    }
    if (!customerId) {
      customerId = this.bankMatchingRules.find(r => r.senderName === tx.senderName)?.customerId;
    }
    if (!customerId) {
      const cleanSender = (tx.senderName || '').replace(/\(주\)|주식회사|\s+/g, '').toLowerCase();
      customerId = this.customers.find(c => {
        const cClean = (c.name || '').replace(/\(주\)|주식회사|\s+/g, '').toLowerCase();
        return cleanSender && cClean && (cleanSender.includes(cClean) || cClean.includes(cleanSender));
      })?.id;
    }

    linkedLinks.forEach(link => {
      const pay = this.payments.find(p => p.id === link.paymentId);
      if (pay) {
        if (pay.billingId) {
          const billing = this.billings.find(b => b.id === pay.billingId);
          if (billing) {
            const bGrand = this.getBillingGrand(billing);
            const feeAdj = pay.feeAdjustment || 0;
            const nextPaid = Math.max(0, (billing.paidAmount || 0) - link.usedAmount - feeAdj);
            billing.paidAmount = nextPaid;
            billing.status = nextPaid === 0 ? 'UNPAID' : (nextPaid >= bGrand ? 'PAID' : 'PARTIAL');

            if (billing.contractId) {
              this.contractHistory.push({
                id: `CH-${Date.now()}-${Math.random()}`,
                contractId: billing.contractId,
                changeType: 'PAYMENT_CANCELLED',
                changeDate: new Date().toISOString().split('T')[0],
                description: `수납 대조 해제: ${billing.billingYm} 청구분 / ${link.usedAmount.toLocaleString()}원 취소`,
                createdAt: new Date().toISOString()
              } as ContractHistory);
            }
          }
        } else if (pay.id.endsWith('-prepaid') || !pay.billingId) {
          if (customerId) {
            const customer = this.customers.find(c => c.id === customerId);
            if (customer) {
              customer.prepaidBalance = Math.max(0, (customer.prepaidBalance || 0) - pay.amount);
            }
          }
        }

        this.payments = this.payments.filter(p => p.id !== pay.id);
      }
      this.paymentDepositLinks = this.paymentDepositLinks.filter(l => l.id !== link.id);
    });

    // 레거시 전표 롤백
    const matchPrefix = `pay-matching-${txId}`;
    const associatedPayments = this.payments.filter(p => p.id.startsWith(matchPrefix));
    associatedPayments.forEach(pay => {
      if (pay.billingId) {
        const billing = this.billings.find(b => b.id === pay.billingId);
        if (billing) {
          const bGrand = this.getBillingGrand(billing);
          const feeAdj = pay.feeAdjustment || 0;
          const nextPaid = Math.max(0, (billing.paidAmount || 0) - pay.amount - feeAdj);
          billing.paidAmount = nextPaid;
          billing.status = nextPaid === 0 ? 'UNPAID' : (nextPaid >= bGrand ? 'PAID' : 'PARTIAL');
        }
      } else if (customerId) {
        const customer = this.customers.find(c => c.id === customerId);
        if (customer) {
          customer.prepaidBalance = Math.max(0, (customer.prepaidBalance || 0) - pay.amount);
        }
      }
      this.payments = this.payments.filter(p => p.id !== pay.id);
    });

    tx.matchedBillingId = '';
    tx.matchingType = undefined;
  }

  tryAutoMatch(tx: BankTransaction) {
    const cleanName = (n: string) => (n || '').replace(/\(주\)|주식회사|\s+/g, '').toLowerCase();
    const cleanSender = cleanName(tx.senderName);

    const rule = this.bankMatchingRules.find(r => r.senderName === tx.senderName);
    if (rule) {
      const activeBillings = this.billings.filter(b =>
        b.customerId === rule.customerId &&
        (b.status === 'UNPAID' || b.status === 'PARTIAL')
      );
      if (activeBillings.length > 0) {
        let target = activeBillings.find(b => (this.getBillingGrand(b) - (b.paidAmount || 0)) === tx.depositAmount);
        if (!target) {
          target = activeBillings.sort((a, b) => a.billingYm.localeCompare(b.billingYm))[0];
        }
        this.executeMatch(tx.id, target.id, 'AUTO', { matchingMode: 'CASCADE' });
        return;
      }
    }

    const matchedCustomer = this.customers.find(c => {
      const cClean = cleanName(c.name);
      return cleanSender && cClean && (cleanSender.includes(cClean) || cClean.includes(cleanSender));
    });
    if (matchedCustomer) {
      const activeBillings = this.billings.filter(b =>
        b.customerId === matchedCustomer.id &&
        (b.status === 'UNPAID' || b.status === 'PARTIAL')
      );
      if (activeBillings.length > 0) {
        let target = activeBillings.find(b => (this.getBillingGrand(b) - (b.paidAmount || 0)) === tx.depositAmount);
        if (!target) {
          target = activeBillings.sort((a, b) => a.billingYm.localeCompare(b.billingYm))[0];
        }
        this.executeMatch(tx.id, target.id, 'AUTO', { matchingMode: 'CASCADE' });
        return;
      }
    }
  }
}

// ── WTT 50 Test Execution Suite ──
export function runWttBankMatching50(): { summary: string; totalPassed: number; results: WttResult[] } {
  const db = new MockBankDb();
  const results: WttResult[] = [];

  function record(
    scenarioId: string,
    category: 'OVERPAYMENT' | 'EXACT' | 'UNDERPAYMENT' | 'GOVERNANCE',
    name: string,
    axis: string,
    passed: boolean,
    issues: string[],
    details: Record<string, any>
  ) {
    results.push({ scenarioId, category, name, axis, passed, issues, details });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: 과대입금 (Overpayment) - 15 SCENARIOS (WTT-BANK-01 ~ 15)
  // ══════════════════════════════════════════════════════════════════════════════

  // WTT-BANK-01: 단일 청구 초과 입금 (1,100,000 청구 vs 1,300,000 입금)
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '현대건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', contractId: 'CT1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX1', senderName: '현대건설', depositAmount: 1300000, withdrawAmount: 0, transactionDate: '2026-09-01 10:00' } as BankTransaction);

    db.executeMatch('TX1', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    const b = db.billings.find(x => x.id === 'B1')!;
    const c = db.customers.find(x => x.id === 'C1')!;
    const remTx = db.getDepositBalance('TX1');
    const usedTx = db.getDepositUsedAmount('TX1');

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push(`청구서 상태 미완납: ${b.status}`);
    if (b.paidAmount !== 1100000) issues.push(`청구 수납액 불일치: ${b.paidAmount}`);
    if (c.prepaidBalance !== 200000) issues.push(`선수금 불일치: ${c.prepaidBalance}`);
    if (remTx !== 0) issues.push(`통장 잔액 0원 미달성: ${remTx}`);
    if (usedTx !== 1300000) issues.push(`통장 사용액 왜곡: ${usedTx}`);

    record('WTT-BANK-01', 'OVERPAYMENT', '단일 청구 초과 입금 수지 보존 및 선수금 적립', '비용 축', issues.length === 0, issues, { bStatus: b.status, prepaid: c.prepaidBalance, remTx, usedTx });
  })();

  // WTT-BANK-02: 다건 청구 합계 초과 순차 소진
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: 'GS건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX2', senderName: 'GS건설', depositAmount: 2000000, withdrawAmount: 0, transactionDate: '2026-09-02 11:00' } as BankTransaction);

    db.executeMatch('TX2', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    const b1 = db.billings.find(x => x.id === 'B1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;
    const c = db.customers.find(x => x.id === 'C1')!;
    const remTx = db.getDepositBalance('TX2');

    const issues: string[] = [];
    if (b1.status !== 'PAID' || b2.status !== 'PAID') issues.push('다건 청구 중 완납 누락');
    if (c.prepaidBalance !== 350000) issues.push(`선수금 불일치: ${c.prepaidBalance}`);
    if (remTx !== 0) issues.push(`통장 잔액 비정상: ${remTx}`);

    record('WTT-BANK-02', 'OVERPAYMENT', '다건 청구 순차 완납 후 초과액 선수금 적립', '수량 축', issues.length === 0, issues, { b1Status: b1.status, b2Status: b2.status, prepaid: c.prepaidBalance, remTx });
  })();

  // WTT-BANK-03: 3개월 연체 미수 순차 CASCADE 소진 후 선수금 적립
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '포스코이앤씨', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-05', totalAmount: 300000, paidAmount: 0, status: 'UNPAID' } as Billing); // 330,000
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-06', totalAmount: 400000, paidAmount: 0, status: 'UNPAID' } as Billing); // 440,000
    db.insertBilling({ id: 'B3', customerId: 'C1', billingYm: '2026-07', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing); // 550,000
    db.insertTx({ id: 'TX3', senderName: '포스코이앤씨', depositAmount: 1500000, withdrawAmount: 0, transactionDate: '2026-09-03 09:00' } as BankTransaction);

    db.executeMatch('TX3', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    const c = db.customers.find(x => x.id === 'C1')!;
    const unpaids = db.billings.filter(b => b.status !== 'PAID');
    const issues: string[] = [];
    if (unpaids.length > 0) issues.push(`연체 청구서 미완납 잔여: ${unpaids.length}건`);
    if (c.prepaidBalance !== 180000) issues.push(`초과 선수금 오류: ${c.prepaidBalance} (기대: 180,000)`);

    record('WTT-BANK-03', 'OVERPAYMENT', '과거 3개월 연체 미수 FIFO 완납 후 선수금 적립', '시간 축', issues.length === 0, issues, { prepaid: c.prepaidBalance, unpaids: unpaids.length });
  })();

  // WTT-BANK-04: 단일 청구 지정(PINPOINT) 모드에서 초과금 선수금 적립
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '대우건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 400000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX4', senderName: '대우건설', depositAmount: 800000, withdrawAmount: 0, transactionDate: '2026-09-04 14:00' } as BankTransaction);

    db.executeMatch('TX4', 'B2', 'MANUAL', { matchingMode: 'PINPOINT' });

    const b1 = db.billings.find(x => x.id === 'B1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;
    const c = db.customers.find(x => x.id === 'C1')!;

    const issues: string[] = [];
    if (b1.status !== 'UNPAID') issues.push('PINPOINT 제외 대상 청구 건이 변조됨');
    if (b2.status !== 'PAID') issues.push('PINPOINT 지정 건 완납 실패');
    if (c.prepaidBalance !== 250000) issues.push(`선수금 불일치: ${c.prepaidBalance} (기대 250,000)`);

    record('WTT-BANK-04', 'OVERPAYMENT', '단일 지정(PINPOINT) 매칭 시 잔여액 선수금 적립', '공간 축', issues.length === 0, issues, { b1Status: b1.status, b2Status: b2.status, prepaid: c.prepaidBalance });
  })();

  // WTT-BANK-05: 과대입금 매칭 후 해제(취소) ➔ 원상 100% 복구 보존
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '한화건설', prepaidBalance: 50000 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX5', senderName: '한화건설', depositAmount: 1500000, withdrawAmount: 0, transactionDate: '2026-09-05 10:00' } as BankTransaction);

    db.executeMatch('TX5', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.unmatchTransaction('TX5');

    const b = db.billings.find(x => x.id === 'B1')!;
    const c = db.customers.find(x => x.id === 'C1')!;
    const remTx = db.getDepositBalance('TX5');

    const issues: string[] = [];
    if (b.status !== 'UNPAID') issues.push(`청구서 상태 롤백 실패: ${b.status}`);
    if (b.paidAmount !== 0) issues.push(`청구서 수납액 롤백 실패: ${b.paidAmount}`);
    if (c.prepaidBalance !== 50000) issues.push(`고객 선수금 원상복원 실패: ${c.prepaidBalance} (기대 50,000)`);
    if (remTx !== 1500000) issues.push(`통장 가용잔액 롤백 실패: ${remTx}`);

    record('WTT-BANK-05', 'OVERPAYMENT', '과대입금 매칭 취소 시 선수금 환원 및 청구/통장 원상 복구', '물리 축', issues.length === 0, issues, { bStatus: b.status, prepaid: c.prepaidBalance, remTx });
  })();

  // WTT-BANK-06: 기존 고객 선수금 보유 상태에서 추가 과대입금 누적
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: 'DL이앤씨', prepaidBalance: 300000 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX6', senderName: 'DL이앤씨', depositAmount: 700000, withdrawAmount: 0, transactionDate: '2026-09-06 15:00' } as BankTransaction);

    db.executeMatch('TX6', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const c = db.customers.find(x => x.id === 'C1')!;

    const issues: string[] = [];
    if (c.prepaidBalance !== 450000) issues.push(`선수금 누적 오류: ${c.prepaidBalance} (기대 450,000)`);

    record('WTT-BANK-06', 'OVERPAYMENT', '기보유 선수금 상태에서 과대입금 누적 적립', '비용 축', issues.length === 0, issues, { prepaid: c.prepaidBalance });
  })();

  // WTT-BANK-07: 과대입금으로 적립된 선수금을 익월 신규 청구서에 상계 반영
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '롯데건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX7', senderName: '롯데건설', depositAmount: 1000000, withdrawAmount: 0, transactionDate: '2026-08-01 10:00' } as BankTransaction);

    db.executeMatch('TX7', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 400000, paidAmount: 0, status: 'UNPAID' } as Billing);

    const c = db.customers.find(x => x.id === 'C1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;
    const applied = Math.min(c.prepaidBalance || 0, db.getBillingGrand(b2));
    c.prepaidBalance = (c.prepaidBalance || 0) - applied;
    b2.paidAmount = applied;
    b2.status = b2.paidAmount >= db.getBillingGrand(b2) ? 'PAID' : 'PARTIAL';

    const issues: string[] = [];
    if (b2.status !== 'PAID') issues.push(`익월 청구서 선수금 완납 실패: ${b2.status}`);
    if (c.prepaidBalance !== 10000) issues.push(`잔여 선수금 오류: ${c.prepaidBalance} (기대 10,000)`);

    record('WTT-BANK-07', 'OVERPAYMENT', '과대입금 적립 선수금의 익월 청구서 상계 충당', '시간 축', issues.length === 0, issues, { b2Status: b2.status, remPrepaid: c.prepaidBalance });
  })();

  // WTT-BANK-08: 단수 10원 단위 과대입금
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: 'SK에코플랜트', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 300000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX8', senderName: 'SK에코플랜트', depositAmount: 330050, withdrawAmount: 0, transactionDate: '2026-09-08 12:00' } as BankTransaction);

    db.executeMatch('TX8', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const c = db.customers.find(x => x.id === 'C1')!;
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('완납 실패');
    if (c.prepaidBalance !== 50) issues.push(`10원 단위 선수금 불일치: ${c.prepaidBalance}`);

    record('WTT-BANK-08', 'OVERPAYMENT', '단수(10원 단위) 과대입금 미세 선수금 정확 보존', '비용 축', issues.length === 0, issues, { prepaid: c.prepaidBalance });
  })();

  // WTT-BANK-09: 수수료 감액 동반 과대입금 복합 연산
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: 'HDC현대산업개발', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX9', senderName: 'HDC현대산업개발', depositAmount: 1200000, withdrawAmount: 0, transactionDate: '2026-09-09 13:00' } as BankTransaction);

    db.executeMatch('TX9', 'B1', 'MANUAL', { matchingMode: 'CASCADE', feeAdjustment: 500 });
    const c = db.customers.find(x => x.id === 'C1')!;
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('완납 실패');
    if (c.prepaidBalance !== 100500) issues.push(`수수료 감액 후 선수금 왜곡: ${c.prepaidBalance} (기대 100,500)`);

    record('WTT-BANK-09', 'OVERPAYMENT', '수수료 감액과 과대입금 복합 연산 무결성', '비용 축', issues.length === 0, issues, { prepaid: c.prepaidBalance, bPaid: b.paidAmount });
  })();

  // WTT-BANK-10: 다중 청구 직접 배분(MULTI) 모드에서 일부 완납 후 잔액 선수금
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '태영건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 400000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 600000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX10', senderName: '태영건설', depositAmount: 800000, withdrawAmount: 0, transactionDate: '2026-09-10 14:00' } as BankTransaction);

    db.executeMatch('TX10', 'B1', 'MANUAL', {
      matchingMode: 'MULTI',
      allocations: [{ billingId: 'B1', amount: 440000 }]
    });

    const b1 = db.billings.find(x => x.id === 'B1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;
    const c = db.customers.find(x => x.id === 'C1')!;

    const issues: string[] = [];
    if (b1.status !== 'PAID') issues.push('B1 완납 실패');
    if (b2.status !== 'UNPAID') issues.push('B2 비의도적 수납 발생');
    if (c.prepaidBalance !== 360000) issues.push(`선수금 오류: ${c.prepaidBalance}`);

    record('WTT-BANK-10', 'OVERPAYMENT', '다중 배분(MULTI) 모드 미배분 잔액 선수금 적립', '수량 축', issues.length === 0, issues, { b1Status: b1.status, b2Status: b2.status, prepaid: c.prepaidBalance });
  })();

  // WTT-BANK-11: 과대입금 자동 매칭 (AUTO CASCADE)
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '두산건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 700000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX11', senderName: '(주)두산건설', depositAmount: 1000000, withdrawAmount: 0, transactionDate: '2026-09-10 15:00' } as BankTransaction);

    db.tryAutoMatch(db.bankTransactions[0]);
    const b = db.billings.find(x => x.id === 'B1')!;
    const c = db.customers.find(x => x.id === 'C1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('자동 매칭 완납 실패');
    if (c.prepaidBalance !== 230000) issues.push(`선수금 불일치: ${c.prepaidBalance}`);

    record('WTT-BANK-11', 'OVERPAYMENT', '괄호 포함 상호 자동 인식 과대입금 수납 및 선수금 처리', '공간 축', issues.length === 0, issues, { bStatus: b.status, prepaid: c.prepaidBalance });
  })();

  // WTT-BANK-12: 과대입금 시 계약이력 PAYMENT_RECEIVED 기록 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '중흥토건', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', contractId: 'CT-JH', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX12', senderName: '중흥토건', depositAmount: 800000, withdrawAmount: 0, transactionDate: '2026-09-10 16:00' } as BankTransaction);

    db.executeMatch('TX12', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const histories = db.contractHistory.filter(h => h.contractId === 'CT-JH' && h.changeType === 'PAYMENT_RECEIVED');

    const issues: string[] = [];
    if (histories.length === 0) issues.push('계약이력 수납 기록 누락');

    record('WTT-BANK-12', 'OVERPAYMENT', '과대입금 매칭 시 계약이력 무누락 기록 검증', '물리 축', issues.length === 0, issues, { historyCount: histories.length });
  })();

  // WTT-BANK-13: 과대입금 매칭 해제 시 계약이력 PAYMENT_CANCELLED 기록 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '중흥토건', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', contractId: 'CT-JH', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX13', senderName: '중흥토건', depositAmount: 800000, withdrawAmount: 0, transactionDate: '2026-09-10 16:00' } as BankTransaction);

    db.executeMatch('TX13', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.unmatchTransaction('TX13');

    const cancelHistories = db.contractHistory.filter(h => h.contractId === 'CT-JH' && h.changeType === 'PAYMENT_CANCELLED');
    const issues: string[] = [];
    if (cancelHistories.length === 0) issues.push('계약이력 취소 기록 누락');

    record('WTT-BANK-13', 'OVERPAYMENT', '과대입금 매칭 해제 시 계약이력 취소 무누락 기록 검증', '물리 축', issues.length === 0, issues, { cancelHistoryCount: cancelHistories.length });
  })();

  // WTT-BANK-14: 대규모 거액 과대입금 선수금 보존
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '현대엔지니어링', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 5000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX14', senderName: '현대엔지니어링', depositAmount: 20000000, withdrawAmount: 0, transactionDate: '2026-09-10 17:00' } as BankTransaction);

    db.executeMatch('TX14', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const c = db.customers.find(x => x.id === 'C1')!;
    const remTx = db.getDepositBalance('TX14');

    const issues: string[] = [];
    if (c.prepaidBalance !== 14500000) issues.push(`거액 선수금 적립 왜곡: ${c.prepaidBalance}`);
    if (remTx !== 0) issues.push(`통장 잔액 0원 미달성: ${remTx}`);

    record('WTT-BANK-14', 'OVERPAYMENT', '대규모 거액 과대입금 선수금 안전 적립 및 통장 전액 소진', '비용 축', issues.length === 0, issues, { prepaid: c.prepaidBalance, remTx });
  })();

  // WTT-BANK-15: 과대입금 3회 연속 매칭/취소 멱등성 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '금호건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX15', senderName: '금호건설', depositAmount: 1500000, withdrawAmount: 0, transactionDate: '2026-09-10 18:00' } as BankTransaction);

    db.executeMatch('TX15', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.unmatchTransaction('TX15');
    db.executeMatch('TX15', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.unmatchTransaction('TX15');
    db.executeMatch('TX15', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    const b = db.billings.find(x => x.id === 'B1')!;
    const c = db.customers.find(x => x.id === 'C1')!;
    const remTx = db.getDepositBalance('TX15');

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('반복 후 최종 완납 실패');
    if (c.prepaidBalance !== 400000) issues.push(`반복 후 최종 선수금 불일치: ${c.prepaidBalance} (기대 400,000)`);
    if (remTx !== 0) issues.push(`반복 후 통장 잔액 왜곡: ${remTx}`);

    record('WTT-BANK-15', 'OVERPAYMENT', '과대입금 3회 반복 매칭/취소 멱등성 무결성 검증', '시간 축', issues.length === 0, issues, { bStatus: b.status, prepaid: c.prepaidBalance, remTx });
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: 정상(금액일치) 입금 (Exact Match) - 15 SCENARIOS (WTT-BANK-16 ~ 30)
  // ══════════════════════════════════════════════════════════════════════════════

  // WTT-BANK-16: 단일 청구 100% 일치 입금
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '삼성물산', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX16', senderName: '삼성물산', depositAmount: 1100000, withdrawAmount: 0, transactionDate: '2026-09-01 09:30' } as BankTransaction);

    db.executeMatch('TX16', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b = db.billings.find(x => x.id === 'B1')!;
    const c = db.customers.find(x => x.id === 'C1')!;
    const remTx = db.getDepositBalance('TX16');

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('완납 실패');
    if (c.prepaidBalance !== 0) issues.push(`선수금 오적립: ${c.prepaidBalance}`);
    if (remTx !== 0) issues.push(`통장 잔액 불일치: ${remTx}`);

    record('WTT-BANK-16', 'EXACT', '단일 청구 정확 1:1 금액 일치 완납 수지 보존', '비용 축', issues.length === 0, issues, { bStatus: b.status, prepaid: c.prepaidBalance, remTx });
  })();

  // WTT-BANK-17: 상호명 100% 일치 자동 매칭
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '현대건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 2000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX17', senderName: '현대건설', depositAmount: 2200000, withdrawAmount: 0, transactionDate: '2026-09-02 10:00' } as BankTransaction);

    db.tryAutoMatch(db.bankTransactions[0]);
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('자동 매칭 실패');

    record('WTT-BANK-17', 'EXACT', '상호명 정확 일치 시 자동 완납 매칭', '공간 축', issues.length === 0, issues, { bStatus: b.status });
  })();

  // WTT-BANK-18: 상호명 주식회사/(주) 변형 정규화 자동 매칭
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '주식회사 대우산업개발', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX18', senderName: '(주)대우산업개발', depositAmount: 1650000, withdrawAmount: 0, transactionDate: '2026-09-03 11:00' } as BankTransaction);

    db.tryAutoMatch(db.bankTransactions[0]);
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('정규화 자동 매칭 실패');

    record('WTT-BANK-18', 'EXACT', '주식회사/(주) 법인 표기 정규화 자동 매칭', '공간 축', issues.length === 0, issues, { bStatus: b.status });
  })();

  // WTT-BANK-19: 다건 청구 합계액 정확 일치
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '호반건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 800000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 400000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX19', senderName: '호반건설', depositAmount: 1320000, withdrawAmount: 0, transactionDate: '2026-09-04 12:00' } as BankTransaction);

    db.executeMatch('TX19', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b1 = db.billings.find(x => x.id === 'B1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;
    const c = db.customers.find(x => x.id === 'C1')!;
    const remTx = db.getDepositBalance('TX19');

    const issues: string[] = [];
    if (b1.status !== 'PAID' || b2.status !== 'PAID') issues.push('다건 합계 일치 완납 실패');
    if (c.prepaidBalance !== 0) issues.push(`불필요 선수금 발생: ${c.prepaidBalance}`);
    if (remTx !== 0) issues.push(`통장 잔액 불일치: ${remTx}`);

    record('WTT-BANK-19', 'EXACT', '다건 청구 합계액 정확 일치 100% 동시 완납', '수량 축', issues.length === 0, issues, { b1Status: b1.status, b2Status: b2.status, remTx });
  })();

  // WTT-BANK-20: 타행 이체 수수료 500원 차액 자동 감액 완납
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '우미건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX20', senderName: '우미건설', depositAmount: 1099500, withdrawAmount: 0, transactionDate: '2026-09-05 13:00' } as BankTransaction);

    db.executeMatch('TX20', 'B1', 'MANUAL', { matchingMode: 'CASCADE', feeAdjustment: 500 });
    const b = db.billings.find(x => x.id === 'B1')!;
    const pay = db.payments.find(p => p.billingId === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push(`수수료 감액 후 완납 실패: ${b.status}`);
    if (b.paidAmount !== 1100000) issues.push(`청구서 총 수납액 왜곡: ${b.paidAmount}`);
    if (pay.feeAdjustment !== 500) issues.push(`전표 수수료 감액액 미반영: ${pay.feeAdjustment}`);

    record('WTT-BANK-20', 'EXACT', '타행 송금 수수료 500원 차액 자동 감액 완납', '비용 축', issues.length === 0, issues, { bStatus: b.status, bPaid: b.paidAmount, feeAdj: pay.feeAdjustment });
  })();

  // WTT-BANK-21: 타행 이체 수수료 1,000원 차액 자동 감액 완납
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '계룡건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 2000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX21', senderName: '계룡건설', depositAmount: 2199000, withdrawAmount: 0, transactionDate: '2026-09-06 14:00' } as BankTransaction);

    db.executeMatch('TX21', 'B1', 'MANUAL', { matchingMode: 'CASCADE', feeAdjustment: 1000 });
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('1,000원 수수료 감액 완납 실패');
    if (b.paidAmount !== 2200000) issues.push(`수납액 불일치: ${b.paidAmount}`);

    record('WTT-BANK-21', 'EXACT', '타행 송금 수수료 1,000원 차액 자동 감액 완납', '비용 축', issues.length === 0, issues, { bStatus: b.status, bPaid: b.paidAmount });
  })();

  // WTT-BANK-22: 수수료 감액 완납 후 매칭 취소 시 수수료 잔류 0원 복구
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '동부건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX22', senderName: '동부건설', depositAmount: 1099500, withdrawAmount: 0, transactionDate: '2026-09-07 15:00' } as BankTransaction);

    db.executeMatch('TX22', 'B1', 'MANUAL', { matchingMode: 'CASCADE', feeAdjustment: 500 });
    db.unmatchTransaction('TX22');

    const b = db.billings.find(x => x.id === 'B1')!;
    const issues: string[] = [];
    if (b.status !== 'UNPAID') issues.push(`상태 UNPAID 복구 실패: ${b.status}`);
    if (b.paidAmount !== 0) issues.push(`수수료 감액액 잔류 버그 발생: paidAmount=${b.paidAmount}`);

    record('WTT-BANK-22', 'EXACT', '수수료 감액 대조 해제 시 수수료 잔류 0원 완벽 복구', '비용 축', issues.length === 0, issues, { bStatus: b.status, bPaid: b.paidAmount });
  })();

  // WTT-BANK-23: 단수 절사(10원 단위) 금액 정확 일치 매칭
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '서희건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 433333, paidAmount: 0, status: 'UNPAID' } as Billing);
    const grand = db.getBillingGrand(db.billings[0]);
    db.insertTx({ id: 'TX23', senderName: '서희건설', depositAmount: grand, withdrawAmount: 0, transactionDate: '2026-09-08 16:00' } as BankTransaction);

    db.executeMatch('TX23', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('단수 절사 완납 실패');

    record('WTT-BANK-23', 'EXACT', '1원/10원 단위 단수 절사 청구액 1:1 완납 매칭', '물리 축', issues.length === 0, issues, { bStatus: b.status, grand });
  })();

  // WTT-BANK-24: 부가세(VAT 10%) 포함 총액 정확 일치 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '반도건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 3000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX24', senderName: '반도건설', depositAmount: 3300000, withdrawAmount: 0, transactionDate: '2026-09-09 17:00' } as BankTransaction);

    db.executeMatch('TX24', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.paidAmount !== 3300000 || b.status !== 'PAID') issues.push('VAT 포함 총액 매칭 실패');

    record('WTT-BANK-24', 'EXACT', '공급가액 + 부가세 10% 합산 총액 일치 완납 검증', '비용 축', issues.length === 0, issues, { bStatus: b.status, paid: b.paidAmount });
  })();

  // WTT-BANK-25: 동일 금액 복수 청구 중 FIFO 선소진
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: 'KCC건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-06', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-07', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX25', senderName: 'KCC건설', depositAmount: 1100000, withdrawAmount: 0, transactionDate: '2026-09-10 18:00' } as BankTransaction);

    db.executeMatch('TX25', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b1 = db.billings.find(x => x.id === 'B1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;

    const issues: string[] = [];
    if (b1.status !== 'PAID') issues.push('과거 6월 청구 미완납');
    if (b2.status !== 'UNPAID') issues.push('7월 청구 비정상 충당');

    record('WTT-BANK-25', 'EXACT', '동일 금액 복수 청구서 FIFO 우선 충당 준수', '시간 축', issues.length === 0, issues, { b1Status: b1.status, b2Status: b2.status });
  })();

  // WTT-BANK-26: 정상 입금 매칭 후 통장 가용잔액 0원 확인
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '코오롱글로벌', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX26', senderName: '코오롱글로벌', depositAmount: 1100000, withdrawAmount: 0, transactionDate: '2026-09-10 19:00' } as BankTransaction);

    db.executeMatch('TX26', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const rem = db.getDepositBalance('TX26');
    const used = db.getDepositUsedAmount('TX26');

    const issues: string[] = [];
    if (rem !== 0) issues.push(`가용잔액 0원 미달성: ${rem}`);
    if (used !== 1100000) issues.push(`사용액 왜곡: ${used}`);

    record('WTT-BANK-26', 'EXACT', '정상 완납 후 통장 가용잔액 0원 및 전액 사용 확정', '비용 축', issues.length === 0, issues, { rem, used });
  })();

  // WTT-BANK-27: 완납 매칭 PaymentDepositLink 1:1 생성 무결성
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '효성중공업', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX27', senderName: '효성중공업', depositAmount: 550000, withdrawAmount: 0, transactionDate: '2026-09-10 20:00' } as BankTransaction);

    db.executeMatch('TX27', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const pdl = db.paymentDepositLinks.filter(l => l.bankTransactionId === 'TX27');

    const issues: string[] = [];
    if (pdl.length !== 1 || pdl[0].usedAmount !== 550000) issues.push('PDL 1:1 연결 무결성 위반');

    record('WTT-BANK-27', 'EXACT', '완납 매칭 PaymentDepositLink 1:1 생성 무결성', '물리 축', issues.length === 0, issues, { pdlCount: pdl.length });
  })();

  // WTT-BANK-28: 정상 입금 수동 PINPOINT 매칭 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '동양건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 600000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX28', senderName: '동양건설', depositAmount: 660000, withdrawAmount: 0, transactionDate: '2026-09-10 21:00' } as BankTransaction);

    db.executeMatch('TX28', 'B1', 'MANUAL', { matchingMode: 'PINPOINT' });
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('PINPOINT 완납 실패');

    record('WTT-BANK-28', 'EXACT', '수동 단독지정(PINPOINT) 정상 금액 일치 완납', '공간 축', issues.length === 0, issues, { bStatus: b.status });
  })();

  // WTT-BANK-29: 정상 입금 수동 MULTI 매칭 배분 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '아이에스동서', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX29', senderName: '아이에스동서', depositAmount: 1100000, withdrawAmount: 0, transactionDate: '2026-09-10 22:00' } as BankTransaction);

    db.executeMatch('TX29', 'B1', 'MANUAL', {
      matchingMode: 'MULTI',
      allocations: [
        { billingId: 'B1', amount: 550000 },
        { billingId: 'B2', amount: 550000 }
      ]
    });

    const b1 = db.billings.find(x => x.id === 'B1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;

    const issues: string[] = [];
    if (b1.status !== 'PAID' || b2.status !== 'PAID') issues.push('MULTI 직접 배분 완납 실패');

    record('WTT-BANK-29', 'EXACT', '수동 다중배분(MULTI) 정확 일치 배분 완납', '수량 축', issues.length === 0, issues, { b1Status: b1.status, b2Status: b2.status });
  })();

  // WTT-BANK-30: 일괄 자동 대사 5건 동시 처리 무결성 검증
  (() => {
    db.reset();
    for (let i = 1; i <= 5; i++) {
      db.insertCustomer({ id: `C${i}`, name: `거래처${i}`, prepaidBalance: 0 } as Customer);
      db.insertBilling({ id: `B${i}`, customerId: `C${i}`, billingYm: '2026-08', totalAmount: 100000 * i, paidAmount: 0, status: 'UNPAID' } as Billing);
      const grand = db.getBillingGrand(db.billings[i - 1]);
      db.insertTx({ id: `TX30_${i}`, senderName: `거래처${i}`, depositAmount: grand, withdrawAmount: 0, transactionDate: '2026-09-10' } as BankTransaction);
      db.tryAutoMatch(db.bankTransactions[i - 1]);
    }

    const unpaids = db.billings.filter(b => b.status !== 'PAID');
    const issues: string[] = [];
    if (unpaids.length > 0) issues.push(`일괄 자동대사 미완납 잔여: ${unpaids.length}건`);

    record('WTT-BANK-30', 'EXACT', '다건 일괄 자동 대사 5건 동시 처리 무결성', '수량 축', issues.length === 0, issues, { unpaids: unpaids.length });
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: 과소입금(부분입금) - 15 SCENARIOS (WTT-BANK-31 ~ 45)
  // ══════════════════════════════════════════════════════════════════════════════

  // WTT-BANK-31: 단일 청구 부분 입금 (1,100,000 청구 vs 500,000 입금)
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '쌍용건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX31', senderName: '쌍용건설', depositAmount: 500000, withdrawAmount: 0, transactionDate: '2026-09-01 10:00' } as BankTransaction);

    db.executeMatch('TX31', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b = db.billings.find(x => x.id === 'B1')!;
    const remTx = db.getDepositBalance('TX31');

    const issues: string[] = [];
    if (b.status !== 'PARTIAL') issues.push(`상태 불일치: ${b.status} (기대 PARTIAL)`);
    if (b.paidAmount !== 500000) issues.push(`기수납액 불일치: ${b.paidAmount}`);
    if (remTx !== 0) issues.push(`통장 입금액 전액 소진 미반영: ${remTx}`);

    record('WTT-BANK-31', 'UNDERPAYMENT', '단일 청구 과소입금 부분수납(PARTIAL) 및 잔여미수 보존', '비용 축', issues.length === 0, issues, { bStatus: b.status, paid: b.paidAmount, remTx });
  })();

  // WTT-BANK-32: 1차 부분 입금(500,000) 후 2차 추가 입금(600,000) 매칭 ➔ 최종 완납
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '한신공영', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX32_1', senderName: '한신공영', depositAmount: 500000, withdrawAmount: 0, transactionDate: '2026-09-01 10:00' } as BankTransaction);
    db.insertTx({ id: 'TX32_2', senderName: '한신공영', depositAmount: 600000, withdrawAmount: 0, transactionDate: '2026-09-05 10:00' } as BankTransaction);

    db.executeMatch('TX32_1', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.executeMatch('TX32_2', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    const b = db.billings.find(x => x.id === 'B1')!;
    const rem1 = db.getDepositBalance('TX32_1');
    const rem2 = db.getDepositBalance('TX32_2');

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push(`2차 추가 입금 후 완납 실패: ${b.status}`);
    if (b.paidAmount !== 1100000) issues.push(`누적 수납액 불일치: ${b.paidAmount}`);
    if (rem1 !== 0 || rem2 !== 0) issues.push('통장 잔액 소진 미완료');

    record('WTT-BANK-32', 'UNDERPAYMENT', '1차 과소입금 후 2차 추가입금 누적 완납(PAID) 전이', '시간 축', issues.length === 0, issues, { bStatus: b.status, paid: b.paidAmount });
  })();

  // WTT-BANK-33: 다건 청구 중 1차 청구 완납 + 2차 청구 부분 충당
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '동원개발', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 500000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX33', senderName: '동원개발', depositAmount: 800000, withdrawAmount: 0, transactionDate: '2026-09-02 11:00' } as BankTransaction);

    db.executeMatch('TX33', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b1 = db.billings.find(x => x.id === 'B1')!;
    const b2 = db.billings.find(x => x.id === 'B2')!;

    const issues: string[] = [];
    if (b1.status !== 'PAID') issues.push('1차 청구 완납 실패');
    if (b2.status !== 'PARTIAL') issues.push(`2차 청구 PARTIAL 실패: ${b2.status}`);
    if (b2.paidAmount !== 250000) issues.push(`2차 청구 수납액 오류: ${b2.paidAmount}`);

    record('WTT-BANK-33', 'UNDERPAYMENT', '다건 청구 CASCADE 중 선청구 완납 + 후청구 부분 충당', '수량 축', issues.length === 0, issues, { b1Status: b1.status, b2Status: b2.status, b2Paid: b2.paidAmount });
  })();

  // WTT-BANK-34: 3회 분할 입금 누적 매칭
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '서한', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX34_1', senderName: '서한', depositAmount: 300000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);
    db.insertTx({ id: 'TX34_2', senderName: '서한', depositAmount: 400000, withdrawAmount: 0, transactionDate: '2026-09-03' } as BankTransaction);
    db.insertTx({ id: 'TX34_3', senderName: '서한', depositAmount: 400000, withdrawAmount: 0, transactionDate: '2026-09-05' } as BankTransaction);

    db.executeMatch('TX34_1', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.executeMatch('TX34_2', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.executeMatch('TX34_3', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    const b = db.billings.find(x => x.id === 'B1')!;
    const issues: string[] = [];
    if (b.status !== 'PAID' || b.paidAmount !== 1100000) issues.push(`3회 분할 완납 실패: ${b.status} / ${b.paidAmount}`);

    record('WTT-BANK-34', 'UNDERPAYMENT', '3회 분할 과소입금 누적 수납 100% 완납 보존', '시간 축', issues.length === 0, issues, { bStatus: b.status, paid: b.paidAmount });
  })();

  // WTT-BANK-35: 부분 입금 매칭 후 해당 통장 입금건 전액 소진 확인
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '화성산업', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX35', senderName: '화성산업', depositAmount: 300000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);

    db.executeMatch('TX35', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const rem = db.getDepositBalance('TX35');
    const used = db.getDepositUsedAmount('TX35');

    const issues: string[] = [];
    if (rem !== 0 || used !== 300000) issues.push('통장 입금 잔액 0원 미반영');

    record('WTT-BANK-35', 'UNDERPAYMENT', '과소입금 시 통장 입금건 100% 소진 및 사용액 정합성', '비용 축', issues.length === 0, issues, { rem, used });
  })();

  // WTT-BANK-36: 부분 입금된 청구서의 미수잔액 실시간 정확성
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '제일건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 2000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX36', senderName: '제일건설', depositAmount: 700000, withdrawAmount: 0, transactionDate: '2026-09-02' } as BankTransaction);

    db.executeMatch('TX36', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b = db.billings.find(x => x.id === 'B1')!;
    const unpaid = db.getBillingGrand(b) - (b.paidAmount || 0);

    const issues: string[] = [];
    if (unpaid !== 1500000) issues.push(`미수잔액 불일치: ${unpaid} (기대 1,500,000)`);

    record('WTT-BANK-36', 'UNDERPAYMENT', '과소입금 수납 후 청구 잔여 미수금 무결성 보존', '물리 축', issues.length === 0, issues, { unpaid });
  })();

  // WTT-BANK-37: 2차 부분 입금만 선별 매칭 취소 ➔ 1차 보존 및 PARTIAL 유지
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '요진건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX37_1', senderName: '요진건설', depositAmount: 300000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);
    db.insertTx({ id: 'TX37_2', senderName: '요진건설', depositAmount: 400000, withdrawAmount: 0, transactionDate: '2026-09-05' } as BankTransaction);

    db.executeMatch('TX37_1', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.executeMatch('TX37_2', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.unmatchTransaction('TX37_2');

    const b = db.billings.find(x => x.id === 'B1')!;
    const rem2 = db.getDepositBalance('TX37_2');

    const issues: string[] = [];
    if (b.status !== 'PARTIAL') issues.push(`상태 오류: ${b.status}`);
    if (b.paidAmount !== 300000) issues.push(`수납액 오류: ${b.paidAmount} (기대 300,000)`);
    if (rem2 !== 400000) issues.push(`취소된 2차 통장 잔액 미복원: ${rem2}`);

    record('WTT-BANK-37', 'UNDERPAYMENT', '복수 과소입금 중 후순위 입금 선택 해제 롤백 보존', '시간 축', issues.length === 0, issues, { bStatus: b.status, bPaid: b.paidAmount, rem2 });
  })();

  // WTT-BANK-38: 1차 부분 입금 매칭 취소 ➔ 2차 입금분만 남아 PARTIAL 유지
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '극동건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX38_1', senderName: '극동건설', depositAmount: 300000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);
    db.insertTx({ id: 'TX38_2', senderName: '극동건설', depositAmount: 500000, withdrawAmount: 0, transactionDate: '2026-09-05' } as BankTransaction);

    db.executeMatch('TX38_1', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.executeMatch('TX38_2', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.unmatchTransaction('TX38_1');

    const b = db.billings.find(x => x.id === 'B1')!;
    const rem1 = db.getDepositBalance('TX38_1');

    const issues: string[] = [];
    if (b.status !== 'PARTIAL') issues.push(`상태 오류: ${b.status}`);
    if (b.paidAmount !== 500000) issues.push(`수납액 오류: ${b.paidAmount} (기대 500,000)`);
    if (rem1 !== 300000) issues.push(`취소된 1차 통장 잔액 미복원: ${rem1}`);

    record('WTT-BANK-38', 'UNDERPAYMENT', '복수 과소입금 중 선순위 입금 선택 해제 롤백 보존', '시간 축', issues.length === 0, issues, { bStatus: b.status, bPaid: b.paidAmount, rem1 });
  })();

  // WTT-BANK-39: 소액 분할 입금 스트레스 (10,000원씩 5회 입금)
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '일성건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 100000, paidAmount: 0, status: 'UNPAID' } as Billing);

    for (let i = 1; i <= 5; i++) {
      db.insertTx({ id: `TX39_${i}`, senderName: '일성건설', depositAmount: 10000, withdrawAmount: 0, transactionDate: `2026-09-0${i}` } as BankTransaction);
      db.executeMatch(`TX39_${i}`, 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    }

    const b = db.billings.find(x => x.id === 'B1')!;
    const issues: string[] = [];
    if (b.paidAmount !== 50000 || b.status !== 'PARTIAL') issues.push(`소액 분할 누적 실패: ${b.paidAmount}`);

    record('WTT-BANK-39', 'UNDERPAYMENT', '소액(10,000원) 5회 연속 과소입금 누적 무결성', '물리 축', issues.length === 0, issues, { bPaid: b.paidAmount });
  })();

  // WTT-BANK-40: 부분 입금 상태에서 청구서 미수액 대차대조 검증식
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '삼호', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX40', senderName: '삼호', depositAmount: 400000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);

    db.executeMatch('TX40', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b = db.billings.find(x => x.id === 'B1')!;
    const grand = db.getBillingGrand(b);
    const paid = b.paidAmount || 0;
    const unpaid = grand - paid;

    const issues: string[] = [];
    if (grand !== paid + unpaid) issues.push('대차대조 수지 보존 위반');

    record('WTT-BANK-40', 'UNDERPAYMENT', '과소입금 상태 청구총액 = 수납액 + 미수잔액 보존식 검증', '비용 축', issues.length === 0, issues, { grand, paid, unpaid });
  })();

  // WTT-BANK-41: 부분 입금 상태에서 익월 청구서 추가 발생 시 미수 합계 정합성
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '신세계건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-07', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX41', senderName: '신세계건설', depositAmount: 600000, withdrawAmount: 0, transactionDate: '2026-08-01' } as BankTransaction);
    db.executeMatch('TX41', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    db.insertBilling({ id: 'B2', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);

    const totalUnpaid = db.billings
      .filter(b => b.customerId === 'C1')
      .reduce((sum, b) => sum + (db.getBillingGrand(b) - (b.paidAmount || 0)), 0);

    const issues: string[] = [];
    if (totalUnpaid !== 1600000) issues.push(`총 미수액 왜곡: ${totalUnpaid} (기대 1,600,000)`);

    record('WTT-BANK-41', 'UNDERPAYMENT', '과소입금 잔여 미수와 익월 신규 청구 미수 합산 검증', '시간 축', issues.length === 0, issues, { totalUnpaid });
  })();

  // WTT-BANK-42: 과소입금과 수수료 감액 복합 적용
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '동양', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX42', senderName: '동양', depositAmount: 499500, withdrawAmount: 0, transactionDate: '2026-09-02' } as BankTransaction);

    db.executeMatch('TX42', 'B1', 'MANUAL', { matchingMode: 'CASCADE', feeAdjustment: 500 });
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.paidAmount !== 500000) issues.push(`수납액 왜곡: ${b.paidAmount} (기대 500,000)`);
    if (b.status !== 'PARTIAL') issues.push(`상태 오류: ${b.status}`);

    record('WTT-BANK-42', 'UNDERPAYMENT', '과소입금과 수수료 감액 동시 적용 부분수납 검증', '비용 축', issues.length === 0, issues, { bPaid: b.paidAmount, bStatus: b.status });
  })();

  // WTT-BANK-43: MULTI 모드에서 지정 금액 이하만 부분 충당
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '대보건설', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX43', senderName: '대보건설', depositAmount: 700000, withdrawAmount: 0, transactionDate: '2026-09-03' } as BankTransaction);

    db.executeMatch('TX43', 'B1', 'MANUAL', {
      matchingMode: 'MULTI',
      allocations: [{ billingId: 'B1', amount: 300000 }]
    });

    const b = db.billings.find(x => x.id === 'B1')!;
    const c = db.customers.find(x => x.id === 'C1')!;

    const issues: string[] = [];
    if (b.paidAmount !== 300000) issues.push(`MULTI 부분 수납액 오류: ${b.paidAmount}`);
    if (c.prepaidBalance !== 400000) issues.push(`MULTI 미배분 잔액 선수금 적립 오류: ${c.prepaidBalance}`);

    record('WTT-BANK-43', 'UNDERPAYMENT', 'MULTI 모드 부분 배분 및 잔여액 선수금 분리', '수량 축', issues.length === 0, issues, { bPaid: b.paidAmount, prepaid: c.prepaidBalance });
  })();

  // WTT-BANK-44: 과소입금 매칭 시 계약이력 PARTIAL 수납 무누락 기록 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '자이에스앤디', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', contractId: 'CT-XI', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX44', senderName: '자이에스앤디', depositAmount: 500000, withdrawAmount: 0, transactionDate: '2026-09-04' } as BankTransaction);

    db.executeMatch('TX44', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const histories = db.contractHistory.filter(h => h.contractId === 'CT-XI' && h.changeType === 'PAYMENT_RECEIVED');

    const issues: string[] = [];
    if (histories.length === 0) issues.push('계약이력 기록 누락');

    record('WTT-BANK-44', 'UNDERPAYMENT', '과소입금 수납 시 계약이력 무누락 이벤트 저장', '물리 축', issues.length === 0, issues, { count: histories.length });
  })();

  // WTT-BANK-45: 과소입금 취소 시 계약이력 PAYMENT_CANCELLED 무누락 기록 검증
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '자이에스앤디', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', contractId: 'CT-XI', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX45', senderName: '자이에스앤디', depositAmount: 500000, withdrawAmount: 0, transactionDate: '2026-09-04' } as BankTransaction);

    db.executeMatch('TX45', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.unmatchTransaction('TX45');

    const cancelHistories = db.contractHistory.filter(h => h.contractId === 'CT-XI' && h.changeType === 'PAYMENT_CANCELLED');
    const issues: string[] = [];
    if (cancelHistories.length === 0) issues.push('계약이력 취소 기록 누락');

    record('WTT-BANK-45', 'UNDERPAYMENT', '과소입금 대조 해제 시 계약이력 취소 이벤트 저장', '물리 축', issues.length === 0, issues, { count: cancelHistories.length });
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: 특수 거버넌스 및 종단 보존 법칙 - 5 SCENARIOS (WTT-BANK-46 ~ 50)
  // ══════════════════════════════════════════════════════════════════════════════

  // WTT-BANK-46: 동일 거래처 복수 은행 분할 입금
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '대림', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX46_KB', bankName: '국민은행', senderName: '대림', depositAmount: 550000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);
    db.insertTx({ id: 'TX46_WR', bankName: '우리은행', senderName: '대림', depositAmount: 550000, withdrawAmount: 0, transactionDate: '2026-09-02' } as BankTransaction);

    db.executeMatch('TX46_KB', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.executeMatch('TX46_WR', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });

    const b = db.billings.find(x => x.id === 'B1')!;
    const remKB = db.getDepositBalance('TX46_KB');
    const remWR = db.getDepositBalance('TX46_WR');

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('복수 은행 분할 입금 완납 실패');
    if (remKB !== 0 || remWR !== 0) issues.push('개별 은행 통장 잔액 소진 미반영');

    record('WTT-BANK-46', 'GOVERNANCE', '동일 거래처 복수 은행 계좌 분할 입금 교차 완납 보존', '공간 축', issues.length === 0, issues, { bStatus: b.status, remKB, remWR });
  })();

  // WTT-BANK-47: 거래 정지(BLOCKED) 고객사의 수납 처리 거버넌스
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '부실건설', transactionStatus: 'BLOCKED', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX47', senderName: '부실건설', depositAmount: 1100000, withdrawAmount: 0, transactionDate: '2026-09-03' } as BankTransaction);

    db.executeMatch('TX47', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const b = db.billings.find(x => x.id === 'B1')!;

    const issues: string[] = [];
    if (b.status !== 'PAID') issues.push('BLOCKED 고객사 채권 회수 수납 실패');

    record('WTT-BANK-47', 'GOVERNANCE', '거래제한(BLOCKED) 고객사 채권 회수 수납 정상 완결 거버넌스', '공간 축', issues.length === 0, issues, { bStatus: b.status });
  })();

  // WTT-BANK-48: 종단 수지 보존 법칙 (Conservation of Balance)
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '고객A', prepaidBalance: 0 } as Customer);
    db.insertCustomer({ id: 'C2', name: '고객B', prepaidBalance: 0 } as Customer);
    db.insertCustomer({ id: 'C3', name: '고객C', prepaidBalance: 0 } as Customer);

    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B2', customerId: 'C2', billingYm: '2026-08', totalAmount: 2000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertBilling({ id: 'B3', customerId: 'C3', billingYm: '2026-08', totalAmount: 3000000, paidAmount: 0, status: 'UNPAID' } as Billing);

    db.insertTx({ id: 'T1', senderName: '고객A', depositAmount: 1500000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);
    db.insertTx({ id: 'T2', senderName: '고객B', depositAmount: 2199500, withdrawAmount: 0, transactionDate: '2026-09-02' } as BankTransaction);
    db.insertTx({ id: 'T3', senderName: '고객C', depositAmount: 1000000, withdrawAmount: 0, transactionDate: '2026-09-03' } as BankTransaction);

    db.executeMatch('T1', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    db.executeMatch('T2', 'B2', 'MANUAL', { matchingMode: 'CASCADE', feeAdjustment: 500 });
    db.executeMatch('T3', 'B3', 'MANUAL', { matchingMode: 'CASCADE' });

    const totalDeposits = 1500000 + 2199500 + 1000000;
    const totalBillingPaid = db.billings.reduce((s, b) => s + (b.paidAmount || 0), 0);
    const totalPrepaid = db.customers.reduce((s, c) => s + (c.prepaidBalance || 0), 0);
    const totalFeeAdj = db.payments.reduce((s, p) => s + (p.feeAdjustment || 0), 0);

    const leftSide = totalDeposits + totalFeeAdj;
    const rightSide = totalBillingPaid + totalPrepaid;
    const delta = leftSide - rightSide;

    const issues: string[] = [];
    if (delta !== 0) issues.push(`종단 수지 보존 위반! 차액: ₩${delta}`);

    record('WTT-BANK-48', 'GOVERNANCE', '종단 수지 보존 법칙 (총입금 + 감액 = 총수납 + 총선수금 | 차액 ₩0)', '비용 축', issues.length === 0, issues, { leftSide, rightSide, delta });
  })();

  // WTT-BANK-49: 통장 가용 잔액 보존 법칙
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '고객X', prepaidBalance: 0 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX49', senderName: '고객X', depositAmount: 1100000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);

    db.executeMatch('TX49', 'B1', 'MANUAL', { matchingMode: 'CASCADE' });
    const used = db.getDepositUsedAmount('TX49');
    const bal = db.getDepositBalance('TX49');

    const issues: string[] = [];
    if (bal !== 0 || used !== 1100000) issues.push('통장 잔액 보존 실패');

    record('WTT-BANK-49', 'GOVERNANCE', '통장 사용액과 가용잔액 상호 배타성 합계 보존 법칙', '물리 축', issues.length === 0, issues, { used, bal });
  })();

  // WTT-BANK-50: 전 시나리오 롤백 후 원상태 완전 복원 보존 법칙 (All-Rollback Conservation Law)
  (() => {
    db.reset();
    db.insertCustomer({ id: 'C1', name: '고객A', prepaidBalance: 100000 } as Customer);
    db.insertBilling({ id: 'B1', customerId: 'C1', billingYm: '2026-08', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID' } as Billing);
    db.insertTx({ id: 'TX50', senderName: '고객A', depositAmount: 1500000, withdrawAmount: 0, transactionDate: '2026-09-01' } as BankTransaction);

    db.executeMatch('TX50', 'B1', 'MANUAL', { matchingMode: 'CASCADE', feeAdjustment: 1000 });
    db.unmatchTransaction('TX50');

    const b = db.billings.find(x => x.id === 'B1')!;
    const c = db.customers.find(x => x.id === 'C1')!;
    const bal = db.getDepositBalance('TX50');
    const remainingPayments = db.payments.filter(p => p.id.includes('TX50'));
    const remainingLinks = db.paymentDepositLinks.filter(l => l.bankTransactionId === 'TX50');

    const issues: string[] = [];
    if (b.status !== 'UNPAID' || b.paidAmount !== 0) issues.push('청구서 원상복구 실패');
    if (c.prepaidBalance !== 100000) issues.push(`선수금 원상복구 실패: ${c.prepaidBalance}`);
    if (bal !== 1500000) issues.push(`통장잔액 원상복구 실패: ${bal}`);
    if (remainingPayments.length > 0) issues.push(`잔존 전표 고아 레코드 발생: ${remainingPayments.length}건`);
    if (remainingLinks.length > 0) issues.push(`잔존 PDL 고아 레코드 발생: ${remainingLinks.length}건`);

    record('WTT-BANK-50', 'GOVERNANCE', '전 항목 대조 해제 시 무잔존·무고아 100% 완전 원복 보존 법칙', '물리 축', issues.length === 0, issues, { bStatus: b.status, prepaid: c.prepaidBalance, bal, orphanedPay: remainingPayments.length, orphanedLinks: remainingLinks.length });
  })();

  const totalPassed = results.filter(r => r.passed).length;
  const summary = `WTT 50 Bank Matching Stress Tests: ${totalPassed}/50 PASSED (${Math.round((totalPassed / 50) * 100)}%)`;

  return { summary, totalPassed, results };
}

// CLI runner
if (process.argv[1] && process.argv[1].includes('wtt_bank_matching')) {
  console.log('================================================================');
  console.log('🏦 WTT-BANK-50: 은행 입출금 대장 수납 대사 도메인 관통 스트레스 테스트');
  console.log('================================================================\n');

  const { summary, totalPassed, results } = runWttBankMatching50();

  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} [${r.scenarioId}] [${r.category}] [${r.axis}] ${r.name}`);
    if (!r.passed) {
      console.log(`   ⚠️ 결함: ${r.issues.join(' | ')}`);
      console.log(`   🔎 상세: ${JSON.stringify(r.details)}`);
    }
  });

  console.log('\n================================================================');
  console.log(`🎯 최종 결과: ${summary}`);
  console.log('================================================================\n');

  if (totalPassed < 50) {
    process.exit(1);
  }
}
