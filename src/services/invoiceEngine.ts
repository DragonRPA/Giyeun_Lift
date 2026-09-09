// @ts-nocheck
/**
 * invoiceEngine.ts — 청구 인보이스 통합 엔진
 *
 * 역할:
 *  1. generateInvoices()       — 월별 billings를 고객/현장 단위로 묶어 인보이스 생성
 *  2. consolidateExisting()    — 기존 billings(invoiceId=null)를 소급하여 인보이스로 묶기
 *  3. applyPaymentToInvoice()  — 인보이스 단위 수납 → billings 비례 배분
 *  4. cancelInvoice()          — 인보이스 취소 (billings.invoiceId null 복원)
 */

import { supabase, db } from './db';
import type { BillingInvoice, Billing } from './db';

// ──────────────────────────────────────────────
// 인보이스 ID 생성
// ──────────────────────────────────────────────
function generateInvoiceId(billingYm: string, seq: number): string {
  const ym = billingYm.replace('-', '');
  return `INV-${ym}-${String(seq).padStart(4, '0')}`;
}

// ──────────────────────────────────────────────
// 1. 월별 인보이스 자동 생성
// ──────────────────────────────────────────────

export type InvoiceGroupBy = 'CUSTOMER' | 'SITE';

export interface GenerateInvoicesOptions {
  billingYm: string;           // 'YYYY-MM'
  groupBy?: InvoiceGroupBy;    // 기본값: 'CUSTOMER'
  overwrite?: boolean;         // 이미 invoiceId가 있는 billing도 재묶기 (기본 false)
}

export async function generateInvoices(opts: GenerateInvoicesOptions): Promise<{
  created: number;
  skipped: number;
  invoices: BillingInvoice[];
}> {
  const { billingYm, groupBy = 'CUSTOMER', overwrite = false } = opts;
  const nowIso = new Date().toISOString();

  // 해당 월 billings 조회
  const filter = overwrite
    ? `billingYm=eq.${billingYm}`
    : `billingYm=eq.${billingYm}&invoiceId=is.null`;

  const { data: billings, error } = await supabase
    .from('billings')
    .select('*, contracts(siteId)')
    .eq('billingYm', billingYm)
    .is(overwrite ? undefined : 'invoiceId', overwrite ? undefined : null);

  if (error) throw new Error(`billings 조회 실패: ${error.message}`);
  if (!billings || billings.length === 0) return { created: 0, skipped: 0, invoices: [] };

  // 그룹핑 키 생성
  const groupMap = new Map<string, Billing[]>();
  for (const b of billings) {
    const siteId = groupBy === 'SITE' ? (b.contracts?.siteId ?? 'NO_SITE') : 'ALL';
    const key = `${b.customerId}__${siteId}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(b);
  }

  // 기존 인보이스 최대 seq 조회 (충돌 방지)
  const { data: existingInvs } = await supabase
    .from('billing_invoices')
    .select('id')
    .like('id', `INV-${billingYm.replace('-', '')}-%%`)
    .order('id', { ascending: false })
    .limit(1);

  let seq = 1;
  if (existingInvs && existingInvs.length > 0) {
    const lastId = existingInvs[0].id; // 'INV-202608-0023'
    const parts = lastId.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }

  const createdInvoices: BillingInvoice[] = [];
  let skipped = 0;

  for (const [key, groupBillings] of groupMap) {
    const [customerId, rawSiteId] = key.split('__');
    const siteId = rawSiteId === 'ALL' || rawSiteId === 'NO_SITE' ? null : rawSiteId;

    const totalAmount = groupBillings.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const paidAmount  = groupBillings.reduce((s, b) => s + (b.paidAmount  || 0), 0);

    // 상태 판단
    let status: BillingInvoice['status'] = 'DRAFT';
    if (totalAmount > 0 && paidAmount >= totalAmount) status = 'PAID';
    else if (paidAmount > 0) status = 'PARTIAL';

    // 납기일: 그룹 내 최초 billing의 dueDate 기준 (있으면)
    const dueDate = groupBillings.find(b => (b as any).dueDate)?.['dueDate'] ?? null;
    const vatAmount = Math.floor(totalAmount * 0.1);
    const grandTotal = totalAmount + vatAmount;

    const invoice: BillingInvoice = {
      id: generateInvoiceId(billingYm, seq++),
      customerId,
      billingYm,
      siteId: siteId ?? undefined,
      totalAmount,
      vatAmount,
      grandTotal,
      status,
      dueDate: dueDate ?? undefined,
      memo: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // billing_invoices UPSERT
    const { error: invErr } = await supabase
      .from('billing_invoices')
      .upsert([invoice], { onConflict: 'id' });

    if (invErr) {
      console.warn(`인보이스 생성 실패 (${invoice.id}):`, invErr.message);
      skipped += groupBillings.length;
      continue;
    }

    // billings.invoiceId 일괄 업데이트
    const billingIds = groupBillings.map(b => b.id);
    const { error: updateErr } = await supabase
      .from('billings')
      .update({ invoiceId: invoice.id, updatedAt: nowIso })
      .in('id', billingIds);

    if (updateErr) {
      console.warn(`billings invoiceId 주입 실패:`, updateErr.message);
      skipped += groupBillings.length;
    } else {
      createdInvoices.push(invoice);
    }
  }

  return { created: createdInvoices.length, skipped, invoices: createdInvoices };
}

// ──────────────────────────────────────────────
// 2. 기존 billings 소급 묶기
//    — invoiceId=null인 모든 billings를 billingYm별로 순회하여 인보이스 생성
// ──────────────────────────────────────────────
export async function consolidateExistingBillings(groupBy: InvoiceGroupBy = 'CUSTOMER'): Promise<{
  totalCreated: number;
  perYm: Record<string, number>;
}> {
  // null인 billings의 billingYm 목록 조회
  const { data: ymRows, error } = await supabase
    .from('billings')
    .select('billingYm')
    .is('invoiceId', null)
    .order('billingYm', { ascending: true });

  if (error) throw new Error(`billingYm 조회 실패: ${error.message}`);

  const ymSet = new Set<string>((ymRows || []).map(r => r.billingYm));
  const perYm: Record<string, number> = {};
  let totalCreated = 0;

  for (const billingYm of ymSet) {
    const result = await generateInvoices({ billingYm, groupBy, overwrite: false });
    perYm[billingYm] = result.created;
    totalCreated += result.created;
  }

  return { totalCreated, perYm };
}

// ──────────────────────────────────────────────
// 3. 인보이스 수납 처리 (비례 배분)
// ──────────────────────────────────────────────
export async function applyPaymentToInvoice(
  invoiceId: string,
  receivedAmount: number,
  paymentDate: string
): Promise<{ success: boolean; message: string }> {
  const nowIso = new Date().toISOString();

  // 인보이스 + 포함 billings 조회
  const { data: invoice, error: invErr } = await supabase
    .from('billing_invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();

  if (invErr || !invoice) return { success: false, message: `청구서통합 조회 실패: ${invErr?.message}` };

  const { data: billings, error: bErr } = await supabase
    .from('billings')
    .select('*')
    .eq('invoiceId', invoiceId);

  if (bErr || !billings) return { success: false, message: `청구 조회 실패: ${bErr?.message}` };

  const totalAmount = invoice.totalAmount || 1;

  // 비례 배분: 각 billing의 지분만큼 receivedAmount 배분
  for (const b of billings) {
    const share = Math.round(receivedAmount * (b.totalAmount / totalAmount));
    const newPaid = Math.min((b.paidAmount || 0) + share, b.totalAmount);
    const newStatus: Billing['status'] = newPaid >= b.totalAmount ? 'PAID'
      : newPaid > 0 ? 'PARTIAL' : b.status;

    await supabase
      .from('billings')
      .update({ paidAmount: newPaid, status: newStatus, updatedAt: nowIso })
      .eq('id', b.id);
  }

  // 청구서통합 상태 갱신
  const { data: updated } = await supabase
    .from('billings')
    .select('paidAmount, totalAmount')
    .eq('invoiceId', invoiceId);

  const newPaidTotal = (updated || []).reduce((s, b) => s + (b.paidAmount || 0), 0);
  const newInvStatus: BillingInvoice['status'] = newPaidTotal >= totalAmount ? 'PAID'
    : newPaidTotal > 0 ? 'PARTIAL' : 'ISSUED';

  await supabase
    .from('billing_invoices')
    .update({ status: newInvStatus, updatedAt: nowIso })
    .eq('id', invoiceId);

  return { success: true, message: `수납 완료: ₩${receivedAmount.toLocaleString()} 비례 배분` };
}

// ──────────────────────────────────────────────
// 4. 청구서통합 취소 (billings.invoiceId → null 복원)
// ──────────────────────────────────────────────
export async function cancelInvoice(invoiceId: string): Promise<{ success: boolean; message: string }> {
  const nowIso = new Date().toISOString();

  // 🔒 [감사관 가드] 수납(Payment) 존재 여부 확인 (수납 완료/부분수납 인보이스는 직접 취소 불가)
  if (supabase) {
    const { data: inv } = await supabase
      .from('billing_invoices')
      .select('paidAmount, status')
      .eq('id', invoiceId)
      .single();
    if (inv && (inv.paidAmount || 0) > 0) {
      return {
        success: false,
        message: `수납(₩${(inv.paidAmount || 0).toLocaleString()}원)이 발생한 청구서통합은 직접 취소할 수 없습니다. 은행 입출금 대장에서 통장 매칭을 먼저 해제해 주세요.`
      };
    }
  } else {
    const inv = db.billingInvoices?.find((i: any) => i.id === invoiceId);
    if (inv && (inv.paidAmount || 0) > 0) {
      return {
        success: false,
        message: `수납(₩${(inv.paidAmount || 0).toLocaleString()}원)이 발생한 청구서통합은 직접 취소할 수 없습니다. 은행 입출금 대장에서 통장 매칭을 먼저 해제해 주세요.`
      };
    }
  }

  // billings.invoiceId null 복원
  if (supabase) {
    const { error: resetErr } = await supabase
      .from('billings')
      .update({ invoiceId: null, updatedAt: nowIso })
      .eq('invoiceId', invoiceId);

    if (resetErr) return { success: false, message: `청구 초기화 실패: ${resetErr.message}` };

    // 청구서통합 CANCELLED 처리
    const { error: cancelErr } = await supabase
      .from('billing_invoices')
      .update({ status: 'CANCELLED', updatedAt: nowIso })
      .eq('id', invoiceId);

    if (cancelErr) return { success: false, message: `청구서통합 취소 실패: ${cancelErr.message}` };
  } else {
    const billings = db.billings || [];
    billings.forEach((b: any) => {
      if (b.invoiceId === invoiceId) {
        b.invoiceId = null;
        b.updatedAt = nowIso;
      }
    });
    const inv = db.billingInvoices?.find((i: any) => i.id === invoiceId);
    if (inv) {
      inv.status = 'CANCELLED';
      inv.updatedAt = nowIso;
    }
  }

  return { success: true, message: `청구서통합 ${invoiceId} 취소 및 개별 청구 복원 완료` };
}

// ──────────────────────────────────────────────
// 4-1. 실무자 선택적 청구서 묶기 (렌탈료 + 수리비 + 운반비 등 복합 통합)
// ──────────────────────────────────────────────
export interface ConsolidateSelectedOptions {
  billingIds: string[];
  customerId: string;
  billingYm: string;
  siteId?: string | null;
  memo?: string;
  dueDate?: string;
}

export async function consolidateSelectedBillings(opts: ConsolidateSelectedOptions): Promise<{
  success: boolean;
  message: string;
  invoice?: BillingInvoice;
}> {
  const { billingIds, customerId, billingYm, siteId, memo, dueDate } = opts;
  if (!billingIds || billingIds.length === 0) {
    return { success: false, message: '통합할 청구서가 선택되지 않았습니다.' };
  }
  const nowIso = new Date().toISOString();

  // 대상 billings 조회
  let selectedBillings: Billing[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from('billings')
      .select('*')
      .in('id', billingIds);
    if (error) return { success: false, message: `청구 데이터 조회 실패: ${error.message}` };
    selectedBillings = data || [];
  } else {
    selectedBillings = (db.billings || []).filter((b: any) => billingIds.includes(b.id));
  }

  if (selectedBillings.length === 0) {
    return { success: false, message: '선택된 청구 데이터를 찾을 수 없습니다.' };
  }

  // 합계금액 계산
  const totalAmount = selectedBillings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
  const paidAmount = selectedBillings.reduce((sum, b) => sum + (b.paidAmount || 0), 0);
  const vatAmount = Math.floor(totalAmount * 0.1);
  const grandTotal = totalAmount + vatAmount;

  // 상태 판단
  let status: BillingInvoice['status'] = 'DRAFT';
  if (totalAmount > 0 && paidAmount >= totalAmount) status = 'PAID';
  else if (paidAmount > 0) status = 'PARTIAL';
  else status = 'ISSUED';

  // 시퀀스 번호 결정
  let seq = 1;
  if (supabase) {
    const { data: existingInvs } = await supabase
      .from('billing_invoices')
      .select('id')
      .like('id', `INV-${billingYm.replace('-', '')}-%`)
      .order('id', { ascending: false })
      .limit(1);
    if (existingInvs && existingInvs.length > 0) {
      const lastId = existingInvs[0].id;
      const parts = lastId.split('-');
      seq = (parseInt(parts[parts.length - 1], 10) || 0) + 1;
    }
  } else {
    const invs = (db.billingInvoices || []).filter((i: any) => i.id?.startsWith(`INV-${billingYm.replace('-', '')}-`));
    seq = invs.length + 1;
  }

  const invoiceId = generateInvoiceId(billingYm, seq);
  const resolvedDueDate = dueDate || selectedBillings[0]?.dueDate || null;

  const invoice: BillingInvoice = {
    id: invoiceId,
    customerId,
    billingYm,
    siteId: siteId ?? undefined,
    totalAmount,
    vatAmount,
    grandTotal,
    status,
    dueDate: resolvedDueDate ?? undefined,
    issuedAt: nowIso,
    memo: memo || `${selectedBillings.length}건 복합 통합 청구`,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (supabase) {
    // 1. billing_invoices insert
    const { error: invErr } = await supabase.from('billing_invoices').upsert([invoice], { onConflict: 'id' });
    if (invErr) return { success: false, message: `통합 청구서 생성 실패: ${invErr.message}` };

    // 2. billings.invoiceId 업데이트
    const { error: updateErr } = await supabase
      .from('billings')
      .update({ invoiceId, updatedAt: nowIso })
      .in('id', billingIds);
    if (updateErr) return { success: false, message: `청구서 매핑 실패: ${updateErr.message}` };
  } else {
    if (!db.billingInvoices) db.billingInvoices = [];
    db.billingInvoices.push(invoice);
    (db.billings || []).forEach((b: any) => {
      if (billingIds.includes(b.id)) {
        b.invoiceId = invoiceId;
        b.updatedAt = nowIso;
      }
    });
  }

  return {
    success: true,
    message: `통합 청구서(${invoiceId}) 발행 완료: 청구 ${selectedBillings.length}건 묶음 (총 ₩${grandTotal.toLocaleString()}원)`,
    invoice
  };
}

// ──────────────────────────────────────────────
// 5. 청구서통합 목록 조회 (UI용)
// ──────────────────────────────────────────────
export async function fetchInvoices(billingYm?: string): Promise<BillingInvoice[]> {
  let query = supabase
    .from('billing_invoices')
    .select('*, billings(id, paidAmount, totalAmount, status)')
    .order('billingYm', { ascending: false })
    .order('customerId', { ascending: true });

  if (billingYm) query = query.eq('billingYm', billingYm);

  const { data, error } = await query;
  if (error) throw new Error(`청구서통합 조회 실패: ${error.message}`);

  return (data || []).map((inv: any) => {
    const childBillings = inv.billings || [];
    const paidAmount = childBillings.reduce((sum: number, b: any) => sum + (b.paidAmount || 0), 0);
    const totalAmount = inv.totalAmount || childBillings.reduce((sum: number, b: any) => sum + (b.totalAmount || 0), 0);
    let status = inv.status;
    if (inv.status !== 'CANCELLED') {
      if (totalAmount > 0 && paidAmount >= totalAmount) status = 'PAID';
      else if (paidAmount > 0) status = 'PARTIAL';
    }
    return {
      ...inv,
      paidAmount,
      status
    };
  });
}

// ──────────────────────────────────────────────
// 6. 인보이스 상세 조회 (billings + details 포함)
// ──────────────────────────────────────────────
export async function fetchInvoiceDetail(invoiceId: string): Promise<BillingInvoice | null> {
  const { data: inv, error } = await supabase
    .from('billing_invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();

  if (error || !inv) return null;

  const { data: billings } = await supabase
    .from('billings')
    .select('*, billing_details(*)')
    .eq('invoiceId', invoiceId)
    .order('billingDate', { ascending: true });

  return { ...inv, billings: billings || [] };
}
