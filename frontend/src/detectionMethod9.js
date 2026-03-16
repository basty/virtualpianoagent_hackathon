import { FINGERTIP_IDS } from './handTracker.js';
import { MLTrainer } from './mlTrainer.js';

/**
 * DetectionMethod9 — Personal ML Classifier (TF.js MLP)
 *
 * A binary feedforward network trained in real-time from the user's own presses.
 * Architecture: 22 → 32 (relu, dropout 0.2) → 16 (relu) → 1 (sigmoid)
 *
 * Feature vector per fingertip (~22 numbers):
 *   [0-4]   z_compression per finger (tip.z - palm.z, normalised)
 *   [5]     tip.y normalised to piano region (0=top, 1=bottom)
 *   [6]     tip.z - palm.z (active finger only)
 *   [7]     dy (Y velocity, positive = down)
 *   [8]     dz (Z velocity)
 *   [9-13]  bend angles of all 5 fingers, normalised 0–1 (0°= fully curled, 180°= straight)
 *   [14-16] palm tilt unit vector (wrist → middle-MCP): x, y, z
 *   [17-21] tip.y for all 5 fingers normalised to region
 *
 * Requires training before it can detect presses.
 * Use `startRecording()` to collect positive samples and `stopRecording()` to trigger training.
 */

const PRESS_PROB_THRESH   = 0.60;
const RELEASE_PROB_THRESH = 0.35;
const RELEASE_FRAMES      = 3;
const MIN_NOTE_INTERVAL   = 150;
const FINGER_METAS = [
  { tip: 4,  mcp: 1,  pip: 2  }, // thumb
  { tip: 8,  mcp: 5,  pip: 6  }, // index
  { tip: 12, mcp: 9,  pip: 10 }, // middle
  { tip: 16, mcp: 13, pip: 14 }, // ring
  { tip: 20, mcp: 17, pip: 18 }, // pinky
];
const WRIST_ID    = 0;
const MIDDLE_MCP  = 9;

export class DetectionMethod9 {
  constructor(trainer) {
    /** @type {MLTrainer} */
    this._trainer   = trainer;
    this._keyStates = {};
    this._tipHistory = {};  // tipKey → { lastY, lastZ }
  }

  // ── Feature extraction ────────────────────────────────────────────────────

  extractFeatures(landmarks, tipId, region, palm) {
    const FINGER_IDS = [4, 8, 12, 16, 20];
    const features = [];

    // [0-4] Z-compression per finger (tip.z - palm.z, normalised to [-1, 1])
    for (const fid of FINGER_IDS) {
      const lm = landmarks[fid];
      features.push(lm ? Math.max(-1, Math.min(1, (lm.z - palm.z) / 0.2)) : 0);
    }

    // [5] tip.y normalised to piano region
    const lm = landmarks[tipId];
    const normY = region.height > 0 ? (lm.y - region.y) / region.height : 0;
    features.push(Math.max(-0.5, Math.min(1.5, normY)));

    // [6] Z-compression for this specific tip
    features.push(Math.max(-1, Math.min(1, (lm.z - palm.z) / 0.2)));

    // [7-8] Velocity (from tip history)
    const tipKey = `${tipId}`;
    const hist = this._tipHistory[tipKey] || { lastY: lm.y, lastZ: lm.z };
    features.push(Math.max(-0.1, Math.min(0.1, lm.y - hist.lastY)) * 10); // dy normalised
    features.push(Math.max(-0.1, Math.min(0.1, lm.z - hist.lastZ)) * 10); // dz normalised
    this._tipHistory[tipKey] = { lastY: lm.y, lastZ: lm.z };

    // [9-13] Bend angles normalised 0–1 (180°=straight=1, 90°=curled=0)
    for (const fm of FINGER_METAS) {
      const p1 = landmarks[fm.mcp];
      const p2 = landmarks[fm.pip];
      const p3 = landmarks[fm.tip];
      if (!p1 || !p2 || !p3) { features.push(1); continue; }
      const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
      const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
      const dot = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
      const mag = Math.sqrt((v1.x**2+v1.y**2+v1.z**2)*(v2.x**2+v2.y**2+v2.z**2));
      const angle = mag > 0 ? Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI) : 180;
      features.push(angle / 180);
    }

    // [14-16] Palm tilt unit vector (wrist → middle-mcp)
    const wrist = landmarks[WRIST_ID];
    const mmcp  = landmarks[MIDDLE_MCP];
    if (wrist && mmcp) {
      const dx = mmcp.x - wrist.x;
      const dy = mmcp.y - wrist.y;
      const dz = mmcp.z - wrist.z;
      const mag = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      features.push(dx/mag, dy/mag, dz/mag);
    } else {
      features.push(0, -1, 0); // default: pointing up
    }

    // [17-21] tip.y for all 5 fingers normalised
    for (const fid of FINGER_IDS) {
      const flm = landmarks[fid];
      features.push(flm ? Math.max(-0.5, Math.min(1.5, (flm.y - region.y) / (region.height || 1))) : 0);
    }

    return features; // length 22
  }

  // ── Detect ────────────────────────────────────────────────────────────────

  detect(handsLandmarks, keys, region, flipped = false) {
    const hits        = [];
    const releases    = [];
    const frameActive   = new Set();
    const framePressing = new Set();
    const now         = Date.now();

    if (!this._trainer.isMlpReady) {
      // Model not trained yet — pass through silently
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

        for (let i = keys.length - 1; i >= 0; i--) {
          const key  = keys[i];
          const note = key.note;

          if (mx < key.xMin || mx > key.xMax) continue;
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;

          frameActive.add(note);

          // Extract features and run MLP inference
          const features = this.extractFeatures(landmarks, tipId, region, palm);
          const prob = this._trainer.predictMLP(features);

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
