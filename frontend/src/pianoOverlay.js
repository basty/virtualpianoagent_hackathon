/**
 * pianoOverlay.js — Virtual Piano Keyboard Renderer
 *
 * PRESS DETECTION STRATEGY (V2 — Spatial Logic Engine)
 * ──────────────────────────────────────────────────────────────
 * Uses a 3-signal detector to distinguish a deliberate "press" from a hover:
 *
 * 1. SPATIAL: Fingertip must be in key [X, Y] bounds and below the surface.
 * 2. KINETIC: Spike in Y velocity (moving down) AND Z velocity (toward surface).
 * 3. POSTURE: Finger must be curled (bend angle < 165°).
 *
 * This provides a convincing "mechanical" feel without depth sensors.
 */

import { FINGERTIP_IDS } from './handTracker.js';
import { DetectionMethod1 } from './detectionMethod1.js';
import { DetectionMethod2 } from './detectionMethod2.js';
import { DetectionMethod3 } from './detectionMethod3.js';
import { DetectionMethod4 } from './detectionMethod4.js';
import { DetectionMethod5 } from './detectionMethod5.js';
import { DetectionMethod6 } from './detectionMethod6.js';
import { DetectionMethod7 } from './detectionMethod7.js';
import { DetectionMethod8 } from './detectionMethod8.js';
import { DetectionMethod9 } from './detectionMethod9.js';
import { DetectionMethod10 } from './detectionMethod10.js';
import { DetectionMethod11 } from './detectionMethod11.js';
import { DetectionMethod12 } from './detectionMethod12.js';
import { MLTrainer } from './mlTrainer.js';

const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTES = ['C#', 'D#', null, 'F#', 'G#', 'A#', null];

/** Fraction of key height that counts as "surface contact". */
export const TOUCH_ZONE_FRAC = 0.30;

export class PianoOverlay {
  /** @param {HTMLCanvasElement} canvas @param {number} octave */
  constructor(canvas, octave = 4) {
    this._canvas      = canvas;
    this._ctx         = canvas.getContext('2d');
    this._octave      = octave;
    this._keys        = [];
    this._highlighted = new Set();
    this._flipped     = true;
    this._hideBlackKeys = false;
    this._highlightHover = false;
    
    this._active      = new Set(); 
    this._pressing    = new Set(); 

    // Piano region: Ultra-slim and Elegant
    this._region = { x: 0.34, y: 0.58, width: 0.32, height: 0.4 };

    this._detectionMode = 'surface_stop'; // per user request
    
    // Key dimension scales
    this._whiteKeyWidthScale  = 1.0;
    this._whiteKeyHeightScale = 1.0;
    this._blackKeyWidthScale  = 0.55;
    this._blackKeyHeightScale = 0.4;
    this._method1 = new DetectionMethod1();
    this._method2 = new DetectionMethod2();
    this._method3 = new DetectionMethod3();
    this._method4 = new DetectionMethod4();
    this._method5 = new DetectionMethod5();
    this._method6 = new DetectionMethod6();
    this._method7 = new DetectionMethod7();

    // ML methods — share a single trainer instance
    this._mlTrainer = new MLTrainer();
    this._mlTrainer.init(); // async, loads saved models if available
    this._method8  = new DetectionMethod8();
    this._method9  = new DetectionMethod9(this._mlTrainer);
    this._method10 = new DetectionMethod10(this._mlTrainer);
    this._method11 = new DetectionMethod11();
    this._method12 = new DetectionMethod12();

    this._tableY = null; // Calibrated Y threshold
  }

  init() {
    this._buildKeys();
    this._startRenderLoop();
  }

  setOctave(octave) {
    this._octave = Number(octave);
    this._buildKeys();
  }

  calibrate(region) {
    this._region = region ?? { x: 0.34, y: 0.58, width: 0.32, height: 0.4 };
    this._buildKeys();
    console.info('[PianoOverlay] calibrated', this._region);
  }

  setTableY(y) {
    this._tableY = y;
    this._method5.setTableY(y);
  }

  calibratePlane(worldLandmarks) {
    let ok = false;
    if (this._method6.calibrateSurface(worldLandmarks)) {
      console.info('[PianoOverlay] Method 6 — 3D Plane calibrated!', this._method6.planeNormal);
      ok = true;
    }
    const res11 = this._method11.calibrateSurface(worldLandmarks);
    if (res11.ok) {
      console.info('[PianoOverlay] Method 11 — 3D Plane calibrated!', res11.message);
      ok = true;
    } else {
      console.warn('[PianoOverlay] Method 11 calibration:', res11.message);
    }
    return ok;
  }

  setDetectionMode(mode) {
    this._detectionMode = mode;
  }

  setDimensions(scales) {
    if (scales.whiteKeyWidthScale !== undefined)  this._whiteKeyWidthScale  = scales.whiteKeyWidthScale;
    if (scales.whiteKeyHeightScale !== undefined) this._whiteKeyHeightScale = scales.whiteKeyHeightScale;
    if (scales.blackKeyWidthScale !== undefined)  this._blackKeyWidthScale  = scales.blackKeyWidthScale;
    if (scales.blackKeyHeightScale !== undefined) this._blackKeyHeightScale = scales.blackKeyHeightScale;
    this._buildKeys();
  }

  setFlip(flipped) {
    this._flipped = !!flipped;
    this._buildKeys();
  }

  setHideBlackKeys(hide) {
    this._hideBlackKeys = !!hide;
    this._buildKeys();
  }

  setHighlightHover(highlight) {
    this._highlightHover = !!highlight;
  }

  setKeyRange(range) {
    this._keyRange = range || 'C4-B4';
    this._buildKeys();
  }

  /**
   * Detect hits using the selected detection strategy.
   *
   * @param  {Array<Array<{x,y,z}>>} handsLandmarks
   * @param  {Array<Array<{x,y,z}>>} multiHandWorldLandmarks
   * @returns {{ hits: Array<{note: string, velocity: number}>, releases: Array<string> }}
   */
  detectHits(handsLandmarks, multiHandWorldLandmarks = null) {
    let strategy = this._method1; // default to hybrid
    if (this._detectionMode === 'surface_floor') strategy = this._method2;
    if (this._detectionMode === 'surface_stop') strategy = this._method3;
    if (this._detectionMode === 'surface_z') strategy = this._method4;
    if (this._detectionMode === 'surface_v5') strategy = this._method5;
    if (this._detectionMode === 'surface_ai')    strategy = this._method6;
    if (this._detectionMode === 'surface_ai_v2') strategy = this._method7;
    if (this._detectionMode === 'surface_pv')    strategy = this._method8;
    if (this._detectionMode === 'surface_mlp')    strategy = this._method9;
    if (this._detectionMode === 'surface_lstm')   strategy = this._method10;
    if (this._detectionMode === 'surface_3dsvd')  strategy = this._method11;
    if (this._detectionMode === 'surface_ai_v12') strategy = this._method12;

    const result = strategy.detect(handsLandmarks, this._keys, this._region, this._flipped, multiHandWorldLandmarks);
    return this._processDetectionResult(result, handsLandmarks);
  }

  /**
   * Identical to detectHits but forces a specific method (e.g. 'hybrid')
   * useful for training mode where the active ML model isn't ready.
   */
  detectHitsWithMethod(mode, handsLandmarks, multiHandWorldLandmarks = null) {
    let strategy = this._method1; 
    if (mode === 'surface_floor') strategy = this._method2;
    if (mode === 'surface_stop')  strategy = this._method3;
    if (mode === 'surface_v5')    strategy = this._method5;
    if (mode === 'surface_ai')    strategy = this._method6;
    if (mode === 'surface_pv')    strategy = this._method8;
    if (mode === 'surface_mlp')   strategy = this._method9;
    if (mode === 'surface_lstm')  strategy = this._method10;
    if (mode === 'surface_3dsvd') strategy = this._method11;
    if (mode === 'surface_ai_v12') strategy = this._method12;

    const result = strategy.detect(handsLandmarks, this._keys, this._region, this._flipped, multiHandWorldLandmarks);
    return this._processDetectionResult(result, handsLandmarks);
  }

  _processDetectionResult(result, handsLandmarks) {
    // Store method11 debug info for the render loop
    this._method11DebugInfo = (this._detectionMode === 'surface_3dsvd') ? (result.debugInfo ?? []) : null;
    
    this._active = result.active;
    this._pressing = result.pressing;

    // Annotate landmarks so handTracker can color them
    if (handsLandmarks) {
      const FINGERTIP_IDS = [4, 8, 12, 16, 20];
      for (const hand of handsLandmarks) {
        for (const tipId of FINGERTIP_IDS) {
          const lm = hand[tipId];
          if (!lm) continue;
          
          const mx = 1 - lm.x;
          // Check if this fingertip is above any key that is currently pressing
          for (let i = this._keys.length - 1; i >= 0; i--) {
            const key = this._keys[i];
            if (this._pressing.has(key.note)) {
              if (mx >= key.xMin && mx <= key.xMax) {
                if (lm.y >= key.yMin - 0.05 && lm.y <= key.yMax + 0.05) {
                  // Approximate match: mark it pressing
                  lm.isPressing = true;
                  break;
                }
              }
            }
          }
        }
      }
    }

    return { hits: result.hits, releases: result.releases };
  }

  updateFingers(handsLandmarks) {
    this._latestLandmarks = handsLandmarks;
  }

  highlightKeys(notes) {
    this._highlighted = new Set(notes);
  }

  clearHighlights() {
    this._highlighted.clear();
  }

  _getNotesInRange(rangeStr) {
    const [start, end] = rangeStr.split('-');
    if (!start || !end) return [];

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    const parse = (s) => {
      const match = s.trim().match(/^([A-G]#?)(\d+)$/);
      if (!match) return null;
      return { 
        name: match[1], 
        octave: parseInt(match[2]),
        index: noteNames.indexOf(match[1]) + parseInt(match[2]) * 12
      };
    };

    const s = parse(start);
    const e = parse(end);
    if (!s || !e) return [];

    const result = [];
    for (let i = s.index; i <= e.index; i++) {
        const octave = Math.floor(i / 12);
        const name   = noteNames[i % 12];
        result.push({ name, octave, type: name.includes('#') ? 'black' : 'white' });
    }
    return result;
  }

  _buildKeys() {
    this._keys = [];
    const r      = this._region;
    const rangeStr = this._keyRange || 'C4-B4';
    const allNotes = this._getNotesInRange(rangeStr);
    
    if (allNotes.length === 0) {
        console.warn('[PianoOverlay] Invalid key range:', rangeStr);
        return;
    }

    const whiteNotes = allNotes.filter(n => n.type === 'white');
    const nWhite     = whiteNotes.length;
    
    const whiteW = (r.width / nWhite) * this._whiteKeyWidthScale;
    const whiteH = r.height * this._whiteKeyHeightScale;
    const blackW = whiteW * this._blackKeyWidthScale;
    const blackH = whiteH * this._blackKeyHeightScale;

    // White keys
    whiteNotes.forEach((note, i) => {
      this._keys.push({
        note:    `${note.name}${note.octave}`,
        type:    'white',
        xMin:    r.x + i * whiteW,
        xMax:    r.x + (i + 1) * whiteW,
        yMin:    r.y,
        yMax:    r.y + whiteH,
        yLogMax: r.y + whiteH,
        drawX:   r.x + i * whiteW,
        drawW:   whiteW,
        drawH:   whiteH,
      });
    });

    if (!this._hideBlackKeys) {
      allNotes.forEach((note) => {
        if (note.type !== 'black') return;

        // Position black key relative to its white note (e.g. C#4 relative to C4)
        const whiteIdx = whiteNotes.findIndex(wn => {
            const base = note.name.replace('#', '');
            return wn.name === base && wn.octave === note.octave;
        });

        if (whiteIdx === -1) return;

        const cx = r.x + (whiteIdx + 1) * whiteW;
        
        this._keys.push({
          note:    `${note.name}${note.octave}`,
          type:    'black',
          xMin:    cx - blackW / 2,
          xMax:    cx + blackW / 2,
          yMin:    this._flipped ? r.y + (whiteH - blackH) : r.y,
          yMax:    this._flipped ? r.y + whiteH : r.y + blackH,
          yLogMax: r.y + whiteH,
          drawX:   cx - blackW / 2,
          drawY:   this._flipped ? r.y + (whiteH - blackH) : r.y,
          drawW:   blackW,
          drawH:   blackH,
        });
      });
    }

    this._keys.sort((a, b) => (a.type === 'black' ? 1 : -1));
  }

  _startRenderLoop() {
    const draw = () => { this._draw(); requestAnimationFrame(draw); };
    requestAnimationFrame(draw);
  }

  _draw() {
    const canvas = this._canvas;
    const video  = canvas.previousElementSibling?.previousElementSibling;

    if (video?.videoWidth) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
      }
    }

    const ctx = this._ctx;
    const W   = canvas.width;
    const H   = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Method 11 debug overlay (drawn before keys so text is on top)
    if (this._method11DebugInfo) {
      this._method11.drawDebugOverlay(ctx, W, H, this._method11DebugInfo);
    }

    const whites = this._keys.filter(k => k.type === 'white');
    const blacks = this._keys.filter(k => k.type === 'black');

    for (const key of [...whites, ...blacks]) {
      this._drawKey(ctx, key, W, H);
    }

    if (this._keys.length) {
      const kWhite = this._keys.find(k => k.type === 'white');
      let surfaceY;
      
      // Use calibrated tableY if available, otherwise fallback to zone fraction
      if (this._tableY !== null) {
        surfaceY = this._tableY * H;
      } else if (this._flipped) {
        surfaceY = (kWhite.yMin + (kWhite.yMax - kWhite.yMin) * TOUCH_ZONE_FRAC) * H;
      } else {
        surfaceY = (kWhite.yMax - (kWhite.yMax - kWhite.yMin) * TOUCH_ZONE_FRAC) * H;
      }
      
      ctx.save();
      ctx.strokeStyle = this._tableY !== null ? 'rgba(0, 255, 100, 0.7)' : 'rgba(0, 229, 160, 0.45)';
      ctx.lineWidth   = this._tableY !== null ? 2 : 1;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(this._region.x * W, surfaceY);
      ctx.lineTo((this._region.x + this._region.width) * W, surfaceY);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawKey(ctx, key, W, H) {
    const isBlack    = key.type === 'black';
    const isActive   = this._highlightHover && this._active.has(key.note);
    const isPressing = this._pressing.has(key.note);
    const isHl       = this._highlighted.has(key.note);

    // Visual Key Travel — shift down when pressed
    const travel = isPressing ? 4 : 0; 
    
    const x = key.drawX * W;
    const y = (key.drawY !== undefined ? key.drawY : key.yMin) * H + travel; // Apply travel
    const w = key.drawW * W;
    const h = key.drawH * H;

    ctx.beginPath();
    let radius = [0, 0, 0, 0];
    if (isBlack) {
        radius = this._flipped ? [0, 0, 4, 4] : [0, 0, 4, 4]; // usually bottom is curved
        // Actually if it's flipped maybe the tip is curved
        radius = this._flipped ? [4, 4, 0, 0] : [0, 0, 4, 4];
    } else {
        radius = this._flipped ? [4, 4, 0, 0] : [0, 0, 4, 4];
    }
    
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);

    if (isPressing) {
      // Deep press feedback — semi-transparent glass purple
      ctx.fillStyle = isBlack ? 'rgba(124, 108, 255, 0.45)' : 'rgba(155, 143, 255, 0.4)';
    } else if (isActive) {
      ctx.fillStyle = isBlack ? 'rgba(124, 108, 255, 0.25)' : 'rgba(155, 143, 255, 0.2)';
    } else if (isHl) {
      ctx.fillStyle = isBlack ? 'rgba(0, 229, 160, 0.35)' : 'rgba(0, 229, 160, 0.15)';
    } else {
      // Idle state: more opaque black for visibility
      ctx.fillStyle = isBlack ? 'rgba(10, 12, 20, 0.9)' : 'rgba(255, 255, 255, 0.05)';
      if (isBlack) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth   = 1;
        ctx.stroke();
      }
    }
    ctx.fill();

    // ── Border / glow ──
    ctx.strokeStyle = isPressing
      ? 'rgba(200, 190, 255, 0.8)'
      : isActive
        ? 'rgba(155, 143, 255, 0.6)'
        : isHl
          ? 'rgba(0, 229, 160, 0.6)'
          : isBlack ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = isPressing ? 2 : isActive ? 1.5 : 1;
    ctx.stroke();

    if (!isBlack && w > 24) {
      ctx.fillStyle    = (isActive || isPressing) ? '#fff' : 'rgba(255,255,255,0.55)';
      ctx.font         = `${Math.max(9, w * 0.26)}px "Inter", sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = this._flipped ? 'top' : 'bottom';
      const textYPos = this._flipped ? y + 3 : y + h - 3;
      ctx.fillText(key.note, x + w / 2, textYPos);
    }
  }
}
