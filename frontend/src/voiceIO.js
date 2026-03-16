/**
 * voiceIO.js — Web Speech API wrapper
 *
 * Handles speech recognition (input) and speech synthesis (output).
 * Bridges the user's voice to GeminiCoach and reads AI replies aloud.
 */

export class VoiceIO {
  /**
   * @param {GeminiCoach}  coach
   * @param {UIController} ui
   */
  constructor(coach, ui) {
    this._coach = coach;
    this._ui    = ui;

    this._recognition = null;
    this._synthesis   = window.speechSynthesis;
    this._listening   = false;
    this._conversational = false; 

    this._initRecognition();
    this._initVoices();
  }

  _initVoices() {
    // Some browsers load voices asynchronously
    const loadVoices = () => {
      const voices = this._synthesis.getVoices();
      if (voices.length > 0) {
        console.log(`[VoiceIO] ${voices.length} voices loaded.`);
      }
    };

    loadVoices();
    if (this._synthesis.onvoiceschanged !== undefined) {
      this._synthesis.onvoiceschanged = () => {
        console.log('[VoiceIO] Voices updated via event');
        loadVoices();
      };
    }
  }

  setConversational(enabled) {
    this._conversational = enabled;
    if (enabled) {
      this.startListening();
    } else {
      this.stopListening();
    }
  }

  startListening() {
    if (this._listening || !this._recognition) return;
    try {
      this._recognition.start();
      this._listening = true;
    } catch (e) {
      console.warn('[VoiceIO] Recognition already started or error:', e);
    }
  }

  stopListening() {
    if (!this._listening || !this._recognition) return;
    this._recognition.stop();
    this._listening = false;
  }

  /**
   * Speak a text string aloud.
   * @param {string} text
   */
  async speak(text) {
    if (!this._synthesis) return;
    
    // If in conversational mode, pause recognition so it doesn't hear itself
    const wasListening = this._listening;
    if (this._conversational) this.stopListening();

    this._synthesis.cancel(); // stop any ongoing speech
    
    // Essential: Small delay after cancel() for some browsers (Chrome/Linux/Android)
    await new Promise(r => setTimeout(r, 50));

    // Strip markdown for TTS
    const clean = text.replace(/[*_`#[\]()]/g, '').replace(/```[\s\S]*?```/g, '');
    if (!clean.trim()) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    
    // Pick a natural-sounding voice if available
    let voices = this._synthesis.getVoices();
    
    // Retry once if list is empty (can happen on first interaction in some browsers)
    if (voices.length === 0) {
      console.warn('[VoiceIO] No voices found, retrying getVoices...');
      await new Promise(r => setTimeout(r, 100));
      voices = this._synthesis.getVoices();
    }

    // Prefer higher quality Google or natural voices if available
    let voice = voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Premium')));
    if (!voice) voice = voices.find((v) => v.lang.startsWith('en') && v.localService);
    if (!voice) voice = voices.find((v) => v.lang.startsWith('en'));
    
    if (voice) utterance.voice = voice;
    utterance.rate   = 0.95; // Calmer pace
    utterance.pitch  = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
       console.log('[VoiceIO] Speaking:', clean);
    };

    utterance.onend = () => {
      // Resume listening if we were in conversational mode
      if (this._conversational) {
        // Wait 800ms before reopening mic for a more natural turn-taking feel
        setTimeout(() => this.startListening(), 800);
      }
    };

    utterance.onerror = (e) => {
      console.error('[VoiceIO] Utterance error:', e);
    };

    this._synthesis.speak(utterance);
  }

  // ── Private ────────────────────────────────────────────

  _initRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[VoiceIO] SpeechRecognition not supported in this browser');
      return;
    }

    this._recognition = new SpeechRecognition();
    this._recognition.lang        = 'en-US';
    this._recognition.interimResults = false;
    this._recognition.maxAlternatives = 1;
    this._recognition.continuous  = false; // We use onend loop for better reliability than native continuous

    this._recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      console.info('[VoiceIO] Heard:', transcript);
      this._ui.addUserMessage(transcript);
      // sendMessage already triggers the 'onSpeak' callback which calls this.speak()
      // so we should not call speak() manually here to avoid double-triggering.
      this._coach.sendMessage(transcript);
    };

    this._recognition.onend = () => {
      this._listening = false;
      this._ui.setVoiceState(this._conversational);
      // Continuous loop if conversational mode is on
      if (this._conversational) {
        setTimeout(() => {
          if (this._conversational && !this._synthesis.speaking) {
            this.startListening();
          }
        }, 100);
      }
    };

    this._recognition.onerror = (event) => {
      if (event.error === 'no-speech' && this._conversational) return;
      console.warn('[VoiceIO] Recognition error:', event.error);
      this._listening = false;
      this._ui.setVoiceState(false);
    };

    // Coach replies → TTS (if not already handled by sendMessage)
    this._coach.onSpeak = (msg) => {
      this.speak(msg);
    };
  }
}
