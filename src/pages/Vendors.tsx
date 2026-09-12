import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Search, Plus, Edit2, Trash2, Download, Building2, Check, RefreshCw, Calendar, DollarSign, Clock, FolderOpen, ShieldAlert, CreditCard, Upload, FileText, FileCheck, AlertCircle, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { Vendor, Customer } from '../services/db';
import { BatchBusinessLicenseModal } from '../components/BatchBusinessLicenseModal';
import { NtsStatusAuditModal } from '../components/NtsStatusAuditModal';
import { uploadToSupabaseStorage } from '../services/supabaseStorage';
import { analyzeBusinessLicense } from '../services/visionOcrService';
import { checkSingleNtsStatus, NtsStatusResult } from '../services/ntsBusinessService';

type VendorTypeOption = 'RENTAL' | 'PURCHASE' | 'TRANSPORT' | 'REPAIR' | 'OTHER';

const VENDOR_TYPE_CONFIG: Record<VendorTypeOption, { label: string; color: string; bg: string }> = {
  RENTAL: { label: '임차', color: '#3b82f6', bg: 'rgba(37, 99, 235, 0.15)' },
  PURCHASE: { label: '구매', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)' },
  TRANSPORT: { label: '운송', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  REPAIR: { label: '정비', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  OTHER: { label: '기타', color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' }
};

// 💡 거래기간 산정 헬퍼 (예: "2년 4개월 (852일)" 또는 "5개월 (152일)")
export const calculateTradeDuration = (startDateStr?: string): string => {
  if (!startDateStr) return '-';
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return '-';
  const now = new Date();
  const diffTime = now.getTime() - start.getTime();
  if (diffTime < 0) return '거래 예정';
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  if (years > 0) return months > 0 ? `${years}년 ${months}개월 (${diffDays}일)` : `${years}년 (${diffDays}일)`;
  if (months > 0) return `${months}개월 (${diffDays}일)`;
  return `${diffDays}일`;
};

export const Vendors: React.FC = () => {
  const { vendors, customers, saveCustomer, saveVendor, deleteVendor, recalculateAllVendorMetrics, hasPermission, showErrorModal } = useApp();

  const [searchInput, setSearchInput] = useState('');   // 입력 중인 값
  const [searchTerm, setSearchTerm] = useState('');      // 실제 조회에 사용되는 값
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ updatedCount: number; totalAmount: number } | null>(null);
  
  // 등록/수정 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showBatchLicenseModal, setShowBatchLicenseModal] = useState(false);
  const [showNtsAuditModal, setShowNtsAuditModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Partial<Vendor> | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<VendorTypeOption[]>(['RENTAL']);

  // 📄 사업자등록증 & 통장사본 드롭존 상태
  const [isAnalyzingBizCert, setIsAnalyzingBizCert] = useState(false);
  const [bizCertDropActive, setBizCertDropActive] = useState(false);
  const [passbookDropActive, setPassbookDropActive] = useState(false);
  const [matchedNotice, setMatchedNotice] = useState<string | null>(null);

  type VendorSortField = 'name' | 'bizRegNo' | 'representative' | 'contactName' | 'createdAt' | 'firstTradeDate' | 'totalPurchaseAmount';
  const [sortField, setSortField] = useState<VendorSortField>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const canSave = hasPermission('vendors', 'save');

  const handleSort = (field: VendorSortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortArrow = (field: VendorSortField) => {
    if (sortField !== field) return <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: '4px' }}>↕</span>;
    return <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '12px', marginLeft: '4px' }}>{sortDirection === 'asc' ? '▲' : '▼'}</span>;
  };

  const handleOpenAddModal = () => {
    setEditingVendor({
      name: '',
      bizRegNo: '',
      representative: '',
      contactName: '',
      contact: '',
      email: '',
      address: '',
      bizType: '',
      bizItem: '',
      bankName: '',
      accountNumber: '',
      accountHolder: '',
      businessCertFileUrl: undefined,
      businessCertFileName: undefined,
      passbookFileUrl: undefined,
      passbookFileName: undefined,
      type: 'RENTAL',
      types: ['RENTAL'],
      isActive: true,
      firstTradeDate: '',
      totalPurchaseAmount: 0,
      memo: ''
    });
    setSelectedTypes(['RENTAL']);
    setMatchedNotice(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (v: Vendor) => {
    let bName = v.bankName || '';
    let bAcc = v.accountNumber || '';
    let bHolder = v.accountHolder || '';
    if (!bName && !bAcc && v.bankAccount) {
      const match = v.bankAccount.match(/^([^\s]+)\s+([0-9\-]+)(?:\s*\((.*?)\))?$/);
      if (match) {
        bName = match[1];
        bAcc = match[2];
        bHolder = match[3] || '';
      }
    }
    setEditingVendor({
      ...v,
      bankName: bName,
      accountNumber: bAcc,
      accountHolder: bHolder,
    });
    setMatchedNotice(null);
    // v.types가 문자열/배열/PG배열 등 어떤 형식이든 키워드 스캔으로 안전하게 파싱
    const TYPE_KEYS: VendorTypeOption[] = ['RENTAL', 'PURCHASE', 'TRANSPORT', 'REPAIR', 'OTHER'];
    const raw = JSON.stringify(v.types ?? v.type ?? '');
    const parsedTypes = TYPE_KEYS.filter(k => raw.includes(k));
    setSelectedTypes(parsedTypes.length > 0 ? parsedTypes : [(v.type as VendorTypeOption) || 'RENTAL']);
    setIsModalOpen(true);
  };

  const toggleVendorType = (type: VendorTypeOption) => {
    setSelectedTypes(prev => {
      if (prev.includes(type)) {
        // 최소 1개는 선택 유지
        if (prev.length === 1) return prev;
        return prev.filter(t => t !== type);
      } else {
        return [...prev, type];
      }
    });
  };

  const handleSyncMetrics = async () => {
    try {
      setIsSyncing(true);
      const result = await recalculateAllVendorMetrics();
      setSyncResult(result);
      setTimeout(() => setSyncResult(null), 6000);
    } catch (err: any) {
      showErrorModal(`매입처 누적거래액 동기화 실패:\n\n${err?.message || err}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // 📄 사업자등록증 파일 처리 핵심 핸들러 (스토리지 업로드 + Vision AI 분석 + 국세청 상태 점검 + 폼 자동입력)
  const handleProcessBizCertFile = async (file: File) => {
    if (!editingVendor) return;
    setIsAnalyzingBizCert(true);
    setMatchedNotice(null);

    try {
      // 1) 스토리지 업로드
      let fileUrl = '';
      try {
        const ext = file.name.split('.').pop() || 'png';
        const cleanNo = (editingVendor.bizRegNo || 'vnd').replace(/[^0-9]/g, '') || 'new';
        const uploadRes = await uploadToSupabaseStorage({
          file,
          fileName: `vendor_bizcert_${cleanNo}_${Date.now()}.${ext}`,
          folder: 'vendor_licenses'
        });
        if (uploadRes.success && uploadRes.fileUrl) {
          fileUrl = uploadRes.fileUrl;
        }
      } catch (uploadErr) {
        console.warn('[Vendor BizCert] Fallback to DataURL:', uploadErr);
      }
      if (!fileUrl) {
        fileUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      // 2) Vision AI 자동 분석
      let ocrResult = null;
      try {
        ocrResult = await analyzeBusinessLicense(file);
      } catch (aiErr) {
        console.warn('[Vendor BizCert] OCR Failed:', aiErr);
      }

      // 3) 국세청 홈택스 휴폐업 조회
      let ntsData: NtsStatusResult | null = null;
      const rawBizNo = ocrResult?.bizRegNo || editingVendor.bizRegNo || '';
      const cleanBizNoDigits = rawBizNo.replace(/[^0-9]/g, '');
      if (cleanBizNoDigits.length === 10) {
        try {
          ntsData = await checkSingleNtsStatus(cleanBizNoDigits);
        } catch (ntsErr) {
          console.warn('[Vendor BizCert] NTS check error:', ntsErr);
        }
      }

      // 4) 기존 거래처 대사 확인
      const extractedName = ocrResult?.companyName?.trim() || '';
      let matchedExisting: Vendor | undefined = undefined;
      if (cleanBizNoDigits.length === 10) {
        matchedExisting = vendors.find(v => (v.bizRegNo || '').replace(/[^0-9]/g, '') === cleanBizNoDigits);
      }

      if (matchedExisting && (!editingVendor.id || editingVendor.id !== matchedExisting.id)) {
        setMatchedNotice(`기존 등록 매입처 [${matchedExisting.name}]와 사업자등록번호가 일치합니다. 상호명/업태/종목을 사업자등록증 기준으로 갱신합니다.`);
      }

      // 5) 폼 필드 자동 완성 및 사업자등록증 기준 업데이트
      setEditingVendor(prev => {
        if (!prev) return prev;
        const base = (matchedExisting && !prev.id) ? { ...matchedExisting } : { ...prev };
        return {
          ...base,
          name: extractedName || base.name || file.name.replace(/\.[^/.]+$/, ''),
          bizRegNo: ocrResult?.bizRegNo?.trim() || base.bizRegNo || '',
          representative: ocrResult?.representative?.trim() || base.representative || '',
          contactName: base.contactName || ocrResult?.representative?.trim() || '',
          contact: ocrResult?.repContact?.trim() || base.contact || '',
          email: ocrResult?.taxEmail?.trim() || base.email || '',
          address: ocrResult?.address?.trim() || base.address || '',
          bizType: ocrResult?.bizType?.trim() || base.bizType || '',
          bizItem: ocrResult?.bizItem?.trim() || base.bizItem || '',
          businessCertFileUrl: fileUrl,
          businessCertFileName: file.name,
          taxType: ntsData?.taxType || base.taxType,
          taxTypeCd: ntsData?.taxTypeCd || base.taxTypeCd,
          businessStatus: ntsData?.status || base.businessStatus || 'ACTIVE',
          closedDate: ntsData?.closedDate || base.closedDate,
          lastStatusCheckDate: ntsData?.checkedAt || base.lastStatusCheckDate,
          isActive: ntsData?.status === 'CLOSED' ? false : (base.isActive ?? true)
        };
      });
    } catch (err: any) {
      showErrorModal(`사업자등록증 처리 중 오류가 발생했습니다: ${err?.message || err}`);
    } finally {
      setIsAnalyzingBizCert(false);
    }
  };

  // 💳 통장사본 파일 처리 핵심 핸들러
  const handleProcessPassbookFile = async (file: File) => {
    if (!editingVendor) return;
    try {
      let fileUrl = '';
      try {
        const ext = file.name.split('.').pop() || 'png';
        const cleanNo = (editingVendor.bizRegNo || 'vnd').replace(/[^0-9]/g, '') || editingVendor.id || 'new';
        const uploadRes = await uploadToSupabaseStorage({
          file,
          fileName: `vendor_bankbook_${cleanNo}_${Date.now()}.${ext}`,
          folder: 'vendor_bankbooks'
        });
        if (uploadRes.success && uploadRes.fileUrl) {
          fileUrl = uploadRes.fileUrl;
        }
      } catch (err) {
        console.warn('[Vendor Passbook] Fallback to DataURL:', err);
      }
      if (!fileUrl) {
        fileUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      setEditingVendor(prev => prev ? ({ ...prev, passbookFileUrl: fileUrl, passbookFileName: file.name }) : prev);
    } catch (err: any) {
      showErrorModal(`통장사본 처리 실패: ${err?.message || err}`);
    }
  };

  // 💳 매입처 모달 내 통장사본 첨부 선택 핸들러
  const handleVendorModalPassbookSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleProcessPassbookFile(file);
    e.target.value = '';
  };

  // 💳 매입처 목록 테이블에서 통장사본 직접 등록/변경 핸들러
  const handleDirectUploadVendorPassbook = async (v: Vendor, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let fileUrl = '';
      try {
        const ext = file.name.split('.').pop() || 'png';
        const cleanNo = (v.bizRegNo || 'vnd').replace(/[^0-9]/g, '') || v.id;
        const uploadRes = await uploadToSupabaseStorage({
          file,
          fileName: `vendor_bankbook_${cleanNo}_${Date.now()}.${ext}`,
          folder: 'vendor_bankbooks'
        });
        if (uploadRes.success && uploadRes.fileUrl) {
          fileUrl = uploadRes.fileUrl;
        }
      } catch (err) {
        console.warn('[Vendor Direct Passbook] Fallback to DataURL:', err);
      }
      if (!fileUrl) {
        fileUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      await saveVendor({
        ...v,
        passbookFileUrl: fileUrl,
        passbookFileName: file.name,
        updatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      showErrorModal(`통장사본 업로드 실패: ${err?.message || err}`);
    } finally {
      e.target.value = '';
    }
  };

  // 💳 매입처 통장사본 삭제 핸들러
  const handleRemoveVendorPassbook = async (v: Vendor) => {
    if (!window.confirm(`[${v.name}] 매입처의 등록된 통장사본을 삭제하시겠습니까?`)) return;
    try {
      await saveVendor({
        ...v,
        passbookFileUrl: undefined,
        passbookFileName: undefined,
        updatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      showErrorModal(`통장사본 삭제 실패: ${err?.message || err}`);
    }
  };

  // 📄 매입처 목록 테이블에서 사업자등록증 직접 등록/변경 핸들러
  const handleDirectUploadVendorBizCert = async (v: Vendor, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let fileUrl = '';
      try {
        const ext = file.name.split('.').pop() || 'png';
        const cleanNo = (v.bizRegNo || 'vnd').replace(/[^0-9]/g, '') || v.id;
        const uploadRes = await uploadToSupabaseStorage({
          file,
          fileName: `vendor_bizcert_${cleanNo}_${Date.now()}.${ext}`,
          folder: 'vendor_licenses'
        });
        if (uploadRes.success && uploadRes.fileUrl) {
          fileUrl = uploadRes.fileUrl;
        }
      } catch (err) {
        console.warn('[Vendor Direct BizCert] Fallback to DataURL:', err);
      }
      if (!fileUrl) {
        fileUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      // Vision AI 분석
      let ocrResult = null;
      try {
        ocrResult = await analyzeBusinessLicense(file);
      } catch (ocrErr) {
        console.warn('[Vendor Direct BizCert] OCR error:', ocrErr);
      }

      // 국세청 휴폐업 조회
      let ntsData: NtsStatusResult | null = null;
      const targetBizNo = ocrResult?.bizRegNo || v.bizRegNo || '';
      const cleanDigits = targetBizNo.replace(/[^0-9]/g, '');
      if (cleanDigits.length === 10) {
        try {
          ntsData = await checkSingleNtsStatus(cleanDigits);
        } catch (ntsErr) {
          console.warn('[Vendor Direct BizCert] NTS error:', ntsErr);
        }
      }

      const updatedVendor: Vendor = {
        ...v,
        name: ocrResult?.companyName?.trim() || v.name,
        bizRegNo: ocrResult?.bizRegNo?.trim() || v.bizRegNo,
        representative: ocrResult?.representative?.trim() || v.representative,
        address: ocrResult?.address?.trim() || v.address,
        bizType: ocrResult?.bizType?.trim() || v.bizType,
        bizItem: ocrResult?.bizItem?.trim() || v.bizItem,
        businessCertFileUrl: fileUrl,
        businessCertFileName: file.name,
        taxType: ntsData?.taxType || v.taxType,
        businessStatus: ntsData?.status || v.businessStatus,
        closedDate: ntsData?.closedDate || v.closedDate,
        lastStatusCheckDate: ntsData?.checkedAt || v.lastStatusCheckDate,
        isActive: ntsData?.status === 'CLOSED' ? false : v.isActive,
        updatedAt: new Date().toISOString()
      };

      await saveVendor(updatedVendor);

      // 동일 사업자등록번호의 기존 고객사도 상호명, 업태, 종목 동기화
      if (cleanDigits.length === 10) {
        const matchedCust = customers.find(c => (c.bizRegNo || '').replace(/[^0-9]/g, '') === cleanDigits);
        if (matchedCust) {
          const nameDiff = ocrResult?.companyName?.trim() && matchedCust.name !== ocrResult.companyName.trim();
          const bizTypeDiff = ocrResult?.bizType?.trim() && matchedCust.bizType !== ocrResult.bizType.trim();
          const bizItemDiff = ocrResult?.bizItem?.trim() && matchedCust.bizItem !== ocrResult.bizItem.trim();
          if (nameDiff || bizTypeDiff || bizItemDiff || !matchedCust.businessCertFileUrl) {
            await saveCustomer({
              ...matchedCust,
              name: ocrResult?.companyName?.trim() || matchedCust.name,
              bizType: ocrResult?.bizType?.trim() || matchedCust.bizType,
              bizItem: ocrResult?.bizItem?.trim() || matchedCust.bizItem,
              businessCertFileUrl: fileUrl || matchedCust.businessCertFileUrl,
              updatedAt: new Date().toISOString()
            });
          }
        }
      }
    } catch (err: any) {
      showErrorModal(`사업자등록증 업로드 실패: ${err?.message || err}`);
    } finally {
      e.target.value = '';
    }
  };

  // 📄 매입처 사업자등록증 삭제 핸들러
  const handleRemoveVendorBizCert = async (v: Vendor) => {
    if (!window.confirm(`[${v.name}] 매입처의 등록된 사업자등록증을 삭제하시겠습니까?`)) return;
    try {
      await saveVendor({
        ...v,
        businessCertFileUrl: undefined,
        businessCertFileName: undefined,
        updatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      showErrorModal(`사업자등록증 삭제 실패: ${err?.message || err}`);
    }
  };

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVendor || !editingVendor.name) {
      showErrorModal('상호명(매입처명)은 필수 입력 항목입니다.');
      return;
    }

    const payloadTypes = selectedTypes.length > 0 ? selectedTypes : ['RENTAL' as VendorTypeOption];
    const cleanBizNo = (editingVendor.bizRegNo || '').replace(/[^0-9]/g, '');

    const payload: Vendor = {
      id: editingVendor.id || (() => {
        const maxNum = vendors.reduce((max, v) => {
          const match = v.id.match(/VND-(\d+)/);
          return match ? Math.max(max, parseInt(match[1])) : max;
        }, 0);
        return `VND-${String(maxNum + 1).padStart(7, '0')}`;
      })(),
      name: editingVendor.name.trim(),
      bizRegNo: editingVendor.bizRegNo?.trim() || '',
      representative: editingVendor.representative?.trim() || '',
      contactName: editingVendor.contactName?.trim() || '',
      contact: editingVendor.contact?.trim() || '',
      email: editingVendor.email?.trim() || '',
      address: editingVendor.address?.trim() || '',
      bizType: editingVendor.bizType?.trim() || undefined,
      bizItem: editingVendor.bizItem?.trim() || undefined,
      bankName: editingVendor.bankName?.trim() || undefined,
      accountNumber: editingVendor.accountNumber?.trim() || undefined,
      accountHolder: editingVendor.accountHolder?.trim() || undefined,
      bankAccount: editingVendor.bankName && editingVendor.accountNumber
        ? `${editingVendor.bankName} ${editingVendor.accountNumber}${editingVendor.accountHolder ? ` (${editingVendor.accountHolder})` : ''}`
        : (editingVendor.bankAccount || undefined),
      passbookFileUrl: editingVendor.passbookFileUrl,
      passbookFileName: editingVendor.passbookFileName,
      businessCertFileUrl: editingVendor.businessCertFileUrl,
      businessCertFileName: editingVendor.businessCertFileName,
      taxType: editingVendor.taxType,
      taxTypeCd: editingVendor.taxTypeCd,
      businessStatus: editingVendor.businessStatus,
      closedDate: editingVendor.closedDate,
      lastStatusCheckDate: editingVendor.lastStatusCheckDate,
      type: payloadTypes[0], // 하위 호환 primary type
      types: payloadTypes, // 복수 선택 속성
      isActive: editingVendor.isActive ?? true,
      firstTradeDate: editingVendor.firstTradeDate || undefined,
      lastTradeDate: editingVendor.lastTradeDate || undefined,
      totalPurchaseAmount: Number(editingVendor.totalPurchaseAmount) || 0,
      memo: editingVendor.memo || '',
      createdAt: editingVendor.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await saveVendor(payload);

      // 🌟 동일 사업자번호의 기존 고객사 동기화 (헌장 및 사용자 요구사항 반영)
      if (cleanBizNo.length === 10) {
        const matchedCust = customers.find(c => (c.bizRegNo || '').replace(/[^0-9]/g, '') === cleanBizNo);
        if (matchedCust) {
          const nameDiff = payload.name && matchedCust.name !== payload.name;
          const bizTypeDiff = payload.bizType && matchedCust.bizType !== payload.bizType;
          const bizItemDiff = payload.bizItem && matchedCust.bizItem !== payload.bizItem;
          if (nameDiff || bizTypeDiff || bizItemDiff || (!matchedCust.businessCertFileUrl && payload.businessCertFileUrl)) {
            await saveCustomer({
              ...matchedCust,
              name: payload.name || matchedCust.name,
              bizType: payload.bizType || matchedCust.bizType,
              bizItem: payload.bizItem || matchedCust.bizItem,
              businessCertFileUrl: payload.businessCertFileUrl || matchedCust.businessCertFileUrl,
              updatedAt: new Date().toISOString()
            });
          }
        }
      }

      setIsModalOpen(false);
      setEditingVendor(null);
    } catch (err: any) {
      showErrorModal(`매입처 저장 오류:\n\n${err?.message || err}`);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`'${name}' 매입처를 정말 삭제하시겠습니까?`)) {
      deleteVendor(id);
    }
  };

  // 어떤 형식의 Supabase 반환값이든 알려진 키워드를 스캔해 컬러 pill JSX 배열 반환
  const renderTypePills = (v: Vendor): React.ReactNode[] => {
    const TYPE_MAP: { key: string; label: string; color: string; bg: string }[] = [
      { key: 'RENTAL',    label: '임차', color: '#3b82f6', bg: 'rgba(37, 99, 235, 0.15)' },
      { key: 'PURCHASE',  label: '구매', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)' },
      { key: 'TRANSPORT', label: '운송', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
      { key: 'REPAIR',    label: '정비', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
      { key: 'OTHER',     label: '기타', color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
    ];
    // 원시 데이터를 문자열로 직렬화하여 키워드 존재 여부 스캔
    const raw = JSON.stringify(v.types ?? v.type ?? '');
    const found = TYPE_MAP.filter(({ key }) => raw.includes(key));
    if (found.length === 0 && v.type) {
      const m = TYPE_MAP.find(x => x.key === v.type) || { key: v.type, label: v.type, color: '#6b7280', bg: '#f3f4f6' };
      found.push(m);
    }
    return found.map(({ key, label, color, bg }) => (
      <span key={key} style={{
        display: 'inline-block', fontSize: '11px', fontWeight: '600',
        padding: '2px 7px', borderRadius: '999px',
        color, background: bg, border: `1px solid ${color}30`,
        letterSpacing: '0.02em', whiteSpace: 'nowrap'
      }}>{label}</span>
    ));
  };

  // 모달 거래유형 체크에서도 사용하는 기존 getVendorTypes 유지 (모달 내부 로직용)
  const getVendorTypes = (v: Vendor): VendorTypeOption[] => {
    const rawTypes = v.types;
    if (rawTypes) {
      if (Array.isArray(rawTypes) && rawTypes.length > 0)
        return rawTypes.map(s => String(s).replace(/^"|"$/g, '').trim()) as VendorTypeOption[];
      if (typeof rawTypes === 'string') {
        try {
          const json = JSON.parse(rawTypes as string);
          if (Array.isArray(json) && json.length > 0)
            return json.map((s: string) => String(s).replace(/^"|"$/g, '').trim()) as VendorTypeOption[];
        } catch {}
        const inner = (rawTypes as string).replace(/^\{|\}$/g, '');
        const parsed = inner.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
        if (parsed.length > 0) return parsed as VendorTypeOption[];
      }
    }
    if (v.type) return [v.type as VendorTypeOption];
    return ['RENTAL'];
  };

  const filtered = vendors.filter(v => {
    const matchesSearch = 
      v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (v.bizRegNo && v.bizRegNo.includes(searchTerm)) ||
      (v.representative && v.representative.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (v.contactName && v.contactName.toLowerCase().includes(searchTerm.toLowerCase()));

    const vTypes = getVendorTypes(v);
    const matchesType = typeFilter === 'ALL' || vTypes.includes(typeFilter as VendorTypeOption);
    return matchesSearch && matchesType;
  }).sort((a, b) => {
    if (sortField === 'totalPurchaseAmount') {
      const aVal = a.totalPurchaseAmount || 0;
      const bVal = b.totalPurchaseAmount || 0;
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    }
    let aVal = a[sortField as keyof Vendor] || '';
    let bVal = b[sortField as keyof Vendor] || '';

    let cmp = String(aVal).localeCompare(String(bVal), 'ko', { numeric: true });
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  const handleExport = () => {
    const data = filtered.map(v => {
      const vTypes = getVendorTypes(v);
      const typeLabels = vTypes.map(t => VENDOR_TYPE_CONFIG[t]?.label || t).join(', ');
      return {
        '매입처ID': v.id,
        '상호명': v.name,
        '사업자등록번호': v.bizRegNo || '-',
        '대표자명': v.representative || '-',
        '업태': v.bizType || '-',
        '종목': v.bizItem || '-',
        '담당자명': v.contactName || '-',
        '연락처': v.contact || '-',
        '이메일': v.email || '-',
        '주소': v.address || '-',
        '매입/거래구분': typeLabels,
        '지급은행': v.bankName || '-',
        '지급계좌번호': v.accountNumber || v.bankAccount || '-',
        '예금주': v.accountHolder || '-',
        '사업자등록증등록': v.businessCertFileUrl ? '등록됨' : '미등록',
        '통장사본등록': v.passbookFileUrl ? '등록됨' : '미등록',
        '국세청상태': v.businessStatus === 'CLOSED' ? `폐업(${v.closedDate || '-'})` : (v.businessStatus === 'ACTIVE' ? '계속사업자' : (v.businessStatus || '-')),
        '거래개시일': v.firstTradeDate || '-',
        '거래기간': calculateTradeDuration(v.firstTradeDate),
        '누적거래액': (v.totalPurchaseAmount || 0).toLocaleString() + '원',
        '최근거래일': v.lastTradeDate || '-',
        '사용여부': v.isActive ? '사용중' : '미사용',
        '등록일': v.createdAt.slice(0, 10)
      };
    });

    exportToExcel(data, `매입처공급자목록_${new Date().toISOString().split('T')[0]}`, '매입처목록');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '10px' }}>
      <div className="card-header" style={{ marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Building2 className="text-primary" /> 매입처 (공급자 / 외주처) 관리
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            장비 재임차 임차처, 소모품/장비 구매처, 운송 협력사 및 외주 수리정비 업체의 마스터 정보 및 누적거래액을 통합 관리합니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {syncResult && (
            <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px', background: '#dcfce7', padding: '4px 10px', borderRadius: '6px' }}>
              ✓ {syncResult.updatedCount}개사 동기화 완료 (누적 ₩{syncResult.totalAmount.toLocaleString()})
            </span>
          )}
          <button
            className="btn-secondary"
            onClick={handleSyncMetrics}
            disabled={isSyncing}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
            title="당사자산 취득 및 매입정산 대장을 전수 스캔하여 거래개시일 및 누적거래액을 일괄 동기화합니다"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? '동기화 중...' : '누적거래액 전체 동기화'}
          </button>
          {canSave && (
            <button 
              className="btn-secondary" 
              onClick={() => setShowBatchLicenseModal(true)} 
              style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', backgroundColor: '#0284c7', color: '#ffffff', borderColor: '#0369a1' }}
              title="사업자등록증 폴더를 지정하여 내부 모든 파일 일괄 등록 및 보완"
            >
              <FolderOpen size={15} color="#ffffff" /> 폴더 일괄 등록
            </button>
          )}
          {canSave && (
            <button 
              className="btn-secondary" 
              onClick={() => setShowNtsAuditModal(true)} 
              style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', backgroundColor: '#7c3aed', color: '#ffffff', borderColor: '#6d28d9' }}
              title="국세청 홈택스 사업자 휴폐업 상태 전수 점검"
            >
              <ShieldAlert size={15} color="#ffffff" /> 국세청 휴폐업 점검
            </button>
          )}
          {canSave && (
            <button className="btn-primary" onClick={handleOpenAddModal} style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
              <Plus size={16} /> 신규 매입처 등록
            </button>
          )}
        </div>
      </div>

      {/* 📊 매입처 등록 현황 실시간 요약 바 */}
      {(() => {
        const rentalCount = vendors.filter(v => JSON.stringify(v.types || v.type || '').includes('RENTAL')).length;
        const transportCount = vendors.filter(v => JSON.stringify(v.types || v.type || '').includes('TRANSPORT')).length;
        const repairCount = vendors.filter(v => JSON.stringify(v.types || v.type || '').includes('REPAIR')).length;
        const purchaseCount = vendors.filter(v => JSON.stringify(v.types || v.type || '').includes('PURCHASE')).length;
        const totalPurchaseSum = vendors.reduce((sum, v) => sum + (v.totalPurchaseAmount || 0), 0);
        const startedVendorsCount = vendors.filter(v => !!v.firstTradeDate).length;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: 0, flexShrink: 0 }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 매입 협력처</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{vendors.length}개사</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>전사 매입 누적거래액</span>
              <strong style={{ fontSize: '15px', color: '#16a34a', whiteSpace: 'nowrap' }}>₩{totalPurchaseSum.toLocaleString()}</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>거래 개시처</span>
              <strong style={{ fontSize: '15px', color: '#8b5cf6', whiteSpace: 'nowrap' }}>{startedVendorsCount}개사</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>임차 / 운송사</span>
              <strong style={{ fontSize: '15px', color: '#2563eb', whiteSpace: 'nowrap' }}>{rentalCount + transportCount}개사</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>외주 정비 / 구매처</span>
              <strong style={{ fontSize: '15px', color: '#d97706', whiteSpace: 'nowrap' }}>{repairCount + purchaseCount}개사</strong>
            </div>
          </div>
        );
      })()}

      {/* 검색 및 필터 패널 (3.4 상하 스택 레이아웃 표준 준수) */}
      <div className="card" style={{ padding: '12px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flex: 1, minWidth: '320px', maxWidth: '720px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 130px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                거래 유형
              </label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                style={{ width: '100%', padding: '7px 8px', fontSize: '13px' }}
              >
                <option value="ALL">전체 매입처</option>
                <option value="RENTAL">임차 (재임대/렌탈)</option>
                <option value="PURCHASE">구매 (장비/부품)</option>
                <option value="TRANSPORT">운송 (물류)</option>
                <option value="REPAIR">정비 (외주수리)</option>
                <option value="OTHER">기타</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                매입처 검색 (상호/사업자번호/대표자/담당자)
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="검색어 입력 후 [조회] 또는 Enter"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') setSearchTerm(searchInput.trim());
                  }}
                  style={{ width: '100%', paddingLeft: '32px', paddingRight: '8px', paddingTop: '7px', paddingBottom: '7px', fontSize: '13px' }}
                />
              </div>
            </div>

            <button
              className="btn-primary"
              onClick={() => setSearchTerm(searchInput.trim())}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, padding: '8px 14px' }}
            >
              조회
            </button>

            <button
              className="btn-secondary"
              onClick={() => { setSearchInput(''); setSearchTerm(''); setTypeFilter('ALL'); }}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0, padding: '8px 10px' }}
              title="검색 초기화"
            >
              <RefreshCw size={13} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>
              전체 <strong style={{ color: 'var(--primary)' }}>{vendors.length}</strong>개 매입처 (검색: {filtered.length}건)
            </span>
            <button className="btn-secondary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={14} /> 엑셀 다운로드
            </button>
          </div>
        </div>
      </div>

      {/* 매입처 목록 테이블 */}
      <div className="card" style={{ padding: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="table-container" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', maxHeight: 'none', overscrollBehavior: 'contain' }}>
          <table className="table" style={{ width: '100%', margin: 0, tableLayout: 'auto' }}>
            <colgroup>
              <col style={{ width: '135px' }} />{/* 상호명 */}
              <col style={{ width: '120px' }} />{/* 매입/거래 속성 */}
              <col style={{ width: '90px' }} /> {/* 거래개시일 */}
              <col style={{ width: '120px' }} />{/* 거래기간 */}
              <col style={{ width: '110px' }} />{/* 매입 누적거래액 */}
              <col style={{ width: '105px' }} />{/* 사업자등록번호 */}
              <col style={{ width: '75px' }} /> {/* 대표자명 */}
              <col style={{ width: '80px' }} /> {/* 담당자 */}
              <col style={{ width: '100px' }} />{/* 연락처 */}
              <col style={{ width: '130px' }} />{/* 지급 계좌 */}
              <col style={{ width: '105px' }} />{/* 사업자등록증 */}
              <col style={{ width: '95px' }} /> {/* 통장사본 */}
              <col style={{ width: '120px' }} />{/* 주소 */}
              <col style={{ width: '120px' }} />{/* 이메일 */}
              <col style={{ width: '55px' }} /> {/* 상태 */}
              {canSave && <col style={{ width: '65px' }} />}{/* 관리 */}
            </colgroup>
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer', padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  상호명 (매입처명) {renderSortArrow('name')}
                </th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>매입/거래 속성</th>
                <th onClick={() => handleSort('firstTradeDate')} style={{ cursor: 'pointer', padding: '8px 6px', whiteSpace: 'nowrap' }}>
                  거래개시일 {renderSortArrow('firstTradeDate')}
                </th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                  거래기간
                </th>
                <th onClick={() => handleSort('totalPurchaseAmount')} style={{ cursor: 'pointer', padding: '8px 6px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  매입 누적거래액 {renderSortArrow('totalPurchaseAmount')}
                </th>
                <th onClick={() => handleSort('bizRegNo')} style={{ cursor: 'pointer', padding: '8px 6px', whiteSpace: 'nowrap' }}>
                  사업자등록번호 {renderSortArrow('bizRegNo')}
                </th>
                <th onClick={() => handleSort('representative')} style={{ cursor: 'pointer', padding: '8px 6px', whiteSpace: 'nowrap' }}>
                  대표자명 {renderSortArrow('representative')}
                </th>
                <th onClick={() => handleSort('contactName')} style={{ cursor: 'pointer', padding: '8px 6px', whiteSpace: 'nowrap' }}>
                  담당자 {renderSortArrow('contactName')}
                </th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>연락처</th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>지급 계좌</th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>사업자등록증</th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>통장사본</th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>주소</th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>이메일</th>
                <th style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>상태</th>
                {canSave && <th style={{ width: '72px', textAlign: 'center', padding: '8px 6px', whiteSpace: 'nowrap' }}>관리</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canSave ? 16 : 15} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                    {vendors.length === 0 ? '📭 등록된 매입처(공급자)가 없습니다.' : '🔍 조회 조건에 맞는 매입처가 없습니다. 검색 조건을 변경해 보세요.'}
                  </td>
                </tr>
              ) : (
                filtered.map(v => {
                  return (
                    <tr key={v.id}>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                        <strong style={{ color: 'var(--primary)', display: 'block', fontSize: '13px' }}>{v.name}</strong>
                        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{v.id}</span>
                      </td>
                      <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                          {renderTypePills(v)}
                        </div>
                      </td>
                      {/* 📅 거래개시일 */}
                      <td style={{ fontSize: '12px', padding: '6px 6px', whiteSpace: 'nowrap', color: v.firstTradeDate ? 'var(--text-main)' : 'var(--text-muted)' }}>
                        {v.firstTradeDate ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Calendar size={12} style={{ color: 'var(--text-muted)' }} />
                            {v.firstTradeDate}
                          </span>
                        ) : '-'}
                      </td>
                      {/* ⏱️ 거래기간 */}
                      <td style={{ fontSize: '12px', padding: '6px 6px', whiteSpace: 'nowrap', color: v.firstTradeDate ? '#2563eb' : 'var(--text-muted)', fontWeight: v.firstTradeDate ? '600' : 'normal' }}>
                        {v.firstTradeDate ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} style={{ color: '#3b82f6' }} />
                            {calculateTradeDuration(v.firstTradeDate)}
                          </span>
                        ) : '-'}
                      </td>
                      {/* 💰 매입 누적거래액 */}
                      <td style={{ fontSize: '12.5px', padding: '6px 8px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: '700', color: (v.totalPurchaseAmount || 0) > 0 ? '#16a34a' : 'var(--text-muted)' }}>
                        {(v.totalPurchaseAmount || 0).toLocaleString()}원
                      </td>
                      <td style={{ fontSize: '12px', padding: '6px 6px', whiteSpace: 'nowrap' }}>{v.bizRegNo || '-'}</td>
                      <td style={{ fontSize: '12px', padding: '6px 6px', whiteSpace: 'nowrap' }}>{v.representative || '-'}</td>
                      <td style={{ fontSize: '12px', padding: '6px 6px', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>{v.contactName || '-'}</td>
                      <td style={{ fontSize: '12px', padding: '6px 6px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{v.contact || '-'}</td>
                      {/* 💳 지급 계좌 */}
                      <td style={{ fontSize: '12px', padding: '6px 6px', whiteSpace: 'nowrap' }}>
                        {v.bankName || v.accountNumber ? (
                          <div>
                            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{v.bankName || ''}</span>
                            <span style={{ marginLeft: '4px', fontFamily: 'monospace', fontSize: '11.5px', color: 'var(--primary)' }}>
                              {v.accountNumber || ''}
                            </span>
                            {v.accountHolder && (
                              <span style={{ marginLeft: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                ({v.accountHolder})
                              </span>
                            )}
                          </div>
                        ) : v.bankAccount ? (
                          <span style={{ color: 'var(--text-secondary)' }}>{v.bankAccount}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                      {/* 📄 사업자등록증 */}
                      <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                        {v.businessCertFileUrl ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <a
                              href={v.businessCertFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 600,
                                backgroundColor: 'rgba(2, 132, 199, 0.1)',
                                color: '#0284c7',
                                textDecoration: 'none'
                              }}
                              title={v.businessCertFileName || '사업자등록증 열람'}
                            >
                              <FileText size={11} /> 사본 열람 ↗
                            </a>
                            {v.businessStatus && (
                              <span style={{
                                fontSize: '10px',
                                fontWeight: '600',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                backgroundColor: v.businessStatus === 'CLOSED' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                                color: v.businessStatus === 'CLOSED' ? '#ef4444' : '#16a34a'
                              }}>
                                {v.businessStatus === 'CLOSED' ? '폐업' : '계속'}
                              </span>
                            )}
                            {canSave && (
                              <button
                                type="button"
                                onClick={() => handleRemoveVendorBizCert(v)}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  color: '#ef4444',
                                  padding: '2px',
                                  fontSize: '11px',
                                  lineHeight: 1
                                }}
                                title="사업자등록증 삭제"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ) : canSave ? (
                          <label style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 500,
                            backgroundColor: 'var(--bg-app)',
                            border: '1px dashed var(--border-color)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer'
                          }}>
                            <Upload size={11} /> 등록
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={e => handleDirectUploadVendorBizCert(v, e)}
                            />
                          </label>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>미등록</span>
                        )}
                      </td>
                      {/* 📄 통장사본 */}
                      <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                        {v.passbookFileUrl ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <a
                              href={v.passbookFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 600,
                                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                color: 'var(--primary)',
                                textDecoration: 'none'
                              }}
                              title={v.passbookFileName || '통장사본 열람'}
                            >
                              <FileText size={11} /> 사본 열람 ↗
                            </a>
                            {canSave && (
                              <button
                                type="button"
                                onClick={() => handleRemoveVendorPassbook(v)}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  color: '#ef4444',
                                  padding: '2px',
                                  fontSize: '11px',
                                  lineHeight: 1
                                }}
                                title="통장사본 삭제"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ) : canSave ? (
                          <label style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 500,
                            backgroundColor: 'var(--bg-app)',
                            border: '1px dashed var(--border-color)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer'
                          }}>
                            <Upload size={11} /> 등록
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={e => handleDirectUploadVendorPassbook(v, e)}
                            />
                          </label>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>미등록</span>
                        )}
                      </td>
                      <td style={{ fontSize: '11.5px', padding: '6px 6px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {v.address || '-'}
                      </td>
                      <td style={{ fontSize: '11.5px', padding: '6px 6px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {v.email || '-'}
                      </td>
                      <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                        <span className={`badge ${v.isActive !== false ? 'badge-success' : 'badge-danger'}`}>
                          {v.isActive !== false ? '거래중' : '중단'}
                        </span>
                      </td>
                      {canSave && (
                        <td style={{ textAlign: 'center', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                            <button className="btn-secondary" onClick={() => handleOpenEditModal(v)} style={{ padding: '3px 5px' }} title="수정">
                              <Edit2 size={12} />
                            </button>
                            <button className="btn-danger" onClick={() => handleDelete(v.id, v.name)} style={{ padding: '3px 5px' }} title="삭제">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 🏛️ 헌장 3.5 Gutenberg Z-패턴 4단계 대차대조식 무결성 검증 바 */}
        {(() => {
          const totalVendors = filtered.length;
          const startedVendors = filtered.filter(v => !!v.firstTradeDate).length;
          const unstartedVendors = totalVendors - startedVendors;
          const filteredPurchaseSum = filtered.reduce((sum, v) => sum + (v.totalPurchaseAmount || 0), 0);
          const activeCount = filtered.filter(v => v.isActive !== false).length;
          const inactiveCount = totalVendors - activeCount;

          return (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              backgroundColor: 'var(--bg-app)',
              borderTop: '1px solid var(--border-color)',
              flexShrink: 0,
              fontSize: '12px'
            }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  📄 <strong>조회 매입처:</strong> <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>{totalVendors}</span>개사
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  🟢 <strong>거래개시:</strong> <span style={{ color: '#2563eb', fontWeight: 700 }}>{startedVendors}</span>개사 
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: '4px' }}>(미개시 {unstartedVendors}사)</span>
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  🏢 <strong>상태:</strong> 정상 <span style={{ color: '#16a34a', fontWeight: 700 }}>{activeCount}</span>사 / 중단 <span style={{ color: '#ef4444', fontWeight: 700 }}>{inactiveCount}</span>사
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  💰 <strong>조회 누적거래액 합계:</strong> <span style={{ color: '#16a34a', fontWeight: 700 }}>₩{filteredPurchaseSum.toLocaleString()}</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(34, 197, 94, 0.12)',
                  color: '#16a34a',
                  fontWeight: 600,
                  fontSize: '11px'
                }}>
                  ⚖️ 대차대조 무결성 확인됨
                </span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* 등록 / 수정 모달 */}
      {isModalOpen && editingVendor && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ width: '90%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg-card)', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontWeight: '700', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              {editingVendor.id ? '매입처(공급자) 정보 수정' : '신규 매입처(공급자) 등록'}
            </h3>

            <form onSubmit={handleSaveSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                
                {/* 상호명 */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>상호명 (매입처명) *</label>
                  <input
                    type="text"
                    value={editingVendor.name || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, name: e.target.value })}
                    placeholder="예: (주)한국중장비렌탈"
                    required
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                {/* 🌟 인터랙티브 세그먼트 멀티 토글 버튼 그룹 🌟 */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                    매입 / 거래 속성 (복수 토글 선택 가능) *
                  </label>
                  <div style={{
                    display: 'flex',
                    gap: '6px',
                    backgroundColor: 'var(--bg-app)',
                    padding: '6px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    flexWrap: 'wrap'
                  }}>
                    {(Object.keys(VENDOR_TYPE_CONFIG) as VendorTypeOption[]).map(typeKey => {
                      const cfg = VENDOR_TYPE_CONFIG[typeKey];
                      const isSelected = selectedTypes.includes(typeKey);
                      return (
                        <button
                          key={typeKey}
                          type="button"
                          onClick={() => toggleVendorType(typeKey)}
                          style={{
                            flex: '1 1 auto',
                            minWidth: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            padding: '8px 12px',
                            fontSize: '12.5px',
                            fontWeight: isSelected ? '700' : '500',
                            borderRadius: '6px',
                            border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                            background: isSelected ? 'linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%)' : 'var(--bg-card)',
                            color: isSelected ? '#ffffff' : 'var(--text-main)',
                            boxShadow: isSelected ? '0 2px 8px rgba(59, 130, 246, 0.35)' : 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                        >
                          {isSelected && <Check size={14} style={{ color: '#fff', strokeWidth: 3 }} />}
                          <span>{cfg.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    💡 한 거래처가 임차 및 구매를 동시 수행할 경우, 관련 버튼들을 함께 눌러 복수로 활성화할 수 있습니다.
                  </span>
                </div>

                {/* 📅 거래개시일 */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>거래개시일 (최초 거래일)</label>
                  <input
                    type="date"
                    value={editingVendor.firstTradeDate || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, firstTradeDate: e.target.value })}
                    style={{ width: '100%', padding: '8px' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                    ※ 미입력 시 첫 거래(취득/정산) 시 자동 갱신
                  </span>
                </div>

                {/* 💰 매입 누적거래액 */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>매입 누적거래액 (원)</label>
                  <input
                    type="number"
                    value={editingVendor.totalPurchaseAmount ?? 0}
                    onChange={e => setEditingVendor({ ...editingVendor, totalPurchaseAmount: Number(e.target.value) || 0 })}
                    placeholder="0"
                    style={{ width: '100%', padding: '8px' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                    ※ 자산취득 및 매입정산 시 자동 가산
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>사업자등록번호</label>
                  <input
                    type="text"
                    value={editingVendor.bizRegNo || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, bizRegNo: e.target.value })}
                    placeholder="예: 123-81-94820"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>대표자명</label>
                  <input
                    type="text"
                    value={editingVendor.representative || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, representative: e.target.value })}
                    placeholder="예: 홍길동"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                {/* 🌟 업태 및 종목 🌟 */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>업태</label>
                  <input
                    type="text"
                    value={editingVendor.bizType || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, bizType: e.target.value })}
                    placeholder="예: 서비스, 도소매"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>종목</label>
                  <input
                    type="text"
                    value={editingVendor.bizItem || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, bizItem: e.target.value })}
                    placeholder="예: 건설기계 대여, 중장비 수리"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>담당자명</label>
                  <input
                    type="text"
                    value={editingVendor.contactName || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, contactName: e.target.value })}
                    placeholder="예: 김철수 부장"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>연락처</label>
                  <input
                    type="text"
                    value={editingVendor.contact || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, contact: e.target.value })}
                    placeholder="예: 010-1234-5678"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>이메일</label>
                  <input
                    type="email"
                    value={editingVendor.email || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, email: e.target.value })}
                    placeholder="예: vendor@example.com"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>거래 상태</label>
                  <select
                    value={editingVendor.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                    onChange={e => setEditingVendor({ ...editingVendor, isActive: e.target.value === 'ACTIVE' })}
                    style={{ width: '100%', padding: '8px' }}
                  >
                    <option value="ACTIVE">거래중 (정상)</option>
                    <option value="INACTIVE">거래중단 (보류)</option>
                  </select>
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>사업장 주소</label>
                  <input
                    type="text"
                    value={editingVendor.address || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, address: e.target.value })}
                    placeholder="예: 경기도 화성시 팔탄면 123번지"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>

                {/* 💳 대금 지급 계좌 & 2대 증빙 서류 (사업자등록증/통장사본) 드롭존 섹션 */}
                <div style={{
                  gridColumn: 'span 2',
                  backgroundColor: 'var(--bg-app)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                      <CreditCard size={15} style={{ color: 'var(--primary)' }} /> 대금 지급 계좌
                    </label>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr', gap: '8px', marginBottom: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>은행명</label>
                      <input
                        type="text"
                        value={editingVendor.bankName || ''}
                        onChange={e => setEditingVendor({ ...editingVendor, bankName: e.target.value })}
                        placeholder="예: 기업은행"
                        style={{ width: '100%', padding: '6px 8px', fontSize: '12.5px' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>계좌번호</label>
                      <input
                        type="text"
                        value={editingVendor.accountNumber || ''}
                        onChange={e => setEditingVendor({ ...editingVendor, accountNumber: e.target.value })}
                        placeholder="예: 010-12345-67890"
                        style={{ width: '100%', padding: '6px 8px', fontSize: '12.5px' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>예금주</label>
                      <input
                        type="text"
                        value={editingVendor.accountHolder || ''}
                        onChange={e => setEditingVendor({ ...editingVendor, accountHolder: e.target.value })}
                        placeholder="예: (주)한국중장비"
                        style={{ width: '100%', padding: '6px 8px', fontSize: '12.5px' }}
                      />
                    </div>
                  </div>

                  {/* 🌟 2대 증빙 서류 선택적 드롭존 패널 (사업자등록증 & 통장사본) 🌟 */}
                  <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <label style={{ fontSize: '12.5px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                        <FileText size={14} style={{ color: 'var(--primary)' }} /> 증빙 서류 첨부 (선택적 드롭 또는 파일 선택)
                      </label>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        ※ 사업자등록증 드롭 시 AI 판독 정보 및 국세청 상태 자동 입력
                      </span>
                    </div>

                    {matchedNotice && (
                      <div style={{
                        padding: '6px 10px',
                        marginBottom: '8px',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '4px',
                        fontSize: '11.5px',
                        color: '#2563eb',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <Check size={14} /> {matchedNotice}
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {/* 1. 사업자등록증 드롭존 */}
                      <div
                        onDragOver={e => { e.preventDefault(); setBizCertDropActive(true); }}
                        onDragLeave={() => setBizCertDropActive(false)}
                        onDrop={e => {
                          e.preventDefault();
                          setBizCertDropActive(false);
                          const f = e.dataTransfer.files?.[0];
                          if (f) handleProcessBizCertFile(f);
                        }}
                        style={{
                          border: bizCertDropActive ? '2px dashed var(--primary)' : '1px dashed var(--border-color)',
                          borderRadius: '6px',
                          padding: '10px',
                          backgroundColor: bizCertDropActive ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-card)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <FileCheck size={13} style={{ color: '#0284c7' }} /> 사업자등록증 (AI 자동인식)
                          </span>
                          {editingVendor.businessStatus && (
                            <span style={{
                              fontSize: '10.5px',
                              fontWeight: '600',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: editingVendor.businessStatus === 'CLOSED' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                              color: editingVendor.businessStatus === 'CLOSED' ? '#ef4444' : '#16a34a'
                            }}>
                              {editingVendor.businessStatus === 'CLOSED' ? `폐업(${editingVendor.closedDate || ''})` : '계속사업자'}
                            </span>
                          )}
                        </div>

                        {isAnalyzingBizCert ? (
                          <div style={{ padding: '14px 8px', textAlign: 'center', color: 'var(--primary)', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <Loader2 size={16} className="animate-spin" /> AI 등록증 분석 및 국세청 조회 중...
                          </div>
                        ) : editingVendor.businessCertFileUrl ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginTop: '2px' }}>
                            <a
                              href={editingVendor.businessCertFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '11.5px',
                                fontWeight: '600',
                                backgroundColor: 'rgba(2, 132, 199, 0.1)',
                                color: '#0284c7',
                                textDecoration: 'none',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '170px'
                              }}
                              title={editingVendor.businessCertFileName || '사업자등록증 열람'}
                            >
                              <FileText size={12} /> {editingVendor.businessCertFileName || '등록증 열람'} ↗
                            </a>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <label style={{
                                padding: '3px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                backgroundColor: 'var(--bg-app)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}>
                                변경
                                <input
                                  type="file"
                                  accept="image/*,application/pdf"
                                  style={{ display: 'none' }}
                                  onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) handleProcessBizCertFile(f);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => setEditingVendor({ ...editingVendor, businessCertFileUrl: undefined, businessCertFileName: undefined })}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  color: '#ef4444',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  padding: '2px'
                                }}
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                        ) : (
                          <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '12px 6px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            backgroundColor: 'var(--bg-app)',
                            border: '1px dashed var(--border-color)'
                          }}>
                            <Upload size={16} style={{ color: 'var(--text-muted)', marginBottom: '4px' }} />
                            <span style={{ fontSize: '11.5px', fontWeight: '600', color: 'var(--text-main)' }}>사업자등록증 드롭 또는 클릭</span>
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>상호·번호·대표자·업태·종목 자동 완성</span>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) handleProcessBizCertFile(f);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>

                      {/* 2. 통장사본 드롭존 */}
                      <div
                        onDragOver={e => { e.preventDefault(); setPassbookDropActive(true); }}
                        onDragLeave={() => setPassbookDropActive(false)}
                        onDrop={e => {
                          e.preventDefault();
                          setPassbookDropActive(false);
                          const f = e.dataTransfer.files?.[0];
                          if (f) handleProcessPassbookFile(f);
                        }}
                        style={{
                          border: passbookDropActive ? '2px dashed var(--primary)' : '1px dashed var(--border-color)',
                          borderRadius: '6px',
                          padding: '10px',
                          backgroundColor: passbookDropActive ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-card)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <CreditCard size={13} style={{ color: '#f59e0b' }} /> 통장사본 증빙
                          </span>
                        </div>

                        {editingVendor.passbookFileUrl ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginTop: '2px' }}>
                            <a
                              href={editingVendor.passbookFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '11.5px',
                                fontWeight: '600',
                                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                color: '#d97706',
                                textDecoration: 'none',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '170px'
                              }}
                              title={editingVendor.passbookFileName || '통장사본 열람'}
                            >
                              <FileText size={12} /> {editingVendor.passbookFileName || '통장사본 열람'} ↗
                            </a>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <label style={{
                                padding: '3px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                backgroundColor: 'var(--bg-app)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}>
                                변경
                                <input
                                  type="file"
                                  accept="image/*,application/pdf"
                                  style={{ display: 'none' }}
                                  onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) handleProcessPassbookFile(f);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => setEditingVendor({ ...editingVendor, passbookFileUrl: undefined, passbookFileName: undefined })}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  color: '#ef4444',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  padding: '2px'
                                }}
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                        ) : (
                          <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '12px 6px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            backgroundColor: 'var(--bg-app)',
                            border: '1px dashed var(--border-color)'
                          }}>
                            <Upload size={16} style={{ color: 'var(--text-muted)', marginBottom: '4px' }} />
                            <span style={{ fontSize: '11.5px', fontWeight: '600', color: 'var(--text-main)' }}>통장사본 드롭 또는 클릭</span>
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>대금 지급 계좌 확인용 사본 증빙</span>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) handleProcessPassbookFile(f);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>비고 / 특기사항</label>
                  <textarea
                    rows={2}
                    value={editingVendor.memo || ''}
                    onChange={e => setEditingVendor({ ...editingVendor, memo: e.target.value })}
                    placeholder="주요 취급 장비 및 단가 조건 등"
                    style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>취소</button>
                <button type="submit" className="btn-primary">저장 (적용)</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 📂 사업자등록증 폴더 일괄 등록 모달 */}
      {showBatchLicenseModal && (
        <BatchBusinessLicenseModal
          isOpen={showBatchLicenseModal}
          onClose={() => setShowBatchLicenseModal(false)}
          initialTargetType="VENDOR"
        />
      )}

      {/* 🏛️ 국세청 홈택스 사업자 휴폐업 전수 점검 스튜디오 */}
      {showNtsAuditModal && (
        <NtsStatusAuditModal
          isOpen={showNtsAuditModal}
          onClose={() => setShowNtsAuditModal(false)}
          initialTarget="VENDOR"
        />
      )}
    </div>
  );
};
