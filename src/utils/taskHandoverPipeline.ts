// src/utils/taskHandoverPipeline.ts
import { db, Todo, TaskCategory } from '../services/db';
import { broadcastWorkNotification } from './workNotificationService';

export interface IssueHandoverTaskParams {
  category: TaskCategory;
  title: string;
  content: string;
  priority?: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  targetType?: 'USER' | 'DEPT';
  targetDept?: 'DISPATCH' | 'YARD' | 'AS' | 'ACCOUNTING' | 'SALES' | 'EXECUTIVE' | string;
  targetRole?: string;
  assignedUserId?: string;
  dueDate?: string;
  actionUrl?: string;
  entityType: 'CONTRACT' | 'DELIVERY' | 'INSPECTION' | 'REPAIR' | 'BILLING' | 'SETTLEMENT' | 'CUSTOMER' | 'CONSUMABLE' | 'LEAVE' | 'DIRECTIVE' | string;
  entityId: string;
  senderId?: string;
  senderName?: string;
}

export interface ClearHandoverTasksParams {
  entityType?: string;
  entityId: string;
  category?: TaskCategory;
  completedByUserId?: string;
  completedByName?: string;
  completionAction: string;
  resolutionNote?: string;
}

/**
 * 🚀 [1] 물리적 ToDo 발행 + 실시간 브로드캐스트 원스톱 파이프라인
 */
export async function issueHandoverTask(params: IssueHandoverTaskParams): Promise<Todo> {
  const nowIso = new Date().toISOString();
  const todoId = db.generateNextId('todos', db.todos);

  // fallback userId for legacy compatibility
  let validUserId = params.assignedUserId;
  if (!validUserId) {
    if (params.targetDept === 'DISPATCH') {
      const dispatchUser = db.users.find(u => (u.department || '').includes('배차') || (u.role || '').includes('LOGISTICS'));
      validUserId = dispatchUser?.id || db.users[0]?.id || 'usr-admin';
    } else if (params.targetDept === 'YARD') {
      const yardUser = db.users.find(u => (u.department || '').includes('출고') || (u.department || '').includes('주기장'));
      validUserId = yardUser?.id || db.users[0]?.id || 'usr-admin';
    } else if (params.targetDept === 'AS') {
      const asUser = db.users.find(u => (u.department || '').includes('정비') || (u.role || '').includes('MECHANIC'));
      validUserId = asUser?.id || db.users[0]?.id || 'usr-admin';
    } else if (params.targetDept === 'ACCOUNTING') {
      const acctUser = db.users.find(u => (u.department || '').includes('관리') || (u.department || '').includes('회계'));
      validUserId = acctUser?.id || db.users[0]?.id || 'usr-admin';
    } else {
      validUserId = db.users[0]?.id || 'usr-admin';
    }
  }

  const newTodo: Todo = {
    id: todoId,
    userId: validUserId,
    assignedUserId: params.assignedUserId,
    targetType: params.targetType || (params.assignedUserId ? 'USER' : 'DEPT'),
    targetDept: params.targetDept,
    targetRole: params.targetRole,
    taskCategory: params.category,
    type: params.priority === 'URGENT' ? 'URGENT' : 'GENERAL',
    title: params.title,
    content: params.content,
    priority: params.priority || 'NORMAL',
    dueDate: params.dueDate,
    actionUrl: params.actionUrl || '/',
    entityType: params.entityType,
    entityId: params.entityId,
    relatedEntityId: params.entityId,
    senderId: params.senderId,
    senderName: params.senderName,
    isCompleted: false,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  // 1. 물리 DB 영구 적재
  db.insertRow<Todo>('todos', newTodo);

  // 2. 실시간 푸시 & 차임벨 알림 병행 (휘발 유실 방어)
  try {
    const notifType = params.category === 'EXECUTIVE_DIRECTIVE' ? 'URGENT_DIRECTIVE' :
      params.category.includes('DISPATCH') ? 'DISPATCH' :
      params.category.includes('INSPECTION') ? 'OUTBOUND' :
      params.category.includes('AS') ? 'AS' :
      params.category.includes('EXCHANGE') ? 'EXCHANGE' : 'OUTBOUND';

    broadcastWorkNotification({
      type: notifType as any,
      title: params.title,
      body: params.content,
      url: params.actionUrl,
      targetDepts: params.targetDept ? [params.targetDept] : undefined,
      senderId: params.senderId,
      senderName: params.senderName
    }).catch(err => {
      console.warn('broadcastWorkNotification send warning:', err);
    });
  } catch (err) {
    console.warn('taskHandover broadcast error:', err);
  }

  return newTodo;
}

/**
 * 🟢 [2] 비즈니스 액션 완료 시 선행 ToDo 원자적 자동 상계(Clearance)
 */
export async function clearHandoverTasks(params: ClearHandoverTasksParams): Promise<number> {
  const nowIso = new Date().toISOString();
  const matchedTodos = db.todos.filter(t => 
    !t.isCompleted &&
    (t.entityId === params.entityId || t.relatedEntityId === params.entityId) &&
    (!params.entityType || t.entityType === params.entityType) &&
    (!params.category || t.taskCategory === params.category)
  );

  matchedTodos.forEach(t => {
    db.updateRow<Todo>('todos', t.id, {
      isCompleted: true,
      completedAt: nowIso,
      completedByUserId: params.completedByUserId,
      completedByName: params.completedByName,
      completionAction: params.completionAction,
      resolutionNote: params.resolutionNote,
      updatedAt: nowIso
    });
  });

  return matchedTodos.length;
}

/**
 * 🔍 [3] 로그인 사용자의 직무·부서에 특화된 활성 ToDo 필터링 헬퍼
 */
export function findActiveTasksForUser(
  todos: Todo[],
  currentUser: { id?: string; department?: string; role?: string } | null,
  hasPermission?: (menuId: string, action: 'view' | 'save') => boolean
): Todo[] {
  if (!currentUser || !todos) return [];

  const uDept = (currentUser.department || '').toUpperCase();
  const uRole = (currentUser.role || '').toUpperCase();
  const isExec = uDept.includes('경영') || uDept.includes('대표') || uRole === 'ADMIN' || uRole === 'MASTER' || uRole === 'EXECUTIVE';

  const filtered = todos.filter(t => {
    if (t.isCompleted) return false;

    // 1. 개인 지정 ToDo: 본인에게 직접 지정된 경우
    if (t.assignedUserId && t.assignedUserId === currentUser.id) return true;

    // 1-1. 특정 개인에게 지정된 건은 타 일반 직원은 볼 수 없음 (격리)
    if (t.targetType === 'USER' && t.assignedUserId && t.assignedUserId !== currentUser.id) {
      return isExec; // 경영진만 감독 목적으로 조회 가능
    }

    if (t.userId === currentUser.id && (!t.targetDept || t.targetDept === uDept)) return true;

    // 2. 최고관리자/경영진은 전사 미결 ToDo 모두 조망 가능
    if (isExec) return true;

    // 3. 타겟 부서 매칭
    if (t.targetDept) {
      const td = t.targetDept.toUpperCase();
      if (uDept.includes(td)) return true;
      if (td === 'DISPATCH' && (uDept.includes('배차') || uRole.includes('LOGISTICS') || uDept.includes('운송'))) return true;
      if (td === 'YARD' && (uDept.includes('출고') || uDept.includes('주기장') || uRole.includes('YARD') || uRole.includes('MECHANIC'))) return true;
      if (td === 'AS' && (uDept.includes('정비') || uDept.includes('AS') || uRole.includes('MECHANIC'))) return true;
      if (td === 'ACCOUNTING' && (uDept.includes('관리') || uDept.includes('회계') || uRole.includes('ADMIN') || uRole.includes('ACCOUNTING'))) return true;
      if (td === 'SALES' && (uDept.includes('영업') || uRole.includes('SALES'))) return true;
      if (td === 'ADMIN' && (uDept.includes('총무') || uDept.includes('관리') || uRole.includes('ADMIN'))) return true;
    }

    // 4. 타겟 역할 매칭
    if (t.targetRole) {
      const tr = t.targetRole.toUpperCase();
      if (uRole.includes(tr)) return true;
    }

    // 5. 🌟 계약서패키지 재발송 ToDo: 발송 권한 보유자 또는 영업/출고 부서원 매칭
    if (t.taskCategory === 'CONTRACT_PACKAGE_RESEND') {
      if (hasPermission && hasPermission('agent_badge', 'view')) return true;
      if (t.assignedUserId && t.assignedUserId === currentUser.id) return true;
      if (uDept.includes('SALES') || uDept.includes('영업') || uRole.includes('SALES')) return true;
      if (uDept.includes('출고') || uDept.includes('배차') || uRole.includes('LOGISTICS')) return true;
    }

    return false;
  });

  // 정렬 우선순위:
  // 1) EXECUTIVE_DIRECTIVE (경영진 특별지시) 최우선
  // 2) priority (URGENT > HIGH > NORMAL > LOW)
  // 3) 마감기한 임박순 / 최신순
  return filtered.sort((a, b) => {
    const isAExec = a.taskCategory === 'EXECUTIVE_DIRECTIVE' ? 1 : 0;
    const isBExec = b.taskCategory === 'EXECUTIVE_DIRECTIVE' ? 1 : 0;
    if (isAExec !== isBExec) return isBExec - isAExec;

    const pWeight = (p?: string) => (p === 'URGENT' ? 4 : p === 'HIGH' ? 3 : p === 'NORMAL' ? 2 : 1);
    const pDiff = pWeight(b.priority) - pWeight(a.priority);
    if (pDiff !== 0) return pDiff;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * 🚀 [4] 출고 진행 중 자산 변경 감지 시 계약서패키지 재발송 ToDo 자동 발행
 */
export async function checkAndIssuePackageResendTask(params: {
  contractId: string;
  oldAssetId?: string;
  newAssetId?: string;
  reason?: string;
  senderName?: string;
}): Promise<Todo | null> {
  const contract = db.contracts.find(c => c.id === params.contractId);
  if (!contract) return null;

  // 1. 해당 계약에 고객 발송 이력(DOCUMENT_SENT)이 존재하는지 확인
  const sentHistories = db.contractHistory.filter(
    h => h.contractId === params.contractId && h.changeType === 'DOCUMENT_SENT'
  );
  if (sentHistories.length === 0) {
    // 발송된 적이 없으면 변경되어도 재발송 ToDo 불필요 (초기 출고 정상 진행)
    return null;
  }

  // 2. 자산 정보 및 고객사 정보 조회
  const oldAsset = params.oldAssetId ? db.assets.find(a => a.id === params.oldAssetId) : undefined;
  const newAsset = params.newAssetId ? db.assets.find(a => a.id === params.newAssetId) : undefined;
  const customer = db.customers.find(c => c.id === contract.customerId);

  const oldAssetStr = oldAsset ? `${oldAsset.assetNo}(${oldAsset.modelName})` : '기존장비';
  const newAssetStr = newAsset ? `${newAsset.assetNo}(${newAsset.modelName})` : '신규대체장비';
  const custName = customer?.name || '고객사';

  // 3. 이미 미완료 상태인 동일 계약의 CONTRACT_PACKAGE_RESEND ToDo가 있다면 내용만 갱신 (Idempotency 보장)
  const existingTodo = db.todos.find(
    t => !t.isCompleted && t.entityId === contract.id && t.taskCategory === 'CONTRACT_PACKAGE_RESEND'
  );

  const title = `[계약서패키지 재발송 필요] ${contract.contractNo} (${custName})`;
  const content = `출고 진행 중 자산이 변경(${oldAssetStr} ➔ ${newAssetStr})되었습니다.\n` +
    `기존 발송된 패키지 구성 서류(반입전점검표, 안전인증서, 제원표 등)와 실출고 장비가 불일치하므로, 서류를 갱신하여 고객사(${custName})로 재발송해 주십시오.` +
    (params.reason ? `\n• 교체 사유: ${params.reason}` : '');

  if (existingTodo) {
    return db.updateRow<Todo>('todos', existingTodo.id, {
      title,
      content,
      updatedAt: new Date().toISOString()
    });
  }

  // 4. ToDo 신규 발행
  // 대상: 계약 담당자(salespersonId) 및 계약서패키지 발송 권한자(SALES/LOGISTICS)
  const todo = await issueHandoverTask({
    category: 'CONTRACT_PACKAGE_RESEND',
    title,
    content,
    priority: 'HIGH',
    targetType: 'DEPT',
    targetDept: 'SALES',
    assignedUserId: contract.salespersonId || undefined,
    actionUrl: '/admin/contract',
    entityType: 'CONTRACT',
    entityId: contract.id,
    senderName: params.senderName || '출고검수시스템'
  });

  return todo;
}
