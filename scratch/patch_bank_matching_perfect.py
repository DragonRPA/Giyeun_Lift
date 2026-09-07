import os, re
files_dir = r"d:\01.AntiGravity\Giyuen_Lift\src\pages"

def r(fname, old, new):
    path = os.path.join(files_dir, fname)
    if not os.path.exists(path): return
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

r("BankMatching.tsx",
  """      const excelData = filteredTransactions.map((t, idx) => {
        const infoParts = [];
        if (t.matchedBillingId) {
          if (t.matchedCustomerName) infoParts.push(t.matchedCustomerName);
          if (t.matchedSiteName) infoParts.push(t.matchedSiteName);
        }
        const remBal = getDepositBalance(t.id);
        const isFull = t.depositAmount > 0 && remBal <= 0;
        const isPartial = t.depositAmount > 0 && remBal > 0 && remBal < t.depositAmount;

        return {
          'No': idx + 1,
          '수납/지출상태': isFull ? '수납완료' : isPartial ? '부분수납' : t.matchedBillingId ? '지급완료' : '미확인',
          '은행명': t.bankName || '미확인',
          '거래일시': t.transactionDate,
          '적요': t.summary || '-',
          '기재내용': t.counterparty || t.senderName || '-',
          '입금액/수납결과': t.depositAmount > 0 ? `입금 ${t.depositAmount.toLocaleString()}원(잔여 ${remBal.toLocaleString()}원)` : '-',
          '출금액/정산결과': t.withdrawAmount > 0 ? `출금 ${t.withdrawAmount.toLocaleString()}원` : '-',
          '거래후잔액': t.balance ? `${t.balance.toLocaleString()}원` : '-',
          '취급점': t.branchName || '-',
          '매칭 정보': infoParts.length > 0 ? infoParts.join(', ') : '-',
          '메모': t.memo || '-'
        };
      });""",
  """      const excelData = filteredTransactions.map((t, idx) => {
        const infoParts = [];
        if (t.matchedBillingId) {
          if ((t as any).matchedCustomerName) infoParts.push((t as any).matchedCustomerName);
          if ((t as any).matchedSiteName) infoParts.push((t as any).matchedSiteName);
        }
        const remBal = getDepositBalance(t.id);
        const usedDeposit = getDepositUsedAmount(t.id);
        const matchedWithdrawAmt = getWithdrawMatchedAmount(t.id);
        const isFull = t.depositAmount > 0 && remBal <= 0;
        const isPartial = t.depositAmount > 0 && remBal > 0 && usedDeposit > 0;
        const matchedSettlement = purchaseSettlements.find(s => s.bankTransactionId === t.id);
        const isMatchedWithdraw = !!matchedSettlement || matchedWithdrawAmt > 0;

        return {
          'No': idx + 1,
          '수납/지출상태': isFull ? '수납완료' : isPartial ? '부분수납' : isMatchedWithdraw ? '지급완료' : '미확인',
          '결제수단': t.bankName || '미확인',
          '거래일시': t.transactionDate,
          '적요': t.summary || '-',
          '기재내용': t.counterparty || t.senderName || '-',
          '입금액': t.depositAmount || 0,
          '출금액': t.withdrawAmount || 0,
          '잔액': t.balance || 0,
          '상태': t.depositAmount > 0 ? (isFull ? '수납완료' : isPartial ? `잔여 ${remBal.toLocaleString()}` : '-') : (t.withdrawAmount > 0 ? (isMatchedWithdraw ? `정산완료 (${matchedWithdrawAmt.toLocaleString()})` : '-') : '-'),
          '매칭 정보': infoParts.length > 0 ? infoParts.join(', ') : '-',
          '메모': t.memo || '-'
        };
      });""")
print("BankMatching patched")
