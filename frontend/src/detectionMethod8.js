import { FINGERTIP_IDS } from './handTracker.js';
import { TOUCH_ZONE_FRAC } from './pianoOverlay.js';

/**
 * DetectionMethod8 — PressureVision++ Inspired
 *
 * Approximates the PressureVision++ philosophy using MediaPipe 3D landmarks
 * instead of a trained CNN on pixel data.
 *
 * Pressure score = f(Z-compression, Y-penetration, dwell time)
 * Uses hysteresis thresholds to prevent flicker.
 *
 * Signals:
 *  - Z-compression : tip.z approaches palm.z as finger presses down
 *  - Y-penetration : how far into the key zone the fingertip has gone
 *  - Dwell acc.    : score rises while signals active, decays when not
 *
 * Press  when pressure_score > PRESS_THRESH  (0.65)
 * Release when pressure_score < RELEASE_THRESH (0.30)
 */

const PRESS_THRESH   = 0.65;
const RELEASE_THRESH = 0.30;
const RISE_RATE      = 0.18; // How fast pressure builds per frame
const DECAY_RATE     = 0.10; // How fast pressure decays per frame
const MIN_NOTE_INTERVAL = 180; // Debounce (ms)

export class DetectionMethod8 {
  constructor() {
    // Per-fingertip: { pressure (0-1), pressed, lastTime }
    this._tipState  = {};
    // Per-note: { pressedBy, releaseFrames }
    this._keyStates = {};
  }

  /**
   * Compute a normalised Z-compression score for this fingertip.
   * z_tip - z_palm is negative when the tip is in front of (above) the palm.
   * As the finger presses INTO a surface the tip z approaches the palm z → delta rises toward 0.
   * We clamp and invert to get 0 (hovering) → 1 (fully compressed).
   */
  _zCompression(tip, palm) {
    const delta = tip.z - palm.z; // typically negative (~-0.10 hovering, closer to 0 when pressed)
    // Map (-0.12 → 0) to (0 → 1)
    const score = Math.max(0, Math.min(1, 1 + delta / 0.12));
    return score;
  }

  /**
   * Compute how far the fingertip has penetrated the key zone (0–1).
   * 0 = at the top boundary, 1 = fully inside the zone.
   */
  _yPenetration(tipY, key, flipped) {
    const threshold = flipped
      ? key.yMin + (key.yMax - key.yMin) * TOUCH_ZONE_FRAC
      : key.yMax - (key.yMax - key.yMin) * TOUCH_ZONE_FRAC;

    if (flipped) {
      // Pressed: tipY < threshold (moving up into key)
      if (tipY >= threshold) return 0;
      return Math.min(1, (threshold - tipY) / (threshold - key.yMin + 0.001));
    } else {
      // Pressed: tipY > threshold (moving down into key)
      if (tipY <= threshold) return 0;
      return Math.min(1, (tipY - threshold) / (key.yMax - threshold + 0.001));
    }
  }

  detect(handsLandmarks, keys, region, flipped = false) {
    const hits        = [];
    const releases    = [];
    const frameActive   = new Set();
    const framePressing = new Set();
    const now         = Date.now();

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks = handsLandmarks[hi];
      const palm = landmarks?.[0];
      if (!palm) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm = landmarks[tipId];
        if (!lm) continue;

        const tipKey = `${hi}_${tipId}`;
        if (!this._tipState[tipKey]) {
          this._tipState[tipKey] = { pressure: 0, pressed: false, lastTime: 0 };
        }
        const ts = this._tipState[tipKey];

        const mx = 1 - lm.x;

        // Compute Z-compression signal (0–1)
        const zScore = this._zCompression(lm, palm);

        for (let i = keys.length - 1; i >= 0; i--) {
          const key  = keys[i];
          const note = key.note;

          if (mx < key.xMin || mx > key.xMax) continue;
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;

          // Y-penetration signal (0–1)
          const yScore = this._yPenetration(lm.y, key, flipped);

          // Combined raw signal: geometric mean of Z-compression and Y-penetration
          const rawSignal = Math.sqrt(zScore * yScore);

          // Dwell accumulator — pressure rises when signal is present, decays otherwise
          if (rawSignal > 0.15) {
            ts.pressure = Math.min(1, ts.pressure + RISE_RATE * rawSignal);
          } else {
            ts.pressure = Math.max(0, ts.pressure - DECAY_RATE);
          }

          // Mark key as active for hover highlight
          if (ts.pressure > 0.1) frameActive.add(note);

          // Ownership guard
          if (!this._keyStates[note]) {
            this._keyStates[note] = { pressedBy: null, releaseFrames: 0 };
          }
          const ks = this._keyStates[note];

          if (ks.pressedBy && ks.pressedBy !== tipKey) {
            if (framePressing.has(note)) framePressing.add(note);
            break;
          }

          const debounced = (now - ts.lastTime) > MIN_NOTE_INTERVAL;

          if (!ts.pressed) {
            // Press threshold
            if (ts.pressure >= PRESS_THRESH && debounced) {
              ts.pressed  = true;
              ts.lastTime = now;
              ks.pressedBy = tipKey;
              ks.releaseFrames = 0;
              // Velocity proportional to pressure score
              const velocity = Math.min(1, Math.max(0.4, ts.pressure));
              hits.push({ note, velocity });
              framePressing.add(note);
            }
          } else {
            if (ts.pressure <= RELEASE_THRESH) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 2) {
                ts.pressed   = false;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
              } else {
                framePressing.add(note);
              }
            } else {
              ks.releaseFrames = 0;
              framePressing.add(note);
            }
          }

          break;
        }
      }
    }

    // Global release sweep
    for (const note in this._keyStates) {
      const ks = this._keyStates[note];
      if (ks.pressedBy) {
        if (!framePressing.has(note) && !frameActive.has(note)) {
          // Find the tip state for this key's owner and reset it
          const ts = this._tipState[ks.pressedBy];
          if (ts) ts.pressed = false;
          ks.pressedBy = null;
          ks.releaseFrames = 0;
          releases.push(note);
        }
      }
    }

    return { hits, releases, active: frameActive, pressing: framePressing };
  }
}
