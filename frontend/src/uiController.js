/**
 * uiController.js — UI Controller
 *
 * Manages all DOM interactions:
 *   - Loading screen
 *   - Tab switching
 *   - Chat messages
 *   - Voice button state
 *   - Stats sync
 *   - Modal open/close
 *   - Exercise list population
 *   - Custom event emitter for app-level events
 */

const EXERCISES = [
  {
    name:        'C Major Scale',
    difficulty:  'Beginner',
    notes:       ['C4','D4','E4','F4','G4','A4','B4','C5'],
    description: 'The foundation of all music. Play each note evenly.',
  },
  {
    name:        'A Minor Scale (Natural)',
    difficulty:  'Beginner',
    notes:       ['A3','B3','C4','D4','E4','F4','G4','A4'],
    description: 'Relative minor of C Major. No sharps or flats.',
  },
  {
    name:        'D Major Scale',
    difficulty:  'Intermediate',
    notes:       ['D4','E4','F#4','G4','A4','B4','C#5','D5'],
    description: 'Two sharps (F# and C#). Feel the bright, triumphant sound.',
  },
  {
    name:        'B Minor Scale (Natural)',
    difficulty:  'Intermediate',
    notes:       ['B3','C#4','D4','E4','F#4','G4','A4','B4'],
    description: 'Relative minor of D Major. Shares the same two sharps.',
  },
  {
    name:        'G Major Scale',
    difficulty:  'Beginner',
    notes:       ['G4','A4','B4','C5','D5','E5','F#5','G5'],
    description: 'One sharp (F#). Watch your pinky on F#.',
  },
  {
    name:        'C Major Chord',
    difficulty:  'Beginner',
    notes:       ['C4','E4','G4'],
    description: 'Press all three keys simultaneously.',
  },
  {
    name:        'Blues Scale (C)',
    difficulty:  'Intermediate',
    notes:       ['C4','Eb4','F4','F#4','G4','Bb4','C5'],
    description: 'The classic blues sound. Feel the groove!',
  },
  {
    name:        'Jazz Warmup',
    difficulty:  'Intermediate',
    notes:       ['C4','E4','G4','Bb4','C5'],
    description: 'Dominant 7th arpeggio — the jazz sound.',
  },
];

export class UIController {
  constructor() {
    this._handlers = {};
    this._initElements();
    this._bindEvents();
    this._populateExercises();
    this._populateCameras();
  }

  // ── Loading ─────────────────────────────────────────────

  setLoadingStatus(text, pct) {
    document.getElementById('loading-status').textContent   = text;
    document.getElementById('loading-bar-fill').style.width = `${pct}%`;
  }

  showApp() {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }

  // ── FPS ─────────────────────────────────────────────────

  updateFPS(fps) {
    document.getElementById('fps-counter').textContent = `${fps} FPS`;
  }

  // ── Chat ────────────────────────────────────────────────

  addCoachMessage(text) {
    this._appendMessage(text, 'ai');
    this._showCoachBubble(text);
  }

  addUserMessage(text) {
    this._appendMessage(text, 'user');
  }

  // ── Note flash ──────────────────────────────────────────

  flashNote(note) {
    const el = document.getElementById('note-display');
    el.textContent = note;
    el.style.color = 'var(--c-accent)';
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => {
      el.textContent = '--';
      el.style.color = 'var(--c-primary-h)';
    }, 600);
  }

  // ── Voice state ─────────────────────────────────────────

  // ── ML status ───────────────────────────────────────────

  /**
   * @param {'idle'|'collecting'|'training'|'ready'|'error'} status
   * @param {string} [log] — short message shown in the log line
   */
  setMLStatus(status, log = '') {
    const badge = document.getElementById('ml-status-badge');
    const logEl = document.getElementById('ml-training-log');
    if (!badge) return;
    const map = {
      idle:       { emoji: '⚪', text: 'Not trained',  color: '#aaa' },
      collecting: { emoji: '🔴', text: 'Collecting…',  color: '#ff6b6b' },
      training:   { emoji: '🟡', text: 'Training…',    color: '#ffd93d' },
      ready:      { emoji: '🟢', text: 'Model ready',  color: '#6bcb77' },
      error:      { emoji: '🔴', text: 'Error',        color: '#ff6b6b' },
    };
    const s = map[status] ?? map.idle;
    badge.textContent = `${s.emoji} ${s.text}`;
    badge.style.color = s.color;
    if (logEl && log) logEl.textContent = log;
  }

  setVoiceState(listening) {
    const btn   = document.getElementById('voice-btn');
    const label = document.getElementById('voice-btn-label');
    const mic   = document.getElementById('mic-icon');
    const pulse = document.getElementById('listening-indicator');

    if (listening) {
      btn.classList.add('listening');
      label.textContent = 'Listening…';
      mic.textContent   = '🔴';
      pulse?.classList.remove('hidden');
    } else {
      btn.classList.remove('listening');
      label.textContent = 'Hold to speak';
      mic.textContent   = '🎤';
      pulse?.classList.add('hidden');
    }
  }

  // ── Stats sync ──────────────────────────────────────────

  syncStats(state) {
    document.getElementById('stat-notes-played').textContent =
      state.notesPlayed;
    document.getElementById('stat-accuracy').textContent =
      state.accuracy !== null ? `${state.accuracy}%` : '--%';
    document.getElementById('stat-exercises').textContent =
      state.exercisesDone;
    document.getElementById('stat-streak').textContent =
      `${state.currentStreak}🔥`;

    // Recent notes
    const hist = document.getElementById('notes-history');
    hist.innerHTML = '';
    state.notesHistory.slice(-10).reverse().forEach((n) => {
      const chip  = document.createElement('span');
      chip.className = 'history-note';
      chip.textContent = n;
      hist.appendChild(chip);
    });
  }

  // ── Exercise progress ────────────────────────────────────

  startExerciseProgress(exercise) {
    const container = document.getElementById('exercise-progress-container');
    container.style.display = 'flex';
    document.getElementById('exercise-progress-label').textContent =
      exercise.name;
    document.getElementById('exercise-progress-fill').style.width = '0%';
  }

  setExerciseProgress(pct) {
    document.getElementById('exercise-progress-fill').style.width = `${pct}%`;
  }

  // ── Custom events ────────────────────────────────────────

  on(event, handler) {
    this._handlers[event] = handler;
  }

  emit(event, payload) {
    this._handlers[event]?.(payload);
  }

  // ── Private ──────────────────────────────────────────────

  _initElements() {
    this.els = {
      loadingScreen:  document.getElementById('loading-screen'),
      loadingBar:     document.getElementById('loading-bar-fill'),
      loadingStatus:  document.getElementById('loading-status'),
      app:            document.getElementById('app'), // Changed from app-container
      coachBubble:    document.getElementById('coach-bubble'),
      coachText:      document.getElementById('coach-message'), // Changed from coach-text
      chatArea:       document.getElementById('chat-area'),
      noteDisplay:    document.getElementById('note-display'),
      fpsCounter:     document.getElementById('fps-counter'),
      
      // Settings
      settingsModal:  document.getElementById('settings-modal'),
      saveSettingsBtn:document.getElementById('save-settings-btn'),
      apiKeyInput:    document.getElementById('api-key-input'),
      octaveSelect:   document.getElementById('octave-select'),
      volumeSlider:   document.getElementById('volume-slider'),
      detectionMode:  document.getElementById('detection-mode-select'),
      flipPiano:      document.getElementById('flip-piano-checkbox'),
      hideBlackKeys:  document.getElementById('hide-black-keys-checkbox'),
      highlightHover: document.getElementById('highlight-hover-checkbox'),
      keyRangeInput:  document.getElementById('key-range-input'),
      
      // Footer & Toolbar
      stopBtn:        document.getElementById('stop-btn'),
      calibrateBtn:   document.getElementById('calibrate-btn'),
      trainAiBtn:     document.getElementById('train-ai-btn'),
      settingsTrainBtn: document.getElementById('settings-train-btn'),

      // Dimension Sliders
      whiteKeyWidth:  document.getElementById('white-key-width-slider'),
      whiteKeyHeight: document.getElementById('white-key-height-slider'),
      blackKeyWidth:  document.getElementById('black-key-width-slider'),
      blackKeyHeight: document.getElementById('black-key-height-slider'),
      
      whiteKeyWidthVal:  document.getElementById('white-key-width-value'),
      whiteKeyHeightVal: document.getElementById('white-key-height-value'),
      blackKeyWidthVal:  document.getElementById('black-key-width-value'),
      blackKeyHeightVal: document.getElementById('black-key-height-value'),
      
      // Training HUD
      trainingHud:    document.getElementById('training-hud'),
      trainingTarget: document.getElementById('training-target'),
      trainingDots:   document.getElementById('training-dots'),
      
      // Exercise
      exerciseProgress: document.getElementById('exercise-progress-container'),
      exerciseLabel:    document.getElementById('exercise-progress-label'),
      exerciseFill:     document.getElementById('exercise-progress-fill'),
    };

    // Aliases 
    this._chatArea = this.els.chatArea;
    this._coachBubble = this.els.coachBubble;
    this._coachMsg = this.els.coachText; 
  }

  _bindEvents() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach((b) =>
          b.classList.toggle('active', b.dataset.tab === tab)
        );
        document.querySelectorAll('.tab-content').forEach((c) =>
          c.classList.toggle('hidden', c.id !== `tab-content-${tab}`)
        );
      });
    });

    // Voice button — hold to speak
    const voiceBtn = document.getElementById('voice-btn');
    const startVoice = () => { this.setVoiceState(true); this.emit('voice-start'); };
    const stopVoice  = () => { this.setVoiceState(false); this.emit('voice-stop'); };
    voiceBtn.addEventListener('mousedown',  startVoice);
    voiceBtn.addEventListener('touchstart', startVoice, { passive: true });
    voiceBtn.addEventListener('mouseup',    stopVoice);
    voiceBtn.addEventListener('touchend',   stopVoice);
    voiceBtn.addEventListener('mouseleave', stopVoice);

    // Conversational toggle
    const convToggle = document.getElementById('conversational-toggle');
    convToggle.addEventListener('change', () => {
      this.emit('conversational-toggle', convToggle.checked);
    });

    // Calibrate
    this.els.calibrateBtn.addEventListener('click', () =>
      this.emit('calibrate')
    );

    // Stop
    this.els.stopBtn.addEventListener('click', () =>
      this.emit('stop')
    );

    // Settings modal
    document.getElementById('settings-btn').addEventListener('click', () =>
      this.els.settingsModal.classList.remove('hidden')
    );
    document.getElementById('close-settings-btn').addEventListener('click', () =>
      this.els.settingsModal.classList.add('hidden')
    );
    this.els.settingsModal.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });

    // Save settings
    this.els.saveSettingsBtn.addEventListener('click', () => {
      const settings = {
        apiKey:  this.els.apiKeyInput.value.trim(),
        octave:  Number(this.els.octaveSelect.value),
        volume:  Number(this.els.volumeSlider.value) / 100,
        detectionMode: this.els.detectionMode.value,
        flipPiano: this.els.flipPiano.checked,
        hideBlackKeys: this.els.hideBlackKeys.checked,
        highlightHover: this.els.highlightHover.checked,
        
        // Dimensions
        whiteKeyWidthScale:  this.els.whiteKeyWidth  ? parseFloat(this.els.whiteKeyWidth.value)  : 1.0,
        whiteKeyHeightScale: this.els.whiteKeyHeight ? parseFloat(this.els.whiteKeyHeight.value) : 1.0,
        blackKeyWidthScale:  this.els.blackKeyWidth  ? parseFloat(this.els.blackKeyWidth.value)  : 0.55,
        blackKeyHeightScale: this.els.blackKeyHeight ? parseFloat(this.els.blackKeyHeight.value) : 0.4,
      };

      this.emit('save-settings', settings);
      
      // Persist everything
      localStorage.setItem('piano_settings', JSON.stringify(settings));

      this._updateTrainingButtonVisibility();
      this.els.settingsModal.classList.add('hidden');
    });

    // Train AI Model button
    if (this.els.trainAiBtn) {
      this.els.trainAiBtn.onclick = () => this.emit('train-model');
    }
    if (this.els.settingsTrainBtn) {
      this.els.settingsTrainBtn.onclick = () => {
        this.els.settingsModal.classList.add('hidden');
        this.emit('train-model');
      };
    }

    // Restore settings from storage
    this._restoreSettings();

    // Dimension slider labels
    const bindDim = (el, valEl) => {
      if (!el || !valEl) return;
      el.addEventListener('input', () => {
        valEl.textContent = `${el.value}x`;
      });
    };
    bindDim(this.els.whiteKeyWidth,  this.els.whiteKeyWidthVal);
    bindDim(this.els.whiteKeyHeight, this.els.whiteKeyHeightVal);
    bindDim(this.els.blackKeyWidth,  this.els.blackKeyWidthVal);
    bindDim(this.els.blackKeyHeight, this.els.blackKeyHeightVal);
  }

  _restoreSettings() {
    const raw = localStorage.getItem('piano_settings');
    if (!raw) return;

    try {
      const s = JSON.parse(raw);
      if (s.apiKey) this.els.apiKeyInput.value = s.apiKey;
      if (s.octave) this.els.octaveSelect.value = s.octave;
      if (s.volume !== undefined) this.els.volumeSlider.value = s.volume * 100;
      if (s.detectionMode) this.els.detectionMode.value = s.detectionMode;
      if (s.flipPiano !== undefined) this.els.flipPiano.checked = s.flipPiano;
      if (s.hideBlackKeys !== undefined) this.els.hideBlackKeys.checked = s.hideBlackKeys;
      if (s.highlightHover !== undefined) this.els.highlightHover.checked = s.highlightHover;
      if (s.keyRange) this.els.keyRangeInput.value = s.keyRange;

      if (s.whiteKeyWidthScale) this.els.whiteKeyWidth.value = s.whiteKeyWidthScale;
      if (s.whiteKeyHeightScale) this.els.whiteKeyHeight.value = s.whiteKeyHeightScale;
      if (s.blackKeyWidthScale) this.els.blackKeyWidth.value = s.blackKeyWidthScale;
      if (s.blackKeyHeightScale) this.els.blackKeyHeight.value = s.blackKeyHeightScale;

      // Update labels
      if (this.els.whiteKeyWidthVal) this.els.whiteKeyWidthVal.textContent = `${s.whiteKeyWidthScale}x`;
      if (this.els.whiteKeyHeightVal) this.els.whiteKeyHeightVal.textContent = `${s.whiteKeyHeightScale}x`;
      if (this.els.blackKeyWidthVal) this.els.blackKeyWidthVal.textContent = `${s.blackKeyWidthScale}x`;
      if (this.els.blackKeyHeightVal) this.els.blackKeyHeightVal.textContent = `${s.blackKeyHeightScale}x`;

      this._updateTrainingButtonVisibility();
    } catch (e) {
      console.error('[UIController] Failed to restore settings:', e);
    }
  }

  /** Gets current settings for initial app sync */
  getSettings() {
    return {
      apiKey:  this.els.apiKeyInput.value.trim(),
      octave:  Number(this.els.octaveSelect.value),
      volume:  Number(this.els.volumeSlider.value) / 100,
      detectionMode: this.els.detectionMode.value,
      flipPiano: this.els.flipPiano.checked,
      hideBlackKeys: this.els.hideBlackKeys.checked,
      highlightHover: this.els.highlightHover.checked,
      whiteKeyWidthScale:  parseFloat(this.els.whiteKeyWidth.value),
      whiteKeyHeightScale: parseFloat(this.els.whiteKeyHeight.value),
      blackKeyWidthScale:  parseFloat(this.els.blackKeyWidth.value),
      blackKeyHeightScale: parseFloat(this.els.blackKeyHeight.value),
      keyRange: this.els.keyRangeInput.value.trim() || 'C4-B4',
    };
  }

  /**
   * Sets the training target note in the HUD
   * @param {string} note 
   * @param {number} currentCount 
   * @param {number} totalRequired 
   */
  setTrainingTarget(note, currentCount, totalRequired) {
    if (!this.els.trainingHud) return;
    this.els.trainingHud.classList.remove('hidden');
    this.els.trainingTarget.textContent = `Please press ${note}`;
    
    // Update dots
    this.els.trainingDots.innerHTML = '';
    for (let i = 0; i < totalRequired; i++) {
      const dot = document.createElement('div');
      dot.className = 'training-dot' + (i < currentCount ? ' active' : '');
      this.els.trainingDots.appendChild(dot);
    }
  }

  hideTrainingHUD() {
    if (this.els.trainingHud) this.els.trainingHud.classList.add('hidden');
  }

  _updateTrainingButtonVisibility() {
    const val = this.els.detectionMode.value;
    console.log('[uiController] Updating visibility for method:', val);
    
    const isML = (val === 'surface_mlp' || val === 'surface_lstm' || val === 'surface_ai_v12');
    
    if (this.els.trainAiBtn) {
      if (isML) this.els.trainAiBtn.classList.remove('hidden');
      else this.els.trainAiBtn.classList.add('hidden');
    }
    
    if (this.els.settingsTrainBtn) {
      if (isML) this.els.settingsTrainBtn.classList.remove('hidden');
      else this.els.settingsTrainBtn.classList.add('hidden');
    }
  }

  _populateExercises() {
    const list = document.getElementById('exercise-list');
    EXERCISES.forEach((ex) => {
      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.innerHTML = `
        <div class="exercise-name">${ex.name}</div>
        <div class="exercise-meta">${ex.difficulty} · ${ex.notes.length} notes</div>
        <div class="exercise-notes">
          ${ex.notes.map((n) => `<span class="note-chip">${n}</span>`).join('')}
        </div>
      `;
      card.addEventListener('click', () => {
        document.querySelectorAll('.exercise-card').forEach((c) =>
          c.classList.remove('active')
        );
        card.classList.add('active');
        this.emit('exercise-select', ex);
      });
      list.appendChild(card);
    });
  }

  async _populateCameras() {
    try {
      const cameras = await window.__cameraList ?? [];
      const sel     = document.getElementById('camera-select');
      cameras.forEach((cam) => {
        const opt = document.createElement('option');
        opt.value       = cam.deviceId;
        opt.textContent = cam.label || `Camera ${sel.options.length + 1}`;
        sel.appendChild(opt);
      });
    } catch (_) { /* ignore */ }
  }

  _appendMessage(text, role) {
    const msg   = document.createElement('div');
    msg.className = `chat-message ${role}`;
    msg.innerHTML = `
      ${role === 'ai' ? '<span class="chat-icon">🎹</span>' : ''}
      <p>${this._mdToHtml(text)}</p>
      ${role === 'user' ? '<span class="chat-icon">🧑</span>' : ''}
    `;
    this._chatArea.appendChild(msg);
    this._chatArea.scrollTop = this._chatArea.scrollHeight;
  }

  _showCoachBubble(text) {
    this._coachMsg.textContent = text.slice(0, 120) + (text.length > 120 ? '…' : '');
    this._coachBubble.classList.remove('hidden');
    clearTimeout(this._bubbleTimer);
    this._bubbleTimer = setTimeout(() => {
      this._coachBubble.classList.add('hidden');
    }, 6000);
  }

  /** Very minimal md → html for bold and italic. */
  _mdToHtml(text) {
    return text
      .replace(/```[\s\S]*?```/g, '') // strip code blocks
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/\n/g,            '<br>');
  }
}
