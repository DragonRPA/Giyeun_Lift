// src/services/consumableMigrationService.ts
/**
 * 📦 기연리프트 소모품 및 부품 재고 파싱 & DB 마이그레이션 서비스
 * 
 * 원천 데이터: D:\OneDrive\Desktop\기연리프트자료_\자동업로드\밴드\소모품재고.txt
 * 표준 헌장:
 * - 카테고리 1.2: 발생되는 사건(Event) 기록의 무누락 DB 저장 (입고/적재 시 ConsumableLog 무누락 동시 저장)
 * - 카테고리 3.1: 무수식어 건조 표준
 * - 카테고리 5.2: await db.awaitPendingWrites() 무음 실패 방지
 */

import { Consumable, ConsumableLog, db } from './db';

export interface ParsedConsumableItem {
  id?: string;
  modelName: string;
  stockQty: number;
  unit: string;
  unitPrice: number;
  supplier: string;
  category: string;
  note?: string;
  repairingQty?: number;
}

export interface ConsumableIngestResult {
  addedCount: number;
  updatedCount: number;
  totalQty: number;
  totalAmount: number;
  items: Consumable[];
}

/** 30종 기본 관리 소모품 마스터 시드 데이터 (소모품재고.txt 기반 원천 데이터) */
export const SEED_INVENTORY_ITEMS: ParsedConsumableItem[] = [
  { modelName: 'JLG 충전기', stockQty: 2, unit: '개', unitPrice: 450000, supplier: 'JLG', category: '충전기', note: '' },
  { modelName: '지니 충전기', stockQty: 5, unit: '개', unitPrice: 400000, supplier: '지니 (Genie)', category: '충전기', note: '' },
  { modelName: '지니 P콘', stockQty: 1, unit: '개', unitPrice: 350000, supplier: '지니 (Genie)', category: '제어기', note: '플랫폼 컨트롤박스' },
  { modelName: '지니 P콘 케이블', stockQty: 1, unit: '개', unitPrice: 80000, supplier: '지니 (Genie)', category: '기판/전장', note: '' },
  { modelName: '지니 오일필터 (유압타입)', stockQty: 2, unit: '개', unitPrice: 35000, supplier: '지니 (Genie)', category: '밸브/유압', note: '' },
  { modelName: '지니 조향실린더', stockQty: 1, unit: '개', unitPrice: 250000, supplier: '지니 (Genie)', category: '모터/구동', note: '' },
  { modelName: '지니 포트홀 쿠션', stockQty: 2, unit: '개', unitPrice: 45000, supplier: '지니 (Genie)', category: '모터/구동', note: '' },
  { modelName: '지니 비상하강밸브', stockQty: 1, unit: '개', unitPrice: 120000, supplier: '지니 (Genie)', category: '밸브/유압', note: '' },
  { modelName: '지니 비상하강코일', stockQty: 2, unit: '개', unitPrice: 65000, supplier: '지니 (Genie)', category: '밸브/유압', note: '' },
  { modelName: '스카이잭 컨트롤박스', stockQty: 1, unit: '개', unitPrice: 450000, supplier: '스카이잭 (Skyjack)', category: '제어기', note: '' },
  { modelName: '스카이잭 마그네틱 콘택터', stockQty: 2, unit: '개', unitPrice: 75000, supplier: '스카이잭 (Skyjack)', category: '기판/전장', note: '' },
  { modelName: '스카이잭 상승밸브', stockQty: 1, unit: '개', unitPrice: 130000, supplier: '스카이잭 (Skyjack)', category: '밸브/유압', note: '' },
  { modelName: '스카이잭 모터컨트롤러', stockQty: 1, unit: '개', unitPrice: 600000, supplier: '스카이잭 (Skyjack)', category: '제어기', note: '' },
  { modelName: '스카이잭 유압 매니폴드 블록', stockQty: 1, unit: '개', unitPrice: 380000, supplier: '스카이잭 (Skyjack)', category: '밸브/유압', note: '' },
  { modelName: '스카이잭 솔레노이드 밸브 코일', stockQty: 1, unit: '개', unitPrice: 70000, supplier: '스카이잭 (Skyjack)', category: '밸브/유압', note: '' },
  { modelName: '스카이잭 하강밸브', stockQty: 1, unit: '개', unitPrice: 110000, supplier: '스카이잭 (Skyjack)', category: '밸브/유압', note: '' },
  { modelName: '스카이잭 12발 3단 토글 스위치', stockQty: 2, unit: '개', unitPrice: 25000, supplier: '스카이잭 (Skyjack)', category: '기판/전장', note: '' },
  { modelName: '스카이잭 조향실린더 엔드볼', stockQty: 8, unit: '개', unitPrice: 35000, supplier: '스카이잭 (Skyjack)', category: '모터/구동', note: '' },
  { modelName: '스카이잭 주행모터 기어박스', stockQty: 2, unit: '개', unitPrice: 850000, supplier: '스카이잭 (Skyjack)', category: '모터/구동', note: '' },
  { modelName: '지니 G콘 (유압식)', stockQty: 4, unit: '개', unitPrice: 320000, supplier: '지니 (Genie)', category: '제어기', note: '3개 수리중 (실가용 1개)', repairingQty: 3 },
  { modelName: '마그네틱 콘택터 (공용)', stockQty: 5, unit: '개', unitPrice: 65000, supplier: '공용', category: '기판/전장', note: '' },
  { modelName: '지니 조향밸브', stockQty: 2, unit: '개', unitPrice: 180000, supplier: '지니 (Genie)', category: '밸브/유압', note: '' },
  { modelName: '지니 틸트 센서', stockQty: 2, unit: '개', unitPrice: 140000, supplier: '지니 (Genie)', category: '안전/센서', note: '' },
  { modelName: '지니 상부기판 (6버튼)', stockQty: 10, unit: '개', unitPrice: 280000, supplier: '지니 (Genie)', category: '기판/전장', note: '' },
  { modelName: '지니 상부기판 (4버튼)', stockQty: 3, unit: '개', unitPrice: 250000, supplier: '지니 (Genie)', category: '기판/전장', note: '' },
  { modelName: '아날라이저 (진단기)', stockQty: 1, unit: '개', unitPrice: 550000, supplier: '공용', category: '안전/센서', note: '장비 점검 진단기' },
  { modelName: '지니 비상하강와이어', stockQty: 5, unit: '개', unitPrice: 45000, supplier: '지니 (Genie)', category: '안전/센서', note: '' },
  { modelName: '지니 조이스틱', stockQty: 30, unit: '개', unitPrice: 180000, supplier: '지니 (Genie)', category: '제어기', note: '' },
  { modelName: '지니 주행모터 (유압식)', stockQty: 1, unit: '개', unitPrice: 750000, supplier: '지니 (Genie)', category: '모터/구동', note: '수리중 (실가용 0개)', repairingQty: 1 },
  { modelName: '지니 브레이크', stockQty: 2, unit: '개', unitPrice: 220000, supplier: '지니 (Genie)', category: '모터/구동', note: '2개 수리중 (실가용 0개)', repairingQty: 2 },
];

/** 브랜드/공급처 스마트 판별기 */
export function detectSupplier(name: string): string {
  if (/지니|genie/i.test(name)) return '지니 (Genie)';
  if (/스카이잭|skyjack/i.test(name)) return '스카이잭 (Skyjack)';
  if (/jlg/i.test(name)) return 'JLG';
  return '공용';
}

/** 부품 카테고리 스마트 판별기 */
export function detectCategory(name: string): string {
  if (/충전기|charger/i.test(name)) return '충전기';
  if (/p콘|g콘|조이스틱|컨트롤박스|모터컨트롤러|joystick|controller/i.test(name)) return '제어기';
  if (/기판|케이블|스위치|콘택터|릴레이|전장/i.test(name)) return '기판/전장';
  if (/밸브|필터|매니폴드|코일|유압/i.test(name)) return '밸브/유압';
  if (/모터|기어박스|실린더|브레이크|엔드볼|쿠션/i.test(name)) return '모터/구동';
  if (/틸트|와이어|센서|아날라이저|경보기|차단/i.test(name)) return '안전/센서';
  return '기타소모품';
}

/** 품목명 정규화 (약칭, 오타, 기호 정돈) */
export function normalizeModelName(rawName: string): string {
  let n = rawName.trim();
  // 약어 대문자화
  n = n.replace(/\bp콘\b/gi, 'P콘').replace(/\bg콘\b/gi, 'G콘');
  // 띄어쓰기 정돈
  n = n.replace(/지니유압타입/g, '지니 유압타입');
  n = n.replace(/지니비상하강/g, '지니 비상하강');
  return n;
}

/** 텍스트 원문 파싱 함수 */
export function parseConsumableInventoryText(text: string): ParsedConsumableItem[] {
  if (!text || !text.trim()) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items: ParsedConsumableItem[] = [];

  for (const line of lines) {
    let cleanLine = line;
    let note = '';
    let repairingQty = 0;

    // 수리중 패턴 추출 (예: '3개수리중', '(수리중)', '수리중')
    const noteMatch = cleanLine.match(/(\(?\s*(\d+)?\s*개?\s*수리중\s*\)?)/);
    if (noteMatch) {
      const matchStr = noteMatch[0];
      const parsedNum = noteMatch[2] ? parseInt(noteMatch[2], 10) : undefined;
      note = matchStr.replace(/[\(\)]/g, '').trim();
      cleanLine = cleanLine.replace(matchStr, '').trim();
      if (parsedNum !== undefined) {
        repairingQty = parsedNum;
      } else {
        repairingQty = 1; // 단수 수리중
      }
    }

    // 끝부분 수량 숫자 추출
    const qtyMatch = cleanLine.match(/(\d+)\s*$/);
    let stockQty = 1;
    let rawName = cleanLine;

    if (qtyMatch) {
      stockQty = parseInt(qtyMatch[1], 10);
      rawName = cleanLine.substring(0, qtyMatch.index).trim();
    }

    // 괄호 규격 정리
    const modelName = normalizeModelName(rawName);
    const supplier = detectSupplier(modelName);
    const category = detectCategory(modelName);

    // 단가 추정 룩업 (시드에 기재된 표준 단가 우선)
    const seedMatch = SEED_INVENTORY_ITEMS.find(s => s.modelName.replace(/\s/g, '') === modelName.replace(/\s/g, ''));
    const unitPrice = seedMatch ? seedMatch.unitPrice : 0;

    items.push({
      modelName,
      stockQty,
      unit: '개',
      unitPrice,
      supplier,
      category,
      note: note || undefined,
      repairingQty: repairingQty > 0 ? repairingQty : undefined
    });
  }

  return items;
}

/** DB 반영 엔진: consumables 테이블 및 consumableLogs 테이블에 동시 적재 */
export async function ingestConsumablesToDatabase(
  items: ParsedConsumableItem[],
  actionUserId?: string
): Promise<ConsumableIngestResult> {
  const currentConsumables = [...db.consumables];
  const nowIso = new Date().toISOString();
  const todayYmd = nowIso.substring(0, 10);

  let addedCount = 0;
  let updatedCount = 0;
  let totalQty = 0;
  let totalAmount = 0;
  const savedItems: Consumable[] = [];

  for (const item of items) {
    const cleanTargetName = item.modelName.replace(/\s/g, '').toLowerCase();
    const existing = currentConsumables.find(
      c => c.modelName.replace(/\s/g, '').toLowerCase() === cleanTargetName
    );

    let targetConsumable: Consumable;

    if (existing) {
      // 기존 품목 존재: 재고 수량 갱신(또는 덮어쓰기) 및 단가 보정
      const newStockQty = item.stockQty;
      const diff = newStockQty - existing.stockQty;

      targetConsumable = db.updateRow<Consumable>('consumables', existing.id, {
        stockQty: newStockQty,
        unitPrice: item.unitPrice > 0 ? item.unitPrice : existing.unitPrice,
        supplier: item.supplier || existing.supplier,
        updatedAt: nowIso,
        // 확장 필드
        category: item.category,
        note: item.note || (existing as any).note,
        repairingQty: item.repairingQty || (existing as any).repairingQty,
      } as any) as Consumable;

      // 변동 수량이 있을 경우 로그 기록
      if (diff !== 0) {
        db.insertRow<ConsumableLog>('consumableLogs', {
          consumableId: targetConsumable.id,
          type: diff > 0 ? 'INBOUND' : 'ADJUST',
          quantity: Math.abs(diff),
          unitPrice: targetConsumable.unitPrice,
          supplier: targetConsumable.supplier,
          userId: actionUserId,
          fromLocation: '초기 소모품 재고 실사 업로드',
          toLocation: '주기장 재고',
          actionDate: todayYmd,
          description: `초기 재고 업로드 조정 (기존: ${existing.stockQty}개 ➔ 반영: ${newStockQty}개${item.note ? `, 비고: ${item.note}` : ''})`,
          createdAt: nowIso
        });
      }

      updatedCount++;
    } else {
      // 신규 품목 생성
      const newConsumableData = {
        modelName: item.modelName,
        stockQty: item.stockQty,
        unit: item.unit || '개',
        unitPrice: item.unitPrice || 0,
        supplier: item.supplier || '공용',
        category: item.category,
        note: item.note || '',
        repairingQty: item.repairingQty || 0,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      targetConsumable = db.insertRow<Consumable>('consumables', newConsumableData as any) as Consumable;

      // 최초 입고 로그 무누락 저장
      db.insertRow<ConsumableLog>('consumableLogs', {
        consumableId: targetConsumable.id,
        type: 'INBOUND',
        quantity: targetConsumable.stockQty,
        unitPrice: targetConsumable.unitPrice,
        supplier: targetConsumable.supplier,
        userId: actionUserId,
        fromLocation: '초기 소모품 재고 등록 (밴드 실사)',
        toLocation: '주기장 재고',
        actionDate: todayYmd,
        description: `초기 관리 소모품 최초 적재 (수량: ${targetConsumable.stockQty}개${item.note ? `, 비고: ${item.note}` : ''})`,
        createdAt: nowIso
      });

      addedCount++;
    }

    savedItems.push(targetConsumable);
    totalQty += item.stockQty;
    totalAmount += item.stockQty * (targetConsumable.unitPrice || 0);
  }

  // 헌장 5.2: 모든 CUD 액션은 await db.awaitPendingWrites() 동기 대기 검증
  await db.awaitPendingWrites();

  return {
    addedCount,
    updatedCount,
    totalQty,
    totalAmount,
    items: savedItems
  };
}
