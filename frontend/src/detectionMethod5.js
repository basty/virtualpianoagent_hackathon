import { FINGERTIP_IDS } from './handTracker.js';

const STATE = {
  IDLE:     'idle',
  PRESSED:  'pressed',
};

const VELOCITY_DOWN_THRESH = 0.006; // Normalized dy
const COOLDOWN_FRAMES = 12;

/**
 * DetectionMethod5: Calibrated Y-threshold + Velocity Reversal
 * 
 * Logic:
 * 1. Fingertip over key
 * 2. tip.y > table_y (crossed plane)
 * 3. dy > threshold (moving down fast)
 * 4. prev_dy <= 0 (bounce/reversal)
 */
export class DetectionMethod5 {
  constructor() {
    this._keyStates = {};
    this._history = {}; // tipKey -> { lastY, lastDy, cooldown }
    this._tableY = 0.8;  // Default fallback
  }

  setTableY(y) {
    this._tableY = y;
  }

  detect(handsLandmarks, keys, region, flipped = false) {
    const hits = [];
    const releases = [];
    const frameActive   = new Set();
    const framePressing = new Set();

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks = handsLandmarks[hi];
      if (!landmarks[0]) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm = landmarks[tipId];
        if (!lm) continue;

        const tipKey = `${hi}_${tipId}`;
        if (!this._history[tipKey]) {
          this._history[tipKey] = { lastY: lm.y, lastDy: 0, cooldown: 0 };
        }
        const hist = this._history[tipKey];
        
        // Cooldown tick
        if (hist.cooldown > 0) hist.cooldown--;

        const mx = 1 - lm.x;
        // For unflipped (default), hovering is high Y (0.9), pressing is moving "up" the screen to low Y (0.7).
        // So moving into keys means lm.y decreases -> hist.lastY - lm.y is positive.
        const dy = lm.y - hist.lastY; // positive = moving down (larger Y)
        
        const isOverPiano = mx >= region.x && mx <= region.x + region.width;
        if (!isOverPiano) {
          hist.lastY = lm.y;
          hist.lastDy = dy;
          hist.lowestY = null;
          continue;
        }

        // Logic Check
        // If unflipped, crossing plane into the desk means Y <= tableY
        const crossedPlane = lm.y >= this._tableY;
        const fastDown = dy > VELOCITY_DOWN_THRESH;
        const bounced = hist.lastDy <= 0;

        for (let i = keys.length - 1; i >= 0; i--) {
          const key = keys[i];
          const note = key.note;

          if (mx < key.xMin || mx > key.xMax) continue;
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;
          
          // Y bounds for identifying which note, but the trigger depends on the tableY
          // However, we still need to know we are roughly in the key's Y range
          

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

          if (crossedPlane) frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (crossedPlane && fastDown && bounced && hist.cooldown === 0) {
              ks.state = STATE.PRESSED;
              hits.push({ note, velocity: 0.8 });
              ks.pressedBy = tipKey; 
              framePressing.add(note);
              hist.cooldown = COOLDOWN_FRAMES;
              hist.lowestY = lm.y;
            }
          } else {
            // Keep track of the lowest point reached while pressed
            if (hist.lowestY === undefined || hist.lowestY === null) {
                hist.lowestY = lm.y;
                hist.lowestY = lm.y;
            } else {
                if (lm.y > hist.lowestY) hist.lowestY = lm.y;
            }

            // Release logic: finger moves back up significantly from its lowest point
            // If unflipped, "up" means Y decreases. So threshold is lower than lowestY
            const liftedHighEnough = lm.y <= hist.lowestY - 0.03;

            if (!crossedPlane || liftedHighEnough) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
                hist.lowestY = null;
              }
            } else {
              ks.releaseFrames = 0;
              framePressing.add(note);
            }
          }
          break;
        }

        hist.lastY = lm.y;
        hist.lastDy = dy;
      }
    }

    // Global release for keys no longer active
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
