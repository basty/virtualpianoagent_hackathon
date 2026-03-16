export class DetectionMethod12 {
  constructor() {
    this.name = "Depth Anything V2 (Backend GPU)";
    
    // Config
    this._depthFrameWidth = 512;
    this._depthFrameHeight = 512;
    this._sendIntervalMs = 1000 / 15; // Target 15fps inference to avoid overloading
    
    // State
    this._ws = null;
    this._lastSendTime = 0;
    this._depthData = null; // Uint8Array of size W*H
    
    // Canvas for extracting sending frame
    this._sendCanvas = document.createElement('canvas');
    this._sendCanvas.width = this._depthFrameWidth;
    this._sendCanvas.height = this._depthFrameHeight;
    this._sendCtx = this._sendCanvas.getContext('2d', { willReadFrequently: true });
    
    // Image element and canvas for displaying/reading received depth map
    this._depthImageObj = new Image();
    this._depthImageObj.onload = () => {
      this._depthCtx.drawImage(this._depthImageObj, 0, 0, this._depthFrameWidth, this._depthFrameHeight);
      const imgData = this._depthCtx.getImageData(0, 0, this._depthFrameWidth, this._depthFrameHeight);
      this._copyDepthBuffer(imgData.data);
    };
    
    this._depthCanvas = document.createElement('canvas');
    this._depthCanvas.width = this._depthFrameWidth;
    this._depthCanvas.height = this._depthFrameHeight;
    this._depthCtx = this._depthCanvas.getContext('2d', { willReadFrequently: true });
    
    this._videoEl = document.getElementById('camera-feed'); // We extract frames from here
    
    // Key states
    this._keyStates = new Map();
    this.surfaceDepthCache = new Map(); // Store the average resting "surface" depth for each key
    
    this.connectWebSocket();
  }
  
  connectWebSocket() {
    console.log("[Method 12] Connecting to WebSocket...");
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this._ws = new WebSocket(`${protocol}//${window.location.host}/depth_stream`);
    this._ws.onopen = () => console.log("[Method 12] Connected to Depth Engine");
    this._ws.onclose = () => {
      console.log("[Method 12] WebSocket closed. Retrying in 2s...");
      setTimeout(() => this.connectWebSocket(), 2000);
    };
    this._ws.onmessage = (msg) => {
      if (msg.data === "ERROR") return;
      this._depthImageObj.src = "data:image/jpeg;base64," + msg.data;
    };
  }
  
  _copyDepthBuffer(rgbaData) {
    if (!this._depthData) {
      this._depthData = new Uint8ClampedArray(this._depthFrameWidth * this._depthFrameHeight);
    }
    // Grayscale: take R channel
    let j = 0;
    for (let i = 0; i < rgbaData.length; i += 4) {
      this._depthData[j++] = rgbaData[i];
    }
  }

  _sendFrame() {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    if (!this._videoEl || this._videoEl.readyState < 2) return;
    
    const now = performance.now();
    if (now - this._lastSendTime < this._sendIntervalMs) return;
    this._lastSendTime = now;
    
    // Draw video to canvas (center crop to maintain aspect ratio ideally, or stretch)
    // For simplicity, stretch it, since the ML model uses resizing internally
    this._sendCtx.drawImage(this._videoEl, 0, 0, this._depthFrameWidth, this._depthFrameHeight);
    
    // Send to backend as Blob/Byte array (JPEG)
    this._sendCanvas.toBlob((blob) => {
      if (blob) {
        // console.log("[Method 12] Sending frame...", blob.size);
        this._ws.send(blob);
      }
    }, 'image/jpeg', 0.8);
  }

  _getDepthAtPoint(normX, normY) {
    if (!this._depthData) return null;
    const x = Math.floor(normX * this._depthFrameWidth);
    const y = Math.floor(normY * this._depthFrameHeight);
    if (x < 0 || x >= this._depthFrameWidth || y < 0 || y >= this._depthFrameHeight) return null;
    return this._depthData[y * this._depthFrameWidth + x]; // 0-255 value (lower is usually closer/further depending on infer)
  }

  _calibrateKeySurface(key) {
    if (!this._depthData) return 0;
    const cx = key.xMin + key.drawW/2; 
    const cy = key.yMin + key.drawH/2;
    
    const r = 2; // sample window
    let sum = 0, count = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const val = this._getDepthAtPoint(cx + dx/this._depthFrameWidth, cy + dy/this._depthFrameHeight);
        if (val !== null) {
          sum += val;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : 0;
  }

  detect(handsLandmarks, keys, region, flipped, worldLandmarks) {
    this._sendFrame();
    
    const active = new Set();
    const pressing = new Set();
    const resultHits = [];
    const resultReleases = [];
    
    // Check missing depth data
    if (!this._depthData) return { active, pressing, hits: resultHits, releases: resultReleases };

    keys.forEach(key => {
      // Lazy calibrate surface depth for key
      if (!this.surfaceDepthCache.has(key.note)) {
         this.surfaceDepthCache.set(key.note, this._calibrateKeySurface(key));
      }
      
      const surfaceDepth = this.surfaceDepthCache.get(key.note);
      
      if (!this._keyStates.has(key.note)) {
        this._keyStates.set(key.note, { state: 'IDLE', lastHit: 0 });
      }
      const st = this._keyStates.get(key.note);
      
      let keyIsHovered = false;
      let hitTriggered = false;
      let hitVelocity = 0;
      
      // Determine key bounding box (normalized 0..1)
      let normLeft = key.xMin;
      let normRight = key.xMax;
      let normTop = key.yMin;
      let normBottom = key.yMax;

      for (let i = 0; i < handsLandmarks.length; i++) {
        const hand = handsLandmarks[i];
        const rawW = worldLandmarks?.[i];
        
        for (const tipIdx of [8, 12, 16, 20]) {
          const pt = hand[tipIdx];
          
          // Check 2D bounding box
          if (pt.x >= normLeft && pt.x <= normRight && pt.y >= normTop && pt.y <= normBottom) {
             keyIsHovered = true;
             
             // Check 3D depth from depth map
             const fDepth = this._getDepthAtPoint(pt.x, pt.y);
             if (fDepth !== null) {
               // Depth Anything V2 closer objects -> brighter / higher values usually (check model normalization)
               // Assuming White = close (high int), Black = far (low int). Desk is further than finger.
               // So if finger presses down, depth might get LOWER (closer to the desk value).
               // Let's assume surfaceDepth is X. If fDepth is close to X, it's touching. If > X, it's floating.
               
               // We need a threshold, relative difference in uint8
               const depthDrop = fDepth - surfaceDepth;
               
               // We can also leverage MediaPipe's Y velocity or curl to ensure it's not a flat hand
               let isCurled = true;
               if (rawW) {
                 const root = rawW[tipIdx - 3];
                 const mid = rawW[tipIdx - 2];
                 const tip = rawW[tipIdx];
                 
                 const vec1 = [root.x - mid.x, root.y - mid.y, root.z - mid.z];
                 const vec2 = [tip.x - mid.x, tip.y - mid.y, tip.z - mid.z];
                 
                 const dot = vec1[0]*vec2[0] + vec1[1]*vec2[1] + vec1[2]*vec2[2];
                 const mag1 = Math.sqrt(vec1[0]*vec1[0] + vec1[1]*vec1[1] + vec1[2]*vec1[2]);
                 const mag2 = Math.sqrt(vec2[0]*vec2[0] + vec2[1]*vec2[1] + vec2[2]*vec2[2]);
                 
                 const angle = Math.acos(dot / (mag1 * mag2)) * (180 / Math.PI);
                 if (angle > 165) isCurled = false;
               }
               
               // Trigger criteria: Depth value is very close to surface value PLUS curled
               // We also use basic Y velocity check
               if (Math.abs(depthDrop) < 15 && isCurled) { // Within 15 units of surface
                 
                 if (st.state === 'HOVER') {
                    // It hit the threshold
                    hitTriggered = true;
                    // Mock velocity using depth drop derivative if we tracked it, but hardcode ok for now
                    hitVelocity = 80;
                 }
               }
             }
          }
        }
      }
      
      const now = performance.now();
      
      // State Machine Transition
      if (st.state === 'COOLDOWN') {
          if (now - st.lastHit > 100) st.state = 'IDLE';
      }
      
      if (hitTriggered && st.state === 'HOVER') {
        const hit = { ...key, velocity: hitVelocity };
        resultHits.push(hit);
        pressing.add(key.note);
        st.state = 'COOLDOWN';
        st.lastHit = now;
      } else if (keyIsHovered && st.state !== 'COOLDOWN') {
        st.state = 'HOVER';
        active.add(key.note);
      } else if (!keyIsHovered) {
        if (st.state === 'COOLDOWN' || st.state === 'HOVER') {
          // If it was pressing or hovering, we should ideally check for release
          // Simplified: if it's not hovered, it's idle.
          // Note: releases in main.js are handled by the sound engine.
        }
        st.state = 'IDLE';
      }
    });

    return { active, pressing, hits: resultHits, releases: resultReleases };
  }
}
