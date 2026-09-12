// src/utils/privacyMasking.ts
// 대한민국 개인정보 보호법 제29조 및 개인정보의 안전성 확보조치 기준에 따른 개인정보 마스킹 유틸리티
import { User } from '../services/db';

/**
 * 경영진 또는 개발자(전체 개인정보 열람 및 비마스킹 다운로드 권한자) 판별
 * - 개발자: sys-admin, u-1, loginId === 'admin', 직급 'D.RPA'
 * - 최고경영진: role === 'ADMIN', 부서 '기연리프트'/'경영진', 직급 '대표'/'대표이사'/'사장'/'부사장'
 */
export function isPrivilegedPrivacyUser(user?: User | null): boolean {
  if (!user) return false;

  // 1. 개발자 계정
  if (user.id === 'sys-admin' || user.id === 'u-1' || user.loginId === 'admin') return true;
  if (user.position === 'D.RPA') return true;

  // 2. 최고관리자 시스템 등급
  if (user.role === 'ADMIN') return true;

  // 3. 경영진 직급
  const pos = (user.position || '').trim();
  if (['대표', '대표이사', '사장', '부사장', '총괄대표'].includes(pos)) return true;

  // 4. 본사/경영진 소속 부서
  const dept = (user.department || '').trim();
  if (dept === '기연리프트' || dept === '경영진') return true;
  const deptId = (user.departmentId || '').toUpperCase();
  if (deptId.includes('0000001') || deptId === 'DEPT-1') return true;

  return false;
}

/**
 * 전화번호 마스킹 (가운데 3~4자리 마스킹)
 * 예: 010-1234-5678 -> 010-****-5678
 *     02-123-4567 -> 02-***-4567
 */
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '-';
  const clean = String(phone).trim();
  if (!clean) return '-';

  return clean.replace(/(\d{2,3})[-.]?(\d{3,4})[-.]?(\d{4})/, (_, p1, p2, p3) => {
    const maskedMiddle = '*'.repeat(p2.length);
    return `${p1}-${maskedMiddle}-${p3}`;
  });
}

/**
 * 이메일 마스킹 (아이디 앞 2자리 노출 후 마스킹)
 * 예: honggildong@company.com -> ho*********@company.com
 */
export function maskEmail(email?: string | null): string {
  if (!email) return '-';
  const clean = String(email).trim();
  if (!clean || !clean.includes('@')) return clean || '-';

  const [user, domain] = clean.split('@');
  if (user.length <= 2) {
    return `${user.charAt(0)}*@${domain}`;
  }
  const visible = user.substring(0, 2);
  const masked = '*'.repeat(user.length - 2);
  return `${visible}${masked}@${domain}`;
}

/**
 * 은행 계좌번호 마스킹 (가운데 또는 뒤 6자리 마스킹)
 * 예: 110-123-456789 -> 110-***-***789
 */
export function maskAccountNumber(account?: string | null): string {
  if (!account) return '-';
  const clean = String(account).trim();
  if (clean.length <= 5) return clean;

  const len = clean.length;
  const start = clean.substring(0, 3);
  const end = clean.substring(len - 3);
  const masked = '*'.repeat(Math.max(len - 6, 3));
  return `${start}-${masked}-${end}`;
}

/**
 * 성명 마스킹 (가운데 글자 마스킹)
 * 예: 홍길동 -> 홍*동, 이산 -> 이*, 남궁민수 -> 남**수
 */
export function maskName(name?: string | null): string {
  if (!name) return '-';
  const clean = String(name).trim();
  if (!clean) return '-';

  if (clean.length === 2) {
    return `${clean.charAt(0)}*`;
  }
  if (clean.length >= 3) {
    const first = clean.charAt(0);
    const last = clean.charAt(clean.length - 1);
    const middle = '*'.repeat(clean.length - 2);
    return `${first}${middle}${last}`;
  }
  return clean;
}

/**
 * 주소 마스킹 (상세주소/호수 마스킹)
 * 예: 경기도 화성시 남양읍 시청로 123 402호 -> 경기도 화성시 남양읍 시청로 *****
 */
export function maskAddress(addr?: string | null): string {
  if (!addr) return '-';
  const clean = String(addr).trim();
  if (!clean) return '-';

  const parts = clean.split(' ');
  if (parts.length <= 2) return clean;
  const visible = parts.slice(0, 3).join(' ');
  return `${visible} *****`;
}
