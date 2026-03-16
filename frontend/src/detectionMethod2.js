import { FINGERTIP_IDS } from './handTracker.js';

const STATE = {
  IDLE:     'idle',
  PRESSED:  'pressed',
};

// Option 1: Dynamic Floor ("Lowest Point")
// We track the lowest Y-coordinate the finger reaches while inside the key space.
// It triggers when the finger is at its lowest recorded point.
export class DetectionMethod2 {
  constructor() {
    this._keyStates = {};
    this._fingerFloors = {}; // Tracks the lowest Y seen per fingertip
    this._history = {};
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
    const frameActive   = new Set();
    const framePressing = new Set();
    
    for (const id in this._fingerFloors) {
      // Floor decay: move floor UP (smaller Y) so users must press deeper to re-trigger.
      this._fingerFloors[id] += 0.002; 
    }

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks = handsLandmarks[hi];
      const palm = landmarks[0];
      if (!palm) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm = landmarks[tipId];
        if (!lm) continue;

        const mx = 1 - lm.x;
        const tipKey = `${hi}_${tipId}`;

        if (!this._history[tipKey]) this._history[tipKey] = { y: [] };
        const h = this._history[tipKey];
        h.y.push(lm.y);
        if (h.y.length > 5) h.y.shift();

        // Standardized: Floor is the deepest (largest Y) point reached.
        if (!this._fingerFloors[tipKey]) {
          this._fingerFloors[tipKey] = lm.y;
        } else {
          if (lm.y < this._fingerFloors[tipKey]) {
            this._fingerFloors[tipKey] = lm.y;
          }
        }
        
        const floorY = this._fingerFloors[tipKey];
        // At or very close to the dynamic floor (within a small threshold)
        const isAtFloor = lm.y <= floorY + 0.015;

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
            this._keyStates[note] = { state: STATE.IDLE , pressedBy: null, releaseFrames: 0 };
          }
          const ks = this._keyStates[note];

          const surfaceYThreshold = flipped ? key.yMin + ((key.yMax - key.yMin) * 0.4) : key.yMax - ((key.yMax - key.yMin) * 0.4);
          const inKeyZone = lm.y >= surfaceYThreshold;

          // Reject if the finger is severely under the desk (way past the threshold)
          const isUnderDesk = lm.y < key.yMin - 0.1;

          // Reject if the finger angle is too curled (resting/hovering without intent)
          const mcpId = tipId - 3;
          const pipId = tipId - 2;
          const angle = this._getFingerAngle(landmarks, mcpId, pipId, tipId);
          const isIntentionallyExtended = angle > 150; // Needs to be somewhat straight

          if (inKeyZone) frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (inKeyZone && isAtFloor && !isUnderDesk && isIntentionallyExtended) {
              ks.state = STATE.PRESSED;
              hits.push({ note, velocity: 0.8 });
              ks.pressedBy = tipKey; 
              framePressing.add(note);
            }
          } else if (ks.state === STATE.PRESSED) {
            if (!inKeyZone || !isAtFloor || isUnderDesk || !isIntentionallyExtended) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
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

    return { hits, releases, active: frameActive, pressing: framePressing };
  }
}
