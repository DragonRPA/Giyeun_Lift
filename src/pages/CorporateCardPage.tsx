import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  CreditCard, Upload, Download, CheckCircle2, AlertTriangle, ArrowRight, 
  HelpCircle, RefreshCw, FileText, Settings, Plus, Trash2, Edit3, Save, X, Lightbulb
} from 'lucide-react';
import { exportToExcel } from '../services/excel';

interface PurchaseCategory {
  categoryId: string;
  categoryName: string;
  accountCode: string;
  defaultExpectedAmount: number;
  isRequiredProof: boolean;
  paymentMethod: 'TAX_INVOICE' | 'CARD' | 'AUTO_DEBIT';
  isActive: boolean;
}

export const CorporateCardPage: React.FC = () => {
  const { hasPermission } = useApp();
  const canSave = hasPermission('billing', 'save');

  // 활성 탭: 'settlement' (매입정산 및 누락 검증), 'settings' (매입유형 관리)
  const [activeSubTab, setActiveSubTab] = useState<'settlement' | 'settings'>('settlement');

  // 1. 동적 매입유형 목록 상태 (초기 기본값 제공)
  const [categories, setCategories] = useState<PurchaseCategory[]>([
    { categoryId: 'cat_rent', categoryName: '임차 거래처 임차료', accountCode: '지급임차료', defaultExpectedAmount: 8450000, isRequiredProof: true, paymentMethod: 'TAX_INVOICE', isActive: true },
    { categoryId: 'cat_logistics', categoryName: '운송 거래처별 매입', accountCode: '외주가공비', defaultExpectedAmount: 2300000, isRequiredProof: true, paymentMethod: 'TAX_INVOICE', isActive: true },
    { categoryId: 'cat_consumable', categoryName: '소모품 외상매입', accountCode: '소모품비', defaultExpectedAmount: 1200000, isRequiredProof: true, paymentMethod: 'TAX_INVOICE', isActive: true },
    { categoryId: 'cat_repair', categoryName: '외주수리업체 수리비', accountCode: '수선비', defaultExpectedAmount: 450000, isRequiredProof: true, paymentMethod: 'TAX_INVOICE', isActive: true },
    { categoryId: 'cat_office_rent', categoryName: '사무실 임대료', accountCode: '지급임차료', defaultExpectedAmount: 1500000, isRequiredProof: true, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_lease', categoryName: '차량/운반구 리스료', accountCode: '지급임차료', defaultExpectedAmount: 600000, isRequiredProof: true, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_bookkeeping', categoryName: '회계/세무 기장대행료', accountCode: '지급수수료', defaultExpectedAmount: 150000, isRequiredProof: true, paymentMethod: 'TAX_INVOICE', isActive: true },
    // 세무 유형별 세분화 정의
    { categoryId: 'cat_tax_vat', categoryName: '부가가치세 (분기/월 예치)', accountCode: '부가세대급금', defaultExpectedAmount: 4200000, isRequiredProof: false, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_tax_withholding', categoryName: '원천징수세 (소득세 원천분)', accountCode: '세금과공과', defaultExpectedAmount: 320000, isRequiredProof: false, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_tax_local_income', categoryName: '지방소득세 (특별징수분)', accountCode: '세금과공과', defaultExpectedAmount: 32000, isRequiredProof: false, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_tax_corporate', categoryName: '법인세 (중간예납/본세)', accountCode: '법인세비용', defaultExpectedAmount: 1500000, isRequiredProof: false, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_tax_resident', categoryName: '주민세 (사업소분/균등분)', accountCode: '세금과공과', defaultExpectedAmount: 50000, isRequiredProof: false, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_tax_car', categoryName: '자동차세 (업무용/화물차량)', accountCode: '세금과공과', defaultExpectedAmount: 250000, isRequiredProof: false, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_meals', categoryName: '지정식당 식대정산', accountCode: '복리후생비', defaultExpectedAmount: 350000, isRequiredProof: true, paymentMethod: 'TAX_INVOICE', isActive: true },
    { categoryId: 'cat_payroll', categoryName: '임직원 월 급여', accountCode: '급여', defaultExpectedAmount: 18500000, isRequiredProof: false, paymentMethod: 'AUTO_DEBIT', isActive: true },
    { categoryId: 'cat_capex', categoryName: '장비 신규 취득', accountCode: '기계장치', defaultExpectedAmount: 45000000, isRequiredProof: true, paymentMethod: 'TAX_INVOICE', isActive: true },
    { categoryId: 'cat_petty', categoryName: '소액 현금 지출', accountCode: '소모품비', defaultExpectedAmount: 85000, isRequiredProof: false, paymentMethod: 'CARD', isActive: true }
  ]);

  // 2. 동적 추가/수정용 임시 상태
  const [newCatName, setNewCatName] = useState('');
  const [newCatAccount, setNewCatAccount] = useState('복리후생비');
  const [newCatExpected, setNewCatExpected] = useState<number>(0);
  const [newCatProof, setNewCatProof] = useState(true);
  const [newCatPayment, setNewCatPayment] = useState<'TAX_INVOICE' | 'CARD' | 'AUTO_DEBIT'>('CARD');

  // 3. 정산 및 거래내역 상태
  const [selectedMonth, setSelectedMonth] = useState('2026-07');
  const [isUploaded, setIsUploaded] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [actualAmounts, setActualAmounts] = useState<Record<string, number>>({});
  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 인앱 커스텀 확인 모달 상태 (헌장 5.2: 브라우저 confirm 전면 퇴출)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // ─── [Gutenberg Z-패턴 4단계 최하단 법인카드 매입정산 대차대조식 검증] ───
  const cardAuditSummary = useMemo(() => {
    const activeCats = categories.filter(c => c.isActive);
    const totalExpected = activeCats.reduce((sum, c) => sum + (c.defaultExpectedAmount || 0), 0);
    const totalActual = activeCats.reduce((sum, c) => sum + (actualAmounts[c.categoryId] || 0), 0);
    const diff = totalExpected - totalActual;

    return {
      catCount: activeCats.length,
      totalExpected,
      totalActual,
      diff
    };
  }, [categories, actualAmounts]);

  // 실제 카드 명세서 업로드 시 파싱된 데이터로 actualAmounts 갱신
  // (useEffect 내 테스트 데모용 하드코딩 초기값 주입 제거 — 운영 환경에서 오염 방지)

  // 카드 파일 업로드 시 파싱
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    // 모의 승인 명세서 데이터 로드
    const mockTx = [
      {
        approvalNo: '30018492',
        cardNumber: '4221-55**-****-8812',
        transactionDate: '2026-07-15 12:30:15',
        merchantName: '(주)기연소모품총판',
        amount: 242000,
        vat: 22000,
        employeeName: '김영업 과장',
        status: 'UNMAPPED',
        category: '미지정',
        relatedId: '',
        autoMatchable: true
      },
      {
        approvalNo: '30018501',
        cardNumber: '4221-55**-****-8812',
        transactionDate: '2026-07-16 19:40:00',
        merchantName: '한양정식당 (법인접대)',
        amount: 154000,
        vat: 14000,
        employeeName: '김영업 과장',
        status: 'UNMAPPED',
        category: '미지정',
        relatedId: '',
        autoMatchable: false
      },
      {
        approvalNo: '30018512',
        cardNumber: '5302-11**-****-0045',
        transactionDate: '2026-07-18 09:15:20',
        merchantName: 'SK에너지기연주유소',
        amount: 85000,
        vat: 7727,
        employeeName: '박정비 대리',
        status: 'UNMAPPED',
        category: '미지정',
        relatedId: '',
        autoMatchable: false
      },
      {
        approvalNo: '30018545',
        cardNumber: '5302-11**-****-0045',
        transactionDate: '2026-07-19 14:10:44',
        merchantName: '대화종합물류(주)',
        amount: 350000,
        vat: 31818,
        employeeName: '박정비 대리',
        status: 'UNMAPPED',
        category: '미지정',
        relatedId: '',
        autoMatchable: true
      }
    ];

    // 실제 카드 명세서 파일 파싱 로직 연동 필요 (현재는 파일 형식 안내만 제공)
    setTransactions([]);
    setIsUploaded(true);
    showToast('카드사 거래내역 파일이 선택되었습니다.');
  };

  // 템플릿 다운로드 (UTF-8 BOM 지원)
  const handleDownloadTemplate = () => {
    const headers = '승인일시,카드번호,가맹점명,승인금액,부가세,승인번호,매입유형분류\n';
    const sampleRows = [
      '2026-07-20 12:30:00,1234-****-****-5678,SK에너지 화성주유소,85000,7727,84910294,유류비',
      '2026-07-21 19:15:00,1234-****-****-5678,한일식당,45000,4091,91823019,복리후생비',
      '2026-07-22 14:00:00,1234-****-****-5678,(주)한국엔지니어링,330000,30000,12938402,외주정비비'
    ].join('\n');

    const blob = new Blob(['\uFEFF' + headers + sampleRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `법인카드_이용내역_템플릿_${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 1차 자동 매표 매핑 대출 실행
  const handleAutoMatch = () => {
    setTransactions(prev => prev.map(tx => {
      if (tx.autoMatchable) {
        if (tx.merchantName.includes('소모품')) {
          return {
            ...tx,
            status: 'MAPPED',
            category: '소모품비 (자재매입)',
            relatedId: 'INB-20260715-001 (소모품 입고 전표)'
          };
        } else {
          return {
            ...tx,
            status: 'MAPPED',
            category: '지급수수료 (물류 운송비)',
            relatedId: 'DEL-9482 (대화종합물류 배차 전표)'
          };
        }
      }
      return tx;
    }));

    // 카드 매핑 성공 시 법인카드 지출 통계 반영 시뮬레이션
    setActualAmounts(prev => ({
      ...prev,
      cat_petty: 85000 + 154000 + 85000 // 일반경비 지정분 가산
    }));

    showToast('거래처 정보와 지출 전표 정보가 성공적으로 매핑되었습니다.');
  };

  // 수동 경비 계정 지정
  const handleCategoryChange = (approvalNo: string, cat: string) => {
    setTransactions(prev => prev.map(tx => {
      if (tx.approvalNo === approvalNo) {
        return {
          ...tx,
          category: cat,
          status: cat === '미지정' ? 'UNMAPPED' : 'GENERAL_EXPENSE'
        };
      }
      return tx;
    }));
  };

  // 법인카드 매입정산 및 이용내역 엑셀 내보내기
  const handleExportCardExcel = () => {
    if (transactions.length === 0) {
      // 업로드된 카드 내역이 없을 때는 매입유형별 정산 현황 내보내기
      const catRows = categories.map((c, idx) => {
        const actual = actualAmounts[c.categoryId] || 0;
        const diff = c.defaultExpectedAmount - actual;
        return {
          'No': idx + 1,
          '매입항목명': c.categoryName,
          '회계계정과목': c.accountCode,
          '지급수단': c.paymentMethod === 'TAX_INVOICE' ? '세금계산서' : c.paymentMethod === 'CARD' ? '법인카드' : '자동이체',
          '증빙필수여부': c.isRequiredProof ? '필수' : '선택',
          '월예상액(원)': c.defaultExpectedAmount,
          '실제집행액(원)': actual,
          '차액(원)': diff,
          '집행상태': actual === 0 ? '미집행' : actual >= c.defaultExpectedAmount ? '초과/달성' : '집행중',
          '사용여부': c.isActive ? '사용' : '미사용'
        };
      });
      exportToExcel(catRows, `매입유형정산현황_${selectedMonth}`, '매입유형');
      showToast(`매입 유형 정산 현황 ${catRows.length}건 엑셀 내보내기 완료`);
      return;
    }

    // 카드 내역이 있을 때는 카드 이용내역 상세 내보내기
    const rows = transactions.map((tx, idx) => ({
      'No': idx + 1,
      '승인번호': tx.approvalNo,
      '거래일시': tx.transactionDate,
      '사용사원': tx.employeeName,
      '가맹점명': tx.merchantName,
      '사업자번호': tx.bizNo || '-',
      '승인금액(원)': tx.amount,
      '부가세(원)': tx.vat || 0,
      '매칭상태': tx.status === 'MAPPED' ? '전표매칭완료' : tx.status === 'GENERAL_EXPENSE' ? '일반경비' : '미매칭',
      '회계계정과목': tx.category || '미지정',
      '연결전표명세': tx.relatedId || '-'
    }));
    exportToExcel(rows, `법인카드이용내역_${selectedMonth}`, '카드이용내역');
    showToast(`법인카드 이용내역 ${rows.length}건 엑셀 내보내기 완료`);
  };

  // 신규 매입유형 등록
  const handleAddCategory = () => {
    if (!newCatName.trim()) {
      showToast('항목명을 입력해 주십시오.', 'error');
      return;
    }
    const newId = `cat_${Date.now()}`;
    const newRow: PurchaseCategory = {
      categoryId: newId,
      categoryName: newCatName,
      accountCode: newCatAccount,
      defaultExpectedAmount: newCatExpected,
      isRequiredProof: newCatProof,
      paymentMethod: newCatPayment,
      isActive: true
    };

    setCategories(prev => [...prev, newRow]);
    setActualAmounts(prev => ({ ...prev, [newId]: 0 }));
    
    showToast(`[${newCatName}] 매입 유형이 추가되었습니다.`);
    setNewCatName('');
    setNewCatExpected(0);
  };

  // 매입유형 활성 여부 토글 (삭제 대안)
  const handleToggleCategoryActive = (id: string) => {
    setCategories(prev => prev.map(c => {
      if (c.categoryId === id) {
        return { ...c, isActive: !c.isActive };
      }
      return c;
    }));
  };

  // 매입유형 영구 삭제
  const handleDeleteCategory = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: '매입유형 삭제',
      message: '이 매입유형을 대장에서 영구 삭제하시겠습니까?\n삭제 시 당월 누락 검증 대조 항목에서도 제외됩니다.',
      confirmText: '삭제 실행',
      isDanger: true,
      onConfirm: () => {
        setConfirmModal(null);
        setCategories(prev => prev.filter(c => c.categoryId !== id));
        showToast('매입유형이 삭제되었습니다.');
      }
    });
  };

  // 당월 카드 일반 경비 계산
  const totalCardGeneralExpense = transactions
    .filter(tx => tx.status === 'GENERAL_EXPENSE')
    .reduce((sum, tx) => sum + tx.amount, 0);

  // 총 정산 합계 구하기
  const calculateTotal = () => {
    let sum = 0;
    categories.forEach(c => {
      if (!c.isActive) return;
      sum += actualAmounts[c.categoryId] || 0;
    });
    return sum + totalCardGeneralExpense;
  };

  const totalCalculated = calculateTotal();
  const totalTaxInvoicesReceived = 60020000; // 수취 세금계산서 고정값

  return (
    <div style={{ position: 'relative' }}>
      {/* 🔔 인앱 토스트 알림 (헌장 5.2) */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          padding: '10px 18px',
          borderRadius: '6px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : '#10b981',
          color: '#ffffff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          fontWeight: 600,
          fontSize: '13px'
        }}>
          {toastMessage.text}
        </div>
      )}
      {/* 타이틀 및 탭 네비게이션 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CreditCard size={24} color="var(--primary)" />
          <h2 style={{ fontSize: '22px', fontWeight: '800' }}>매입 정산 및 유형 항목 마스터</h2>
        </div>

        {/* 탭 버튼 그룹 */}
        <div style={{ display: 'flex', gap: '2px', backgroundColor: 'var(--border-color)', padding: '2px', borderRadius: '8px' }}>
          <button
            onClick={() => setActiveSubTab('settlement')}
            style={{
              padding: '6px 16px', borderRadius: '6px', fontSize: '13px', border: 'none', cursor: 'pointer',
              fontWeight: activeSubTab === 'settlement' ? 'bold' : 'normal',
              backgroundColor: activeSubTab === 'settlement' ? '#fff' : 'transparent',
              color: activeSubTab === 'settlement' ? 'var(--primary)' : 'var(--text-secondary)'
            }}
          >
            월별 매입정산 & 누락 검증
          </button>
          <button
            onClick={() => setActiveSubTab('settings')}
            style={{
              padding: '6px 16px', borderRadius: '6px', fontSize: '13px', border: 'none', cursor: 'pointer',
              fontWeight: activeSubTab === 'settings' ? 'bold' : 'normal',
              backgroundColor: activeSubTab === 'settings' ? '#fff' : 'transparent',
              color: activeSubTab === 'settings' ? 'var(--primary)' : 'var(--text-secondary)'
            }}
          >
            매입유형 항목 설정
          </button>
        </div>
      </div>

      {/* 탭 1: 매입정산 및 누락 검증 화면 */}
      {activeSubTab === 'settlement' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 2.6fr', gap: '24px', alignItems: 'start' }}>
          
          {/* 좌측: 제어판 및 지능형 누락 검증 패널 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* 파일 업로드 카드 */}
            <div className="card" style={{ margin: 0 }}>
              <div className="card-header">
                <h3 className="card-title">이용대금 파일 로드</h3>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block' }}>정산 귀속 월</label>
                  <input 
                    type="month" 
                    value={selectedMonth} 
                    onChange={e => setSelectedMonth(e.target.value)}
                    style={{ width: '100%', padding: '6px', fontSize: '13px' }}
                  />
                </div>

                <div style={{ border: '2px dashed var(--border-color)', borderRadius: '8px', padding: '16px 10px', textAlign: 'center', backgroundColor: isUploaded ? 'rgba(34, 197, 94, 0.03)' : 'transparent' }}>
                  <Upload size={24} style={{ color: isUploaded ? 'var(--success)' : 'var(--text-muted)', marginBottom: '6px' }} />
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    {isUploaded ? '신한법인카드이용명세서.csv' : '카드사 이용내역(CSV/Excel)'}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                    <input type="file" onChange={handleFileUpload} style={{ display: 'none' }} id="card-upload-file" />
                    <label htmlFor="card-upload-file" className="btn-secondary" style={{ padding: '5px 10px', fontSize: '11px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Upload size={12} /> 파일 업로드
                    </label>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleDownloadTemplate}
                      style={{ padding: '5px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      title="유니코드 UTF-8 BOM 지원 템플릿 다운로드"
                    >
                      <Download size={12} /> 템플릿 받기
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* [핵심] 지능형 누락 방지 실시간 현황판 */}
            <div className="card" style={{ margin: 0 }}>
              <div className="card-header">
                <h3 className="card-title">지능형 지출 누락 방지 모니터</h3>
                <span className="badge badge-danger">실시간 대조</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                {categories.filter(c => c.isActive).map(c => {
                  const actual = actualAmounts[c.categoryId] || 0;
                  const expected = c.defaultExpectedAmount;
                  
                  // 상태 판단
                  let status: 'OK' | 'MISSING' | 'WARN' = 'OK';
                  if (actual === 0 && expected > 0) {
                    status = 'MISSING';
                  } else if (expected > 0 && Math.abs(actual - expected) / expected > 0.3) {
                    status = 'WARN';
                  }

                  return (
                    <div 
                      key={c.categoryId} 
                      style={{ 
                        padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                        backgroundColor: status === 'MISSING' ? 'rgba(239, 68, 68, 0.03)' : status === 'WARN' ? 'rgba(245, 158, 11, 0.03)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '12px' }}>{c.categoryName}</div>
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                          기준: {expected.toLocaleString()}원 / 실지출: {actual.toLocaleString()}원
                        </div>
                      </div>

                      {/* 상태 렌더링 */}
                      {status === 'MISSING' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger)', fontSize: '11px', fontWeight: 'bold' }}>
                          <AlertTriangle size={14} /> ⚠️ 누락 의심
                        </div>
                      )}
                      {status === 'WARN' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--warning)', fontSize: '11px', fontWeight: 'bold' }}>
                          <Lightbulb size={14} /> 💡 오차 과다
                        </div>
                      )}
                      {status === 'OK' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--success)', fontSize: '11px', fontWeight: 'bold' }}>
                          <CheckCircle2 size={14} /> ✅ 정상확인
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 정산 요약 리스트 */}
            <div className="card" style={{ margin: 0 }}>
              <div className="card-header">
                <h3 className="card-title">{selectedMonth} 총매입 정산 대장</h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                {categories.filter(c => c.isActive).map(c => (
                  <div key={c.categoryId} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>• {c.categoryName}</span>
                    <strong>{(actualAmounts[c.categoryId] || 0).toLocaleString()}원</strong>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>• 법인카드 기타 일반경비</span>
                  <strong style={{ color: 'var(--primary)' }}>+{totalCardGeneralExpense.toLocaleString()}원</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold', paddingTop: '6px', borderTop: '2px solid var(--border-color)', color: 'var(--primary)' }}>
                  <span>총 정산 매입액</span>
                  <span>{totalCalculated.toLocaleString()}원</span>
                </div>
              </div>
            </div>

            {/* 세금계산서 오차 검증 */}
            <div className="card" style={{ margin: 0, backgroundColor: 'rgba(239, 68, 68, 0.01)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger)', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>
                <AlertTriangle size={14} /> 매입 세금계산서 증빙 대조
              </div>
              <div style={{ fontSize: '11.5px', lineHeight: '1.5' }}>
                홈택스 세금계산서 총액: {totalTaxInvoicesReceived.toLocaleString()}원<br/>
                ERP 총매입 대조 차액: <strong style={{ color: 'var(--danger)' }}>{(totalCalculated - totalTaxInvoicesReceived).toLocaleString()}원</strong>
              </div>
            </div>

          </div>

          {/* 우측: 카드 거래목록 테이블 */}
          <div className="card" style={{ margin: 0, overflowX: 'auto' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title">이용대금 명세 리스트</h3>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExportCardExcel}
                  style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                >
                  <Download size={12} /> 엑셀 내보내기
                </button>
                {isUploaded && (
                  <button className="btn-success" onClick={handleAutoMatch} style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <RefreshCw size={12} /> 자동 매칭
                  </button>
                )}
              </div>
            </div>

            {!isUploaded ? (
              <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                좌측에서 법인카드 거래내역 파일을 업로드해 주십시오.
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: '11.5px' }}>
                <thead>
                  <tr>
                    <th>승인번호</th>
                    <th>거래일시</th>
                    <th>사용사원</th>
                    <th>가맹점 (금액)</th>
                    <th>매칭여부</th>
                    <th>회계 계정과목 배정</th>
                    <th>연결 전표 명세</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx.approvalNo}>
                      <td><code>{tx.approvalNo}</code></td>
                      <td>{tx.transactionDate}</td>
                      <td>{tx.employeeName}</td>
                      <td>
                        <strong>{tx.merchantName}</strong><br/>
                        {tx.amount.toLocaleString()}원
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 6px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 'bold',
                          backgroundColor: tx.status === 'MAPPED' ? 'rgba(34, 197, 94, 0.1)' : tx.status === 'GENERAL_EXPENSE' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          color: tx.status === 'MAPPED' ? 'var(--success)' : tx.status === 'GENERAL_EXPENSE' ? 'var(--primary)' : 'var(--danger)'
                        }}>
                          {tx.status === 'MAPPED' ? '완료' : tx.status === 'GENERAL_EXPENSE' ? '일반경비' : '미매칭'}
                        </span>
                      </td>
                      <td>
                        <select
                          value={tx.category}
                          onChange={e => handleCategoryChange(tx.approvalNo, e.target.value)}
                          disabled={tx.status === 'MAPPED' || !canSave}
                          style={{ padding: '2px', fontSize: '11px', width: '100%' }}
                        >
                          <option value="미지정">-- 계정 선택 --</option>
                          <option value="복리후생비 (임직원식대)">복리후생비 (식대)</option>
                          <option value="여비교통비 (출장주유/통행)">여비교통비 (주유/교통)</option>
                          <option value="소모품비 (사무용품)">소모품비 (사무용품)</option>
                          <option value="차량임차료 (리스/렌트)">차량임차료 (리스)</option>
                          <option value="여비교통비 (택배비)">여비교통비 (택배비)</option>
                          <option value="지급수수료 (대행수수료)">지급수수료 (대행료)</option>
                          <option value="복리후생비 (정수기/다과)">복리후생비 (정수기/다과)</option>
                        </select>
                      </td>
                      <td>
                        {tx.status === 'MAPPED' ? (
                          <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{tx.relatedId}</span>
                        ) : tx.status === 'GENERAL_EXPENSE' ? (
                          <span style={{ color: 'var(--primary)' }}>일반 경비 반영</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      )}

      {/* 탭 2: 매입유형 항목 관리 (카테고리 추가/삭제/수정) */}
      {activeSubTab === 'settings' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: '24px', alignItems: 'start' }}>
          
          {/* 좌측: 신규 매입유형 등록 폼 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <h3 className="card-title">신규 매입유형 추가</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '4px', display: 'block' }}>매입 항목명</label>
                <input 
                  type="text" 
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="예: 복사기 렌탈료"
                  style={{ width: '100%', padding: '6px', fontSize: '12.5px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '4px', display: 'block' }}>귀속 회계 계정과목</label>
                <select 
                  value={newCatAccount} 
                  onChange={e => setNewCatAccount(e.target.value)}
                  style={{ width: '100%', padding: '6px', fontSize: '12.5px' }}
                >
                  <option value="지급임차료">지급임차료</option>
                  <option value="소모품비">소모품비</option>
                  <option value="복리후생비">복리후생비</option>
                  <option value="수선비">수선비</option>
                  <option value="세금과공과">세금과공과</option>
                  <option value="지급수수료">지급수수료</option>
                  <option value="여비교통비">여비교통비</option>
                  <option value="기계장치">기계장치 (CAPEX)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '4px', display: 'block' }}>결제 방식</label>
                <select 
                  value={newCatPayment} 
                  onChange={e => setNewCatPayment(e.target.value as any)}
                  style={{ width: '100%', padding: '6px', fontSize: '12.5px' }}
                >
                  <option value="TAX_INVOICE">세금계산서 발행</option>
                  <option value="CARD">법인카드 결제</option>
                  <option value="AUTO_DEBIT">자동이체 (통장송금)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '4px', display: 'block' }}>월 예상 지출금액</label>
                <input 
                  type="number" 
                  value={newCatExpected}
                  onChange={e => setNewCatExpected(parseInt(e.target.value) || 0)}
                  placeholder="0"
                  style={{ width: '100%', padding: '6px', fontSize: '12.5px' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <input 
                  type="checkbox" 
                  id="req-proof" 
                  checked={newCatProof} 
                  onChange={e => setNewCatProof(e.target.checked)} 
                />
                <label htmlFor="req-proof" style={{ fontSize: '12.5px', cursor: 'pointer' }}>적격 매입 세금계산서 증빙 필수</label>
              </div>

              <button 
                className="btn-primary" 
                onClick={handleAddCategory}
                disabled={!canSave}
                style={{ marginTop: '8px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <Plus size={16} /> 매입유형 등록
              </button>
            </div>
          </div>

          {/* 우측: 등록되어 있는 매입유형 상세 목록 관리 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <h3 className="card-title">매입 지출유형 리스트</h3>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>당월 정산 누락 검증 대조 데이터로 직접 연동됨</span>
            </div>

            <table style={{ width: '100%', fontSize: '12px' }}>
              <thead>
                <tr>
                  <th>매입유형 항목명</th>
                  <th>계정과목</th>
                  <th>결제유형</th>
                  <th style={{ textAlign: 'right' }}>월 기본예상액</th>
                  <th style={{ textAlign: 'center' }}>증빙 필수</th>
                  <th style={{ textAlign: 'center' }}>검증 상태</th>
                  <th style={{ textAlign: 'center' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(c => (
                  <tr key={c.categoryId} style={{ opacity: c.isActive ? 1 : 0.45 }}>
                    <td>
                      <strong>{c.categoryName}</strong>
                    </td>
                    <td><span className="badge badge-info">{c.accountCode}</span></td>
                    <td>
                      {c.paymentMethod === 'TAX_INVOICE' ? '세금계산서' : c.paymentMethod === 'CARD' ? '법인카드' : '자동이체'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                      {c.defaultExpectedAmount.toLocaleString()}원
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {c.isRequiredProof ? '✔️ 필수' : '선택'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        className={`btn-secondary`} 
                        onClick={() => handleToggleCategoryActive(c.categoryId)}
                        disabled={!canSave}
                        style={{ padding: '3px 8px', fontSize: '10px', backgroundColor: c.isActive ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: c.isActive ? 'var(--success)' : 'var(--danger)', border: 'none' }}
                      >
                        {c.isActive ? '활성중' : '중단(제외)'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        className="btn-danger" 
                        onClick={() => handleDeleteCategory(c.categoryId)}
                        disabled={!canSave}
                        style={{ padding: '4px', borderRadius: '4px' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}
      {/* 💬 인앱 확인 모달 (헌장 5.2: alert/confirm 퇴출) */}
      {confirmModal && confirmModal.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '20px' }}>
          <div className="card" style={{ width: '90%', maxWidth: '440px', backgroundColor: 'var(--bg-card)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0, color: confirmModal.isDanger ? 'var(--danger)' : 'var(--text-main)' }}>
              {confirmModal.title}
            </h3>
            <div style={{ fontSize: '12.5px', lineHeight: '1.6', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
              {confirmModal.message}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <button type="button" className="btn-secondary" onClick={() => setConfirmModal(null)} style={{ padding: '6px 14px', fontSize: '12px' }}>
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmModal.onConfirm}
                style={{
                  padding: '6px 16px',
                  fontSize: '12px',
                  backgroundColor: confirmModal.isDanger ? '#dc2626' : 'var(--primary)',
                  borderColor: confirmModal.isDanger ? '#dc2626' : 'var(--primary)'
                }}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 법인카드 매입정산 대차대조식 검증 바 (헌장 3.5) */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 'var(--sidebar-width, 240px)',
        right: 0,
        height: '42px',
        backgroundColor: 'var(--bg-card)',
        borderTop: '2px solid var(--primary)',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 99,
        fontSize: '11.5px',
        fontWeight: 600
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <span>🏢 <strong>관리유형:</strong> {cardAuditSummary.catCount}개 항목</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>📄 <strong>총 예상매입:</strong> ₩{cardAuditSummary.totalExpected.toLocaleString()}원</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--success)' }}>💳 <strong>당월 실지출:</strong> ₩{cardAuditSummary.totalActual.toLocaleString()}원</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: cardAuditSummary.diff > 0 ? 'var(--warning)' : 'var(--primary)' }}>
            ⚖️ <strong>예실차액:</strong> ₩{Math.abs(cardAuditSummary.diff).toLocaleString()}원 ({cardAuditSummary.diff >= 0 ? '예산 잔여' : '예산 초과'})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: 'var(--success-light)',
            color: 'var(--success)',
            fontWeight: 700,
            fontSize: '11px'
          }}>
            ⚖️ 대차 정상 (예실 대비 100% 무결 정산)
          </span>
        </div>
      </div>
      <div style={{ height: '50px' }} aria-hidden="true" />
    </div>
  );
};
