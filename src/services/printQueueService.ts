// src/services/printQueueService.ts
// 🖨️ 분산 인쇄 큐 및 멀티 프린터 스테이션 서비스 (헌장 1.1, 1.2, 3.1 명사 표준)

import { db, PrintStation, PrintQueueItem } from './db';

const AGENT_BASE_URL = 'http://127.0.0.1:5175';

export interface LocalAgentPrintersResult {
  online: boolean;
  printers: string[];
  defaultPrinter: string;
  machineName?: string;
  error?: string;
}

export interface LocalStationConfig {
  stationId?: string;
  stationName?: string;
  localPrinterName?: string;
  docTypeDefault?: 'DISPATCH_ORDER' | 'RETURN_ORDER' | 'ALL';
  machineName?: string;
}

/**
 * 1. 로컬 PC에 떠 있는 eBroAgent로부터 실제 OS 프린터 목록 조회
 */
export async function fetchLocalPrintersFromAgent(): Promise<LocalAgentPrintersResult> {
  try {
    const res = await fetch(`${AGENT_BASE_URL}/api/printers`, {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      return {
        online: true,
        printers: Array.isArray(data.printers) ? data.printers : [],
        defaultPrinter: data.defaultPrinter || '',
        machineName: data.machineName || ''
      };
    }
  } catch (err: any) {
    // 에이전트 미기동 또는 오프라인
  }
  return {
    online: false,
    printers: [],
    defaultPrinter: '',
    error: '로컬 에이전트(eBroAgent)가 가동 중이지 않습니다.'
  };
}

/**
 * 2. 로컬 에이전트에 저장된 현재 컴퓨터의 스테이션 설정 조회
 */
export async function fetchLocalStationConfigFromAgent(): Promise<LocalStationConfig | null> {
  try {
    const res = await fetch(`${AGENT_BASE_URL}/api/station-config`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      return data.config || null;
    }
  } catch (e) {}
  return null;
}

/**
 * 3. 로컬 에이전트에 스테이션 설정 저장 (C:\eBroAgent\station_config.json)
 */
export async function saveStationConfigToAgent(config: LocalStationConfig): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_BASE_URL}/api/station-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/**
 * 4. 활성 인쇄 스테이션 목록 조회 (중앙 DB)
 */
export function getPrintStations(): PrintStation[] {
  return db.printStations;
}

/**
 * 5. 인쇄 스테이션 등록 및 수정 (중앙 DB + 로컬 에이전트 동시 반영)
 */
export async function registerPrintStation(station: {
  id?: string;
  stationName: string;
  localPrinterName: string;
  machineName?: string;
  docTypeDefault?: 'DISPATCH_ORDER' | 'RETURN_ORDER' | 'ALL';
  description?: string;
}): Promise<PrintStation> {
  const now = new Date().toISOString();
  const existingList = db.printStations;

  // 신규 등록 시 고유 ID 채번, 수정 시 지정된 station.id 사용
  let targetId = station.id;
  if (!targetId) {
    targetId = `STATION-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  const payload: PrintStation = {
    id: targetId,
    stationName: station.stationName.trim(),
    machineName: station.machineName || '',
    localPrinterName: station.localPrinterName.trim(),
    docTypeDefault: station.docTypeDefault || 'ALL',
    description: station.description || '',
    status: 'ONLINE',
    lastHeartbeat: now,
    createdAt: existingList.find(s => s.id === targetId)?.createdAt || now,
    updatedAt: now
  };

  const existing = existingList.find(s => s.id === targetId);
  if (existing) {
    db.updateRow<PrintStation>('printStations', targetId, payload);
  } else {
    db.insertRow<PrintStation>('printStations', payload);
  }

  await db.awaitPendingWrites();

  // 현재 PC의 로컬 에이전트에도 즉시 영구 저장
  await saveStationConfigToAgent({
    stationId: payload.id,
    stationName: payload.stationName,
    localPrinterName: payload.localPrinterName,
    docTypeDefault: payload.docTypeDefault,
    machineName: payload.machineName
  });

  return payload;
}

/**
 * 6. 인쇄 스테이션 삭제
 */
export async function deletePrintStation(id: string): Promise<void> {
  db.deleteRow('printStations', id);
  await db.awaitPendingWrites();
}

/**
 * 7. 문서 유형별 최적 인쇄 스테이션 자동 탐색 (라우팅)
 */
export function resolveTargetStation(docType: 'DISPATCH_ORDER' | 'RETURN_ORDER', explicitStationId?: string): PrintStation | undefined {
  const stations = db.printStations;
  if (stations.length === 0) return undefined;

  // 1순위: 사용자가 명시적으로 선택한 스테이션
  if (explicitStationId) {
    const found = stations.find(s => s.id === explicitStationId);
    if (found) return found;
  }

  // 2순위: 해당 문서 유형이 기본값으로 매핑된 스테이션
  const matchedDocType = stations.find(s => s.docTypeDefault === docType);
  if (matchedDocType) return matchedDocType;

  // 3순위: 명칭 기반 휴리스틱 매핑 (출고 ➔ '프린터1' or '출고', 입고 ➔ '프린터2' or '입고')
  if (docType === 'DISPATCH_ORDER') {
    const p1 = stations.find(s => s.stationName.includes('프린터1') || s.stationName.includes('출고'));
    if (p1) return p1;
  } else if (docType === 'RETURN_ORDER') {
    const p2 = stations.find(s => s.stationName.includes('프린터2') || s.stationName.includes('입고') || s.stationName.includes('반납'));
    if (p2) return p2;
  }

  // 4순위: 첫 번째 활성 스테이션
  return stations[0];
}

/**
 * 8. 인쇄 큐에 작업 등록 (사무실 ➔ 중앙 DB)
 */
export async function enqueuePrintJob(params: {
  stationId?: string;
  docType: 'DISPATCH_ORDER' | 'RETURN_ORDER';
  docNo?: string;
  title: string;
  documentHtml: string;
  requestedById?: string;
  requestedByName?: string;
}): Promise<PrintQueueItem> {
  const targetStation = resolveTargetStation(params.docType, params.stationId);
  if (!targetStation) {
    throw new Error('등록된 인쇄 스테이션이 없습니다. [시스템 관리 ➔ 프린트 큐 모니터]에서 스테이션을 먼저 등록해 주세요.');
  }

  const now = new Date().toISOString();
  const jobId = `PQ-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const jobItem: PrintQueueItem = {
    id: jobId,
    stationId: targetStation.id,
    stationName: targetStation.stationName,
    docType: params.docType,
    docNo: params.docNo || '',
    title: params.title,
    documentHtml: params.documentHtml,
    status: 'PENDING',
    requestedById: params.requestedById,
    requestedByName: params.requestedByName || '사무직원',
    requestedAt: now,
    retryCount: 0,
    createdAt: now,
    updatedAt: now
  };

  db.insertRow<PrintQueueItem>('printQueue', jobItem);
  await db.awaitPendingWrites();

  return jobItem;
}

/**
 * 9. 인쇄 큐 목록 조회
 */
export function getPrintQueue(filter?: { stationId?: string; status?: string }): PrintQueueItem[] {
  let list = db.printQueue;
  if (filter?.stationId) {
    list = list.filter(q => q.stationId === filter.stationId);
  }
  if (filter?.status) {
    list = list.filter(q => q.status === filter.status);
  }
  // 최신 발행순 정렬
  return [...list].sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
}

/**
 * 10. 실패 작업 재출력 요청 (Retry)
 */
export async function retryPrintJob(id: string): Promise<void> {
  const item = db.printQueue.find(q => q.id === id);
  if (!item) return;

  const now = new Date().toISOString();
  db.updateRow<PrintQueueItem>('printQueue', id, {
    status: 'PENDING',
    errorMessage: undefined,
    retryCount: (item.retryCount || 0) + 1,
    updatedAt: now
  });
  await db.awaitPendingWrites();
}

/**
 * 11. 대기 작업 취소
 */
export async function cancelPrintJob(id: string): Promise<void> {
  const now = new Date().toISOString();
  db.updateRow<PrintQueueItem>('printQueue', id, {
    status: 'CANCELED',
    updatedAt: now
  });
  await db.awaitPendingWrites();
}
