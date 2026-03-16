/**
 * geminiCoach.js — Gemini AI Music Coach
 *
 * Handles all AI interactions:
 *   - Answering voice questions
 *   - Generating exercises
 *   - Analysing played notes and giving feedback
 *
 * Uses the Gemini generateContent REST API (no SDK required in browser).
 */

// Use the same hostname as the current page, but on the backend port (8080)
const BACKEND_URL = `${window.location.protocol}//${window.location.hostname}:8080`;

export class GeminiCoach {
  /** @param {AppState} state */
  constructor(state) {
    this._state      = state;
    this._sessionId  = `session_${Math.random().toString(36).slice(2, 9)}`;
    this._history    = []; // Not strictly needed locally as backend stores it, but kept for state

    /** Callbacks set by main.js */
    this.onMessage   = null; // (text: string) => void
    this.onHighlight = null; // (notes: string[]) => void
    this.onExercise  = null; // (exercise: object) => void

    // Note buffer for feedback
    this._noteBuffer   = [];
    this._feedbackTimer = null;
    this._activeExercise = null;
    this._conversational = false;
    this._apiKey = null;
    this._initialGreeted = false; 

    // Concurrency control: only one message at a time to keep history clean
    this._isSending = false;
    this._queue = [];
  }

  setApiKey(key) {
    this._apiKey = key;
    if (key) {
      console.info('[GeminiCoach] Client-side API key provided for session.');
    }
  }

  setConversational(enabled) {
    this._conversational = enabled;
    if (enabled && !this._initialGreeted) {
      this._initialGreeted = true;
      // Small delay to let the user settle in before the AI starts talking
      setTimeout(() => {
        if (this._conversational) {
          this.sendMessage("EVENT: USER_JUST_ENABLED_CONVERSATIONAL_MODE. Introduce yourself and ask for their name to get started.");
        }
      }, 1500);
    }
  }

  /** Called when the user sends a voice/text message. */
  async sendMessage(userText) {
    // If already sending, queue it up
    if (this._isSending) {
      return new Promise((resolve) => {
        this._queue.push({ text: userText, resolve });
      });
    }

    this._isSending = true;
    try {
      const body = {
        session_id:   this._sessionId,
        user_message: userText,
      };
      if (this._apiKey) body.api_key = this._apiKey;

      const res = await fetch(`${BACKEND_URL}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.detail || `HTTP ${res.status}`;
        this.onMessage?.(`⚠️ AI Error: ${msg}`);
        return;
      }

      const data = await res.json();
      const reply = data.reply;
      
      this.onMessage?.(reply);
      
      // Strip EVERYTHING from the first markdown fence onwards for TTS
      const cleanReply = reply.split('```')[0].trim();
      if (cleanReply) {
        this.onSpeak?.(cleanReply);
      }

      this._parseExercise(reply);
      return reply;
    } catch (err) {
      console.error('[GeminiCoach] Network/Proxy error:', err);
      this.onMessage?.('⚠️ Connectivity error. Is the backend running?');
    } finally {
      this._isSending = false;
      // Process next in queue
      if (this._queue.length > 0) {
        const next = this._queue.shift();
        this.sendMessage(next.text).then(next.resolve);
      }
    }
  }

  /** Called every time a note is detected. */
  onNotePlayed(note, correct = null) {
    if (this._conversational) {
      // In conversational mode, we send more immediate "hint" events to the AI
      // but we throttle them to avoid overwhelming the API
      this._noteBuffer.push(note);
      clearTimeout(this._feedbackTimer);

      this._feedbackTimer = setTimeout(() => {
        const notes = this._noteBuffer.join(', ');
        this._noteBuffer = [];
        if (correct === false) {
          this.sendMessage(`EVENT: USER_PLAYED_WRONG_NOTES [${notes}]. They should have played the next note in exercise.`);
        } else if (correct === true) {
          this.sendMessage(`EVENT: USER_PLAYED_CORRECT_NOTES [${notes}]. Encourage them!`);
        } else {
          // General play feedback
          this.sendMessage(`EVENT: USER_PLAYED_NOTES [${notes}]. Just give a quick comment if relevant.`);
        }
      }, 1500);
    } else {
      // Legacy behavior for manual mode
      this._noteBuffer.push(note);
      clearTimeout(this._feedbackTimer);
      this._feedbackTimer = setTimeout(() => {
        if (this._activeExercise && this._noteBuffer.length > 0) {
          this._sendFeedback();
        }
        this._noteBuffer = [];
      }, 2500);
    }
  }

  /** Called periodically with posture analysis */
  onPostureAnalysis(msg) {
    if (this._conversational) {
      this.sendMessage(`EVENT: POSTURE_HINT: ${msg}`);
    }
  }

  /** Called when the user selects an exercise. */
  startExercise(exercise) {
    this._activeExercise = exercise;
    this._noteBuffer     = [];
    const msg = `Let's practice **${exercise.name}**. ${exercise.description ?? ''} Ready? Go! 🎹`;
    this.onMessage?.(msg);
    this.onSpeak?.(msg);
    this.onHighlight?.(exercise.notes);
  }

  // ── Private ────────────────────────────────────────────

  async _sendFeedback() {
    try {
      const body = {
        session_id:     this._sessionId,
        exercise:       this._activeExercise.name,
        expected_notes: this._activeExercise.notes,
        played_notes:   this._noteBuffer,
      };
      if (this._apiKey) body.api_key = this._apiKey;

      const res = await fetch(`${BACKEND_URL}/feedback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      this.onMessage?.(data.feedback);
      this.onSpeak?.(data.feedback);
    } catch (err) {
      console.warn('[GeminiCoach] feedback error:', err);
    }
  }

  /** Extract a JSON exercise block from the model reply. */
  _parseExercise(text) {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!match) return;

    try {
      const ex = JSON.parse(match[1]);
      if (ex.notes && Array.isArray(ex.notes)) {
        this.onExercise?.({
          name:        ex.exercise_name ?? 'Exercise',
          notes:       ex.notes,
          description: ex.description ?? '',
        });
      }
    } catch (_) { /* not valid JSON — ignore */ }
  }
}
