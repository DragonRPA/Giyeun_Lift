// src/mobile/pages/MobileCustomerManage.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { db, Customer, CustomerContact, CustomerSite, DelinquencyActionLog } from '../../services/db';
import { 
  Building2, Search, Phone, MapPin, Plus, CheckCircle2, 
  AlertCircle, Lock, Unlock, ChevronDown, ChevronUp, X, Edit2, Copy, Check, Send, FileText, FolderOpen
} from 'lucide-react';
import { matchHangul } from '../../utils/hangulSearch';
import { copyToClipboard } from '../../utils/nativeLauncher';
import { BusinessLicenseModal } from '../../components/BusinessLicenseModal';
import { BatchBusinessLicenseModal } from '../../components/BatchBusinessLicenseModal';

interface MobileCustomerManageProps {
  onNavigateToOrder?: (customerId: string) => void;
}

export const MobileCustomerManage: React.FC<MobileCustomerManageProps> = ({ onNavigateToOrder }) => {
  const { 
    customers, contacts, sites, assets, contracts, billings, currentUser,
    saveCustomer, refreshAllData, showErrorModal 
  } = useApp();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'MY' | 'ALLOWED' | 'BLOCKED' | 'INCOMPLETE'>('ALL');
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 📄 사업자등록증 AI 모달 상태
  const [showBizLicenseModal, setShowBizLicenseModal] = useState(false);
  const [targetBizLicenseCustId, setTargetBizLicenseCustId] = useState<string | undefined>(undefined);
  const [showBatchLicenseModal, setShowBatchLicenseModal] = useState(false);
  
  // 고객사 정보 간이 수정 모달 상태 (헌장 1.1 & 2.1)
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);

  // 신규 고객사 등록 모달 상태 (과제 9)
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState<Partial<Customer>>({
    name: '',
    bizRegNo: '',
    representative: '',
    repContact: '',
    repEmail: '',
    address: '',
    bizType: '',
    bizItem: '',
    defaultBillingDay: 30,
    defaultStatementClosingDay: 25,
    paymentDueDay: 25,
    isClosed: false
  });

  // 정보 누락 여부 판정 (헌장 1.2 & 과제 9: 사업자, 대표자, 연락처, 주소 + 결제조건 마감일/약정일 무누락 검증)
  const isIncomplete = (c: Customer) => {
    return !c.bizRegNo || c.bizRegNo === '미상' ||
           !c.representative || c.representative === '미상' ||
           !c.repContact || c.repContact === '미상' ||
           !c.address || c.address === '미상' ||
           !c.defaultBillingDay || (!c.paymentDueDay && !c.paymentTermDays);
  };

  // 로그인한 사용자의 담당 고객사 ID 집합 (계약 기반 헌장 1.1 영업 편의)
  const myCustomerIds = useMemo(() => {
    if (!currentUser) return new Set<string>();
    return new Set(contracts.filter(c => c.salespersonId === currentUser.id).map(c => c.customerId));
  }, [contracts, currentUser]);

  // 실시간 고객 목록 및 통계 매핑
  const customerExtendedList = useMemo(() => {
    return customers.map(c => {
      // 1. 가동 장비 수: 헌장 1.3 출고 검수 완료 시 RENTED 기준
      const rentedAssetCount = assets.filter(a => a.currentCustomerId === c.id && a.status === 'RENTED').length;
      
      // 2. 유효 현장 수
      const custSites = sites.filter(s => s.customerId === c.id && s.isActive !== false);
      
      // 3. 미수금 총액
      const custBillings = billings.filter(b => b.customerId === c.id && b.status !== 'REJECTED' && b.status !== 'PAID');
      const unpaidAmount = custBillings.reduce((sum, b) => sum + Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0)), 0);

      // 4. 소속 담당자
      const custContacts = contacts.filter(cnt => cnt.customerId === c.id && cnt.isActive !== false);

      return {
        customer: c,
        rentedAssetCount,
        siteCount: custSites.length,
        custSites,
        custContacts,
        unpaidAmount,
        hasIncomplete: isIncomplete(c)
      };
    });
  }, [customers, assets, sites, billings, contacts]);

  // 검색 및 필터링
  const filteredList = useMemo(() => {
    return customerExtendedList.filter(item => {
      const c = item.customer;
      const matchText = !searchTerm || 
        matchHangul(c.name, searchTerm) || 
        (c.bizRegNo || '').includes(searchTerm) ||
        matchHangul(c.representative || '', searchTerm) ||
        (c.repContact || '').includes(searchTerm);

      if (!matchText) return false;

      if (statusFilter === 'MY') return myCustomerIds.has(c.id);
      if (statusFilter === 'ALLOWED') return c.transactionStatus !== 'BLOCKED';
      if (statusFilter === 'BLOCKED') return c.transactionStatus === 'BLOCKED';
      if (statusFilter === 'INCOMPLETE') return item.hasIncomplete;
      return true;
    });
  }, [customerExtendedList, searchTerm, statusFilter, myCustomerIds]);

  // 4대 상단 요약 통계
  const stats = useMemo(() => ({
    total: customers.length,
    allowed: customers.filter(c => c.transactionStatus !== 'BLOCKED').length,
    blocked: customers.filter(c => c.transactionStatus === 'BLOCKED').length,
    incomplete: customers.filter(isIncomplete).length,
  }), [customers]);

  // 주소 복사 핸들러
  const handleCopy = async (id: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 헌장 5.2 준수: 거래제한(출고금지) 원클릭 토글
  const handleToggleBlock = async (c: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextStatus = c.transactionStatus === 'BLOCKED' ? 'ALLOWED' : 'BLOCKED';
    try {
      await saveCustomer({ ...c, transactionStatus: nextStatus });
      
      const roleLabel = currentUser?.role === 'EXECUTIVE' ? '경영진 직권' : '영업부 조치';
      // 사법 감사 판정 준수: delinquencyActionLogs에 영구 불변 감사 로그 기록
      db.insertRow<DelinquencyActionLog>('delinquencyActionLogs', {
        customerId: c.id,
        actionType: nextStatus === 'BLOCKED' ? 'LEGAL' : 'CALL',
        actionDetails: nextStatus === 'BLOCKED'
          ? `[${roleLabel}] 신규 장비 출고 및 배차 전면 금지(BLOCKED) 조치 발효`
          : `[${roleLabel}] 거래처 상태 정상(ALLOWED) 환원`,
        recordedBy: currentUser?.name || '담당자',
        mandateType: 'CEO_AUTO_MANDATE',
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      await refreshAllData();
    } catch (err: any) {
      showErrorModal(`거래 상태 변경 실패: ${err?.message || err}`);
    }
  };

  // 헌장 5.2 준수: 고객 기본정보 및 결제조건 수정 저장
  const handleSaveCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !editingCustomer.name) return;
    try {
      const sanitizedBillingDay = Math.min(31, Math.max(1, Number(editingCustomer.defaultBillingDay) || 30));
      const sanitizedStatementClosingDay = Math.min(31, Math.max(1, Number(editingCustomer.defaultStatementClosingDay) || 25));
      const sanitizedPaymentDueDay = Math.min(31, Math.max(1, Number(editingCustomer.paymentDueDay) || 25));
      await saveCustomer({
        ...editingCustomer,
        defaultBillingDay: sanitizedBillingDay,
        defaultStatementClosingDay: sanitizedStatementClosingDay,
        paymentDueDay: sanitizedPaymentDueDay
      } as Omit<Customer, 'id' | 'createdAt'>);
      await db.awaitPendingWrites();
      await refreshAllData();
      setEditingCustomer(null);
    } catch (err: any) {
      showErrorModal(`고객 정보 저장 실패: ${err?.message || err}`);
    }
  };

  // 헌장 5.2 준수: 신규 고객사 등록 저장 (과제 9)
  const handleCreateCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerForm.name?.trim()) {
      showErrorModal('상호명(고객사명)을 입력하십시오.');
      return;
    }
    try {
      const sanitizedBillingDay = Math.min(31, Math.max(1, Number(newCustomerForm.defaultBillingDay) || 30));
      const sanitizedStatementClosingDay = Math.min(31, Math.max(1, Number(newCustomerForm.defaultStatementClosingDay) || 25));
      const sanitizedPaymentDueDay = Math.min(31, Math.max(1, Number(newCustomerForm.paymentDueDay) || 25));
      await saveCustomer({
        name: newCustomerForm.name.trim(),
        bizRegNo: newCustomerForm.bizRegNo?.trim() || '',
        representative: newCustomerForm.representative?.trim() || '',
        repContact: newCustomerForm.repContact?.trim() || '',
        repEmail: newCustomerForm.repEmail?.trim() || '',
        address: newCustomerForm.address?.trim() || '',
        bizType: newCustomerForm.bizType?.trim() || '',
        bizItem: newCustomerForm.bizItem?.trim() || '',
        defaultBillingDay: sanitizedBillingDay,
        defaultStatementClosingDay: sanitizedStatementClosingDay,
        paymentDueDay: sanitizedPaymentDueDay,
        transactionStatus: 'ALLOWED',
        isClosed: false
      } as any);
      await db.awaitPendingWrites();
      await refreshAllData();
      setIsCreatingCustomer(false);
      setNewCustomerForm({
        name: '',
        bizRegNo: '',
        representative: '',
        repContact: '',
        repEmail: '',
        address: '',
        bizType: '',
        bizItem: '',
        defaultBillingDay: 30,
        defaultStatementClosingDay: 25,
        paymentDueDay: 25,
        isClosed: false
      });
    } catch (err: any) {
      showErrorModal(`신규 고객사 등록 실패: ${err?.message || err}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-24 pt-2 font-sans text-slate-100">
      {/* 1. 상단 통계 바 */}
      <div className="grid grid-cols-4 gap-2 px-1">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-center">
          <div className="text-[10px] text-slate-400 font-bold whitespace-nowrap">전체 거래처</div>
          <div className="text-base font-black text-white font-mono mt-0.5">{stats.total}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-center">
          <div className="text-[10px] text-emerald-400 font-bold whitespace-nowrap">정상 거래</div>
          <div className="text-base font-black text-emerald-400 font-mono mt-0.5">{stats.allowed}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-center">
          <div className="text-[10px] text-rose-400 font-bold whitespace-nowrap">출고 제한</div>
          <div className="text-base font-black text-rose-400 font-mono mt-0.5">{stats.blocked}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-center">
          <div className="text-[10px] text-amber-400 font-bold whitespace-nowrap">정보 누락</div>
          <div className="text-base font-black text-amber-400 font-mono mt-0.5">{stats.incomplete}</div>
        </div>
      </div>

      {/* 2. 헌장 3.4 준수: 상하 세로 스택 검색창 및 상태 필터 칩 */}
      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">
            고객사 통합 검색
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowBatchLicenseModal(true)}
              className="px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 shadow transition-transform"
              title="사업자등록증 폴더/다중 파일 일괄 등록"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>폴더 일괄</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetBizLicenseCustId(undefined);
                setShowBizLicenseModal(true);
              }}
              className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 shadow transition-transform"
              title="사업자등록증 사진/PDF 업로드로 자동 등록 및 보완"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>단건 등록</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCreatingCustomer(true)}
              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 shadow transition-transform"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>직접 등록</span>
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="상호, 사업자번호, 대표자명 검색"
            className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          {myCustomerIds.size > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter('MY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-colors flex items-center gap-1 ${
                statusFilter === 'MY' 
                  ? 'bg-blue-600 text-white shadow' 
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              <span>내 거래처</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/30 font-mono">
                {myCustomerIds.size}
              </span>
            </button>
          )}
          {(['ALL', 'ALLOWED', 'BLOCKED', 'INCOMPLETE'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setStatusFilter(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-colors ${
                statusFilter === mode 
                  ? 'bg-blue-600 text-white shadow' 
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              {mode === 'ALL' ? '전체' : mode === 'ALLOWED' ? '정상 거래' : mode === 'BLOCKED' ? '출고 제한' : '정보 누락'}
            </button>
          ))}
        </div>
      </div>

      {/* 3. 고객사 Card Dossier 리스트 (헌장 3.6 유형 A) */}
      <div className="flex flex-col gap-2.5 px-1 mt-1">
        {filteredList.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-900/60 rounded-2xl border border-slate-800">
            조건에 부합하는 고객사 데이터가 없습니다.
          </div>
        ) : (
          filteredList.map(({ customer: c, rentedAssetCount, siteCount, custSites, custContacts, unpaidAmount, hasIncomplete }) => {
            const isExp = expandedCustomerId === c.id;
            const isBlk = c.transactionStatus === 'BLOCKED';
            const repPhone = c.repContact || '';

            return (
              <div 
                key={c.id} 
                className={`rounded-2xl border p-3.5 transition-all shadow-md ${
                  isBlk 
                    ? 'bg-rose-950/20 border-rose-900/60' 
                    : 'bg-slate-900/95 border-slate-800'
                }`}
              >
                {/* 1열: 상호명 및 거래상태 배지 + 직권 출고제한 버튼 */}
                <div 
                  className="flex items-start justify-between gap-2 cursor-pointer"
                  onClick={() => setExpandedCustomerId(isExp ? null : c.id)}
                >
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-black text-sm text-white truncate max-w-[180px]">
                        {c.name}
                      </span>
                      {isBlk ? (
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 text-[10px] font-bold whitespace-nowrap flex-shrink-0">
                          출고 제한
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800/60 text-emerald-300 text-[10px] font-bold whitespace-nowrap flex-shrink-0">
                          정상 거래
                        </span>
                      )}
                      {hasIncomplete && (
                        <div className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-800/60 text-amber-300 text-[10px] font-bold whitespace-nowrap flex-shrink-0">
                            정보 누락
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTargetBizLicenseCustId(c.id);
                              setShowBizLicenseModal(true);
                            }}
                            className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 text-[10px] font-bold whitespace-nowrap flex-shrink-0 flex items-center gap-0.5 active:scale-95"
                            title="사업자등록증 사진으로 누락 정보 자동 보완"
                          >
                            <FileText className="w-2.5 h-2.5" />
                            <span>등록증 보완</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
                      <span>{c.bizRegNo || '사업자 미등록'}</span>
                      <span>•</span>
                      <span>대표: {c.representative || '미상'}</span>
                    </div>
                  </div>

                  {/* 직권 처분 버튼 및 아코디언 토글 */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleToggleBlock(c, e)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95 whitespace-nowrap flex-shrink-0 ${
                        isBlk 
                          ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' 
                          : 'bg-rose-600 text-white hover:bg-rose-500'
                      }`}
                    >
                      {isBlk ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{isBlk ? '해제' : '제한'}</span>
                    </button>
                    <div className="p-1 text-slate-400">
                      {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* 2열: 가동 현황 요약 (헌장 3.2 No-Wrap 1줄) */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 mt-1">
                  <div className="flex items-center gap-2 whitespace-nowrap flex-shrink-0">
                    <span>현장 <strong className="text-sky-400 font-mono">{siteCount}개소</strong></span>
                    <span>•</span>
                    <span>가동 <strong className="text-emerald-400 font-mono">{rentedAssetCount}대</strong></span>
                  </div>

                  {unpaidAmount > 0 ? (
                    <span className="text-rose-400 font-mono font-bold whitespace-nowrap flex-shrink-0">
                      미수 ₩{unpaidAmount.toLocaleString()}원
                    </span>
                  ) : (
                    <span className="text-emerald-500 font-mono text-[10px] whitespace-nowrap flex-shrink-0">
                      미수금 없음
                    </span>
                  )}
                </div>

                {/* 3열: 아코디언 확장 360도 상세 패널 */}
                {isExp && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 flex flex-col gap-3">
                    {/* 대표자 직통 통화 바 (전화번호 복사 버튼 추가 - 과제 9) */}
                    {repPhone && (
                      <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800">
                        <div className="text-xs text-slate-300 flex items-center gap-1.5 flex-wrap">
                          <Phone className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                          <span className="text-slate-400">대표자:</span>
                          <span className="font-mono text-white font-bold">{repPhone}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(c.id + '_repPhone', repPhone, e)}
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 ml-1 active:scale-90 transition-transform"
                            title="전화번호 복사"
                          >
                            {copiedId === c.id + '_repPhone' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <a 
                          href={`tel:${repPhone}`}
                          className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1 active:scale-95 whitespace-nowrap flex-shrink-0"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>통화 연결</span>
                        </a>
                      </div>
                    )}

                    {/* 결제 약정 조건 블록 */}
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-300">결제 약정 조건</span>
                        <button 
                          type="button"
                          onClick={() => setEditingCustomer(c)}
                          className="text-blue-400 text-xs font-bold flex items-center gap-1 hover:underline"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>수정</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-400 pt-1">
                        <div>계산서 마감: <strong className="text-white">매월 {c.defaultBillingDay || '말'}일</strong></div>
                        <div>약정 결제일: <strong className="text-emerald-400">{c.paymentDueDay ? `익월 ${c.paymentDueDay}일` : c.paymentTermDays ? `발행 후 ${c.paymentTermDays}일` : '익월 25일'}</strong></div>
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60">
                        <span className="truncate flex-1 pr-2">주소: {c.address || '사업장 주소 미등록'}</span>
                        {c.address && (
                          <button
                            type="button"
                            onClick={(e) => handleCopy(c.id, c.address, e)}
                            className="text-slate-400 hover:text-white flex-shrink-0"
                          >
                            {copiedId === c.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 소속 담당자 목록 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-300">
                        소속 담당자 ({custContacts.length}명)
                      </span>
                      {custContacts.length === 0 ? (
                        <div className="text-[11px] text-slate-500 py-1 bg-slate-950/60 rounded-lg p-2">
                          등록된 담당자가 없습니다.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {custContacts.map(cnt => (
                            <div key={cnt.id} className="bg-slate-950 p-2 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                              <div>
                                <span className="font-bold text-white">{cnt.name}</span>
                                <span className="text-slate-400 text-[11px] ml-1">({cnt.position || '직책미등록'})</span>
                              </div>
                              {cnt.contact && (
                                <a 
                                  href={`tel:${cnt.contact}`}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 text-sky-400 border border-slate-700 text-[11px] flex items-center gap-1 font-mono active:scale-95"
                                >
                                  <Phone className="w-3 h-3" />
                                  <span>{cnt.contact}</span>
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 가동 현장 목록 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-300">
                        소속 현장 ({custSites.length}개소)
                      </span>
                      {custSites.length === 0 ? (
                        <div className="text-[11px] text-slate-500 py-1 bg-slate-950/60 rounded-lg p-2">
                          등록된 현장이 없습니다.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {custSites.map(st => (
                            <div key={st.id} className="bg-slate-950 p-2 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                              <div className="min-w-0 flex-1 pr-2">
                                <div className="font-bold text-white truncate">{st.name}</div>
                                <div className="text-[11px] text-slate-400 truncate">{st.address || '현장 주소 미등록'}</div>
                              </div>
                              {st.contact && (
                                <a 
                                  href={`tel:${st.contact}`}
                                  className="p-1.5 rounded-lg bg-slate-800 text-sky-400 border border-slate-700 active:scale-95 flex-shrink-0"
                                >
                                  <Phone className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 사업자등록증 사본 및 AI 보완 액션 */}
                    <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs text-slate-300">
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>사업자등록증 원본</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {c.businessCertFileUrl && (
                          <a
                            href={c.businessCertFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:underline font-bold text-xs"
                          >
                            열람 ↗
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTargetBizLicenseCustId(c.id);
                            setShowBizLicenseModal(true);
                          }}
                          className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300 text-[11px] font-bold active:scale-95"
                        >
                          {c.businessCertFileUrl ? '재판독 보완' : '등록증 보완'}
                        </button>
                      </div>
                    </div>

                    {/* 영업 연계: 고객사 지정 모바일 출고요청 직결 버튼 (BLOCKED 거래처 가드 - 과제 9) */}
                    {onNavigateToOrder && (
                      <button
                        type="button"
                        disabled={isBlk}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isBlk) onNavigateToOrder(c.id);
                        }}
                        className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all mt-1 ${
                          isBlk
                            ? 'bg-slate-800/80 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60'
                            : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
                        }`}
                      >
                        {isBlk ? <AlertCircle className="w-3.5 h-3.5 text-rose-400" /> : <Send className="w-3.5 h-3.5" />}
                        <span>{isBlk ? '출고 제한 거래처 (신규 출고요청 불가)' : '이 고객사로 출고요청 작성'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 4. 고객 기본정보 및 결제조건 간이 수정 모달 (헌장 3.4 상하 세로 스택) */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3">
          <form 
            onSubmit={handleSaveCustomerSubmit} 
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-4 flex flex-col gap-3 max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-bold text-sm text-white">고객사 약정 정보 수정</span>
              <button 
                type="button" 
                onClick={() => setEditingCustomer(null)} 
                className="text-slate-400 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* 상호 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">고객사명</label>
              <input 
                type="text" 
                value={editingCustomer.name || ''} 
                onChange={e => setEditingCustomer({...editingCustomer, name: e.target.value})} 
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                required 
              />
            </div>
            
            {/* 사업자번호 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">사업자등록번호</label>
              <input 
                type="text" 
                value={editingCustomer.bizRegNo || ''} 
                onChange={e => setEditingCustomer({...editingCustomer, bizRegNo: e.target.value})} 
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
              />
            </div>

            {/* 대표자 & 연락처 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">대표자명</label>
                <input 
                  type="text" 
                  value={editingCustomer.representative || ''} 
                  onChange={e => setEditingCustomer({...editingCustomer, representative: e.target.value})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">대표자 연락처</label>
                <input 
                  type="text" 
                  value={editingCustomer.repContact || ''} 
                  onChange={e => setEditingCustomer({...editingCustomer, repContact: e.target.value})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                />
              </div>
            </div>

            {/* 마감 및 결제조건 (3종) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">청구 마감일 (일)</label>
                <input 
                  type="number" 
                  value={editingCustomer.defaultBillingDay ?? ''} 
                  onChange={e => setEditingCustomer({...editingCustomer, defaultBillingDay: parseInt(e.target.value, 10) || undefined})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                  placeholder="30"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">명세서 마감일 (일)</label>
                <input 
                  type="number" 
                  value={editingCustomer.defaultStatementClosingDay ?? ''} 
                  onChange={e => setEditingCustomer({...editingCustomer, defaultStatementClosingDay: parseInt(e.target.value, 10) || undefined})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                  placeholder="25"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">약정 결제일 (일)</label>
                <input 
                  type="number" 
                  value={editingCustomer.paymentDueDay ?? ''} 
                  onChange={e => setEditingCustomer({...editingCustomer, paymentDueDay: parseInt(e.target.value, 10) || undefined})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                  placeholder="25"
                />
              </div>
            </div>

            {/* 업태 & 종목 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">업태</label>
                <input 
                  type="text" 
                  value={editingCustomer.bizType || ''} 
                  onChange={e => setEditingCustomer({...editingCustomer, bizType: e.target.value})} 
                  placeholder="건설, 임대"
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">종목</label>
                <input 
                  type="text" 
                  value={editingCustomer.bizItem || ''} 
                  onChange={e => setEditingCustomer({...editingCustomer, bizItem: e.target.value})} 
                  placeholder="고소작업대 임대"
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                />
              </div>
            </div>

            {/* 세금계산서 수신 이메일 (과제 9) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">세금계산서 수신 이메일</label>
              <input 
                type="email" 
                value={editingCustomer.repEmail || ''} 
                onChange={e => setEditingCustomer({...editingCustomer, repEmail: e.target.value})} 
                placeholder="tax@company.com"
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
              />
            </div>

            {/* 사업장 주소 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">사업장 주소</label>
              <input 
                type="text" 
                value={editingCustomer.address || ''} 
                onChange={e => setEditingCustomer({...editingCustomer, address: e.target.value})} 
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
              />
            </div>

            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-800">
              <button 
                type="button" 
                onClick={() => setEditingCustomer(null)} 
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-slate-300 hover:bg-slate-700 active:scale-95"
              >
                취소
              </button>
              <button 
                type="submit" 
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-lg active:scale-95"
              >
                저장
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 5. 신규 고객사 간이 등록 모달 (헌장 3.4 상하 세로 스택 & 과제 9) */}
      {isCreatingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form 
            onSubmit={handleCreateCustomerSubmit}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl animate-in fade-in zoom-in duration-150 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-bold text-sm text-white">신규 고객사 등록</span>
              <button 
                type="button" 
                onClick={() => setIsCreatingCustomer(false)} 
                className="text-slate-400 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 flex items-center justify-between text-xs">
              <span className="text-emerald-300 font-bold flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                사진/PDF 파일로 등록하시겠습니까?
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingCustomer(false);
                  setTargetBizLicenseCustId(undefined);
                  setShowBizLicenseModal(true);
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs active:scale-95 shadow"
              >
                AI 자동 판독 ➔
              </button>
            </div>
            
            {/* 상호 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">고객사명 (상호) *</label>
              <input 
                type="text" 
                value={newCustomerForm.name || ''} 
                onChange={e => setNewCustomerForm({...newCustomerForm, name: e.target.value})} 
                placeholder="예: (주)대한건설"
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                required 
              />
            </div>
            
            {/* 사업자번호 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">사업자등록번호</label>
              <input 
                type="text" 
                value={newCustomerForm.bizRegNo || ''} 
                onChange={e => setNewCustomerForm({...newCustomerForm, bizRegNo: e.target.value})} 
                placeholder="000-00-00000"
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
              />
            </div>

            {/* 대표자 & 연락처 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">대표자명</label>
                <input 
                  type="text" 
                  value={newCustomerForm.representative || ''} 
                  onChange={e => setNewCustomerForm({...newCustomerForm, representative: e.target.value})} 
                  placeholder="대표자 성명"
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">대표자 연락처</label>
                <input 
                  type="text" 
                  value={newCustomerForm.repContact || ''} 
                  onChange={e => setNewCustomerForm({...newCustomerForm, repContact: e.target.value})} 
                  placeholder="010-0000-0000"
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                />
              </div>
            </div>

            {/* 세금계산서 이메일 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">세금계산서 수신 이메일</label>
              <input 
                type="email" 
                value={newCustomerForm.repEmail || ''} 
                onChange={e => setNewCustomerForm({...newCustomerForm, repEmail: e.target.value})} 
                placeholder="tax@company.com"
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
              />
            </div>

            {/* 마감 및 결제조건 (3종) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">청구 마감일 (일)</label>
                <input 
                  type="number" 
                  value={newCustomerForm.defaultBillingDay ?? ''} 
                  onChange={e => setNewCustomerForm({...newCustomerForm, defaultBillingDay: parseInt(e.target.value, 10) || 30})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                  placeholder="30"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">명세서 마감일 (일)</label>
                <input 
                  type="number" 
                  value={newCustomerForm.defaultStatementClosingDay ?? ''} 
                  onChange={e => setNewCustomerForm({...newCustomerForm, defaultStatementClosingDay: parseInt(e.target.value, 10) || 25})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                  placeholder="25"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">약정 결제일 (일)</label>
                <input 
                  type="number" 
                  value={newCustomerForm.paymentDueDay ?? ''} 
                  onChange={e => setNewCustomerForm({...newCustomerForm, paymentDueDay: parseInt(e.target.value, 10) || 25})} 
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500" 
                  placeholder="25"
                />
              </div>
            </div>

            {/* 업태 & 종목 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">업태</label>
                <input 
                  type="text" 
                  value={newCustomerForm.bizType || ''} 
                  onChange={e => setNewCustomerForm({...newCustomerForm, bizType: e.target.value})} 
                  placeholder="건설, 임대"
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">종목</label>
                <input 
                  type="text" 
                  value={newCustomerForm.bizItem || ''} 
                  onChange={e => setNewCustomerForm({...newCustomerForm, bizItem: e.target.value})} 
                  placeholder="고소작업대 임대"
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
                />
              </div>
            </div>

            {/* 사업장 주소 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">사업장 본사 주소</label>
              <input 
                type="text" 
                value={newCustomerForm.address || ''} 
                onChange={e => setNewCustomerForm({...newCustomerForm, address: e.target.value})} 
                placeholder="도로명 주소 입력"
                className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500" 
              />
            </div>

            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-800">
              <button 
                type="button" 
                onClick={() => setIsCreatingCustomer(false)} 
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-slate-300 hover:bg-slate-700 active:scale-95"
              >
                취소
              </button>
              <button 
                type="submit" 
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-lg active:scale-95"
              >
                등록 완료
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 📄 사업자등록증 AI 신규 등록 및 정보 보완 모달 */}
      <BusinessLicenseModal
        isOpen={showBizLicenseModal}
        onClose={() => setShowBizLicenseModal(false)}
        targetCustomerId={targetBizLicenseCustId}
        onSuccess={() => refreshAllData()}
      />

      {/* 📂 사업자등록증 폴더 일괄 등록 모달 */}
      <BatchBusinessLicenseModal
        isOpen={showBatchLicenseModal}
        onClose={() => setShowBatchLicenseModal(false)}
        initialTargetType="CUSTOMER"
      />
    </div>
  );
};
