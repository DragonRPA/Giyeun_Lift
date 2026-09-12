import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Radio } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  isModal?: boolean;
  onClose?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCloseModal = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onClose) {
      this.props.onClose();
    }
  };

  private handleResetWalkieAndReload = () => {
    try {
      localStorage.removeItem('walkie_power_on');
      localStorage.removeItem('walkie_today_history');
      localStorage.removeItem('walkie_channel');
      localStorage.removeItem('walkie_channels_v2');
      localStorage.removeItem('walkie_show_debug');
    } catch {}
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const isModal = Boolean(this.props.isModal);
      return (
        <div style={{
          position: isModal ? 'fixed' : 'relative',
          inset: isModal ? 0 : undefined,
          zIndex: isModal ? 99999 : undefined,
          minHeight: isModal ? '100dvh' : '100dvh',
          width: '100%',
          backgroundColor: isModal ? 'rgba(2, 6, 23, 0.92)' : '#090d16',
          backdropFilter: isModal ? 'blur(10px)' : undefined,
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
          fontFamily: 'sans-serif'
        }}>
          <div style={{
            maxWidth: '420px',
            width: '100%',
            backgroundColor: '#0f172a',
            border: '1px solid #ef4444',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <AlertTriangle size={20} color="#f87171" />
              </div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: '800', color: '#f8fafc' }}>
                  {this.props.fallbackTitle || '화면 일시 오류 복구'}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                  작업 상태 보호를 위해 화면을 안전하게 복원합니다.
                </div>
              </div>
            </div>

            {this.state.error && (() => {
              const rawMsg = this.state.error.message || String(this.state.error);
              let decodedNote = '';
              if (rawMsg.includes('310')) {
                decodedNote = ' [진단: React Hook 호출 순서/개수 불일치 오류]';
              } else if (rawMsg.includes('300')) {
                decodedNote = ' [진단: React Hook 조건부 호출 오류]';
              } else if (rawMsg.includes('185')) {
                decodedNote = ' [진단: 무한 재렌더링 루프 (Maximum update depth exceeded)]';
              }

              return (
                <div style={{
                  padding: '10px',
                  borderRadius: '8px',
                  backgroundColor: '#020617',
                  border: '1px solid #334155',
                  fontSize: '11px',
                  color: '#f87171',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  marginBottom: '16px',
                  maxHeight: '120px',
                  overflowY: 'auto'
                }}>
                  <div>{rawMsg}{decodedNote}</div>
                  {this.state.errorInfo?.componentStack && (
                    <details style={{ marginTop: '6px', color: '#94a3b8', fontSize: '10px' }}>
                      <summary style={{ cursor: 'pointer', color: '#cbd5e1' }}>컴포넌트 호출 스택</summary>
                      <pre style={{ margin: '4px 0 0 0', whiteSpace: 'pre-wrap' }}>
                        {this.state.errorInfo.componentStack.slice(0, 500)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer'
                }}
              >
                <RefreshCw size={14} />
                <span>화면 새로고침</span>
              </button>

              <button
                type="button"
                onClick={this.handleResetWalkieAndReload}
                style={{
                  width: '100%',
                  padding: '9px',
                  borderRadius: '10px',
                  border: '1px solid #334155',
                  backgroundColor: '#1e293b',
                  color: '#94a3b8',
                  fontSize: '12px',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer'
                }}
              >
                <Radio size={13} />
                <span>무전기 캐시 초기화 및 재접속</span>
              </button>

              {isModal && (
                <button
                  type="button"
                  onClick={this.handleCloseModal}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '10px',
                    border: '1px solid #475569',
                    backgroundColor: 'transparent',
                    color: '#cbd5e1',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  모달 닫기
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
