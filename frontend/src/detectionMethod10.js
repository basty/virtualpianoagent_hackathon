import { FINGERTIP_IDS } from './handTracker.js';
import { MLTrainer, SEQUENCE_LEN } from './mlTrainer.js';

/**
 * DetectionMethod10 — TypeNet Inspired (Temporal LSTM)
 *
 * Inspired by "TypeNet: Deep Learning Keystroke Biometrics" (Acien et al., 2021).
 * TypeNet uses an LSTM trained on sequences of keystroke timing features to
 * identify users. We adapt the temporal sequence concept for press detection:
 * instead of biometric auth, we classify whether the *trajectory* of the last
 * SEQUENCE_LEN (10) frames constitutes a deliberate key press.
 *
 * Input tensor: [batch=1, time=10, features=12]
 * Features per frame:
 *   [0] tip.y normalised to region
 *   [1] tip.z - palm.z (Z-compression)
 *   [2] dy  (frame-to-frame Y delta, ×10)
 *   [3] dz  (frame-to-frame Z delta, ×10)
 *   [4] bend angle of active finger (0–1)
 *   [5] palm tilt: wrist→midMcp .y component
 *   [6] tip.y of all-finger mean (context)
 *   [7] tip.z mean of all fingers
 *   [8] velocity magnitude (sqrt(dy²+dz²))
 *   [9] z_compression smoothed (EMA, α=0.4)
 *   [10] time since last press (normalised, capped at 1s)
 *   [11] is-in-key-zone binary (0 or 1)
 *
 * The LSTM learns the characteristic temporal *shape* of a downstroke vs. hover.
 * This is distinct from Method 9 which treats each frame independently.
 */

const PRESS_PROB_THRESH   = 0.58;
const RELEASE_PROB_THRESH = 0.30;
const RELEASE_FRAMES      = 3;
const MIN_NOTE_INTERVAL   = 160;

const FINGER_METAS = [
  { tip: 4,  mcp: 1,  pip: 2  },
  { tip: 8,  mcp: 5,  pip: 6  },
  { tip: 12, mcp: 9,  pip: 10 },
  { tip: 16, mcp: 13, pip: 14 },
  { tip: 20, mcp: 17, pip: 18 },
];
const FINGERTIP_IDS_ALL = [4, 8, 12, 16, 20];
const WRIST_ID  = 0;
const MIDDLE_MCP = 9;

export class DetectionMethod10 {
  constructor(trainer) {
    /** @type {MLTrainer} */
    this._trainer   = trainer;
    this._keyStates = {};
    // Per-tipKey: sliding window of feature vectors + aux state
    this._windows   = {}; // tipKey → { frames: number[][], lastY, lastZ, smoothZ, lastPressTime }
  }

  // ── Feature extraction (12 features per frame) ───────────────────────────

  _extractFrame(landmarks, tipId, region, palm, tipKey, now) {
    const lm  = landmarks[tipId];
    const win = this._windows[tipKey];

    const normY  = (lm.y - region.y) / (region.height || 1);
    const zComp  = Math.max(-1, Math.min(1, (lm.z - palm.z) / 0.2));
    const dy     = win ? Math.max(-0.1, Math.min(0.1, lm.y - win.lastY)) * 10 : 0;
    const dz     = win ? Math.max(-0.1, Math.min(0.1, lm.z - win.lastZ)) * 10 : 0;

    // Bend angle of the active finger
    const fm = FINGER_METAS.find(f => f.tip === tipId) ?? FINGER_METAS[1];
    let bendAngle = 1;
    const p1 = landmarks[fm.mcp]; const p2 = landmarks[fm.pip]; const p3 = lm;
    if (p1 && p2 && p3) {
      const v1 = { x: p1.x-p2.x, y: p1.y-p2.y, z: p1.z-p2.z };
      const v2 = { x: p3.x-p2.x, y: p3.y-p2.y, z: p3.z-p2.z };
      const dot = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
      const mag = Math.sqrt((v1.x**2+v1.y**2+v1.z**2) * (v2.x**2+v2.y**2+v2.z**2));
      bendAngle = mag > 0 ? Math.acos(Math.max(-1, Math.min(1, dot/mag))) * (180/Math.PI) / 180 : 1;
    }

    // Palm tilt
    const wrist = landmarks[WRIST_ID];
    const mmcp  = landmarks[MIDDLE_MCP];
    let palmTilt = -1;
    if (wrist && mmcp) {
      const dy2 = mmcp.y - wrist.y;
      const mag2 = Math.sqrt((mmcp.x-wrist.x)**2 + dy2**2 + (mmcp.z-wrist.z)**2) || 1;
      palmTilt = dy2 / mag2;
    }

    // Mean tip Y / Z context
    let sumY = 0, sumZ = 0;
    for (const fid of FINGERTIP_IDS_ALL) {
      const flm = landmarks[fid];
      if (flm) { sumY += (flm.y - region.y) / (region.height || 1); sumZ += flm.z - palm.z; }
    }
    const meanY = sumY / 5;
    const meanZ = sumZ / 5;

    // Velocity magnitude
    const velMag = Math.min(1, Math.sqrt(dy**2 + dz**2));

    // Smoothed Z (EMA)
    const prevSmZ = win ? win.smoothZ : zComp;
    const smoothZ = 0.4 * zComp + 0.6 * prevSmZ;

    // Time since last press (normalised)
    const timeSincePress = win
      ? Math.min(1, (now - win.lastPressTime) / 1000)
      : 1;

    // Is in key zone (set externally — approximated as zComp > 0.3)
    const inZone = zComp > 0.3 ? 1 : 0;

    // Update window aux state
    if (!this._windows[tipKey]) {
      this._windows[tipKey] = { frames: [], lastY: lm.y, lastZ: lm.z, smoothZ, lastPressTime: now - 2000 };
    } else {
      this._windows[tipKey].lastY = lm.y;
      this._windows[tipKey].lastZ = lm.z;
      this._windows[tipKey].smoothZ = smoothZ;
    }

    return [normY, zComp, dy, dz, bendAngle, palmTilt, meanY, meanZ, velMag, smoothZ, timeSincePress, inZone];
  }

  // ── Detect ────────────────────────────────────────────────────────────────

  detect(handsLandmarks, keys, region, flipped = false) {
    const hits        = [];
    const releases    = [];
    const frameActive   = new Set();
    const framePressing = new Set();
    const now         = Date.now();

    if (!this._trainer.isLstmReady) {
      return { hits, releases, active: frameActive, pressing: framePressing };
    }

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks = handsLandmarks[hi];
      const palm = landmarks?.[0];
      if (!palm) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm = landmarks[tipId];
        if (!lm) continue;

        const tipKey = `${hi}_${tipId}`;
        const mx = 1 - lm.x;

        // Extract frame features + maintain sliding window
        const frame = this._extractFrame(landmarks, tipId, region, palm, tipKey, now);
        const win   = this._windows[tipKey];
        win.frames.push(frame);
        if (win.frames.length > SEQUENCE_LEN) win.frames.shift();

        // Only run inference once we have a full window
        let prob = 0;
        if (win.frames.length === SEQUENCE_LEN) {
          prob = this._trainer.predictLSTM(win.frames);
        }

        for (let i = keys.length - 1; i >= 0; i--) {
          const key  = keys[i];
          const note = key.note;

          if (mx < key.xMin || mx > key.xMax) continue;
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;

          frameActive.add(note);

          if (!this._keyStates[note]) {
            this._keyStates[note] = { pressed: false, pressedBy: null, lastTime: 0, releaseFrames: 0 };
          }
          const ks = this._keyStates[note];

          if (ks.pressedBy && ks.pressedBy !== tipKey) {
            if (ks.pressed) framePressing.add(note);
            break;
          }

          const debounced = (now - ks.lastTime) > MIN_NOTE_INTERVAL;

          if (!ks.pressed) {
            if (prob >= PRESS_PROB_THRESH && debounced) {
              ks.pressed   = true;
              ks.pressedBy = tipKey;
              ks.lastTime  = now;
              ks.releaseFrames = 0;
              win.lastPressTime = now;
              hits.push({ note, velocity: Math.min(1, Math.max(0.4, prob)) });
              framePressing.add(note);
            }
          } else {
            if (prob < RELEASE_PROB_THRESH) {
              ks.releaseFrames++;
              if (ks.releaseFrames >= RELEASE_FRAMES) {
                ks.pressed   = false;
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

    // Global sweep
    for (const note in this._keyStates) {
      const ks = this._keyStates[note];
      if (ks.pressed && !framePressing.has(note) && !frameActive.has(note)) {
        ks.pressed = false;
        ks.pressedBy = null;
        ks.releaseFrames = 0;
        releases.push(note);
      }
    }

    return { hits, releases, active: frameActive, pressing: framePressing };
  }
}
