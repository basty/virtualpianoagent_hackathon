import { FINGERTIP_IDS } from './handTracker.js';

const STATE = {
  IDLE:     'idle',
  PRESSED:  'pressed',
};

// V6: AI v1 - 3D Surface Plane Calibration
export class DetectionMethod6 {
  constructor() {
    this._keyStates = {};
    this._history = {};
    this.planeNormal = null;
    this.planeD = null;
  }

  // Uses World Landmarks to fit a 3D plane
  calibrateSurface(multiHandWorldLandmarks) {
    if (!multiHandWorldLandmarks || multiHandWorldLandmarks.length === 0) return false;
    
    let surfacePoints = [];
    // 4,8,12,16,20 = fingertips. 0,5 = palm points
    const tipsAndPalm = [0, 5, 4, 8, 12, 16, 20];

    for (const handWorld of multiHandWorldLandmarks) {
      if (!handWorld) continue;
      for (const idx of tipsAndPalm) {
        if (handWorld[idx]) {
          surfacePoints.push(handWorld[idx]);
        }
      }
    }

    if (surfacePoints.length < 4) return false;

    const plane = this._fitPlane(surfacePoints);
    if (!plane) return false;

    this.planeNormal = plane.normal;
    this.planeD = plane.offset;
    return true;
  }

  // Least squares plane fitting
  _fitPlane(points) {
    let sumX = 0, sumY = 0, sumZ = 0;
    let sumXX = 0, sumXY = 0, sumXZ = 0;
    let sumYY = 0, sumYZ = 0;
    let n = points.length;

    for(let p of points) {
        let x = p.x, y = p.y, z = p.z;
        sumX += x; sumY += y; sumZ += z;
        sumXX += x*x; sumXY += x*y; sumXZ += x*z;
        sumYY += y*y; sumYZ += y*z;
    }

    let D = sumXX * (sumYY * n - sumY * sumY) -
            sumXY * (sumXY * n - sumX * sumY) +
            sumX  * (sumXY * sumY - sumYY * sumX);

    if (Math.abs(D) < 1e-9) return null;

    let Da = sumXZ * (sumYY * n - sumY * sumY) -
             sumXY * (sumYZ * n - sumZ * sumY) +
             sumX  * (sumYZ * sumY - sumYY * sumZ);

    let Db = sumXX * (sumYZ * n - sumZ * sumY) -
             sumXZ * (sumXY * n - sumX * sumY) +
             sumX  * (sumXY * sumZ - sumYZ * sumX);

    let Dc = sumXX * (sumYY * sumZ - sumYZ * sumY) -
             sumXY * (sumXY * sumZ - sumYZ * sumX) +
             sumXZ * (sumXY * sumY - sumYY * sumX);

    let A = Da / D;
    let B = Db / D;
    let C = Dc / D;

    let length = Math.sqrt(A*A + B*B + 1);
    let normal = { x: -A/length, y: -B/length, z: 1/length };
    let d = -C / length;

    return { normal, offset: d };
  }

  detect(handsLandmarks, keys, region, flipped = false, multiHandWorldLandmarks = null) {
    const hits = [];
    const releases = [];
    const frameActive   = new Set();
    const framePressing = new Set();

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks = handsLandmarks[hi];
      const worldLandmarks = multiHandWorldLandmarks ? multiHandWorldLandmarks[hi] : null;

      if (!landmarks[0]) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm = landmarks[tipId];
        const worldLm = worldLandmarks ? worldLandmarks[tipId] : null;
        if (!lm || !worldLm) continue;

        const mx = 1 - lm.x;
        const tipKey = `${hi}_${tipId}`;

        if (!this._history[tipKey]) this._history[tipKey] = { lastZ: worldLm.z, cooldown: 0, wasTouching: false, pressedY: null };
        const hist = this._history[tipKey];
        if (hist.cooldown > 0) hist.cooldown--;

        for (let i = keys.length - 1; i >= 0; i--) {
          const key = keys[i];
          const note = key.note;

          if (mx < key.xMin || mx > key.xMax) continue;
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;

          if (!this._keyStates[note]) {
            this._keyStates[note] = { state: STATE.IDLE };
          }
          const ks = this._keyStates[note];

          frameActive.add(note);

          // 3D Plane Logic
          let touching = false;
          let velocityDown = false;

          if (this.planeNormal) {
            // signed 3D distance to plane
            const distance = this.planeNormal.x * worldLm.x + 
                             this.planeNormal.y * worldLm.y + 
                             this.planeNormal.z * worldLm.z + this.planeD;

            touching = Math.abs(distance) < 0.015;
            
            // Requires downward movement into the screen to act as a proper tap
            if (worldLm.z < hist.lastZ - 0.002) velocityDown = true;
          }

          if (ks.state === STATE.IDLE) {
            // Trigger press only when touching + moving slightly down (or just touching and starting to touch)
            if (this.planeNormal && touching && !hist.wasTouching && hist.cooldown === 0) {
              ks.state = STATE.PRESSED;
              hits.push({ note, velocity: 0.8 });
              framePressing.add(note);
              hist.cooldown = 10;
              hist.pressedY = lm.y;
            }
          } else {
            const raisedHighEnough = hist.pressedY !== null && lm.y < hist.pressedY - 0.03;
            if (!touching || raisedHighEnough) {
              ks.state = STATE.IDLE;
              releases.push(note);
              hist.pressedY = null;
            } else if (!this.planeNormal) {
               ks.state = STATE.IDLE;
               releases.push(note);
            } else {
              framePressing.add(note);
            }
          }

          break;
        }
        hist.lastZ = worldLm.z;
        if (this.planeNormal) {
             const dist = this.planeNormal.x * worldLm.x + this.planeNormal.y * worldLm.y + this.planeNormal.z * worldLm.z + this.planeD;
             hist.wasTouching = Math.abs(dist) < 0.015;
        }
      }
    }

    for (const note in this._keyStates) {
      if (!frameActive.has(note) && !framePressing.has(note)) {
        if (this._keyStates[note].state === STATE.PRESSED) {
          releases.push(note);
        }
        this._keyStates[note].state = STATE.IDLE;
      }
    }

    return { hits, releases, active: frameActive, pressing: framePressing };
  }
}
