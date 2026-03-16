import { FINGERTIP_IDS } from './handTracker.js';

/**
 * DetectionMethod7 — AI v2: Velocity + Exponential Smoothing
 *
 * Ported from:
 * kunal0230/Virtual_Piano_With_Computer_Vision — Hybrid_test_2.py
 *
 * Algorithm:
 *  1. Exponential smoothing per fingertip (α = 0.3) to reduce jitter.
 *  2. Velocity = change in smoothed Y across frames.
 *  3. Press  when dy > PRESS_THRESH  (finger moving down fast enough).
 *  4. Release when dy < RELEASE_THRESH (finger moving back up).
 *
 * Intentionally simple — no bend-angle check, no Z-spike, no hover state.
 * This makes it fast-reacting and distinctly different from Methods 1–6.
 */

const SMOOTHING_ALPHA    = 0.3;   // Exponential smoothing factor (matches repo)
const PRESS_THRESH       = 0.006; // Normalized dy to trigger a press
const RELEASE_THRESH     = -0.003; // Negative dy to trigger a release
const MIN_NOTE_INTERVAL  = 150;   // Debounce (ms) — prevents double-fires
const RELEASE_FRAMES     = 2;     // Frames of upward motion before releasing

export class DetectionMethod7 {
  constructor() {
    // Per-fingertip: { smoothedY, prevY }
    this._smoothed = {};
    // Per-note key state: { pressed, pressedBy, lastTime, releaseCount }
    this._keyStates = {};
  }

  /**
   * Exponential smoothing — mirrors the Python smooth_position() function.
   * @param {number} current
   * @param {number} previous
   * @returns {number}
   */
  _smooth(current, previous) {
    if (previous === null || previous === undefined) return current;
    return SMOOTHING_ALPHA * current + (1 - SMOOTHING_ALPHA) * previous;
  }

  detect(handsLandmarks, keys, region, flipped = false) {
    const hits        = [];
    const releases    = [];
    const frameActive   = new Set();
    const framePressing = new Set();
    const now         = Date.now();

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks = handsLandmarks[hi];
      if (!landmarks?.[0]) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm = landmarks[tipId];
        if (!lm) continue;

        const tipKey = `${hi}_${tipId}`;

        // ── 1. Exponential Smoothing ──────────────────────────────
        if (!this._smoothed[tipKey]) {
          this._smoothed[tipKey] = { y: lm.y, prevY: lm.y };
        }
        const s = this._smoothed[tipKey];
        const smoothY = this._smooth(lm.y, s.y);
        const dy      = smoothY - s.prevY; // positive = moving DOWN

        s.prevY = s.y;
        s.y     = smoothY;

        // Mirrored X (camera is mirrored)
        const mx = 1 - lm.x;

        // ── 2. Key matching ───────────────────────────────────────
        for (let i = keys.length - 1; i >= 0; i--) {
          const key  = keys[i];
          const note = key.note;

          // Horizontal bounds check
          if (mx < key.xMin || mx > key.xMax) continue;
          // Vertical bounds — generous ±5% tolerance
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;

          // Inside key region → mark as active (for hover highlight)
          frameActive.add(note);

          // Ownership guard — prevent two fingers stealing the same key
          const ks = this._keyStates[note] ??
            (this._keyStates[note] = { pressed: false, pressedBy: null, lastTime: 0, releaseCount: 0 });

          if (ks.pressed && ks.pressedBy && ks.pressedBy !== tipKey) {
            framePressing.add(note);
            break;
          }

          // ── 3. Press detection ────────────────────────────────
          if (!ks.pressed) {
            const debounced = (now - ks.lastTime) > MIN_NOTE_INTERVAL;
            if (dy > PRESS_THRESH && debounced) {
              ks.pressed    = true;
              ks.pressedBy  = tipKey;
              ks.lastTime   = now;
              ks.releaseCount = 0;

              // Velocity → 0–1, scaled from dy magnitude
              const velocity = Math.min(1, Math.max(0.3, dy * 80));
              hits.push({ note, velocity });
              framePressing.add(note);
            }
          } else {
            // ── 4. Release detection ──────────────────────────────
            // The finger is moving back up
            if (dy < RELEASE_THRESH) {
              ks.releaseCount++;
              if (ks.releaseCount >= RELEASE_FRAMES) {
                ks.pressed    = false;
                ks.pressedBy  = null;
                ks.releaseCount = 0;
                releases.push(note);
              } else {
                framePressing.add(note); // hold until confirmed
              }
            } else {
              ks.releaseCount = 0;
              framePressing.add(note);
            }
          }

          break; // Only process the front-most matching key
        }
      }
    }

    // ── 5. Global release sweep ───────────────────────────────────
    // Any key that's pressed but no finger is touching it this frame
    for (const note in this._keyStates) {
      const ks = this._keyStates[note];
      if (ks.pressed && !frameActive.has(note) && !framePressing.has(note)) {
        ks.pressed = false;
        ks.pressedBy = null;
        ks.releaseCount = 0;
        releases.push(note);
      }
    }

    return { hits, releases, active: frameActive, pressing: framePressing };
  }
}
