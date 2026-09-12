// src/services/batchBusinessLicenseService.ts
// 사업자등록증 폴더/다중파일 일괄 순회 Vision AI 분석 및 매출처(고객사)/매입처(협력사) 자동 등록 엔진

import { Customer, Vendor } from './db';
import { analyzeBusinessLicense, BusinessLicenseAnalysisResult } from './visionOcrService';
import { uploadToSupabaseStorage } from './supabaseStorage';
import { checkSingleNtsStatus, NtsStatusResult } from './ntsBusinessService';

export type BatchTargetType = 'CUSTOMER' | 'VENDOR';
export type VendorTypeOption = 'RENTAL' | 'PURCHASE' | 'TRANSPORT' | 'REPAIR' | 'CONSUMABLE' | 'OTHER';

export interface BatchItemResult {
  index: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS_NEW' | 'SUCCESS_UPDATED' | 'FAILED' | 'SKIPPED';
  targetType: BatchTargetType;
  entityId?: string;
  companyName?: string;
  bizRegNo?: string;
  representative?: string;
  repContact?: string;
  repEmail?: string;
  address?: string;
  bizType?: string;
  bizItem?: string;
  taxOffice?: string;
  openingDate?: string;
  vendorType?: VendorTypeOption;
  fileUrl?: string;
  ntsStatus?: string;      // '계속사업자' | '휴업자' | '폐업자' | '국세청 미등록'
  ntsTaxType?: string;     // '부가가치세 일반과세자' 등
  ntsClosedDate?: string;  // 폐업일자 (YYYY-MM-DD)
  details?: string;
  error?: string;
  elapsedMs?: number;
}

export interface BatchProgressStats {
  total: number;
  processed: number;
  pending: number;
  successNew: number;
  successUpdated: number;
  failed: number;
  skipped: number;
  percent: number;
}

export interface BatchProcessOptions {
  targetType: BatchTargetType;
  defaultVendorType?: VendorTypeOption;
  delayBetweenMs?: number;
  abortSignal?: AbortSignal;
  saveCustomer: (cust: Omit<Customer, 'id' | 'createdAt'> & { id?: string }) => Promise<Customer>;
  saveVendor: (vendor: Vendor) => Promise<void>;
  existingCustomers: Customer[];
  existingVendors: Vendor[];
  onProgress?: (stats: BatchProgressStats, currentItem: BatchItemResult) => void;
}

// 지원 확장자
const VALID_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp']);

/**
 * 1. 폴더 또는 다중 파일 목록에서 유효한 사업자등록증 파일만 재귀 필터링
 */
export function filterValidLicenseFiles(files: (File | { file: File; path?: string })[]): { file: File; path: string }[] {
  const result: { file: File; path: string }[] = [];

  for (const item of files) {
    const file = 'file' in item ? item.file : item;
    const path = ('path' in item && item.path) ? item.path : (file as any).webkitRelativePath || file.name;

    // 맥 시스템 파일 및 숨김 파일 제외
    if (path.includes('__MACOSX') || path.includes('.DS_Store') || file.name.startsWith('.')) {
      continue;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (VALID_EXTENSIONS.has(ext) && file.size > 0) {
      result.push({ file, path });
    }
  }

  return result;
}

/**
 * 2. Drag & Drop DataTransferItemList에서 폴더 재귀 탐색 추출
 */
export async function extractFilesFromDataTransfer(items: DataTransferItemList): Promise<{ file: File; path: string }[]> {
  const collected: { file: File; path: string }[] = [];

  async function traverseEntry(entry: any, currentPath: string = '') {
    if (!entry) return;
    if (entry.isFile) {
      try {
        const file: File = await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });
        const path = currentPath ? `${currentPath}/${file.name}` : file.name;
        collected.push({ file, path });
      } catch (err) {
        console.warn('Entry file reading failed:', err);
      }
    } else if (entry.isDirectory) {
      const dirPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      const dirReader = entry.createReader();
      const readAll = async (): Promise<any[]> => {
        const entries: any[] = await new Promise((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        });
        if (entries.length > 0) {
          const rest = await readAll();
          return entries.concat(rest);
        }
        return entries;
      };

      try {
        const entries = await readAll();
        for (const child of entries) {
          await traverseEntry(child, dirPath);
        }
      } catch (err) {
        console.warn('Directory reading failed:', err);
      }
    }
  }

  const entriesToProcess: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry) entriesToProcess.push(entry);
    } else if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) collected.push({ file: f, path: f.name });
    }
  }

  for (const entry of entriesToProcess) {
    await traverseEntry(entry);
  }

  return filterValidLicenseFiles(collected);
}

/**
 * 3. 상호 정규화 헬퍼 (주식회사, (주), 유한회사, 공백 제거)
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return '';
  return name
    .replace(/\(주\)|주식회사|\(유\)|유한회사|\(합\)|합자회사/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * 4. 지연 대기 헬퍼
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 5. 단일 파일 처리 (Vision AI 분석 + 스토리지 업로드 + DB 대사 및 등록/보완)
 */
export async function processSingleLicense(
  fileItem: { file: File; path: string },
  index: number,
  options: BatchProcessOptions
): Promise<BatchItemResult> {
  const { file, path } = fileItem;
  const t0 = Date.now();

  const baseResult: BatchItemResult = {
    index,
    fileName: file.name,
    filePath: path,
    fileSize: file.size,
    status: 'PROCESSING',
    targetType: options.targetType,
    vendorType: options.targetType === 'VENDOR' ? (options.defaultVendorType || 'RENTAL') : undefined
  };

  try {
    // 1) Vision AI 분석 호출 (지수 백오프 429 재시도 1회 포함)
    let analysis: BusinessLicenseAnalysisResult;
    try {
      analysis = await analyzeBusinessLicense(file);
    } catch (firstErr: any) {
      if (String(firstErr?.message || '').includes('429')) {
        await sleep(3000);
        analysis = await analyzeBusinessLicense(file);
      } else {
        throw firstErr;
      }
    }

    if (!analysis.success || !analysis.bizRegNo) {
      return {
        ...baseResult,
        status: 'FAILED',
        error: analysis.error || '사업자등록번호 또는 핵심 정보를 판독할 수 없습니다.',
        elapsedMs: Date.now() - t0
      };
    }

    const cleanBizNoDigits = (analysis.bizRegNo || '').replace(/[^0-9]/g, '');
    const cleanExtractedName = normalizeCompanyName(analysis.companyName || '');

    // 2) 증빙 영구 보존용 스토리지 업로드 (실패해도 등록은 계속 진행)
    let fileUrl = '';
    try {
      const ext = file.name.split('.').pop() || 'png';
      const storageFolder = options.targetType === 'CUSTOMER' ? 'customer_licenses' : 'vendor_licenses';
      const cleanNo = cleanBizNoDigits || 'cert';
      const fileName = `${cleanNo}_${Date.now()}_${index}.${ext}`;
      const uploadRes = await uploadToSupabaseStorage({
        file,
        fileName,
        folder: storageFolder
      });
      if (uploadRes.success) {
        fileUrl = uploadRes.fileUrl;
      }
    } catch (uploadErr) {
      console.warn('[BatchBusinessLicense] Storage upload skipped/warned:', uploadErr);
    }

    // 2.5) 국세청 홈택스 실시간 휴폐업 및 과세유형 진위확인
    let ntsData: NtsStatusResult | null = null;
    if (cleanBizNoDigits && cleanBizNoDigits.length === 10) {
      try {
        ntsData = await checkSingleNtsStatus(cleanBizNoDigits);
      } catch (ntsErr) {
        console.warn('[BatchBusinessLicense] NTS check error:', ntsErr);
      }
    }
    const isNtsClosed = ntsData?.status === 'CLOSED';

    // 3) 분기 처리: 매출처(고객사) vs 매입처(협력사)
    if (options.targetType === 'CUSTOMER') {
      // 3-A. 기존 고객사 대조 (사업자번호 10자리 -> 상호명 정규화)
      let matchedCust = options.existingCustomers.find(c => {
        const cDigits = (c.bizRegNo || '').replace(/[^0-9]/g, '');
        return cleanBizNoDigits.length === 10 && cDigits === cleanBizNoDigits;
      });

      if (!matchedCust && cleanExtractedName.length >= 2) {
        matchedCust = options.existingCustomers.find(c => {
          const cNameNorm = normalizeCompanyName(c.name || '');
          return cNameNorm.length >= 2 && cNameNorm === cleanExtractedName;
        });
      }

      if (matchedCust) {
        // 기존 고객 정보 보완 (기존 정보가 없거나 '미상'인 항목만 스마트 보완)
        const updatedCust: Customer = {
          ...matchedCust,
          bizRegNo: (!matchedCust.bizRegNo || matchedCust.bizRegNo === '미상') ? (analysis.bizRegNo || matchedCust.bizRegNo) : matchedCust.bizRegNo,
          representative: (!matchedCust.representative || matchedCust.representative === '미상') ? (analysis.representative || matchedCust.representative) : matchedCust.representative,
          address: (!matchedCust.address || matchedCust.address === '미상') ? (analysis.address || matchedCust.address) : matchedCust.address,
          bizType: !matchedCust.bizType ? (analysis.bizType || matchedCust.bizType) : matchedCust.bizType,
          bizItem: !matchedCust.bizItem ? (analysis.bizItem || matchedCust.bizItem) : matchedCust.bizItem,
          repEmail: (!matchedCust.repEmail || matchedCust.repEmail === '미상') ? (analysis.taxEmail || matchedCust.repEmail) : matchedCust.repEmail,
          repContact: (!matchedCust.repContact || matchedCust.repContact === '미상') ? (analysis.repContact || matchedCust.repContact) : matchedCust.repContact,
          taxOffice: !matchedCust.taxOffice ? (analysis.taxOffice || matchedCust.taxOffice) : matchedCust.taxOffice,
          openingDate: !matchedCust.openingDate ? (analysis.openingDate || matchedCust.openingDate) : matchedCust.openingDate,
          businessCertFileUrl: fileUrl || matchedCust.businessCertFileUrl,
          taxType: ntsData?.taxType || matchedCust.taxType,
          taxTypeCd: ntsData?.taxTypeCd || matchedCust.taxTypeCd,
          businessStatus: ntsData?.status || matchedCust.businessStatus,
          closedDate: ntsData?.closedDate || matchedCust.closedDate,
          lastStatusCheckDate: ntsData?.checkedAt || matchedCust.lastStatusCheckDate,
          isClosed: isNtsClosed ? true : matchedCust.isClosed,
          transactionStatus: isNtsClosed ? 'BLOCKED' : matchedCust.transactionStatus,
          updatedAt: new Date().toISOString()
        };

        await options.saveCustomer(updatedCust);

        return {
          ...baseResult,
          status: 'SUCCESS_UPDATED',
          entityId: matchedCust.id,
          companyName: updatedCust.name,
          bizRegNo: updatedCust.bizRegNo,
          representative: updatedCust.representative,
          repContact: updatedCust.repContact,
          repEmail: updatedCust.repEmail,
          address: updatedCust.address,
          bizType: updatedCust.bizType,
          bizItem: updatedCust.bizItem,
          taxOffice: updatedCust.taxOffice,
          openingDate: updatedCust.openingDate,
          fileUrl,
          ntsStatus: ntsData?.statusLabel,
          ntsTaxType: ntsData?.taxType,
          ntsClosedDate: ntsData?.closedDate,
          details: isNtsClosed 
            ? `기존 고객사 보완 (국세청 폐업 확인: 폐업일 ${ntsData?.closedDate || '미상'} - 출고제한 적용)` 
            : `기존 고객사 매칭 완료 (${matchedCust.name}) - 누락 정보 보완`,
          elapsedMs: Date.now() - t0
        };
      } else {
        // 신규 고객사 등록
        const newCustData: Omit<Customer, 'id' | 'createdAt'> = {
          name: analysis.companyName?.trim() || file.name.replace(/\.[^/.]+$/, ''),
          bizRegNo: analysis.bizRegNo?.trim() || '미상',
          representative: analysis.representative?.trim() || '미상',
          repContact: analysis.repContact?.trim() || '미상',
          repEmail: analysis.taxEmail?.trim() || '미상',
          address: analysis.address?.trim() || '미상',
          bizType: analysis.bizType?.trim() || undefined,
          bizItem: analysis.bizItem?.trim() || undefined,
          taxOffice: analysis.taxOffice?.trim() || undefined,
          openingDate: analysis.openingDate?.trim() || undefined,
          businessCertFileUrl: fileUrl || undefined,
          isClosed: isNtsClosed,
          transactionStatus: isNtsClosed ? 'BLOCKED' : 'ALLOWED',
          taxType: ntsData?.taxType,
          taxTypeCd: ntsData?.taxTypeCd,
          businessStatus: ntsData?.status || 'ACTIVE',
          closedDate: ntsData?.closedDate,
          lastStatusCheckDate: ntsData?.checkedAt,
          defaultBillingDay: 30,
          defaultStatementClosingDay: 25,
          paymentDueDay: 25
        };

        const savedCust = await options.saveCustomer(newCustData);

        return {
          ...baseResult,
          status: 'SUCCESS_NEW',
          entityId: savedCust.id,
          companyName: savedCust.name,
          bizRegNo: savedCust.bizRegNo,
          representative: savedCust.representative,
          repContact: savedCust.repContact,
          repEmail: savedCust.repEmail,
          address: savedCust.address,
          bizType: savedCust.bizType,
          bizItem: savedCust.bizItem,
          taxOffice: savedCust.taxOffice,
          openingDate: savedCust.openingDate,
          fileUrl,
          ntsStatus: ntsData?.statusLabel,
          ntsTaxType: ntsData?.taxType,
          ntsClosedDate: ntsData?.closedDate,
          details: isNtsClosed 
            ? `신규 고객사 등록 (국세청 폐업 확인: 폐업일 ${ntsData?.closedDate || '미상'} - 출고제한 격리)` 
            : '신규 매출처 고객사 등록 완결',
          elapsedMs: Date.now() - t0
        };
      }
    } else {
      // 3-B. 매입거래처(협력사) 처리
      let matchedVendor = options.existingVendors.find(v => {
        const vDigits = (v.bizRegNo || '').replace(/[^0-9]/g, '');
        return cleanBizNoDigits.length === 10 && vDigits === cleanBizNoDigits;
      });

      if (!matchedVendor && cleanExtractedName.length >= 2) {
        matchedVendor = options.existingVendors.find(v => {
          const vNameNorm = normalizeCompanyName(v.name || '');
          return vNameNorm.length >= 2 && vNameNorm === cleanExtractedName;
        });
      }

      const defaultType = options.defaultVendorType || 'RENTAL';

      if (matchedVendor) {
        // 기존 매입처 정보 보완
        const existingTypes = matchedVendor.types || [matchedVendor.type];
        const updatedTypes = existingTypes.includes(defaultType) ? existingTypes : [...existingTypes, defaultType];

        const updatedVendor: Vendor = {
          ...matchedVendor,
          bizRegNo: (!matchedVendor.bizRegNo || matchedVendor.bizRegNo === '미상') ? (analysis.bizRegNo || matchedVendor.bizRegNo) : matchedVendor.bizRegNo,
          representative: (!matchedVendor.representative || matchedVendor.representative === '미상') ? (analysis.representative || matchedVendor.representative) : matchedVendor.representative,
          contact: (!matchedVendor.contact || matchedVendor.contact === '미상') ? (analysis.repContact || matchedVendor.contact) : matchedVendor.contact,
          email: (!matchedVendor.email || matchedVendor.email === '미상') ? (analysis.taxEmail || matchedVendor.email) : matchedVendor.email,
          address: (!matchedVendor.address || matchedVendor.address === '미상') ? (analysis.address || matchedVendor.address) : matchedVendor.address,
          types: updatedTypes,
          taxType: ntsData?.taxType || matchedVendor.taxType,
          businessStatus: ntsData?.status || matchedVendor.businessStatus,
          closedDate: ntsData?.closedDate || matchedVendor.closedDate,
          lastStatusCheckDate: ntsData?.checkedAt || matchedVendor.lastStatusCheckDate,
          isActive: isNtsClosed ? false : matchedVendor.isActive,
          updatedAt: new Date().toISOString()
        };

        await options.saveVendor(updatedVendor);

        return {
          ...baseResult,
          status: 'SUCCESS_UPDATED',
          entityId: matchedVendor.id,
          companyName: updatedVendor.name,
          bizRegNo: updatedVendor.bizRegNo,
          representative: updatedVendor.representative,
          repContact: updatedVendor.contact,
          repEmail: updatedVendor.email,
          address: updatedVendor.address,
          vendorType: defaultType,
          fileUrl,
          ntsStatus: ntsData?.statusLabel,
          ntsTaxType: ntsData?.taxType,
          ntsClosedDate: ntsData?.closedDate,
          details: isNtsClosed
            ? `기존 매입처 보완 (국세청 폐업 확인: 폐업일 ${ntsData?.closedDate || '미상'} - 비활성화)`
            : `기존 매입처 매칭 완료 (${matchedVendor.name}) - 정보 보완`,
          elapsedMs: Date.now() - t0
        };
      } else {
        // 신규 매입처 등록
        const newVendorId = `VND-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const newVendor: Vendor = {
          id: newVendorId,
          name: analysis.companyName?.trim() || file.name.replace(/\.[^/.]+$/, ''),
          bizRegNo: analysis.bizRegNo?.trim() || '',
          type: defaultType,
          types: [defaultType],
          representative: analysis.representative?.trim() || '',
          contactName: analysis.representative?.trim() || '',
          contact: analysis.repContact?.trim() || '',
          email: analysis.taxEmail?.trim() || '',
          address: analysis.address?.trim() || '',
          isActive: isNtsClosed ? false : true,
          taxType: ntsData?.taxType,
          businessStatus: ntsData?.status || 'ACTIVE',
          closedDate: ntsData?.closedDate,
          lastStatusCheckDate: ntsData?.checkedAt,
          totalPurchaseAmount: 0,
          createdAt: new Date().toISOString(),
          memo: `사업자등록증 일괄 등록 (${new Date().toLocaleDateString()})${isNtsClosed ? ' [국세청 폐업 확인]' : ''}`
        };

        await options.saveVendor(newVendor);

        return {
          ...baseResult,
          status: 'SUCCESS_NEW',
          entityId: newVendorId,
          companyName: newVendor.name,
          bizRegNo: newVendor.bizRegNo,
          representative: newVendor.representative,
          repContact: newVendor.contact,
          repEmail: newVendor.email,
          address: newVendor.address,
          vendorType: defaultType,
          fileUrl,
          ntsStatus: ntsData?.statusLabel,
          ntsTaxType: ntsData?.taxType,
          ntsClosedDate: ntsData?.closedDate,
          details: isNtsClosed
            ? `신규 매입처 등록 (국세청 폐업 확인: 폐업일 ${ntsData?.closedDate || '미상'} - 비활성 격리)`
            : `신규 매입처 등록 완결 (유형: ${defaultType})`,
          elapsedMs: Date.now() - t0
        };
      }
    }
  } catch (err: any) {
    console.error('[BatchBusinessLicense] 처리 실패:', file.name, err);
    return {
      ...baseResult,
      status: 'FAILED',
      error: err?.message || '처리 중 알 수 없는 예외가 발생했습니다.',
      elapsedMs: Date.now() - t0
    };
  }
}

/**
 * 6. 전체 배치 순회 실행기 (Sequential Queue with Rate Limiting & Abort Control)
 */
export async function runBatchBusinessLicenses(
  files: { file: File; path: string }[],
  options: BatchProcessOptions
): Promise<BatchItemResult[]> {
  const results: BatchItemResult[] = [];
  const total = files.length;
  const delayMs = options.delayBetweenMs ?? 800;

  let successNew = 0;
  let successUpdated = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < total; i++) {
    // 중단 신호 감지
    if (options.abortSignal?.aborted) {
      for (let j = i; j < total; j++) {
        results.push({
          index: j + 1,
          fileName: files[j].file.name,
          filePath: files[j].path,
          fileSize: files[j].file.size,
          status: 'SKIPPED',
          targetType: options.targetType,
          details: '사용자 일시정지/중단에 의한 건너뜀'
        });
        skipped++;
      }
      break;
    }

    const item = files[i];

    // 직전 건 통보 (PROCESSING 상태)
    const currentStats: BatchProgressStats = {
      total,
      processed: i,
      pending: total - i,
      successNew,
      successUpdated,
      failed,
      skipped,
      percent: Math.round((i / total) * 100)
    };
    options.onProgress?.(currentStats, {
      index: i + 1,
      fileName: item.file.name,
      filePath: item.path,
      fileSize: item.file.size,
      status: 'PROCESSING',
      targetType: options.targetType
    });

    // 단건 실행
    const itemResult = await processSingleLicense(item, i + 1, options);
    results.push(itemResult);

    if (itemResult.status === 'SUCCESS_NEW') successNew++;
    else if (itemResult.status === 'SUCCESS_UPDATED') successUpdated++;
    else if (itemResult.status === 'FAILED') failed++;
    else if (itemResult.status === 'SKIPPED') skipped++;

    // 완료 통보
    const postStats: BatchProgressStats = {
      total,
      processed: i + 1,
      pending: total - (i + 1),
      successNew,
      successUpdated,
      failed,
      skipped,
      percent: Math.round(((i + 1) / total) * 100)
    };
    options.onProgress?.(postStats, itemResult);

    // Rate limiting delay (마지막 파일 제외)
    if (i < total - 1 && !options.abortSignal?.aborted) {
      await sleep(delayMs);
    }
  }

  return results;
}
