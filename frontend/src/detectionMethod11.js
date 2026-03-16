import { FINGERTIP_IDS } from './handTracker.js';

/**
 * DetectionMethod11 — Refined 3D Plane-Fitting (SVD) + Signed-Distance Touch
 *
 * Inspired by the approach described as "Core 3D plane fitting with MediaPipe
 * world landmarks — refined and debug-ready version".
 *
 * Surface Calibration:
 *   Place palm + all finger tips flat on the surface and hold 2–3 seconds
 *   (same flow as Method 6 — just hit the Calibrate button). Uses SVD on a
 *   richer point set (wrist, all MCPs, all tips) for a more stable fit, plus
 *   an outlier-rejection pass that rejects calibrations whose average residual
 *   exceeds 2 cm.
 *
 * Touch Detection per frame:
 *   1. SIGNED DISTANCE — world-landmark fingertip projected onto the fitted
 *      plane.  |dist| < TOUCH_DIST_M  →  "near surface".
 *   2. VELOCITY TAP   — z-coordinate is decreasing (moving toward the 3D
 *      plane) at more than VELOCITY_THRESH_M / frame, confirming an intentional
 *      downstroke vs. a hover.
 *   3. COOLDOWN       — per-finger frame counter to avoid retriggering.
 *
 * Debug Overlay:
 *   When `debugOverlay` is true (default), each fingertip receives a label:
 *     "Touching: YES  d=+0.003m"  in green  (touching)
 *     "Touching: NO   d=-0.024m"  in red    (not touching / hovering)
 *   Circle radius grows to 12px when "YES".
 *
 * Plane Normal Convention:
 *   The SVD gives the eigenvector corresponding to the *smallest* singular
 *   value, which is the normal to the best-fit plane.  We orient it so that
 *   the world-y component is negative (pointing "upward" in world coords,
 *   since MediaPipe world-y increases downward in camera view).
 */

// ── Tuneable constants ───────────────────────────────────────────────
/**
 * Half-thickness of the "surface slab" in world metres.
 * Fingertips within ±TOUCH_DIST_M of the plane are considered near-surface.
 */
const TOUCH_DIST_M = 0.012;   // 1.2 cm

/**
 * Minimum per-frame decrease in world-z (i.e. toward the camera / "downward
 * into the desk") to count as a genuine tap stroke.
 */
const VELOCITY_THRESH_M = 0.006; // 6 mm / frame

/**
 * Number of frames to lock out re-triggering after a press (≈ 200 ms at 30 fps).
 */
const COOLDOWN_FRAMES = 6;

/**
 * Minimum ms between two presses of the same note.
 */
const MIN_NOTE_INTERVAL_MS = 160;

/**
 * Maximum allowable mean residual during calibration (metres).
 * If the average point-to-plane distance exceeds this the calibration is
 * rejected as "bad fit".
 */
const MAX_FIT_RESIDUAL_M = 0.02;

// ── Calibration point indices (world landmarks) ──────────────────────
// 0=wrist, 1=thumb_cmc, 5=index_mcp, 9=middle_mcp, 13=ring_mcp, 17=pinky_mcp
// + all finger tips (4,8,12,16,20)
const CALIB_INDICES = [0, 1, 5, 9, 13, 17, 4, 8, 12, 16, 20];

// ── Finger meta (for tip ID → nice name in overlay) ──────────────────
const TIP_LABELS = { 4: 'Thumb', 8: 'Index', 12: 'Mid', 16: 'Ring', 20: 'Pinky' };

// ─────────────────────────────────────────────────────────────────────

export class DetectionMethod11 {
  constructor() {
    /** @type {Float64Array|null} 3-element plane normal (unit) */
    this.planeNormal = null;
    /** @type {number} plane offset d such that n·p + d = 0 for surface points */
    this.planeD = 0;

    /** Whether to draw the debug overlay on the piano canvas. */
    this.debugOverlay = true;

    // Per-hand per-tip state: { lastZ, cooldown, lastPressTime }
    this._history = {};

    // Per-note key state
    this._keyStates = {};
  }

  // ── Calibration ────────────────────────────────────────────────────

  /**
   * Fit a plane to world-landmark points.
   *
   * @param {Array<Array<{x,y,z}>>} multiHandWorldLandmarks
   * @returns {{ ok: boolean, message: string }}
   */
  calibrateSurface(multiHandWorldLandmarks) {
    if (!multiHandWorldLandmarks || multiHandWorldLandmarks.length === 0) {
      return { ok: false, message: 'No hands detected.' };
    }

    const pts = [];
    for (const handWorld of multiHandWorldLandmarks) {
      if (!handWorld) continue;
      for (const idx of CALIB_INDICES) {
        const lm = handWorld[idx];
        if (lm) pts.push([lm.x, lm.y, lm.z]);
      }
    }

    if (pts.length < 6) {
      return { ok: false, message: `Too few points (${pts.length} < 6).` };
    }

    // ─ Centroid ─
    const n = pts.length;
    let cx = 0, cy = 0, cz = 0;
    for (const [x, y, z] of pts) { cx += x; cy += y; cz += z; }
    cx /= n; cy /= n; cz /= n;

    // ─ Covariance (3×3) — upper triangle sufficient for SVD ─
    // We use a simplified numeric SVD via the power-iteration for the smallest
    // singular vector (normal to best-fit plane).
    // In practice the JS numeric landscape doesn't ship native SVD, so we
    // compute the 3×3 covariance matrix and find its smallest eigenvector via
    // the deflation / power method on the *smallest* eigenvalue.
    const C = [[0,0,0],[0,0,0],[0,0,0]];
    for (const [x, y, z] of pts) {
      const d = [x - cx, y - cy, z - cz];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          C[r][c] += d[r] * d[c];
        }
      }
    }

    // Find the eigenvector for the *smallest* eigenvalue of C.
    // We compute the two *largest* eigenvectors via power iteration, then take
    // the cross-product to get the third (normal), which corresponds to least
    // variance = best-fit plane normal.
    const v1 = this._powerIterate(C, null, 60);          // largest eigenvector
    const v2 = this._powerIterate(C, v1,   60);           // 2nd largest
    const normal = this._cross(v1, v2);                   // plane normal
    const nLen   = this._norm(normal);
    if (nLen < 1e-9) {
      return { ok: false, message: 'Degenerate point set.' };
    }
    const n3 = normal.map(x => x / nLen);

    // Orient: we want the normal to point "upward" (away from desk) in world
    // coords.  MediaPipe world-y increases downward, so the desk surface's
    // inward normal should have a positive y component (pointing upward in
    // world terms is negative-y, i.e., toward the camera).
    // We flip if n3[1] > 0 (pointing into the floor) so that signed dist
    // of fingers *above* the surface is positive.
    const flip = n3[1] > 0 ? -1 : 1;
    const unitN = n3.map(x => x * flip);
    const d = -(unitN[0]*cx + unitN[1]*cy + unitN[2]*cz);

    // ─ Validate fit quality ─
    let sumResidual = 0;
    for (const [x, y, z] of pts) {
      sumResidual += Math.abs(unitN[0]*x + unitN[1]*y + unitN[2]*z + d);
    }
    const meanResidual = sumResidual / n;
    if (meanResidual > MAX_FIT_RESIDUAL_M) {
      return {
        ok: false,
        message: `Bad fit (mean residual ${(meanResidual*100).toFixed(1)} cm > 2 cm). Keep hand flat.`,
      };
    }

    this.planeNormal = unitN;
    this.planeD      = d;

    return {
      ok: true,
      message: `Calibrated! Normal: [${unitN.map(v=>v.toFixed(3)).join(', ')}] residual=${(meanResidual*100).toFixed(2)} cm`,
    };
  }

  /**
   * Signed distance from a world-landmark point to the fitted plane.
   * Positive  → fingertip is above the surface (before contact).
   * Near zero → fingertip is on / at the surface.
   * @param {{x,y,z}} worldLm
   * @returns {number} distance in metres
   */
  getSignedDistance(worldLm) {
    if (!this.planeNormal) return 0;
    return this.planeNormal[0]*worldLm.x + this.planeNormal[1]*worldLm.y + this.planeNormal[2]*worldLm.z + this.planeD;
  }

  // ── Detect (called every frame) ────────────────────────────────────

  /**
   * @param {Array<Array<{x,y,z}>>} handsLandmarks          — normalised (screen) landmarks
   * @param {Array}                 keys                    — piano key descriptors
   * @param {object}                region                  — {x,y,width,height} normalised
   * @param {boolean}               flipped
   * @param {Array<Array<{x,y,z}>>} multiHandWorldLandmarks — world coord landmarks
   * @returns {{ hits, releases, active, pressing, debugInfo }}
   */
  detect(handsLandmarks, keys, region, flipped = false, multiHandWorldLandmarks = null) {
    const hits          = [];
    const releases      = [];
    const frameActive   = new Set();
    const framePressing = new Set();
    /** @type {Array<{tipId,hi,dist,touching,label}>} for debug overlay */
    const debugInfo     = [];

    for (let hi = 0; hi < handsLandmarks.length; hi++) {
      const landmarks  = handsLandmarks[hi];
      const worldHand  = multiHandWorldLandmarks ? multiHandWorldLandmarks[hi] : null;
      if (!landmarks[0]) continue;

      for (const tipId of FINGERTIP_IDS) {
        const lm      = landmarks[tipId];
        const worldLm = worldHand ? worldHand[tipId] : null;
        if (!lm || !worldLm) continue;

        const mx     = 1 - lm.x;
        const tipKey = `${hi}_${tipId}`;

        if (!this._history[tipKey]) {
          this._history[tipKey] = { lastZ: worldLm.z, cooldown: 0, lastPressTime: 0 };
        }
        const hist = this._history[tipKey];
        if (hist.cooldown > 0) hist.cooldown--;

        const dist     = this.getSignedDistance(worldLm);
        const touching = this.planeNormal !== null && Math.abs(dist) < TOUCH_DIST_M;

        // Velocity: world-z decreasing (positive dz means moved "toward camera surface")
        const dz       = hist.lastZ - worldLm.z;
        const velDown  = dz > VELOCITY_THRESH_M;

        if (this.debugOverlay) {
          debugInfo.push({ tipId, hi, dist, touching, lm, label: TIP_LABELS[tipId] || tipId });
        }

        // ── Key matching ────────────────────────────────────────
        for (let ki = keys.length - 1; ki >= 0; ki--) {
          const key  = keys[ki];
          const note = key.note;

          if (mx < key.xMin || mx > key.xMax) continue;
          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;

          frameActive.add(note);

          if (!this._keyStates[note]) {
            this._keyStates[note] = { pressed: false, pressedBy: null, lastTime: 0, releaseY: null };
          }
          const ks = this._keyStates[note];

          // Prevent another finger from stealing an already-pressed key
          if (ks.pressedBy && ks.pressedBy !== tipKey) {
            if (ks.pressed) framePressing.add(note);
            break;
          }

          const now       = Date.now();
          const debounced = (now - ks.lastTime) > MIN_NOTE_INTERVAL_MS;

          if (!ks.pressed) {
            const shouldPress = this.planeNormal
              ? touching && velDown && hist.cooldown === 0 && debounced
              : false;   // require calibration before any hits

            if (shouldPress) {
              ks.pressed   = true;
              ks.pressedBy = tipKey;
              ks.lastTime  = now;
              ks.releaseY  = lm.y;
              hist.cooldown = COOLDOWN_FRAMES;
              hist.lastPressTime = now;
              hits.push({ note, velocity: Math.min(1, 0.5 + Math.min(dz, 0.03) / 0.03 * 0.45) });
              framePressing.add(note);
            }
          } else {
            // Release: finger moved away from surface OR lifted significantly
            const lifted = ks.releaseY !== null && lm.y < ks.releaseY - 0.03;
            if (!touching || lifted) {
              ks.pressed   = false;
              ks.pressedBy = null;
              ks.releaseY  = null;
              releases.push(note);
            } else {
              framePressing.add(note);
            }
          }

          break;
        }

        hist.lastZ = worldLm.z;
      }
    }

    // Global sweep — release any note whose finger left the frame
    for (const note in this._keyStates) {
      const ks = this._keyStates[note];
      if (ks.pressed && !framePressing.has(note) && !frameActive.has(note)) {
        ks.pressed   = false;
        ks.pressedBy = null;
        ks.releaseY  = null;
        releases.push(note);
      }
    }

    return { hits, releases, active: frameActive, pressing: framePressing, debugInfo };
  }

  // ── Debug Overlay ──────────────────────────────────────────────────

  /**
   * Draw per-finger "Touching: YES/NO" text and a coloured ring on the
   * given 2D canvas context.
   *
   * Call this *after* `detect()` so `debugInfo` is populated.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number}                  W     — canvas width  (pixels)
   * @param {number}                  H     — canvas height (pixels)
   * @param {Array}                   debugInfo — returned from detect()
   */
  drawDebugOverlay(ctx, W, H, debugInfo) {
    if (!debugInfo || debugInfo.length === 0) return;

    ctx.save();
    ctx.font         = '12px "Inter", monospace';
    ctx.textBaseline = 'middle';

    for (const { lm, dist, touching, label } of debugInfo) {
      const px = (1 - lm.x) * W;
      const py = lm.y * H;

      // ── Coloured ring ──
      const color = touching ? '#00e5a0' : '#ff4444';
      ctx.strokeStyle = color;
      ctx.lineWidth   = touching ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(px, py, touching ? 13 : 9, 0, Math.PI * 2);
      ctx.stroke();

      // ── Text label ──
      const sign   = dist >= 0 ? '+' : '';
      const text   = `${label}: ${touching ? 'YES' : 'NO '} d=${sign}${(dist*100).toFixed(1)}cm`;
      const textX  = px + 16;
      const textY  = py;

      // Shadow for legibility
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(text, textX + 1, textY + 1);
      ctx.fillStyle = color;
      ctx.fillText(text, textX, textY);
    }

    // Calibration status hint
    if (!this.planeNormal) {
      ctx.font      = 'bold 13px "Inter", sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText('⚠ Method 11: Calibrate first (press Calibrate)', 11, 21);
      ctx.fillStyle = '#ffd93d';
      ctx.fillText('⚠ Method 11: Calibrate first (press Calibrate)', 10, 20);
    }

    ctx.restore();
  }

  // ── Math helpers ───────────────────────────────────────────────────

  /**
   * Power-iteration: find unit eigenvector for the *largest* eigenvalue.
   * If `deflate` is provided (a prior eigenvector), Gram-Schmidt orthogon-
   * alises at each step so we converge to the *next* largest eigenvalue.
   * @param {number[][]} A       3×3 symmetric matrix
   * @param {number[]|null} deflate prior unit eigenvector to deflate against
   * @param {number} iters
   * @returns {number[]} unit 3-vector
   */
  _powerIterate(A, deflate, iters) {
    let v = [Math.random(), Math.random(), Math.random()];
    v = this._normalise(v);
    for (let i = 0; i < iters; i++) {
      v = this._matvec(A, v);
      if (deflate) {
        // Gram-Schmidt: remove the deflate component
        const dot = v[0]*deflate[0] + v[1]*deflate[1] + v[2]*deflate[2];
        v = [v[0]-dot*deflate[0], v[1]-dot*deflate[1], v[2]-dot*deflate[2]];
      }
      const len = this._norm(v);
      if (len < 1e-12) break;
      v = v.map(x => x / len);
    }
    return v;
  }

  _matvec(A, v) {
    return [
      A[0][0]*v[0] + A[0][1]*v[1] + A[0][2]*v[2],
      A[1][0]*v[0] + A[1][1]*v[1] + A[1][2]*v[2],
      A[2][0]*v[0] + A[2][1]*v[1] + A[2][2]*v[2],
    ];
  }

  _cross(a, b) {
    return [
      a[1]*b[2] - a[2]*b[1],
      a[2]*b[0] - a[0]*b[2],
      a[0]*b[1] - a[1]*b[0],
    ];
  }

  _norm(v) { return Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2); }
  _normalise(v) { const l = this._norm(v) || 1; return v.map(x => x/l); }
}
