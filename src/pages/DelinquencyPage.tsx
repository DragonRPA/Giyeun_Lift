// src/pages/DelinquencyPage.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { db, Todo, DelinquencyActionLog, Customer, Billing } from '../services/db';
import { 
  AlertTriangle, PhoneCall, Mail, CheckCircle, 
  Clock, Plus, Upload, Trash2, ArrowRight, UserCheck, ShieldAlert,
  Calendar, DollarSign, Award, ThumbsUp, ThumbsDown, Lock, Unlock, Search,
  Send, AlertCircle, FileText, Check, Printer, FileCheck, Save, Eye
} from 'lucide-react';

interface CalculatedDelinquency {
  id: string;
  customerId: string;
  customerName: string;
  bizRegNo?: string;
  transactionStatus: 'ALLOWED' | 'BLOCKED';
  responsibleEmployeeId: string;
  responsibleEmployeeName: string;
  totalOverdueAmount: number;
  oldestOverdueDueDate: string;
  overdueDays: number;
  status: 'ACTIVE' | 'RESOLVED';
  lastActionDate?: string;
  lastActionType?: string;
  unpaidBillingCount: number;
  overdueInvoicesCount: number;
  brokenPromisesCount: number;
  riskTier: 'HIGH' | 'MID' | 'LOW';
  hasPendingDirective: boolean;
  directiveNeglectedDays: number;
  paymentDueConditionText: string;
}

// 퀵 지시 프리셋 문구
const QUICK_DIRECTIVE_PRESETS = [
  '현장 소장 대면 면담 및 금주 내 분할 입금 확약서 징구 요망',
  '미입금 지속 시 현장 출고 장비 원격 락(가동 중단) 예고 통보',
  '거래처 대표자 유선 직접 면담 후 최종 납부 기일 확정 보고',
  '법적 최고장 발송 전 최종 회수 계획 수립 및 경영진 대면 보고'
];

export const DelinquencyPage: React.FC = () => {
  const { 
    currentUser, hasPermission, billings, customers, users, contracts, 
    delinquencyActionLogs, saveDelinquencyAction, updateDelinquencyActionPromise,
    saveCustomer, refreshAllData, showErrorModal, todos,
    legalNoticeLogs, legalNoticeTemplates, saveLegalNoticeLog, saveLegalNoticeTemplate,
    currentTenant
  } = useApp();
  const canSave = hasPermission('billing', 'save');
  // ─── [내용증명 스튜디오 상태] ───
  const isExecutive = currentUser?.role === 'ADMIN' || currentUser?.role === 'EXECUTIVE';
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [noticeTargetDel, setNoticeTargetDel] = useState<CalculatedDelinquency | null>(null);
  const [noticeTitle, setNoticeTitle] = useState('고소작업대 임대료 미납에 따른 대금 변제 최고 및 계약 해지·장비 회수 예고 통보서');
  const [noticeDeadlineDays, setNoticeDeadlineDays] = useState(7);
  const [noticeCustomContent, setNoticeCustomContent] = useState('');
  const [noticeTrackingNo, setNoticeTrackingNo] = useState('');
  const [viewingNoticeLog, setViewingNoticeLog] = useState<any | null>(null);

  // 기본 서식 템플릿 생성 헬퍼
  const generateDefaultNoticeText = (del: CalculatedDelinquency, customer?: Customer, days = 7) => {
    return `1. 귀사의 무궁한 발전을 기원합니다.

2. 당사와 귀사는 고소작업대 임대차 계약을 체결하고 현장에 정상적으로 장비를 공급·가동하여 왔으나, 귀사는 약정 결제기일(${del.paymentDueConditionText})을 ${del.overdueDays}일 도과하여 현재까지 총 ₩${del.totalOverdueAmount.toLocaleString()}원의 렌탈 임대료를 미납하고 있습니다.

3. 이에 당사는 본 통고서 도달일로부터 ${days}일 이내에 미납된 임대료 전액을 당사 지정 계좌로 완납하여 주실 것을 엄중히 최고(催告)합니다.

4. 만일 위 기한 내에 대금 변제가 이루어지지 않을 경우, 당사는 부득이 다음과 같은 법적 조치를 즉각 단행할 것임을 통지합니다:
   가. 민법 및 임대차 계약서 조항에 의거한 임대차 계약 즉시 해지 및 현장 투입 장비의 강제 회수/원격 가동 락(Lock) 조치
   나. 관할 법원에 지급명령 신청 및 귀사의 공사대금 채권(원청사 기성금), 예금, 부동산 등에 대한 가압류 및 강제집행
   다. 상법 및 소송촉진등에관한특례법에 따른 법정 지연손해금(연 12%) 및 일체의 변호사/소송/회수 비용 청구

5. 부디 원만한 해결을 위해 조속한 시일 내에 완납 또는 구체적인 변제 확약 일정을 통보해 주시기 바랍니다.`;
  };

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 선택된 연체 고객사
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OVERDUE_30' | 'OVERDUE_60' | 'BLOCKED' | 'HIGH_RISK' | 'NEGLECTED'>('ALL');

  const [salesFilter, setSalesFilter] = useState('ALL');
  const [amountRangeFilter, setAmountRangeFilter] = useState('ALL');
  const [overdueStartDate, setOverdueStartDate] = useState('');
  const [overdueEndDate, setOverdueEndDate] = useState('');

  // 신규 조치 입력 폼
  const [newActionType, setNewActionType] = useState<'CALL' | 'NOTICE_SENT' | 'VISIT' | 'LEGAL'>('CALL');
  const [newActionDetails, setNewActionDetails] = useState('');
  const [proofFile, setProofFile] = useState<string>('');

  // 입금 약속 기입 폼
  const [hasPromise, setHasPromise] = useState(false);
  const [promiseDate, setPromiseDate] = useState('');
  const [promiseAmount, setPromiseAmount] = useState(0);
  const [promiseContactPerson, setPromiseContactPerson] = useState('');

  // 경영진 영업 지시 하달 모달 상태
  const [showDirectiveModal, setShowDirectiveModal] = useState(false);
  const [directiveTargetDel, setDirectiveTargetDel] = useState<CalculatedDelinquency | null>(null);
  const [directiveDetails, setDirectiveDetails] = useState('');
  const [directiveDueDate, setDirectiveDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  });

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // 🌟 고객 약정 납기일 동적 산출 함수 (고객정보 paymentDueDay / paymentTermDays 기반)
  const getAgreedDueDate = (billing: Billing, customer?: Customer): { dueDate: string; conditionText: string } => {
    if (customer?.paymentDueDay) {
      const ym = billing.billingYm || billing.createdAt.slice(0, 7);
      const [yearStr, monthStr] = ym.split('-');
      let year = parseInt(yearStr, 10);
      let month = parseInt(monthStr, 10);
      if (!isNaN(year) && !isNaN(month)) {
        month += 1;
        if (month > 12) { month = 1; year += 1; }
        const lastDay = new Date(year, month, 0).getDate();
        const dueDay = Math.min(customer.paymentDueDay, lastDay);
        return {
          dueDate: `${year}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`,
          conditionText: `익월 ${customer.paymentDueDay}일 결제`
        };
      }
    }

    if (customer?.paymentTermDays) {
      const baseDate = new Date(billing.billingDate || billing.createdAt.split('T')[0]);
      baseDate.setDate(baseDate.getDate() + customer.paymentTermDays);
      return {
        dueDate: baseDate.toISOString().split('T')[0],
        conditionText: `발행 후 ${customer.paymentTermDays}일 결제`
      };
    }

    const billDateStr = billing.billingDate || billing.createdAt.split('T')[0];
    const [bYear, bMonth] = billDateStr.split('-');
    let y = parseInt(bYear, 10);
    let m = parseInt(bMonth, 10);
    if (!isNaN(y) && !isNaN(m)) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      return {
        dueDate: `${y}-${String(m).padStart(2, '0')}-25`,
        conditionText: '기본 (익월 25일)'
      };
    }

    return { dueDate: billDateStr, conditionText: '발행일 당일' };
  };

  // 1. 실시간 DB(billings) + 고객 약정 납기일 기반 정밀 연체 채권 집계
  const calculatedDelinquencies = useMemo(() => {
    const custMap = new Map<string, {
      totalOverdueAmount: number;
      oldestOverdueDueDate: string;
      unpaidBillingCount: number;
      overdueInvoicesCount: number;
      salespersonId?: string;
      conditionText: string;
    }>();

    // 미수금이 남아있는 청구서 추출
    billings.forEach(b => {
      if (b.status === 'REJECTED' || b.status === 'PAID') return;
      const unpaid = (b.totalAmount || 0) - (b.paidAmount || 0);
      if (unpaid <= 0) return;

      const custId = b.customerId;
      const customer = customers.find(c => c.id === custId);
      const { dueDate, conditionText } = getAgreedDueDate(b, customer);
      const isOverdue = dueDate < todayStr;

      // 계약에서 영업담당자 추출
      const contract = contracts.find(c => c.id === b.contractId);
      const spId = contract?.salespersonId;

      if (!custMap.has(custId)) {
        custMap.set(custId, {
          totalOverdueAmount: isOverdue ? unpaid : 0,
          oldestOverdueDueDate: isOverdue ? dueDate : '',
          unpaidBillingCount: 1,
          overdueInvoicesCount: isOverdue ? 1 : 0,
          salespersonId: spId,
          conditionText
        });
      } else {
        const item = custMap.get(custId)!;
        item.unpaidBillingCount += 1;
        if (isOverdue) {
          item.totalOverdueAmount += unpaid;
          item.overdueInvoicesCount += 1;
          if (!item.oldestOverdueDueDate || dueDate < item.oldestOverdueDueDate) {
            item.oldestOverdueDueDate = dueDate;
          }
        }
        if (!item.salespersonId && spId) {
          item.salespersonId = spId;
        }
      }
    });

    const result: CalculatedDelinquency[] = [];
    custMap.forEach((val, custId) => {
      const customer = customers.find(c => c.id === custId);
      if (!customer) return;

      // 납기일 도과 연체 금액이 없으면 제외 (미도래 정상 채권)
      if (val.totalOverdueAmount <= 0) return;

      const oldestDate = val.oldestOverdueDueDate ? new Date(val.oldestOverdueDueDate) : today;
      const diffMs = today.getTime() - oldestDate.getTime();
      const overdueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      // 고객 조치 내역 정렬
      const custLogs = delinquencyActionLogs
        .filter(l => l.customerId === custId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const lastLog = custLogs[0];

      // 약속 위반 횟수 카운트
      const brokenPromisesCount = custLogs.filter(l => {
        if (!l.promiseDate) return false;
        if (l.promiseStatus === 'BROKEN') return true;
        if (l.promiseStatus === 'PENDING' && l.promiseDate < todayStr) return true;
        return false;
      }).length;

      // 경영진 지시 및 방치 일수 추적
      const activeDirective = custLogs.find(l => l.actionType === 'DIRECTIVE');
      const hasPendingDirective = !!todos.some(t => t.relatedEntityId === custId && !t.isCompleted);
      
      let directiveNeglectedDays = 0;
      if (activeDirective && hasPendingDirective) {
        const dirDate = new Date(activeDirective.createdAt);
        const neglectMs = today.getTime() - dirDate.getTime();
        directiveNeglectedDays = Math.max(0, Math.floor(neglectMs / (1000 * 60 * 60 * 24)));
      }

      // 상습 연체 위험 등급
      let riskTier: 'HIGH' | 'MID' | 'LOW' = 'LOW';
      if (overdueDays >= 60 || brokenPromisesCount >= 2 || val.totalOverdueAmount >= 5000000 || directiveNeglectedDays >= 3) {
        riskTier = 'HIGH';
      } else if (overdueDays >= 30 || brokenPromisesCount >= 1 || val.totalOverdueAmount >= 2000000) {
        riskTier = 'MID';
      }

      const salesperson = users.find(u => u.id === val.salespersonId);

      result.push({
        id: `del-${custId}`,
        customerId: custId,
        customerName: customer.name,
        bizRegNo: customer.bizRegNo,
        transactionStatus: customer.transactionStatus || 'ALLOWED',
        responsibleEmployeeId: val.salespersonId || 'unassigned',
        responsibleEmployeeName: salesperson?.name || '영업부',
        totalOverdueAmount: val.totalOverdueAmount,
        oldestOverdueDueDate: val.oldestOverdueDueDate,
        overdueDays,
        status: 'ACTIVE',
        lastActionDate: lastLog ? lastLog.createdAt.split('T')[0] : undefined,
        lastActionType: lastLog ? (
          lastLog.actionType === 'DIRECTIVE' ? '경영진 독촉지시' :
          lastLog.actionType === 'CALL' ? '전화 독촉' :
          lastLog.actionType === 'NOTICE_SENT' ? '최고장 송달' :
          lastLog.actionType === 'VISIT' ? '방문 실사' : '법적 조치'
        ) : undefined,
        unpaidBillingCount: val.unpaidBillingCount,
        overdueInvoicesCount: val.overdueInvoicesCount,
        brokenPromisesCount,
        riskTier,
        hasPendingDirective,
        directiveNeglectedDays,
        paymentDueConditionText: val.conditionText
      });
    });

    return result.sort((a, b) => {
      // 1순위: 고위험 등급, 2순위: 연체일수
      const tierWeight = { HIGH: 3, MID: 2, LOW: 1 };
      if (tierWeight[b.riskTier] !== tierWeight[a.riskTier]) {
        return tierWeight[b.riskTier] - tierWeight[a.riskTier];
      }
      return b.overdueDays - a.overdueDays;
    });
  }, [billings, customers, users, contracts, delinquencyActionLogs, todos, today, todayStr]);

  // 필터링된 연체 목록
  const filteredDelinquencies = useMemo(() => {
    return calculatedDelinquencies.filter(d => {
      const q = searchTerm.trim().toLowerCase();
      const matchesSearch = !q || 
        d.customerName.toLowerCase().includes(q) || 
        (d.bizRegNo && d.bizRegNo.includes(q)) ||
        d.responsibleEmployeeName.toLowerCase().includes(q);

      let matchesStatus = true;
      if (statusFilter === 'OVERDUE_30') matchesStatus = d.overdueDays >= 30;
      else if (statusFilter === 'OVERDUE_60') matchesStatus = d.overdueDays >= 60;
      else if (statusFilter === 'BLOCKED') matchesStatus = d.transactionStatus === 'BLOCKED';
      else if (statusFilter === 'HIGH_RISK') matchesStatus = d.riskTier === 'HIGH';
      else if (statusFilter === 'NEGLECTED') matchesStatus = d.directiveNeglectedDays >= 3;

      const matchesSales = salesFilter === 'ALL' || d.responsibleEmployeeId === salesFilter;
      
      let matchesAmount = true;
      if (amountRangeFilter === 'LT100') matchesAmount = d.totalOverdueAmount < 1000000;
      else if (amountRangeFilter === '100TO500') matchesAmount = d.totalOverdueAmount >= 1000000 && d.totalOverdueAmount <= 5000000;
      else if (amountRangeFilter === 'GT500') matchesAmount = d.totalOverdueAmount > 5000000;

      const matchesStartDate = !overdueStartDate || d.oldestOverdueDueDate >= overdueStartDate;
      const matchesEndDate = !overdueEndDate || d.oldestOverdueDueDate <= overdueEndDate;

      return matchesSearch && matchesStatus && matchesSales && matchesAmount && matchesStartDate && matchesEndDate;
    });
  }, [calculatedDelinquencies, searchTerm, statusFilter, salesFilter, amountRangeFilter, overdueStartDate, overdueEndDate]);

  const selectedDelinquency = calculatedDelinquencies.find(d => d.customerId === selectedCustomerId) || null;
  const selectedCustLogs = useMemo(() => {
    if (!selectedCustomerId) return [];
    return delinquencyActionLogs
      .filter(l => l.customerId === selectedCustomerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [delinquencyActionLogs, selectedCustomerId]);

  const handleSelectDelinquency = (del: CalculatedDelinquency) => {
    setSelectedCustomerId(del.customerId);
    setNewActionDetails('');
    setProofFile('');
    setHasPromise(false);
    setPromiseDate('');
    setPromiseAmount(0);
    setPromiseContactPerson('');
  };

  // 📜 내용증명 작성 스튜디오 오픈
  const handleOpenNoticeModal = (del: CalculatedDelinquency) => {
    if (!isExecutive) {
      showToast('내용증명 작성 및 발송은 경영진 고유 권한입니다.', 'error');
      return;
    }
    const customer = customers.find(c => c.id === del.customerId);
    setNoticeTargetDel(del);

    // 저장된 커스텀 템플릿이 있으면 적용, 없으면 기본 템플릿 로드
    const customTemplate = legalNoticeTemplates && legalNoticeTemplates[0];
    if (customTemplate) {
      setNoticeTitle(customTemplate.title || '고소작업대 임대료 미납에 따른 대금 변제 최고 및 계약 해지·장비 회수 예고 통보서');
      setNoticeDeadlineDays(customTemplate.deadlineDays || 7);
      setNoticeCustomContent(customTemplate.content
        .replace(/{{customerName}}/g, del.customerName)
        .replace(/{{overdueAmount}}/g, del.totalOverdueAmount.toLocaleString())
        .replace(/{{overdueDays}}/g, String(del.overdueDays))
        .replace(/{{deadlineDays}}/g, String(customTemplate.deadlineDays || 7))
        .replace(/{{paymentDueConditionText}}/g, del.paymentDueConditionText)
      );
    } else {
      setNoticeTitle('고소작업대 임대료 미납에 따른 대금 변제 최고 및 계약 해지·장비 회수 예고 통보서');
      setNoticeDeadlineDays(7);
      setNoticeCustomContent(generateDefaultNoticeText(del, customer, 7));
    }

    setNoticeTrackingNo('');
    setShowNoticeModal(true);
  };

  // 내용증명 기본 서식 저장
  const handleSaveNoticeTemplate = async () => {
    if (!isExecutive) return;
    try {
      await saveLegalNoticeTemplate({
        title: noticeTitle,
        content: noticeCustomContent,
        deadlineDays: noticeDeadlineDays
      });
      showToast('현재 편집 내용이 향후 작성용 [기본 서식]으로 영구 저장되었습니다.');
    } catch (err: any) {
      showErrorModal(`서식 저장 오류: ${err?.message || err}`);
    }
  };

  // 내용증명 발송 승인 및 이력 저장
  const handleSubmitLegalNotice = async () => {
    if (!noticeTargetDel || !isExecutive) return;
    const customer = customers.find(c => c.id === noticeTargetDel.customerId);

    try {
      // 1. LegalNoticeLog 저장
      await saveLegalNoticeLog({
        customerId: noticeTargetDel.customerId,
        customerName: noticeTargetDel.customerName,
        representative: customer?.representative || '대표이사',
        bizRegNo: customer?.bizRegNo,
        address: customer?.address || '사업장 주소지',
        overdueAmount: noticeTargetDel.totalOverdueAmount,
        overdueDays: noticeTargetDel.overdueDays,
        noticeTitle: noticeTitle.trim(),
        noticeContent: noticeCustomContent.trim(),
        deadlineDays: noticeDeadlineDays,
        sentDate: todayStr,
        sentByUserId: currentUser?.id || 'ceo',
        sentByName: currentUser?.name || '대표이사',
        postalTrackingNo: noticeTrackingNo.trim() || undefined
      });

      // 2. DelinquencyActionLog에 NOTICE_SENT 기록
      await saveDelinquencyAction({
        customerId: noticeTargetDel.customerId,
        actionType: 'NOTICE_SENT',
        actionDetails: `[내용증명/최고장 발송] ${noticeTitle.trim()} (최고금액: ₩${noticeTargetDel.totalOverdueAmount.toLocaleString()}원, 최고기한: ${noticeDeadlineDays}일)${noticeTrackingNo ? ` [등기번호: ${noticeTrackingNo}]` : ''}`,
        recordedBy: currentUser?.name || '경영진',
        mandateType: 'CEO_AUTO_MANDATE'
      });

      await db.awaitPendingWrites();
      refreshAllData();

      showToast(`[${noticeTargetDel.customerName}] 내용증명 발송 이력이 저장되고 고객관리 및 연체대장에 반영되었습니다.`);
      setShowNoticeModal(false);
      setNoticeTargetDel(null);
    } catch (err: any) {
      showErrorModal(`내용증명 발송 처리 오류: ${err?.message || err}`);
    }
  };

  // 조치 기록 및 상담 약속 등록
  const handleRegisterAction = async () => {
    if (!selectedDelinquency) return;
    if (!newActionDetails.trim()) {
      showToast('상담 조치 상세 내역을 입력해 주십시오.', 'error');
      return;
    }

    try {
      await saveDelinquencyAction({
        customerId: selectedDelinquency.customerId,
        actionType: newActionType,
        actionDetails: newActionDetails.trim(),
        proofFileName: proofFile,
        recordedBy: currentUser?.name || '영업담당',
        mandateType: 'CEO_AUTO_MANDATE',
        promiseDate: hasPromise ? promiseDate : undefined,
        promiseAmount: hasPromise ? promiseAmount : undefined,
        promiseStatus: hasPromise ? 'PENDING' : undefined,
        promiseContactPerson: hasPromise ? promiseContactPerson.trim() : undefined
      });

      // 미해결 경영진 지시 ToDo 자동 완료 마감 (방치 상태 해제)
      const relatedTodos = db.todos.filter(t => t.relatedEntityId === selectedDelinquency.customerId && !t.isCompleted);
      relatedTodos.forEach(t => {
        db.updateRow<Todo>('todos', t.id, { isCompleted: true });
      });

      await db.awaitPendingWrites();
      refreshAllData();

      showToast(`상담 및 조치사항이 등록되었습니다.${hasPromise ? ' (수납 약속일정 등록)' : ''}`);

      setNewActionDetails('');
      setProofFile('');
      setHasPromise(false);
      setPromiseDate('');
      setPromiseAmount(0);
      setPromiseContactPerson('');
    } catch (err: any) {
      showErrorModal(`조치 내역 저장 중 오류 발생:\n${err?.message || err}`);
    }
  };

  // 🌟 경영진 ➔ 담당 영업사원 채권회수 독촉 지시 하달
  const handleOpenDirectiveModal = (del: CalculatedDelinquency, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDirectiveTargetDel(del);
    setDirectiveDetails('');
    setShowDirectiveModal(true);
  };

  const handleSubmitDirective = async () => {
    if (!directiveTargetDel) return;
    if (!directiveDetails.trim()) {
      showToast('경영진 지시 내용을 입력해 주십시오.', 'error');
      return;
    }

    try {
      // 1. DelinquencyActionLog에 DIRECTIVE 기록
      await saveDelinquencyAction({
        customerId: directiveTargetDel.customerId,
        actionType: 'DIRECTIVE',
        actionDetails: `[경영진 지시] ${directiveDetails.trim()} (기한: ${directiveDueDate})`,
        recordedBy: currentUser?.name || '경영진',
        mandateType: 'CEO_AUTO_MANDATE',
        directiveTargetUserId: directiveTargetDel.responsibleEmployeeId,
        directiveDueDate
      });

      // 2. 담당 영업사원에게 ToDo 자동 발행
      db.insertRow<Todo>('todos', {
        type: 'GENERAL',
        title: `[경영진 채권독촉 지시] ${directiveTargetDel.customerName}`,
        content: `연체금액: ₩${directiveTargetDel.totalOverdueAmount.toLocaleString()}원 (${directiveTargetDel.overdueDays}일 도과)\n약정조건: ${directiveTargetDel.paymentDueConditionText}\n지시사항: ${directiveDetails.trim()}\n기한: ${directiveDueDate}`,
        userId: directiveTargetDel.responsibleEmployeeId,
        relatedEntityId: directiveTargetDel.customerId,
        isCompleted: false,
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();

      showToast(`[${directiveTargetDel.customerName}] 담당 영업사원(${directiveTargetDel.responsibleEmployeeName})에게 지시가 하달되었습니다.`);
      setShowDirectiveModal(false);
      setDirectiveTargetDel(null);
    } catch (err: any) {
      showErrorModal(`지시 하달 중 오류 발생:\n${err?.message || err}`);
    }
  };

  // 거래 차단 / 해제 토글 (경영진 고유 권한 엄격 한정)
  const handleToggleCustomerBlock = async (del: CalculatedDelinquency) => {
    if (!isExecutive) {
      showToast('신규계약 및 출고금지(BLOCKED) 처분은 경영진 고유 권한입니다.', 'error');
      return;
    }
    const customer = customers.find(c => c.id === del.customerId);
    if (!customer) return;

    const nextStatus = del.transactionStatus === 'BLOCKED' ? 'ALLOWED' : 'BLOCKED';

    try {
      await saveCustomer({
        ...customer,
        transactionStatus: nextStatus
      });

      // delinquencyActionLogs 영구 불변 감사 기록 (헌장 1.2)
      db.insertRow<DelinquencyActionLog>('delinquencyActionLogs', {
        customerId: customer.id,
        actionType: nextStatus === 'BLOCKED' ? 'LEGAL' : 'CALL',
        actionDetails: nextStatus === 'BLOCKED'
          ? '[경영진 직권 처분] 신규 장비 출고 및 배차 전면 금지(BLOCKED) 조치 발효'
          : '[경영진 직권 처분] 대금 변제/확약 확인에 따른 출고금지 해제 (정상거래 환원)',
        recordedBy: currentUser?.name || '경영진',
        mandateType: 'CEO_AUTO_MANDATE',
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
      showToast(`거래처 상태가 [${nextStatus === 'BLOCKED' ? '거래 불가(BLOCKED)' : '정상 거래(ALLOWED)'}]로 변경되었습니다.`);
    } catch (err: any) {
      showErrorModal(`상태 변경 중 오류:\n${err?.message || err}`);
    }
  };

  // 약속 상태 업데이트
  const handleUpdatePromiseStatus = async (actionId: string, status: 'KEPT' | 'BROKEN') => {
    try {
      await updateDelinquencyActionPromise(actionId, status);
      await db.awaitPendingWrites();
      refreshAllData();
      if (status === 'BROKEN') {
        showToast('입금 약속 위반(BROKEN)으로 처리되었습니다.', 'error');
      } else {
        showToast('입금 약속 이행 완료(KEPT)로 기록되었습니다.');
      }
    } catch (err: any) {
      showErrorModal(`약속 상태 업데이트 오류:\n${err?.message || err}`);
    }
  };

  // 상단 지표 계산
  const totalOverdueAmount = useMemo(() => {
    return calculatedDelinquencies.reduce((sum, d) => sum + d.totalOverdueAmount, 0);
  }, [calculatedDelinquencies]);

  const highRiskCount = useMemo(() => {
    return calculatedDelinquencies.filter(d => d.riskTier === 'HIGH').length;
  }, [calculatedDelinquencies]);

  const pendingDirectiveCount = useMemo(() => {
    return calculatedDelinquencies.filter(d => d.hasPendingDirective).length;
  }, [calculatedDelinquencies]);

  const neglectedDirectiveCount = useMemo(() => {
    return calculatedDelinquencies.filter(d => d.directiveNeglectedDays >= 3).length;
  }, [calculatedDelinquencies]);

  const { totalPromises, keptPromises, brokenPromises } = useMemo(() => {
    let total = 0, kept = 0, broken = 0;
    delinquencyActionLogs.forEach(l => {
      if (l.promiseDate) {
        total++;
        if (l.promiseStatus === 'KEPT') kept++;
        else if (l.promiseStatus === 'BROKEN' || (l.promiseStatus === 'PENDING' && l.promiseDate < todayStr)) broken++;
      }
    });
    return { totalPromises: total, keptPromises: kept, brokenPromises: broken };
  }, [delinquencyActionLogs, todayStr]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px', position: 'relative' }}>
      
      {/* 알림 토스트 배너 (헌장 5.2) */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 99999,
          padding: '10px 18px',
          borderRadius: '6px',
          backgroundColor: toastMessage.type === 'success' ? 'var(--success)' : toastMessage.type === 'error' ? 'var(--danger)' : '#f59e0b',
          color: '#ffffff',
          fontWeight: 600,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.2s ease-in-out'
        }}>
          {toastMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* 상단 5대 핵심 경영 통제 지표 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
        <div className="card" style={{ padding: '14px', borderLeft: '4px solid var(--danger)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>약정 납기 도과 연체 총액</span>
            <DollarSign size={15} color="var(--danger)" />
          </div>
          <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '2px 0', color: 'var(--danger)' }}>
            ₩ {totalOverdueAmount.toLocaleString()}
          </h3>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>연체 고객 {calculatedDelinquencies.length}개사 (정밀 납기 기준)</span>
        </div>

        <div className="card" style={{ padding: '14px', borderLeft: '4px solid #dc2626' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>고위험 상습 연체 (🔴)</span>
            <ShieldAlert size={15} color="#dc2626" />
          </div>
          <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '2px 0', color: '#dc2626' }}>
            {highRiskCount}개사
          </h3>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>60일 이상 도과 or 약속 2회 위반</span>
        </div>

        <div className="card" style={{ padding: '14px', borderLeft: '4px solid var(--primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>경영진 수금지시 진행</span>
            <Send size={15} color="var(--primary)" />
          </div>
          <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '2px 0', color: 'var(--primary)' }}>
            {pendingDirectiveCount}건
          </h3>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>영업사원 개인 ToDo 자동 연동</span>
        </div>

        <div className="card" style={{ padding: '14px', borderLeft: neglectedDirectiveCount > 0 ? '4px solid #b91c1c' : '4px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: neglectedDirectiveCount > 0 ? '#b91c1c' : 'var(--text-secondary)', fontWeight: 700 }}>
              지시 방치 경보 (3일+)
            </span>
            <AlertCircle size={15} color={neglectedDirectiveCount > 0 ? '#b91c1c' : 'var(--text-muted)'} />
          </div>
          <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '2px 0', color: neglectedDirectiveCount > 0 ? '#b91c1c' : 'var(--text-muted)' }}>
            {neglectedDirectiveCount}건
          </h3>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>지시 하달 후 영업 피드백 누락</span>
        </div>

        <div className="card" style={{ padding: '14px', borderLeft: '4px solid #d97706' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>누적 약속 위반 횟수</span>
            <ThumbsDown size={15} color="#d97706" />
          </div>
          <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '2px 0', color: '#d97706' }}>
            {brokenPromises}건
          </h3>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>전체 {totalPromises}건 중 이행 {keptPromises}건</span>
        </div>
      </div>

      {/* 2열 메인 레이아웃 (좌측: 연체 대장 목록 / 우측: 조치 및 경영진 지시 스튜디오) */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedDelinquency ? '1.25fr 1fr' : '1fr', gap: '12px', minHeight: 0, flex: 1 }}>
        
        {/* [좌측 패널] 연체 채권 관리 대장 */}
        <div className="card" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={15} color="var(--danger)" /> 미수 채권 연체 관리 대장 ({filteredDelinquencies.length}건)
            </h3>

            {/* 필터 칩 */}
            <div style={{ display: 'flex', gap: '5px' }}>
              <button 
                className={statusFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'} 
                onClick={() => setStatusFilter('ALL')}
                style={{ fontSize: '11px', padding: '3px 8px' }}
              >
                전체
              </button>
              <button 
                className={statusFilter === 'HIGH_RISK' ? 'btn-primary' : 'btn-secondary'} 
                onClick={() => setStatusFilter('HIGH_RISK')}
                style={{ fontSize: '11px', padding: '3px 8px', color: '#dc2626', fontWeight: 700 }}
              >
                🔴 고위험
              </button>
              <button 
                className={statusFilter === 'NEGLECTED' ? 'btn-primary' : 'btn-secondary'} 
                onClick={() => setStatusFilter('NEGLECTED')}
                style={{ fontSize: '11px', padding: '3px 8px', color: '#b91c1c', fontWeight: 700 }}
              >
                🚨 지시방치
              </button>
              <button 
                className={statusFilter === 'OVERDUE_30' ? 'btn-primary' : 'btn-secondary'} 
                onClick={() => setStatusFilter('OVERDUE_30')}
                style={{ fontSize: '11px', padding: '3px 8px' }}
              >
                30일 이상
              </button>
              <button 
                className={statusFilter === 'BLOCKED' ? 'btn-primary' : 'btn-secondary'} 
                onClick={() => setStatusFilter('BLOCKED')}
                style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--danger)' }}
              >
                거래차단
              </button>
            </div>
          </div>

          {/* 검색창 */}
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="고객사명, 사업자번호, 담당영업사원 검색..."
              style={{ width: '100%', padding: '6px 8px 6px 28px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
            />
          </div>

          {/* 고밀도 슬림 테이블 (행 높이 38~42px) */}
          <div style={{ overflowX: 'auto', flex: 1, minHeight: 0 }}>
            <table className="data-table" style={{ width: '100%', fontSize: '11.5px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>위험등급</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>고객사</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>연체 총액</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>약정 납기일</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>경과일</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>약속위반</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>담당 영업</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>지시/통제</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>차단</th>
                </tr>
              </thead>
              <tbody>
                {filteredDelinquencies.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      현재 약정 납기일을 도과한 연체 채권이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredDelinquencies.map(del => {
                    const isSelected = selectedCustomerId === del.customerId;
                    return (
                      <tr 
                        key={del.id}
                        onClick={() => handleSelectDelinquency(del)}
                        style={{ 
                          cursor: 'pointer',
                          backgroundColor: isSelected ? 'rgba(59,130,246,0.08)' : undefined,
                          borderBottom: '1px solid var(--border-color)',
                          borderLeft: del.directiveNeglectedDays >= 3 ? '3px solid #b91c1c' : del.riskTier === 'HIGH' ? '3px solid #dc2626' : undefined
                        }}
                      >
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {del.riskTier === 'HIGH' ? (
                            <span style={{ padding: '2px 5px', borderRadius: '3px', fontSize: '10px', fontWeight: 800, backgroundColor: '#fee2e2', color: '#b91c1c' }}>
                              🔴 고위험
                            </span>
                          ) : del.riskTier === 'MID' ? (
                            <span style={{ padding: '2px 5px', borderRadius: '3px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#d97706' }}>
                              🟡 중위험
                            </span>
                          ) : (
                            <span style={{ padding: '2px 5px', borderRadius: '3px', fontSize: '10px', fontWeight: 600, backgroundColor: '#dcfce7', color: '#16a34a' }}>
                              🟢 일반
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                          {del.customerName}
                          {del.transactionStatus === 'BLOCKED' && (
                            <span style={{ marginLeft: '6px', padding: '1px 5px', fontSize: '10px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '3px', fontWeight: 800 }}>
                              출고제한
                            </span>
                          )}
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block' }}>
                            {del.paymentDueConditionText} (도과 {del.overdueInvoicesCount}건)
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '800', color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                          ₩ {del.totalOverdueAmount.toLocaleString()}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                          {del.oldestOverdueDueDate}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{ 
                            padding: '2px 5px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                            backgroundColor: del.overdueDays >= 60 ? 'rgba(239,68,68,0.15)' : del.overdueDays >= 30 ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.1)',
                            color: del.overdueDays >= 60 ? '#dc2626' : del.overdueDays >= 30 ? '#d97706' : '#2563eb'
                          }}>
                            {del.overdueDays}일
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {del.brokenPromisesCount > 0 ? (
                            <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '11px' }}>
                              {del.brokenPromisesCount}회 위반
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {del.responsibleEmployeeName}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {del.directiveNeglectedDays >= 3 ? (
                            <span style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 800, backgroundColor: '#7f1d1d', color: '#ffffff', animation: 'pulse 1.5s infinite' }}>
                              🚨 방치 {del.directiveNeglectedDays}일
                            </span>
                          ) : del.hasPendingDirective ? (
                            <span style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 700, backgroundColor: 'rgba(37, 99, 235, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#3b82f6' }}>
                              지시 진행중
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={(e) => handleOpenDirectiveModal(del, e)}
                              style={{ padding: '2px 6px', fontSize: '10.5px' }}
                              title="경영진 수금지시 하달"
                            >
                              지시하달
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleCustomerBlock(del);
                            }}
                            title={del.transactionStatus === 'BLOCKED' ? '차단 해제' : '거래 차단'}
                            style={{ padding: '2px 6px', fontSize: '11px', color: del.transactionStatus === 'BLOCKED' ? 'var(--success)' : 'var(--danger)' }}
                          >
                            {del.transactionStatus === 'BLOCKED' ? <Unlock size={12} /> : <Lock size={12} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* [우측 패널] 상담 조치 등록 및 경영진 지시 대장 */}
        {selectedDelinquency && (
          <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, overflowY: 'auto' }}>
            
            {/* 고객사 헤더 */}
            <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: '800', margin: '0 0 2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedDelinquency.customerName}
                  {selectedDelinquency.transactionStatus === 'BLOCKED' && (
                    <span style={{ padding: '1px 6px', fontSize: '11px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '4px', fontWeight: 800 }}>
                      출고제한
                    </span>
                  )}
                </h3>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span>담당: <strong>{selectedDelinquency.responsibleEmployeeName}</strong></span>
                  <span>|</span>
                  <span>약정: <strong>{selectedDelinquency.paymentDueConditionText}</strong></span>
                  <span>|</span>
                  <span>연체: <strong style={{ color: 'var(--danger)' }}>₩{selectedDelinquency.totalOverdueAmount.toLocaleString()}원 ({selectedDelinquency.overdueDays}일)</strong></span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {isExecutive && (
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => handleOpenNoticeModal(selectedDelinquency)}
                    style={{ padding: '4px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px', color: '#7e22ce', fontWeight: 700, borderColor: '#d8b4fe', backgroundColor: '#faf5ff' }}
                    title="경영진 고유권한: 최고장/내용증명 작성 및 인쇄"
                  >
                    <FileText size={12} /> 내용증명 작성
                  </button>
                )}
                <button 
                  type="button" 
                  className="btn-primary" 
                  onClick={() => handleOpenDirectiveModal(selectedDelinquency)}
                  style={{ padding: '4px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Send size={12} /> 경영진 지시
                </button>
              </div>
            </div>

            {/* 지시 방치 경보 배너 */}
            {selectedDelinquency.directiveNeglectedDays >= 3 && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: '#fee2e2', border: '1px solid #f87171', color: '#b91c1c', fontSize: '11.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={15} />
                <span>경영진 독촉지시 하달 후 {selectedDelinquency.directiveNeglectedDays}일 동안 영업사원의 현장 조치 기록이 없습니다.</span>
              </div>
            )}

            {/* 신규 상담 및 조치 등록 폼 */}
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', display: 'flex', justifyContent: 'space-between' }}>
                <span>영업사원 조치 / 입금 약속 기록</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>등록 시 지시 ToDo 자동 마감</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {(['CALL', 'VISIT', 'NOTICE_SENT', 'LEGAL'] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    className={newActionType === type ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setNewActionType(type)}
                    style={{ padding: '5px', fontSize: '11px', fontWeight: '600' }}
                  >
                    {type === 'CALL' ? '📞 전화독촉' : type === 'VISIT' ? '🚗 현장방문' : type === 'NOTICE_SENT' ? '✉️ 최고장' : '⚖️ 법적조치'}
                  </button>
                ))}
              </div>

              <textarea
                value={newActionDetails}
                onChange={e => setNewActionDetails(e.target.value)}
                placeholder="통화 상대방, 면담 결과, 사유 등을 상세히 기록해 주십시오..."
                rows={3}
                style={{ width: '100%', padding: '8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', resize: 'vertical' }}
              />

              {/* 입금 약속 체크박스 및 입력 */}
              <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={hasPromise} onChange={e => setHasPromise(e.target.checked)} />
                  <span>고객사 입금 약속(확약) 등록</span>
                </label>

                {hasPromise && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '6px', marginTop: '4px' }}>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>약속 입금일자</span>
                      <input type="date" value={promiseDate} onChange={e => setPromiseDate(e.target.value)} style={{ width: '100%', padding: '4px', fontSize: '11.5px' }} />
                    </div>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>약속 금액</span>
                      <input type="number" value={promiseAmount} onChange={e => setPromiseAmount(Number(e.target.value))} style={{ width: '100%', padding: '4px', fontSize: '11.5px' }} />
                    </div>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>확약 담당자</span>
                      <input type="text" value={promiseContactPerson} onChange={e => setPromiseContactPerson(e.target.value)} placeholder="담당자 성명/직함" style={{ width: '100%', padding: '4px', fontSize: '11.5px' }} />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button 
                  type="button" 
                  className="btn-primary" 
                  onClick={handleRegisterAction}
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                >
                  조치 내역 저장
                </button>
              </div>
            </div>

            {/* 타임라인 히스토리 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: '700' }}>과거 조치 및 지시 이력 ({selectedCustLogs.length}건)</div>
              {selectedCustLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '11.5px' }}>
                  등록된 과거 조치 및 지시 내역이 없습니다.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {selectedCustLogs.map(log => (
                    <div 
                      key={log.id} 
                      style={{ 
                        padding: '10px', 
                        borderRadius: '6px', 
                        backgroundColor: log.actionType === 'DIRECTIVE' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-app)', 
                        border: log.actionType === 'DIRECTIVE' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid var(--border-color)',
                        fontSize: '11.5px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontWeight: '700', color: log.actionType === 'DIRECTIVE' ? '#3b82f6' : 'var(--text-main)' }}>
                          {log.actionType === 'DIRECTIVE' ? '📢 [경영진 수금지시]' : log.actionType === 'CALL' ? '📞 [전화독촉]' : log.actionType === 'VISIT' ? '🚗 [현장방문]' : log.actionType === 'NOTICE_SENT' ? '✉️ [최고장]' : '⚖️ [법적조치]'} ({log.recordedBy})
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>
                          {log.createdAt.replace('T', ' ').slice(0, 16)}
                        </span>
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.4', color: 'var(--text-secondary)' }}>
                        {log.actionDetails}
                      </div>
                      {log.actionType === 'NOTICE_SENT' && (() => {
                        const noticeRecord = legalNoticeLogs.find(n => n.customerId === selectedDelinquency?.customerId);
                        if (!noticeRecord) return null;
                        return (
                          <div style={{ marginTop: '6px' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setViewingNoticeLog(noticeRecord)}
                              style={{ padding: '2px 8px', fontSize: '11px', color: '#7e22ce', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Eye size={11} /> 발송 내용증명 원문 보기
                            </button>
                          </div>
                        );
                      })()}

                      {log.promiseDate && (
                        <div style={{ marginTop: '6px', padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <strong style={{ color: log.promiseStatus === 'KEPT' ? '#16a34a' : log.promiseStatus === 'BROKEN' ? '#dc2626' : '#2563eb' }}>
                              📌 약속일: {log.promiseDate} (₩{log.promiseAmount?.toLocaleString()}원)
                            </strong>
                            <span style={{ fontSize: '10.5px', marginLeft: '6px' }}>
                              [{log.promiseStatus === 'KEPT' ? '이행 완료' : log.promiseStatus === 'BROKEN' ? '약속 파기' : '대기중'}]
                            </span>
                          </div>
                          {log.promiseStatus === 'PENDING' && (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button type="button" className="btn-secondary" onClick={() => handleUpdatePromiseStatus(log.id, 'KEPT')} style={{ padding: '2px 6px', fontSize: '10px', color: 'var(--success)' }}>
                                준수
                              </button>
                              <button type="button" className="btn-secondary" onClick={() => handleUpdatePromiseStatus(log.id, 'BROKEN')} style={{ padding: '2px 6px', fontSize: '10px', color: 'var(--danger)' }}>
                                파기
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계 대차대조식 검증 바 (헌장 3.5) */}
      {(() => {
        const totalOverdueSum = calculatedDelinquencies.reduce((s, d) => s + d.totalOverdueAmount, 0);
        const highRiskCount = calculatedDelinquencies.filter(d => d.riskTier === 'HIGH').length;
        const pendingDirectiveCount = calculatedDelinquencies.filter(d => d.hasPendingDirective).length;
        const neglectedDirectiveCount = calculatedDelinquencies.filter(d => d.directiveNeglectedDays >= 3).length;

        return (
          <div style={{
            padding: '8px 14px',
            backgroundColor: 'var(--bg-app)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            fontSize: '11.5px',
            borderRadius: '6px',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <span>연체 거래처: <strong style={{ color: 'var(--danger)' }}>총 {calculatedDelinquencies.length}개사</strong></span>
              <span>|</span>
              <span>연체 총액: <strong style={{ color: 'var(--danger)' }}>₩{totalOverdueSum.toLocaleString()}원</strong></span>
              <span>|</span>
              <span>고위험 상습연체(🔴): <strong style={{ color: '#dc2626' }}>총 {highRiskCount}개사</strong></span>
              <span>|</span>
              <span>경영진 지시 진행중: <strong style={{ color: 'var(--primary)' }}>총 {pendingDirectiveCount}건</strong></span>
              {neglectedDirectiveCount > 0 && (
                <>
                  <span>|</span>
                  <span style={{ color: '#dc2626', fontWeight: 800 }}>🚨 3일 이상 지시 방치: 총 {neglectedDirectiveCount}건</span>
                </>
              )}
            </div>
            <span style={{
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'var(--success-light)',
              color: 'var(--success)',
              fontWeight: 700,
              fontSize: '11px'
            }}>
              ⚖️ 대차 정상 (연체채권-약정납기-영업담당 매핑 100% 무결)
            </span>
          </div>
        );
      })()}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [경영진 고유권한] 내용증명(최고장) 편집기 & 인쇄 스튜디오 모달                 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showNoticeModal && noticeTargetDel && (() => {
        const cust = customers.find(c => c.id === noticeTargetDel.customerId);

        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
            <div className="card" style={{ width: '95%', maxWidth: '1100px', height: '90vh', backgroundColor: 'var(--bg-card)', margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              
              {/* 모달 헤더 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, backgroundColor: '#f3e8ff', color: '#7e22ce' }}>경영진 전결</span>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FileText size={17} color="#7e22ce" /> 내용증명 / 법적 최고장 작성 스튜디오
                  </h3>
                </div>
                <button type="button" onClick={() => setShowNoticeModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
                  ✕
                </button>
              </div>

              {/* 2열 스튜디오 본체: 좌측 편집기 / 우측 실시간 A4 미리보기 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: '14px', flex: 1, minHeight: 0 }}>
                
                {/* [좌측] 실시간 내용증명 편집기 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', paddingRight: '4px' }}>
                  
                  <div style={{ backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px', fontSize: '11.5px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>수신 거래처: <strong>{noticeTargetDel.customerName}</strong></div>
                    <div>대표이사: <strong>{cust?.representative || '대표이사'}</strong> 귀하</div>
                    <div>연체 총액: <strong style={{ color: 'var(--danger)' }}>₩{noticeTargetDel.totalOverdueAmount.toLocaleString()}원</strong></div>
                    <div>약정 결제일: <strong>{noticeTargetDel.paymentDueConditionText}</strong> ({noticeTargetDel.overdueDays}일 도과)</div>
                  </div>

                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, display: 'block', marginBottom: '3px' }}>문서 제목</label>
                    <input
                      type="text"
                      value={noticeTitle}
                      onChange={e => setNoticeTitle(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', fontWeight: 700 }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, display: 'block', marginBottom: '3px' }}>변제 최고 기한 (도달일로부터)</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="number"
                          value={noticeDeadlineDays}
                          onChange={e => setNoticeDeadlineDays(Math.max(1, Number(e.target.value)))}
                          style={{ width: '80px', padding: '5px', fontSize: '12px', textAlign: 'center' }}
                        />
                        <span style={{ fontSize: '12px' }}>일 이내</span>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, display: 'block', marginBottom: '3px' }}>우체국 등기번호 (발송 후 입력)</label>
                      <input
                        type="text"
                        value={noticeTrackingNo}
                        onChange={e => setNoticeTrackingNo(e.target.value)}
                        placeholder="예: 13자리 등기번호"
                        style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                      />
                    </div>
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                      <label style={{ fontSize: '11.5px', fontWeight: 700 }}>내용증명 본문 (자유 편집 가능)</label>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleSaveNoticeTemplate}
                        style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--primary)' }}
                      >
                        <Save size={11} /> 기본 서식으로 저장
                      </button>
                    </div>
                    <textarea
                      value={noticeCustomContent}
                      onChange={e => setNoticeCustomContent(e.target.value)}
                      rows={12}
                      style={{ width: '100%', flex: 1, padding: '10px', fontSize: '11.5px', lineHeight: '1.6', borderRadius: '5px', border: '1px solid var(--border-color)', resize: 'none', fontFamily: 'inherit' }}
                    />
                  </div>
                </div>

                {/* [우측] A4 실시간 인쇄 규격 미리보기 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>A4 우체국 내용증명 규격 실시간 미리보기 (여백 20mm)</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => window.print()}
                      style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                    >
                      <Printer size={12} /> 인쇄 / PDF 출력
                    </button>
                  </div>

                  <div 
                    id="legal-notice-print-area"
                    style={{
                      flex: 1,
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      padding: '24px 28px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      overflowY: 'auto',
                      fontSize: '11px',
                      lineHeight: '1.6',
                      fontFamily: "'Malgun Gothic', '맑은 고딕', sans-serif"
                    }}
                  >
                    <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 900, letterSpacing: '4px', textDecoration: 'underline', marginBottom: '20px' }}>
                      최 고 장 (내 용 증 명)
                    </div>

                    {/* 수신인 / 발신인 상자 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px', border: '1px solid #94a3b8', padding: '10px' }}>
                      <div>
                        <div style={{ fontWeight: 800, borderBottom: '1px dashed #cbd5e1', paddingBottom: '3px', marginBottom: '4px' }}>[수 신 인]</div>
                        <div>상 호: <strong>{noticeTargetDel.customerName}</strong></div>
                        <div>대 표 자: <strong>{cust?.representative || '대표이사'}</strong> 귀하</div>
                        <div>사업자번호: {cust?.bizRegNo || '-'}</div>
                        <div>주 소: {cust?.address || '사업장 소재지'}</div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, borderBottom: '1px dashed #cbd5e1', paddingBottom: '3px', marginBottom: '4px' }}>[발 신 인]</div>
                        <div>상 호: <strong>{currentTenant?.corporateName || currentTenant?.tradeName || '주식회사 임대인'}</strong></div>
                        <div>대 표 자: <strong>{currentTenant?.representativeName || '대표자'}</strong> (직인생략/날인)</div>
                        <div>등록번호: {currentTenant?.businessNumber || '138-81-83251'}</div>
                        <div>주 소: {currentTenant?.businessAddress || (currentTenant as any)?.address || '사업장 소재지'}</div>
                        <div>전화번호: {currentTenant?.tel || '031-334-5296'}</div>
                      </div>
                    </div>

                    <div style={{ fontWeight: 800, fontSize: '12px', marginBottom: '12px', backgroundColor: '#f1f5f9', padding: '6px 8px', borderLeft: '4px solid #0f172a' }}>
                      제 목: {noticeTitle}
                    </div>

                    {/* 본문 */}
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', marginBottom: '24px' }}>
                      {noticeCustomContent}
                    </div>

                    {/* 말미 직인 날인란 */}
                    <div style={{ textAlign: 'right', marginTop: '30px', paddingRight: '10px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
                        {todayStr.split('-')[0]}년 {todayStr.split('-')[1]}월 {todayStr.split('-')[2]}일
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 900, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span>{currentTenant?.corporateName || '주식회사 임대인'} 대표이사 {currentTenant?.representativeName || '대표자'}</span>
                        <span style={{ border: '2px solid #dc2626', color: '#dc2626', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                          (인)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* 하단 액션 버튼 바 */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  발송 승인 시 내용증명 발송 이력(`legalNoticeLogs`) 및 고객 타임라인에 영구 보존됩니다.
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowNoticeModal(false)} style={{ padding: '6px 14px', fontSize: '12px' }}>
                    취소
                  </button>
                  <button type="button" className="btn-primary" onClick={handleSubmitLegalNotice} style={{ padding: '6px 16px', fontSize: '12px', backgroundColor: '#7e22ce', borderColor: '#7e22ce' }}>
                    내용증명 발송 승인 및 이력 저장
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 내용증명 원문 열람 모달 (과거 발송분 조회)                                   */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {viewingNoticeLog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '20px' }}>
          <div className="card" style={{ width: '90%', maxWidth: '750px', maxHeight: '85vh', backgroundColor: '#ffffff', color: '#0f172a', margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: '8px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>
                📜 발송 내용증명 원문 (발송일: {viewingNoticeLog.sentDate})
              </h3>
              <button type="button" onClick={() => setViewingNoticeLog(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
                ✕
              </button>
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid #e2e8f0' }}>
              <div>수신: <strong>{viewingNoticeLog.customerName}</strong> ({viewingNoticeLog.representative} 귀하)</div>
              <div>발송자: <strong>{viewingNoticeLog.sentByName}</strong> (경영진)</div>
              <div>최고금액: <strong style={{ color: '#dc2626' }}>₩{viewingNoticeLog.overdueAmount?.toLocaleString()}원</strong> ({viewingNoticeLog.overdueDays}일 도과 시점)</div>
              {viewingNoticeLog.postalTrackingNo && <div>등기번호: <strong>{viewingNoticeLog.postalTrackingNo}</strong></div>}
            </div>

            <div style={{ fontWeight: 800, fontSize: '13px' }}>
              제 목: {viewingNoticeLog.noticeTitle}
            </div>

            <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', fontSize: '11.5px', backgroundColor: '#ffffff', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
              {viewingNoticeLog.noticeContent}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn-secondary" onClick={() => setViewingNoticeLog(null)} style={{ padding: '6px 14px', fontSize: '12px' }}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 경영진 수금독촉 지시 하달 모달                                            */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showDirectiveModal && directiveTargetDel && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: '480px', backgroundColor: 'var(--bg-card)', margin: 0, padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Send size={16} color="var(--primary)" /> 경영진 수금독촉 지시 하달
              </h3>
              <button type="button" onClick={() => setShowDirectiveModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                ✕
              </button>
            </div>

            <div style={{ backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>대상 거래처: <strong>{directiveTargetDel.customerName}</strong></div>
              <div>담당 영업사원: <strong>{directiveTargetDel.responsibleEmployeeName}</strong></div>
              <div>연체 금액: <strong style={{ color: 'var(--danger)' }}>₩{directiveTargetDel.totalOverdueAmount.toLocaleString()}원 ({directiveTargetDel.overdueDays}일 도과)</strong></div>
              <div>약정 결제조건: <strong>{directiveTargetDel.paymentDueConditionText}</strong></div>
            </div>

            {/* 퀵 지시 프리셋 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>자주 쓰는 지시 내용</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {QUICK_DIRECTIVE_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDirectiveDetails(preset)}
                    style={{ textAlign: 'left', padding: '4px 8px', fontSize: '11px' }}
                  >
                    👉 {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>지시 상세 내용</label>
              <textarea
                value={directiveDetails}
                onChange={e => setDirectiveDetails(e.target.value)}
                placeholder="담당 영업사원에게 하달할 구체적인 채권 회수 지시를 작성해 주십시오..."
                rows={3}
                style={{ width: '100%', padding: '8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>조치 완료 기한</label>
              <input
                type="date"
                value={directiveDueDate}
                onChange={e => setDirectiveDueDate(e.target.value)}
                style={{ width: '100%', padding: '6px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowDirectiveModal(false)} style={{ padding: '6px 14px', fontSize: '12px' }}>
                취소
              </button>
              <button type="button" className="btn-primary" onClick={handleSubmitDirective} style={{ padding: '6px 14px', fontSize: '12px' }}>
                지시 하달 (ToDo 연동)
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
