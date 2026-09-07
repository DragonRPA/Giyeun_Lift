// src/mobile/components/MobileGemsAgentModal.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Sparkles, Mic, MicOff, X, Send, Key, CheckCircle2, AlertTriangle, 
  Layers, ArrowRight, Truck, RefreshCw, RefreshCcw, Wrench, Calendar, User, Phone, MapPin
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { 
  GemsMessage, GemsContextData, sendGemsMessage, 
  getGeminiApiKey, setGeminiApiKey 
} from '../../services/geminiGemsService';
import { db } from '../../services/db';

interface MobileGemsAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated?: (type: string, data: any) => void;
}

export const MobileGemsAgentModal: React.FC<MobileGemsAgentModalProps> = ({
  isOpen,
  onClose,
  onOrderCreated
}) => {
  const { customers, sites, currentUser, saveSmartDispatch, createFieldAsTicket, showErrorModal } = useApp();

  // 대화 메시지 상태
  const [messages, setMessages] = useState<GemsMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: '안녕하세요! e-Bro AI 비서 젬스입니다. 출고의뢰, 회수의뢰, 교환의뢰, 현장AS 접수를 음성으로 말씀해주시면 서식을 자동으로 검증하고 완성해드립니다.',
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 음성 인식 (STT) 상태
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  // API 키 설정 모달
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => getGeminiApiKey());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 컨텍스트 데이터 생성
  const contextData: GemsContextData = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    return {
      customerNames: customers.map(c => c.name),
      siteNames: sites.map(s => s.name),
      rentedAssets: (db.assets || []).filter(a => a.status === 'RENTED').map(a => {
        const site = sites.find(s => s.id === a.currentSiteId);
        const cust = customers.find(c => c.id === a.currentCustomerId);
        return {
          assetNo: a.assetNo,
          modelName: a.modelName,
          siteName: site?.name || '',
          customerName: cust?.name || ''
        };
      }),
      todayYmd: today.toISOString().split('T')[0],
      tomorrowYmd: tomorrow.toISOString().split('T')[0]
    };
  }, [customers, sites]);

  // 대화창 하단 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // STT 엔진 초기화
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'ko-KR';
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const combined = (final || interim).trim();
        if (combined) {
          setLiveTranscript(combined);
        }
      };

      rec.onerror = (e: any) => {
        console.warn('Gems STT 에러:', e.error);
      };

      recognitionRef.current = rec;
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  // 음성 녹음 시작 / 종료 토글
  const handleToggleListening = () => {
    if (isListening) {
      // 멈춤 및 발송
      stopListeningAndSend();
    } else {
      // 시작
      startListening();
    }
  };

  const startListening = () => {
    if (!recognitionRef.current) {
      alert('이 브라우저는 음성인식을 지원하지 않습니다. 모바일 Chrome 브라우저를 권장합니다.');
      return;
    }
    try {
      setLiveTranscript('');
      setRecordSeconds(0);
      setIsListening(true);
      recognitionRef.current.start();

      timerRef.current = setInterval(() => {
        setRecordSeconds(prev => prev + 1);
      }, 1000);
    } catch (e) {
      console.warn('STT 기동 실패:', e);
      setIsListening(false);
    }
  };

  const stopListeningAndSend = () => {
    setIsListening(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    setTimeout(() => {
      const text = liveTranscript.trim();
      if (text) {
        handleSendMessage(text);
      }
      setLiveTranscript('');
    }, 400);
  };

  // 메시지 전송 및 GEMS AI 추론
  const handleSendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || isProcessing) return;

    const userMsg: GemsMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsProcessing(true);

    try {
      const res = await sendGemsMessage(messages, trimmed, contextData);

      const modelMsg: GemsMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: res.textResponse,
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        toolCall: res.toolCall
      };

      setMessages(prev => [...prev, modelMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'model',
          text: '처리 중 오류가 발생했습니다. 다시 말씀해주세요.',
          timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  // 🌟 GEMS Tool Call 실행 및 ERP DB 즉시 등록
  const handleExecuteOrder = async (msgId: string, toolCall: { name: string; args: any }) => {
    const { name, args } = toolCall;
    setIsProcessing(true);

    try {
      let orderSummary = '';

      if (name === 'submitDispatchOrder') {
        // 출고의뢰 생성
        const matchedCust = customers.find(c => c.name.includes(args.customerName) || args.customerName.includes(c.name));
        const matchedSite = sites.find(s => s.name.includes(args.siteName) || args.siteName.includes(s.name));

        const orderData = {
          customerId: matchedCust?.id || `TEMP-CUST-${Date.now()}`,
          customerName: args.customerName || matchedCust?.name || '고객사',
          siteId: matchedSite?.id || 'NEW',
          siteName: args.siteName || '현장',
          siteAddress: args.siteAddress || matchedSite?.address || '',
          deliveryDate: args.deliveryDate || contextData.tomorrowYmd,
          deliveryTime: args.deliveryTime || '08:00',
          orders: args.equipments || [{ ft: '19ft', modelName: '1930', count: 1 }],
          memo: `[GEMS 음성출고] ${args.memo || ''}`,
          requesterName: currentUser?.name || '영업담당'
        };

        await saveSmartDispatch(orderData as any, true);
        orderSummary = `[출고의뢰 접수] ${args.customerName} ${args.siteName} (${args.deliveryDate} 08:00)`;
        if (onOrderCreated) onOrderCreated('DISPATCH', orderData);

      } else if (name === 'submitExchangeOrder') {
        // 교환의뢰 생성 (단일 EXCHANGE 배차 1건 발행 - 헌장 2.3)
        const matchedCust = customers.find(c => c.name.includes(args.customerName || '') || (args.customerName || '').includes(c.name));
        const matchedSite = sites.find(s => s.name.includes(args.siteName) || args.siteName.includes(s.name));

        const orderData = {
          customerId: matchedCust?.id || `TEMP-CUST-${Date.now()}`,
          customerName: args.customerName || matchedCust?.name || '고객사',
          siteId: matchedSite?.id || 'NEW',
          siteName: args.siteName || '현장',
          deliveryDate: args.exchangeDate || contextData.tomorrowYmd,
          deliveryTime: args.exchangeTime || '08:00',
          deliveryType: 'EXCHANGE',
          orders: [{ ft: args.newEquipmentFt || '26ft', modelName: args.newEquipmentModel || '2632', count: 1 }],
          memo: `[GEMS 맞교환의뢰] 회수대상:${args.oldAssetNo} ➔ 투입:${args.newEquipmentModel} | 사유:${args.reason || '현장교체'}`,
          requesterName: currentUser?.name || '영업담당'
        };

        await saveSmartDispatch(orderData as any, true);
        orderSummary = `[교환의뢰 접수] ${args.siteName} (회수: ${args.oldAssetNo} ➔ 투입: ${args.newEquipmentModel})`;
        if (onOrderCreated) onOrderCreated('EXCHANGE', orderData);

      } else if (name === 'submitReturnOrder') {
        // 회수의뢰 생성
        const matchedSite = sites.find(s => s.name.includes(args.siteName) || args.siteName.includes(s.name));
        const orderData = {
          customerId: `TEMP-CUST-${Date.now()}`,
          customerName: args.customerName || '고객사',
          siteId: matchedSite?.id || 'NEW',
          siteName: args.siteName,
          deliveryDate: args.returnDate || contextData.tomorrowYmd,
          deliveryTime: args.returnTime || '17:00',
          deliveryType: 'RETURN',
          orders: (args.targetAssetNos || []).map((no: string) => ({ ft: '회수', modelName: no, count: 1 })),
          memo: `[GEMS 회수의뢰] 대상:${(args.targetAssetNos || []).join(', ')} | 사유:${args.reason || '공사종료'}`,
          requesterName: currentUser?.name || '영업담당'
        };

        await saveSmartDispatch(orderData as any, true);
        orderSummary = `[회수의뢰 접수] ${args.siteName} (대상: ${(args.targetAssetNos || []).join(', ')})`;
        if (onOrderCreated) onOrderCreated('RETURN', orderData);

      } else if (name === 'submitFieldAsIntake') {
        // 현장AS 접수
        const asData = {
          assetNo: args.assetNo,
          siteName: args.siteName || '현장',
          issueDescription: `[GEMS 음성접수] ${args.symptom}`,
          details: args.symptom,
          priority: args.priority || 'NORMAL',
          reporterContact: args.reporterContact || '',
          workCategory: 'FIELD_AS' as const,
          source: 'SALES_REQUEST' as const
        };

        await createFieldAsTicket(asData);
        orderSummary = `[현장AS 접수] 장비: ${args.assetNo} (${args.symptom})`;
        if (onOrderCreated) onOrderCreated('FIELD_AS', asData);
      }

      // 메시지에 결과 기록
      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          return {
            ...m,
            toolResult: {
              success: true,
              message: `✅ ERP 등록 완료: ${orderSummary}`
            }
          };
        }
        return m;
      }));

    } catch (err: any) {
      console.error('GEMS 주문 실행 오류:', err);
      showErrorModal(err.message || 'ERP 등록 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const hasApiKey = Boolean(getGeminiApiKey());

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      backgroundColor: 'rgba(2, 6, 23, 0.88)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '12px'
    }}>
      {/* ── 젬스 모달 본체 카드 ── */}
      <div style={{
        width: '100%',
        maxWidth: '440px',
        maxHeight: 'calc(100dvh - 24px)',
        backgroundColor: '#0f172a',
        border: '2px solid #38bdf8',
        borderRadius: '24px',
        boxShadow: '0 25px 50px -12px rgba(2, 132, 199, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* 1. 상단 헤더 */}
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              backgroundColor: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Sparkles size={16} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: '900', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>e-Bro GEMS AI 비서</span>
                <span style={{
                  fontSize: '9.5px',
                  fontWeight: '800',
                  padding: '1.5px 5px',
                  borderRadius: '4px',
                  backgroundColor: hasApiKey ? '#064e3b' : '#1e3a8a',
                  color: hasApiKey ? '#a7f3d0' : '#93c5fd'
                }}>
                  {hasApiKey ? 'Gemini 1.5' : '스마트 룰 엔진'}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>출고·회수·교환·AS 음성 자동완성</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setShowKeyModal(true)}
              title="Gemini API 키 설정"
              style={{
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#cbd5e1',
                padding: '4px 6px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px'
              }}
            >
              <Key size={12} color="#38bdf8" />
              <span>키</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: '#94a3b8',
                padding: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 2. 대화 메시지 타임라인 (말풍선 피드) */}
        <div style={{
          flex: 1,
          minHeight: '220px',
          maxHeight: '380px',
          overflowY: 'auto',
          padding: '12px 14px',
          backgroundColor: '#090d16',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          {messages.map(msg => {
            const isUser = msg.role === 'user';
            const hasTool = Boolean(msg.toolCall);

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  gap: '4px'
                }}
              >
                <div style={{
                  maxWidth: '85%',
                  padding: '9px 12px',
                  borderRadius: isUser ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                  backgroundColor: isUser ? '#0284c7' : '#1e293b',
                  color: '#ffffff',
                  fontSize: '12.5px',
                  lineHeight: 1.45,
                  wordBreak: 'break-all',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  border: isUser ? 'none' : '1px solid #334155'
                }}>
                  {msg.text}
                </div>

                {/* 🌟 완성된 서식 프리뷰 카드 (Function Call 결과) */}
                {hasTool && msg.toolCall && (
                  <div style={{
                    width: '92%',
                    margin: '6px 0',
                    padding: '12px',
                    borderRadius: '14px',
                    backgroundColor: '#0f172a',
                    border: '1.5px solid #38bdf8',
                    boxShadow: '0 4px 16px rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '900',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        backgroundColor: msg.toolCall.name === 'submitDispatchOrder' ? '#0369a1' : msg.toolCall.name === 'submitExchangeOrder' ? '#b45309' : '#15803d',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        {msg.toolCall.name === 'submitDispatchOrder' && <Truck size={12} />}
                        {msg.toolCall.name === 'submitExchangeOrder' && <RefreshCcw size={12} />}
                        {msg.toolCall.name === 'submitReturnOrder' && <ArrowRight size={12} />}
                        {msg.toolCall.name === 'submitFieldAsIntake' && <Wrench size={12} />}
                        <span>
                          {msg.toolCall.name === 'submitDispatchOrder' ? '출고의뢰서' : 
                           msg.toolCall.name === 'submitExchangeOrder' ? '교환(대차)의뢰서' : 
                           msg.toolCall.name === 'submitReturnOrder' ? '회수의뢰서' : '현장AS접수증'}
                        </span>
                      </span>

                      <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>AI 자동검증 완료</span>
                    </div>

                    {/* 카드 본문 상세 내역 */}
                    <div style={{ fontSize: '12px', color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {msg.toolCall.args.customerName && (
                        <div>• 거래처: <strong>{msg.toolCall.args.customerName}</strong></div>
                      )}
                      {msg.toolCall.args.siteName && (
                        <div>• 현장: <strong>{msg.toolCall.args.siteName}</strong> {msg.toolCall.args.siteAddress ? `(${msg.toolCall.args.siteAddress})` : ''}</div>
                      )}
                      {msg.toolCall.args.equipments && (
                        <div>
                          • 요청장비: {msg.toolCall.args.equipments.map((eq: any, i: number) => (
                            <span key={i} style={{ color: '#38bdf8', fontWeight: '800', marginRight: '6px' }}>
                              {eq.ft} ({eq.modelName}) {eq.count}대
                            </span>
                          ))}
                        </div>
                      )}
                      {msg.toolCall.args.oldAssetNo && (
                        <div style={{ color: '#fca5a5' }}>
                          • 회수대상: <strong>{msg.toolCall.args.oldAssetNo}</strong> (교체 후장비: {msg.toolCall.args.newEquipmentModel})
                        </div>
                      )}
                      {msg.toolCall.args.targetAssetNos && (
                        <div style={{ color: '#fca5a5' }}>
                          • 회수자산: <strong>{msg.toolCall.args.targetAssetNos.join(', ')}</strong>
                        </div>
                      )}
                      {msg.toolCall.args.deliveryDate && (
                        <div>• 납품희망: {msg.toolCall.args.deliveryDate} {msg.toolCall.args.deliveryTime || '08:00'}</div>
                      )}
                      {msg.toolCall.args.exchangeDate && (
                        <div>• 교환희망: {msg.toolCall.args.exchangeDate} {msg.toolCall.args.exchangeTime || '08:00'}</div>
                      )}
                      {msg.toolCall.args.siteContactPhone && (
                        <div>• 현장연락: {msg.toolCall.args.siteContactName || '담당자'} ({msg.toolCall.args.siteContactPhone})</div>
                      )}
                      {msg.toolCall.args.memo && (
                        <div style={{ color: '#cbd5e1', fontSize: '11px', marginTop: '2px' }}>• 특이: {msg.toolCall.args.memo}</div>
                      )}
                    </div>

                    {/* 최종 ERP 전송 버튼 또는 완료 메시지 */}
                    {msg.toolResult ? (
                      <div style={{
                        padding: '8px',
                        borderRadius: '8px',
                        backgroundColor: '#064e3b',
                        color: '#a7f3d0',
                        fontSize: '11.5px',
                        fontWeight: '800',
                        textAlign: 'center'
                      }}>
                        {msg.toolResult.message}
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleExecuteOrder(msg.id, msg.toolCall!)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          borderRadius: '10px',
                          border: 'none',
                          backgroundColor: '#0284c7',
                          color: '#ffffff',
                          fontSize: '13px',
                          fontWeight: '900',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)'
                        }}
                      >
                        <CheckCircle2 size={16} />
                        <span>ERP 배차 대장에 즉시 등록</span>
                      </button>
                    )}
                  </div>
                )}

                <span style={{ fontSize: '9px', color: '#64748b' }}>{msg.timestamp}</span>
              </div>
            );
          })}

          {isProcessing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8', fontSize: '11.5px', padding: '6px' }}>
              <RefreshCw size={13} className="animate-spin" />
              <span>GEMS AI가 의뢰 서식을 분석하고 교차 검증 중입니다...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 3. 하단 실시간 음성인식 버블 및 입력 영역 */}
        <div style={{
          padding: '10px 14px 14px',
          backgroundColor: '#0f172a',
          borderTop: '1px solid #1e293b',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {/* 발언 중 실시간 STT 라이브 버블 */}
          {isListening && (
            <div style={{
              padding: '8px 12px',
              borderRadius: '10px',
              backgroundColor: 'rgba(2, 6, 23, 0.95)',
              border: '1.5px solid #38bdf8',
              textAlign: 'center',
              boxShadow: '0 2px 10px rgba(56, 189, 248, 0.4)'
            }}>
              {liveTranscript ? (
                <div style={{ fontSize: '12.5px', color: '#fef08a', fontWeight: '800', wordBreak: 'break-all' }}>
                  💬 "{liveTranscript}"
                </div>
              ) : (
                <span style={{ fontSize: '11.5px', color: '#38bdf8' }}>
                  🎙️ 실시간 음성 듣는 중... (말씀하신 후 버튼을 다시 터치하세요)
                </span>
              )}
            </div>
          )}

          {/* 최하단 인체공학적 가로 와이드 PTT 버튼 */}
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleToggleListening}
            style={{
              width: '100%',
              height: '52px',
              borderRadius: '14px',
              border: isListening ? '2px solid #f87171' : '1.5px solid #38bdf8',
              background: isListening 
                ? 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)' 
                : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              boxShadow: isListening 
                ? '0 0 20px rgba(239, 68, 68, 0.7)' 
                : '0 4px 14px rgba(2, 132, 199, 0.35)',
              transition: 'all 0.15s ease'
            }}
          >
            {isListening ? (
              <>
                <Mic size={20} color="#ffffff" />
                <span style={{ fontSize: '14.5px', fontWeight: '900' }}>
                  🔴 발언 중... ({recordSeconds}초) [터치하여 전송]
                </span>
              </>
            ) : (
              <>
                <Mic size={20} color="#ffffff" />
                <span style={{ fontSize: '14.5px', fontWeight: '800' }}>
                  터치하고 말씀하세요
                </span>
                <span style={{ fontSize: '11px', opacity: 0.85, fontWeight: '500' }}>
                  (완료 시 다시 터치)
                </span>
              </>
            )}
          </button>

          {/* 보조 텍스트 직접 입력바 (소음 환경 대비) */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(inputText); }}
              placeholder="텍스트로도 입력 가능합니다 (예: 탕정 26피트 2대 출고)"
              disabled={isProcessing || isListening}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: '8px',
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: '#ffffff',
                fontSize: '11.5px',
                outline: 'none'
              }}
            />
            <button
              type="button"
              disabled={!inputText.trim() || isProcessing}
              onClick={() => handleSendMessage(inputText)}
              style={{
                padding: '7px 12px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: inputText.trim() ? '#0284c7' : '#334155',
                color: '#ffffff',
                cursor: inputText.trim() ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── API 키 설정 서브 모달 ── */}
      {showKeyModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100000,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '380px',
            backgroundColor: '#0f172a',
            border: '2px solid #334155',
            borderRadius: '16px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: '800', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Key size={14} color="#38bdf8" />
                <span>Google Gemini API Key 설정</span>
              </span>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
              Google AI Studio(aistudio.google.com)에서 발급받은 API 키를 입력하시면 Gemini 1.5 Flash 풀파워로 동작합니다. 미입력 시 내장 스마트 룰 엔진으로 동작합니다.
            </div>

            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: '#ffffff',
                fontSize: '12px',
                outline: 'none'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setGeminiApiKey('');
                  setApiKeyInput('');
                  setShowKeyModal(false);
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  backgroundColor: 'transparent',
                  color: '#94a3b8',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                초기화 (룰 모드)
              </button>
              <button
                type="button"
                onClick={() => {
                  setGeminiApiKey(apiKeyInput);
                  setShowKeyModal(false);
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: '800',
                  cursor: 'pointer'
                }}
              >
                저장 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
