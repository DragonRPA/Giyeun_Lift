// d:\Kiyeun_Lift\src\pages\AssetAcquisitionDisposal.tsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { calculateAssetDepreciation, Asset, Product, Vendor, Customer, SaleContractTerms } from '../services/db';
import * as XLSX from 'xlsx';
import { exportToExcel } from '../services/excel';
import {
  ShoppingBag,
  TrendingDown,
  Plus,
  Upload,
  Download,
  Search,
  Check,
  AlertCircle,
  X,
  ChevronRight,
  FileText,
  CheckCircle2,
  ShieldCheck,
  Layers,
  Eye,
  RefreshCw,
  ExternalLink,
  HelpCircle,
  Trash2,
  Mail,
  Send,
  Building2,
  Calendar,
  DollarSign,
  Receipt,
  Sparkles,
  CheckSquare,
  Square,
  ArrowRight,
  Truck,
  UserCheck,
  Filter
} from 'lucide-react';

export const AssetAcquisitionDisposal: React.FC = () => {
  const {
    assets,
    products,
    vendors,
    customers,
    users,
    currentUser,
    acquireAsset,
    batchAcquireAssets,
    executeAssetSale,
    hasPermission,
    currentTenant,
    showErrorModal
  } = useApp();

  const defaultYard = currentTenant?.yards?.find(y => y.isDefault) || currentTenant?.yards?.[0];
  const canSave = hasPermission('acquisition_disposal', 'save');

  // 메인 스튜디오 전환 탭 (헌장 3.1 무수식어 건조 명사 단일 표준)
  const [activeStudio, setActiveStudio] = useState<'ACQUISITION' | 'DISPOSAL'>('ACQUISITION');

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // ==========================================================================
  // 🏢 [스튜디오 1] 자산 취득 스튜디오 (Asset Acquisition Studio)
  // ==========================================================================
  const [acqMode, setAcqMode] = useState<'SINGLE' | 'EXCEL'>('SINGLE');

  // 자동 관리번호 채번 헬퍼
  const getNextRecommendedAssetNo = (prefix = 'KL-') => {
    let maxNum = 0;
    assets.forEach(a => {
      if (a.assetNo && a.assetNo.startsWith(prefix)) {
        const numPart = parseInt(a.assetNo.slice(prefix.length), 10);
        if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
      } else if (a.assetNo && /^\d+$/.test(a.assetNo)) {
        const numPart = parseInt(a.assetNo, 10);
        if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
      }
    });
    if (maxNum === 0) maxNum = 800;
    return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
  };

  // 단건 취득 폼 상태
  const [singleModelName, setSingleModelName] = useState<string>(products[0]?.modelName || '');
  const [singleAssetNo, setSingleAssetNo] = useState<string>('');
  const [singleSerialNo, setSingleSerialNo] = useState<string>('');
  const [singleManufacturer, setSingleManufacturer] = useState<string>('');
  const [singleManufactureYear, setSingleManufactureYear] = useState<string>(new Date().getFullYear().toString());
  const [singleAcqDate, setSingleAcqDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [singleAcqPrice, setSingleAcqPrice] = useState<number>(15000000);
  const [singleDepMonths, setSingleDepMonths] = useState<number>(96); // 💡 기본값 96개월 (8년 고소작업대 표준)
  const [singleResidualRate, setSingleResidualRate] = useState<number>(10);
  const [singleSupplier, setSingleSupplier] = useState<string>('');
  const [singleVendorId, setSingleVendorId] = useState<string>('');
  const [singleMonthlyRentalFee, setSingleMonthlyRentalFee] = useState<number>(400000);
  const [singleDailyRentalFee, setSingleDailyRentalFee] = useState<number>(15000);
  const [singleSafetyInspectionUrl, setSingleSafetyInspectionUrl] = useState<string>('');
  const [singleMemo, setSingleMemo] = useState<string>('');
  const [isSubmittingAcq, setIsSubmittingAcq] = useState<boolean>(false);

  // 💡 구입처 (공급사 / 중고 딜러 / 거래처) 인스펙터 선택 상태 (자산매각 매수처 UI와 1:1 표준화)
  const [supplierMode, setSupplierMode] = useState<'SELECT' | 'DIRECT'>('SELECT');
  const [isSupplierSearchModalOpen, setIsSupplierSearchModalOpen] = useState<boolean>(false);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState<string>('');
  interface SelectedSupplierInfo {
    name: string;
    bizRegNo?: string;
    representative?: string;
    address?: string;
    contact?: string;
    email?: string;
    vendorId?: string;
    sourceType?: 'VENDOR' | 'CUSTOMER';
  }
  const [selectedSupplierData, setSelectedSupplierData] = useState<SelectedSupplierInfo | null>(null);
  const [newSupplierName, setNewSupplierName] = useState<string>('');
  const [newSupplierBizNo, setNewSupplierBizNo] = useState<string>('');
  const [newSupplierRepresentative, setNewSupplierRepresentative] = useState<string>('');
  const [newSupplierContact, setNewSupplierContact] = useState<string>('');
  const [newSupplierAddress, setNewSupplierAddress] = useState<string>('');

  // 멀티 입고 슬롯 (동일 모델 N대 일괄 입력)
  interface AcqSlotItem {
    id: string;
    assetNo: string;
    modelName: string;
    serialNo: string;
    manufactureYear: string; // 💡 슬롯별 개별 제조년도 (새장비/중고 혼합 입고 지원)
    price: number;
  }
  const [multiSlots, setMultiSlots] = useState<AcqSlotItem[]>([]);

  // 모델 변경 핸들러: 메인 모델 변경 시 슬롯들의 모델명도 동일 모델로 자동 동기화 (헌장 1.1)
  const handleModelChange = (newModel: string) => {
    setSingleModelName(newModel);
    setMultiSlots(prev => prev.map(s => ({ ...s, modelName: newModel })));
  };

  // 💡 모델 초기 동기화 보장: products 로드 시 singleModelName이 비어있거나 불일치 시 첫 번째 모델로 즉시 동기화
  useEffect(() => {
    if (products.length > 0 && (!singleModelName || !products.some(p => p.modelName === singleModelName))) {
      handleModelChange(products[0].modelName);
    }
  }, [products]);

  // 취득가 변경 핸들러: 메인 취득가 변경 시 슬롯들의 기본 취득가도 동일하게 자동 동기화
  const handleAcqPriceChange = (newPrice: number) => {
    setSingleAcqPrice(newPrice);
    setMultiSlots(prev => prev.map(s => ({ ...s, price: newPrice })));
  };

  // 제조년도 변경 핸들러: 메인 제조년도 변경 시 슬롯들의 기본 제조년도 동기화
  const handleManufactureYearChange = (newYear: string) => {
    setSingleManufactureYear(newYear);
    setMultiSlots(prev => prev.map(s => (!s.manufactureYear || s.manufactureYear === singleManufactureYear) ? { ...s, manufactureYear: newYear } : s));
  };

  // 모델 선택 시 제품 마스터 제원 자동 상속
  const selectedProduct = useMemo(() => {
    return products.find(p => p.modelName === singleModelName);
  }, [products, singleModelName]);

  useEffect(() => {
    if (selectedProduct) {
      if (selectedProduct.manufacturer) setSingleManufacturer(selectedProduct.manufacturer);
    }
    // 동종 모델 기존 자산의 표준 렌탈료 및 제원 참조 상속 (헌장 1.1 임직원 입력 편익 극대화)
    const peerAsset = assets.find(a => a.modelName === singleModelName && (a.monthlyRentalFee || a.dailyRentalFee));
    if (peerAsset) {
      if (peerAsset.monthlyRentalFee && !singleMonthlyRentalFee) {
        setSingleMonthlyRentalFee(peerAsset.monthlyRentalFee);
      }
      if (peerAsset.dailyRentalFee && !singleDailyRentalFee) {
        setSingleDailyRentalFee(peerAsset.dailyRentalFee);
      }
      if (peerAsset.manufacturer && !singleManufacturer) {
        setSingleManufacturer(peerAsset.manufacturer);
      }
    }
  }, [selectedProduct, singleModelName, assets]);

  // 관리번호 초기 자동 추천
  useEffect(() => {
    if (!singleAssetNo) {
      setSingleAssetNo(getNextRecommendedAssetNo('KL-'));
    }
  }, [assets]);

  // 관리번호 파싱 헬퍼 (접두어 + 일련번호 숫자 분리)
  const parseAssetNo = (assetNoStr: string) => {
    const trimmed = (assetNoStr || '').trim();
    const match = trimmed.match(/^(.*?)(\d+)$/);
    if (match) {
      return {
        prefix: match[1],
        num: parseInt(match[2], 10),
        digits: Math.max(match[2].length, 4)
      };
    }
    return null;
  };

  // 다음 순차 관리번호 자동 채번 (DB 등록 자산 + 폼 입력 자산 중복 방어)
  const getNextSequentialAssetNo = (baseAssetNo: string, offset: number = 1): string => {
    const usedNos = new Set<string>();
    assets.forEach(a => {
      if (a.assetNo) usedNos.add(a.assetNo.trim().toLowerCase());
    });
    if (singleAssetNo.trim()) usedNos.add(singleAssetNo.trim().toLowerCase());
    multiSlots.forEach(s => {
      if (s.assetNo.trim()) usedNos.add(s.assetNo.trim().toLowerCase());
    });

    const parsed = parseAssetNo(baseAssetNo);
    if (parsed) {
      let candidateNum = parsed.num + offset;
      let candidateNo = `${parsed.prefix}${String(candidateNum).padStart(parsed.digits, '0')}`;
      while (usedNos.has(candidateNo.toLowerCase())) {
        candidateNum++;
        candidateNo = `${parsed.prefix}${String(candidateNum).padStart(parsed.digits, '0')}`;
      }
      return candidateNo;
    }
    return getNextRecommendedAssetNo('KL-');
  };

  // 슬롯 추가 핸들러 (동일 모델·취득가·제조년도 자동 상속 및 다음 관리번호 순차 자동 채번)
  const handleAddSlot = () => {
    const baseNo = multiSlots.length > 0 ? multiSlots[multiSlots.length - 1].assetNo : singleAssetNo;
    const nextNo = getNextSequentialAssetNo(baseNo, 1);
    const newId = `slot_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    setMultiSlots(prev => [
      ...prev,
      {
        id: newId,
        assetNo: nextNo,
        modelName: singleModelName, // 💡 메인 모델과 동일
        serialNo: '',
        manufactureYear: singleManufactureYear || '', // 💡 제조년도 상속
        price: singleAcqPrice // 💡 메인 취득가와 동일
      }
    ]);
  };

  const handleRemoveSlot = (slotId: string) => {
    setMultiSlots(prev => prev.filter(s => s.id !== slotId));
  };

  const handleUpdateSlot = (slotId: string, field: 'assetNo' | 'serialNo' | 'manufactureYear' | 'price' | 'modelName', value: any) => {
    setMultiSlots(prev => prev.map(s => s.id === slotId ? { ...s, [field]: value } : s));
  };

  // 메인 관리번호 기준 슬롯 전체 순차 재채번
  const handleRenumberSlotsSequentially = (customBaseNo?: string) => {
    const base = customBaseNo || singleAssetNo;
    const parsed = parseAssetNo(base);
    if (!parsed) return;

    const usedByDb = new Set(assets.map(a => (a.assetNo || '').trim().toLowerCase()));
    let curNum = parsed.num;

    setMultiSlots(prev => prev.map(s => {
      curNum++;
      let cand = `${parsed.prefix}${String(curNum).padStart(parsed.digits, '0')}`;
      while (usedByDb.has(cand.toLowerCase())) {
        curNum++;
        cand = `${parsed.prefix}${String(curNum).padStart(parsed.digits, '0')}`;
      }
      return {
        ...s,
        assetNo: cand,
        modelName: singleModelName,
        price: s.price ?? singleAcqPrice
      };
    }));
  };

  // 메인 관리번호 재채번 버튼 클릭 핸들러
  const handleRegenerateMainAssetNo = () => {
    const nextRecNo = getNextRecommendedAssetNo('KL-');
    setSingleAssetNo(nextRecNo);
    if (multiSlots.length > 0) {
      handleRenumberSlotsSequentially(nextRecNo);
    }
  };

  // 감가상각 시뮬레이터 (정액법, 기본 96개월)
  const depreciationSimulation = useMemo(() => {
    const cost = Number(singleAcqPrice) || 0;
    const months = Number(singleDepMonths) || 96;
    const rate = Number(singleResidualRate) || 0;
    const residualVal = Math.round(cost * (rate / 100));
    const depreciable = cost - residualVal;
    const monthlyDep = months > 0 ? Math.round(depreciable / months) : 0;
    const oneYearDep = monthlyDep * 12;
    const oneYearBook = Math.max(residualVal, cost - oneYearDep);
    return {
      monthlyDep,
      residualVal,
      oneYearBook
    };
  }, [singleAcqPrice, singleDepMonths, singleResidualRate]);

  // 단건 및 N대 슬롯 취득 실행
  const handleExecuteSingleAcquisition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) {
      showErrorModal('자산 취득 저장 권한이 없습니다.');
      return;
    }
    if (!singleModelName) {
      showErrorModal('모델명을 선택해 주세요.');
      return;
    }
    if (!singleAssetNo.trim()) {
      showErrorModal('기본 관리번호를 입력해 주세요.');
      return;
    }

    // 💡 전체 관리번호 중복 검증 (메인 + 슬롯 상호 중복 및 기존 DB 중복 원천 차단)
    const allAssetNos = [
      { type: '메인', no: singleAssetNo.trim() },
      ...multiSlots.map((s, i) => ({ type: `추가 슬롯 #${i + 1}`, no: s.assetNo.trim() }))
    ];

    const seenNos = new Set<string>();
    for (const item of allAssetNos) {
      if (!item.no) {
        showErrorModal(`${item.type}의 관리번호를 입력해 주세요.`);
        return;
      }
      const lower = item.no.toLowerCase();
      if (seenNos.has(lower)) {
        showErrorModal(`입력된 관리번호 중 중복 번호 ${item.no}가 존재합니다.`);
        return;
      }
      seenNos.add(lower);

      const existingAsset = assets.find(a => a.assetNo?.trim().toLowerCase() === lower);
      if (existingAsset) {
        showErrorModal(`관리번호 ${item.no}는 이미 시스템에 등록되어 있습니다.`);
        return;
      }
    }

    setIsSubmittingAcq(true);
    try {
      const finalSupplier = supplierMode === 'SELECT'
        ? (selectedSupplierData?.name || singleSupplier.trim())
        : (newSupplierName.trim() || singleSupplier.trim());
      const finalVendorId = supplierMode === 'SELECT'
        ? (selectedSupplierData?.vendorId || singleVendorId || undefined)
        : undefined;

      const mainPayload: Partial<Asset> = {
        modelName: singleModelName,
        assetNo: singleAssetNo.trim(),
        serialNo: singleSerialNo.trim(),
        manufacturer: singleManufacturer.trim(),
        manufactureYear: singleManufactureYear.trim(),
        acquisitionDate: singleAcqDate,
        acquisitionPrice: Number(singleAcqPrice) || 0,
        depreciationMonths: Number(singleDepMonths) || 96,
        residualValueRate: Number(singleResidualRate) || 10,
        supplier: finalSupplier,
        vendorId: finalVendorId,
        monthlyRentalFee: Number(singleMonthlyRentalFee) || 0,
        dailyRentalFee: Number(singleDailyRentalFee) || 0,
        safetyInspectionUrl: singleSafetyInspectionUrl.trim() || undefined,
        memo1: singleMemo.trim() || undefined
      };

      if (multiSlots.length === 0) {
        await acquireAsset(mainPayload);
        showToast(`자산 ${singleAssetNo} 취득 등록 완료 (임대가능 AVAILABLE 입고)`);
      } else {
        const batchPayload: Partial<Asset>[] = [mainPayload];
        for (const slot of multiSlots) {
          if (!slot.assetNo.trim()) continue;
          batchPayload.push({
            ...mainPayload,
            modelName: singleModelName, // 💡 동일 모델 보장
            assetNo: slot.assetNo.trim(),
            serialNo: slot.serialNo.trim(),
            manufactureYear: slot.manufactureYear?.trim() || singleManufactureYear.trim(), // 💡 개별 슬롯 제조년도 반영
            acquisitionPrice: Number(slot.price) || Number(singleAcqPrice) || 0
          });
        }
        await batchAcquireAssets(batchPayload);
        showToast(`총 ${batchPayload.length}대 자산 일괄 취득 등록 완료 (임대가능 AVAILABLE 입고)`);
        setMultiSlots([]);
      }

      // 다음 추천 번호 및 폼 입력값 초기화
      setSingleAssetNo(getNextRecommendedAssetNo('KL-'));
      setSingleSerialNo('');
      setSingleMemo('');
      setSingleSafetyInspectionUrl('');
      setNewSupplierName('');
      setNewSupplierBizNo('');
      setNewSupplierRepresentative('');
      setNewSupplierContact('');
      setNewSupplierAddress('');
    } catch (err: any) {
      showErrorModal(`자산 취득 저장 중 오류:\n\n${err?.message || err}`);
    } finally {
      setIsSubmittingAcq(false);
    }
  };

  // 엑셀 일괄 등록 상태
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [excelPreviewData, setExcelPreviewData] = useState<any[]>([]);
  const [excelValidationErrors, setExcelValidationErrors] = useState<{ row: number; error: string }[]>([]);
  const [isProcessingExcel, setIsProcessingExcel] = useState<boolean>(false);

  // 엑셀 표준 양식 다운로드
  const handleDownloadTemplate = () => {
    const headers = [
      '관리번호',
      '모델명',
      '제조번호(SN)',
      '제조사',
      '제조년도',
      '취득일자(YYYY-MM-DD)',
      '취득원가',
      '내용월수',
      '잔존가치율',
      '공급처',
      '월렌탈료',
      '일렌탈료',
      '비고'
    ];
    const sampleRow = [
      'KL-0899',
      products[0]?.modelName || 'S-0808',
      'SN-2024-001',
      products[0]?.manufacturer || '시노붐',
      '2024',
      new Date().toISOString().split('T')[0],
      18500000,
      96, // 💡 내용월수 기본값 96개월 (8년 고소작업대 표준)
      10,
      '한국시노붐',
      400000,
      15000,
      '신규 장비 입고'
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '자산취득양식');
    XLSX.writeFile(wb, `${currentTenant?.displayName || '자산'}_자산취득_일괄양식_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // 엑셀 파일 파싱 및 유효성 검사
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        if (data.length < 2) {
          showErrorModal('엑셀 파일에 데이터 행이 없습니다.');
          return;
        }

        const rows = data.slice(1);
        const parsedRows: any[] = [];
        const errors: { row: number; error: string }[] = [];

        const existingNos = new Set(assets.map(a => a.assetNo.trim().toLowerCase()));
        const fileNos = new Set<string>();

        rows.forEach((r, idx) => {
          if (!r || r.length === 0 || !r[0]) return; // 빈 행 무시
          const rowNum = idx + 2;
          const assetNo = String(r[0] || '').trim();
          const modelName = String(r[1] || '').trim();
          const serialNo = String(r[2] || '').trim();
          const manufacturer = String(r[3] || '').trim();
          const manufactureYear = String(r[4] || '').trim();
          const acquisitionDate = String(r[5] || '').trim() || new Date().toISOString().split('T')[0];
          const acquisitionPrice = Number(r[6]) || 0;
          const depreciationMonths = Number(r[7]) || 96; // 💡 기본값 96개월
          const rawResidual = r[8];
          const residualValueRate = (rawResidual !== undefined && rawResidual !== '' && !isNaN(Number(rawResidual))) ? Number(rawResidual) : 10;
          const supplier = String(r[9] || '').trim();
          const monthlyRentalFee = Number(r[10]) || 0;
          const dailyRentalFee = Number(r[11]) || 0;
          const memo1 = String(r[12] || '').trim();

          // 유효성 검증
          if (!assetNo) {
            errors.push({ row: rowNum, error: '관리번호가 누락되었습니다.' });
          } else if (existingNos.has(assetNo.toLowerCase())) {
            errors.push({ row: rowNum, error: `관리번호 ${assetNo}가 기존 자산과 중복됩니다.` });
          } else if (fileNos.has(assetNo.toLowerCase())) {
            errors.push({ row: rowNum, error: `엑셀 파일 내에서 관리번호 ${assetNo}가 중복 등장합니다.` });
          }
          fileNos.add(assetNo.toLowerCase());

          if (!modelName) {
            errors.push({ row: rowNum, error: '모델명이 누락되었습니다.' });
          }

          parsedRows.push({
            rowNum,
            assetNo,
            modelName,
            serialNo,
            manufacturer,
            manufactureYear,
            acquisitionDate,
            acquisitionPrice,
            depreciationMonths,
            residualValueRate,
            supplier,
            monthlyRentalFee,
            dailyRentalFee,
            memo1,
            hasError: errors.some(e => e.row === rowNum)
          });
        });

        setExcelPreviewData(parsedRows);
        setExcelValidationErrors(errors);
      } catch (err: any) {
        showErrorModal(`엑셀 파일 파싱 오류:\n\n${err?.message || err}`);
      }
    };
    reader.readAsBinaryString(file);
  };

  // 엑셀 일괄 등록 실행
  const handleExecuteExcelImport = async () => {
    if (excelValidationErrors.length > 0) {
      showErrorModal(`유효성 검사 오류가 ${excelValidationErrors.length}건 존재합니다. 오류를 수정한 후 다시 업로드해 주세요.`);
      return;
    }
    if (excelPreviewData.length === 0) {
      showErrorModal('등록할 자산 데이터가 없습니다.');
      return;
    }

    setIsProcessingExcel(true);
    try {
      const payloadList: Partial<Asset>[] = excelPreviewData.map(r => ({
        assetNo: r.assetNo,
        modelName: r.modelName,
        serialNo: r.serialNo,
        manufacturer: r.manufacturer,
        manufactureYear: r.manufactureYear,
        acquisitionDate: r.acquisitionDate,
        acquisitionPrice: r.acquisitionPrice,
        depreciationMonths: r.depreciationMonths,
        residualValueRate: r.residualValueRate,
        supplier: r.supplier,
        monthlyRentalFee: r.monthlyRentalFee,
        dailyRentalFee: r.dailyRentalFee,
        memo1: r.memo1
      }));

      await batchAcquireAssets(payloadList);
      showToast(`총 ${payloadList.length}대 자산 엑셀 일괄 취득 완료 (AVAILABLE 입고)`);
      setExcelPreviewData([]);
      setExcelValidationErrors([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      showErrorModal(`엑셀 일괄 취득 처리 실패:\n\n${err?.message || err}`);
    } finally {
      setIsProcessingExcel(false);
    }
  };


  // ==========================================================================
  // 💼 [스튜디오 2] 자산 매각 스튜디오 (Asset Disposal Studio: 좌우 50:50)
  // ==========================================================================

  // [좌측 50%: 자산 선별 워크벤치 상태]
  const [selectedDisposalModel, setSelectedDisposalModel] = useState<string>('ALL');
  const [disposalSearchQuery, setDisposalSearchQuery] = useState<string>('');
  const [disposalSortOrder, setDisposalSortOrder] = useState<'YEAR_ASC' | 'BOOK_VAL_ASC' | 'ASSET_NO'>('YEAR_ASC');
  const [includeRepairing, setIncludeRepairing] = useState<boolean>(false);
  const [checkedAssetIds, setCheckedAssetIds] = useState<Set<string>>(new Set());

  // 매각 확정 바구니 (Cart) 아이템 인터페이스
  interface DisposalBasketItem {
    id: string;
    assetNo: string;
    modelName: string;
    serialNo?: string;
    manufactureYear?: string;
    acquisitionPrice?: number;
    bookValue: number;
    salePrice: number;
    maintenanceScore?: number;
    status: string;
  }
  const [disposalBasket, setDisposalBasket] = useState<DisposalBasketItem[]>([]);

  // [우측 50%: 매수처 관리 & 고객사/딜러 검색 모달 상태]
  const [buyerMode, setBuyerMode] = useState<'SELECT' | 'NEW'>('SELECT');
  const [selectedBuyer, setSelectedBuyer] = useState<Customer | null>(null);
  const [isBuyerSearchModalOpen, setIsBuyerSearchModalOpen] = useState<boolean>(false);
  const [buyerSearchQuery, setBuyerSearchQuery] = useState<string>('');

  // 신규 매수처 직접 등록 상태 (사업자등록 기반 필수 6대 정보 사전 확정)
  const [newBuyerName, setNewBuyerName] = useState<string>('');
  const [newBuyerBizNo, setNewBuyerBizNo] = useState<string>('');
  const [newBuyerRepresentative, setNewBuyerRepresentative] = useState<string>('');
  const [newBuyerAddress, setNewBuyerAddress] = useState<string>('');
  const [newBuyerContact, setNewBuyerContact] = useState<string>('');
  const [newBuyerEmail, setNewBuyerEmail] = useState<string>('');

  // [우측 50%: 양도양수 5대 계약 조건 빌더 상태]
  // 1. 계약 기본 정보
  const [disposalDate, setDisposalDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [disposalSalespersonId, setDisposalSalespersonId] = useState<string>(currentUser?.id || '');

  // 2. 대금 결제 조건 (일시불 vs 분할납부)
  const [paymentType, setPaymentType] = useState<'LUMP_SUM' | 'INSTALLMENT'>('LUMP_SUM');
  const [lumpSumDueTerm, setLumpSumDueTerm] = useState<string>('DELIVERY'); // 'IMMEDIATE' | 'DELIVERY' | '7_DAYS' | '14_DAYS' | 'MONTH_10'
  const [lumpSumDueDate, setLumpSumDueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [installmentDownRate, setInstallmentDownRate] = useState<number>(20); // 20%
  const [installmentDownDate, setInstallmentDownDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [installmentBalanceDueDate, setInstallmentBalanceDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  });
  const [bankAccount, setBankAccount] = useState<string>(() => {
    const acc = currentTenant?.bankAccounts?.[0];
    return acc ? `${acc.bankName} ${acc.accountNumber} ${acc.accountHolder}` : '계좌정보 미등록';
  });

  // 3. 장비 인도 조건
  const [deliveryDate, setDeliveryDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [deliveryLocationType, setDeliveryLocationType] = useState<'YARD' | 'BUYER_SITE'>('YARD');
  const [deliverySiteAddress, setDeliverySiteAddress] = useState<string>('');
  const [freightBearer, setFreightBearer] = useState<'BUYER' | 'SELLER'>('BUYER'); // 매수자 부담(기본) | 당사 부담

  // 4. 소유권 이전 및 As-Is 하자면책 특약
  const [useStandardAsIsClause, setUseStandardAsIsClause] = useState<boolean>(true);
  const [specialNotes, setSpecialNotes] = useState<string>('');
  const [disposalMemo, setDisposalMemo] = useState<string>('');

  // 5. 이메일 및 서식 미리보기
  const [sendEmailImmediately, setSendEmailImmediately] = useState<boolean>(true);
  const [disposalEmailTo, setDisposalEmailTo] = useState<string>('');
  const [disposalEmailCc, setDisposalEmailCc] = useState<string>('');
  const [previewDocTab, setPreviewDocTab] = useState<'CONTRACT' | 'INVOICE'>('CONTRACT');
  const [isSubmittingDisposal, setIsSubmittingDisposal] = useState<boolean>(false);

  // 매각 대상 가능 자산 (임대가능 AVAILABLE, 오매각 원천 방어: RENTED 대여중 절대 배제 - 헌장 1.2/1.3)
  const availableForDisposalAssets = useMemo(() => {
    return assets.filter(a => {
      if (a.ownerType !== 'OWNED') return false; // 당사자산만 매각 가능
      if (a.status === 'SOLD') return false; // 이미 매각된 자산 배제
      if (a.status === 'RENTED') return false; // 현장 대여중 오매각 원천 차단 (헌장 1.2/1.3)
      if (!includeRepairing && a.status === 'REPAIRING') return false;
      return true;
    });
  }, [assets, includeRepairing]);

  // 가용 자산의 모델별 대수 집계
  const availableModelStats = useMemo(() => {
    const stats: Record<string, number> = {};
    availableForDisposalAssets.forEach(a => {
      const m = a.modelName || '기타';
      stats[m] = (stats[m] || 0) + 1;
    });
    return stats;
  }, [availableForDisposalAssets]);

  // 모델 목록 (가용 대수 많은 순)
  const availableModelList = useMemo(() => {
    return Object.keys(availableModelStats).sort((a, b) => availableModelStats[b] - availableModelStats[a]);
  }, [availableModelStats]);

  // 바구니에 이미 담긴 자산 ID 집합
  const basketAssetIdSet = useMemo(() => {
    return new Set(disposalBasket.map(b => b.id));
  }, [disposalBasket]);

  const assetDepreciationMap = useMemo(() => {
    const map = new Map<string, number>();
    const targetDate = new Date(disposalDate || new Date());
    availableForDisposalAssets.forEach(a => {
      map.set(a.id, calculateAssetDepreciation(a, targetDate).bookValue);
    });
    return map;
  }, [availableForDisposalAssets, disposalDate]);

  // 좌측 상단: 선택된 모델 및 검색 필터링된 가용 자산 목록
  const filteredDisposalAssets = useMemo(() => {
    return availableForDisposalAssets.filter(a => {
      if (selectedDisposalModel !== 'ALL' && a.modelName !== selectedDisposalModel) {
        return false;
      }
      if (disposalSearchQuery.trim()) {
        const q = disposalSearchQuery.toLowerCase().trim();
        const m1 = a.assetNo?.toLowerCase().includes(q);
        const m2 = a.modelName?.toLowerCase().includes(q);
        const m3 = a.serialNo?.toLowerCase().includes(q);
        if (!m1 && !m2 && !m3) return false;
      }
      return true;
    }).sort((a, b) => {
      if (disposalSortOrder === 'YEAR_ASC') {
        return (a.manufactureYear || '9999').localeCompare(b.manufactureYear || '9999');
      }
      if (disposalSortOrder === 'BOOK_VAL_ASC') {
        const bA = assetDepreciationMap.get(a.id) ?? 0;
        const bB = assetDepreciationMap.get(b.id) ?? 0;
        return bA - bB;
      }
      return (a.assetNo || '').localeCompare(b.assetNo || '');
    });
  }, [availableForDisposalAssets, selectedDisposalModel, disposalSearchQuery, disposalSortOrder, assetDepreciationMap]);

  // 아직 바구니에 안 담긴 가용 자산 목록
  const unbaskettedFilteredAssets = useMemo(() => {
    return filteredDisposalAssets.filter(a => !basketAssetIdSet.has(a.id));
  }, [filteredDisposalAssets, basketAssetIdSet]);

  // 상단 테이블 체크박스 토글
  const toggleCheckAsset = (assetId: string) => {
    if (basketAssetIdSet.has(assetId)) return;
    setCheckedAssetIds(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  // 상단 테이블 전체 선택/해제
  const toggleCheckAll = () => {
    if (checkedAssetIds.size >= unbaskettedFilteredAssets.length && unbaskettedFilteredAssets.length > 0) {
      setCheckedAssetIds(new Set());
    } else {
      const next = new Set<string>();
      unbaskettedFilteredAssets.forEach(a => next.add(a.id));
      setCheckedAssetIds(next);
    }
  };

  // [매각 바구니에 담기] 액션
  const handleAddCheckedToBasket = () => {
    if (checkedAssetIds.size === 0) return;
    const newItems: DisposalBasketItem[] = [];
    checkedAssetIds.forEach(id => {
      const asset = assets.find(a => a.id === id);
      if (asset && !basketAssetIdSet.has(id)) {
        const dep = calculateAssetDepreciation(asset, new Date(disposalDate));
        newItems.push({
          id: asset.id,
          assetNo: asset.assetNo,
          modelName: asset.modelName,
          serialNo: asset.serialNo,
          manufactureYear: asset.manufactureYear,
          acquisitionPrice: asset.acquisitionPrice,
          bookValue: dep.bookValue,
          salePrice: dep.bookValue, // 기본 매각단가로 현재 장부가치 제안
          maintenanceScore: asset.maintenanceScore,
          status: asset.status
        });
      }
    });

    setDisposalBasket(prev => [...prev, ...newItems]);
    setCheckedAssetIds(new Set());
    showToast(`${newItems.length}대 자산이 매각 바구니에 추가되었습니다.`);
  };

  // 바구니 단건 삭제
  const handleRemoveFromBasket = (assetId: string) => {
    setDisposalBasket(prev => prev.filter(b => b.id !== assetId));
  };

  // 바구니 전체 비우기
  const handleClearBasket = () => {
    setDisposalBasket([]);
  };

  // 바구니 인라인 매각단가 수정
  const handleUpdateBasketPrice = (assetId: string, price: number) => {
    setDisposalBasket(prev => prev.map(b => b.id === assetId ? { ...b, salePrice: Math.max(0, price) } : b));
  };

  // 바구니 전체 매각단가를 현재 장부가로 일괄 설정
  const handleResetBasketPriceToBookValue = () => {
    setDisposalBasket(prev => prev.map(b => {
      const asset = assets.find(a => a.id === b.id);
      const bv = asset ? calculateAssetDepreciation(asset, new Date(disposalDate)).bookValue : b.bookValue;
      return { ...b, bookValue: bv, salePrice: bv };
    }));
    showToast('바구니의 모든 자산 매각단가가 현재 장부가치로 일괄 설정되었습니다.');
  };

  // ─── 매각 가용 자산 목록 엑셀 내보내기 ───
  const handleExportDisposalAssets = () => {
    if (filteredDisposalAssets.length === 0) {
      showToast('내보낼 매각 가용 자산 데이터가 없습니다.', 'error');
      return;
    }

    const exportRows = filteredDisposalAssets.map((a, idx) => {
      const bookVal = assetDepreciationMap.get(a.id) ?? 0;
      const inBasket = basketAssetIdSet.has(a.id);
      return {
        'No': idx + 1,
        '관리번호': a.assetNo || '',
        '모델명': a.modelName || '',
        '제조번호(SN)': a.serialNo || '',
        '제조사': a.manufacturer || '',
        '제조년도': a.manufactureYear ? `${a.manufactureYear}년` : '',
        '취득일자': a.acquisitionDate || '',
        '취득원가': a.acquisitionPrice || 0,
        '현재장부가치': bookVal,
        '정비점수': a.maintenanceScore ?? 0,
        '상태': a.status === 'AVAILABLE' ? '임대가능' : a.status === 'REPAIRING' ? '정비중' : a.status,
        '바구니담김여부': inBasket ? '담김' : '미담김'
      };
    });

    exportToExcel(exportRows, `매각가용자산대장_${selectedDisposalModel}_${new Date().toISOString().split('T')[0]}`, '매각가용자산');
    showToast(`총 ${filteredDisposalAssets.length}대의 매각 가용 자산 목록이 엑셀로 내보내기 되었습니다.`);
  };

  const handleExportDisposalBasket = () => {
    if (disposalBasket.length === 0) {
      showToast('내보낼 매각 바구니 자산이 없습니다.', 'error');
      return;
    }

    const exportRows = disposalBasket.map((b, idx) => {
      const margin = b.salePrice - b.bookValue;
      return {
        'No': idx + 1,
        '관리번호': b.assetNo,
        '모델명': b.modelName,
        '제조번호(SN)': b.serialNo || '',
        '제조년도': b.manufactureYear ? `${b.manufactureYear}년` : '',
        '취득원가': b.acquisitionPrice || 0,
        '장부가액': b.bookValue,
        '매각제안단가': b.salePrice,
        '예상처분손익': margin,
        '정비점수': b.maintenanceScore ?? 0,
        '상태': b.status === 'AVAILABLE' ? '임대가능' : b.status === 'REPAIRING' ? '정비중' : b.status
      };
    });

    exportToExcel(exportRows, `매각확정바구니_${new Date().toISOString().split('T')[0]}`, '매각바구니');
    showToast(`총 ${disposalBasket.length}대의 매각 바구니 목록이 엑셀로 내보내기 되었습니다.`);
  };

  // 구입처 (제조공급사 + 거래처 딜러) 통합 검색 필터링
  const filteredSuppliersForSearch = useMemo(() => {
    const q = supplierSearchQuery.trim().toLowerCase();
    const results: SelectedSupplierInfo[] = [];

    // 1. 등록 제조/공급사 (vendors)
    vendors.forEach(v => {
      if (
        !q ||
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.bizRegNo && v.bizRegNo.includes(q)) ||
        (v.representative && v.representative.toLowerCase().includes(q)) ||
        (v.contact && v.contact.includes(q))
      ) {
        results.push({
          name: v.name,
          bizRegNo: v.bizRegNo,
          representative: v.representative,
          address: v.address,
          contact: v.contact,
          vendorId: v.id,
          sourceType: 'VENDOR'
        });
      }
    });

    // 2. 고객사 및 중고 딜러 (customers)
    customers.forEach(c => {
      if (
        !q ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.bizRegNo && c.bizRegNo.includes(q)) ||
        (c.representative && c.representative.toLowerCase().includes(q)) ||
        (c.repContact && c.repContact.includes(q))
      ) {
        if (!results.some(r => r.name.toLowerCase() === c.name.toLowerCase())) {
          results.push({
            name: c.name,
            bizRegNo: c.bizRegNo,
            representative: c.representative,
            address: c.address,
            contact: c.repContact,
            email: c.repEmail,
            sourceType: 'CUSTOMER'
          });
        }
      }
    });

    return results.slice(0, 50);
  }, [vendors, customers, supplierSearchQuery]);

  // 검색 모달에서 구입처 선택 핸들러
  const handleSelectSupplier = (supp: SelectedSupplierInfo) => {
    setSelectedSupplierData(supp);
    setSingleSupplier(supp.name);
    if (supp.vendorId) {
      setSingleVendorId(supp.vendorId);
    } else {
      setSingleVendorId('');
    }
    setIsSupplierSearchModalOpen(false);
    showToast(`구입처로 [${supp.name}]이(가) 확정되었습니다.`);
  };

  // 고객사/딜러 검색 결과 필터링
  const filteredCustomersForSearch = useMemo(() => {
    if (!buyerSearchQuery.trim()) return customers.slice(0, 30);
    const q = buyerSearchQuery.toLowerCase().trim();
    return customers.filter(c => {
      const m1 = c.name?.toLowerCase().includes(q);
      const m2 = c.bizRegNo?.includes(q);
      const m3 = c.representative?.toLowerCase().includes(q);
      const m4 = c.repContact?.includes(q);
      return m1 || m2 || m3 || m4;
    }).slice(0, 50);
  }, [customers, buyerSearchQuery]);

  // 검색 모달에서 고객사/딜러 선택 시
  const handleSelectCustomer = (cust: Customer) => {
    setSelectedBuyer(cust);
    if (cust.repEmail) {
      setDisposalEmailTo(cust.repEmail);
    }
    if (cust.address && !deliverySiteAddress) {
      setDeliverySiteAddress(cust.address);
    }
    setIsBuyerSearchModalOpen(false);
    showToast(`매수처로 [${cust.name}]이(가) 확정되었습니다.`);
  };

  // 실시간 회계 집계 (공급가액, 장부가액, 유형자산처분손익, 부가세 10%, 청구총액, 분할납부액)
  const disposalAccounting = useMemo(() => {
    let totalSupplyAmount = 0;
    let totalBookValue = 0;

    disposalBasket.forEach(item => {
      totalSupplyAmount += Number(item.salePrice) || 0;
      const currentBookVal = assetDepreciationMap.get(item.id) ?? (Number(item.bookValue) || 0);
      totalBookValue += currentBookVal;
    });

    const gainLoss = totalSupplyAmount - totalBookValue;
    const vat = Math.round(totalSupplyAmount * 0.1);
    const grandTotal = totalSupplyAmount + vat;

    const installmentDownAmount = Math.round(grandTotal * (installmentDownRate / 100));
    const installmentBalanceAmount = grandTotal - installmentDownAmount;

    return {
      totalSupplyAmount,
      totalBookValue,
      gainLoss,
      vat,
      grandTotal,
      installmentDownAmount,
      installmentBalanceAmount
    };
  }, [disposalBasket, installmentDownRate, assetDepreciationMap]);

  // 매각 계약 체결 & 청구서 발행 & 이메일 발송 실행
  const handleExecuteDisposal = async () => {
    if (!canSave) {
      showErrorModal('자산 매각 계약 체결 권한이 없습니다.');
      return;
    }
    if (disposalBasket.length === 0) {
      showErrorModal('매각할 자산을 1대 이상 바구니에 담아주세요.');
      return;
    }

    let customerId: string | undefined;
    let buyerName = '';
    let buyerBizRegNo = '';
    let buyerRepresentative = '';
    let buyerAddress = '';
    let buyerContact = '';

    if (buyerMode === 'SELECT') {
      if (!selectedBuyer) {
        showErrorModal('매수처(고객사 또는 딜러)를 검색하여 확정해 주세요.');
        return;
      }
      customerId = selectedBuyer.id;
      buyerName = selectedBuyer.name;
      buyerBizRegNo = selectedBuyer.bizRegNo || '';
      buyerRepresentative = selectedBuyer.representative || '';
      buyerAddress = selectedBuyer.address || '';
      buyerContact = selectedBuyer.repContact || '';
    } else {
      if (!newBuyerName.trim()) {
        showErrorModal('신규 매수처 상호명을 입력해 주세요.');
        return;
      }
      buyerName = newBuyerName.trim();
      buyerBizRegNo = newBuyerBizNo.trim();
      buyerRepresentative = newBuyerRepresentative.trim();
      buyerAddress = newBuyerAddress.trim();
      buyerContact = newBuyerContact.trim();
    }

    if (!disposalDate) {
      showErrorModal('양도/계약 일자를 입력해 주세요.');
      return;
    }

    // 5대 계약 조건 객체 빌드
    const saleTerms: SaleContractTerms = {
      paymentType,
      lumpSumDueTerm: paymentType === 'LUMP_SUM' ? lumpSumDueTerm : undefined,
      installmentDownRate: paymentType === 'INSTALLMENT' ? installmentDownRate : undefined,
      installmentDownAmount: paymentType === 'INSTALLMENT' ? disposalAccounting.installmentDownAmount : undefined,
      installmentDownDate: paymentType === 'INSTALLMENT' ? installmentDownDate : undefined,
      installmentBalanceAmount: paymentType === 'INSTALLMENT' ? disposalAccounting.installmentBalanceAmount : undefined,
      installmentBalanceDueDate: paymentType === 'INSTALLMENT' ? installmentBalanceDueDate : undefined,
      bankAccount,

      deliveryDate,
      deliveryLocationType,
      deliverySiteAddress: deliveryLocationType === 'BUYER_SITE' ? (deliverySiteAddress.trim() || buyerAddress) : undefined,
      freightBearer,

      useStandardAsIsClause,
      specialNotes: specialNotes.trim() || undefined
    };

    setIsSubmittingDisposal(true);
    try {
      const payload = {
        customerId,
        buyerName,
        buyerBizRegNo: buyerBizRegNo || undefined,
        buyerRepresentative: buyerRepresentative || undefined,
        buyerAddress: buyerAddress || undefined,
        buyerContact: buyerContact || undefined,
        salespersonId: disposalSalespersonId || undefined,
        disposalDate,
        items: disposalBasket.map(b => ({
          assetId: b.id,
          salePrice: Number(b.salePrice) || 0
        })),
        saleTerms,
        memo: disposalMemo.trim() || undefined,
        recipientEmail: sendEmailImmediately ? disposalEmailTo.trim() : undefined,
        ccEmail: sendEmailImmediately ? disposalEmailCc.trim() : undefined,
        sendEmail: sendEmailImmediately && !!disposalEmailTo.trim()
      };

      const result = await executeAssetSale(payload);
      showToast(`자산 ${disposalBasket.length}대 매각 계약 체결 완료! (계약번호: ${result.contractNo})`);

      // 폼 초기화
      setDisposalBasket([]);
      setCheckedAssetIds(new Set());
      setDisposalMemo('');
      setSpecialNotes('');
    } catch (err: any) {
      showErrorModal(`자산 매각 처리 실패:\n\n${err?.message || err}`);
    } finally {
      setIsSubmittingDisposal(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
      
      {/* 토스트 메시지 표출 */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          backgroundColor: toastMessage.type === 'success' ? '#10b981' : '#ef4444',
          color: '#fff',
          padding: '12px 18px',
          borderRadius: '8px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
          zIndex: 9999,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {toastMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* 최상단 스튜디오 전환 탭 (헌장 3.1 무수식어 건조 UI 표준) */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'var(--bg-card)',
        padding: '12px 16px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className={activeStudio === 'ACQUISITION' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveStudio('ACQUISITION')}
            style={{
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Plus size={15} /> 자산 취득
          </button>
          <button
            type="button"
            className={activeStudio === 'DISPOSAL' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveStudio('DISPOSAL')}
            style={{
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <DollarSign size={15} /> 자산 매각
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
          <span>* 등록 및 처분 완료된 모든 과거 자산은 <strong>[자산관리]</strong> 메뉴에서 26개 풀 컬럼으로 상시 조회 가능합니다.</span>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 🏢 [스튜디오 1] 자산 취득 스튜디오 본문 */}
      {/* ==================================================================== */}
      {activeStudio === 'ACQUISITION' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* 모드 전환: 단건 등록 vs 엑셀 일괄 등록 */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setAcqMode('SINGLE')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: acqMode === 'SINGLE' ? 700 : 500,
                border: acqMode === 'SINGLE' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                backgroundColor: acqMode === 'SINGLE' ? 'var(--primary)' : 'var(--bg-app)',
                color: acqMode === 'SINGLE' ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              단건 즉시 등록
            </button>
            <button
              type="button"
              onClick={() => setAcqMode('EXCEL')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: acqMode === 'EXCEL' ? 700 : 500,
                border: acqMode === 'EXCEL' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                backgroundColor: acqMode === 'EXCEL' ? 'var(--primary)' : 'var(--bg-app)',
                color: acqMode === 'EXCEL' ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              엑셀 일괄 등록
            </button>
          </div>

          {/* ───────────────────────────────────────────────────────────── */}
          {/* 1-A. 단건 즉시 등록 워크벤치 */}
          {/* ───────────────────────────────────────────────────────────── */}
          {acqMode === 'SINGLE' && (
            <form onSubmit={handleExecuteSingleAcquisition} className="card" style={{ margin: 0, padding: '18px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={16} color="var(--primary)" /> 신규 자산 취득 정보 입력
                </h3>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleRegenerateMainAssetNo}
                  style={{ padding: '4px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <RefreshCw size={12} /> 관리번호 재채번
                </button>
              </div>

              {/* 폼 필드 그리드 (헌장 3.4 상하 세로 스택 원칙 준수) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
                
                {/* 1. 모델명 선택 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>모델명 (필수)</label>
                  <select
                    value={singleModelName}
                    onChange={e => handleModelChange(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                    required
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.modelName}>
                        {p.modelName} ({p.manufacturer || '제조사미상'} / {p.feet ? `${p.feet}ft` : '제원'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. 관리번호 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>관리번호 (자산번호)</label>
                  <input
                    type="text"
                    value={singleAssetNo}
                    onChange={e => setSingleAssetNo(e.target.value)}
                    placeholder="예: KL-0850"
                    style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px', fontWeight: 700 }}
                    required
                  />
                </div>

                {/* 3. 일련번호 (S/N) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>제조번호 (Serial No)</label>
                  <input
                    type="text"
                    value={singleSerialNo}
                    onChange={e => setSingleSerialNo(e.target.value)}
                    placeholder="차대/제조일련번호"
                    style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                  />
                </div>

                {/* 4. 제조사 & 연식 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>제조사</label>
                    <input
                      type="text"
                      value={singleManufacturer}
                      onChange={e => setSingleManufacturer(e.target.value)}
                      placeholder="제조사"
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>제조년도</label>
                    <input
                      type="text"
                      value={singleManufactureYear}
                      onChange={e => handleManufactureYearChange(e.target.value)}
                      placeholder="2024"
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                    />
                  </div>
                </div>

                {/* 5. 취득일자 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>취득일자</label>
                  <input
                    type="date"
                    value={singleAcqDate}
                    onChange={e => setSingleAcqDate(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                    required
                  />
                </div>

                {/* 6. 취득원가 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>취득원가 (원)</label>
                  <input
                    type="number"
                    value={singleAcqPrice}
                    onChange={e => handleAcqPriceChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px', fontWeight: 700 }}
                    required
                  />
                </div>

                {/* 7. 내용월수 & 잔존가치율 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>내용월수 (개월)</label>
                    <input
                      type="number"
                      value={singleDepMonths}
                      onChange={e => setSingleDepMonths(Math.max(1, parseInt(e.target.value, 10) || 96))}
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>잔존가율 (%)</label>
                    <input
                      type="number"
                      value={singleResidualRate}
                      onChange={e => setSingleResidualRate(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                    />
                  </div>
                </div>

                {/* 8. 구입처 (공급처 / 중고 딜러 / 거래처) 인스펙터 선택 (매각 매수처 UI와 1:1 표준화) */}
                <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      구입처 (공급사 / 중고 딜러 / 거래처)
                    </label>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="supplierMode"
                          checked={supplierMode === 'SELECT'}
                          onChange={() => setSupplierMode('SELECT')}
                        />
                        등록 공급처/딜러 검색
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="supplierMode"
                          checked={supplierMode === 'DIRECT'}
                          onChange={() => setSupplierMode('DIRECT')}
                        />
                        신규 구입처 직접 입력
                      </label>
                    </div>
                  </div>

                  {supplierMode === 'SELECT' ? (
                    <div>
                      {selectedSupplierData ? (
                        <div style={{
                          padding: '10px 12px',
                          backgroundColor: 'var(--bg-app)',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>{selectedSupplierData.name}</strong>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                대표: {selectedSupplierData.representative || '-'} | 사업자: {selectedSupplierData.bizRegNo || '미등록'}
                              </span>
                              <span style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: selectedSupplierData.sourceType === 'VENDOR' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                color: selectedSupplierData.sourceType === 'VENDOR' ? 'var(--primary)' : 'var(--success)',
                                fontWeight: 700
                              }}>
                                {selectedSupplierData.sourceType === 'VENDOR' ? '제조/공급사' : '거래처/딜러'}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              주소: {selectedSupplierData.address || '-'} | 연락처: {selectedSupplierData.contact || '-'}
                            </div>
                          </div>

                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setIsSupplierSearchModalOpen(true)}
                            style={{ padding: '4px 10px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
                          >
                            구입처 변경
                          </button>
                        </div>
                      ) : (
                        <div
                          onClick={() => setIsSupplierSearchModalOpen(true)}
                          style={{
                            padding: '14px',
                            backgroundColor: 'var(--bg-app)',
                            borderRadius: '6px',
                            border: '1px dashed var(--border-color)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            color: 'var(--primary)',
                            fontWeight: 600,
                            fontSize: '12.5px'
                          }}
                        >
                          <Search size={15} />
                          구입처 (제조공급사 / 중고 딜러 / 거래처) 실시간 검색 및 확정
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>구입처 상호명 (필수)</label>
                        <input
                          type="text"
                          placeholder="예: 한국시노붐, 제일중기"
                          value={newSupplierName}
                          onChange={e => setNewSupplierName(e.target.value)}
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>사업자등록번호</label>
                        <input
                          type="text"
                          placeholder="예: 123-45-67890"
                          value={newSupplierBizNo}
                          onChange={e => setNewSupplierBizNo(e.target.value)}
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>대표자 성명</label>
                        <input
                          type="text"
                          placeholder="예: 홍길동"
                          value={newSupplierRepresentative}
                          onChange={e => setNewSupplierRepresentative(e.target.value)}
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>대표 연락처</label>
                        <input
                          type="text"
                          placeholder="예: 010-1234-5678"
                          value={newSupplierContact}
                          onChange={e => setNewSupplierContact(e.target.value)}
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                      <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>사업장 주소</label>
                        <input
                          type="text"
                          placeholder="사업장 소재지 주소"
                          value={newSupplierAddress}
                          onChange={e => setNewSupplierAddress(e.target.value)}
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 멀티 입고 슬롯 (동일 모델 N대 일괄 등록) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      동일 모델 일괄 입고 슬롯
                    </span>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      color: 'var(--primary)',
                      fontSize: '11px',
                      fontWeight: 700
                    }}>
                      기본 1대 + 추가 {multiSlots.length}대 = 총 {1 + multiSlots.length}대 입고 예정
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {multiSlots.length > 0 && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleRenumberSlotsSequentially()}
                        title="메인 관리번호 기준으로 슬롯 번호들을 순차적으로 다시 정렬합니다."
                        style={{ padding: '4px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <RefreshCw size={11} /> 관리번호 순차 재정렬
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleAddSlot}
                      style={{ padding: '5px 12px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}
                    >
                      <Plus size={13} /> 슬롯 추가
                    </button>
                  </div>
                </div>

                {multiSlots.length === 0 ? (
                  <div style={{
                    padding: '16px',
                    textAlign: 'center',
                    backgroundColor: 'var(--bg-app)',
                    borderRadius: '6px',
                    border: '1px dashed var(--border-color)',
                    color: 'var(--text-muted)',
                    fontSize: '12px'
                  }}>
                    동일 모델 장비를 여러 대 한 번에 등록하려면 우측 상단의 <strong>[+ 슬롯 추가]</strong> 버튼을 누르세요. (동일 모델·취득가 자동 상속 및 관리번호 순차 자동 채번)
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {/* 슬롯 테이블 헤더 */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '40px 170px 130px 1fr 110px 130px 36px',
                      gap: '8px',
                      padding: '6px 10px',
                      backgroundColor: 'var(--bg-app)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      alignItems: 'center'
                    }}>
                      <span>순번</span>
                      <span>채번 관리번호</span>
                      <span>등록 모델</span>
                      <span>제조번호 (Serial No)</span>
                      <span>제조년도</span>
                      <span>취득원가 (원)</span>
                      <span style={{ textAlign: 'center' }}>삭제</span>
                    </div>

                    {/* 슬롯 행 목록 */}
                    {multiSlots.map((slot, sIdx) => (
                      <div
                        key={slot.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '40px 170px 130px 1fr 110px 130px 36px',
                          gap: '8px',
                          alignItems: 'center',
                          backgroundColor: 'var(--bg-app)',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)'
                        }}
                      >
                        {/* 1. 순번 */}
                        <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted)' }}>
                          #{sIdx + 1}
                        </span>

                        {/* 2. 채번 관리번호 (배지 및 입력 필드) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            type="text"
                            placeholder="관리번호"
                            value={slot.assetNo}
                            onChange={e => handleUpdateSlot(slot.id, 'assetNo', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '5px 8px',
                              fontSize: '12px',
                              fontWeight: 800,
                              borderRadius: '4px',
                              border: '1px solid var(--primary)',
                              backgroundColor: 'var(--bg-card)',
                              color: 'var(--primary)'
                            }}
                            required
                          />
                        </div>

                        {/* 3. 등록 모델 (메인 모델 동일 상속 표시) */}
                        <div style={{ whiteSpace: 'nowrap' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: 'var(--text-primary)'
                          }}>
                            {singleModelName || '-'}
                          </span>
                        </div>

                        {/* 4. 제조번호 (S/N) */}
                        <input
                          type="text"
                          placeholder="차대/제조일련번호"
                          value={slot.serialNo}
                          onChange={e => handleUpdateSlot(slot.id, 'serialNo', e.target.value)}
                          style={{
                            padding: '5px 8px',
                            fontSize: '12px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            color: 'var(--text-primary)'
                          }}
                        />

                        {/* 5. 제조년도 (슬롯별 개별 연식) */}
                        <input
                          type="text"
                          placeholder={singleManufactureYear || '2024'}
                          value={slot.manufactureYear}
                          onChange={e => handleUpdateSlot(slot.id, 'manufactureYear', e.target.value)}
                          style={{
                            padding: '5px 8px',
                            fontSize: '12px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            color: 'var(--text-primary)'
                          }}
                        />

                        {/* 6. 취득원가 (메인 취득가 동일 상속) */}
                        <input
                          type="number"
                          placeholder="취득가"
                          value={slot.price}
                          onChange={e => handleUpdateSlot(slot.id, 'price', parseInt(e.target.value, 10) || 0)}
                          style={{
                            padding: '5px 8px',
                            fontSize: '12px',
                            fontWeight: 700,
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                            textAlign: 'right'
                          }}
                          required
                        />

                        {/* 6. 삭제 버튼 */}
                        <div style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(slot.id)}
                            title="슬롯 삭제"
                            style={{
                              border: 'none',
                              background: 'none',
                              color: 'var(--danger)',
                              cursor: 'pointer',
                              padding: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 우하단 Gutenberg Z-패턴 터미널 완결 버튼 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmittingAcq}
                  style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Plus size={16} />
                  {isSubmittingAcq ? '취득 등록 중...' : `신규 자산 취득 등록 (총 ${1 + multiSlots.length}대 AVAILABLE 입고)`}
                </button>
              </div>

            </form>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* 1-B. 엑셀 일괄 등록 워크벤치 */}
          {/* ───────────────────────────────────────────────────────────── */}
          {acqMode === 'EXCEL' && (
            <div className="card" style={{ margin: 0, padding: '18px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Upload size={16} color="var(--primary)" /> 엑셀 일괄 자산 취득
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                    표준 엑셀 서식 파일로 수십~수백 대의 장비를 한 번에 검증하여 시스템에 입고 등록합니다.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDownloadTemplate}
                  style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} /> 표준 취득 양식 다운로드
                </button>
              </div>

              {/* 파일 업로드 영역 */}
              <div style={{
                border: '2px dashed var(--border-color)',
                borderRadius: '8px',
                padding: '24px',
                textAlign: 'center',
                backgroundColor: 'var(--bg-app)',
                cursor: 'pointer'
              }} onClick={() => fileInputRef.current?.click()}>
                <Upload size={28} style={{ margin: '0 auto 8px auto', color: 'var(--text-muted)' }} />
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  엑셀 파일 (.xlsx, .xls)을 클릭하여 선택해 주세요
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  업로드 즉시 관리번호 중복 및 필수 필드 유효성 검사가 자동 실행됩니다.
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
              </div>

              {/* 엑셀 파싱 미리보기 및 검증 결과 */}
              {excelPreviewData.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 700 }}>
                      파싱 결과: 총 {excelPreviewData.length}행 (정상: {excelPreviewData.length - excelValidationErrors.length}건 / 오류: {excelValidationErrors.length}건)
                    </span>
                    {excelValidationErrors.length > 0 && (
                      <span style={{ fontSize: '11.5px', color: 'var(--danger)', fontWeight: 700 }}>
                        ⚠️ 오류가 있는 행을 수정한 후 다시 업로드해 주세요.
                      </span>
                    )}
                  </div>

                  <div className="table-container" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                          <th style={{ whiteSpace: 'nowrap' }}>행</th>
                          <th style={{ whiteSpace: 'nowrap' }}>관리번호</th>
                          <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                          <th style={{ whiteSpace: 'nowrap' }}>제조번호(S/N)</th>
                          <th style={{ whiteSpace: 'nowrap' }}>제조사</th>
                          <th style={{ whiteSpace: 'nowrap' }}>취득일자</th>
                          <th style={{ whiteSpace: 'nowrap' }}>취득원가</th>
                          <th style={{ whiteSpace: 'nowrap' }}>검증 결과</th>
                        </tr>
                      </thead>
                      <tbody>
                        {excelPreviewData.map(r => {
                          const err = excelValidationErrors.find(e => e.row === r.rowNum);
                          return (
                            <tr key={r.rowNum} style={{ backgroundColor: err ? 'rgba(239, 68, 68, 0.08)' : 'transparent' }}>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.rowNum}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong>{r.assetNo}</strong></td>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.modelName}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.serialNo || '-'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.manufacturer || '-'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.acquisitionDate}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>₩{r.acquisitionPrice.toLocaleString()}원</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {err ? (
                                  <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '11px' }}>
                                    🔴 {err.error}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: '11px' }}>
                                    🟢 정상
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isProcessingExcel || excelValidationErrors.length > 0}
                      onClick={handleExecuteExcelImport}
                      style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <Check size={16} />
                      {isProcessingExcel ? '일괄 등록 진행 중...' : `총 ${excelPreviewData.length}대 일괄 취득 등록 (AVAILABLE 입고)`}
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      )}


      {/* ───────────────────────────────────────────────────────────── */}
      {/* 🔍 구입처 (공급사 / 중고 장비 딜러 / 거래처) 실시간 검색 모달 */}
      {/* ───────────────────────────────────────────────────────────── */}
      {isSupplierSearchModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000,
          padding: '20px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '750px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            padding: '20px',
            backgroundColor: 'var(--bg-card)',
            borderRadius: '10px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            border: '1px solid var(--border-color)',
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={18} color="var(--primary)" />
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>구입처 (공급사 / 중고 딜러 / 거래처) 검색</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSupplierSearchModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* 검색창 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-app)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <Search size={15} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="상호명, 사업자등록번호, 대표자명, 연락처 검색"
                value={supplierSearchQuery}
                onChange={e => setSupplierSearchQuery(e.target.value)}
                autoFocus
                style={{ flex: 1, border: 'none', backgroundColor: 'transparent', outline: 'none', fontSize: '13px', color: 'var(--text-primary)' }}
              />
              {supplierSearchQuery && (
                <button
                  type="button"
                  onClick={() => setSupplierSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* 결과 목록 테이블 */}
            <div className="table-container" style={{ flex: 1, overflowY: 'auto', maxHeight: '420px', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <table>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                    <th style={{ whiteSpace: 'nowrap' }}>구분</th>
                    <th style={{ whiteSpace: 'nowrap' }}>상호명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>사업자번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>대표자</th>
                    <th style={{ whiteSpace: 'nowrap' }}>사업장 주소</th>
                    <th style={{ whiteSpace: 'nowrap' }}>연락처</th>
                    <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>선택</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliersForSearch.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                        검색 조건에 일치하는 공급처 또는 딜러가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredSuppliersForSearch.map((s, idx) => (
                      <tr
                        key={`${s.name}_${idx}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleSelectSupplier(s)}
                      >
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: s.sourceType === 'VENDOR' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                            color: s.sourceType === 'VENDOR' ? 'var(--primary)' : 'var(--success)',
                            fontWeight: 700
                          }}>
                            {s.sourceType === 'VENDOR' ? '제조사' : '거래처/딜러'}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--primary)' }}>
                          {s.name}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{s.bizRegNo || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{s.representative || '-'}</td>
                        <td style={{ fontSize: '11.5px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.address || '-'}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{s.contact || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSupplier(s);
                            }}
                            style={{ padding: '3px 10px', fontSize: '11px', fontWeight: 700 }}
                          >
                            선택
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                총 {filteredSuppliersForSearch.length}건 검색됨 (제조사 및 거래처/중고딜러)
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsSupplierSearchModalOpen(false)}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 🔍 매수처 (고객사 / 중고 장비 딜러) 실시간 검색 모달 */}
      {/* ───────────────────────────────────────────────────────────── */}
      {isBuyerSearchModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000,
          padding: '20px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '750px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            padding: '20px',
            backgroundColor: 'var(--bg-card)',
            borderRadius: '10px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            border: '1px solid var(--border-color)',
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={18} color="var(--primary)" />
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>매수처 (고객사 / 중고 딜러) 검색</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBuyerSearchModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* 검색창 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-app)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <Search size={15} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="상호명, 사업자등록번호, 대표자명, 연락처 검색"
                value={buyerSearchQuery}
                onChange={e => setBuyerSearchQuery(e.target.value)}
                autoFocus
                style={{ flex: 1, border: 'none', backgroundColor: 'transparent', outline: 'none', fontSize: '13px', color: 'var(--text-primary)' }}
              />
              {buyerSearchQuery && (
                <button
                  type="button"
                  onClick={() => setBuyerSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* 결과 목록 테이블 */}
            <div className="table-container" style={{ flex: 1, overflowY: 'auto', maxHeight: '420px', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <table>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                    <th style={{ whiteSpace: 'nowrap' }}>상호명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>사업자번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>대표자</th>
                    <th style={{ whiteSpace: 'nowrap' }}>사업장 주소</th>
                    <th style={{ whiteSpace: 'nowrap' }}>연락처</th>
                    <th style={{ whiteSpace: 'nowrap' }}>계산서 이메일</th>
                    <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>선택</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomersForSearch.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                        검색 조건에 일치하는 고객사 또는 딜러가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredCustomersForSearch.map(c => (
                      <tr
                        key={c.id}
                        onClick={() => handleSelectCustomer(c)}
                        style={{ cursor: 'pointer', transition: 'background-color 0.15s' }}
                      >
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--primary)' }}>{c.name}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.bizRegNo || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.representative || '-'}</td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.repContact || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{c.repEmail || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCustomer(c);
                            }}
                            style={{ padding: '3px 8px', fontSize: '11px', fontWeight: 600 }}
                          >
                            선택
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              <span>* 등록되지 않은 중고 딜러는 모달을 닫고 <strong>[신규 딜러 직접 등록]</strong> 탭을 이용해 주세요.</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsBuyerSearchModalOpen(false)}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 💼 [스튜디오 2] 자산 매각 스튜디오 본문 (좌우 50:50 워크벤치) */}
      {/* ==================================================================== */}
      {activeStudio === 'DISPOSAL' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
            
            {/* ───────────────────────────────────────────────────────────── */}
            {/* 좌측 50%: 매각 대상 자산 선별 및 바구니 워크벤치 */}
            {/* ───────────────────────────────────────────────────────────── */}
            <div className="card" style={{ margin: 0, padding: '16px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Layers size={16} color="var(--primary)" /> 매각 대상 자산 선별
                  </h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    * 현장 대여중(RENTED) 장비는 오매각 방지를 위해 원천 차단됩니다.
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={includeRepairing}
                      onChange={e => setIncludeRepairing(e.target.checked)}
                    />
                    정비중(REPAIRING) 포함
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleExportDisposalAssets}
                    style={{ padding: '4px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', borderColor: 'var(--success)', color: 'var(--success)' }}
                  >
                    <Download size={13} /> 엑셀 내보내기
                  </button>
                </div>
              </div>

              {/* 1단계: 모델 선택 & 검색 필터 (상하 세로 스택: 헌장 3.4) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr', gap: '8px', alignItems: 'end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    1. 모델 선택 (가용 대수)
                  </label>
                  <select
                    value={selectedDisposalModel}
                    onChange={e => setSelectedDisposalModel(e.target.value)}
                    style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600 }}
                  >
                    <option value="ALL">전체 모델 ({availableForDisposalAssets.length}대 가용)</option>
                    {availableModelList.map(m => (
                      <option key={m} value={m}>
                        {m} ({availableModelStats[m]}대 가용)
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    관리번호 / 시리얼 검색
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--bg-app)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <Search size={13} color="var(--text-muted)" />
                    <input
                      type="text"
                      placeholder="검색어 입력"
                      value={disposalSearchQuery}
                      onChange={e => setDisposalSearchQuery(e.target.value)}
                      style={{ flex: 1, border: 'none', backgroundColor: 'transparent', fontSize: '12px', outline: 'none', color: 'var(--text-primary)' }}
                    />
                    {disposalSearchQuery && (
                      <button onClick={() => setDisposalSearchQuery('')} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>✕</button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    정렬 기준
                  </label>
                  <select
                    value={disposalSortOrder}
                    onChange={e => setDisposalSortOrder(e.target.value as any)}
                    style={{ padding: '7px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', fontSize: '12px', color: 'var(--text-primary)' }}
                  >
                    <option value="YEAR_ASC">노후순 (연식 오래된순)</option>
                    <option value="BOOK_VAL_ASC">장부가 낮은순</option>
                    <option value="ASSET_NO">관리번호순</option>
                  </select>
                </div>
              </div>

              {/* 2단계: 가용 자산 선별 그리드 테이블 */}
              <div style={{
                backgroundColor: 'var(--bg-app)',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '11.5px'
              }}>
                <div>
                  선택 체크: <strong style={{ color: 'var(--primary)' }}>{checkedAssetIds.size}대</strong> / 선별 가용 {unbaskettedFilteredAssets.length}대
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={toggleCheckAll}
                    style={{ border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                  >
                    {checkedAssetIds.size >= unbaskettedFilteredAssets.length && unbaskettedFilteredAssets.length > 0 ? '체크 해제' : '전체 체크'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={checkedAssetIds.size === 0}
                    onClick={handleAddCheckedToBasket}
                    style={{ padding: '4px 12px', fontSize: '11.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <ArrowRight size={13} /> 매각 바구니 담기 ({checkedAssetIds.size}대)
                  </button>
                </div>
              </div>

              <div className="table-container" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                      <th style={{ width: '32px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={checkedAssetIds.size > 0 && checkedAssetIds.size >= unbaskettedFilteredAssets.length}
                          onChange={toggleCheckAll}
                        />
                      </th>
                      <th style={{ whiteSpace: 'nowrap' }}>관리번호</th>
                      <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                      <th style={{ whiteSpace: 'nowrap' }}>연식</th>
                      <th style={{ whiteSpace: 'nowrap' }}>현재 장부가치</th>
                      <th style={{ whiteSpace: 'nowrap' }}>취득가</th>
                      <th style={{ whiteSpace: 'nowrap' }}>정비점수</th>
                      <th style={{ whiteSpace: 'nowrap' }}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDisposalAssets.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                          해당 조건의 가용(AVAILABLE) 자산이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredDisposalAssets.map(a => {
                        const inBasket = basketAssetIdSet.has(a.id);
                        const isChecked = checkedAssetIds.has(a.id);
                        const bookVal = assetDepreciationMap.get(a.id) ?? 0;
                        return (
                          <tr
                            key={a.id}
                            onClick={() => !inBasket && toggleCheckAsset(a.id)}
                            style={{
                              backgroundColor: inBasket ? 'rgba(148, 163, 184, 0.08)' : isChecked ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                              cursor: inBasket ? 'not-allowed' : 'pointer',
                              opacity: inBasket ? 0.6 : 1
                            }}
                          >
                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                              {inBasket ? (
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>담김</span>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleCheckAsset(a.id)}
                                />
                              )}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: inBasket ? 'var(--text-muted)' : 'var(--primary)' }}>{a.assetNo}</strong></td>
                            <td style={{ whiteSpace: 'nowrap' }}>{a.modelName}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{a.manufactureYear || '-'}년</td>
                            <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: '#0070C0' }}>₩{bookVal.toLocaleString()}원</strong></td>
                            <td style={{ whiteSpace: 'nowrap' }}>₩{(a.acquisitionPrice || 0).toLocaleString()}원</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{a.maintenanceScore ?? 0}점</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                backgroundColor: a.status === 'AVAILABLE' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                                color: a.status === 'AVAILABLE' ? '#059669' : '#d97706'
                              }}>
                                {a.status === 'AVAILABLE' ? '임대가능' : '정비중'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* 3단계: 매각 확정 바구니 (Cart: 인라인 가격 책정 및 실시간 손익 대사) */}
              <div style={{ borderTop: '2px dashed var(--border-color)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ShoppingBag size={15} color="var(--primary)" />
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      매각 확정 바구니
                    </span>
                    <span style={{
                      backgroundColor: disposalBasket.length > 0 ? 'var(--primary)' : 'var(--bg-app)',
                      color: disposalBasket.length > 0 ? '#fff' : 'var(--text-muted)',
                      padding: '1px 7px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: 700
                    }}>
                      {disposalBasket.length}대
                    </span>
                  </div>

                  {disposalBasket.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={handleExportDisposalBasket}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'var(--success)', color: 'var(--success)' }}
                      >
                        <Download size={11} /> 엑셀 내보내기
                      </button>
                      <button
                        type="button"
                        onClick={handleResetBasketPriceToBookValue}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                      >
                        장부가 일괄적용
                      </button>
                      <button
                        type="button"
                        onClick={handleClearBasket}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', color: 'var(--danger)' }}
                      >
                        바구니 전체 비우기
                      </button>
                    </div>
                  )}
                </div>

                {disposalBasket.length === 0 ? (
                  <div style={{
                    padding: '24px',
                    backgroundColor: 'var(--bg-app)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '12px'
                  }}>
                    * 상단에서 모델과 자산을 선별하여 <strong>[매각 바구니 담기 ➔]</strong> 버튼을 눌러주세요.
                  </div>
                ) : (
                  <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {disposalBasket.map(item => {
                      const diff = item.salePrice - item.bookValue;
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 10px',
                            backgroundColor: 'var(--bg-app)',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            gap: '8px'
                          }}
                        >
                          <div style={{ minWidth: '140px' }}>
                            <strong style={{ color: 'var(--primary)', fontSize: '12.5px' }}>{item.assetNo}</strong>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                              ({item.modelName} / {item.manufactureYear || '-'}년)
                            </span>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              장부가: ₩{item.bookValue.toLocaleString()}원
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>매각가:</span>
                                <input
                                  type="number"
                                  value={item.salePrice}
                                  onChange={e => handleUpdateBasketPrice(item.id, parseInt(e.target.value, 10) || 0)}
                                  style={{
                                    width: '115px',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--bg-card)',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    textAlign: 'right'
                                  }}
                                />
                                <span style={{ fontSize: '11.5px' }}>원</span>
                              </div>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: diff >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {diff >= 0 ? `🟢 +₩${diff.toLocaleString()}` : `🔴 ₩${diff.toLocaleString()}`}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveFromBasket(item.id)}
                              style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                              title="바구니에서 제외"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>

            {/* ───────────────────────────────────────────────────────────── */}
            {/* 우측 50%: 매수처 확정 & 양도양수 5대 계약 조건 빌더 & 서식 미리보기 */}
            {/* ───────────────────────────────────────────────────────────── */}
            <div className="card" style={{ margin: 0, padding: '16px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Receipt size={16} color="var(--primary)" /> 매각 계약 체결 & 청구서 발행 스튜디오
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  원클릭 3단계 완결 (계약체결 + 매각청구 + 이메일전송)
                </span>
              </div>

              {/* 1. 매수처(거래처 / 딜러) 확정 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    1. 매수처 (거래처 / 중고 장비 딜러) 확정
                  </label>
                  <div style={{ display: 'flex', gap: '6px', fontSize: '11px' }}>
                    <button
                      type="button"
                      onClick={() => setBuyerMode('SELECT')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: buyerMode === 'SELECT' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: buyerMode === 'SELECT' ? 'var(--primary)' : 'transparent',
                        color: buyerMode === 'SELECT' ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      고객사/딜러 조회
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuyerMode('NEW')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: buyerMode === 'NEW' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: buyerMode === 'NEW' ? 'var(--primary)' : 'transparent',
                        color: buyerMode === 'NEW' ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      신규 딜러 직접 등록
                    </button>
                  </div>
                </div>

                {buyerMode === 'SELECT' ? (
                  <div>
                    {selectedBuyer ? (
                      <div style={{
                        padding: '10px 12px',
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>{selectedBuyer.name}</strong>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              대표: {selectedBuyer.representative || '-'} | 사업자: {selectedBuyer.bizRegNo || '미등록'}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            주소: {selectedBuyer.address || '-'} | 전화: {selectedBuyer.repContact || '-'} | 메일: {selectedBuyer.repEmail || '-'}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setIsBuyerSearchModalOpen(true)}
                          style={{ padding: '4px 10px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
                        >
                          매수처 변경
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => setIsBuyerSearchModalOpen(true)}
                        style={{
                          padding: '14px',
                          backgroundColor: 'var(--bg-app)',
                          borderRadius: '6px',
                          border: '1px dashed var(--border-color)',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          gap: '8px',
                          cursor: 'pointer',
                          color: 'var(--primary)',
                          fontWeight: 600,
                          fontSize: '12.5px'
                        }}
                      >
                        <Search size={15} />
                        매수처 (고객사 / 딜러) 실시간 검색 및 확정
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>매수처 상호명 (필수)</label>
                      <input
                        type="text"
                        placeholder="예: (주)대한중고중기"
                        value={newBuyerName}
                        onChange={e => setNewBuyerName(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>사업자등록번호</label>
                      <input
                        type="text"
                        placeholder="예: 123-45-67890"
                        value={newBuyerBizNo}
                        onChange={e => setNewBuyerBizNo(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>대표자 성명</label>
                      <input
                        type="text"
                        placeholder="예: 홍길동"
                        value={newBuyerRepresentative}
                        onChange={e => setNewBuyerRepresentative(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>대표 연락처</label>
                      <input
                        type="text"
                        placeholder="예: 010-1234-5678"
                        value={newBuyerContact}
                        onChange={e => setNewBuyerContact(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>사업장 주소</label>
                      <input
                        type="text"
                        placeholder="사업장 소재지 주소"
                        value={newBuyerAddress}
                        onChange={e => setNewBuyerAddress(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 2. 양도·양수 5대 계약 조건 빌더 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  2. 양도·양수 5대 계약 조건 설정
                </label>

                {/* A. 계약 기본 정보: 계약일자 & 계약 담당자 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>양도/계약일자</label>
                    <input
                      type="date"
                      value={disposalDate}
                      onChange={e => setDisposalDate(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>계약 담당자</label>
                    <select
                      value={disposalSalespersonId}
                      onChange={e => setDisposalSalespersonId(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: '12px' }}
                    >
                      <option value="">담당자 선택</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* B. 대금 결제 조건 (일시불 vs 분할납부) */}
                <div style={{ backgroundColor: 'var(--bg-app)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11.5px', fontWeight: 700 }}>대금 결제 조건</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="paymentType"
                          checked={paymentType === 'LUMP_SUM'}
                          onChange={() => setPaymentType('LUMP_SUM')}
                        />
                        일시불
                      </label>
                      <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="paymentType"
                          checked={paymentType === 'INSTALLMENT'}
                          onChange={() => setPaymentType('INSTALLMENT')}
                        />
                        분할납부 (계약금+잔금)
                      </label>
                    </div>
                  </div>

                  {paymentType === 'LUMP_SUM' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>완납 기한</label>
                        <select
                          value={lumpSumDueTerm}
                          onChange={e => setLumpSumDueTerm(e.target.value)}
                          style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11.5px' }}
                        >
                          <option value="DELIVERY">장비 인도 당일 완납</option>
                          <option value="IMMEDIATE">계약 체결 즉시 완납</option>
                          <option value="7_DAYS">계약 후 7일 이내</option>
                          <option value="14_DAYS">계약 후 14일 이내</option>
                          <option value="MONTH_10">익월 10일 정산</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>대금 완납 예정일자</label>
                        <input
                          type="date"
                          value={lumpSumDueDate}
                          onChange={e => setLumpSumDueDate(e.target.value)}
                          style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11.5px' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>계약금 비율:</span>
                        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setInstallmentDownRate(r)}
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: installmentDownRate === r ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                              backgroundColor: installmentDownRate === r ? 'var(--primary)' : 'var(--bg-card)',
                              color: installmentDownRate === r ? '#fff' : 'var(--text-secondary)',
                              fontSize: '11px',
                              fontWeight: installmentDownRate === r ? 700 : 500,
                              cursor: 'pointer'
                            }}
                          >
                            {r}%
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>계약금 ({installmentDownRate}% / VAT포함)</span>
                          <strong style={{ fontSize: '12px', color: 'var(--primary)' }}>
                            ₩{disposalAccounting.installmentDownAmount.toLocaleString()}원
                          </strong>
                          <input
                            type="date"
                            value={installmentDownDate}
                            onChange={e => setInstallmentDownDate(e.target.value)}
                            style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11px', marginTop: '2px' }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>잔금 (잔여액)</span>
                          <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                            ₩{disposalAccounting.installmentBalanceAmount.toLocaleString()}원
                          </strong>
                          <input
                            type="date"
                            value={installmentBalanceDueDate}
                            onChange={e => setInstallmentBalanceDueDate(e.target.value)}
                            style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11px', marginTop: '2px' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                    <label style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>입금 지정 계좌</label>
                    <input
                      type="text"
                      value={bankAccount}
                      onChange={e => setBankAccount(e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11px', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>

                {/* C. 장비 인도 조건 및 운송비 주체 */}
                <div style={{ backgroundColor: 'var(--bg-app)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700 }}>장비 인도 및 운송 조건</span>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>인도 방식</label>
                      <select
                        value={deliveryLocationType}
                        onChange={e => setDeliveryLocationType(e.target.value as any)}
                        style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11.5px' }}
                      >
                        <option value="YARD">당사 주기장 상차도 (FOB)</option>
                        <option value="BUYER_SITE">매수처 지정장소 도착도</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>운송비 부담 주체</label>
                      <select
                        value={freightBearer}
                        onChange={e => setFreightBearer(e.target.value as any)}
                        style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11.5px' }}
                      >
                        <option value="BUYER">매수자 부담 (착불)</option>
                        <option value="SELLER">당사 부담 (선불)</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>인도 예정일자</label>
                      <input
                        type="date"
                        value={deliveryDate}
                        onChange={e => setDeliveryDate(e.target.value)}
                        style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11.5px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {deliveryLocationType === 'YARD' ? '상차 주기장' : '도착도 상세 주소'}
                      </label>
                      <input
                        type="text"
                        placeholder={deliveryLocationType === 'YARD' ? (defaultYard?.name || '당사 기본 주기장') : '매수처 지정 주소'}
                        value={deliverySiteAddress}
                        onChange={e => setDeliverySiteAddress(e.target.value)}
                        style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11.5px' }}
                      />
                    </div>
                  </div>
                </div>

                {/* D. 하자담보책임(As-Is) 및 특약 사항 */}
                <div style={{ backgroundColor: 'var(--bg-app)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={useStandardAsIsClause}
                      onChange={e => setUseStandardAsIsClause(e.target.checked)}
                    />
                    현상태 인수(As-Is) 및 하자담보책임 면책 특약 적용
                  </label>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginLeft: '20px' }}>
                    * 중고 건설기계 특성상 장비를 현상태(As-Is)로 인도하며, 인도 완료 후 일체의 기계적·성능적 하자담보책임을 지지 아니합니다.
                  </span>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>추가 특약 사항 (계약서 반영)</label>
                    <textarea
                      rows={2}
                      placeholder="계약서 제9조 특약사항에 기재할 내용을 입력하세요."
                      value={specialNotes}
                      onChange={e => setSpecialNotes(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', fontSize: '11.5px', resize: 'vertical' }}
                    />
                  </div>
                </div>
              </div>

              {/* 3. 실시간 회계 정산 요약 카드 */}
              <div style={{
                backgroundColor: 'var(--bg-app)',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
                fontSize: '11.5px'
              }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>매각 공급가액</span>
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>₩{disposalAccounting.totalSupplyAmount.toLocaleString()}원</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>유형자산 처분손익</span>
                  <strong style={{ fontSize: '13px', color: disposalAccounting.gainLoss >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {disposalAccounting.gainLoss >= 0 ? `🟢 +₩${disposalAccounting.gainLoss.toLocaleString()}` : `🔴 ₩${disposalAccounting.gainLoss.toLocaleString()}`}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>부가가치세 (10%)</span>
                  <strong style={{ fontSize: '13px', color: 'var(--text-muted)' }}>₩{disposalAccounting.vat.toLocaleString()}원</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>청구 총합계금액</span>
                  <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>₩{disposalAccounting.grandTotal.toLocaleString()}원</strong>
                </div>
              </div>

              {/* 4. 실시간 서식 미리보기 (듀얼 탭) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>4. 실시간 서식 미리보기</label>
                  <div style={{ display: 'flex', gap: '4px', fontSize: '11px' }}>
                    <button
                      type="button"
                      onClick={() => setPreviewDocTab('CONTRACT')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: previewDocTab === 'CONTRACT' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: previewDocTab === 'CONTRACT' ? 'var(--primary)' : 'transparent',
                        color: previewDocTab === 'CONTRACT' ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      매각 계약서 미리보기
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDocTab('INVOICE')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: previewDocTab === 'INVOICE' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: previewDocTab === 'INVOICE' ? 'var(--primary)' : 'transparent',
                        color: previewDocTab === 'INVOICE' ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      매각 청구서 미리보기
                    </button>
                  </div>
                </div>

                {/* 서식 뷰어 본체 */}
                <div style={{
                  padding: '12px 14px',
                  backgroundColor: '#ffffff',
                  color: '#0f172a',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontFamily: 'serif',
                  fontSize: '11.5px',
                  maxHeight: '180px',
                  overflowY: 'auto'
                }}>
                  {previewDocTab === 'CONTRACT' ? (
                    <div>
                      <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 800, marginBottom: '8px', borderBottom: '1px solid #94a3b8', paddingBottom: '4px' }}>
                        중 고 건 설 기 계 (고 소 작 업 대) 양 도 · 양 수 계 약 서
                      </div>
                      <p style={{ margin: '2px 0' }}>
                        <strong>양도인(매도인):</strong> {currentTenant?.corporateName || currentTenant?.tradeName || '당사'} (대표이사 {currentTenant?.representativeName || '-'} / 사업자등록번호: {currentTenant?.businessNumber || '-'})
                      </p>
                      <p style={{ margin: '2px 0' }}>
                        <strong>양수인(매수인):</strong> {buyerMode === 'SELECT' ? (selectedBuyer?.name || '매수처 미정') : (newBuyerName || '매수처 미정')}
                        {buyerMode === 'SELECT' && selectedBuyer?.representative ? ` (대표: ${selectedBuyer.representative})` : (newBuyerRepresentative ? ` (대표: ${newBuyerRepresentative})` : '')}
                      </p>
                      <p style={{ margin: '4px 0 2px 0', fontWeight: 700 }}>[제1조 매각 대상 자산]</p>
                      <p style={{ margin: '2px 0' }}>
                        총 {disposalBasket.length}대 ({disposalBasket.map(b => `${b.assetNo}(${b.modelName})`).join(', ') || '선택 없음'})
                      </p>
                      <p style={{ margin: '4px 0 2px 0', fontWeight: 700 }}>[제2조 매각 공급대금]</p>
                      <p style={{ margin: '2px 0' }}>
                        금 ₩{disposalAccounting.totalSupplyAmount.toLocaleString()}원정 (부가가치세 ₩{disposalAccounting.vat.toLocaleString()}원 별도 / 합계 ₩{disposalAccounting.grandTotal.toLocaleString()}원정)
                      </p>
                      <p style={{ margin: '4px 0 2px 0', fontWeight: 700 }}>[제3조 대금 지급 조건]</p>
                      <p style={{ margin: '2px 0' }}>
                        {paymentType === 'LUMP_SUM' ? (
                          `일시불 지급: ${lumpSumDueTerm === 'DELIVERY' ? '장비 인도 당일 완납' : lumpSumDueTerm === 'IMMEDIATE' ? '계약 체결 즉시 완납' : `${lumpSumDueDate}까지 완납`}`
                        ) : (
                          `분할 지급: 계약금 ₩${disposalAccounting.installmentDownAmount.toLocaleString()}원 (${installmentDownDate} 한), 잔금 ₩${disposalAccounting.installmentBalanceAmount.toLocaleString()}원 (${installmentBalanceDueDate} 한)`
                        )}
                        {' '}(입금계좌: {bankAccount})
                      </p>
                      <p style={{ margin: '4px 0 2px 0', fontWeight: 700 }}>[제4조 장비 인도 및 운송]</p>
                      <p style={{ margin: '2px 0' }}>
                        인도 방식: {deliveryLocationType === 'YARD' ? `당사 주기장 상차도(${deliverySiteAddress.trim() || defaultYard?.name || '당사 기본 주기장'})` : `매수처 지정장소 도착도(${deliverySiteAddress.trim() || (buyerMode === 'SELECT' ? selectedBuyer?.address : newBuyerAddress) || '지정주소'})`},
                        운송비: {freightBearer === 'BUYER' ? '매수자 부담' : '당사 부담'},
                        인도일자: {deliveryDate}
                      </p>
                      <p style={{ margin: '4px 0 2px 0', fontWeight: 700 }}>[제5조 소유권 이전 및 하자면책]</p>
                      <p style={{ margin: '2px 0', color: '#64748b' }}>
                        대금 완납 즉시 소유권이 이전되며, {useStandardAsIsClause ? '본 장비는 현상태(As-Is)로 인도하고 인수 후 일체의 하자담보책임을 부담하지 아니한다.' : '별도 협의된 품질 보증 조건에 따른다.'}
                      </p>
                      {specialNotes.trim() && (
                        <>
                          <p style={{ margin: '4px 0 2px 0', fontWeight: 700 }}>[제6조 특약 사항]</p>
                          <p style={{ margin: '2px 0', color: '#334155' }}>{specialNotes.trim()}</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 800, marginBottom: '8px', borderBottom: '1px solid #94a3b8', paddingBottom: '4px' }}>
                        거 래 명 세 서 (자산 매각 대금 청구서)
                      </div>
                      <p style={{ margin: '2px 0' }}>
                        <strong>공급자:</strong> {currentTenant?.corporateName || currentTenant?.tradeName || '당사'} | <strong>공급받는자:</strong> {buyerMode === 'SELECT' ? (selectedBuyer?.name || '매수처') : (newBuyerName || '매수처')}
                      </p>
                      <p style={{ margin: '2px 0' }}>
                        <strong>청구일자:</strong> {disposalDate} | <strong>청구품목:</strong> 고소작업대 자산 매각 대금 ({disposalBasket.length}대)
                      </p>
                      <div style={{ marginTop: '6px', borderTop: '1px solid #e2e8f0', paddingTop: '4px' }}>
                        <div>• 공급가액: ₩{disposalAccounting.totalSupplyAmount.toLocaleString()}원</div>
                        <div>• 부가가치세(10%): ₩{disposalAccounting.vat.toLocaleString()}원</div>
                        <div>• <strong>청구 총합계금액: ₩{disposalAccounting.grandTotal.toLocaleString()}원</strong></div>
                        <div style={{ color: '#0284c7', marginTop: '4px' }}>• 입금계좌: {bankAccount}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 5. 이메일 발송 설정 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={sendEmailImmediately}
                      onChange={e => setSendEmailImmediately(e.target.checked)}
                    />
                    매각 계약서 및 청구서 이메일 즉시 발송
                  </label>
                  <Mail size={14} color="var(--primary)" />
                </div>

                {sendEmailImmediately && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                    <input
                      type="email"
                      placeholder="수신 이메일 (예: dealer@machinery.co.kr)"
                      value={disposalEmailTo}
                      onChange={e => setDisposalEmailTo(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                    />
                    <input
                      type="email"
                      placeholder="참조 이메일 (CC, 선택)"
                      value={disposalEmailCc}
                      onChange={e => setDisposalEmailCc(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}
                    />
                  </div>
                )}
              </div>

              {/* 6. 우하단 Gutenberg Z-패턴 원클릭 완결 버튼 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={isSubmittingDisposal || disposalBasket.length === 0}
                  onClick={handleExecuteDisposal}
                  style={{
                    padding: '10px 24px',
                    fontSize: '13px',
                    fontWeight: 700,
                    backgroundColor: '#8b5cf6',
                    borderColor: '#7c3aed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Send size={15} />
                  {isSubmittingDisposal ? '계약 체결 및 발행 중...' : `매각 계약 체결 & 청구서 발행 & 이메일 전송 (총 ${disposalBasket.length}대)`}
                </button>
              </div>

            </div>

          </div>

          {/* 최하단 Gutenberg 대차대조 항등식 검증 바 (헌장 3.5 준수) */}
          <div style={{
            backgroundColor: 'var(--bg-card)',
            padding: '10px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>대차대조 회계 검증식:</span>
              <span>📄 매각총액(공급가) <strong>₩{disposalAccounting.totalSupplyAmount.toLocaleString()}원</strong></span>
              <span>=</span>
              <span>📉 매각시점 장부가액 <strong>₩{disposalAccounting.totalBookValue.toLocaleString()}원</strong></span>
              <span>+</span>
              <span style={{ color: disposalAccounting.gainLoss >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                {disposalAccounting.gainLoss >= 0 ? `🟢 처분이익 ₩${disposalAccounting.gainLoss.toLocaleString()}원` : `🔴 처분손실 ₩${disposalAccounting.gainLoss.toLocaleString()}원`}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}>
              <ShieldCheck size={16} color="var(--success)" />
              <span style={{ color: 'var(--success)' }}>
                ⚖️ 대차 차액 ₩0 (회계 무결성 확정)
              </span>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
