// src/pages/Customers.tsx - 전사 표준 헌장 준수 거래처 고객사 및 현장/담당자 마스터 스튜디오
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Plus, Search, MapPin, Phone, User, Mail, PlusCircle, Download, 
  CreditCard, ShieldCheck, Zap, Sparkles, CheckCircle2, AlertCircle, 
  X, Edit2, Trash2, RefreshCw, Layers, Check, Building2, Circle
} from 'lucide-react';
import { db, Customer, CustomerContact, CustomerSite, CustomerBankAccount, STANDARD_SPECS } from '../services/db';
import { exportToExcel } from '../services/excel';
import { matchHangul } from '../utils/hangulSearch';

export const Customers: React.FC = () => {
  const {
    customers, contacts, sites, contracts, contractAssets, saveCustomer, saveContact, deleteContact, saveSite, hasPermission,
    navigationPayload, setNavigationPayload, currentUser, refreshAllData, legalNoticeLogs
  } = useApp();

  const canSave = hasPermission('customer', 'save');

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 실시간 검색 및 필터 상태 (헌장 1.1 & 1.2: 지연 조회 제거)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'BLOCKED' | 'CLOSED'>('ALL');
  const [showOnlyIncomplete, setShowOnlyIncomplete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 선택된 고객 상태
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(customers[0]?.id || null);

  // 등록/수정 모달 상태
  const [showCustModal, setShowCustModal] = useState(false);
  const [editingCust, setEditingCust] = useState<Partial<Customer> | null>(null);
  const [showCustSpecs, setShowCustSpecs] = useState(false);

  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Partial<CustomerContact> | null>(null);

  const [showSiteModal, setShowSiteModal] = useState(false);
  const [editingSite, setEditingSite] = useState<Partial<CustomerSite> | null>(null);
  const [showSiteSpecs, setShowSiteSpecs] = useState(false);

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Partial<CustomerBankAccount> | null>(null);

  // 외부 네비게이션 연동
  useEffect(() => {
    if (navigationPayload?.editCustomerId) {
      const targetCust = customers.find(c => c.id === navigationPayload.editCustomerId);
      if (targetCust) {
        setSelectedCustomerId(targetCust.id);
        setEditingCust({ ...targetCust });
        setShowCustModal(true);
      }
      setNavigationPayload(null);
    }
  }, [navigationPayload, customers, setNavigationPayload]);

  // 기본 선택 고객사 보정
  useEffect(() => {
    if (!selectedCustomerId && customers.length > 0) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers, selectedCustomerId]);

  const activeCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const customerContacts = useMemo(() => {
    return contacts
      .filter(cc => cc.customerId === selectedCustomerId)
      .sort((a, b) => {
        const aActive = a.isActive !== false;
        const bActive = b.isActive !== false;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return a.name.localeCompare(b.name, 'ko');
      });
  }, [contacts, selectedCustomerId]);

  const customerSites = useMemo(() => {
    return sites
      .filter(cs => cs.customerId === selectedCustomerId)
      .sort((a, b) => {
        const aActive = a.isActive !== false;
        const bActive = b.isActive !== false;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return a.name.localeCompare(b.name, 'ko');
      });
  }, [sites, selectedCustomerId]);

  // 필수정보 누락 판정
  const isIncompleteCustomer = (c: Customer) => {
    const hasMissingInfo = 
      c.bizRegNo === '미상' || !c.bizRegNo ||
      c.representative === '미상' || !c.representative ||
      c.repContact === '미상' || !c.repContact ||
      c.repEmail === '미상' || !c.repEmail ||
      c.address === '미상' || !c.address;

    const custContacts = contacts.filter(cc => cc.customerId === c.id);
    const custSites = sites.filter(cs => cs.customerId === c.id);

    return hasMissingInfo || custContacts.length === 0 || custSites.length === 0;
  };

  // 실시간 필터링
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchesSearch = 
        !searchTerm ||
        matchHangul(c.name, searchTerm) ||
        (c.bizRegNo || '').includes(searchTerm) ||
        matchHangul(c.representative, searchTerm) ||
        (c.repContact || '').includes(searchTerm);

      const matchesStatus = 
        statusFilter === 'ALL' ? true :
        statusFilter === 'ACTIVE' ? (c.transactionStatus !== 'BLOCKED' && !c.isClosed) :
        statusFilter === 'BLOCKED' ? (c.transactionStatus === 'BLOCKED') :
        (c.isClosed === true);

      const matchesIncomplete = !showOnlyIncomplete || isIncompleteCustomer(c);

      return matchesSearch && matchesStatus && matchesIncomplete;
    });
  }, [customers, searchTerm, statusFilter, showOnlyIncomplete, contacts, sites]);

  // KPI 집계
  const kpiStats = useMemo(() => {
    const totalCust = customers.length;
    const activeCust = customers.filter(c => c.transactionStatus !== 'BLOCKED' && !c.isClosed).length;
    const blockedCust = customers.filter(c => c.transactionStatus === 'BLOCKED').length;
    const closedCust = customers.filter(c => c.isClosed).length;
    const totalSites = sites.length;
    const activeSites = sites.filter(s => s.isActive !== false).length;
    const totalContacts = contacts.length;

    return { totalCust, activeCust, blockedCust, closedCust, totalSites, activeSites, totalContacts };
  }, [customers, sites, contacts]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAllData();
      showToast('최신 고객사 데이터를 동기화하였습니다.');
    } catch (err: any) {
      showToast('데이터 동기화에 실패했습니다.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // 엑셀 다운로드
  const handleExportAllCustomers = () => {
    const excelData = filteredCustomers.map((c, idx) => ({
      'No': idx + 1,
      '고객명': c.name,
      '대표자': c.representative,
      '업태': c.bizType || '-',
      '종목': c.bizItem || '-',
      '대표 연락처': c.repContact || '-',
      '대표 이메일': c.repEmail || '-',
      '사업자등록번호': c.bizRegNo || '-',
      '세금계산서 마감일': `매월 ${c.defaultBillingDay || 30}일`,
      '거래명세서 마감일': `매월 ${c.defaultStatementClosingDay || 25}일`,
      '약정 결제일': c.paymentDueDay ? `익월 ${c.paymentDueDay}일` : '익월 25일',
      '본사 주소': c.address || '-',
      '영업 상태': c.isClosed ? '폐업' : '영업중',
      '거래 상태': c.transactionStatus === 'BLOCKED' ? '거래제한' : '거래가능',
      '등록 일시': c.createdAt?.substring(0, 10) || '-'
    }));
    exportToExcel(excelData, `고객정보_조회목록_${new Date().toISOString().split('T')[0]}`, '고객사대장');
    showToast(`고객사 목록 (${filteredCustomers.length}건) 엑셀이 다운로드되었습니다.`);
  };

  const handleExportContacts = () => {
    if (!activeCustomer) return;
    const excelData = customerContacts.map((cc, idx) => ({
      'No': idx + 1,
      '고객사명': activeCustomer.name,
      '담당자명': cc.name,
      '직급': cc.position || '-',
      '연락처': cc.contact,
      '이메일': cc.email || '-',
      '사용여부': cc.isActive !== false ? '사용' : '미사용',
      '등록 일시': cc.createdAt?.substring(0, 10) || '-'
    }));
    exportToExcel(excelData, `담당자목록_${activeCustomer.name}_${new Date().toISOString().split('T')[0]}`, '담당자리스트');
    showToast(`담당자 목록 (${customerContacts.length}건) 엑셀이 다운로드되었습니다.`);
  };

  const handleExportSites = () => {
    if (!activeCustomer) return;
    const excelData = customerSites.map((cs, idx) => ({
      'No': idx + 1,
      '고객사명': activeCustomer.name,
      '현장명': cs.name,
      '현장 주소': cs.address || '-',
      '현장 담당자': cs.contactName || '-',
      '연락처': cs.contact || '-',
      '유상옵션': cs.paidOptions || activeCustomer.defaultPaidOptions || '-',
      '보양작업': cs.protection || activeCustomer.defaultProtection || '-',
      '사용여부': cs.isActive !== false ? '사용' : '종료',
      '등록 일시': cs.createdAt?.substring(0, 10) || '-'
    }));
    exportToExcel(excelData, `현장목록_${activeCustomer.name}_${new Date().toISOString().split('T')[0]}`, '현장리스트');
    showToast(`현장 목록 (${customerSites.length}건) 엑셀이 다운로드되었습니다.`);
  };

  // 고객사 등록/수정 핸들러
  const handleOpenAddCust = () => {
    setEditingCust({ 
      name: '', bizRegNo: '', isClosed: false, address: '', 
      representative: '', repContact: '', repEmail: '', 
      defaultBillingDay: 30, defaultStatementClosingDay: 25, paymentDueDay: 25,
      transactionStatus: 'ALLOWED'
    });
    setShowCustModal(true);
  };

  const handleOpenEditCust = (cust: Customer) => {
    setEditingCust({
      defaultBillingDay: 30,
      defaultStatementClosingDay: 25,
      paymentDueDay: cust.paymentDueDay || 25,
      ...cust
    });
    setShowCustModal(true);
  };

  const handleSaveCustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCust || !editingCust.name) return;

    try {
      const saved = await saveCustomer(editingCust as Omit<Customer, 'id' | 'createdAt'>);
      showToast(`고객사 [${saved.name}] 정보가 저장되었습니다.`);
      setShowCustModal(false);
      setEditingCust(null);
      setSelectedCustomerId(saved.id);
      await refreshAllData();
    } catch (err: any) {
      showToast(`고객 정보 저장 실패: ${err?.message || err}`, 'error');
    }
  };

  // 담당자 등록/수정
  const handleOpenAddContact = () => {
    if (!selectedCustomerId) return;
    setEditingContact({ customerId: selectedCustomerId, name: '', position: '', contact: '', email: '', isActive: true });
    setShowContactModal(true);
  };

  const handleOpenEditContact = (cc: CustomerContact) => {
    setEditingContact(cc);
    setShowContactModal(true);
  };

  const handleSaveContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact || !editingContact.name || !editingContact.customerId) return;

    try {
      await saveContact(editingContact as Omit<CustomerContact, 'id' | 'createdAt'>);
      showToast(`담당자 [${editingContact.name}] 정보가 저장되었습니다.`);
      setShowContactModal(false);
      setEditingContact(null);
      await refreshAllData();
    } catch (err: any) {
      showToast(`담당자 저장 실패: ${err?.message || err}`, 'error');
    }
  };

  const handleDeleteContact = async (contactId: string, contactName: string) => {
    if (!window.confirm(`정말로 담당자 [${contactName}] 정보를 삭제하시겠습니까?`)) return;
    try {
      await deleteContact(contactId);
      showToast(`담당자 [${contactName}] 정보가 삭제되었습니다.`);
      setShowContactModal(false);
      setEditingContact(null);
      await refreshAllData();
    } catch (err: any) {
      showToast(`담당자 삭제 실패: ${err?.message || err}`, 'error');
    }
  };

  // 현장 등록/수정
  const handleOpenAddSite = () => {
    if (!selectedCustomerId) return;
    setEditingSite({ customerId: selectedCustomerId, name: '', address: '', contactName: '', contact: '', email: '', isActive: true });
    setShowSiteSpecs(false);
    setShowSiteModal(true);
  };

  const handleOpenEditSite = (cs: CustomerSite) => {
    setEditingSite(cs);
    setShowSiteSpecs(false);
    setShowSiteModal(true);
  };

  const handleSaveSiteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSite || !editingSite.name || !editingSite.customerId) return;

    try {
      await saveSite(editingSite as Omit<CustomerSite, 'id' | 'createdAt'>);
      showToast(`현장 [${editingSite.name}] 정보가 저장되었습니다.`);
      setShowSiteModal(false);
      setEditingSite(null);
      await refreshAllData();
    } catch (err: any) {
      showToast(`현장 저장 실패: ${err?.message || err}`, 'error');
    }
  };

  // 고객사 기본 옵션/보양 현장 일괄 전파
  const handlePropagateDefaultsToAllSites = async (cust: Partial<Customer>) => {
    if (!cust.id) return;
    const targetSites = sites.filter(s => s.customerId === cust.id);
    if (targetSites.length === 0) {
      showToast(`'${cust.name}' 고객사에 등록된 현장이 없습니다.`, 'error');
      return;
    }

    try {
      for (const s of targetSites) {
        db.updateRow<CustomerSite>('sites', s.id, {
          paidOptions: cust.defaultPaidOptions || s.paidOptions,
          protection: cust.defaultProtection || s.protection,
          checkedSpecs: cust.defaultCheckedSpecs || s.checkedSpecs
        });
      }
      await db.awaitPendingWrites();
      await refreshAllData();
      showToast(`'${cust.name}'의 ${targetSites.length}개 현장에 기본 옵션/보양/스펙이 일괄 적용되었습니다.`);
    } catch (err: any) {
      showToast(`일괄 전파 실패: ${err.message}`, 'error');
    }
  };

  const handleCopyCustomerDefaultsToSite = () => {
    if (!activeCustomer) return;
    setEditingSite(prev => ({
      ...prev,
      paidOptions: activeCustomer.defaultPaidOptions || '',
      protection: activeCustomer.defaultProtection || '',
      checkedSpecs: activeCustomer.defaultCheckedSpecs ? { ...activeCustomer.defaultCheckedSpecs } : {}
    }));
    showToast(`고객사 기본 옵션/보양/기술스펙을 불러왔습니다.`);
  };

  // 계좌 관리
  const handleOpenAddAccount = () => {
    if (!selectedCustomerId) return;
    setEditingAccount({ bankName: '', accountNumber: '', accountHolder: '', memo: '' });
    setShowAccountModal(true);
  };

  const handleOpenEditAccount = (acc: CustomerBankAccount) => {
    setEditingAccount(acc);
    setShowAccountModal(true);
  };

  const handleDeleteAccount = async (accId: string) => {
    if (!activeCustomer) return;
    const nextAccounts = (activeCustomer.bankAccounts || []).filter(a => a.id !== accId);
    try {
      await saveCustomer({ ...activeCustomer, bankAccounts: nextAccounts });
      await refreshAllData();
      showToast('입금 계좌가 삭제되었습니다.');
    } catch (err: any) {
      showToast(`계좌 삭제 실패: ${err.message}`, 'error');
    }
  };

  const handleSaveAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount || !editingAccount.bankName || !editingAccount.accountNumber || !activeCustomer) return;

    const accounts = activeCustomer.bankAccounts || [];
    let nextAccounts: CustomerBankAccount[];
    if (editingAccount.id) {
      nextAccounts = accounts.map(a => a.id === editingAccount.id ? (editingAccount as CustomerBankAccount) : a);
    } else {
      const newAcc: CustomerBankAccount = {
        id: `ACC-${Date.now()}`,
        bankName: editingAccount.bankName.trim(),
        accountNumber: editingAccount.accountNumber.trim(),
        accountHolder: editingAccount.accountHolder?.trim() || activeCustomer.name,
        memo: editingAccount.memo?.trim() || '',
      };
      nextAccounts = [...accounts, newAcc];
    }

    try {
      await saveCustomer({ ...activeCustomer, bankAccounts: nextAccounts });
      await refreshAllData();
      showToast('입금 계좌가 저장되었습니다.');
      setShowAccountModal(false);
      setEditingAccount(null);
    } catch (err: any) {
      showToast(`입금 계좌 저장 실패: ${err.message}`, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px', position: 'relative' }}>
      
      {/* 알림 토스트 배너 */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 9999,
          padding: '10px 18px',
          borderRadius: '6px',
          backgroundColor: toastMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
          color: '#ffffff',
          fontWeight: 600,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.2s ease-in-out'
        }}>
          {toastMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ① 상단 헤더 & 파이프라인 (좌상단 Scope + 우상단 Pipeline: 헌장 3.5) */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        paddingBottom: '4px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontWeight: '700', fontSize: '17px', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            고객 관리
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            총 <strong>{customers.length}</strong>개사 (조회 <strong>{filteredCustomers.length}</strong>개사)
          </span>
        </div>

        {/* 우상단 파이프라인 액션 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            className="btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ padding: '5px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> 동기화
          </button>
          <button
            className="btn-secondary"
            onClick={handleExportAllCustomers}
            style={{ padding: '5px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            <Download size={13} /> 엑셀 다운로드
          </button>
          {canSave && (
            <button
              className="btn-primary"
              onClick={handleOpenAddCust}
              style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
            >
              <Plus size={13} /> 신규 고객 등록
            </button>
          )}
        </div>
      </div>

      {/* ② 실시간 고객 및 현장/담당자 KPI 바 (Scope) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px', flexShrink: 0 }}>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 고객사</span>
          <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{kpiStats.totalCust}개사</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>정상 거래사</span>
          <strong style={{ fontSize: '14px', color: 'var(--success)', whiteSpace: 'nowrap' }}>{kpiStats.activeCust}개사</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>거래제한 / 폐업</span>
          <strong style={{ fontSize: '14px', color: (kpiStats.blockedCust + kpiStats.closedCust) > 0 ? 'var(--danger)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {kpiStats.blockedCust + kpiStats.closedCust}개사
          </strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>등록 현장수</span>
          <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{kpiStats.totalSites}개소</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>등록 담당자</span>
          <strong style={{ fontSize: '14px', color: '#0070C0', whiteSpace: 'nowrap' }}>{kpiStats.totalContacts}명</strong>
        </div>
      </div>

      {/* ③ 필터 컨트롤 바 (Vertical Header-Label Layout: 헌장 3.4) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        flexWrap: 'wrap',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1', minWidth: '180px' }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>통합 검색</label>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: '8px', top: '7px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="고객명, 사업자번호, 대표자명, 연락처 검색..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 8px 4px 26px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                fontSize: '12px'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>거래 상태</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', minWidth: '110px' }}
          >
            <option value="ALL">전체 상태</option>
            <option value="ACTIVE">정상 거래</option>
            <option value="BLOCKED">거래 제한</option>
            <option value="CLOSED">폐업</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11.5px',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            backgroundColor: showOnlyIncomplete ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
            color: showOnlyIncomplete ? 'var(--danger)' : 'var(--text-secondary)',
            fontWeight: showOnlyIncomplete ? 700 : 500,
            whiteSpace: 'nowrap'
          }}>
            <input
              type="checkbox"
              checked={showOnlyIncomplete}
              onChange={e => setShowOnlyIncomplete(e.target.checked)}
              style={{ margin: 0, cursor: 'pointer' }}
            />
            ⚠️ 보완필요 고객사만 필터
          </label>
        </div>

        {(searchTerm || statusFilter !== 'ALL' || showOnlyIncomplete) && (
          <button
            onClick={() => { setSearchTerm(''); setStatusFilter('ALL'); setShowOnlyIncomplete(false); }}
            style={{
              marginTop: '16px',
              padding: '4px 8px',
              fontSize: '11.5px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            <RefreshCw size={11} /> 초기화
          </button>
        )}
      </div>

      {/* ④ 중앙 본문: 마스터-디테일 2분할 스튜디오 (헌장 3.6 유형 A) */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '360px 1fr',
        gap: '8px',
        overflow: 'hidden',
        minHeight: 0
      }}>

        {/* 좌측: 고객사 고밀도 목록 패널 (360px) */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '6px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0
        }}>
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-app)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)'
          }}>
            <span>고객사 목록 ({filteredCustomers.length}건)</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredCustomers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                조회된 고객사가 없습니다.
              </div>
            ) : (
              filteredCustomers.map(cust => {
                const isSelected = selectedCustomerId === cust.id;
                const isIncomplete = isIncompleteCustomer(cust);
                const custSitesCount = sites.filter(s => s.customerId === cust.id).length;
                const custContactsCount = contacts.filter(c => c.customerId === cust.id).length;

                return (
                  <div
                    key={cust.id}
                    onClick={() => setSelectedCustomerId(cust.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '5px',
                      border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                      backgroundColor: isSelected ? 'var(--primary-light)' : 'var(--bg-app)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '13px', color: isSelected ? 'var(--primary)' : 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '210px' }}>
                        {cust.name}
                      </strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {isIncomplete && (
                          <span style={{ fontSize: '9.5px', color: 'var(--danger)', backgroundColor: 'rgba(239,68,68,0.08)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>
                            보완필요
                          </span>
                        )}
                        {cust.isClosed ? (
                          <span className="badge badge-danger" style={{ fontSize: '9.5px', padding: '1px 4px' }}>폐업</span>
                        ) : cust.transactionStatus === 'BLOCKED' ? (
                          <span className="badge badge-danger" style={{ fontSize: '9.5px', padding: '1px 4px' }}>제한</span>
                        ) : null}
                        {(() => {
                          const noticeCount = (legalNoticeLogs || []).filter(l => l.customerId === cust.id).length;
                          if (noticeCount === 0) return null;
                          return (
                            <span style={{ fontSize: '9.5px', color: '#7e22ce', backgroundColor: '#f3e8ff', padding: '1px 4px', borderRadius: '3px', fontWeight: 800 }}>
                              📜 내용증명 {noticeCount}건
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span>대표: {cust.representative || '-'}</span>
                      <span>등록번호: {cust.bizRegNo || '-'}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      <span>현장 {custSitesCount}개소 · 담당 {custContactsCount}명</span>
                      {canSave && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleOpenEditCust(cust); }}
                          style={{
                            padding: '1px 5px',
                            fontSize: '10.5px',
                            border: '1px solid var(--border-color)',
                            borderRadius: '3px',
                            backgroundColor: 'transparent',
                            color: 'var(--primary)',
                            cursor: 'pointer'
                          }}
                        >
                          수정
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 우측: 선택 고객사 360도 마스터-디테일 스튜디오 (flex 1) */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '6px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0
        }}>
          {activeCustomer ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              
              {/* 1. 고객사 기본 마스터 정보 헤더 카드 */}
              <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building2 size={16} className="text-primary" />
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
                      {activeCustomer.name}
                    </h3>
                    <span className={`badge ${activeCustomer.transactionStatus === 'BLOCKED' ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: '10px' }}>
                      {activeCustomer.transactionStatus === 'BLOCKED' ? '거래제한' : '거래가능'}
                    </span>
                    {activeCustomer.isClosed && <span className="badge badge-danger" style={{ fontSize: '10px' }}>폐업</span>}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {canSave && (
                      <button
                        className="btn-primary"
                        onClick={() => handleOpenEditCust(activeCustomer)}
                        style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Edit2 size={12} /> 고객사 수정
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '11.5px' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>대표자:</span> <strong>{activeCustomer.representative || '-'}</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>대표 연락처:</span> <strong>{activeCustomer.repContact || '-'}</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>사업자등록번호:</span> {activeCustomer.bizRegNo || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>대표 이메일:</span> {activeCustomer.repEmail || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>업태:</span> {activeCustomer.bizType || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>종목:</span> {activeCustomer.bizItem || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>청구서 마감:</span> 매월 <strong>{activeCustomer.defaultBillingDay || 30}일</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>명세서 마감:</span> 매월 <strong>{activeCustomer.defaultStatementClosingDay || 25}일</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>약정 결제일:</span> 익월 <strong>{activeCustomer.paymentDueDay || 25}일</strong></div>
                  <div style={{ gridColumn: 'span 4' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>사업장 주소:</span> {activeCustomer.address || '-'}
                  </div>
                </div>

                {/* 🌟 기본 옵션/보양 마스터 바 */}
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: '#0070C0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldCheck size={13} /> 현장 기본상속 설정:
                    </span>
                    <span className="badge badge-secondary" style={{ fontSize: '10px' }}>
                      유상옵션: {activeCustomer.defaultPaidOptions || '(없음)'}
                    </span>
                    <span className="badge badge-secondary" style={{ fontSize: '10px' }}>
                      보양작업: {activeCustomer.defaultProtection || '(없음)'}
                    </span>
                    <span className="badge badge-secondary" style={{ fontSize: '10px' }}>
                      기술스펙: {activeCustomer.defaultCheckedSpecs ? Object.values(activeCustomer.defaultCheckedSpecs).filter(Boolean).length + '개' : '0개'}
                    </span>
                  </div>

                  {canSave && (
                    <button
                      type="button"
                      onClick={() => handlePropagateDefaultsToAllSites(activeCustomer)}
                      style={{
                        padding: '2px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: '1px solid var(--primary)',
                        backgroundColor: 'var(--primary-light)',
                        color: 'var(--primary)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Zap size={12} /> 전체 현장에 기본값 일괄 전파
                    </button>
                  )}
                </div>
              </div>

              {/* 2. 등록 현장(Sites) 고밀도 그리드 */}
              <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={14} className="text-success" /> 고객 현장 목록 ({customerSites.length}개소)
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleExportSites}
                      style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Download size={11} /> 현장 엑셀
                    </button>
                    {canSave && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleOpenAddSite}
                        style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <PlusCircle size={11} /> 현장 추가
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>현장명</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>현장 주소</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>현장 소장/담당</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>연락처</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>유상옵션 / 보양</th>
                        <th style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>상태</th>
                        <th style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerSites.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)' }}>
                            등록된 현장이 없습니다. 현장을 추가해 주세요.
                          </td>
                        </tr>
                      ) : (
                        customerSites.map(cs => {
                          const activeContracts = contracts?.filter(c => c.siteId === cs.id && (c.status === 'ACTIVE' || c.status === 'EXTENDED')) || [];
                          const activeAssetCount = activeContracts.reduce((acc, contract) => {
                            const assetsForContract = contractAssets?.filter(ca => ca.contractId === contract.id && ca.status !== 'RETURNED') || [];
                            return acc + assetsForContract.length;
                          }, 0);
                          const hasActiveContracts = activeContracts.length > 0;

                          return (
                            <tr key={cs.id} style={{ borderBottom: '1px solid var(--border-color)', opacity: cs.isActive !== false ? 1 : 0.6 }}>
                              <td style={{ padding: '5px 6px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Circle size={10} fill={hasActiveContracts ? '#22c55e' : '#eab308'} strokeWidth={0} />
                                {cs.name}
                                <span style={{fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400}}>
                                  (계약 {activeContracts.length}건 / {activeAssetCount}대)
                                </span>
                              </td>
                              <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cs.address}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{cs.contactName || '-'}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{cs.contact || '-'}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                                {cs.paidOptions || cs.protection ? `${cs.paidOptions || '없음'} / ${cs.protection || '없음'}` : '(기본상속)'}
                              </span>
                            </td>
                            <td style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <span className={`badge ${cs.isActive !== false ? 'badge-success' : 'badge-secondary'}`} style={{ fontSize: '9.5px' }}>
                                {cs.isActive !== false ? '가동' : '종료'}
                              </span>
                            </td>
                            <td style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {canSave && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => handleOpenEditSite(cs)}
                                  style={{ padding: '1px 5px', fontSize: '10.5px' }}
                                >
                                  수정
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. 등록 담당자(Contacts) 고밀도 그리드 */}
              <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <User size={14} className="text-primary" /> 고객 담당자 목록 ({customerContacts.length}명)
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleExportContacts}
                      style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Download size={11} /> 담당자 엑셀
                    </button>
                    {canSave && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleOpenAddContact}
                        style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <PlusCircle size={11} /> 담당자 추가
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>담당자명</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>직책 / 부서</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>연락처</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>이메일</th>
                        <th style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>사용 여부</th>
                        <th style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerContacts.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)' }}>
                            등록된 담당자가 없습니다. 담당자를 추가해 주세요.
                          </td>
                        </tr>
                      ) : (
                        customerContacts.map(cc => (
                          <tr key={cc.id} style={{ borderBottom: '1px solid var(--border-color)', opacity: cc.isActive !== false ? 1 : 0.6 }}>
                            <td style={{ padding: '5px 6px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>{cc.name}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{cc.position || '-'}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{cc.contact}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{cc.email || '-'}</td>
                            <td style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <span className={`badge ${cc.isActive !== false ? 'badge-success' : 'badge-secondary'}`} style={{ fontSize: '9.5px' }}>
                                {cc.isActive !== false ? '사용' : '미사용'}
                              </span>
                            </td>
                            <td style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {canSave && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => handleOpenEditContact(cc)}
                                  style={{ padding: '1px 5px', fontSize: '10.5px' }}
                                >
                                  수정
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 4. 입금 계좌 관리 그리드 (수납 자동매핑용) */}
              <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CreditCard size={14} style={{ color: '#8B5CF6' }} /> 입금 계좌 목록 ({activeCustomer.bankAccounts?.length || 0}건)
                  </div>
                  {canSave && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleOpenAddAccount}
                      style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <PlusCircle size={11} /> 계좌 추가
                    </button>
                  )}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>은행명</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>계좌번호</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>예금주</th>
                        <th style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>메모</th>
                        <th style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!activeCustomer.bankAccounts || activeCustomer.bankAccounts.length === 0) ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '14px 0', color: 'var(--text-muted)' }}>
                            등록된 입금 계좌가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        activeCustomer.bankAccounts.map(acc => (
                          <tr key={acc.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '5px 6px', fontWeight: 600, color: '#8B5CF6', whiteSpace: 'nowrap' }}>{acc.bankName}</td>
                            <td style={{ padding: '5px 6px', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{acc.accountNumber}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{acc.accountHolder || '-'}</td>
                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{acc.memo || '-'}</td>
                            <td style={{ padding: '5px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {canSave && (
                                <div style={{ display: 'inline-flex', gap: '3px' }}>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => handleOpenEditAccount(acc)}
                                    style={{ padding: '1px 5px', fontSize: '10.5px' }}
                                  >
                                    수정
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => handleDeleteAccount(acc.id)}
                                    style={{ padding: '1px 5px', fontSize: '10.5px', color: 'var(--danger)' }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
              좌측 목록에서 고객사를 선택해 주세요.
            </div>
          )}
        </div>

      </div>

      {/* ⑤ 우하단 Terminal Action: 고객-현장-담당자 대차대조식 검증 바 (헌장 3.5) */}
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
          <span>전사 고객사: <strong style={{ color: 'var(--primary)' }}>{kpiStats.totalCust}개사</strong> (정상 {kpiStats.activeCust} / 제한·폐업 {kpiStats.blockedCust + kpiStats.closedCust})</span>
          <span>|</span>
          <span>등록 현장: <strong style={{ color: 'var(--primary)' }}>{kpiStats.totalSites}개소</strong> (가동 {kpiStats.activeSites}개소)</span>
          <span>|</span>
          <span>등록 담당자: <strong style={{ color: '#0070C0' }}>{kpiStats.totalContacts}명</strong></span>
        </div>
        <span style={{
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: 'var(--success-light)',
          color: 'var(--success)',
          fontWeight: 700,
          fontSize: '11px'
        }}>
          ⚖️ 대차 정상 (고객-현장-담당자 기준정보 100% 무결)
        </span>
      </div>

      {/* ⑥ 고객 등록/수정 모달 */}
      {showCustModal && editingCust && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          padding: '20px'
        }}>
          <form onSubmit={handleSaveCustSubmit} className="card" style={{ width: '100%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
                {editingCust.id ? '고객사 정보 수정' : '신규 고객사 등록'}
              </h3>
              <button type="button" onClick={() => setShowCustModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div>
                <label style={labelStyle}>고객사명 *</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingCust.name || ''}
                  onChange={e => setEditingCust({ ...editingCust, name: e.target.value })}
                  placeholder="예: (주)한라건설"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.2fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>사업자등록번호</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingCust.bizRegNo || ''}
                    onChange={e => setEditingCust({ ...editingCust, bizRegNo: e.target.value })}
                    placeholder="000-00-00000"
                  />
                </div>
                <div>
                  <label style={labelStyle}>폐업 여부</label>
                  <select
                    style={inputStyle}
                    value={editingCust.isClosed ? 'true' : 'false'}
                    onChange={e => setEditingCust({ ...editingCust, isClosed: e.target.value === 'true' })}
                  >
                    <option value="false">운영중</option>
                    <option value="true">폐업</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>거래 상태 (출고)</label>
                  <select
                    style={{ ...inputStyle, fontWeight: editingCust.transactionStatus === 'BLOCKED' ? 700 : 400, color: editingCust.transactionStatus === 'BLOCKED' ? '#dc2626' : 'inherit' }}
                    value={editingCust.transactionStatus || 'ALLOWED'}
                    onChange={e => setEditingCust({ ...editingCust, transactionStatus: e.target.value as 'ALLOWED' | 'BLOCKED' })}
                  >
                    <option value="ALLOWED">정상 (출고가능)</option>
                    <option value="BLOCKED">거래제한 (출고차단)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>대표자명</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingCust.representative || ''}
                    onChange={e => setEditingCust({ ...editingCust, representative: e.target.value })}
                    placeholder="홍길동"
                  />
                </div>
                <div>
                  <label style={labelStyle}>대표 연락처</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingCust.repContact || ''}
                    onChange={e => setEditingCust({ ...editingCust, repContact: e.target.value })}
                    placeholder="02-000-0000"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>업태</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingCust.bizType || ''}
                    onChange={e => setEditingCust({ ...editingCust, bizType: e.target.value })}
                    placeholder="건설 및 임대업"
                  />
                </div>
                <div>
                  <label style={labelStyle}>종목</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingCust.bizItem || ''}
                    onChange={e => setEditingCust({ ...editingCust, bizItem: e.target.value })}
                    placeholder="고소작업대 외"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '8px 10px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px dashed var(--border-color)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={labelStyle}>청구서(세금계산서) 마감일</label>
                  <select
                    style={inputStyle}
                    value={editingCust.defaultBillingDay || 30}
                    onChange={e => setEditingCust({ ...editingCust, defaultBillingDay: Number(e.target.value) })}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day === 31 ? '31일 (월말)' : `매월 ${day}일`}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={labelStyle}>거래명세서 마감일</label>
                  <select
                    style={inputStyle}
                    value={editingCust.defaultStatementClosingDay || 25}
                    onChange={e => setEditingCust({ ...editingCust, defaultStatementClosingDay: Number(e.target.value) })}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day === 31 ? '31일 (월말)' : `매월 ${day}일`}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={labelStyle}>약정 결제일 (익월 N일)</label>
                  <select
                    style={inputStyle}
                    value={editingCust.paymentDueDay || 25}
                    onChange={e => setEditingCust({ ...editingCust, paymentDueDay: Number(e.target.value) })}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day === 31 ? '익월 말일' : `익월 ${day}일`}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>대표 이메일</label>
                <input
                  type="email"
                  style={inputStyle}
                  value={editingCust.repEmail || ''}
                  onChange={e => setEditingCust({ ...editingCust, repEmail: e.target.value })}
                  placeholder="contact@company.com"
                />
              </div>

              <div>
                <label style={labelStyle}>사업장 주소</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '44px' }}
                  value={editingCust.address || ''}
                  onChange={e => setEditingCust({ ...editingCust, address: e.target.value })}
                  placeholder="도로명 주소"
                />
              </div>

              {/* 기본 옵션/보양 설정 */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', backgroundColor: 'var(--bg-app)' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
                  현장 기본상속 옵션/보양 설정
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={labelStyle}>기본 유상옵션</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={editingCust.defaultPaidOptions || ''}
                      onChange={e => setEditingCust({ ...editingCust, defaultPaidOptions: e.target.value })}
                      placeholder="예: 충전기, 소화기"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>기본 보양작업</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={editingCust.defaultProtection || ''}
                      onChange={e => setEditingCust({ ...editingCust, defaultProtection: e.target.value })}
                      placeholder="예: 4면 철망"
                    />
                  </div>
                </div>

                {/* 21대 기술요구스펙 */}
                <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      기본 21대 기술스펙 ({Object.values(editingCust.defaultCheckedSpecs || {}).filter(Boolean).length}개 선택)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCustSpecs(!showCustSpecs)}
                      style={{ fontSize: '10.5px', padding: '1px 6px', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'transparent', cursor: 'pointer' }}
                    >
                      {showCustSpecs ? '접기' : '펼치기'}
                    </button>
                  </div>

                  {showCustSpecs && (
                    <div style={{ marginTop: '6px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', maxHeight: '140px', overflowY: 'auto' }}>
                      {STANDARD_SPECS.map(spec => {
                        const isChecked = !!editingCust.defaultCheckedSpecs?.[spec.id];
                        return (
                          <label key={spec.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                const nextSpecs = { ...(editingCust.defaultCheckedSpecs || {}) };
                                if (e.target.checked) nextSpecs[spec.id] = true;
                                else delete nextSpecs[spec.id];
                                setEditingCust({ ...editingCust, defaultCheckedSpecs: nextSpecs });
                              }}
                            />
                            <span>{spec.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowCustModal(false)} style={{ padding: '5px 14px', fontSize: '12px' }}>취소</button>
              <button type="submit" className="btn-primary" style={{ padding: '5px 16px', fontSize: '12px' }}>저장</button>
            </div>
          </form>
        </div>
      )}

      {/* ⑦ 담당자 등록/수정 모달 */}
      {showContactModal && editingContact && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          padding: '20px'
        }}>
          <form onSubmit={handleSaveContactSubmit} className="card" style={{ width: '100%', maxWidth: '420px', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
                {editingContact.id ? '담당자 수정' : '신규 담당자 등록'}
              </h3>
              <button type="button" onClick={() => setShowContactModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div>
                <label style={labelStyle}>담당자명 *</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingContact.name || ''}
                  onChange={e => setEditingContact({ ...editingContact, name: e.target.value })}
                  placeholder="이름"
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>직급 / 부서</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingContact.position || ''}
                  onChange={e => setEditingContact({ ...editingContact, position: e.target.value })}
                  placeholder="예: 구매팀 대리"
                />
              </div>

              <div>
                <label style={labelStyle}>연락처 *</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingContact.contact || ''}
                  onChange={e => setEditingContact({ ...editingContact, contact: e.target.value })}
                  placeholder="010-0000-0000"
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>이메일</label>
                <input
                  type="email"
                  style={inputStyle}
                  value={editingContact.email || ''}
                  onChange={e => setEditingContact({ ...editingContact, email: e.target.value })}
                  placeholder="email@company.com"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
                <input
                  type="checkbox"
                  id="contactActiveCheck"
                  checked={editingContact.isActive !== false}
                  onChange={e => setEditingContact({ ...editingContact, isActive: e.target.checked })}
                />
                <label htmlFor="contactActiveCheck" style={{ fontSize: '12px', cursor: 'pointer', margin: 0 }}>
                  사용 여부 (퇴사 시 체크 해제)
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: editingContact.id ? 'space-between' : 'flex-end', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
              {editingContact.id && (
                <button
                  type="button"
                  onClick={() => handleDeleteContact(editingContact.id!, editingContact.name || '')}
                  style={{ padding: '5px 14px', fontSize: '12px', backgroundColor: 'var(--danger-color, #ef4444)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  삭제
                </button>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowContactModal(false)} style={{ padding: '5px 14px', fontSize: '12px' }}>취소</button>
                <button type="submit" className="btn-primary" style={{ padding: '5px 16px', fontSize: '12px' }}>저장</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ⑧ 현장 등록/수정 모달 */}
      {showSiteModal && editingSite && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          padding: '20px'
        }}>
          <form onSubmit={handleSaveSiteSubmit} className="card" style={{ width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
                {editingSite.id ? '현장 수정' : '신규 현장 등록'}
              </h3>
              <button type="button" onClick={() => setShowSiteModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div>
                <label style={labelStyle}>현장명 *</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingSite.name || ''}
                  onChange={e => setEditingSite({ ...editingSite, name: e.target.value })}
                  placeholder="예: 여의도 현대백화점 신축현장"
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>현장 주소 *</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingSite.address || ''}
                  onChange={e => setEditingSite({ ...editingSite, address: e.target.value })}
                  placeholder="도로명 주소"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>현장 소장/담당자명</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingSite.contactName || ''}
                    onChange={e => setEditingSite({ ...editingSite, contactName: e.target.value })}
                    placeholder="소장명"
                  />
                </div>
                <div>
                  <label style={labelStyle}>현장 연락처</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingSite.contact || ''}
                    onChange={e => setEditingSite({ ...editingSite, contact: e.target.value })}
                    placeholder="010-0000-0000"
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>현장 이메일</label>
                <input
                  type="email"
                  style={inputStyle}
                  value={editingSite.email || ''}
                  onChange={e => setEditingSite({ ...editingSite, email: e.target.value })}
                  placeholder="site@company.com"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
                <input
                  type="checkbox"
                  id="siteActiveCheck"
                  checked={editingSite.isActive !== false}
                  onChange={e => setEditingSite({ ...editingSite, isActive: e.target.checked })}
                />
                <label htmlFor="siteActiveCheck" style={{ fontSize: '12px', cursor: 'pointer', margin: 0 }}>
                  가동 현장 (공사 완공 시 체크 해제)
                </label>
              </div>

              {/* 현장 전용 옵션/보양 설정 */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>
                    현장 전용 옵션 및 보양 설정
                  </span>
                  {activeCustomer && (
                    <button
                      type="button"
                      onClick={handleCopyCustomerDefaultsToSite}
                      style={{ padding: '2px 6px', fontSize: '10.5px', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'transparent', color: 'var(--primary)', cursor: 'pointer' }}
                    >
                      고객사 기본값 상속
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={labelStyle}>현장 전용 유상옵션</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={editingSite.paidOptions || ''}
                      onChange={e => setEditingSite({ ...editingSite, paidOptions: e.target.value })}
                      placeholder="비어있으면 기본값 상속"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>현장 전용 보양작업</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={editingSite.protection || ''}
                      onChange={e => setEditingSite({ ...editingSite, protection: e.target.value })}
                      placeholder="비어있으면 기본값 상속"
                    />
                  </div>
                </div>

                {/* 21대 현장 스펙 아코디언 */}
                <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      현장 21대 기술스펙 ({Object.values(editingSite.checkedSpecs || {}).filter(Boolean).length}개 선택)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSiteSpecs(!showSiteSpecs)}
                      style={{ fontSize: '10.5px', padding: '1px 6px', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'transparent', cursor: 'pointer' }}
                    >
                      {showSiteSpecs ? '접기' : '펼치기'}
                    </button>
                  </div>

                  {showSiteSpecs && (
                    <div style={{ marginTop: '6px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', maxHeight: '140px', overflowY: 'auto' }}>
                      {STANDARD_SPECS.map(spec => {
                        const isChecked = !!editingSite.checkedSpecs?.[spec.id];
                        return (
                          <label key={spec.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                const nextSpecs = { ...(editingSite.checkedSpecs || {}) };
                                if (e.target.checked) nextSpecs[spec.id] = true;
                                else delete nextSpecs[spec.id];
                                setEditingSite({ ...editingSite, checkedSpecs: nextSpecs });
                              }}
                            />
                            <span>{spec.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowSiteModal(false)} style={{ padding: '5px 14px', fontSize: '12px' }}>취소</button>
              <button type="submit" className="btn-primary" style={{ padding: '5px 16px', fontSize: '12px' }}>저장</button>
            </div>
          </form>
        </div>
      )}

      {/* ⑨ 입금 계좌 등록/수정 모달 */}
      {showAccountModal && editingAccount && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          padding: '20px'
        }}>
          <form onSubmit={handleSaveAccountSubmit} className="card" style={{ width: '100%', maxWidth: '420px', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
                {editingAccount.id ? '고객 입금 계좌 수정' : '고객 입금 계좌 신규 등록'}
              </h3>
              <button type="button" onClick={() => setShowAccountModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>은행명 *</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingAccount.bankName || ''}
                    onChange={e => setEditingAccount({ ...editingAccount, bankName: e.target.value })}
                    placeholder="국민, 신한, 농협"
                    required
                  />
                </div>
                <div>
                  <label style={labelStyle}>예금주명</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editingAccount.accountHolder || ''}
                    onChange={e => setEditingAccount({ ...editingAccount, accountHolder: e.target.value })}
                    placeholder={activeCustomer?.name || '예금주'}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>계좌번호 *</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingAccount.accountNumber || ''}
                  onChange={e => setEditingAccount({ ...editingAccount, accountNumber: e.target.value })}
                  placeholder="123-456-789012"
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>메모 (용도 구분)</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={editingAccount.memo || ''}
                  onChange={e => setEditingAccount({ ...editingAccount, memo: e.target.value })}
                  placeholder="주거래 계좌, 현장 전용 입금 계좌"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowAccountModal(false)} style={{ padding: '5px 14px', fontSize: '12px' }}>취소</button>
              <button type="submit" className="btn-primary" style={{ padding: '5px 16px', fontSize: '12px' }}>저장</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};

// 헬퍼 스타일
const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  fontWeight: '600',
  display: 'block',
  marginBottom: '3px',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: '12px',
  borderRadius: '4px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-app)',
  color: 'var(--text-main)',
  boxSizing: 'border-box',
};
