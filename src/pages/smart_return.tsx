import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Zap, Clipboard, FileText, Check, Search, ArrowUpDown, Shield, AlertTriangle, Printer, RotateCcw, Copy, PhoneCall, Sparkles } from 'lucide-react';
import { SmartReturnData } from '../context/AppContext';
import { fetchMyDrafts, DraftDispatchOrder, discardDraft } from '../services/callUploadService';

export const SmartReturn: React.FC = () => {
  const { hasPermission, saveSmartReturn, contracts, customers, sites, contacts, deliveries, contractAssets, assets, repairs, vendors, currentUser, users, currentTenant } = useApp();
  const canSave = hasPermission('delivery', 'save');

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 전용 로컬 프린터 드라이버 스토리지 키
  const RETURN_PRINTER_STORAGE_KEY = 'dedicated_printer_smart_return';
  const [printers, setPrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(() => {
    return localStorage.getItem(RETURN_PRINTER_STORAGE_KEY) || '';
  });
  const [isAgentPrinting, setIsAgentPrinting] = useState<boolean>(false);

  useEffect(() => {
    const fetchPrinters = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5175/api/printers', { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        if (data.success && Array.isArray(data.printers)) {
          setPrinters(data.printers);
          const saved = localStorage.getItem(RETURN_PRINTER_STORAGE_KEY);
          if (!saved || !data.printers.includes(saved)) {
            const defaultP = data.defaultPrinter || data.printers[0] || 'Apeos C2060';
            setSelectedPrinter(defaultP);
            if (defaultP) localStorage.setItem(RETURN_PRINTER_STORAGE_KEY, defaultP);
          }
        }
      } catch (e) {
        // 백그라운드 인쇄 에이전트 미구동 시 조용히 무시 (웹 브라우저 인쇄 지원)
      }
    };
    fetchPrinters();
  }, []);

  const handlePrinterChange = (printerName: string) => {
    setSelectedPrinter(printerName);
    localStorage.setItem(RETURN_PRINTER_STORAGE_KEY, printerName);
  };

  // 출고 시 장착 옵션 회수 상속 검수 마스터
  const RETURN_CHECK_SPECS = [
    { id: 'spec1', label: '철망 / 함석 설치 부속품 (판넬/볼트)', keywords: ['철망', '함석', '사면철망', '1면', '2면', '3면', '4면', '5면', '망'] },
    { id: 'spec2', label: '확장대 철망 / 함석 부속품', keywords: ['확장대 철망', '확장대 함석', '확장대철망', '확장대함석'] },
    { id: 'spec3', label: '상단 감지봉 / 협착 방지 센서 (4EA)', keywords: ['감지봉', '감지봉 4ea', '상단감지', '협착', '센서', '4ea', '감지봉4ea'] },
    { id: 'spec4', label: '원판 부착물', keywords: ['원판설치', '원판'] },
    { id: 'spec9', label: '소화기함 및 거치대 / 소화기', keywords: ['소화기함', '기타 스티커물', '소화기'] },
    { id: 'spec10', label: '조이스틱 보호 커버', keywords: ['조이스틱 커버', '커버 연장'] },
    { id: 'spec14', label: '전용 충전기 및 전원선', keywords: ['충전기', '전원선', '릴선'] }
  ];

  const getInheritedOutboundSpecs = (contractId?: string) => {
    if (!contractId) return [];
    const outboundDel = (deliveries || []).find((d: any) => d.contractId === contractId && d.type === 'OUTBOUND');
    const contract = contracts.find(c => c.id === contractId);
    const text = `${outboundDel?.rawText || ''} ${outboundDel?.memo || ''} ${outboundDel?.closingMemo || ''} ${(contract as any)?.memo || ''}`.toLowerCase();
    
    return RETURN_CHECK_SPECS.filter(s => s.keywords.some(kw => text.includes(kw.toLowerCase())));
  };

  // 모드 상태: 'SALES' (영업사원 - Case 1,2,3) | 'MAINTENANCE' (정비직원 - Case 4)
  const [activeMode, setActiveMode] = useState<'SALES' | 'MAINTENANCE'>('SALES');

  const getTodayString = () => new Date().toISOString().split('T')[0];

  // ==========================================
  // [1] 영업사원 모드 (SALES) 상태
  // ==========================================
  const [salesSearch, setSalesSearch] = useState('');
  const [returnStartDate, setReturnStartDate] = useState('');
  const [returnEndDate, setReturnEndDate] = useState('');
  const [salesSortBy, setSalesSortBy] = useState<'END_DATE' | 'CUSTOMER_NAME' | 'SITE_NAME'>('END_DATE');
  const [salesSortDesc, setSalesSortDesc] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [returnDate, setReturnDate] = useState(getTodayString()); // 오늘 날짜 기본 제공
  const [loadingTime, setLoadingTime] = useState('오전');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');

  // 💡 [사장님 지시] 계약 선택 시 회수예정일자 오늘날짜 세팅 및 담당자 정보 자동 기본값 세팅 (수정 가능)
  useEffect(() => {
    if (!selectedContractId) return;
    const contract = contracts.find(c => c.id === selectedContractId);
    if (!contract) return;

    setReturnDate(getTodayString());

    const outboundDelivery = (deliveries || []).find((d: any) => d.contractId === selectedContractId);
    const site = (sites || []).find((s: any) => s.id === contract.siteId);
    const contact = (contacts || []).find((ct: any) => ct.id === contract.contactId);

    const defaultContactName = (outboundDelivery as any)?.siteContactName || (outboundDelivery as any)?.recipientName || contact?.name || site?.contactName || '';
    const defaultContactPhone = (outboundDelivery as any)?.siteContactPhone || (outboundDelivery as any)?.recipientPhone || contact?.contact || site?.contact || '';

    if (defaultContactName) setContactName(defaultContactName);
    if (defaultContactPhone) setContactPhone(defaultContactPhone);
  }, [selectedContractId, contracts, deliveries, sites, contacts]);

  // 통화 녹음 회수 초안 대기 큐
  const [returnDrafts, setReturnDrafts] = useState<DraftDispatchOrder[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const loadReturnDrafts = async () => {
    try {
      const list = await fetchMyDrafts();
      const filtered = list.filter(d => 
        d.status === 'DRAFT' && 
        (
          d.context?.includes('RETURN') ||
          d.note?.toLowerCase().includes('회수') ||
          d.note?.toLowerCase().includes('반납') ||
          d.note?.toLowerCase().includes('철수') ||
          d.note?.toLowerCase().includes('빼가')
        )
      );
      setReturnDrafts(filtered);
    } catch (e) {
      // non-blocking
    }
  };

  useEffect(() => {
    loadReturnDrafts();
  }, []);

  const handleApplyReturnDraft = (d: DraftDispatchOrder) => {
    setSelectedDraftId(d.id);

    const custQuery = (d.customerName?.value || '').trim().toLowerCase();
    const siteQuery = (d.siteName?.value || '').trim().toLowerCase();

    // 1) 고객사 매칭
    const matchedCust = customers.find(c =>
      c.name.toLowerCase().includes(custQuery) || (custQuery && custQuery.includes(c.name.toLowerCase()))
    );

    // 2) 계약 매칭
    let matchedContractId = '';
    if (matchedCust) {
      const custContracts = contracts.filter(c => c.customerId === matchedCust.id && c.status !== 'COMPLETED');
      if (siteQuery) {
        const matchedSite = sites.find(s => s.name.toLowerCase().includes(siteQuery) || siteQuery.includes(s.name.toLowerCase()));
        if (matchedSite) {
          const c = custContracts.find(con => con.siteId === matchedSite.id);
          if (c) matchedContractId = c.id;
        }
      }
      if (!matchedContractId && custContracts.length === 1) {
        matchedContractId = custContracts[0].id;
      }
    }

    if (matchedContractId) {
      setSelectedContractId(matchedContractId);
      const assetsForContract = contractAssets.filter(ca => ca.contractId === matchedContractId && ca.assetId);
      setSelectedAssetIds(assetsForContract.map(ca => ca.assetId!));
    } else if (custQuery) {
      setSalesSearch(d.customerName?.value || '');
    }

    // 3) 회수 정보 자동 꽂아넣기
    if (d.loadingDate?.value) {
      setReturnDate(d.loadingDate.value);
    }
    if (d.loadingTime?.value) {
      setLoadingTime(d.loadingTime.value);
    }
    if (d.contactPerson?.value) {
      setContactName(d.contactPerson.value);
    }
    if (d.contactPhone) {
      setContactPhone(d.contactPhone);
    }
    if (d.note) {
      setNote(d.note);
    }

    showToast(`[${d.customerName?.value || '고객'}] 통화 내용이 회수 의뢰 폼에 자동 입력되었습니다.`);
  };


  // ==========================================
  // [2] 정비직원 모드 (MAINTENANCE) 상태
  // ==========================================
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedRepairIds, setSelectedRepairIds] = useState<string[]>([]);
  const [maintReturnDate, setMaintReturnDate] = useState(getTodayString()); // 오늘 날짜 기본 제공
  const [maintLoadingTime, setMaintLoadingTime] = useState('오전');
  const [maintNote, setMaintNote] = useState('');


  // ==========================================
  // [4] 영업용 데이터 정렬/필터
  // ==========================================
  const activeContracts = contracts.filter(c => c.status !== 'COMPLETED');

  const filteredContracts = activeContracts.filter(c => {
    const custName = customers.find(cust => cust.id === c.customerId)?.name || '';
    const siteName = sites.find(s => s.id === c.siteId)?.name || '';
    const matchStr = salesSearch.toLowerCase();
    
    const matchesSearch = 
      custName.toLowerCase().includes(matchStr) || 
      siteName.toLowerCase().includes(matchStr) || 
      (c.contractNo && c.contractNo.toLowerCase().includes(matchStr));

    const matchesReturnStart = !returnStartDate || (c.endDate || '') >= returnStartDate;
    const matchesReturnEnd = !returnEndDate || (c.endDate || '') <= returnEndDate;

    return matchesSearch && matchesReturnStart && matchesReturnEnd;
  });

  const sortedContracts = filteredContracts.slice().sort((a, b) => {
    let valA = '';
    let valB = '';

    if (salesSortBy === 'END_DATE') {
      valA = a.endDate || '';
      valB = b.endDate || '';
    } else if (salesSortBy === 'CUSTOMER_NAME') {
      valA = customers.find(cust => cust.id === a.customerId)?.name || '';
      valB = customers.find(cust => cust.id === b.customerId)?.name || '';
    } else if (salesSortBy === 'SITE_NAME') {
      valA = sites.find(s => s.id === a.siteId)?.name || '';
      valB = sites.find(s => s.id === b.siteId)?.name || '';
    }

    const compare = valA.localeCompare(valB);
    return salesSortDesc ? -compare : compare;
  });

  // 계약 선택에 따른 자산 매칭
  const activeContractAssets = contractAssets.filter(ca => ca.contractId === selectedContractId && ca.assetId);

  const handleSalesAssetCheckboxChange = (assetId: string) => {
    if (selectedAssetIds.includes(assetId)) {
      setSelectedAssetIds(selectedAssetIds.filter(id => id !== assetId));
    } else {
      setSelectedAssetIds([...selectedAssetIds, assetId]);
    }
  };

  const handleSelectAllSalesAssets = () => {
    const allIds = activeContractAssets.map(ca => ca.assetId!).filter(Boolean);
    if (selectedAssetIds.length === allIds.length) {
      setSelectedAssetIds([]);
    } else {
      setSelectedAssetIds(allIds);
    }
  };

  const handleSalesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (!selectedContractId) {
      showToast('회수할 대상 계약을 목록에서 선택해 주세요.', 'error');
      return;
    }
    const targetContract = contracts.find(c => c.id === selectedContractId);
    if (targetContract && targetContract.startDate && returnDate < targetContract.startDate) {
      showToast(`회수 예정일(${returnDate})은 계약 시작일(${targetContract.startDate})보다 이전일 수 없습니다.`, 'error');
      return;
    }
    if (selectedAssetIds.length === 0) {
      showToast('회수할 장비를 1대 이상 선택해 주세요.', 'error');
      return;
    }
    if (!returnDate) {
      showToast('회수 예정일자를 입력해 주세요.', 'error');
      return;
    }

    try {
      await saveSmartReturn({
        contractId: selectedContractId,
        returnDate,
        assetIds: selectedAssetIds,
        loadingTime,
        contactName,
        contactPhone,
        note
      });

      // 통화 초안 연동 처리 (헌장 1.2 무누락, 5.2)
      if (selectedDraftId) {
        try {
          await discardDraft(selectedDraftId);
          setReturnDrafts(prev => prev.filter(x => x.id !== selectedDraftId));
          setSelectedDraftId(null);
        } catch (draftErr) {
          console.error('Failed to discard return draft:', draftErr);
        }
      }

      showToast('회수 의뢰 등록이 완료되었습니다. 배차 대기열에 회수(INBOUND) 건이 추가되었습니다.');
      setSelectedContractId('');
      setSelectedAssetIds([]);
      setReturnDate(getTodayString());
      setLoadingTime('오전');
      setContactName('');
      setContactPhone('');
      setNote('');
    } catch (err: any) {
      showToast(err?.message || '회수의뢰 저장 중 오류가 발생했습니다.', 'error');
    }
  };

  // 🖨️ 브라우저 고품질 인쇄 메소드
  const handlePrint = () => {
    const printContent = document.getElementById('return-sheet-print');
    if (!printContent) {
      showToast('인쇄할 입고(회수)의뢰서 콘텐츠를 찾을 수 없습니다.', 'error');
      return;
    }

    const uniqueName = new Date().getTime();
    const printWindow = window.open('', `Print_${uniqueName}`, 'left=150,top=100,width=880,height=950,menubar=no,toolbar=no,location=no,status=no');
    
    if (!printWindow) {
      showToast('브라우저 팝업이 차단되었습니다.', 'error');
      return;
    }

    const selContract = contracts.find(c => c.id === selectedContractId);
    const selCust = customers.find(c => c.id === selContract?.customerId);
    const selSite = sites.find(s => s.id === selContract?.siteId);

    const htmlDoc = `
      <!DOCTYPE html>
      <html lang="ko">
        <head>
          <meta charset="utf-8">
          <title>입고요청서_${selCust?.name || '고객사'}_${selSite?.name || '현장'}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm 15mm 15mm;
            }
            @media print {
              body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .no-print {
                display: none !important;
              }
            }
            * {
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
              padding: 0;
              margin: 0 auto;
              color: #111827;
              background-color: #ffffff;
              width: 100%;
              max-width: 210mm;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 16px;
            }
            th, td {
              border: 1px solid #cbd5e1;
              padding: 8px 10px;
              text-align: left;
              font-size: 12px;
              line-height: 1.4;
            }
            th {
              background-color: #f8fafc !important;
              font-weight: 700;
              color: #334155;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          </style>
        </head>
        <body>
          <div style="padding: 10px 0;">
            ${printContent.innerHTML}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 250);
            };
            window.onafterprint = function() {
              window.close();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlDoc);
    printWindow.document.close();
  };

  // ==========================================
  // [5] 정비용 데이터 가공 (외주 정비 자산)
  // ==========================================
  // repairs 중에서 repairType === 'EXTERNAL' 이고 status !== 'COMPLETED' (외주수리중)인 수리 건 필터링
  const ongoingRepairs = repairs.filter(r => r.repairType === 'EXTERNAL' && r.status !== 'COMPLETED');

  // 외주정비 중인 자산이 존재하는 정비 업체(Vendor)들만 추출
  const repairVendors = vendors.filter(v => 
    v.type === 'REPAIR' && 
    ongoingRepairs.some(r => r.vendorId === v.id)
  );

  // 선택된 외주업체에서 외주정비 중인 정비 리스트
  const repairsAtSelectedVendor = ongoingRepairs.filter(r => r.vendorId === selectedVendorId);

  const handleMaintAssetCheckboxChange = (repairId: string) => {
    if (selectedRepairIds.includes(repairId)) {
      setSelectedRepairIds(selectedRepairIds.filter(id => id !== repairId));
    } else {
      setSelectedRepairIds([...selectedRepairIds, repairId]);
    }
  };

  const handleSelectAllMaintAssets = () => {
    const allIds = repairsAtSelectedVendor.map(r => r.id);
    if (selectedRepairIds.length === allIds.length) {
      setSelectedRepairIds([]);
    } else {
      setSelectedRepairIds(allIds);
    }
  };

  const handleMaintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (!selectedVendorId) {
      showToast('회수해 올 외주정비 업체를 선택해 주세요.', 'error');
      return;
    }
    if (selectedRepairIds.length === 0) {
      showToast('회수할 정비 자산을 1개 이상 선택해 주세요.', 'error');
      return;
    }
    if (!maintReturnDate) {
      showToast('회수 일자를 입력해 주세요.', 'error');
      return;
    }

    // 선택된 수리건들의 assetId 목록 추출
    const targetAssetIds: string[] = [];
    selectedRepairIds.forEach(rId => {
      const rep = repairs.find(r => r.id === rId);
      if (rep && rep.assetId) {
        targetAssetIds.push(rep.assetId);
      }
    });

    try {
      await saveSmartReturn({
        returnDate: maintReturnDate,
        assetIds: targetAssetIds,
        loadingTime: maintLoadingTime,
        repairId: selectedRepairIds.join(','),
        vendorId: selectedVendorId,
        note: maintNote
      });

      showToast('외주 정비 완료 자산 회수의뢰 등록이 완료되었습니다.');
      setSelectedVendorId('');
      setSelectedRepairIds([]);
      setMaintReturnDate('');
      setMaintLoadingTime('');
      setMaintNote('');
    } catch (err: any) {
      showToast(err?.message || '외주정비 회수의뢰 저장 중 오류가 발생했습니다.', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative' }}>
      {/* 알림 토스트 배너 (헌장 5.2) */}
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
          {toastMessage.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}
      
      {/* 타이틀 및 가이드 배너 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontWeight: '700', marginBottom: '4px' }}>회수 의뢰 관리</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            영업 계약 만료/단축/고장 및 외주정비업체 수리 완료 건에 대한 회수 의뢰(INBOUND) 프로세스를 등록합니다.
          </p>
        </div>
      </div>

      {/* 📊 회수 대상 및 계약 만료 현황 요약 바 */}
      {(() => {
        const todayStr = getTodayString();
        const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];

        const expiringSoonContracts = contracts.filter(c => c.status === 'ACTIVE' && c.endDate && c.endDate >= todayStr && c.endDate <= nextWeekStr);
        const totalRentedAssets = contractAssets.filter(ca => ca.assetId && !ca.actualReturnDate).length;
        const activeContractsCount = contracts.filter(c => c.status === 'ACTIVE').length;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>진행중인 계약</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{activeContractsCount}건</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>현장 대여중 장비</span>
              <strong style={{ fontSize: '15px', color: '#16a34a' }}>{totalRentedAssets}대</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>7일 내 만료예정 계약</span>
              <strong style={{ fontSize: '15px', color: expiringSoonContracts.length > 0 ? '#d97706' : 'var(--text-muted)' }}>{expiringSoonContracts.length}건</strong>
            </div>
          </div>
        );
      })()}

      {/* 모드 전환 탭 */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          type="button"
          onClick={() => {
            setActiveMode('SALES');
            setSelectedContractId('');
            setSelectedAssetIds([]);
          }}
          className={activeMode === 'SALES' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '14px', fontWeight: 'bold' }}
        >
          임대 계약 회수 의뢰
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveMode('MAINTENANCE');
            setSelectedVendorId('');
            setSelectedRepairIds([]);
          }}
          className={activeMode === 'MAINTENANCE' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '14px', fontWeight: 'bold' }}
        >
          외주 정비 수리완료 회수 의뢰
        </button>
      </div>

      {/* [1] 영업사용자 모드 UI */}
      {activeMode === 'SALES' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '4.5fr 5.5fr', gap: '20px', alignItems: 'start' }}>
          
          {/* 왼쪽: 계약 목록 / 검색 / 파서 */}
          <div className="card" style={{ padding: '16px', minHeight: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Search size={16} className="text-primary" />
                <h4 style={{ margin: 0, fontWeight: '700' }}>임대 계약 조회</h4>
              </div>

            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                
                {/* 📞 통화 접수 회수 대기 큐 (헌장 3.1 무수식어 건조 표준) */}
                {returnDrafts.length > 0 && (
                  <div style={{
                    backgroundColor: 'var(--bg-app)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <PhoneCall size={14} color="var(--primary)" />
                        통화 접수 회수 대기 ({returnDrafts.length}건)
                      </span>
                      <button
                        type="button"
                        onClick={loadReturnDrafts}
                        style={{ fontSize: '11px', color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                      >
                        새로고침
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                      {returnDrafts.map(d => {
                        const isSelected = selectedDraftId === d.id;
                        return (
                          <div
                            key={d.id}
                            onClick={() => handleApplyReturnDraft(d)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              backgroundColor: isSelected ? 'rgba(59,130,246,0.12)' : 'var(--bg-card)',
                              border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: 800 }}>{d.customerName?.value || '고객사 미상'}</span>
                              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                                회수 요청
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              현장: {d.siteName?.value || '현장 미상'} {d.contactPerson?.value ? `· ${d.contactPerson.value}` : ''}
                            </div>
                            {d.note && (
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {d.note}
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px', fontSize: '10px', color: 'var(--text-muted)' }}>
                              <span>{d.createdAt?.slice(5, 16) || ''}</span>
                              <span style={{ color: 'var(--primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                <Sparkles size={11} /> 1-클릭 꽂아넣기 ➔
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 검색 필터 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="고객명, 현장명, 계약번호 검색..."
                      value={salesSearch}
                      onChange={e => setSalesSearch(e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                    />
                    
                    <button
                      type="button"
                      onClick={() => {
                        if (salesSortBy === 'END_DATE') {
                          setSalesSortDesc(!salesSortDesc);
                        } else {
                          setSalesSortBy('END_DATE');
                          setSalesSortDesc(false);
                        }
                      }}
                      className={salesSortBy === 'END_DATE' ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}
                    >
                      <ArrowUpDown size={12} /> 만료일 {salesSortBy === 'END_DATE' && (salesSortDesc ? '▼' : '▲')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (salesSortBy === 'CUSTOMER_NAME') {
                          setSalesSortDesc(!salesSortDesc);
                        } else {
                          setSalesSortBy('CUSTOMER_NAME');
                          setSalesSortDesc(false);
                        }
                      }}
                      className={salesSortBy === 'CUSTOMER_NAME' ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}
                    >
                      <ArrowUpDown size={12} /> 고객명 {salesSortBy === 'CUSTOMER_NAME' && (salesSortDesc ? '▼' : '▲')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (salesSortBy === 'SITE_NAME') {
                          setSalesSortDesc(!salesSortDesc);
                        } else {
                          setSalesSortBy('SITE_NAME');
                          setSalesSortDesc(false);
                        }
                      }}
                      className={salesSortBy === 'SITE_NAME' ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}
                    >
                      <ArrowUpDown size={12} /> 현장명 {salesSortBy === 'SITE_NAME' && (salesSortDesc ? '▼' : '▲')}
                    </button>
                  </div>

                  {/* 날짜 필터 추가 */}
                  <div style={{ display: 'flex', gap: '10px', backgroundColor: 'var(--bg-app)', padding: '8px', borderRadius: '6px', alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', whiteSpace: 'nowrap' }}>계약 만료일 범위</label>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input type="date" value={returnStartDate} onChange={e => setReturnStartDate(e.target.value)} style={{ padding: '6px', fontSize: '12.5px', flex: 1, border: '1px solid var(--border-color)', borderRadius: '4px' }} />
                        <span>~</span>
                        <input type="date" value={returnEndDate} onChange={e => setReturnEndDate(e.target.value)} style={{ padding: '6px', fontSize: '12.5px', flex: 1, border: '1px solid var(--border-color)', borderRadius: '4px' }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '2px', paddingBottom: '2px' }}>
                      <button type="button" className="btn-secondary" style={{ fontSize: '11px', padding: '4px 6px' }} onClick={() => {
                        const today = new Date();
                        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
                        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
                        setReturnStartDate(firstDay); setReturnEndDate(lastDay);
                      }}>이번달</button>
                      <button type="button" className="btn-secondary" style={{ fontSize: '11px', padding: '4px 6px' }} onClick={() => {
                        const today = new Date();
                        const firstDayNext = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().split('T')[0];
                        const lastDayNext = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0];
                        setReturnStartDate(firstDayNext); setReturnEndDate(lastDayNext);
                      }}>다음달</button>
                      <button type="button" className="btn-secondary" style={{ fontSize: '11px', padding: '4px 6px' }} onClick={() => {
                        setReturnStartDate(''); setReturnEndDate('');
                      }}>전체</button>
                    </div>
                  </div>
                </div>

                {/* 계약 목록 */}
                <div style={{ maxHeight: '380px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-app)' }}>
                  {sortedContracts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      검색 조건에 맞는 활성 임대계약이 없습니다.
                    </div>
                  ) : (
                    sortedContracts.map(c => {
                      const cust = customers.find(cust => cust.id === c.customerId);
                      const site = sites.find(s => s.id === c.siteId);
                      const isSelected = selectedContractId === c.id;
                      
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSelectedContractId(c.id);
                            setSelectedAssetIds([]);
                          }}
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid var(--border-color)',
                            cursor: 'pointer',
                            backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                            borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid transparent',
                            transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <strong style={{ fontSize: '13.5px', color: isSelected ? 'var(--primary)' : 'var(--text-primary)' }}>
                              {cust?.name}
                            </strong>
                            <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                              {c.contractNo}
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>현장: {site?.name || '미정'}</span>
                            <span style={{ fontWeight: '600', color: 'var(--danger)' }}>
                              만료일: {c.endDate || '-'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

              </div>
          </div>

          {/* 오른쪽: 상세 정보 입력 및 폼 제출 */}
          <div className="card" style={{ padding: '20px', minHeight: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h4 style={{ margin: 0, fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clipboard size={18} className="text-success" />
                회수 지시 세부 설정
              </h4>
            </div>

            {selectedDraftId && (
              <div style={{
                backgroundColor: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.25)',
                borderRadius: '6px',
                padding: '8px 12px',
                marginBottom: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} /> 선택된 통화 회수 내용이 자동 입력되었습니다. 회수 장비 및 일자를 확인 후 등록하십시오.
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDraftId(null)}
                  style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  선택 해제
                </button>
              </div>
            )}

            {selectedContractId ? (
              <form onSubmit={handleSalesSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                
                {/* 1. 계약 기본 확인 */}
                <div style={{ padding: '12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px' }}>
                  {(() => {
                    const c = contracts.find(con => con.id === selectedContractId);
                    const cust = customers.find(cust => cust.id === c?.customerId);
                    const site = sites.find(s => s.id === c?.siteId);
                    return (
                      <>
                        <div style={{ marginBottom: '4px' }}><strong>계약번호:</strong> {c?.contractNo}</div>
                        <div style={{ marginBottom: '4px' }}><strong>고객사:</strong> {cust?.name}</div>
                        <div><strong>현장명:</strong> {site?.name} ({site?.address || '-'})</div>
                      </>
                    );
                  })()}
                </div>

                {/* 2. 자산 선택 (전부 vs 일부) */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>회수할 자산 지정 *</label>
                    <button
                      type="button"
                      onClick={handleSelectAllSalesAssets}
                      style={{ fontSize: '11px', padding: '2px 8px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      전체선택 / 해제
                    </button>
                  </div>
                  <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--border-color)', padding: '8px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)' }}>
                    {activeContractAssets.length === 0 ? (
                      <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', textAlign: 'center', padding: '10px' }}>
                        대여 중인 자산 정보가 없습니다.
                      </div>
                    ) : (
                      activeContractAssets.map(ca => {
                        const asset = assets.find(a => a.id === ca.assetId);
                        if (!asset) return null;
                        const isChecked = selectedAssetIds.includes(asset.id);
                        return (
                          <label
                            key={ca.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              fontSize: '12.5px',
                              cursor: 'pointer',
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                              backgroundColor: isChecked ? 'var(--primary-light)' : 'var(--bg-card)',
                              transition: 'all 0.15s ease',
                              margin: 0
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleSalesAssetCheckboxChange(asset.id)}
                              style={{ display: 'none' }}
                            />
                            <div style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              border: isChecked ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                              backgroundColor: isChecked ? 'var(--primary)' : 'var(--bg-app)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#ffffff',
                              flexShrink: 0,
                              transition: 'all 0.15s ease'
                            }}>
                              {isChecked && <Check size={13} style={{ strokeWidth: 3.5, color: '#ffffff' }} />}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <strong style={{ color: 'var(--primary)' }}>[{asset.assetNo}]</strong>
                              <span style={{ fontWeight: 600 }}>{asset.modelName}</span>
                              {asset.serialNo && <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>(S/N: {asset.serialNo})</span>}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    * 일부 장비만 부분 조기반송하는 경우 해당하는 장비만 체크하세요.
                  </div>
                </div>

                {/* 3. 일정 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label>회수 예정일자 *</label>
                    <input
                      type="date"
                      value={returnDate}
                      onChange={e => setReturnDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label>회수 희망시간</label>
                    <div style={{ display: 'flex', gap: '6px', position: 'relative', height: '38px' }}>
                      <select
                        value={loadingTime}
                        onChange={e => {
                          setLoadingTime(e.target.value);
                          (e.target as HTMLSelectElement).blur();
                        }}
                        onFocus={e => { (e.target as HTMLSelectElement).size = 10; }}
                        onBlur={e => { (e.target as HTMLSelectElement).size = 1; }}
                        style={{
                          flex: 1,
                          position: 'absolute',
                          width: '100%',
                          zIndex: 30,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                        }}
                      >
                        <option value="오전">오전</option>
                        <option value="오후">오후</option>
                        <option value="수시">수시</option>
                        <option value="06시">06시</option>
                        <option value="07시">07시</option>
                        <option value="08시">08시</option>
                        <option value="09시">09시</option>
                        <option value="10시">10시</option>
                        <option value="11시">11시</option>
                        <option value="12시">12시</option>
                        <option value="13시">13시</option>
                        <option value="14시">14시</option>
                        <option value="15시">15시</option>
                        <option value="16시">16시</option>
                        <option value="17시">17시</option>
                        <option value="18시">18시</option>
                        <option value="19시">19시</option>
                        <option value="20시">20시</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 4. 고객 담당 정보 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label>방문지 고객 담당자명 *</label>
                    <input
                      type="text"
                      placeholder="이름 입력"
                      value={contactName}
                      onChange={e => setContactName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label>담당자 연락처 *</label>
                    <input
                      type="text"
                      placeholder="연락처 입력"
                      value={contactPhone}
                      onChange={e => setContactPhone(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* 5. 비고 */}
                <div>
                  <label>특이사항 및 비고</label>
                  <textarea
                    rows={2}
                    placeholder="조기 반납 조건 명시 또는 운반비 조건 등 입력..."
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-success"
                  style={{ width: '100%', padding: '10px', fontSize: '14px', fontWeight: 'bold' }}
                  disabled={!canSave || selectedAssetIds.length === 0}
                >
                  <Check size={16} /> 회수 의뢰 등록 확정
                </button>

              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '360px', color: 'var(--text-muted)', textAlign: 'center', gap: '8px' }}>
                <Shield size={48} style={{ strokeWidth: 1.2, marginBottom: '8px', color: selectedDraftId ? 'var(--primary)' : 'var(--text-muted)' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
                  {selectedDraftId ? '통화 회수 초안이 선택되었습니다.' : '왼쪽 계약 목록에서 회수 요청 대상을 선택해 주세요.'}
                </span>
                {selectedDraftId && (
                  <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
                    왼쪽 계약 목록에서 일치하는 공사 현장 계약을 클릭하면 세부 설정이 즉시 완성됩니다.
                  </span>
                )}
              </div>
            )}
          </div>

        </div>

        {/* 3단계: 서식 출력 및 미리보기 (A4 서식) */}
        {(() => {
          const selectedContract = contracts.find(c => c.id === selectedContractId);
          const selectedCustomer = customers.find(c => c.id === selectedContract?.customerId);
          const selectedSite = sites.find(s => s.id === selectedContract?.siteId);
          const selectedSalesperson = users?.find(u => u.id === selectedContract?.salespersonId) || currentUser;
          const selectedReturnAssets = assets.filter(a => selectedAssetIds.includes(a.id));

          return (
            <div className="card" style={{ marginTop: '20px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <h4 style={{ margin: 0, fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileText size={18} className="text-primary" />
                  서식 출력 및 미리보기
                </h4>

                {/* 로컬 프린터 연동 및 인쇄 액션 바 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>로컬 프린터 지정:</span>
                    <select
                      value={selectedPrinter}
                      onChange={(e) => handlePrinterChange(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-app)',
                        color: 'var(--text-primary)',
                        minWidth: '150px'
                      }}
                    >
                      {printers.length > 0 ? (
                        printers.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))
                      ) : (
                        <option value="Apeos C2060">Apeos C2060 (기본)</option>
                      )}
                    </select>
                  </div>

                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handlePrint}
                    disabled={isAgentPrinting}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12.5px',
                      padding: '7px 14px',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      height: '33px'
                    }}
                  >
                    <Printer size={14} />
                    {isAgentPrinting ? '인쇄 전송중...' : '입고의뢰서 인쇄'}
                  </button>
                </div>
              </div>

              {/* 실제 인쇄 타겟 컨테이너 */}
              <div id="return-sheet-print" style={{ padding: '16px 20px', backgroundColor: '#ffffff', color: '#111827', borderRadius: '4px', border: '1px solid #cbd5e1', maxWidth: '800px', width: '100%', margin: '0 auto', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', boxSizing: 'border-box', overflow: 'hidden' }}>
                
                {/* 상단 헤더: 좌측 계약번호+출력일시 / 중앙 타이틀 / 우측 날인란 */}
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', borderBottom: '2px solid #1e1b4b', paddingBottom: '8px', marginBottom: '12px', gap: '8px' }}>

                  {/* 좌측: 계약번호 및 출력일시 */}
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: '#312e81', whiteSpace: 'nowrap' }}>
                      계약번호: <span style={{ color: selectedContract?.contractNo ? '#0f172a' : '#94a3b8', fontWeight: '800' }}>{selectedContract?.contractNo || '(계약 선택)'}</span>
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      출력일시: {(() => {
                        const now = new Date();
                        const y = now.getFullYear();
                        const mo = String(now.getMonth() + 1).padStart(2, '0');
                        const d = String(now.getDate()).padStart(2, '0');
                        const hh = String(now.getHours()).padStart(2, '0');
                        const mi = String(now.getMinutes()).padStart(2, '0');
                        const ss = String(now.getSeconds()).padStart(2, '0');
                        return `${y}.${mo}.${d} ${hh}:${mi}:${ss}`;
                      })()}
                    </div>
                  </div>

                  {/* 중앙: 문서 타이틀 */}
                  <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                    <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#1e1b4b', letterSpacing: '3px', whiteSpace: 'nowrap' }}>{currentTenant?.tradeName || '장비'} 입고요청서</h1>
                  </div>

                  {/* 우측: 입고 등록자 날인란 */}
                  <div style={{ flexShrink: 0, width: '76px', border: '1.5px solid #334155', overflow: 'hidden', borderRadius: '2px' }}>
                    <div style={{
                      backgroundColor: '#f1f5f9',
                      borderBottom: '1px solid #334155',
                      textAlign: 'center',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: '#1e293b',
                      padding: '2px 0',
                      whiteSpace: 'nowrap',
                    }}>
                      입고 등록자
                    </div>
                    <div style={{
                      height: '38px',
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      color: '#94a3b8',
                      fontWeight: '600',
                    }}>
                      (서 명)
                    </div>
                  </div>
                </div>

                {/* 1. 거래처 및 현장 정보 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>1. 거래처 및 현장 정보</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>고객사명</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '700', wordBreak: 'break-all', boxSizing: 'border-box' }}>{selectedCustomer?.name || '-'}</td>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>현장명</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '700', wordBreak: 'break-all', boxSizing: 'border-box' }}>{selectedSite?.name || '-'}</td>
                    </tr>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>상세 회수주소</th>
                      <td colSpan={3} style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', wordBreak: 'break-all', boxSizing: 'border-box' }}>{selectedSite?.address || selectedCustomer?.address || '-'}</td>
                    </tr>
                  </tbody>
                </table>

                {/* 2. 업무 관계자 정보 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>2. 업무 관계자 정보</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>영업담당자</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '600', wordBreak: 'break-all', boxSizing: 'border-box' }}>
                        {selectedSalesperson?.name || currentUser?.name || '-'} {selectedSalesperson?.phone || currentUser?.phone ? `(${selectedSalesperson?.phone || currentUser?.phone})` : ''}
                      </td>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>방문지 고객담당</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '600', wordBreak: 'break-all', boxSizing: 'border-box' }}>
                        {contactName || '-'} {contactPhone ? `(${contactPhone})` : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* 3. 회수 배차 및 대상 장비 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>3. 회수 배차 및 대상 장비</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '34%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>회수예정일자</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '700', wordBreak: 'break-all', boxSizing: 'border-box' }}>{returnDate || '-'}</td>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>상차 희망시간</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', wordBreak: 'break-all', boxSizing: 'border-box' }}>{loadingTime || '-'}</td>
                    </tr>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>회수 대상 장비</th>
                      <td colSpan={3} style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', fontWeight: '700', wordBreak: 'break-all', boxSizing: 'border-box' }}>
                        {selectedReturnAssets.length > 0 ? (
                          selectedReturnAssets.map(a => `${a.modelName} {${a.assetNo}}`).join(', ') + ` (총 ${selectedReturnAssets.length}대)`
                        ) : (
                          <span style={{ color: '#94a3b8' }}>회수할 장비를 선택해 주세요</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* 4. 장비 반납/회수 확인사항 (출고 옵션 상속 + 현장 점검 항목) */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>
                  4. 장비 반납/회수 확인사항 (출고 장착 옵션 상속 점검)
                </div>
                <div style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', marginBottom: '10px', backgroundColor: '#f8fafc', color: '#111827', boxSizing: 'border-box' }}>
                  {/* 출고 당시 부착되었던 특수 옵션 상속 목록 */}
                  {(() => {
                    const inheritedSpecs = getInheritedOutboundSpecs(selectedContractId);
                    return (
                      <>
                        {inheritedSpecs.length > 0 && (
                          <div style={{ marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px dashed #cbd5e1' }}>
                            <div style={{ fontSize: '11px', fontWeight: '800', color: '#b91c1c', marginBottom: '4px' }}>
                              ⚠️ [출고 장착 옵션 필수 회수/점검] — 미반납 및 분실 위험 방어 항목
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '11.5px' }}>
                              {inheritedSpecs.map((s, idx) => (
                                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: '700', color: '#b91c1c' }}>
                                  <span style={{ fontSize: '13px', color: '#dc2626', fontWeight: 700, lineHeight: 1 }}>□</span>
                                  <span>[출고옵션 {idx + 1}] {s.label} 분실/파손 확인 및 회수</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '11.5px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: '#111827' }}>
                            <span style={{ fontSize: '13px', color: '#475569', fontWeight: 400, lineHeight: 1 }}>□</span>
                            <span>1. 장비 외관 파손 및 도색 손상 점검</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: '#111827' }}>
                            <span style={{ fontSize: '13px', color: '#475569', fontWeight: 400, lineHeight: 1 }}>□</span>
                            <span>2. 상하부 조종기 및 키 스위치 이상 유무</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: '#111827' }}>
                            <span style={{ fontSize: '13px', color: '#475569', fontWeight: 400, lineHeight: 1 }}>□</span>
                            <span>3. 전용 충전기 및 전원 인입선 회수 확인</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: '#111827' }}>
                            <span style={{ fontSize: '13px', color: '#475569', fontWeight: 400, lineHeight: 1 }}>□</span>
                            <span>4. 유압유 누유 및 리프트 승하강 정상 동작</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* 5. 현장 특이사항 및 인계 메모 */}
                <div style={{ fontSize: '12.5px', fontWeight: 'bold', borderLeft: '3.5px solid #312e81', paddingLeft: '6px', marginBottom: '4px', color: '#312e81' }}>5. 현장 특이사항 및 인계 메모</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', boxSizing: 'border-box' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '84%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 'bold', fontSize: '12px', boxSizing: 'border-box' }}>지시/비고사항</th>
                      <td style={{ border: '1px solid #cbd5e1', padding: '5px 8px', backgroundColor: '#ffffff', color: '#111827', fontSize: '12px', wordBreak: 'break-all', boxSizing: 'border-box' }}>{note || '특이사항 없음'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
        </>
      )}

      {/* [2] 정비직원 모드 UI */}
      {activeMode === 'MAINTENANCE' && (
        <div style={{ display: 'grid', gridTemplateColumns: '4.5fr 5.5fr', gap: '20px', alignItems: 'start' }}>
          
          {/* 왼쪽: 외주 정비 수리중인 외주업체 목록 */}
          <div className="card" style={{ padding: '16px', minHeight: '520px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <Search size={16} className="text-primary" />
              <h4 style={{ margin: 0, fontWeight: '700' }}>외주 정비 진행중인 업체 목록</h4>
            </div>
            
            <div style={{ padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
              ℹ 현재 외주 정비 (`EXTERNAL`) 중인 리프트 자산이 존재하는 정비소들만 노출됩니다.
            </div>

            <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
              {repairVendors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  현재 외주정비 진행 중인 자산이 없습니다.
                </div>
              ) : (
                repairVendors.map(v => {
                  const cnt = ongoingRepairs.filter(r => r.vendorId === v.id).length;
                  const isSelected = selectedVendorId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => {
                        setSelectedVendorId(v.id);
                        setSelectedRepairIds([]);
                      }}
                      style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                        borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid transparent',
                        transition: 'all 0.15s',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '13.5px' }}>{v.name}</strong>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          대표자: {v.contactName || '-'} | 연락처: {v.contact || '-'}
                        </div>
                      </div>
                      <span className="badge badge-warning" style={{ fontSize: '12px', fontWeight: 'bold' }}>
                        정비중 {cnt}대
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 오른쪽: 외주정비 자산 리스트 및 회수 폼 */}
          <div className="card" style={{ padding: '20px', minHeight: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h4 style={{ margin: 0, fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clipboard size={18} className="text-success" />
                외주정비 완료 회수 의뢰
              </h4>
            </div>

            {selectedVendorId ? (
              <form onSubmit={handleMaintSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                
                {/* 외주업체 정보 */}
                <div style={{ padding: '12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px' }}>
                  {(() => {
                    const v = vendors.find(vend => vend.id === selectedVendorId);
                    return (
                      <>
                        <div style={{ marginBottom: '4px' }}><strong>회수장소 (외주정비업체):</strong> {v?.name}</div>
                        <div><strong>업체 주소/연락처:</strong> {v?.memo || '공장'} / {v?.contact || '-'}</div>
                      </>
                    );
                  })()}
                </div>

                {/* 해당 외주업체 정비 리스트 */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>수리완료 회수 대상 자산 선택 (전부 또는 일부) *</label>
                    <button
                      type="button"
                      onClick={handleSelectAllMaintAssets}
                      style={{ fontSize: '11px', padding: '2px 8px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      전체선택 / 해제
                    </button>
                  </div>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)' }}>
                    {repairsAtSelectedVendor.map(r => {
                      const asset = assets.find(a => a.id === r.assetId);
                      if (!asset) return null;
                      return (
                        <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={selectedRepairIds.includes(r.id)}
                            onChange={() => handleMaintAssetCheckboxChange(r.id)}
                          />
                          <span>
                            <strong>[{asset.assetNo}]</strong> {asset.modelName} (수리의뢰내역: {r.details || '내용없음'})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 일정 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label>회수 예정일자 *</label>
                    <input
                      type="date"
                      value={maintReturnDate}
                      onChange={e => setMaintReturnDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label>상차 희망시간</label>
                    <div style={{ display: 'flex', gap: '6px', position: 'relative', height: '38px' }}>
                      <select
                        value={maintLoadingTime}
                        onChange={e => {
                          setMaintLoadingTime(e.target.value);
                          (e.target as HTMLSelectElement).blur();
                        }}
                        onFocus={e => { (e.target as HTMLSelectElement).size = 10; }}
                        onBlur={e => { (e.target as HTMLSelectElement).size = 1; }}
                        style={{
                          flex: 1,
                          position: 'absolute',
                          width: '100%',
                          zIndex: 30,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                        }}
                      >
                        <option value="오전">오전</option>
                        <option value="오후">오후</option>
                        <option value="수시">수시</option>
                        <option value="06시">06시</option>
                        <option value="07시">07시</option>
                        <option value="08시">08시</option>
                        <option value="09시">09시</option>
                        <option value="10시">10시</option>
                        <option value="11시">11시</option>
                        <option value="12시">12시</option>
                        <option value="13시">13시</option>
                        <option value="14시">14시</option>
                        <option value="15시">15시</option>
                        <option value="16시">16시</option>
                        <option value="17시">17시</option>
                        <option value="18시">18시</option>
                        <option value="19시">19시</option>
                        <option value="20시">20시</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 비고 */}
                <div>
                  <label>인수 특이사항</label>
                  <textarea
                    rows={3}
                    placeholder="수리 완료 부품 확인 필요, 또는 물류 기사 사전 인수 통화 요청..."
                    value={maintNote}
                    onChange={e => setMaintNote(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-success"
                  style={{ width: '100%', padding: '10px', fontSize: '14px', fontWeight: 'bold' }}
                  disabled={!canSave || selectedRepairIds.length === 0}
                >
                  <Check size={16} /> 외주정비 회수 요청 생성
                </button>

              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '360px', color: 'var(--text-muted)' }}>
                <AlertTriangle size={48} style={{ strokeWidth: 1.2, marginBottom: '12px' }} />
                <span>왼쪽 외주업체 목록에서 회수 대상을 선택해 주세요.</span>
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
};
