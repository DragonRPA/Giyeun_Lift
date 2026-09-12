// src/components/BusinessLicenseModal.tsx
// 사업자등록증 이미지/PDF Vision AI 분석 기반 고객 신규 등록 및 기존 정보 보완 모달
import React, { useState, useRef, useEffect } from 'react';
import { 
  X, Upload, FileText, CheckCircle2, AlertCircle, RefreshCw, 
  ArrowRight, ShieldCheck, Eye, Sparkles, Building2, CheckSquare, Square
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Customer } from '../services/db';
import { analyzeBusinessLicense, BusinessLicenseAnalysisResult, formatBizRegNo } from '../services/visionOcrService';
import { uploadToSupabaseStorage } from '../services/supabaseStorage';
import { checkSingleNtsStatus, NtsStatusResult } from '../services/ntsBusinessService';

interface BusinessLicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (customer: Customer, isNew: boolean) => void;
  targetCustomerId?: string; // 특정 기존 고객을 직접 지정하여 보완하는 경우
}

export const BusinessLicenseModal: React.FC<BusinessLicenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  targetCustomerId
}) => {
  const { customers, saveCustomer, showErrorModal } = useApp();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // 단계: 'UPLOAD' | 'ANALYZING' | 'RESULT'
  const [step, setStep] = useState<'UPLOAD' | 'ANALYZING' | 'RESULT'>('UPLOAD');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<BusinessLicenseAnalysisResult | null>(null);
  const [ntsResult, setNtsResult] = useState<NtsStatusResult | null>(null);
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 신규 등록 폼 상태
  const [newForm, setNewForm] = useState({
    name: '',
    bizRegNo: '',
    representative: '',
    repContact: '',
    repEmail: '',
    address: '',
    bizType: '',
    bizItem: '',
    taxOffice: '',
    openingDate: '',
    defaultBillingDay: 30,
    defaultStatementClosingDay: 25,
    paymentDueDay: 25
  });

  // 기존 고객 보완 항목 체크박스 상태
  const [diffSelections, setDiffSelections] = useState({
    bizRegNo: true,
    representative: true,
    address: true,
    bizType: true,
    bizItem: true,
    taxEmail: true,
    repContact: true,
    taxOffice: true,
    openingDate: true
  });

  // 모달 초기화
  useEffect(() => {
    if (isOpen) {
      setStep('UPLOAD');
      setSelectedFile(null);
      setFilePreview(null);
      setAnalysisResult(null);
      setMatchedCustomer(null);
      setIsSaving(false);
      if (targetCustomerId) {
        const found = customers.find(c => c.id === targetCustomerId);
        if (found) setMatchedCustomer(found);
      }
    }
  }, [isOpen, targetCustomerId, customers]);

  if (!isOpen) return null;

  // 1. 파일 선택 및 프리뷰 생성
  const handleFileChange = async (file: File) => {
    if (!file) return;

    setSelectedFile(file);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      setFilePreview(null); // PDF는 텍스트 아이콘 및 파일명 표시
    } else {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }

    // 자동 분석 실행
    await executeAnalysis(file);
  };

  // 2. Vision AI 분석 실행
  const executeAnalysis = async (file: File) => {
    setStep('ANALYZING');
    try {
      const result = await analyzeBusinessLicense(file);

      if (!result.success) {
        showErrorModal(result.error || '사업자등록증 분석에 실패했습니다. 파일을 확인해 주십시오.');
        setStep('UPLOAD');
        return;
      }

      setAnalysisResult(result);

      const cleanBizNoDigits = (result.bizRegNo || '').replace(/[^0-9]/g, '');

      // 국세청 홈택스 사업자 휴폐업 진위확인 실시간 조회
      let ntsData: NtsStatusResult | null = null;
      if (cleanBizNoDigits && cleanBizNoDigits.length === 10) {
        try {
          ntsData = await checkSingleNtsStatus(cleanBizNoDigits);
        } catch (e) {
          console.warn('[BusinessLicenseModal] NTS check error:', e);
        }
      }
      setNtsResult(ntsData);

      // 기존 고객사 매칭 탐색 (targetCustomerId 우선 ➔ bizRegNo 매칭 ➔ 상호 매칭)
      let matched: Customer | null = null;
      if (targetCustomerId) {
        matched = customers.find(c => c.id === targetCustomerId) || null;
      }

      if (!matched && cleanBizNoDigits) {
        matched = customers.find(c => (c.bizRegNo || '').replace(/[^0-9]/g, '') === cleanBizNoDigits) || null;
      }

      if (!matched && result.companyName) {
        const cleanExtractedName = result.companyName.replace(/주식회사|\(주\)/g, '').trim();
        matched = customers.find(c => {
          const cleanDbName = c.name.replace(/주식회사|\(주\)/g, '').trim();
          return cleanExtractedName.length >= 2 && cleanDbName === cleanExtractedName;
        }) || null;
      }

      setMatchedCustomer(matched);

      // 신규 폼 기본값 세팅
      setNewForm({
        name: result.companyName || '',
        bizRegNo: result.bizRegNo || '',
        representative: result.representative || '',
        repContact: result.repContact || '',
        repEmail: result.taxEmail || '',
        address: result.address || '',
        bizType: result.bizType || '',
        bizItem: result.bizItem || '',
        taxOffice: result.taxOffice || '',
        openingDate: result.openingDate || '',
        defaultBillingDay: 30,
        defaultStatementClosingDay: 25,
        paymentDueDay: 25
      });

      // 기존 고객이 있는 경우, 기존 데이터가 '미상'이거나 비어있는 항목만 기본 체크
      if (matched) {
        setDiffSelections({
          bizRegNo: !matched.bizRegNo || matched.bizRegNo === '미상' || matched.bizRegNo !== result.bizRegNo,
          representative: !matched.representative || matched.representative === '미상' || (!!result.representative && matched.representative !== result.representative),
          address: !matched.address || matched.address === '미상' || (!!result.address && matched.address !== result.address),
          bizType: !matched.bizType || (!!result.bizType && matched.bizType !== result.bizType),
          bizItem: !matched.bizItem || (!!result.bizItem && matched.bizItem !== result.bizItem),
          taxEmail: !matched.repEmail || matched.repEmail === '미상' || (!!result.taxEmail && matched.repEmail !== result.taxEmail),
          repContact: !matched.repContact || matched.repContact === '미상' || (!!result.repContact && matched.repContact !== result.repContact),
          taxOffice: !matched.taxOffice || (!!result.taxOffice && matched.taxOffice !== result.taxOffice),
          openingDate: !matched.openingDate || (!!result.openingDate && matched.openingDate !== result.openingDate)
        });
      }

      setStep('RESULT');
    } catch (err: any) {
      console.error('[BusinessLicenseModal] 분석 오류:', err);
      showErrorModal(err?.message || '사업자등록증 분석 처리 중 예외가 발생했습니다.');
      setStep('UPLOAD');
    }
  };

  // 3. 드래그 앤 드롭 핸들러
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // 4. 최종 저장 실행 (신규 등록 또는 정보 보완)
  const handleSave = async () => {
    if (!selectedFile || !analysisResult) return;
    setIsSaving(true);

    try {
      // 1) 스토리지 업로드 (증빙 영구 보존)
      let fileUrl = '';
      try {
        const cleanNo = (analysisResult.bizRegNo || 'cert').replace(/[^0-9]/g, '');
        const ext = selectedFile.name.split('.').pop() || 'png';
        const fileName = `${cleanNo}_${Date.now()}.${ext}`;
        const uploadRes = await uploadToSupabaseStorage({
          file: selectedFile,
          fileName,
          folder: 'customer_licenses'
        });
        if (uploadRes.success) {
          fileUrl = uploadRes.fileUrl;
        }
      } catch (uploadErr) {
        console.warn('[BusinessLicenseModal] 스토리지 업로드 경고 (DB 등록 속행):', uploadErr);
      }

      // 2) 분기 A: 신규 고객 등록
      if (!matchedCustomer) {
        if (!newForm.name.trim()) {
          showErrorModal('상호(법인명)는 필수 입력 항목입니다.');
          setIsSaving(false);
          return;
        }

        const isNtsClosed = ntsResult?.status === 'CLOSED';
        const newCustData: Omit<Customer, 'id' | 'createdAt'> = {
          name: newForm.name.trim(),
          bizRegNo: newForm.bizRegNo.trim() || '미상',
          representative: newForm.representative.trim() || '미상',
          repContact: newForm.repContact.trim() || '미상',
          repEmail: newForm.repEmail.trim() || '미상',
          address: newForm.address.trim() || '미상',
          bizType: newForm.bizType.trim() || undefined,
          bizItem: newForm.bizItem.trim() || undefined,
          taxOffice: newForm.taxOffice.trim() || undefined,
          openingDate: newForm.openingDate.trim() || undefined,
          businessCertFileUrl: fileUrl || undefined,
          isClosed: isNtsClosed,
          transactionStatus: isNtsClosed ? 'BLOCKED' : 'ALLOWED',
          taxType: ntsResult?.taxType,
          taxTypeCd: ntsResult?.taxTypeCd,
          businessStatus: ntsResult?.status || 'ACTIVE',
          closedDate: ntsResult?.closedDate,
          lastStatusCheckDate: ntsResult?.checkedAt,
          defaultBillingDay: newForm.defaultBillingDay || 30,
          defaultStatementClosingDay: newForm.defaultStatementClosingDay || 25,
          paymentDueDay: newForm.paymentDueDay || 25
        };

        const saved = await saveCustomer(newCustData);
        onSuccess?.(saved, true);
        onClose();
        return;
      }

      // 3) 분기 B: 기존 고객 정보 보완 (Diff 적용)
      const isNtsClosed = ntsResult?.status === 'CLOSED';
      const updatedCust: Customer = {
        ...matchedCustomer,
        bizRegNo: (diffSelections.bizRegNo && analysisResult.bizRegNo) ? analysisResult.bizRegNo : matchedCustomer.bizRegNo,
        representative: (diffSelections.representative && analysisResult.representative) ? analysisResult.representative : matchedCustomer.representative,
        address: (diffSelections.address && analysisResult.address) ? analysisResult.address : matchedCustomer.address,
        bizType: (diffSelections.bizType && analysisResult.bizType) ? analysisResult.bizType : matchedCustomer.bizType,
        bizItem: (diffSelections.bizItem && analysisResult.bizItem) ? analysisResult.bizItem : matchedCustomer.bizItem,
        repEmail: (diffSelections.taxEmail && analysisResult.taxEmail) ? analysisResult.taxEmail : matchedCustomer.repEmail,
        repContact: (diffSelections.repContact && analysisResult.repContact) ? analysisResult.repContact : matchedCustomer.repContact,
        taxOffice: (diffSelections.taxOffice && analysisResult.taxOffice) ? analysisResult.taxOffice : matchedCustomer.taxOffice,
        openingDate: (diffSelections.openingDate && analysisResult.openingDate) ? analysisResult.openingDate : matchedCustomer.openingDate,
        businessCertFileUrl: fileUrl || matchedCustomer.businessCertFileUrl,
        taxType: ntsResult?.taxType || matchedCustomer.taxType,
        taxTypeCd: ntsResult?.taxTypeCd || matchedCustomer.taxTypeCd,
        businessStatus: ntsResult?.status || matchedCustomer.businessStatus,
        closedDate: ntsResult?.closedDate || matchedCustomer.closedDate,
        lastStatusCheckDate: ntsResult?.checkedAt || matchedCustomer.lastStatusCheckDate,
        isClosed: isNtsClosed ? true : matchedCustomer.isClosed,
        transactionStatus: isNtsClosed ? 'BLOCKED' : matchedCustomer.transactionStatus,
        updatedAt: new Date().toISOString()
      };

      const saved = await saveCustomer(updatedCust);
      onSuccess?.(saved, false);
      onClose();
    } catch (err: any) {
      console.error('[BusinessLicenseModal] 저장 실패:', err);
      showErrorModal(err?.message || '고객 정보 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* 상단 헤더 (3.1 무수식어 건조 표준) */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <FileText size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
                사업자등록증 고객 등록 / 정보 보완
                {step === 'RESULT' && (
                  <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                    matchedCustomer 
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}>
                    {matchedCustomer ? '기존 고객 정보 보완' : '신규 고객 자동 등록'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {step === 'UPLOAD' && '사업자등록증 이미지(카톡/문자 사진) 또는 PDF 파일을 업로드하세요.'}
                {step === 'ANALYZING' && 'AI 멀티모달 비전 엔진이 사업자등록증을 분석 중입니다...'}
                {step === 'RESULT' && (matchedCustomer 
                  ? `일치 고객 [${matchedCustomer.name}]을 발견했습니다. 누락 항목을 확인하고 보완하세요.` 
                  : '등록되지 않은 신규 사업자입니다. 추출된 정보를 확인 후 등록하세요.')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving || step === 'ANALYZING'}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 작업대 (Gutenberg Z-Pattern 중앙 영역) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          
          {/* [단계 1] 업로드 드롭존 */}
          {step === 'UPLOAD' && (
            <div className="space-y-4">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[260px] ${
                  isDragOver
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-700 hover:border-slate-500 bg-slate-800/40 hover:bg-slate-800/70'
                }`}
              >
                <div className="w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-3">
                  <Upload size={24} />
                </div>
                <p className="text-base font-medium text-white mb-1">
                  사업자등록증 파일 선택 또는 드래그 앤 드롭
                </p>
                <p className="text-xs text-slate-400 max-w-sm mb-4">
                  카카오톡/문자로 받은 사진(JPG, PNG), 전자발급 PDF, 스캔본을 모두 지원합니다.
                </p>

                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
                    PC / 앨범 파일 선택
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      cameraInputRef.current?.click();
                    }}
                    className="sm:hidden px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors"
                  >
                    📷 카메라 촬영
                  </button>
                </div>

                {/* 숨김 인풋 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                />
              </div>

              {targetCustomerId && matchedCustomer && (
                <div className="p-3 bg-slate-800/60 border border-slate-700 rounded-lg text-xs flex items-center justify-between">
                  <span className="text-slate-400">보완 대상 고객 지정됨:</span>
                  <span className="font-semibold text-amber-300">{matchedCustomer.name} ({matchedCustomer.bizRegNo || '사업자번호 미상'})</span>
                </div>
              )}
            </div>
          )}

          {/* [단계 2] 분석 진행 중 스피너 */}
          {step === 'ANALYZING' && (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 animate-spin">
                <RefreshCw size={24} />
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-white">AI 사업자등록증 정밀 판독 중</p>
                <p className="text-xs text-slate-400">상호, 사업자번호, 대표자, 소재지, 업태/종목을 추출하고 있습니다.</p>
              </div>
              {selectedFile && (
                <div className="px-3 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
              )}
            </div>
          )}

          {/* [단계 3] 판독 결과 대사 및 확인 (Z-Pattern 중앙) */}
          {step === 'RESULT' && analysisResult && (
            <div className="space-y-5">
              
              {/* 상단 파일 요약 칩 */}
              <div className="flex items-center justify-between p-3 bg-slate-800/80 border border-slate-700 rounded-lg text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileText size={15} className="text-blue-400 shrink-0" />
                  <span className="text-slate-300 truncate font-medium">{selectedFile?.name}</span>
                  <span className="text-slate-500 shrink-0">({analysisResult.sourceType || 'IMAGE'})</span>
                </div>
                <button
                  onClick={() => setStep('UPLOAD')}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
                >
                  다른 파일 재업로드
                </button>
              </div>

              {/* 🏛️ 국세청 홈택스 실시간 휴폐업 및 과세유형 진위확인 카드 */}
              {ntsResult && (
                <div className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                  ntsResult.status === 'ACTIVE'
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                    : ntsResult.status === 'CLOSED'
                    ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                    : ntsResult.status === 'SUSPENDED'
                    ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  <div className="flex items-center gap-2.5">
                    {ntsResult.status === 'ACTIVE' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-bold flex items-center gap-2">
                        <span>국세청 홈택스:</span>
                        <span className="underline decoration-1">{ntsResult.statusLabel}</span>
                        {ntsResult.closedDate && (
                          <span className="text-rose-400 font-mono text-[11px]">
                            (폐업일: {ntsResult.closedDate})
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] opacity-80 mt-0.5">
                        과세유형: {ntsResult.taxType} • 조회일시: {ntsResult.checkedAt.slice(0, 16).replace('T', ' ')}
                        {ntsResult.status === 'CLOSED' && ' • 자동 출고제한(BLOCKED) 적용 대상'}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-black/40 border border-white/10 shrink-0">
                    {ntsResult.source === 'NTS_LIVE_API' ? '홈택스 공적 API' : '체크섬 인증'}
                  </span>
                </div>
              )}

              {/* 분기 1: 기존 고객 정보 보완 (1:1 Diff Table) */}
              {matchedCustomer ? (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-200 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-amber-300">[{matchedCustomer.name}]</span> 기존 등록 데이터와 일치합니다.
                      <p className="text-slate-400 text-[11px] mt-0.5">사업자등록증에서 새로 판독된 항목을 선택하여 갱신하세요.</p>
                    </div>
                    <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 rounded font-mono text-[11px]">
                      {matchedCustomer.id}
                    </span>
                  </div>

                  {/* 1:1 대사 그리드 테이블 */}
                  <div className="border border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-800/90 text-slate-400 border-b border-slate-700 uppercase font-medium">
                        <tr>
                          <th className="p-2.5 w-10 text-center">적용</th>
                          <th className="p-2.5 w-24">항목</th>
                          <th className="p-2.5">기존 ERP 값</th>
                          <th className="p-2.5 text-emerald-400">사업자등록증 추출 값</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-900/60">
                        {/* 1. 사업자등록번호 */}
                        <tr className="hover:bg-slate-800/40">
                          <td className="p-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={diffSelections.bizRegNo}
                              onChange={(e) => setDiffSelections({ ...diffSelections, bizRegNo: e.target.checked })}
                              className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">사업자등록번호</td>
                          <td className="p-2.5 text-slate-400 font-mono">{matchedCustomer.bizRegNo || '미상'}</td>
                          <td className="p-2.5 text-emerald-300 font-mono font-semibold">
                            {analysisResult.bizRegNo || '(미추출)'}
                          </td>
                        </tr>

                        {/* 2. 대표자명 */}
                        <tr className="hover:bg-slate-800/40">
                          <td className="p-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={diffSelections.representative}
                              onChange={(e) => setDiffSelections({ ...diffSelections, representative: e.target.checked })}
                              className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">대표자</td>
                          <td className="p-2.5 text-slate-400">{matchedCustomer.representative || '미상'}</td>
                          <td className="p-2.5 text-emerald-300 font-semibold">
                            {analysisResult.representative || '(미추출)'}
                          </td>
                        </tr>

                        {/* 3. 사업장 소재지 */}
                        <tr className="hover:bg-slate-800/40">
                          <td className="p-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={diffSelections.address}
                              onChange={(e) => setDiffSelections({ ...diffSelections, address: e.target.checked })}
                              className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">사업장 소재지</td>
                          <td className="p-2.5 text-slate-400">{matchedCustomer.address || '미상'}</td>
                          <td className="p-2.5 text-emerald-300 font-semibold">
                            {analysisResult.address || '(미추출)'}
                          </td>
                        </tr>

                        {/* 4. 업태 */}
                        <tr className="hover:bg-slate-800/40">
                          <td className="p-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={diffSelections.bizType}
                              onChange={(e) => setDiffSelections({ ...diffSelections, bizType: e.target.checked })}
                              className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">업태</td>
                          <td className="p-2.5 text-slate-400">{matchedCustomer.bizType || '(미등록)'}</td>
                          <td className="p-2.5 text-emerald-300 font-semibold">
                            {analysisResult.bizType || '(미추출)'}
                          </td>
                        </tr>

                        {/* 5. 종목 */}
                        <tr className="hover:bg-slate-800/40">
                          <td className="p-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={diffSelections.bizItem}
                              onChange={(e) => setDiffSelections({ ...diffSelections, bizItem: e.target.checked })}
                              className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">종목</td>
                          <td className="p-2.5 text-slate-400">{matchedCustomer.bizItem || '(미등록)'}</td>
                          <td className="p-2.5 text-emerald-300 font-semibold">
                            {analysisResult.bizItem || '(미추출)'}
                          </td>
                        </tr>

                        {/* 6. 세금계산서 이메일 */}
                        {analysisResult.taxEmail && (
                          <tr className="hover:bg-slate-800/40">
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={diffSelections.taxEmail}
                                onChange={(e) => setDiffSelections({ ...diffSelections, taxEmail: e.target.checked })}
                                className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">세금계산서 이메일</td>
                            <td className="p-2.5 text-slate-400">{matchedCustomer.repEmail || '미상'}</td>
                            <td className="p-2.5 text-emerald-300 font-semibold">
                              {analysisResult.taxEmail}
                            </td>
                          </tr>
                        )}

                        {/* 7. 대표 연락처 */}
                        {analysisResult.repContact && (
                          <tr className="hover:bg-slate-800/40">
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={diffSelections.repContact}
                                onChange={(e) => setDiffSelections({ ...diffSelections, repContact: e.target.checked })}
                                className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">대표 연락처</td>
                            <td className="p-2.5 text-slate-400">{matchedCustomer.repContact || '미상'}</td>
                            <td className="p-2.5 text-emerald-300 font-semibold">
                              {analysisResult.repContact}
                            </td>
                          </tr>
                        )}

                        {/* 8. 관할 세무서 */}
                        {analysisResult.taxOffice && (
                          <tr className="hover:bg-slate-800/40">
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={diffSelections.taxOffice}
                                onChange={(e) => setDiffSelections({ ...diffSelections, taxOffice: e.target.checked })}
                                className="rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2.5 font-medium text-slate-300 whitespace-nowrap">관할 세무서</td>
                            <td className="p-2.5 text-slate-400">{matchedCustomer.taxOffice || '(미등록)'}</td>
                            <td className="p-2.5 text-emerald-300 font-semibold">
                              {analysisResult.taxOffice}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* 분기 2: 신규 고객 등록 폼 (3.4 상하 스택 레이아웃 표준) */
                <div className="space-y-3.5">
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-200">
                    <span className="font-semibold text-emerald-300">신규 고객사 자동 감지</span> — 사업자등록증에서 추출된 데이터가 자동 입력되었습니다.
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* 상호 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">상호 (법인명) *</label>
                      <input
                        type="text"
                        value={newForm.name}
                        onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 사업자등록번호 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">사업자등록번호 *</label>
                      <input
                        type="text"
                        value={newForm.bizRegNo}
                        onChange={(e) => setNewForm({ ...newForm, bizRegNo: formatBizRegNo(e.target.value) })}
                        placeholder="000-00-00000"
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 대표자 성명 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">대표자 성명</label>
                      <input
                        type="text"
                        value={newForm.representative}
                        onChange={(e) => setNewForm({ ...newForm, representative: e.target.value })}
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 대표 연락처 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">대표 연락처</label>
                      <input
                        type="text"
                        value={newForm.repContact}
                        onChange={(e) => setNewForm({ ...newForm, repContact: e.target.value })}
                        placeholder="010-0000-0000"
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 사업장 소재지 */}
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <label className="text-xs text-slate-300 font-medium">사업장 소재지 (주소)</label>
                      <input
                        type="text"
                        value={newForm.address}
                        onChange={(e) => setNewForm({ ...newForm, address: e.target.value })}
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 업태 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">업태</label>
                      <input
                        type="text"
                        value={newForm.bizType}
                        onChange={(e) => setNewForm({ ...newForm, bizType: e.target.value })}
                        placeholder="예: 건설업"
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 종목 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">종목</label>
                      <input
                        type="text"
                        value={newForm.bizItem}
                        onChange={(e) => setNewForm({ ...newForm, bizItem: e.target.value })}
                        placeholder="예: 고소작업대 임대"
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 세금계산서 이메일 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">세금계산서 수신 이메일</label>
                      <input
                        type="email"
                        value={newForm.repEmail}
                        onChange={(e) => setNewForm({ ...newForm, repEmail: e.target.value })}
                        placeholder="tax@company.com"
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* 관할 세무서 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300 font-medium">관할 세무서</label>
                      <input
                        type="text"
                        value={newForm.taxOffice}
                        onChange={(e) => setNewForm({ ...newForm, taxOffice: e.target.value })}
                        placeholder="예: 평택세무서"
                        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 하단 완결 액션 바 (Gutenberg Z-Pattern 우하단 Terminal Action) */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {step === 'RESULT' && (
              <span>증빙 원본 파일이 사내 스토리지에 자동 보관됩니다.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
            >
              닫기
            </button>
            {step === 'RESULT' && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={`px-4 py-2 rounded-lg text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  matchedCustomer 
                    ? 'bg-amber-600 hover:bg-amber-500' 
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {isSaving ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    저장 중...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    {matchedCustomer ? '고객 정보 보완 및 갱신' : '신규 고객 등록'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
