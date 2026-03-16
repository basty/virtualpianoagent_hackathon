/**
 * handTracker.js — MediaPipe Hands wrapper
 *
 * Initialises MediaPipe Hands, processes frames from the camera video,
 * and exposes an `onResults` callback with normalised landmarks.
 */

export const FINGERTIP_IDS = [4, 8, 12, 16, 20];

export class HandTracker {
  /**
   * @param {HTMLCanvasElement} overlayCanvas   — where landmarks are drawn
   * @param {HTMLVideoElement}  videoElement    — source frames
   */
  constructor(overlayCanvas, videoElement) {
    this._canvas  = overlayCanvas;
    this._ctx     = overlayCanvas.getContext('2d');
    this._video   = videoElement;
    this._hands   = null;
    this._rafId   = null;
    this._running = false;

    // FPS tracking
    this._lastTime  = 0;
    this._frameCount = 0;
    this.fps        = 0;

    /** Callback: (results) => void  — called every processed frame */
    this.onResults = null;

    /** Region of Interest (ROI) for filtering unintentional fingertips */
    this._roi = null;

    /** Smoothed landmark positions per hand per landmark to reduce jitter */
    this._smoothed = [];
    this._SMOOTH_ALPHA = 0.4; // lower = smoother but laggier (0.4 is a good balance)
  }

  setROI(region) {
    this._roi = region;
  }

  /** Load and configure MediaPipe Hands, then start the frame loop. */
  async init() {
    // ── 1. Create Hands instance ──
    try {
      this._hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
    } catch (err) {
      console.error('[HandTracker] Failed to instantiate Hands:', err);
      throw new Error('MediaPipe Hands could not be initialized. Check browser WebGL support.');
    }

    this._hands.setOptions({
      maxNumHands:          2,
      modelComplexity:      1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence:  0.6,
    });

    this._hands.onResults((results) => this._handleResults(results));

    // ── 2. Wait for video to be genuinely ready ──
    // Even if main.js calls start(), we want to be sure the first frame is available.
    if (this._video.readyState < 2) {
      await new Promise(resolve => {
        this._video.addEventListener('canplay', resolve, { once: true });
      });
    }

    this._running = true;
    this._loop();
    console.info('[HandTracker] Subsystem online ✓');
  }

  /** Stop the frame loop and close MediaPipe. */
  stop() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._hands) {
      try {
        this._hands.close();
      } catch (e) { /* ignore */ }
      this._hands = null;
    }
  }

  // ── Private ────────────────────────────────────────────

  _loop() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(async (ts) => {
      try {
        await this._processFrame(ts);
      } catch (err) {
        console.error('[HandTracker] Frame process error:', err);
        // If it's a "Failed to create WebGL" error, we might want to stop early
        if (err.message?.includes('WebGL')) {
          this.stop();
          alert('Fatal WebGL error in MediaPipe. Try reloading the page or check hardware acceleration.');
          return;
        }
      }
      this._loop();
    });
  }

  async _processFrame(ts) {
    // MediaPipe needs a valid video frame.
    // readyState 2+ and non-zero dimensions are CRITICAL.
    if (!this._video || this._video.readyState < 2 || !this._video.videoWidth) {
      return;
    }

    const vw = this._video.videoWidth;
    const vh = this._video.videoHeight;
    
    // Sync canvas size
    if (this._canvas.width !== vw || this._canvas.height !== vh) {
      this._canvas.width  = vw;
      this._canvas.height = vh;
    }

    // Inference
    await this._hands.send({ image: this._video });

    // FPS tracking
    this._frameCount++;
    if (ts - this._lastTime >= 1000) {
      this.fps        = this._frameCount;
      this._frameCount = 0;
      this._lastTime  = ts;
    }
  }

  _handleResults(results) {
    if (!this._running) return;

    // Apply exponential moving average smoothing to all landmarks to reduce jitter.
    if (results.multiHandLandmarks) {
      for (let hi = 0; hi < results.multiHandLandmarks.length; hi++) {
        const lms = results.multiHandLandmarks[hi];
        if (!this._smoothed[hi]) this._smoothed[hi] = [];
        for (let li = 0; li < lms.length; li++) {
          const raw = lms[li];
          if (!this._smoothed[hi][li]) {
            this._smoothed[hi][li] = { x: raw.x, y: raw.y, z: raw.z };
          } else {
            const s = this._smoothed[hi][li];
            const a = this._SMOOTH_ALPHA;
            s.x = a * raw.x + (1 - a) * s.x;
            s.y = a * raw.y + (1 - a) * s.y;
            s.z = a * raw.z + (1 - a) * s.z;
          }
          // Mutate landmark in place so downstream consumers see smoothed values
          lms[li] = Object.assign({}, lms[li], this._smoothed[hi][li]);
        }
      }
    } else {
      this._smoothed = []; // reset if no hands
    }

    // Call onResults FIRST. This allows downstream consumers (like PianoOverlay)
    // to process the frame and annotate landmarks (e.g., mark lm.isPressing).
    this.onResults?.(results);

    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    if (results.multiHandLandmarks && results.multiHandedness) {
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const landmarks = results.multiHandLandmarks[i];
        const handedness = results.multiHandedness[i];
        
        // Filter out low-confidence hand detections (guessed hands)
        if (handedness.score < 0.75) continue;

        this._drawSkeleton(landmarks);
        this._drawFingertips(landmarks);
      }
    }
  }

  /** Calculate internal angle at PIP joint (straight is 180) */
  _getFingerAngle(landmarks, mcpIdx, pipIdx, tipIdx) {
    const p1 = landmarks[mcpIdx];
    const p2 = landmarks[pipIdx];
    const p3 = landmarks[tipIdx];

    if (!p1 || !p2 || !p3) return 180; // Default to straight if missing

    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };

    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

    const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cosTheta) * (180 / Math.PI);
  }

  /** Draw mirrored skeleton */
  _drawSkeleton(landmarks) {
    const ctx = this._ctx;
    const w   = this._canvas.width;
    const h   = this._canvas.height;

    const CONNECTIONS = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],
      [0,17],
    ];

    ctx.strokeStyle = 'rgba(124, 108, 255, 0.6)';
    ctx.lineWidth   = 2;

    for (const [a, b] of CONNECTIONS) {
      // Determine if this connection belongs to a fingertip segment
      let skip = false;
      const tipForSegment = [4, 8, 12, 16, 20].find(t => (a === t || b === t) || ((a === t-1 && b === t-2) || (a === t-2 && b === t-1)));
      if (tipForSegment) {
          const mcpId = tipForSegment - 3;
          const pipId = tipForSegment - 2;
          const angle = this._getFingerAngle(landmarks, mcpId, pipId, tipForSegment);
          
          // Stricter check: ignore if curled or landmark has low visibility/presence
          const lm = landmarks[tipForSegment];
          const lowVis = (lm.visibility !== undefined && lm.visibility < 0.5) || 
                        (lm.presence !== undefined && lm.presence < 0.5);

          if (angle <= 155 || lowVis) { 
              skip = true;
          }
      }

      if (skip) continue;

      const lA = landmarks[a];
      const lB = landmarks[b];
      ctx.beginPath();
      ctx.moveTo((1 - lA.x) * w, lA.y * h);
      ctx.lineTo((1 - lB.x) * w, lB.y * h);
      ctx.stroke();
    }
  }

  /** Draw mirrored fingertips */
  _drawFingertips(landmarks) {
    const ctx = this._ctx;
    const w   = this._canvas.width;
    const h   = this._canvas.height;

    for (const id of FINGERTIP_IDS) {
      const mcpId = id - 3;
      const pipId = id - 2;
      const angle = this._getFingerAngle(landmarks, mcpId, pipId, id);
      const lm = landmarks[id];

      // Defensive visibility/presence check (some MP versions provide this)
      const lowVis = (lm.visibility !== undefined && lm.visibility < 0.5) || 
                    (lm.presence !== undefined && lm.presence < 0.5);
      
      // Ignore if curled (resting/occluded) or low confidence
      if (angle <= 155 || lowVis) continue;

      // Optional: ignore if far from piano region (not even close to intention)
      if (this._roi) {
        const mx = 1 - lm.x;
        const my = lm.y;
        const r = this._roi;
        // Check if within bounds with some generous margin (e.g. 0.1)
        if (mx < r.x - 0.1 || mx > r.x + r.width + 0.1 || my < r.y - 0.2 || my > r.y + r.height + 0.1) {
          continue;
        }
      }

      ctx.beginPath();
      ctx.arc((1 - lm.x) * w, lm.y * h, 8, 0, Math.PI * 2);
      ctx.fillStyle   = lm.isPressing ? 'rgba(255, 60, 60, 0.95)' : 'rgba(0, 229, 160, 0.85)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }
  }
}
