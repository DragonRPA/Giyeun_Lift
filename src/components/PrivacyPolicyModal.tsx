// src/components/PrivacyPolicyModal.tsx
// 대한민국 개인정보 보호법 제30조(개인정보 처리방침의 수립 및 공개), 제29조(안전조치의무), 안전성 확보조치 기준 제8조 준수 모달
import React from 'react';
import { X, ShieldCheck, Lock, FileText, CheckCircle2 } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen?: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen = true, onClose }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-card, #ffffff)',
        color: 'var(--text-main, #0f172a)',
        borderRadius: '12px',
        border: '1px solid var(--border-color, #cbd5e1)',
        width: '100%',
        maxWidth: '820px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        {/* 모달 헤더 */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-secondary, #f8fafc)',
          borderRadius: '12px 12px 0 0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={20} color="var(--primary, #4f46e5)" />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
              개인정보 처리방침
            </h3>
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#dcfce7', color: '#15803d', fontWeight: 600 }}>
              법 제29조 / 안전성 고시 제8조 준수
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #64748b)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* 모달 본문 (스크롤) */}
        <div style={{
          padding: '24px',
          overflowY: 'auto',
          fontSize: '13px',
          lineHeight: '1.65',
          color: 'var(--text-secondary, #334155)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>
            (주)기연리프트(이하 &apos;당사&apos;)는 「개인정보 보호법」 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 다음과 같이 개인정보 처리방침을 수립·공개합니다.
          </p>

          <section style={{ borderTop: '1px solid var(--border-color, #f1f5f9)', paddingTop: '12px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main, #0f172a)', marginBottom: '8px' }}>
              제1조 (개인정보의 처리 목적)
            </h4>
            <p style={{ margin: 0 }}>
              당사는 고소작업대 렌탈 계약 체결 및 이행, 장비 출고·회수 배차 운송, 현장 AS 정비 및 정산, 세금계산서 발행, 임직원 인사·노무 관리 등의 목적으로 최소한의 개인정보를 처리합니다.
            </p>
          </section>

          <section style={{ borderTop: '1px solid var(--border-color, #f1f5f9)', paddingTop: '12px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main, #0f172a)', marginBottom: '8px' }}>
              제2조 (처리하는 개인정보 항목 및 주민등록번호 미수집 원칙)
            </h4>
            <div style={{ backgroundColor: 'var(--bg-secondary, #f8fafc)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color, #e2e8f0)', marginBottom: '8px' }}>
              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                📌 주민등록번호 미수집 원칙 (개인정보 보호법 제24조의2 준수)
              </div>
              <p style={{ margin: 0, fontSize: '12px' }}>
                당사는 법률·대통령령에 구체적 수집 근거가 없는 경우 주민등록번호를 일체 수집·보관하지 않으며, 운송기사 및 거래처의 본인 확인 시 <strong>생년월일(YYMMDD)</strong>만을 제한적으로 수집합니다.
              </p>
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li><strong>고객사/거래처</strong>: 대표자 성명, 담당자 성명, 직급, 유무선 전화번호, 전자세금계산서 이메일, 현장 주소</li>
              <li><strong>매입처/운송사</strong>: 상호, 대표자명, 담당자 연락처, 지급 계좌번호(은행명, 계좌번호, 예금주)</li>
              <li><strong>운송기사</strong>: 기사 성명, 연락처, 생년월일, 차량번호, 차종/톤수</li>
              <li><strong>임직원</strong>: 성명, 사번/ID, 비밀번호(일방향 해시 암호화), 소속부서, 직급, 연락처, 입사일</li>
            </ul>
          </section>

          <section style={{ borderTop: '1px solid var(--border-color, #f1f5f9)', paddingTop: '12px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main, #0f172a)', marginBottom: '8px' }}>
              제3조 (개인정보의 안전성 확보조치 - 법 제29조 준수)
            </h4>
            <p style={{ margin: 0, marginBottom: '6px' }}>
              당사는 개인정보의 분실·도난·유출·위조·변조 또는 훼손을 방지하기 위하여 다음 각 호의 기술적·관리적 보호조치를 이행하고 있습니다:
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li><strong>접근 권한 관리</strong>: 사용자 역할 및 직무별 세부 메뉴 권한 통제(RBAC) 적용</li>
              <li><strong>비밀번호 일방향 암호화</strong>: 사용자 비밀번호는 복호화 불가능한 안전한 일방향 해시 함수로 암호화 보관</li>
              <li><strong>개인정보 마스킹 출력</strong>: 일반 직원의 엑셀 다운로드 및 화면 표출 시 전화번호, 이메일, 계좌번호 등 개인정보 자동 마스킹 적용 (경영진 및 개발자 전용 전체 정보 분리)</li>
              <li><strong>전송 구간 암호화</strong>: 전송 구간 SSL/TLS 보안 프로토콜 상시 적용</li>
            </ul>
          </section>

          <section style={{ borderTop: '1px solid var(--border-color, #f1f5f9)', paddingTop: '12px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main, #0f172a)', marginBottom: '8px' }}>
              제4조 (개인정보 접속기록의 보관 및 점검 - 안전성 확보조치 기준 제8조 준수)
            </h4>
            <p style={{ margin: 0, marginBottom: '6px' }}>
              당사는 개인정보취급자가 개인정보처리시스템에 접속하여 수행한 모든 업무 내역을 법정 기준에 따라 보관·관리합니다:
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li><strong>접속기록 항목</strong>: 접속자 계정(사번/성명), 접속일시, 접속지(IP), 수행업무(로그인/로그아웃, 조회, 수정, 삭제, 엑셀 다운로드), 대상 정보주체 식별정보, 마스킹 여부</li>
              <li><strong>보관 기간</strong>: 개인정보 접속기록(Privacy Access Log)은 <strong>최소 1년 이상(고유식별정보 처리 시 2년 이상)</strong> 위·변조 방지 보관</li>
              <li><strong>정기 점검</strong>: 개인정보 보호책임자는 <strong>반기별 1회 이상</strong> 접속기록을 점검하여 비인가 접근 및 개인정보 다운로드 사유를 감사·기록</li>
            </ul>
          </section>

          <section style={{ borderTop: '1px solid var(--border-color, #f1f5f9)', paddingTop: '12px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main, #0f172a)', marginBottom: '8px' }}>
              제5조 (개인정보 보호책임자 및 권익침해 구제)
            </h4>
            <div style={{ backgroundColor: 'var(--bg-secondary, #f8fafc)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color, #e2e8f0)' }}>
              <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>개인정보 보호책임자</div>
              <div>• 성명: 대표이사 / 관리부 총괄</div>
              <div>• 소속/직책: (주)기연리프트 경영진</div>
              <div>• 문의 및 불만처리: 사내 관리부 (시스템 문의)</div>
            </div>
          </section>
        </div>

        {/* 모달 하단 버튼 */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          justifyContent: 'flex-end',
          backgroundColor: 'var(--bg-secondary, #f8fafc)',
          borderRadius: '0 0 12px 12px'
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 18px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'var(--primary, #4f46e5)',
              color: '#ffffff',
              cursor: 'pointer'
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
