// src/services/ttsService.ts
// 브라우저 Web Speech Synthesis 기반 한국어 음성 안내 서비스

class TtsService {
  private isEnabled: boolean = false;
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private listeners: ((enabled: boolean) => void)[] = [];

  constructor() {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        this.synth = window.speechSynthesis;
        const saved = localStorage.getItem('voice_wizard_tts_enabled');
        this.isEnabled = saved === 'true'; // 기본값은 false (무음/화면 텍스트 기본)
        this.initVoice();
        if (this.synth.onvoiceschanged !== undefined) {
          this.synth.onvoiceschanged = () => this.initVoice();
        }
      }
    } catch (e) {
      console.warn('TTS initialization failed:', e);
    }
  }

  private initVoice() {
    if (!this.synth) return;
    try {
      const voices = this.synth.getVoices();
      // 한국어 음성 우선 선택 (Google 한국어, Apple Yuna 등)
      const koVoice = voices.find(v => v.lang === 'ko-KR' || v.lang.startsWith('ko'));
      if (koVoice) {
        this.selectedVoice = koVoice;
      }
    } catch {
      // ignore
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public setIsEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    try {
      localStorage.setItem('voice_wizard_tts_enabled', String(enabled));
    } catch {}
    if (!enabled) {
      this.stop();
    }
    this.listeners.forEach(l => l(enabled));
  }

  public toggle(): boolean {
    const next = !this.isEnabled;
    this.setIsEnabled(next);
    return next;
  }

  public onEnabledChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public speak(text: string, onEnd?: () => void): void {
    if (!this.isEnabled || !this.synth) {
      if (onEnd) onEnd();
      return;
    }

    try {
      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = 1.05; // 약간 경쾌한 속도
      utterance.pitch = 1.0;
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
      }

      utterance.onend = () => {
        this.currentUtterance = null;
        if (onEnd) onEnd();
      };

      utterance.onerror = () => {
        this.currentUtterance = null;
        if (onEnd) onEnd();
      };

      this.currentUtterance = utterance;
      this.synth.speak(utterance);
    } catch (err) {
      console.warn('TTS speak error:', err);
      if (onEnd) onEnd();
    }
  }

  public stop(): void {
    if (!this.synth) return;
    try {
      if (this.synth.speaking || this.synth.pending) {
        this.synth.cancel();
      }
      this.currentUtterance = null;
    } catch {}
  }
}

export const ttsService = new TtsService();