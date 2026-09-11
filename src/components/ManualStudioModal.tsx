// d:\01.AntiGravity\Giyuen_Lift\src\components\ManualStudioModal.tsx
import React, { useState } from 'react';
import {
  X,
  Download,
  Camera,
  Keyboard,
  FileText,
  Copy,
  CheckCircle2,
  ExternalLink,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Presentation,
  Hash,
  Square,
  EyeOff,
  Type,
  Maximize2
} from 'lucide-react';

interface ManualStudioModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  isInline?: boolean;
}

export const ManualStudioModal: React.FC<ManualStudioModalProps> = ({ isOpen = true, onClose, isInline = false }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'dictionary' | 'workflow'>('overview');
  const [copiedEmail, setCopiedEmail] = useState(false);

  if (!isInline && !isOpen) return null;

  const handleCopyEmail = () => {
    navigator.clipboard.writeText('77.victor.lee@gmail.com');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const content = (
    <div
      style={{
        width: '100%',
        maxWidth: isInline ? '100%' : '960px',
        maxHeight: isInline ? '100%' : '90vh',
        height: isInline ? '100%' : undefined,
        backgroundColor: 'var(--bg-card, #FFFFFF)',
        color: 'var(--text-primary, #0F172A)',
        borderRadius: '12px',
        border: '1px solid var(--border-color, #E2E8F0)',
        boxShadow: isInline ? 'none' : '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
    >
        {/* 모달 헤더 (좌상단 스코프 및 브랜드) */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color, #E2E8F0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-app, #F8FAFC)',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2563EB'
              }}
            >
              <Camera size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                  매뉴얼 스튜디오 (Manual Studio)
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 'bold',
                    padding: '2px 7px',
                    borderRadius: '12px',
                    backgroundColor: '#FEF3C7',
                    color: '#92400E',
                    border: '1px solid #FDE68A',
                    whiteSpace: 'nowrap'
                  }}
                >
                  v1.2.0 평가판 (~2026.12.31)
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    padding: '2px 7px',
                    borderRadius: '12px',
                    backgroundColor: '#E0F2FE',
                    color: '#0369A1',
                    border: '1px solid #BAE6FD',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Nuitka C-컴파일
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary, #64748B)', marginTop: '2px', whiteSpace: 'nowrap' }}>
                (주)드래곤알피에이 (DragonRPA Co.) | 업무 매뉴얼 제작 및 캡처-파워포인트 자동화 도구
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <a
              href="/downloads/ManualStudio.exe"
              download="ManualStudio.exe"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '6px',
                backgroundColor: '#2563EB',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 'bold',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(37, 99, 235, 0.2)'
              }}
            >
              <Download size={14} />
              다운로드 (27.97 MB)
            </a>
            <a
              href="https://www.dragonrpa.co.kr/downloads/ManualStudio.exe"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-app, #F8FAFC)',
                color: 'var(--text-primary, #0F172A)',
                border: '1px solid var(--border-color, #CBD5E1)',
                fontSize: '12px',
                fontWeight: '600',
                textDecoration: 'none',
                whiteSpace: 'nowrap'
              }}
              title="공식 홈페이지 백업 미러"
            >
              <ExternalLink size={13} />
              공식 홈 미러
            </a>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary, #64748B)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            )}
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-color, #E2E8F0)',
            backgroundColor: 'var(--bg-card, #FFFFFF)',
            padding: '0 20px',
            flexShrink: 0
          }}
        >
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 'bold',
              color: activeTab === 'overview' ? '#2563EB' : 'var(--text-secondary, #64748B)',
              borderBottom: activeTab === 'overview' ? '2px solid #2563EB' : '2px solid transparent',
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            개요 및 배포 정보
          </button>
          <button
            onClick={() => setActiveTab('dictionary')}
            style={{
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 'bold',
              color: activeTab === 'dictionary' ? '#2563EB' : 'var(--text-secondary, #64748B)',
              borderBottom: activeTab === 'dictionary' ? '2px solid #2563EB' : '2px solid transparent',
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            메뉴 및 기능버튼 사전
          </button>
          <button
            onClick={() => setActiveTab('workflow')}
            style={{
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 'bold',
              color: activeTab === 'workflow' ? '#2563EB' : 'var(--text-secondary, #64748B)',
              borderBottom: activeTab === 'workflow' ? '2px solid #2563EB' : '2px solid transparent',
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            단축키 및 PPT 연동
          </button>
        </div>

        {/* 본문 영역 (스크롤 가능) */}
        <div style={{ padding: '20px', overflowY: 'auto', flexGrow: 1 }}>
          {/* TAB 1: 개요 및 배포 정보 */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* 스펙 그리드 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '12px'
                }}
              >
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app, #F8FAFC)',
                    border: '1px solid var(--border-color, #E2E8F0)'
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', whiteSpace: 'nowrap' }}>
                    파일 크기
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', marginTop: '4px', whiteSpace: 'nowrap', color: '#2563EB' }}>
                    27.97 MB
                  </div>
                  <div style={{ fontSize: '11px', color: '#16A34A', marginTop: '2px' }}>
                    58.4MB ➔ 27.97MB
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app, #F8FAFC)',
                    border: '1px solid var(--border-color, #E2E8F0)'
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', whiteSpace: 'nowrap' }}>
                    실행 형태
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', marginTop: '4px', whiteSpace: 'nowrap' }}>
                    단일 실행 파일
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', marginTop: '2px' }}>
                    무설치 즉시 실행
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app, #F8FAFC)',
                    border: '1px solid var(--border-color, #E2E8F0)'
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', whiteSpace: 'nowrap' }}>
                    빌드 엔진
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', marginTop: '4px', whiteSpace: 'nowrap' }}>
                    Nuitka C 기계어
                  </div>
                  <div style={{ fontSize: '11px', color: '#2563EB', marginTop: '2px' }}>
                    GCC 15.2 네이티브
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app, #F8FAFC)',
                    border: '1px solid var(--border-color, #E2E8F0)'
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', whiteSpace: 'nowrap' }}>
                    평가판 사용 기한
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', marginTop: '4px', whiteSpace: 'nowrap', color: '#D97706' }}>
                    2026. 12. 31
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', marginTop: '2px' }}>
                    전사 무상 지원
                  </div>
                </div>
              </div>

              {/* 다운로드 실행 배너 */}
              <div
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  backgroundColor: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px'
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1E40AF' }}>
                    프로그램 다운로드 및 실행
                  </div>
                  <div style={{ fontSize: '12px', color: '#1E3A8A', marginTop: '4px' }}>
                    설치 과정 없이 <code>ManualStudio.exe</code> 실행 시 즉시 구동됩니다.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <a
                    href="/downloads/ManualStudio.exe"
                    download="ManualStudio.exe"
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      backgroundColor: '#1D4ED8',
                      color: '#FFFFFF',
                      fontSize: '12.5px',
                      fontWeight: 'bold',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Download size={15} />
                    다운로드 (27.97 MB)
                  </a>
                  <a
                    href="https://www.dragonrpa.co.kr/downloads/ManualStudio.exe"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      backgroundColor: '#FFFFFF',
                      color: '#1D4ED8',
                      border: '1px solid #BFDBFE',
                      fontSize: '12.5px',
                      fontWeight: 'bold',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <ExternalLink size={14} />
                    공식홈 미러
                  </a>
                </div>
              </div>

              {/* 4단계 실무 워크플로우 카드 */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '10px' }}>
                  📋 4단계 실무 매뉴얼 제작 순서
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: '10px'
                  }}
                >
                  <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color, #E2E8F0)', backgroundColor: 'var(--bg-app, #F8FAFC)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2563EB' }}>1단계. 영역 캡처</div>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginTop: '4px' }}>Shift+F9 ➔ F9</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', marginTop: '4px' }}>
                      최초 1회 영역 지정 후 F9만 누르면 0.1초 고정 즉시 캡처
                    </div>
                  </div>
                  <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color, #E2E8F0)', backgroundColor: 'var(--bg-app, #F8FAFC)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2563EB' }}>2단계. 주석 배치</div>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginTop: '4px' }}>① 번호 / ↳ 화살표</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', marginTop: '4px' }}>
                      클릭 한 번으로 순차 증가 번호 스탬프 및 직각 화살표 배치
                    </div>
                  </div>
                  <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color, #E2E8F0)', backgroundColor: 'var(--bg-app, #F8FAFC)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2563EB' }}>3단계. 보안 & 말풍선</div>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginTop: '4px' }}>🌫 모자이크 / 💬 설명</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', marginTop: '4px' }}>
                      개인정보·금액 비파괴 블러 처리 및 지시선 설명 말풍선 삽입
                    </div>
                  </div>
                  <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color, #E2E8F0)', backgroundColor: 'var(--bg-app, #F8FAFC)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2563EB' }}>4단계. PPT 자동화</div>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginTop: '4px' }}>F10 원클릭</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #64748B)', marginTop: '4px' }}>
                      열려 있는 PPT에 Step 번호 부여 및 16:9 슬라이드 자동 생성
                    </div>
                  </div>
                </div>
              </div>

              {/* 개발사 및 문의 정보 */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #E2E8F0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: 'var(--bg-card, #FFFFFF)'
                }}
              >
                <div style={{ fontSize: '12px' }}>
                  <span style={{ fontWeight: 'bold' }}>개발 및 공급</span>: (주)드래곤알피에이 (DragonRPA Co.) | 문의처: <code>77.victor.lee@gmail.com</code>
                </div>
                <button
                  onClick={handleCopyEmail}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color, #CBD5E1)',
                    backgroundColor: 'var(--bg-app, #F8FAFC)',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  {copiedEmail ? <CheckCircle2 size={12} color="#16A34A" /> : <Copy size={12} />}
                  {copiedEmail ? '복사 완료' : '이메일 주소 복사'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: 메뉴 및 기능버튼 사전 */}
          {activeTab === 'dictionary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 리본 도구 그룹 테이블 */}
              <div style={{ border: '1px solid var(--border-color, #E2E8F0)', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app, #F8FAFC)', fontWeight: 'bold', fontSize: '13px', borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                  🎨 1. 리본 도구 패널 (Ribbon Tools)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-app, #F1F5F9)', borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', width: '110px', whiteSpace: 'nowrap' }}>분류</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', width: '160px', whiteSpace: 'nowrap' }}>기능 버튼</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>상세 설명 및 실무 효익</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#2563EB', whiteSpace: 'nowrap' }}>캡처</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>📸 고정 캡처 (F9)</td>
                      <td style={{ padding: '8px 12px' }}>직전에 기억된 좌표 사각 영역을 0.1초 만에 즉시 캡처하여 캔버스에 로드</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#2563EB', whiteSpace: 'nowrap' }}>캡처</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>📐 영역 지정 (Shift+F9)</td>
                      <td style={{ padding: '8px 12px' }}>화면 전체 반투명 오버레이를 띄워 원하는 영역을 마우스 드래그로 신규 지정</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#2563EB', whiteSpace: 'nowrap' }}>캡처</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🪟 부분 추가 (F8)</td>
                      <td style={{ padding: '8px 12px' }}>확인 팝업, 드롭다운 등 돌출 창만 오려내어 현재 캡처본 위에 스티커 객체로 얹기</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#059669', whiteSpace: 'nowrap' }}>단계·흐름</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>① 번호 스탬프</td>
                      <td style={{ padding: '8px 12px' }}>클릭할 때마다 ①, ②, ③ 자동 증가. 중간 번호 삭제 시 뒷번호 자동 당김</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#059669', whiteSpace: 'nowrap' }}>단계·흐름</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>①➔ 스탬프 화살표</td>
                      <td style={{ padding: '8px 12px' }}>원형 스탬프 번호와 지시 화살표를 일체형으로 결합하여 클릭 및 드래그 배치</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#059669', whiteSpace: 'nowrap' }}>단계·흐름</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>↳ 직각 화살표</td>
                      <td style={{ padding: '8px 12px' }}>메뉴 진입 경로(상단 메뉴 ➔ 하위 서브메뉴)를 깔끔한 직각(L자) 선으로 연결</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#059669', whiteSpace: 'nowrap' }}>단계·흐름</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>↗ 직선 화살표</td>
                      <td style={{ padding: '8px 12px' }}>목표 버튼이나 특정 입력 필드를 곧게 가리키는 고정밀 화살표</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#DC2626', whiteSpace: 'nowrap' }}>강조·보안</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🔲 사각 박스</td>
                      <td style={{ padding: '8px 12px' }}>붉은색 테두리 또는 반투명 음영으로 핵심 조작 영역을 시각적으로 강조</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#DC2626', whiteSpace: 'nowrap' }}>강조·보안</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🌫 모자이크 블러</td>
                      <td style={{ padding: '8px 12px' }}>개인정보, 전화번호, 금액을 흐리게 가림. 원본 파괴 없이 언제든 크기/위치 조절 가능</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#DC2626', whiteSpace: 'nowrap' }}>강조·보안</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>📑 Draft 스탬프</td>
                      <td style={{ padding: '8px 12px' }}>화면 중앙에 60도 회전된 큼직한 'DRAFT' 반투명 워터마크를 원클릭 주입</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#7C3AED', whiteSpace: 'nowrap' }}>텍스트</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>💬 설명 말풍선</td>
                      <td style={{ padding: '8px 12px' }}>지시선 꼬리가 달린 텍스트 상자. 꼬리 핸들을 조작하여 가리키는 위치 자유 지정</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#7C3AED', whiteSpace: 'nowrap' }}>텍스트</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>⌨ 단축키 뱃지</td>
                      <td style={{ padding: '8px 12px' }}>실제 키보드 키캡처럼 입체감 있는 'Ctrl + C', 'Enter' 등 3D 단축키 뱃지 배치</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#D97706', whiteSpace: 'nowrap' }}>PPT 출력</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🚀 슬라이드 생성 (F10)</td>
                      <td style={{ padding: '8px 12px' }}>열려 있는 파워포인트 문서에 새 슬라이드를 만들고 제목 상자와 이미지를 원클릭 주입</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 상단 메뉴바 요약 */}
              <div style={{ border: '1px solid var(--border-color, #E2E8F0)', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app, #F8FAFC)', fontWeight: 'bold', fontSize: '13px', borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                  🖥️ 2. 상단 메뉴바 구조 (Menu Bar)
                </div>
                <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', fontSize: '12px' }}>
                  <div>
                    <span style={{ fontWeight: 'bold', color: '#2563EB' }}>파일(F)</span>: 고정 캡처(F9), 영역 지정(Shift+F9), 부분 추가(F8), 프로젝트 열기/저장(Ctrl+O/S), PPT 생성(F10)
                  </div>
                  <div>
                    <span style={{ fontWeight: 'bold', color: '#2563EB' }}>편집(E)</span>: 실행 취소(Ctrl+Z), 클립보드 복사, 전체 삭제, PPT Step 번호 자동 재정렬
                  </div>
                  <div>
                    <span style={{ fontWeight: 'bold', color: '#2563EB' }}>도구(T)</span>: 선택, 스탬프, 스탬프 화살표, 직각/직선 화살표, 사각 박스, 모자이크, 말풍선, 단축키 뱃지
                  </div>
                  <div>
                    <span style={{ fontWeight: 'bold', color: '#2563EB' }}>설정(S) / About</span>: 고정 캡처 좌표, PPT 슬라이드 여백 배율, 회사 브랜딩 및 지원 안내
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 단축키 및 PPT 연동 */}
          {activeTab === 'workflow' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 단축키 표 */}
              <div style={{ border: '1px solid var(--border-color, #E2E8F0)', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app, #F8FAFC)', fontWeight: 'bold', fontSize: '13px', borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                  ⌨️ 전역 글로벌 핫키 (Global Hotkeys)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-app, #F1F5F9)', borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', width: '120px', whiteSpace: 'nowrap' }}>단축키</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', width: '160px', whiteSpace: 'nowrap' }}>동작</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>상세 설명</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#2563EB', whiteSpace: 'nowrap' }}>F9</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>고정 영역 즉시 캡처</td>
                      <td style={{ padding: '8px 12px' }}>프로그램 창이 최소화되어 있어도 백그라운드에서 직전 고정 영역을 0.1초 캡처</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#2563EB', whiteSpace: 'nowrap' }}>Shift + F9</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>영역 드래그 지정</td>
                      <td style={{ padding: '8px 12px' }}>화면에서 원하는 범위를 마우스로 드래그하여 새 캡처 영역으로 등록</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#2563EB', whiteSpace: 'nowrap' }}>F8</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>부분 추가 캡처</td>
                      <td style={{ padding: '8px 12px' }}>모달 팝업이나 드롭다운 창만 오려내어 현재 캡처본에 레이어로 추가</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color, #E2E8F0)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#D97706', whiteSpace: 'nowrap' }}>F10</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>PPT 슬라이드 생성</td>
                      <td style={{ padding: '8px 12px' }}>파워포인트 활성 문서를 감지하여 새 슬라이드에 이미지와 Step 제목 자동 삽입</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#64748B', whiteSpace: 'nowrap' }}>Ctrl + Z</td>
                      <td style={{ padding: '8px 12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>실행 취소 (Undo)</td>
                      <td style={{ padding: '8px 12px' }}>방금 추가한 주석이나 수정한 개체를 이전 상태로 안전하게 롤백</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 파워포인트 자동화 연동 안내 */}
              <div
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-app, #F8FAFC)',
                  border: '1px solid var(--border-color, #E2E8F0)'
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Presentation size={16} color="#2563EB" />
                  파워포인트 자동화 연동 메커니즘 (PowerPoint Automation Engine)
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #64748B)', marginTop: '8px', lineHeight: '1.6' }}>
                  • <b>열려 있는 파워포인트 자동 감지</b>: 작업자가 파워포인트를 띄워둔 상태에서 <code>F10</code>을 누르면 COM 통신을 통해 현재 프레젠테이션의 마지막 슬라이드를 자동 추적합니다.<br />
                  • <b>Step 번호 자동 증가</b>: 슬라이드 상단에 <code>Step 1. [단계명 입력]</code>, <code>Step 2. [단계명 입력]</code> 텍스트 박스를 일관된 폰트와 크기로 자동 생성합니다.<br />
                  • <b>16:9 슬라이드 여백 자동 맞춤</b>: <code>[📐 슬라이드 맞춤]</code> 버튼을 누르면 상하좌우 여백을 침범하지 않는 90% 황금비율 배율을 자동 계산하여 주입합니다.<br />
                  • <b>Step 일괄 재정렬</b>: 작업 도중 중간 슬라이드를 삭제하거나 순서를 바꾼 경우, <code>[🔢 Step 재정렬]</code>을 클릭하면 100장의 슬라이드라도 1초 만에 1부터 순차 재부여됩니다.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 모달 푸터 (우하단 대차대조 액션 바) */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-color, #E2E8F0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-app, #F8FAFC)',
            flexShrink: 0
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #64748B)', whiteSpace: 'nowrap' }}>
            🔒 보안: C 언어 네이티브 기계어 컴파일 완료 | 시계 역행 변조 방어 탑재
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <a
              href="/downloads/ManualStudio.exe"
              download="ManualStudio.exe"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '6px',
                backgroundColor: '#2563EB',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 'bold',
                textDecoration: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <Download size={14} />
              ManualStudio.exe 다운로드 (27.97 MB)
            </a>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #CBD5E1)',
                  backgroundColor: 'var(--bg-card, #FFFFFF)',
                  color: 'var(--text-primary, #334155)',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                닫기
              </button>
            )}
          </div>
        </div>
      </div>
  );

  if (isInline) {
    return content;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={onClose}
    >
      {content}
    </div>
  );
};
