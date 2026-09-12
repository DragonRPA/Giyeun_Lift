// src/pages/OperationManualPage.tsx
import React, { useState, useRef } from 'react';
import {
  Printer,
  BookOpen,
  Building2,
  Truck,
  Wrench,
  Briefcase,
  Smartphone,
  Laptop,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  PhoneCall,
  Calendar,
  Layers,
  Send,
  FileText,
  Shield,
  Clock,
  Sparkles,
  Search,
  ExternalLink,
  Info,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  CheckSquare,
  Boxes,
  DollarSign,
  TrendingUp,
  CreditCard,
  UserCheck,
  AlertTriangle,
  FileSpreadsheet
} from 'lucide-react';

type DepartmentKey = 'sales' | 'outbound' | 'as' | 'admin';

export const OperationManualPage: React.FC = () => {
  const [activeDept, setActiveDept] = useState<DepartmentKey>('sales');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const manualContainerRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleZoom = (delta: number) => {
    setZoomLevel(prev => Math.min(Math.max(prev + delta, 80), 130));
  };

  const handleResetZoom = () => {
    setZoomLevel(100);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="manual-page-root" style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#F8FAFC', color: '#0F172A', overflow: 'hidden' }}>
      
      {/* ── 인쇄 전용 글로벌 스타일 ── */}
      <style>{`
        @media print {
          header, nav, aside, .mobile-burger-btn, .sidebar, .no-print, .manual-toolbar {
            display: none !important;
          }
          body, html, #root, .manual-page-root, .manual-content-scroll {
            height: auto !important;
            overflow: visible !important;
            background-color: #FFFFFF !important;
            color: #000000 !important;
          }
          .manual-page-root {
            padding: 0 !important;
          }
          .manual-paper {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
          }
          .manual-section {
            page-break-inside: avoid;
            break-inside: avoid;
            margin-bottom: 24px !important;
            border-bottom: 1px solid #E2E8F0 !important;
            padding-bottom: 16px !important;
          }
          .print-break-before {
            page-break-before: always;
            break-before: always;
          }
          @page {
            size: A4 portrait;
            margin: 15mm 12mm 15mm 12mm;
          }
        }
      `}</style>

      {/* ── 상단 툴바 (화면 표시용, 인쇄 시 숨김) ── */}
      <div className="manual-toolbar no-print" style={{
        padding: '12px 24px',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        flexShrink: 0,
        zIndex: 20
      }}>
        {/* 부서 선택 탭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BookOpen size={18} />
            </div>
            <div>
              <span style={{ fontSize: '15px', fontWeight: '900', color: '#0F172A', whiteSpace: 'nowrap' }}>전사 업무매뉴얼</span>
              <span style={{ fontSize: '11px', color: '#64748B', display: 'block', whiteSpace: 'nowrap' }}>E-Bro ERP 실무 표준 가이드</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#F1F5F9', padding: '3px', borderRadius: '10px' }}>
            <button
              type="button"
              onClick={() => setActiveDept('sales')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: activeDept === 'sales' ? '#2563EB' : 'transparent',
                color: activeDept === 'sales' ? '#FFFFFF' : '#475569',
                boxShadow: activeDept === 'sales' ? '0 2px 4px rgba(37,99,235,0.2)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Building2 size={14} />
              <span>🏢 영업부</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveDept('outbound')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: activeDept === 'outbound' ? '#059669' : 'transparent',
                color: activeDept === 'outbound' ? '#FFFFFF' : '#475569',
                boxShadow: activeDept === 'outbound' ? '0 2px 4px rgba(5,150,105,0.2)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Truck size={14} />
              <span>🚜 출고팀</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveDept('as')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: activeDept === 'as' ? '#D97706' : 'transparent',
                color: activeDept === 'as' ? '#FFFFFF' : '#475569',
                boxShadow: activeDept === 'as' ? '0 2px 4px rgba(217,119,6,0.2)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Wrench size={14} />
              <span>🔧 AS팀</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveDept('admin')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: activeDept === 'admin' ? '#7C3AED' : 'transparent',
                color: activeDept === 'admin' ? '#FFFFFF' : '#475569',
                boxShadow: activeDept === 'admin' ? '0 2px 4px rgba(124,58,237,0.2)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Briefcase size={14} />
              <span>💼 관리부/경영진</span>
            </button>
          </div>
        </div>

        {/* 우측 조작 액션 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', backgroundColor: '#F1F5F9', padding: '2px 4px', borderRadius: '8px' }}>
            <button
              type="button"
              onClick={() => handleZoom(-10)}
              style={{ padding: '4px 6px', border: 'none', background: 'none', cursor: 'pointer', color: '#475569' }}
              title="축소"
            >
              <ZoomOut size={14} />
            </button>
            <span style={{ fontSize: '12px', fontWeight: '700', padding: '0 4px', minWidth: '40px', textAlign: 'center', color: '#334155' }}>
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={() => handleZoom(10)}
              style={{ padding: '4px 6px', border: 'none', background: 'none', cursor: 'pointer', color: '#475569' }}
              title="확대"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              style={{ padding: '4px 6px', border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderLeft: '1px solid #CBD5E1' }}
              title="원래 크기"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            style={{
              padding: '7px 16px',
              borderRadius: '8px',
              backgroundColor: '#0F172A',
              color: '#FFFFFF',
              border: 'none',
              fontSize: '13px',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 6px rgba(15,23,42,0.25)',
              transition: 'all 0.15s ease'
            }}
          >
            <Printer size={15} />
            <span>A4 인쇄 / PDF 저장</span>
          </button>
        </div>
      </div>

      {/* ── 본문 스크롤 영역 ── */}
      <div className="manual-content-scroll" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' }}>
        <div
          ref={manualContainerRef}
          className="manual-paper"
          style={{
            width: '100%',
            maxWidth: '960px',
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            border: '1px solid #E2E8F0',
            padding: '40px 48px',
            boxSizing: 'border-box',
            zoom: `${zoomLevel}%`
          }}
        >
          {activeDept === 'sales' && <SalesManualContent onNavigateTo={scrollToSection} />}
          {activeDept === 'outbound' && <OutboundManualContent onNavigateTo={scrollToSection} />}
          {activeDept === 'as' && <AsManualContent onNavigateTo={scrollToSection} />}
          {activeDept === 'admin' && <AdminManualContent onNavigateTo={scrollToSection} />}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 🏢 [1] 영업부 전용 실무 매뉴얼 상세 콘텐츠
// ─────────────────────────────────────────────────────────────────────────────
const SalesManualContent: React.FC<{ onNavigateTo: (id: string) => void }> = ({ onNavigateTo }) => {
  return (
    <div style={{ lineHeight: 1.65, color: '#1E293B' }}>
      <div style={{ borderBottom: '2px solid #0F172A', paddingBottom: '20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: '900', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE' }}>
              영업부 전용 (SALES)
            </span>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748B' }}>
              문서번호: SOP-SALES-2026-02
            </span>
          </div>
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#0F172A' }}>
            E-Bro ERP 실무 매뉴얼
          </span>
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: '900', color: '#0F172A', margin: '0 0 10px 0', letterSpacing: '-0.5px' }}>
          영업부 업무 표준 매뉴얼 (PC & 모바일 통합 실무 가이드)
        </h1>
        <p style={{ fontSize: '13.5px', color: '#475569', margin: 0 }}>
          고객사 관리부터 출고/대차 의뢰 발행, 전자계약서 발송, 현장 AS 대리접수 및 실시간 모바일 재고 조회까지 영업 직무의 전 과정을 포괄합니다.
        </p>
      </div>

      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '18px 20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Shield size={16} color="#2563EB" />
          <span style={{ fontSize: '13.5px', fontWeight: '800', color: '#0F172A' }}>
            영업부 업무 R&R 및 시스템 핵심 원칙 (전사 표준 헌장 제2장)
          </span>
        </div>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <li><b>'사용 권리 보장' 의뢰 발행 책임</b>: 고객사와의 계약에 따라 장비의 기종, 규격, 옵션, 상하차 일시를 확정하여 '출고/대차 의뢰'를 발행하는 것까지 권한과 책임을 가집니다.</li>
          <li><b>출고 자산번호 직접 지정 금지</b>: 개별 장비(자산번호)의 지정 및 할당은 출고/자산팀 고유 권한이므로, 영업사원이 특정 자산번호를 시스템에 임의 지정하지 않습니다.</li>
          <li><b>대차(교체) 계약 속성 100% 자동 상속</b>: 고장/교체로 새 장비 투입 시 기존 계약의 렌탈료 단가, 청구마감일, 현장옵션, 영업담당자 속성은 시스템에서 100% 자동 상속됩니다.</li>
          <li><b>단일 'EXCHANGE' 배차 발행 원칙</b>: 대차 교체 시 출고와 회수를 분리하지 않고, 단일 '교환(EXCHANGE)' 1건의 왕복 배차 의뢰로 처리되어 운송비가 절감 관리됩니다.</li>
        </ul>
      </div>

      <div className="no-print" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '16px 20px', marginBottom: '32px' }}>
        <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748B', display: 'block', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          빠른 목차 이동 (Click to Jump)
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
          <button type="button" onClick={() => onNavigateTo('sales-sec-1')} style={tocBtnStyle}><span style={tocNumStyle}>1</span> 고객사 및 현장 관리</button>
          <button type="button" onClick={() => onNavigateTo('sales-sec-2')} style={tocBtnStyle}><span style={tocNumStyle}>2</span> PC 출고의뢰 (기존/신규)</button>
          <button type="button" onClick={() => onNavigateTo('sales-sec-3')} style={tocBtnStyle}><span style={tocNumStyle}>3</span> 모바일 출고요청 작성</button>
          <button type="button" onClick={() => onNavigateTo('sales-sec-4')} style={tocBtnStyle}><span style={tocNumStyle}>4</span> 현장 대차(교체) 의뢰 발행</button>
          <button type="button" onClick={() => onNavigateTo('sales-sec-5')} style={tocBtnStyle}><span style={tocNumStyle}>5</span> AI 음성통화 분석 출고의뢰</button>
          <button type="button" onClick={() => onNavigateTo('sales-sec-6')} style={tocBtnStyle}><span style={tocNumStyle}>6</span> 전자계약서 패키지 발송</button>
          <button type="button" onClick={() => onNavigateTo('sales-sec-7')} style={tocBtnStyle}><span style={tocNumStyle}>7</span> 장비 회수 및 AS 대리접수</button>
          <button type="button" onClick={() => onNavigateTo('sales-sec-8')} style={tocBtnStyle}><span style={tocNumStyle}>8</span> 실시간 재고조회 & ToDo</button>
        </div>
      </div>

      <div id="sales-sec-1" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Building2 size={15} /> 1. 고객사 및 현장 관리</div>
          <span style={sourceTagStyle}>PC Step 3 | 모바일 Step 1-4</span>
        </div>
        <p style={descTextStyle}>모든 렌탈 계약의 기초가 되는 고객사 기본정보, 세금계산서 발행 조건, 투입 공사 현장 및 현장 인수 담당자 정보를 등록하고 관리합니다.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div style={cardBoxStyle}>
            <div style={cardHeaderStyle}><Laptop size={14} color="#2563EB" /> <b>PC ERP 작업 절차 (Step 3)</b></div>
            <ol style={stepListStyle}>
              <li><b>[영업관리 ➔ 고객 관리]</b> 메뉴 접속 ➔ 우상단 <code>[+ 신규 고객 등록]</code> 클릭.</li>
              <li><b>고객 기본정보 입력</b>: 고객사명, 사업자등록번호, 대표자명, 대표전화, 계산서 수신 이메일 및 청구/결제 약정일 입력.</li>
              <li><b>현장 추가</b>: 우측 <code>[+ 현장 추가]</code> 클릭 ➔ 현장명(공사명), 현장 도로명 주소, 진입 조건 및 기본 안전옵션 메모 등록.</li>
              <li><b>현장 담당자 등록</b>: 인수자 성함, 직책, 휴대전화 번호를 등록하여 배차/검수 시 자동 연동.</li>
            </ol>
          </div>
          <div style={cardBoxStyle}>
            <div style={cardHeaderStyle}><Smartphone size={14} color="#059669" /> <b>모바일 현장 절차 (Step 1-4)</b></div>
            <ol style={stepListStyle}>
              <li>모바일 하단 <b>[고객관리]</b> 탭 터치 ➔ 상단 초성 검색(예: 'ㅅㅂ' ➔ 세보엠이씨).</li>
              <li>고객 카드 터치 시 소속 현장 및 담당자 전화번호가 즉시 표출.</li>
              <li><b>원클릭 통화 연결</b>: <code>[📞 통화 연결]</code> 버튼을 눌러 현장 소장/담당자와 바로 통화.</li>
              <li><b>즉시 출고의뢰 연계</b>: <code>[이 고객사로 출고요청 작성]</code> 버튼 터치 시 고객 정보가 자동 채워진 출고 작성 화면으로 즉시 전환.</li>
            </ol>
          </div>
        </div>
      </div>

      <div id="sales-sec-2" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Send size={15} /> 2. PC 출고 요청 (Sales Order) 발행</div>
          <span style={sourceTagStyle}>PC Step 10 ~ 14</span>
        </div>
        <p style={descTextStyle}>현장에 장비를 투입하기 위한 공식 출고 의뢰서를 작성합니다. 카톡 텍스트 파싱과 4단계 표준 작성을 지원합니다.</p>
        <div style={scenarioBoxStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: '800', color: '#1E293B' }}>방법 A. 카카오톡 / 문자 텍스트 자동 파싱 출고 (Step 10)</span>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#2563EB', backgroundColor: '#EFF6FF', padding: '2px 8px', borderRadius: '4px' }}>가장 빠름 (10초 완결)</span>
          </div>
          <p style={{ fontSize: '12px', color: '#475569', margin: 0 }}>현장 소장이나 거래처의 요청 메시지를 복사하여 <code>[카톡/문자 텍스트 붙여넣기 파싱]</code> 상자에 넣고 <code>[수동 데이터 변환]</code>을 누르면 고객사, 현장, 연락처, 일시가 자동 파싱됩니다.</p>
        </div>
        <div style={{ ...scenarioBoxStyle, marginTop: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: '800', color: '#1E293B', display: 'block', marginBottom: '6px' }}>방법 B. 신규 고객 또는 신규 현장 직접 입력 출고 (Step 11~14)</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
            <div style={subStepBoxStyle}><span style={subStepNumStyle}>1단계</span><b>고객/현장 지정</b><span style={{ fontSize: '11px', color: '#64748B' }}>거래처, 도로명주소, 인수담당자 입력.</span></div>
            <div style={subStepBoxStyle}><span style={subStepNumStyle}>2단계</span><b>출고 규격/수량</b><span style={{ fontSize: '11px', color: '#64748B' }}>19ft, 26ft 등 기종 터치 및 수량(+) 증감.</span></div>
            <div style={subStepBoxStyle}><span style={subStepNumStyle}>3단계</span><b>상하차 일정</b><span style={{ fontSize: '11px', color: '#64748B' }}>희망 상하차 일시 및 시간지정 선택.</span></div>
            <div style={subStepBoxStyle}><span style={subStepNumStyle}>4단계</span><b>안전옵션 & 운송비</b><span style={{ fontSize: '11px', color: '#64748B' }}>협착봉, 센서, 소화기 선택 및 현장옵션 저장.</span></div>
          </div>
        </div>
      </div>

      <div id="sales-sec-3" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Smartphone size={15} /> 3. 모바일 현장 출고요청 작성</div>
          <span style={sourceTagStyle}>모바일 Step 1-1 ~ 1-3</span>
        </div>
        <p style={descTextStyle}>외근 중 스마트폰 모바일 웹앱에서 1분 만에 출고 의뢰를 발행할 수 있습니다.</p>
        <ol style={stepListStyle}>
          <li><b>홈 화면 ➔ [모바일 출고 요청 작성]</b> 터치 ➔ 고객사 초성 검색 및 투입 현장 선택.</li>
          <li><b>규격 및 상세모델 터치</b>: 19ft, 26ft 등 탭 선택 후 <code>+ GS-1930</code> 터치 시 수량 즉시 반영.</li>
          <li><b>납품 희망일시 & 옵션 선택</b>: 도착 희망일시, 유상옵션 칩 선택 후 <code>[출고 요청 접수 및 발송]</code> 터치로 종결.</li>
        </ol>
      </div>

      <div id="sales-sec-4" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Layers size={15} /> 4. 현장 대차(교체) 의뢰 발행</div>
          <span style={sourceTagStyle}>PC Step 15 | 헌장 2.1~2.3 준수</span>
        </div>
        <p style={descTextStyle}>장비 고장이나 규격 변경 시 동일 계약조건을 100% 자동 상속받아 대차 장비를 투입하고 기존 장비를 회수하는 단일 EXCHANGE 의뢰를 발행합니다.</p>
        <ol style={stepListStyle}>
          <li><b>출고요청 화면 ➔ [교체(대차)] 선택</b>: 업무 유형을 대차로 전환합니다.</li>
          <li><b>거래처 및 투입 현장 선택</b> ➔ 새로 투입할 대차 모델 규격 선택.</li>
          <li><b>회수 대상 전자산 체크</b>: 현장에서 뺄 장비의 체크박스를 선택합니다. (모를 경우 '모름' 체크)</li>
          <li><code>[출고 요청 (검증 완료)]</code> 클릭 시 출고팀과 배차팀으로 단일 EXCHANGE 1건으로 통합 전송됩니다.</li>
        </ol>
      </div>

      <div id="sales-sec-5" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Sparkles size={15} /> 5. AI 음성통화 분석 출고의뢰 (Draft)</div>
          <span style={sourceTagStyle}>PC Step 16 | 모바일 Step 1-1</span>
        </div>
        <p style={descTextStyle}>스마트폰 통화녹음 파일을 업로드하면 AI가 음성을 분석하여 출고요청 초안을 자동 생성합니다.</p>
        <ol style={stepListStyle}>
          <li>PC 상단 <code>[녹음 파일 등록]</code> 또는 모바일 홈의 <code>[통화 녹음 파일 직접 업로드]</code> 클릭.</li>
          <li>녹음 파일 선택 ➔ AI가 고객사명, 현장, 납품일시, 요청 기종 수량을 자동 추출.</li>
          <li>초안 검토 후 <code>[출고 요청 작성 ➔]</code>을 눌러 정식 출고의뢰로 확정합니다.</li>
        </ol>
      </div>

      <div id="sales-sec-6" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><FileText size={15} /> 6. 전자계약서 패키지 PDF 생성 및 이메일 발송</div>
          <span style={sourceTagStyle}>PC Step 23 ~ 25</span>
        </div>
        <p style={descTextStyle}>체결된 계약에 대해 임대차계약서, 사업자등록증, 통장사본, 보험증권이 묶인 패키지 PDF를 고객사에 원클릭 발송합니다.</p>
        <ol style={stepListStyle}>
          <li><b>[영업관리 ➔ 계약 관리]</b> 접속 ➔ 해당 계약의 <code>[상세 ➔]</code> 클릭.</li>
          <li>우측 상단 <code>[계약서 패키지 PDF / 이메일]</code> 클릭 ➔ 수신자 확인 ➔ <code>[계약서 발송]</code> 클릭으로 즉시 전송 완료.</li>
        </ol>
      </div>

      <div id="sales-sec-7" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><PhoneCall size={15} /> 7. 장비 회수 및 AS 대리접수</div>
          <span style={sourceTagStyle}>PC Step 34 ~ 35</span>
        </div>
        <p style={descTextStyle}>공사 완료에 따른 장비 회수 지시와 유선 클레임 발생 시 AS 대리 등록 절차입니다.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div style={cardBoxStyle}>
            <b>🔄 장비 회수 요청 (Step 34)</b>
            <p style={{ fontSize: '12px', color: '#475569', margin: '4px 0 0 0' }}>[영업관리 ➔ 회수 요청] ➔ 현장 선택 ➔ 회수 장비 체크 ➔ 희망일자 및 현장 인수자 입력 ➔ <code>[회수 의뢰 등록]</code>.</p>
          </div>
          <div style={cardBoxStyle}>
            <b>🛠️ 고객 고장 AS 대리 접수 (Step 35)</b>
            <p style={{ fontSize: '12px', color: '#475569', margin: '4px 0 0 0' }}>[영업관리 ➔ AS 요청] ➔ 현장 및 장비 선택 ➔ 고장 증상 칩 선택 ➔ 상세 내용 입력 ➔ <code>[AS의뢰 전송]</code> (AS팀 즉시 전달).</p>
          </div>
        </div>
      </div>

      <div id="sales-sec-8" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Smartphone size={15} /> 8. 모바일 실시간 재고조회 & 직무 ToDo 피드</div>
          <span style={sourceTagStyle}>모바일 Step 1-1, 1-5 | 공통 Step 64~65, 71</span>
        </div>
        <p style={descTextStyle}>고객 통화 중 실시간 가용 재고 확인 및 당면 ToDo 업무 처리 요령입니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li><b>실시간 가용 재고 (Step 1-5)</b>: 모바일 하단 <b>[가용재고]</b> 탭에서 19ft, 26ft 등 주기장 잔여 출고가능 대수를 통화 중 즉시 확인.</li>
          <li><b>직무 ToDo 피드 (Step 1-1)</b>: 모바일 홈 최상단 <code>업무 목록</code>에서 경영진 특별지시나 계약서 재발송 건을 <code>[처리 이동]</code>으로 즉시 완결.</li>
          <li><b>법인차량 주유영수증 (Step 71)</b>: 홈 화면 <code>[법인차량 주유영수증 촬영]</code> 터치 ➔ 카메라 촬영 시 리터/금액 자동 OCR 연동.</li>
        </ul>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 🚜 [2] 출고팀 전용 실무 매뉴얼 상세 콘텐츠
// ─────────────────────────────────────────────────────────────────────────────
const OutboundManualContent: React.FC<{ onNavigateTo: (id: string) => void }> = ({ onNavigateTo }) => {
  return (
    <div style={{ lineHeight: 1.65, color: '#1E293B' }}>
      <div style={{ borderBottom: '2px solid #0F172A', paddingBottom: '20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: '900', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0' }}>
              출고/자산팀 전용 (OUTBOUND)
            </span>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748B' }}>
              문서번호: SOP-OUTBOUND-2026-01
            </span>
          </div>
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#0F172A' }}>
            E-Bro ERP 실무 매뉴얼
          </span>
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: '900', color: '#0F172A', margin: '0 0 10px 0', letterSpacing: '-0.5px' }}>
          출고/자산팀 업무 표준 매뉴얼 (주기장·검수·입출고 가이드)
        </h1>
        <p style={{ fontSize: '13.5px', color: '#475569', margin: 0 }}>
          주기장 자산 할당, PDI 출고 검수 승인 마감, 회수 장비 입고 등록, 주기장 정비 및 소모품 수불 관리 실무를 포괄합니다.
        </p>
      </div>

      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '18px 20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Shield size={16} color="#059669" />
          <span style={{ fontSize: '13.5px', fontWeight: '800', color: '#0F172A' }}>
            출고/자산팀 업무 R&R 및 시스템 핵심 원칙 (전사 표준 헌장 제1~2장)
          </span>
        </div>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <li><b>자산 할당 및 출고 선택권 (헌장 2.1)</b>: 영업사원의 출고/대차 의뢰를 받아 자사 가용 자산(AVAILABLE) 또는 외부 전대 장비를 실질적으로 매핑하고 출고하는 고유 권한과 책임을 집니다.</li>
          <li><b>출고 검수 승인 마감 시 자산상태 'RENTED' 전환 원칙 (헌장 1.3)</b>: PDI 출고 검수 승인이 최종 완료되는 즉시 시스템 자산 상태는 자동으로 <b>`RENTED` (`대여중`)</b>으로 전환됩니다. 배차 단계에서는 자산 상태를 변경하지 않습니다.</li>
          <li><b>무누락 DB 저장 및 정비 복원 (헌장 1.2)</b>: 반납된 장비의 입고 불량 상태를 무누락 기록하고, 주기장 정비 및 소모품 투입 완료 시에만 `AVAILABLE(임대가능)` 상태로 복원합니다.</li>
        </ul>
      </div>

      <div className="no-print" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '16px 20px', marginBottom: '32px' }}>
        <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748B', display: 'block', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          빠른 목차 이동 (Click to Jump)
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
          <button type="button" onClick={() => onNavigateTo('out-sec-1')} style={tocBtnStyle}><span style={tocNumStyle}>1</span> 주기장 모바일 대시보드</button>
          <button type="button" onClick={() => onNavigateTo('out-sec-2')} style={tocBtnStyle}><span style={tocNumStyle}>2</span> 계약 장비 할당 (Assignment)</button>
          <button type="button" onClick={() => onNavigateTo('out-sec-3')} style={tocBtnStyle}><span style={tocNumStyle}>3</span> 출고 검수 (PDI) 승인 마감</button>
          <button type="button" onClick={() => onNavigateTo('out-sec-4')} style={tocBtnStyle}><span style={tocNumStyle}>4</span> 회수 장비 입고 등록</button>
          <button type="button" onClick={() => onNavigateTo('out-sec-5')} style={tocBtnStyle}><span style={tocNumStyle}>5</span> 주기장 정비 및 자산 복원</button>
          <button type="button" onClick={() => onNavigateTo('out-sec-6')} style={tocBtnStyle}><span style={tocNumStyle}>6</span> 장비 매뉴얼 라이브러리</button>
          <button type="button" onClick={() => onNavigateTo('out-sec-7')} style={tocBtnStyle}><span style={tocNumStyle}>7</span> 소모품 수불 및 재고 관리</button>
          <button type="button" onClick={() => onNavigateTo('out-sec-8')} style={tocBtnStyle}><span style={tocNumStyle}>8</span> 자산 취득 & 프린터 큐</button>
        </div>
      </div>

      <div id="out-sec-1" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Truck size={15} /> 1. 주기장 모바일 대시보드 & 실시간 피드</div>
          <span style={sourceTagStyle}>모바일 Step 3-1</span>
        </div>
        <p style={descTextStyle}>출고팀 전용 모바일 홈 화면에서 오늘 처리해야 할 당면 업무와 주기장 상태를 한눈에 파악합니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li><b>주기장 출고 피드</b>: 상단 배너에서 <code>장비 할당 대기 N대</code> 및 <code>출고 검수 대기 N건</code>을 실시간 모니터링합니다.</li>
          <li><b>출고팀 맞춤형 ToDo 피드</b>: 미결 업무가 있을 경우 최상단에 에메랄드 테마의 <code>업무 목록</code> 카드가 표출되며 <code>[처리 이동]</code>으로 즉시 조치합니다.</li>
          <li><b>하단 내비게이션 바 메뉴</b>: <code>[홈]</code>, <code>[장비할당]</code>, <code>[출고검수]</code>, <code>[입고등록]</code>, <code>[주기장자산]</code>을 탭 터치로 즉시 전환합니다.</li>
        </ul>
      </div>

      <div id="out-sec-2" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Layers size={15} /> 2. 계약 장비 할당 (Assignment)</div>
          <span style={sourceTagStyle}>모바일 Step 3-2</span>
        </div>
        <p style={descTextStyle}>영업부의 출고 요청 건에 대해 주기장의 가용한 자산(AVAILABLE) 또는 전대 장비 번호를 매핑하여 슬롯을 채웁니다.</p>
        <ol style={stepListStyle}>
          <li>모바일 하단 <b>[장비할당]</b> 탭 접속 ➔ 미할당 계약 목록에서 대상 계약 터치.</li>
          <li>미할당 슬롯(예: <code>슬롯 #1: ES1330L</code>) 선택.</li>
          <li>가용 장비 목록에서 최적 자산(정비점수 0 최상 자산 등)을 터치하거나 관리번호 직접 검색 후 <code>[선택 추가]</code>.</li>
          <li>하단 <code>[매핑 대상 장비 선택]</code> 확인 후 할당을 확정합니다.</li>
        </ol>
      </div>

      <div id="out-sec-3" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><CheckSquare size={15} /> 3. 출고 검수 (PDI) 승인 마감</div>
          <span style={sourceTagStyle}>PC Step 21~22 | 모바일 Step 3-3~3-4 | 헌장 1.3</span>
        </div>
        <p style={descTextStyle}>장비 출고 전 필수 안전장치와 현장 옵션을 최종 검수하고 출고를 승인 마감합니다.</p>
        <div style={tipBoxStyle}>
          <AlertCircle size={15} color="#059669" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <b>헌장 1.3 핵심 원칙</b>: <code>[최종 출고 승인 마감]</code> 버튼을 누르는 순간 자산 상태는 즉시 <b>`RENTED(대여중)`</b>으로 전환됩니다.
          </div>
        </div>
        <ol style={{ ...stepListStyle, marginTop: '12px' }}>
          <li><b>[출고검수]</b> 탭 접속 ➔ 검수 대기 목록에서 대상 건 선택.</li>
          <li><b>검수 체크리스트 확인</b>: 모델 일치 여부, 철망/함석, 상단 감지봉/협착 센서(4EA), 부착물 세트 등 체크박스 확인.</li>
          <li><b>외관 사진 촬영</b>: 검수 완료된 장비의 정면/측면 사진을 촬영하여 등록.</li>
          <li><code>[출고 검수 승인 완료]</code> 버튼 클릭 ➔ 검수 완료 및 자산상태 대여중 전환.</li>
        </ol>
      </div>

      <div id="out-sec-4" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Truck size={15} /> 4. 회수 장비 입고 등록 및 검수</div>
          <span style={sourceTagStyle}>PC Step 46~48 | 모바일 Step 3-5~3-6</span>
        </div>
        <p style={descTextStyle}>현장에서 반납 회수된 장비를 검수하여 정상/불량을 판정하고 입고 처리합니다.</p>
        <ol style={stepListStyle}>
          <li>모바일 하단 <b>[입고등록]</b> 탭 접속 ➔ 입고 대상 장비 관리번호 입력 또는 검색.</li>
          <li><b>외관 및 기능 상태 판정</b>:
            <br />• <b>정상 입고</b>: 이상 없음 ➔ 즉시 <code>AVAILABLE(임대가능)</code>으로 전환.
            <br />• <b>불량 / 정비필요</b>: 고장 증상 체크리스트(방지봉 파손, 누유, 키박스 등) 체크 ➔ 정비점수 산출 ➔ <code>RENTED_RETURNED(입고반납/수리대기)</code> 상태로 전환되어 정비 큐로 이동.
          </li>
          <li>입고 증빙 외관 사진 촬영 첨부 ➔ 특이사항 메모 입력 ➔ <code>[입고 등록 완료]</code>.</li>
        </ol>
      </div>

      <div id="out-sec-5" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Wrench size={15} /> 5. 주기장 정비 및 자산 복원</div>
          <span style={sourceTagStyle}>PC Step 41~43</span>
        </div>
        <p style={descTextStyle}>입고된 결함 장비를 정비하고 소모품을 투입하여 임대가능 상태로 복원합니다.</p>
        <ol style={stepListStyle}>
          <li><b>[정비 및 수리 ➔ 주기장 정비관리]</b> 메뉴 접속 ➔ 정비 대상 자산 선택.</li>
          <li>정비항목 코드 선택(전기/배터리, 유압/동력 등) ➔ 정비 소요시간 입력.</li>
          <li><b>소모품 투입 관리</b>: 사용된 주기장 소모품 선택 및 수량 투입 ➔ 소모품 재고 자동 차감.</li>
          <li>수리 완료 후 사진 첨부 ➔ <code>[정비 완료]</code> 클릭 시 자산 상태가 <code>AVAILABLE(임대가능)</code>으로 복원.</li>
        </ol>
      </div>

      <div id="out-sec-6" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><BookOpen size={15} /> 6. 장비 매뉴얼 라이브러리 열람</div>
          <span style={sourceTagStyle}>PC Step 45 | 모바일 연동</span>
        </div>
        <p style={descTextStyle}>기종별 파츠북, 에러코드 진단표, 전기/유압 회로도를 열람하여 신속 정확한 정비를 수행합니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li>PC <code>[정비 및 수리 ➔ 정비항목 관리 ➔ 장비 매뉴얼 라이브러리]</code> 또는 모바일 홈 <code>[장비 매뉴얼 라이브러리]</code> 클릭.</li>
          <li>기종별(SJ3219, GS-1930 등) 파츠북 PDF 다운로드 및 회로도 고해상도 뷰어 열람.</li>
        </ul>
      </div>

      <div id="out-sec-7" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Boxes size={15} /> 7. 소모품 수불 및 재고 관리</div>
          <span style={sourceTagStyle}>PC Step 49, 51~57</span>
        </div>
        <p style={descTextStyle}>충전기, 컨트롤러, 센서 등 주기장 소모품의 구매신청, 입고 증빙 첨부 및 AS 차량 불출을 관리합니다.</p>
        <ol style={stepListStyle}>
          <li><b>구매신청 (Step 49)</b>: <code>[소모품 입출고 ➔ 소모품 구매신청]</code>에서 품목 및 예상단가 입력 후 제출.</li>
          <li><b>입고확정 (Step 51)</b>: 관리부 승인 건에 대해 납품증빙 거래명세서 사진을 첨부하여 입고 확정.</li>
          <li><b>차량 불출 (Step 55)</b>: <code>[차량재고 이동]</code>에서 AS 기사 차량을 선택하고 부품을 불출 이동.</li>
        </ol>
      </div>

      <div id="out-sec-8" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Printer size={15} /> 8. 자산 취득 & 프린터 큐 모니터</div>
          <span style={sourceTagStyle}>PC Step 4~7, 75</span>
        </div>
        <p style={descTextStyle}>신규 장비 등록 및 주기장 원격 무인 라벨/송장 출력 관리입니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li><b>자산 취득 (Step 5~7)</b>: 신규 매입 장비의 시리얼, 관리번호, 취득가를 단건 또는 엑셀 일괄 등록.</li>
          <li><b>프린터 큐 모니터 (Step 75)</b>: 주기장 사무실 프린터를 등록하여 출고 송장 및 검수증을 자동 라우팅 인쇄.</li>
        </ul>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 🔧 [3] AS팀 전용 실무 매뉴얼 상세 콘텐츠
// ─────────────────────────────────────────────────────────────────────────────
const AsManualContent: React.FC<{ onNavigateTo: (id: string) => void }> = ({ onNavigateTo }) => {
  return (
    <div style={{ lineHeight: 1.65, color: '#1E293B' }}>
      <div style={{ borderBottom: '2px solid #0F172A', paddingBottom: '20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: '900', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#FEF3C7', color: '#D97706', border: '1px solid #FDE68A' }}>
              AS팀 전용 (SERVICE)
            </span>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748B' }}>
              문서번호: SOP-AS-2026-01
            </span>
          </div>
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#0F172A' }}>
            E-Bro ERP 실무 매뉴얼
          </span>
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: '900', color: '#0F172A', margin: '0 0 10px 0', letterSpacing: '-0.5px' }}>
          현장 AS팀 업무 표준 매뉴얼 (출동·수리·소모품 가이드)
        </h1>
        <p style={{ fontSize: '13.5px', color: '#475569', margin: 0 }}>
          현장 출동 티켓 접수, T맵 길안내, 현장 정비 조치(부품 차감/고객 서명), 탑차 소모품 수불 및 모바일 회로도 열람 가이드를 포괄합니다.
        </p>
      </div>

      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '18px 20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Shield size={16} color="#D97706" />
          <span style={{ fontSize: '13.5px', fontWeight: '800', color: '#0F172A' }}>
            AS팀 업무 R&R 및 현장 조치 원칙
          </span>
        </div>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <li><b>현장 조치 완결 및 고객 서명 의무</b>: 현장 방문 즉시 수리 전/후 사진을 촬영하고, 조치 내역과 탑차 부품 사용을 정확히 기록하며 현장 고객 서명을 필수 저장합니다.</li>
          <li><b>유/무상 구분 명확화</b>: 장비 자체 결함은 무상(임대보증), 사용자 과실(충돌 파손, 케이블 절단 등)은 유상 수리로 명확히 구분하여 채권 분리를 지원합니다.</li>
          <li><b>탑차 소모품 실시간 잔량 보존</b>: 출동 차량에 적재된 부품을 사용하거나 보충받을 때 모바일에서 실시간 이동 및 차감 처리하여 재고 오차를 방지합니다.</li>
        </ul>
      </div>

      <div className="no-print" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '16px 20px', marginBottom: '32px' }}>
        <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748B', display: 'block', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          빠른 목차 이동 (Click to Jump)
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
          <button type="button" onClick={() => onNavigateTo('as-sec-1')} style={tocBtnStyle}><span style={tocNumStyle}>1</span> 모바일 출동 대시보드 & T맵</button>
          <button type="button" onClick={() => onNavigateTo('as-sec-2')} style={tocBtnStyle}><span style={tocNumStyle}>2</span> 현장 조치 & 고객 서명</button>
          <button type="button" onClick={() => onNavigateTo('as-sec-3')} style={tocBtnStyle}><span style={tocNumStyle}>3</span> 현장 AS 셀프 접수</button>
          <button type="button" onClick={() => onNavigateTo('as-sec-4')} style={tocBtnStyle}><span style={tocNumStyle}>4</span> 모바일 장비 매뉴얼 라이브러리</button>
          <button type="button" onClick={() => onNavigateTo('as-sec-5')} style={tocBtnStyle}><span style={tocNumStyle}>5</span> 탑차 소모품 재고 수불 관리</button>
          <button type="button" onClick={() => onNavigateTo('as-sec-6')} style={tocBtnStyle}><span style={tocNumStyle}>6</span> 수리 이력 및 성과 관리</button>
        </div>
      </div>

      <div id="as-sec-1" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Wrench size={15} /> 1. 모바일 출동 대시보드 & T맵 길안내</div>
          <span style={sourceTagStyle}>모바일 Step 2-1 | PC Step 36~37</span>
        </div>
        <p style={descTextStyle}>스마트폰 모바일 웹앱에서 오늘의 AS 방문 일정을 확인하고 현장으로 출동합니다.</p>
        <ol style={stepListStyle}>
          <li>모바일 하단 <b>[출동티켓]</b> 탭 접속 ➔ 오늘의 배정된 AS 카드 목록 확인.</li>
          <li>카드 터치 시 현장 주소, 고장 증상(작동불가, 에러코드 등) 상세 확인.</li>
          <li><code>[🧭 T맵 길안내]</code> 터치 ➔ 스마트폰 T맵 앱으로 현장 목적지가 즉시 연동되어 내비게이션 시작.</li>
          <li><code>[📞 담당자 통화]</code> 터치 ➔ 현장 인수자/소장과 도착 예정 시간 즉시 유선 조율.</li>
        </ol>
      </div>

      <div id="as-sec-2" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><CheckSquare size={15} /> 2. 현장 정비 조치 & 고객 서명 저장</div>
          <span style={sourceTagStyle}>모바일 Step 2-2 | PC Step 39</span>
        </div>
        <p style={descTextStyle}>수리 조치 완료 후 사용 부품을 차감하고 현장 확인 서명을 받아 마감합니다.</p>
        <ol style={stepListStyle}>
          <li><b>현장 조치 내용 입력</b>: 정비 항목(방지봉 교체, 릴레이 점검 등) 및 조치 시간 선택.</li>
          <li><b>차량 탑차 부품 차감</b>: 현장에서 사용한 소모품(스위치, 센서 등)을 선택하고 수량 차감.</li>
          <li><b>수리 전/후 사진 첨부</b>: 카메라로 파손 상태(전)와 수리 완료 상태(후)를 촬영하여 업로드.</li>
          <li><b>유/무상 선택</b>: 무상(임대보증) 또는 유상(사용자과실) 구분 선택.</li>
          <li><b>현장 고객 확인 서명</b>: 고객 서명 패드에 서명을 받고 <code>[AS 조치 완료 승인]</code> 터치로 종결.</li>
        </ol>
      </div>

      <div id="as-sec-3" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><PhoneCall size={15} /> 3. 현장 AS 신규 셀프 접수</div>
          <span style={sourceTagStyle}>모바일 Step 2-3</span>
        </div>
        <p style={descTextStyle}>현장 순회 중 추가 고장 접수가 발생했을 때 기사가 현장에서 즉시 자체 접수합니다.</p>
        <ol style={stepListStyle}>
          <li>모바일 하단 <code>[AS신규]</code> 탭 터치.</li>
          <li>현장 장비의 관리번호(또는 시리얼) 검색 ➔ 고장 분류 칩 터치.</li>
          <li>고장 상세 내용 및 접수자 성함/연락처 입력 후 <code>[AS 접수 완료]</code> 터치 시 티켓이 즉시 생성됩니다.</li>
        </ol>
      </div>

      <div id="as-sec-4" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><BookOpen size={15} /> 4. 모바일 장비 매뉴얼 라이브러리 열람</div>
          <span style={sourceTagStyle}>모바일 Step 2-4 | PC Step 45</span>
        </div>
        <p style={descTextStyle}>현장 작업 중 스마트폰에서 전기 배선도, 유압 회로도, 파츠북을 즉시 열람합니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li>모바일 상단 툴바 <code>[📖 장비 매뉴얼]</code> 퀵 버튼 또는 홈 화면 <code>[장비 매뉴얼 라이브러리]</code> 터치.</li>
          <li>기종별 에러코드(02번, 18번 등) 검색 ➔ 해결 가이드 및 회로도 모바일 즉시 확인.</li>
        </ul>
      </div>

      <div id="as-sec-5" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Boxes size={15} /> 5. 탑차 소모품 재고 수불 관리</div>
          <span style={sourceTagStyle}>PC Step 40, 55~58 | 모바일 연동</span>
        </div>
        <p style={descTextStyle}>출동 차량 적재 부품 잔량 확인, 주기장 보충 요청 및 차량 간 소모품 이동 처리입니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li><b>차량 재고 확인</b>: 모바일 하단 <b>[차량재고]</b> 탭에서 내 탑차에 적재된 부품별 수량 확인.</li>
          <li><b>주기장 보충 요청</b>: 부품 부족 시 <code>[보충]</code> 버튼으로 주기장 자산팀에 불출 요청.</li>
          <li><b>차량 간 이동 (Step 57)</b>: 다른 기사와 현장에서 부품을 주고받았을 때 <code>[차량 간 이동]</code> 등록.</li>
        </ul>
      </div>

      <div id="as-sec-6" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Clock size={15} /> 6. 수리 이력 및 성과 관리</div>
          <span style={sourceTagStyle}>PC Step 38~40</span>
        </div>
        <p style={descTextStyle}>장비별 과거 수리 누적 이력을 확인하여 반복 고장을 예방하고 정비 성과를 분석합니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li>PC <b>[현장 AS 관리 ➔ AS 관리 대장]</b>에서 장비번호 클릭 시 과거 출동 일자 및 조치 내역 타임라인 열람.</li>
        </ul>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 💼 [4] 관리부 / 경영진 전용 실무 매뉴얼 상세 콘텐츠
// ─────────────────────────────────────────────────────────────────────────────
const AdminManualContent: React.FC<{ onNavigateTo: (id: string) => void }> = ({ onNavigateTo }) => {
  return (
    <div style={{ lineHeight: 1.65, color: '#1E293B' }}>
      <div style={{ borderBottom: '2px solid #0F172A', paddingBottom: '20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: '900', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#F3E8FF', color: '#7C3AED', border: '1px solid #DDD6FE' }}>
              관리부 / 경영진 전용 (ADMIN)
            </span>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748B' }}>
              문서번호: SOP-ADMIN-2026-01
            </span>
          </div>
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#0F172A' }}>
            E-Bro ERP 실무 매뉴얼
          </span>
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: '900', color: '#0F172A', margin: '0 0 10px 0', letterSpacing: '-0.5px' }}>
          관리부 및 경영진 업무 표준 매뉴얼 (배차·정산·회계·인사 가이드)
        </h1>
        <p style={{ fontSize: '13.5px', color: '#475569', margin: 0 }}>
          배차 지시, 운송료/임차료 매입 대사, 매출 청구 및 세금계산서, 은행 통장 1:1 대사, 채권 연체 관리, 급여 및 감가상각 마감 실무를 포괄합니다.
        </p>
      </div>

      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '18px 20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Shield size={16} color="#7C3AED" />
          <span style={{ fontSize: '13.5px', fontWeight: '800', color: '#0F172A' }}>
            관리부 회계 정산 및 무누락 대사 원칙 (전사 표준 헌장 제3~4장)
          </span>
        </div>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <li><b>종단 보존 법칙 및 대차대조 검증</b>: 모든 월말 대사(운송료, 매입, 수납)는 <code>청구총액 = 확정액 + 반려액 | 대차 차액 ₩0</code> 공식을 만족해야 최종 확정 마감됩니다.</li>
          <li><b>단일 EXCHANGE 1건 정산 (헌장 2.3)</b>: 대차 교환 배차 건은 왕복 운송비 할인 합의에 따라 1건의 교환 배차로 묶어 매입 정산합니다.</li>
          <li><b>자산별 일할 매출기여액 정밀 집계 (헌장 4.1)</b>: 대차 발생 시 전자산은 전일 마감, 후장비는 당일부터 승계하여 1원도 오차 없이 일할 집계합니다.</li>
        </ul>
      </div>

      <div className="no-print" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '16px 20px', marginBottom: '32px' }}>
        <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748B', display: 'block', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          빠른 목차 이동 (Click to Jump)
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
          <button type="button" onClick={() => onNavigateTo('adm-sec-1')} style={tocBtnStyle}><span style={tocNumStyle}>1</span> 인사/조직/권한 설정</button>
          <button type="button" onClick={() => onNavigateTo('adm-sec-2')} style={tocBtnStyle}><span style={tocNumStyle}>2</span> 배차 지시 & 문자 발송</button>
          <button type="button" onClick={() => onNavigateTo('adm-sec-3')} style={tocBtnStyle}><span style={tocNumStyle}>3</span> 운송료 1:1 대사 및 지급</button>
          <button type="button" onClick={() => onNavigateTo('adm-sec-4')} style={tocBtnStyle}><span style={tocNumStyle}>4</span> 임차(전대) 관리 & 정산</button>
          <button type="button" onClick={() => onNavigateTo('adm-sec-5')} style={tocBtnStyle}><span style={tocNumStyle}>5</span> 매출 청구 & 세금계산서</button>
          <button type="button" onClick={() => onNavigateTo('adm-sec-6')} style={tocBtnStyle}><span style={tocNumStyle}>6</span> 은행 통장 1:1 대사 & 수납</button>
          <button type="button" onClick={() => onNavigateTo('adm-sec-7')} style={tocBtnStyle}><span style={tocNumStyle}>7</span> 미수채권 연체 & 출고금지</button>
          <button type="button" onClick={() => onNavigateTo('adm-sec-8')} style={tocBtnStyle}><span style={tocNumStyle}>8</span> 급여·감가상각 & 자금분석</button>
        </div>
      </div>

      <div id="adm-sec-1" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Shield size={15} /> 1. 인사, 조직 및 메뉴 권한 설정</div>
          <span style={sourceTagStyle}>PC Step 1 ~ 2</span>
        </div>
        <p style={descTextStyle}>전사 부서 조직도 구성, 직원 등록 및 계정별 메뉴 권한 매트릭스를 통제합니다.</p>
        <ol style={stepListStyle}>
          <li><b>[경영관리 - 특수 ➔ 조직/인사 관리]</b>: 부서 생성 및 신규 직원을 등록하고 부서 카드로 드래그 배치.</li>
          <li><b>[사용자 및 권한]</b>: 직원별 조회(VIEW) 및 저장(SAVE) 권한을 메뉴별로 체크 부여.</li>
        </ol>
      </div>

      <div id="adm-sec-2" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Truck size={15} /> 2. 운송거래처 관리 및 배차 지시</div>
          <span style={sourceTagStyle}>PC Step 17~19 | 모바일 Step 4-1</span>
        </div>
        <p style={descTextStyle}>출고요청 접수 건에 대해 운송사 기사를 배정하고 배차 문자를 자동 발송합니다.</p>
        <ol style={stepListStyle}>
          <li><b>[배차 및 물류 ➔ 배차/운송관리]</b> 접속 ➔ 배차 전(대기) 목록에서 대상 건 선택.</li>
          <li>운송사, 기사 성함, 차량번호, 차종(5톤 렉카/셀프로더 등), 운송료 입력 ➔ <code>[배차기사 배정 완료]</code>.</li>
          <li><b>모바일 배차문자 발송 (Step 4-1)</b>: 모바일에서 기사 배정 시 배차 메시지가 자동 완성되며 <code>[발송]</code> 클릭 즉시 기사에게 SMS 전송.</li>
          <li>현장 하차 확인 후 <code>[운송완료]</code> 처리 ➔ 월말 운송료 대사 큐로 자동 연결.</li>
        </ol>
      </div>

      <div id="adm-sec-3" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><FileSpreadsheet size={15} /> 3. 월말 운송료 1:1 대사 및 지급요청</div>
          <span style={sourceTagStyle}>PC Step 20 | 헌장 3.5 Z-패턴</span>
        </div>
        <p style={descTextStyle}>운송사에서 청구된 월말 엑셀 거래명세서를 시스템 배차내역과 1:1 대조하여 차액을 검증하고 지급을 확정합니다.</p>
        <ol style={stepListStyle}>
          <li><b>좌상단 범위 설정</b>: 정산 연월(예: 2026년 8월) 및 정산 운송사 선택.</li>
          <li><b>우상단 데이터 유입</b>: <code>[거래명세서 업로드 & 자동 대사]</code> 클릭 ➔ 운송사 엑셀 파일 선택.</li>
          <li><b>중앙 본문 1:1 대사</b>: 시스템 배차금액 vs 운송사 청구금액 1:1 자동 대조 ➔ 차액 건 인라인 원클릭 승인/조치.</li>
          <li><b>우하단 최종 종결</b>: 대차대조 합계 검증식 확인 ➔ <code>[대사 완료 통합 지급요청 생성 ➔]</code> 클릭으로 월말 매입정산 연결.</li>
        </ol>
      </div>

      <div id="adm-sec-4" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><Layers size={15} /> 4. 임차(전대) 장비 등록 및 임차료 정산</div>
          <span style={sourceTagStyle}>PC Step 8~10 | 모바일 Step 4-2</span>
        </div>
        <p style={descTextStyle}>외부 타사 렌탈사로부터 빌려온 임차 장비를 등록하고 월말 임차료를 정산합니다.</p>
        <ol style={stepListStyle}>
          <li><b>임차자산 등록 (Step 8)</b>: 임차처(롯데렌탈 등), 월임차료, 임차기간 입력 ➔ 가용자산 편입.</li>
          <li><b>임차료 대사 (Step 9)</b>: 수신한 거래명세서 PDF/엑셀 업로드 ➔ 약정기간 동기화 ➔ 지급요청 생성.</li>
        </ol>
      </div>

      <div id="adm-sec-5" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><DollarSign size={15} /> 5. 매출 청구 및 세금계산서 발행</div>
          <span style={sourceTagStyle}>PC Step 26 ~ 30</span>
        </div>
        <p style={descTextStyle}>월말 임대료를 일괄/개별 정산하고 거래명세서 및 세금계산서를 발행 발송합니다.</p>
        <ol style={stepListStyle}>
          <li><b>미청구 정산 (Step 26~27)</b>: 마감일 기준 정산 대상 조회 ➔ <code>[+ 일괄청구생성]</code> 또는 개별 계산기에서 추가비용(운송비/수리비) 합산 청구.</li>
          <li><b>거래명세서 발송 (Step 28)</b>: 청구 대장에서 <code>[거래명세서 메일 발송]</code> 클릭 ➔ 고객사 이메일 발송.</li>
          <li><b>청구서 통합 (Step 29)</b>: 동일 거래처 복수 현장 건에 대해 1장의 통합 인보이스로 묶어 발행.</li>
        </ol>
      </div>

      <div id="adm-sec-6" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><CreditCard size={15} /> 6. 은행 통장 1:1 대사 및 수납 관리</div>
          <span style={sourceTagStyle}>PC Step 32 ~ 33</span>
        </div>
        <p style={descTextStyle}>은행 엑셀 거래내역을 업로드하여 통장 입금액을 미수 청구 건과 1:1 매칭 수납 처리합니다.</p>
        <ol style={stepListStyle}>
          <li><b>[경영관리 ➔ 은행 입출금 대장]</b> 접속 ➔ <code>[+ 통장 엑셀 업로드]</code> 클릭.</li>
          <li>입금자명/적요 키워드를 기반으로 미수 청구 건과 1:1 자동 매칭 ➔ <code>[수납 처리]</code>.</li>
          <li>거액 분할 건은 <b>외상미수금 (Step 33)</b>에 등록하여 분할 수납 관리.</li>
        </ol>
      </div>

      <div id="adm-sec-7" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><AlertTriangle size={15} /> 7. 미수채권 연체 통제 & 출고금지 락</div>
          <span style={sourceTagStyle}>PC Step 31 | 모바일 Step 5-2</span>
        </div>
        <p style={descTextStyle}>고위험 장기 연체 거래처를 모니터링하고 수금 지시 및 출고금지 락(Lock)을 집행합니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li>약정일 도과 30일/60일 이상 고위험 연체 거래처 모니터링.</li>
          <li>담당 영업사원에게 <code>[수금지시 하달]</code> 및 해당 고객사 신규 출고를 차단하는 <code>[출고금지]</code> 락 집행.</li>
        </ul>
      </div>

      <div id="adm-sec-8" className="manual-section" style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionBadgeStyle}><TrendingUp size={15} /> 8. 급여·감가상각 마감 & 자금흐름 분석</div>
          <span style={sourceTagStyle}>PC Step 66~74 | 모바일 Step 5-1</span>
        </div>
        <p style={descTextStyle}>월말 인사/회계 마감 및 전사 자금 유동성을 분석합니다.</p>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li><b>급여 정산 (Step 67)</b>: 연장/야간/휴일 OT 및 연차 데이터 자동 연계 급여 산출.</li>
          <li><b>감가상각 마감 (Step 68)</b>: 당사 자산에 대해 월별 정액법 감가상각 실행 ➔ 장부가치 스냅샷 확정.</li>
          <li><b>자금흐름 분석 (Step 74)</b>: 향후 30/60/90일 가용 잔고, 수납 예정액, 운영 지출(OPEX) 분석 및 부도 위험 사전 경보.</li>
          <li><b>경영진 모바일 뷰 (모바일 Step 5-1)</b>: 전사 실시간 자산 가동률(96.2%), 매입대금 지출 결재 원클릭 승인.</li>
        </ul>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 🎨 B안 스타일 전용 CSS 인라인 스타일 객체
// ─────────────────────────────────────────────────────────────────────────────
const sectionStyle: React.CSSProperties = {
  marginBottom: '36px',
  paddingBottom: '24px',
  borderBottom: '1px solid #E2E8F0'
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '10px',
  flexWrap: 'wrap',
  gap: '8px'
};

const sectionBadgeStyle: React.CSSProperties = {
  fontSize: '17px',
  fontWeight: '900',
  color: '#0F172A',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  letterSpacing: '-0.3px'
};

const sourceTagStyle: React.CSSProperties = {
  fontSize: '11.5px',
  fontWeight: '700',
  color: '#64748B',
  backgroundColor: '#F1F5F9',
  padding: '3px 8px',
  borderRadius: '6px',
  border: '1px solid #E2E8F0'
};

const descTextStyle: React.CSSProperties = {
  fontSize: '13.5px',
  color: '#475569',
  margin: '0 0 16px 0'
};

const cardBoxStyle: React.CSSProperties = {
  backgroundColor: '#F8FAFC',
  border: '1px solid #E2E8F0',
  borderRadius: '8px',
  padding: '16px',
  boxSizing: 'border-box'
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  color: '#0F172A',
  marginBottom: '10px'
};

const stepListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '18px',
  fontSize: '12.5px',
  color: '#334155',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const tipBoxStyle: React.CSSProperties = {
  backgroundColor: '#EFF6FF',
  border: '1px solid #BFDBFE',
  borderRadius: '8px',
  padding: '12px 16px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  fontSize: '12.5px',
  color: '#1E40AF',
  lineHeight: 1.55
};

const scenarioBoxStyle: React.CSSProperties = {
  backgroundColor: '#F8FAFC',
  border: '1px solid #E2E8F0',
  borderRadius: '8px',
  padding: '14px 16px'
};

const subStepBoxStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  border: '1px solid #CBD5E1',
  borderRadius: '6px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const subStepNumStyle: React.CSSProperties = {
  fontSize: '10.5px',
  fontWeight: '900',
  color: '#2563EB',
  textTransform: 'uppercase'
};

const tocBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '7px 10px',
  borderRadius: '6px',
  border: '1px solid #E2E8F0',
  backgroundColor: '#F8FAFC',
  fontSize: '12px',
  fontWeight: '700',
  color: '#334155',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'all 0.1s ease'
};

const tocNumStyle: React.CSSProperties = {
  width: '18px',
  height: '18px',
  borderRadius: '4px',
  backgroundColor: '#E2E8F0',
  color: '#0F172A',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '10.5px',
  fontWeight: '900',
  flexShrink: 0
};
