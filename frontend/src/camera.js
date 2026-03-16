/**
 * camera.js — Camera Manager
 *
 * Wraps getUserMedia and exposes the video element.
 * The caller (HandTracker) can grab frames from `videoElement`.
 */

export class CameraManager {
  /** @param {HTMLVideoElement} videoEl */
  constructor(videoEl) {
    this.videoElement = videoEl;
    this._stream      = null;
  }

  /**
   * Request camera access and start the video stream.
   * @param {{ width?: number, height?: number, facingMode?: string }} [opts]
   */
  async start(opts = {}) {
    const constraints = {
      video: {
        width:      { ideal: opts.width      ?? 1280 },
        height:     { ideal: opts.height     ?? 720  },
        facingMode: opts.facingMode ?? 'user',
        frameRate:  { ideal: 60 },
      },
      audio: false,
    };

    try {
      this._stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error(
          'Camera access denied. Please click the camera icon in your browser address bar and "Allow" access, then reload.'
        );
      }
      throw err;
    }
    this.videoElement.srcObject = this._stream;

    return new Promise((resolve, reject) => {
      this.videoElement.onloadedmetadata = () => {
        this.videoElement.play()
          .then(resolve)
          .catch(reject);
      };
    });
  }

  /** Stop all tracks and clear the stream. */
  stop() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
      this.videoElement.srcObject = null;
    }
  }

  /**
   * Enumerate available video input devices.
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  static async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  /** Switch to a specific camera by deviceId. */
  async switchCamera(deviceId) {
    this.stop();
    await this.start({ deviceId: { exact: deviceId } });
  }
}
