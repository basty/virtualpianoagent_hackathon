import { FINGERTIP_IDS } from './handTracker.js';
import { TOUCH_ZONE_FRAC } from './pianoOverlay.js';

const Y_VELOCITY_THRESHOLD = 0.005;  // Moving down (normalized screen space)
const Z_VELOCITY_THRESHOLD = -0.012; // Moving toward camera (relative to palm)
const BEND_ANGLE_THRESHOLD = 160;    // Stricter curl detection
const MIN_NOTE_INTERVAL    = 120;    // Debounce for re-triggering (ms)

const STATE = {
  IDLE:     'idle',
  HOVER:    'hover',
  PRESSED:  'pressed',
  COOLDOWN: 'cooldown',
};

export class DetectionMethod1 {
  constructor() {
    this._history = {};
    this._keyStates = {};
  }

  _getFingerAngle(landmarks, mcpIdx, pipIdx, tipIdx) {
    const p1 = landmarks[mcpIdx];
    const p2 = landmarks[pipIdx];
    const p3 = landmarks[tipIdx];

    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };

    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

    const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cosTheta) * (180 / Math.PI);
  }

  detect(handsLandmarks, keys, region, flipped = false) {
    const hits = [];
    const releases = [];
    const now  = Date.now();

    const r = region;
    // If flipped, surface is at the top of the key (yMin). 
    // Touch zone is extending downwards from yMin.
    const surfaceYThresholdWhite = flipped 
      ? r.y + r.height * TOUCH_ZONE_FRAC
      : r.y + r.height * (1 - TOUCH_ZONE_FRAC);
      
    const surfaceYThresholdBlack = flipped
      ? r.y + r.height * (TOUCH_ZONE_FRAC + 0.1)
      : r.y + r.height * (1 - TOUCH_ZONE_FRAC - 0.1);

    const frameActive   = new Set();
    const framePressing = new Set();

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks = handsLandmarks[hi];
      const palm = landmarks[0];
      if (!palm) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm = landmarks[tipId];
        if (!lm) continue;

        const mx     = 1 - lm.x;
        const tipKey = `${hi}_${tipId}`;

        const relZ = lm.z - palm.z;

        if (!this._history[tipKey]) this._history[tipKey] = { y: [], z: [] };
        const h = this._history[tipKey];
        h.y.push(lm.y); 
        h.z.push(relZ);
        if (h.y.length > 5) { h.y.shift(); h.z.shift(); }

        const dy = (h.y.length >= 2) ? (lm.y - h.y[h.y.length - 2]) : 0;
        const dz = (h.z.length >= 2) ? (relZ - h.z[h.z.length - 2]) : 0;

        const mcpId = tipId - 3;
        const pipId = tipId - 2;
        const angle = this._getFingerAngle(landmarks, mcpId, pipId, tipId);

        for (let i = keys.length - 1; i >= 0; i--) {
          const key = keys[i];
          const note = key.note;

          if (mx < key.xMin || mx > key.xMax) continue;
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;
          

          // If key is owned by a different finger, skip it
          if (this._keyStates[note] && this._keyStates[note].pressedBy && this._keyStates[note].pressedBy !== tipKey) {
            // Still count as framePressing so it doesn't get released globally
            if (this._keyStates[note].state === STATE.PRESSED) framePressing.add(note);
            break;
          }
          if (!this._keyStates[note]) {
            this._keyStates[note] = { state: STATE.IDLE, lastTime: 0, velocity: 0 , pressedBy: null, releaseFrames: 0 };
          }
          const ks = this._keyStates[note];

          // Standardized: Pressing always means moving DOWN into the desk (larger Y).
          const threshold = key.type === 'black' ? surfaceYThresholdBlack : surfaceYThresholdWhite;
          const inside = lm.y >= threshold; // below the surface line

          // Standardized: movingDown always means Y coordinate is increasing.
          const movingDown = dy > Y_VELOCITY_THRESHOLD; // positive dy = moving down
          const zSpike     = Math.abs(dz) > 0.008;
          const curled     = angle < BEND_ANGLE_THRESHOLD;
          const debounced  =  (now - ks.lastTime) > MIN_NOTE_INTERVAL;

          if (inside) {
            if (ks.state === STATE.IDLE || ks.state === STATE.COOLDOWN) {
              ks.state = STATE.HOVER;
            }
          }

          if (ks.state === STATE.HOVER) {
            if (inside) frameActive.add(note);
            
            if (inside && movingDown && zSpike && curled && debounced) {
              ks.state    = STATE.PRESSED;
              ks.lastTime = now;
              const speed = Math.abs(dz) * 1000;
              ks.velocity = Math.min(127, Math.max(40, Math.floor(speed * 4)));
              
              hits.push({ note, velocity: ks.velocity / 127 });
              ks.pressedBy = tipKey;
            }
          }

          if (ks.state === STATE.PRESSED) {
            framePressing.add(note);
            if (!inside || !curled) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
              }
            } else {
              ks.releaseFrames = 0;
            }
          }

          break; 
        }
      }
    }

    for (const note in this._keyStates) {
      if (!frameActive.has(note) && !framePressing.has(note)) {
        if (this._keyStates[note].state === STATE.PRESSED) {
          releases.push(note);
        }
        this._keyStates[note].state = STATE.IDLE;
        this._keyStates[note].pressedBy = null;
        this._keyStates[note].releaseFrames = 0;
      }
    }

    return { 
      hits, 
      releases,
      active: frameActive,
      pressing: framePressing
    };
  }
}
