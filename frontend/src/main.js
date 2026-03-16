/**
 * main.js — App Entry Point
 *
 * Boots all subsystems in order and wires them together.
 * `boot()` is exported so index.html can call it on user gesture,
 * which is required for camera, microphone, and AudioContext access.
 */

import { CameraManager }  from './camera.js';
import { HandTracker }    from './handTracker.js';
import { PianoOverlay }   from './pianoOverlay.js';
import { SoundEngine }    from './soundEngine.js';
import { GeminiCoach }    from './geminiCoach.js';
import { VoiceIO }        from './voiceIO.js';
import { UIController }   from './uiController.js';
import { AppState }       from './state.js';

const OCTAVE_DEFAULT = 4;

/* ─────────────────────────────────────────────────────
   boot()  — called on user click from index.html
   All errors propagate up so index.html can show them.
───────────────────────────────────────────────────── */
export async function boot() {
  // Prevent multiple boots
  if (window.__appBooted) {
    console.warn('[boot] App already initialized. Reload to reset.');
    return;
  }
  window.__appBooted = true;

  const ui    = new UIController();
  const state = new AppState();

  // ── 1. Camera ────────────────────────────────────────
  ui.setLoadingStatus('Requesting camera…', 10);
  const camera = new CameraManager(document.getElementById('camera-feed'));
  await camera.start();   // throws → caught by index.html

  // ── 2. Hand tracker ──────────────────────────────────
  ui.setLoadingStatus('Loading hand tracker…', 30);

  // Guard: MediaPipe Hands must be loaded from CDN first
  if (typeof Hands === 'undefined') {
    throw new Error(
      'MediaPipe Hands not found. Check your internet connection and reload.'
    );
  }

  const tracker = new HandTracker(
    document.getElementById('landmark-canvas'),
    camera.videoElement
  );
  await tracker.init();

  // ── 3. Piano overlay ─────────────────────────────────
  ui.setLoadingStatus('Building piano overlay…', 55);
  const piano = new PianoOverlay(
    document.getElementById('piano-canvas'),
    OCTAVE_DEFAULT
  );
  piano.init();
  
  // Connect ROI to tracker for filtering unintentional fingers
  tracker.setROI(piano._region);

  // ── 4. Sound engine ──────────────────────────────────
  ui.setLoadingStatus('Loading sound engine…', 70);

  // Guard: Tone.js must be loaded from CDN first
  if (typeof Tone === 'undefined') {
    throw new Error(
      'Tone.js not found. Check your internet connection and reload.'
    );
  }

  const sound = new SoundEngine();
  await sound.init();

  // ── 5. AI coach + voice ──────────────────────────────
  ui.setLoadingStatus('Setting up AI coach…', 85);
  const coach = new GeminiCoach(state);
  
  // Sync saved credentials immediately
  const savedKey = localStorage.getItem('gemini_api_key');
  if (savedKey) coach.setApiKey(savedKey);

  const voice = new VoiceIO(coach, ui);   // eslint-disable-line no-unused-vars

  // ── 6. Show app ──────────────────────────────────────
  ui.setLoadingStatus('Ready! 🎹', 100);
  await new Promise((r) => setTimeout(r, 500));
  ui.showApp();
  
  // ── 7. Initial Settings Sync ──────────────────────────
  const initialSettings = ui.getSettings();
  coach.setApiKey(initialSettings.apiKey);
  piano.setOctave(initialSettings.octave);
  sound.setVolume(initialSettings.volume);
  if (initialSettings.detectionMode) piano.setDetectionMode(initialSettings.detectionMode);
  if (initialSettings.flipPiano !== undefined) piano.setFlip(initialSettings.flipPiano);
  if (initialSettings.hideBlackKeys !== undefined) piano.setHideBlackKeys(initialSettings.hideBlackKeys);
  if (initialSettings.highlightHover !== undefined) piano.setHighlightHover(initialSettings.highlightHover);
  if (initialSettings.keyRange) piano.setKeyRange(initialSettings.keyRange);

  piano.setDimensions({
    whiteKeyWidthScale:  initialSettings.whiteKeyWidthScale,
    whiteKeyHeightScale: initialSettings.whiteKeyHeightScale,
    blackKeyWidthScale:  initialSettings.blackKeyWidthScale,
    blackKeyHeightScale: initialSettings.blackKeyHeightScale
  });

  // ── Wire: hand tracker → everything ─────────────────
  let calibrationFrames = [];
  let calibrationActive = false;
  let calibrationStartTime = 0;
  let lastPostureHintTime = 0;

  tracker.onResults = (results) => {
    const landmarks = results.multiHandLandmarks ?? [];
    
    // Surface Calibration Logic
    if (calibrationActive) {
      if (Date.now() - calibrationStartTime > 2000) {
        calibrationActive = false;
        if (calibrationFrames.length > 5) {
          const avgY = calibrationFrames.reduce((a, b) => a + b, 0) / calibrationFrames.length;
          // Apply a margin: +0.02 (approx 15px) so the user has to push "into" the plane slightly.
          // This avoids hover triggers.
          // AI v1 3D Plane Calibration
          if (results.multiHandWorldLandmarks) {
            piano.calibratePlane(results.multiHandWorldLandmarks);
          }

          ui.addCoachMessage("Surface calibrated! I've set the thresholds.");
        } else {
          ui.addCoachMessage("Calibration failed. Please make sure your hand is visible.");
        }
      } else if (landmarks.length > 0) {
        // Collect average Y of all 5 fingertips in this frame
        const hand = landmarks[0];
        const tipsY = [4, 8, 12, 16, 20].map(id => hand[id]?.y).filter(y => y !== undefined);
        if (tipsY.length > 0) {
          const frameAvg = tipsY.reduce((a, b) => a + b, 0) / tipsY.length;
          calibrationFrames.push(frameAvg);
        }
      }
    }

    piano.updateFingers(landmarks);

    const { hits, releases } = piano.detectHits(landmarks, results.multiHandWorldLandmarks);
    hits.forEach((hit) => {
      sound.noteOn(hit.note, hit.velocity);
      const result = state.recordNote(hit.note);
      ui.flashNote(hit.note);
      coach.onNotePlayed(result.note, result.correct);
    });

    releases.forEach((note) => {
      sound.noteOff(note);
    });

    // Vision-based Posture Analysis (throttled: max once every 60 seconds)
    const now = Date.now();
    if (landmarks.length > 0 && (now - lastPostureHintTime > 60000) && coach._conversational) {
      lastPostureHintTime = now;
      
      // Capture a frame from the video feed
      const video = camera.videoElement;
      if (video && video.videoWidth > 0) {
        const offCanvas = document.createElement('canvas');
        // Scale down to save bandwidth and stay under token limits
        offCanvas.width  = 320; 
        offCanvas.height = 240;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(video, 0, 0, offCanvas.width, offCanvas.height);
        
        // Quality 0.5 is enough for posture check
        const b64 = offCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];
        coach.onPostureAnalysis(b64);
      }
    }

    ui.updateFPS(tracker.fps);
  };

  // ── Wire: UI events ──────────────────────────────────
  ui.on('conversational-toggle', (enabled) => {
    coach.setConversational(enabled);
    voice.setConversational(enabled);
    if (enabled) {
      ui.addCoachMessage("Conversational AI Mode Enabled! 🎧 Listening...");
    } else {
      ui.addCoachMessage("Conversational mode off.");
    }
  });
  ui.on('calibrate', () => {
    // Basic region reset
    piano.calibrate();
    tracker.setROI(piano._region);

    // Start surface calibration sequence
    ui.addCoachMessage("Surface Calibration: Place all 5 fingertips flat on the piano surface and hold for 2 seconds...");
    calibrationFrames = [];
    calibrationStartTime = Date.now();
    calibrationActive = true;
  });
  ui.on('stop', () => {
    tracker.stop();
    camera.stop();
    sound.stopAll();
  });
  ui.on('voice-start', () => voice.startListening());
  ui.on('voice-stop',  () => voice.stopListening());
  ui.on('exercise-select', (ex) => {
    state.setExercise(ex);
    coach.startExercise(ex);
  });
  ui.on('save-settings', (settings) => {
    coach.setApiKey(settings.apiKey);
    piano.setOctave(settings.octave);
    sound.setVolume(settings.volume);
    if (settings.detectionMode) piano.setDetectionMode(settings.detectionMode);
    if (settings.flipPiano !== undefined) piano.setFlip(settings.flipPiano);
    if (settings.hideBlackKeys !== undefined) piano.setHideBlackKeys(settings.hideBlackKeys);
    if (settings.highlightHover !== undefined) piano.setHighlightHover(settings.highlightHover);
    if (settings.keyRange) piano.setKeyRange(settings.keyRange);

    // Apply dimensions
    piano.setDimensions({
      whiteKeyWidthScale:  settings.whiteKeyWidthScale,
      whiteKeyHeightScale: settings.whiteKeyHeightScale,
      blackKeyWidthScale:  settings.blackKeyWidthScale,
      blackKeyHeightScale: settings.blackKeyHeightScale
    });

    // Coach guidance on discovery
    const isML = (settings.detectionMode === 'surface_mlp' || 
                  settings.detectionMode === 'surface_lstm' || 
                  settings.detectionMode === 'surface_ai_v12');
    if (isML) {
      setTimeout(() => {
        ui.addCoachMessage("I see you're using an AI model! If it's not working perfectly, click the 'Train AI' button in the bottom toolbar (or in Settings) to calibrate it for your specific hand.");
      }, 1000);
    }
  });

  // ── Wire: ML training flow ────────────────────────────────
  const trainer = piano._mlTrainer;
  trainer.onProgress = (type, msg) => {
    ui.setMLStatus('training', msg);
  };
  
  setTimeout(() => {
    if (trainer.isMlpReady || trainer.isLstmReady) {
      ui.setMLStatus('ready', 'Model loaded');
    }
  }, 2000);

  let trainingActive = false;
  let trainingSequence = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
  let currentTargetIdx = 0;
  let samplesPerKey = 0;
  const SAMPLES_REQUIRED = 8;
  let negativeBuffer = [];

  const updateTrainingHUD = () => {
    if (!trainingActive) return;
    const note = trainingSequence[currentTargetIdx];
    ui.setTrainingTarget(note, samplesPerKey, SAMPLES_REQUIRED);
  };

  const finishTraining = async () => {
    trainingActive = false;
    ui.hideTrainingHUD();
    ui.setMLStatus('training', 'Computing models...');
    ui.addCoachMessage("Great! I have enough data. Training your AI now...");
    try {
      await trainer.trainMLP();
      await trainer.trainLSTM();
      ui.setMLStatus('ready', 'Model trained!');
      ui.addCoachMessage("✅ Success! You can now use Method 9 or 10 for better detection.");
    } catch (e) {
      ui.setMLStatus('error', e.message);
      ui.addCoachMessage(`❌ Error: ${e.message}`);
    }
  };

  // Intercept hand results for collection
  const origOnResults = tracker.onResults;
  tracker.onResults = (results) => {
    origOnResults?.(results);
    if (!trainingActive) return;

    const landmarks = results.multiHandLandmarks ?? [];
    if (landmarks.length === 0) return;

    // Collect negative samples (hovers)
    if (Math.random() < 0.1) {
      for (const hand of landmarks) {
        const palm = hand[0];
        if (!palm) continue;
        for (const tipId of [8, 12, 16, 20]) {
          const feats = piano._method9.extractFeatures(hand, tipId, piano._region, palm);
          trainer.collectSample(feats, 0);
          negativeBuffer.push(feats.slice(0, 12));
          if (negativeBuffer.length > 10) negativeBuffer.shift();
          if (negativeBuffer.length === 10) trainer.collectSequence(negativeBuffer, 0);
        }
      }
    }

    // Interactive guided training (User-Clarified: Learn from movement, not detection)
    const targetNote = trainingSequence[currentTargetIdx];
    const key = piano._keys.find(k => k.note === targetNote);
    if (!key) return;

    for (const hand of landmarks) {
      const palm = hand[0];
      if (!palm) continue;
      
      for (const tipId of [8, 12, 16, 20]) {
        const lm = hand[tipId];
        const mx = 1 - lm.x;
        
        // Is finger over the target key? (Generous X margin)
        const isOverKey = (mx >= key.xMin - 0.05 && mx <= key.xMax + 0.05);
        if (!isOverKey) continue;

        // User says: "You wait for my movement and you learn from it"
        const tipKey = `${tipId}`;
        const hist = piano._method9._tipHistory[tipKey] || { lastY: lm.y };
        const dy = lm.y - hist.lastY;
        
        // CRITICAL: Always update history so dy isn't stuck at 0
        piano._method9._tipHistory[tipKey] = { lastY: lm.y, lastZ: lm.z || 0 };

        if (dy > 0.001) { 
           console.log(`[Training] Movement detected for ${targetNote}: dy=${dy.toFixed(4)}`);
           const feats = piano._method9.extractFeatures(hand, tipId, piano._region, palm);
           trainer.collectSample(feats, 1);
           
           const seqSnap = negativeBuffer.slice(-9).concat([feats.slice(0, 12)]);
           if (seqSnap.length === 10) trainer.collectSequence(seqSnap, 1);
           
           samplesPerKey++;
           updateTrainingHUD();
           
           if (samplesPerKey >= SAMPLES_REQUIRED) {
             currentTargetIdx++;
             samplesPerKey = 0;
             if (currentTargetIdx >= trainingSequence.length) {
               finishTraining();
             } else {
               ui.addCoachMessage(`Good! Now please press ${trainingSequence[currentTargetIdx]}...`);
               updateTrainingHUD();
             }
             return; 
           }
        }
      }
    }
  };

  ui.on('train-model', () => {
    if (trainingActive) {
      trainingActive = false;
      ui.hideTrainingHUD();
      ui.addCoachMessage("Training cancelled.");
      return;
    }
    trainingActive = true;
    currentTargetIdx = 0;
    samplesPerKey = 0;
    trainer.clearSamples();
    ui.addCoachMessage("Let's calibrate your hand movements. Follow the prompts in the footer!");
    updateTrainingHUD();
  });

  ui.on('finish-training', async () => {
    trainingActive = false;
    ui.hideTrainingHUD();
    ui.setMLStatus('training', 'Computing models...');
    ui.addCoachMessage("Great! I have enough data. Training your AI now...");
    try {
      await trainer.trainMLP();
      await trainer.trainLSTM();
      ui.setMLStatus('ready', 'Model trained!');
      ui.addCoachMessage("✅ Success! You can now use Method 9 or 10 for better detection.");
    } catch (e) {
      ui.setMLStatus('error', e.message);
      ui.addCoachMessage(`❌ Error: ${e.message}`);
    }
  });

  // ── Wire: coach → UI ─────────────────────────────────
  coach.onMessage   = (msg)   => ui.addCoachMessage(msg);
  coach.onHighlight = (notes) => piano.highlightKeys(notes);
  coach.onExercise  = (ex) => {
    state.setExercise(ex);
    ui.startExerciseProgress(ex);
  };

  // ── Wire: state → UI ─────────────────────────────────
  state.onChange = (s) => {
    ui.syncStats(s);
    if (s.activeExercise) {
      const nextNote = s.exerciseNotes[s.currentNoteIndex];
      piano.highlightKeys(nextNote ? [nextNote] : []);
      
      // Update progress bar
      const pct = (s.currentNoteIndex / s.exerciseNotes.length) * 100;
      ui.setExerciseProgress(pct);
    } else {
      piano.clearHighlights();
    }
  };

  console.info('[boot] All systems online ✓');
}
